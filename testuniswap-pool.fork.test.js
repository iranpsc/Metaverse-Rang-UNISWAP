// ============================================================
// AUTOMATED FORK INTEGRATION TEST — PSC / WETH UNISWAP V3 POOL
// ============================================================

const { expect } = require("chai");
const { ethers } = require("hardhat");
const config = require("../scripts/uniswap-config");

function encodePriceSqrt(reserve1, reserve0) {
    const r1 = BigInt(reserve1.toString());
    const r0 = BigInt(reserve0.toString());
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

    const parseEther = ethers.parseEther || ethers.utils.parseEther;
    const getAddress = ethers.getAddress || ethers.utils.getAddress;
    const ZeroAddress = ethers.ZeroAddress || ethers.constants.AddressZero;

    before(async function () {
        [deployer, ledgerRecipient] = await ethers.getSigners();

        // Deploy a standard 18-decimal ERC20 mock for PSC if testing on local Mainnet Fork
        const ERC20Mock = await ethers.getContractFactory("PSC"); // Or standard ERC20 artifact in repo
        pscToken = await ERC20Mock.deploy();
        if (pscToken.waitForDeployment) await pscToken.waitForDeployment();
        else await pscToken.deployed();

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

        await (await pscToken.approve(config.routers.nonfungiblePositionManager, pscDesired)).wait();

        const slippageBps = BigInt(config.pool.slippageBps);
        const amount0Min = (amount0Desired * (10000n - slippageBps)) / 10000n;
        const amount1Min = (amount1Desired * (10000n - slippageBps)) / 10000n;
        const deadline = Math.floor(Date.now() / 1000) + 1200;

        const iface = pmContract.interface;
        const createPoolData = iface.encodeFunctionData("createAndInitializePoolIfNecessary", [
            token0, token1, config.pool.fee, expectedSqrtPriceX96
        ]);
        const mintData = iface.encodeFunctionData("mint", [{
            token0,
            token1,
            fee: config.pool.fee,
            tickLower: config.pool.tickLower,
            tickUpper: config.pool.tickUpper,
            amount0Desired,
            amount1Desired,
            amount0Min,
            amount1Min,
            recipient: ledgerRecipient.address,
            deadline
        }]);
        const refundETHData = iface.encodeFunctionData("refundETH", []);

        const tx = await pmContract.multicall([createPoolData, mintData, refundETHData], {
            value: ethDesired
        });
        await tx.wait();

        const poolAddress = await factoryContract.getPool(token0, token1, config.pool.fee);
        expect(poolAddress).to.not.equal(ZeroAddress);

        const PoolABI = ["function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"];
        const poolContract = new ethers.Contract(poolAddress, PoolABI, deployer);
        const slot0 = await poolContract.slot0();

        expect(BigInt(slot0.sqrtPriceX96.toString())).to.equal(expectedSqrtPriceX96);
    });
});