// ============================================================
// ULTIMATE ENTERPRISE-GRADE ATOMIC UNISWAP V3 DEPLOYMENT SCRIPT
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
    console.log("  ULTIMATE ENTERPRISE PSC/WETH UNISWAP V3 BOOTSTRAPPER");
    console.log("============================================================");
    console.log(`  Deployer Address: ${deployer.address}`);
    console.log(`  LP Recipient (Ledger): ${config.pool.lpRecipient}`);

    if (!ethers.isAddress(config.pool.lpRecipient) || config.pool.lpRecipient === ethers.ZeroAddress) {
        throw new Error("❌ Security Error: Invalid or missing LP_RECIPIENT_LEDGER_ADDRESS in env/config!");
    }

    const pscAddress = config.tokens.PSC;
    const wethAddress = config.tokens.WETH;
    if (!pscAddress || !wethAddress) {
        throw new Error("❌ Token addresses for PSC or WETH are not configured!");
    }

    // 1. Pre-flight ETH Balance Check (3 ETH liquidity + gas buffer)
    const ethBalance = await ethers.provider.getBalance(deployer.address);
    const requiredEth = ethers.parseEther(config.pool.liquidity.ethAmount) + ethers.parseEther("0.05");
    if (ethBalance < requiredEth) {
        throw new Error(`❌ Insufficient ETH balance! Have: ${ethers.formatEther(ethBalance)} ETH, Need at least ~3.05 ETH.`);
    }

    // Token sorting for Uniswap V3 standard
    let token0 = pscAddress.toLowerCase() < wethAddress.toLowerCase() ? pscAddress : wethAddress;
    let token1 = pscAddress.toLowerCase() < wethAddress.toLowerCase() ? wethAddress : pscAddress;
    const isPscToken0 = (token0.toLowerCase() === pscAddress.toLowerCase());

    const ethDesired = ethers.parseEther(config.pool.liquidity.ethAmount); // 3.0 ETH
    const pscPerEth = BigInt(config.pool.liquidity.pscPerEth);
    
    // 2. Correct integer multiplication without 1e18 division error
    const pscDesired = ethDesired * pscPerEth;

    const amount0Desired = isPscToken0 ? pscDesired : ethDesired;
    const amount1Desired = isPscToken0 ? ethDesired : pscDesired;

    let reserve0 = isPscToken0 ? pscDesired : ethDesired;
    let reserve1 = isPscToken0 ? ethDesired : pscDesired;
    const sqrtPriceX96 = encodePriceSqrt(reserve1, reserve0);

    console.log(`  Initial Ratio Check: 1 ETH = ${config.pool.liquidity.pscPerEth} PSC`);
    console.log(`  Total Bootstrapping Liquidity: 3.0 ETH + ${ethers.formatUnits(pscDesired, 18)} PSC`);

    const PositionManagerABI = [
        "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
        "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
        "function refundETH() external payable",
        "function multicall(bytes[] data) external payable returns (bytes[] results)"
    ];

    const pmContract = new ethers.Contract(config.routers.nonfungiblePositionManager, PositionManagerABI, deployer);

    // 3. Pre-flight PSC Token Balance & Approval Check (WETH is handled natively)
    const pscToken = await ethers.getContractAt("IERC20", pscAddress);
    const pscBalance = await pscToken.balanceOf(deployer.address);
    if (pscBalance < pscDesired) {
        throw new Error(`❌ Insufficient PSC balance! Have: ${ethers.formatUnits(pscBalance, 18)}, Need: ${ethers.formatUnits(pscDesired, 18)}`);
    }

    console.log("Approving exact PSC token amount to PositionManager...");
    const approveTx = await pscToken.approve(config.routers.nonfungiblePositionManager, pscDesired);
    await approveTx.wait();
    console.log("PSC Approved successfully.");

    // Dynamic block deadline buffer (20 minutes)
    const block = await ethers.provider.getBlock("latest");
    const deadline = block.timestamp + 1200; 

    // Precise BPS slippage calculation (10,000 basis points)
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
        recipient: config.pool.lpRecipient, // 🔒 Secured directly to Ledger / Multi-sig
        deadline
    };

    const mintData = poolInterface.encodeFunctionData("mint", [mintParams]);
    const refundETHData = poolInterface.encodeFunctionData("refundETH", []);

    const multicallPayload = [createPoolData, mintData, refundETHData];

    // 4. Dynamic Gas Estimation with safety margin
    console.log("Estimating gas for atomic multicall execution...");
    let estimatedGas;
    try {
        estimatedGas = await pmContract.multicall.estimateGas(multicallPayload, { value: ethDesired });
        estimatedGas = (estimatedGas * BigInt(120)) / BigInt(100); // Add 20% safety buffer
    } catch (err) {
        console.warn("⚠️ Gas estimation warning, falling back to default safe limit:", err.message);
        estimatedGas = BigInt(3500000);
    }

    console.log(`Executing Ultimate Atomic Multicall (Gas Limit: ${estimatedGas.toString()})...`);
    const tx = await pmContract.multicall(multicallPayload, {
        value: ethDesired,
        gasLimit: estimatedGas
    });

    console.log(`Transaction Hash: ${tx.hash}`);
    const receipt = await tx.wait();
    
    // 5. Extracting Minted LP NFT TokenId securely from event logs
    let mintedTokenId = "Unknown";
    const transferEventTopic = ethers.id("Transfer(address,address,uint256)");
    for (const log of receipt.logs) {
        if (log.topics[0] === transferEventTopic && log.address.toLowerCase() === config.routers.nonfungiblePositionManager.toLowerCase()) {
            try {
                mintedTokenId = BigInt(log.topics[3]).toString();
            } catch (e) {
                // ignore parsing edge cases
            }
        }
    }

    console.log(`✅ Success! Confirmed in block ${receipt.blockNumber}`);
    console.log(`🏆 Minted LP Position NFT Token ID: ${mintedTokenId}`);
    console.log("============================================================");
    console.log("  POOL SECURELY BOOTSTRAPPED & LEDGER OWNERSHIP ASSIGNED!");
    console.log("============================================================");
}

main().catch((error) => {
    console.error("❌ Critical Execution Error:", error);
    process.exit(1);
});
