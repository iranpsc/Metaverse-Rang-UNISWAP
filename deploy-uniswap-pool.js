// ============================================================
// ATOMIC DEPLOYMENT & LIQUIDITY PROVISION SCRIPT — PSC/WETH
// ============================================================

const { ethers } = require("hardhat");
const config = require("./uniswap-config");

// Safe BigInt Sqrt calculation for Q64.96 without floating-point precision loss
function encodePriceSqrt(reserve1, reserve0) {
    const r1 = BigInt(reserve1);
    const r0 = BigInt(reserve0);
    // price = reserve1 / reserve0
    // sqrtPriceX96 = sqrt(reserve1 / reserve0) * 2^96
    const shift = BigInt(96);
    const numerator = r1 * (BigInt(1) << (shift * BigInt(2)));
    const ratio = numerator / r0;
    return sqrtBigInt(ratio);
}

function sqrtBigInt(value) {
    if (value < BigInt(0)) {
        throw new Error("Square root of negative numbers is not supported");
    }
    if (value === BigInt(0)) {
        return BigInt(0);
    }
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
    console.log("  PSC/WETH UNISWAP V3 ATOMIC DEPLOYMENT & LIQUIDITY BOOTSTRAP");
    console.log("============================================================");
    console.log(`  Deployer Address: ${deployer.address}`);
    console.log(`  LP Recipient (Ledger): ${config.pool.lpRecipient}`);

    if (!ethers.isAddress(config.pool.lpRecipient) || config.pool.lpRecipient === ethers.ZeroAddress) {
        throw new Error("❌ Invalid or missing LP_RECIPIENT_LEDGER_ADDRESS in config/env!");
    }

    const pscAddress = config.tokens.PSC;
    const wethAddress = config.tokens.WETH;
    if (!pscAddress || !wethAddress) {
        throw new Error("❌ Token addresses for PSC or WETH are not configured!");
    }

    // 1. Sort tokens to determine token0 and token1 correctly according to Uniswap V3 standard
    let token0 = pscAddress.toLowerCase() < wethAddress.toLowerCase() ? pscAddress : wethAddress;
    let token1 = pscAddress.toLowerCase() < wethAddress.toLowerCase() ? wethAddress : pscAddress;
    const isPscToken0 = (token0.toLowerCase() === pscAddress.toLowerCase());

    console.log(`  Token0: ${token0} (${isPscToken0 ? "PSC" : "WETH"})`);
    console.log(`  Token1: ${token1} (${isPscToken0 ? "WETH" : "PSC"})`);

    // 2. Calculate amounts for 3.0 ETH and corresponding PSC
    const ethDesired = ethers.parseEther(config.pool.liquidity.ethAmount); // 3.0 ETH
    const pscPerEth = BigInt(config.pool.liquidity.pscPerEth); // e.g., 100,000 PSC per 1 ETH
    const pscDesired = ethDesired * pscPerEth / BigInt(1e18); // Scaled correctly for 18 decimals

    const amount0Desired = isPscToken0 ? pscDesired : ethDesired;
    const amount1Desired = isPscToken0 ? ethDesired : pscDesired;

    console.log(`  Desired Token0 Amount: ${ethers.formatUnits(amount0Desired, 18)}`);
    console.log(`  Desired Token1 Amount: ${ethers.formatUnits(amount1Desired, 18)}`);

    // 3. Calculate exact sqrtPriceX96 independent of token sorting
    // Price of token1 in terms of token0
    // If token0 is PSC and token1 is WETH: price = WETH / PSC = 1 / pscPerEth
    // If token0 is WETH and token1 is PSC: price = PSC / WETH = pscPerEth
    let reserve0, reserve1;
    if (isPscToken0) {
        // token0 = PSC, token1 = WETH
        reserve0 = pscDesired;
        reserve1 = ethDesired;
    } else {
        // token0 = WETH, token1 = PSC
        reserve0 = ethDesired;
        reserve1 = pscDesired;
    }

    const sqrtPriceX96 = encodePriceSqrt(reserve1, reserve0);
    console.log(`  Calculated sqrtPriceX96: ${sqrtPriceX96.toString()}`);

    // 4. Attach Contracts
    const positionManager = await ethers.getContractAt(
        "@openzeppelin/contracts/token/ERC721/IERC721.sol" // Or standard NonfungiblePositionManager ABI
        , config.routers.nonfungiblePositionManager
    );
    
    // Using standard full interface for PositionManager
    const PositionManagerABI = [
        "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
        "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
        "function multicall(bytes[] data) external payable returns (bytes[] results)"
    ];

    const pmContract = new ethers.Contract(
        config.routers.nonfungiblePositionManager,
        PositionManagerABI,
        deployer
    );

    // Token approvals
    const pscToken = await ethers.getContractAt("IERC20", pscAddress);
    const wethToken = await ethers.getContractAt("IERC20", wethAddress);

    console.log("\n  Approving tokens to NonfungiblePositionManager...");
    await (await pscToken.approve(config.routers.nonfungiblePositionManager, amount0Desired * BigInt(2))).wait();
    await (await wethToken.approve(config.routers.nonfungiblePositionManager, amount1Desired * BigInt(2))).wait();
    console.log("  Approvals granted successfully.");

    // 5. Build Atomic Multicall Payload (Preventing MEV Sandwich Attacks)
    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes from now

    // Calculate slippage protection (99% of desired amounts -> max 1% slippage)
    const amount0Min = (amount0Desired * BigInt(100 - (config.pool.slippageBps / 100))) / BigInt(100);
    const amount1Min = (amount1Desired * BigInt(100 - (config.pool.slippageBps / 100))) / BigInt(100);

    const poolInterface = new ethers.Interface(PositionManagerABI);

    const createPoolData = poolInterface.encodeFunctionData("createAndInitializePoolIfNecessary", [
        token0,
        token1,
        config.pool.fee,
        sqrtPriceX96
    ]);

    const mintParams = {
        token0: token0,
        token1: token1,
        fee: config.pool.fee,
        tickLower: config.pool.tickLower,
        tickUpper: config.pool.tickUpper,
        amount0Desired: amount0Desired,
        amount1Desired: amount1Desired,
        amount0Min: amount0Min,
        amount1Min: amount1Min,
        recipient: config.pool.lpRecipient, // 🔒 Sent directly to Employer Ledger / Multi-Sig
        deadline: deadline
    };

    const mintData = poolInterface.encodeFunctionData("mint", [mintParams]);

    console.log("\n  Executing Atomic Multicall (Create/Init Pool + Mint Liquidity)...");
    
    // Total ETH value to send includes WETH deposit if needed, or pure ETH value
    const totalEthValue = isPscToken0 ? ethDesired : ethDesired; // Assuming WETH wrapping handled or direct ETH value

    const tx = await pmContract.multicall([createPoolData, mintData], {
        value: totalEthValue,
        gasLimit: 3000000
    });

    console.log(`  Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  ✅ Successfully confirmed in block ${receipt.blockNumber}`);
    console.log("============================================================");
    console.log("  POOL CREATED & 3 ETH LIQUIDITY LOCKED TO LEDGER SECURELY!");
    console.log("============================================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });