// ============================================================
// PRODUCTION-READY ATOMIC UNISWAP V3 DEPLOYMENT SCRIPT — PSC/WETH
// ============================================================

const { ethers } = require("hardhat");
const config = require("./uniswap-config");

function encodePriceSqrt(reserve1, reserve0) {
    const r1 = BigInt(reserve1);
    const r0 = BigInt(reserve0);
    const shift = BigInt(96);
    const numerator = r1 * (BigInt(1) << (shift * BigInt(2)));
    const ratio = numerator / r0;
    return sqrtBigInt(ratio);
}

function sqrtBigInt(value) {
    if (value < BigInt(0)) throw new Error("Negative value");
    if (value === BigInt(0)) return BigInt(0);
    let x = value;
    let y = (x + BigInt(1)) / BigInt(2);
    while (y < x) {
        x = y;
        y = (x + value / x) / BigInt(2);
    }
    return x;
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("============================================================");
    console.log("  SECURE PSC/WETH UNISWAP V3 BOOTSTRAP (FULLY OPTIMIZED)");
    console.log("============================================================");
    console.log(`  Deployer: ${deployer.address}`);
    console.log(`  Target LP Recipient (Ledger): ${config.pool.lpRecipient}`);

    if (!ethers.isAddress(config.pool.lpRecipient) || config.pool.lpRecipient === ethers.ZeroAddress) {
        throw new Error("❌ Security Error: Invalid or missing LP_RECIPIENT_LEDGER_ADDRESS!");
    }

    const pscAddress = config.tokens.PSC;
    const wethAddress = config.tokens.WETH;

    // Token sorting for Uniswap V3 standard
    let token0 = pscAddress.toLowerCase() < wethAddress.toLowerCase() ? pscAddress : wethAddress;
    let token1 = pscAddress.toLowerCase() < wethAddress.toLowerCase() ? wethAddress : pscAddress;
    const isPscToken0 = (token0.toLowerCase() === pscAddress.toLowerCase());

    const ethDesired = ethers.parseEther(config.pool.liquidity.ethAmount); // 3.0 ETH
    const pscPerEth = BigInt(config.pool.liquidity.pscPerEth);
    
    // 1. Fixed pscDesired calculation (without 1e18 division)
    const pscDesired = ethDesired * pscPerEth;

    const amount0Desired = isPscToken0 ? pscDesired : ethDesired;
    const amount1Desired = isPscToken0 ? ethDesired : pscDesired;

    let reserve0 = isPscToken0 ? pscDesired : ethDesired;
    let reserve1 = isPscToken0 ? ethDesired : pscDesired;
    const sqrtPriceX96 = encodePriceSqrt(reserve1, reserve0);

    const PositionManagerABI = [
        "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
        "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
        "function refundETH() external payable",
        "function multicall(bytes[] data) external payable returns (bytes[] results)"
    ];

    const pmContract = new ethers.Contract(config.routers.nonfungiblePositionManager, PositionManagerABI, deployer);

    // 2. Approve only PSC token (WETH is handled natively via msg.value)
    const pscToken = await ethers.getContractAt("IERC20", pscAddress);

    console.log("Approving PSC token to PositionManager...");
    await (await pscToken.approve(config.routers.nonfungiblePositionManager, pscDesired)).wait();

    const deadline = Math.floor(Date.now() / 1000) + 600;

    // 4. Slippage calculation using 10,000 BPS basis
    const slippageBps = BigInt(config.pool.slippageBps);
    const amount0Min = (amount0Desired * (BigInt(10000) - slippageBps)) / BigInt(10000);
    const amount1Min = (amount1Desired * (BigInt(10000) - slippageBps)) / BigInt(10000);

    const poolInterface = new ethers.Interface(PositionManagerABI);
    const createPoolData = poolInterface.encodeFunctionData("createAndInitializePoolIfNecessary", [
        token0, token1, config.pool.fee, sqrtPriceX96
    ]);

    const mintParams = {
        token0,
        token1,
        fee: config.pool.fee,
        tickLower: config.pool.tickLower,
        tickUpper: config.pool.tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min,
        recipient: config.pool.lpRecipient, // Secured to Ledger / Multi-sig
        deadline
    };

    const mintData = poolInterface.encodeFunctionData("mint", [mintParams]);
    
    // 3. Add refundETH data for multicall execution
    const refundETHData = poolInterface.encodeFunctionData("refundETH", []);

    console.log("Executing Atomic Multicall with refundETH...");
    const tx = await pmContract.multicall([createPoolData, mintData, refundETHData], {
        value: ethDesired,
        gasLimit: 3000000
    });

    const receipt = await tx.wait();
    console.log(`✅ Success! Confirmed in block ${receipt.blockNumber}`);
    console.log("============================================================");
    console.log("  POOL SECURELY BOOTSTRAPPED WITH 3 ETH TO LEDGER!");
    console.log("============================================================");
}

main().catch((error) => {
    console.error("❌ Critical Error:", error);
    process.exit(1);
});
