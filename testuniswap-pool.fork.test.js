// ============================================================
// AUTOMATED FORK INTEGRATION TEST — PSC / WETH UNISWAP V3 POOL
// Dual Compatibility: Works seamlessly on both Ethers v5 & v6
// ============================================================

const { expect } = require("chai");
const { ethers } = require("hardhat");
const config = require("../scripts/uniswap-config");

// ------------------------------------------------------------
// Ethers v5 / v6 Universal Compatibility Layer
// ------------------------------------------------------------
const isEthersV6 = typeof ethers.parseEther === "function";

const parseEther = (val) =>
    isEthersV6 ? ethers.parseEther(val) : ethers.utils.parseEther(val);

const getAddress = (addr) =>
    isEthersV6 ? ethers.getAddress(addr) : ethers.utils.getAddress(addr);

const ZeroAddress = isEthersV6 ? ethers.ZeroAddress : ethers.constants.AddressZero;

const createInterface = (abi) =>
    isEthersV6 ? new ethers.Interface(abi) : new ethers.utils.Interface(abi);

// ------------------------------------------------------------
// Q64.96 Square Root Encoder for Uniswap V3 Initialization
// ------------------------------------------------------------
function encodePriceSqrt(reserve1, reserve0) {
    const r1 = BigInt(reserve1.toString());
    const r0 = BigInt(reserve0.toString());
    if (r0 === 0n || r1 === 0n) throw new Error("Reserves must be greater than zero");
    const numerator = r1 * (1n << 192n);
    const ratio = numerator / r0;
    let x = ratio;
    let y = (x + 1n) / 2n;
    while (y < x) {
        x = y;
        y = (x + ratio / x) / 2n;
    }
    return x;
}

describe("PSC / WETH Uniswap V3 Atomic Pool Deployment & Custody Audit", function () {
    let deployer, ledgerRecipient;
    let pscToken, pmContract, factoryContract;
    let token0, token1, isPscToken0;

    before(async function () {
        const signers = await ethers.getSigners();
        deployer = signers[0];
        ledgerRecipient = signers[1] || signers[0];

        // Deploy a mock ERC20 token for PSC to simulate real token behavior on Fork
        const ERC20MockFactory = await ethers.getContractFactory("ERC20Mock" in ethers ? "ERC20Mock" : "PSC" in ethers ? "PSC" : "ERC20");
        
        // Fallback deployment depending on project artifact availability
        try {
            pscToken = await ERC20MockFactory.deploy("Paradise Supply Chain", "PSC", parseEther("1000000000"));
        } catch (_) {
            const GenericFactory = await ethers.getContractFactory("PSC");
            pscToken = await GenericFactory.deploy();
        }

        if (pscToken.waitForDeployment) {
            await pscToken.waitForDeployment();
        } else if (pscToken.deployed) {
            await pscToken.deployed();
        }

        const pscAddress = pscToken.target || pscToken.address;
        const wethAddress = getAddress(config.tokens.WETH);

        isPscToken0 = pscAddress.toLowerCase() < wethAddress.toLowerCase();
        token0 = isPscToken0 ? pscAddress : wethAddress;
        token1 = isPscToken0 ? wethAddress : pscAddress;

        const PositionManagerABI = [
            "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
            "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
            "function refundETH() external payable",
            "function multicall(bytes[] data) external payable returns (bytes[] results)",
            "function ownerOf(uint256 tokenId) external view returns (address)"
        ];

        const FactoryABI = [
            "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
        ];

        pmContract = new ethers.Contract(config.routers.nonfungiblePositionManager, PositionManagerABI, deployer);
        factoryContract = new ethers.Contract(config.routers.factory, FactoryABI, deployer);
    });

    it("Should atomically initialize PSC/WETH pool, lock 3 ETH + PSC, and mint LP NFT to Ledger", async function () {
        const ethDesired = BigInt(parseEther(config.pool.liquidity.ethAmount).toString());
        const pscPerEth = BigInt(config.pool.liquidity.pscPerEth);
        const pscDesired = ethDesired * pscPerEth;

        const amount0Desired = isPscToken0 ? pscDesired : ethDesired;
        const amount1Desired = isPscToken0 ? ethDesired : pscDesired;
        const expectedSqrtPriceX96 = encodePriceSqrt(amount1Desired, amount0Desired);

        // Handle minting for mock if mint function exists
        try {
            if (pscToken.mint) {
                await (await pscToken.mint(deployer.address, pscDesired.toString())).wait();
            }
        } catch (e) {
            // Ignore if token is pre-minted in constructor
        }

        const approveTx = await pscToken.approve(config.routers.nonfungiblePositionManager, pscDesired.toString());
        if (approveTx.wait) await approveTx.wait();

        const slippageBps = BigInt(config.pool.slippageBps);
        const amount0Min = (amount0Desired * (10000n - slippageBps)) / 10000n;
        const amount1Min = (amount1Desired * (10000n - slippageBps)) / 10000n;
        
        const latestBlock = await ethers.provider.getBlock("latest");
        const deadline = Number(latestBlock.timestamp) + 1200;

        const iface = createInterface([
            "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
            "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
            "function refundETH() external payable"
        ]);

        const createPoolData = iface.encodeFunctionData("createAndInitializePoolIfNecessary", [
            token0,
            token1,
            config.pool.fee,
            expectedSqrtPriceX96.toString()
        ]);

        const mintData = iface.encodeFunctionData("mint", [{
            token0,
            token1,
            fee: config.pool.fee,
            tickLower: Number(config.pool.tickLower),
            tickUpper: Number(config.pool.tickUpper),
            amount0Desired: amount0Desired.toString(),
            amount1Desired: amount1Desired.toString(),
            amount0Min: amount0Min.toString(),
            amount1Min: amount1Min.toString(),
            recipient: ledgerRecipient.address,
            deadline
        }]);

        const refundETHData = iface.encodeFunctionData("refundETH", []);

        const tx = await pmContract.multicall([createPoolData, mintData, refundETHData], {
            value: ethDesired.toString()
        });
        if (tx.wait) await tx.wait();

        // Verify pool creation
        const poolAddress = await factoryContract.getPool(token0, token1, config.pool.fee);
        expect(poolAddress).to.not.equal(ZeroAddress);

        // Verify pool slot0 price accuracy
        const PoolABI = ["function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"];
        const poolContract = new ethers.Contract(poolAddress, PoolABI, deployer);
        const slot0 = await poolContract.slot0();

        expect(BigInt(slot0.sqrtPriceX96.toString())).to.equal(expectedSqrtPriceX96);
    });
});
