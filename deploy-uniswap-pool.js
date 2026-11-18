// ============================================================
// PRODUCTION-GRADE ATOMIC UNISWAP V3 DEPLOYMENT SCRIPT — PSC/WETH
// ============================================================

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const config = require("./uniswap-config");

function encodePriceSqrt(reserve1, reserve0) {
    const r1 = BigInt(reserve1);
    const r0 = BigInt(reserve0);
    if (r0 === 0n || r1 === 0n) throw new Error("Reserves must be greater than zero");
    const numerator = r1 * (1n << 192n);
    const ratio = numerator / r0;
    return sqrtBigInt(ratio);
}

function sqrtBigInt(value) {
    if (value < 0n) throw new Error("Negative value not supported");
    if (value === 0n) return 0n;
    let x = value;
    let y = (x + 1n) / 2n;
    while (y < x) {
        x = y;
        y = (x + value / x) / 2n;
    }
    return x;
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("============================================================");
    console.log("  PRODUCTION PSC/WETH UNISWAP V3 BOOTSTRAPPER (AUDITED)");
    console.log("============================================================");

    // 1. Strict Address Validation & Checksum Normalization
    if (!config.pool.lpRecipient || !ethers.isAddress(config.pool.lpRecipient) || config.pool.lpRecipient === ethers.ZeroAddress) {
        throw new Error("Security Error: Invalid or missing LP_RECIPIENT_LEDGER_ADDRESS!");
    }
    if (!config.tokens.PSC || !ethers.isAddress(config.tokens.PSC)) {
        throw new Error("Config Error: Invalid or missing PSC_TOKEN_ADDRESS!");
    }
    if (!config.tokens.WETH || !ethers.isAddress(config.tokens.WETH)) {
        throw new Error("Config Error: Invalid or missing WETH_TOKEN_ADDRESS!");
    }

    const lpRecipient = ethers.getAddress(config.pool.lpRecipient);
    const pscAddress = ethers.getAddress(config.tokens.PSC);
    const wethAddress = ethers.getAddress(config.tokens.WETH);
    const pmAddress = ethers.getAddress(config.routers.nonfungiblePositionManager);
    const factoryAddress = ethers.getAddress(config.routers.factory);

    console.log(`  Deployer Address     : ${deployer.address}`);
    console.log(`  LP Recipient (Ledger): ${lpRecipient}`);

    // 2. Validate Tick Spacing Alignment
    const fee = Number(config.pool.fee);
    const tickSpacing = Number(config.pool.tickSpacing);
    const tickLower = Number(config.pool.tickLower);
    const tickUpper = Number(config.pool.tickUpper);

    if (tickLower >= tickUpper) {
        throw new Error("Config Error: tickLower must be strictly less than tickUpper!");
    }
    if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) {
        throw new Error(`Config Error: Ticks (${tickLower}, ${tickUpper}) must be exact multiples of tickSpacing (${tickSpacing})!`);
    }

    // 3. Sort Tokens & Calculate Exact Amounts
    const isPscToken0 = pscAddress.toLowerCase() < wethAddress.toLowerCase();
    const token0 = isPscToken0 ? pscAddress : wethAddress;
    const token1 = isPscToken0 ? wethAddress : pscAddress;

    const ethDesired = ethers.parseEther(config.pool.liquidity.ethAmount); // 3.0 ETH (18 decimals)
    const pscPerEth = BigInt(config.pool.liquidity.pscPerEth);             // e.g., 100000n
    const pscDesired = ethDesired * pscPerEth;                             // Exact 18-decimal raw amount

    const amount0Desired = isPscToken0 ? pscDesired : ethDesired;
    const amount1Desired = isPscToken0 ? ethDesired : pscDesired;

    const sqrtPriceX96 = encodePriceSqrt(amount1Desired, amount0Desired);

    console.log(`  Token0               : ${token0} (${isPscToken0 ? "PSC" : "WETH"})`);
    console.log(`  Token1               : ${token1} (${isPscToken0 ? "WETH" : "PSC"})`);
    console.log(`  Initial Valuation    : 1 ETH = ${pscPerEth.toString()} PSC`);
    console.log(`  Target Deposit       : ${ethers.formatEther(ethDesired)} ETH + ${ethers.formatUnits(pscDesired, 18)} PSC`);
    console.log(`  Target sqrtPriceX96  : ${sqrtPriceX96.toString()}`);

    // 4. Pre-flight Balance Checks (ETH + Gas Buffer & PSC Balance)
    const ethBalance = await ethers.provider.getBalance(deployer.address);
    const minRequiredEth = ethDesired + ethers.parseEther("0.03");
    if (ethBalance < minRequiredEth) {
        throw new Error(`Insufficient ETH! Balance: ${ethers.formatEther(ethBalance)} ETH, Required: ~${ethers.formatEther(minRequiredEth)} ETH`);
    }

    const ERC20_ABI = [
        "function balanceOf(address account) external view returns (uint256)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function approve(address spender, uint256 amount) external returns (bool)"
    ];
    const pscToken = new ethers.Contract(pscAddress, ERC20_ABI, deployer);
    const pscBalance = await pscToken.balanceOf(deployer.address);
    if (pscBalance < pscDesired) {
        throw new Error(`Insufficient PSC! Balance: ${ethers.formatUnits(pscBalance, 18)}, Required: ${ethers.formatUnits(pscDesired, 18)}`);
    }

    // 5. Check Existing Pool State on Factory (Prevent Pre-Init Front-Running)
    const FACTORY_ABI = ["function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"];
    const POOL_ABI = ["function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"];
    
    const factoryContract = new ethers.Contract(factoryAddress, FACTORY_ABI, deployer);
    const existingPoolAddress = await factoryContract.getPool(token0, token1, fee);

    if (existingPoolAddress !== ethers.ZeroAddress) {
        console.warn(`  Warning: Pool already exists at ${existingPoolAddress}. Verifying current slot0 price...`);
        const poolContract = new ethers.Contract(existingPoolAddress, POOL_ABI, deployer);
        const slot0 = await poolContract.slot0();
        if (slot0.sqrtPriceX96 !== 0n && slot0.sqrtPriceX96 !== sqrtPriceX96) {
            throw new Error(
                `Security Abort: Pool is already initialized with a different sqrtPriceX96 (${slot0.sqrtPriceX96.toString()}) vs target (${sqrtPriceX96.toString()})!`
            );
        }
    }

    // 6. Idempotent PSC Token Approval
    const currentAllowance = await pscToken.allowance(deployer.address, pmAddress);
    if (currentAllowance < pscDesired) {
        console.log("  Approving PSC token to NonfungiblePositionManager...");
        const approveTx = await pscToken.approve(pmAddress, pscDesired);
        await approveTx.wait();
        console.log("  PSC approval confirmed.");
    } else {
        console.log("  Sufficient PSC allowance already granted.");
    }

    // 7. Prepare Atomic Multicall Payload
    const PositionManagerABI = [
        "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
        "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
        "function refundETH() external payable",
        "function multicall(bytes[] data) external payable returns (bytes[] results)",
        "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
    ];

    const pmContract = new ethers.Contract(pmAddress, PositionManagerABI, deployer);
    const poolInterface = new ethers.Interface(PositionManagerABI);

    const latestBlock = await ethers.provider.getBlock("latest");
    const deadline = latestBlock.timestamp + 1200; // 20 minutes from latest chain timestamp

    const slippageBps = BigInt(config.pool.slippageBps);
    const amount0Min = (amount0Desired * (10000n - slippageBps)) / 10000n;
    const amount1Min = (amount1Desired * (10000n - slippageBps)) / 10000n;

    const
