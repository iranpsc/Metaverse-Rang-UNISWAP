// ============================================================
// PRODUCTION-GRADE ATOMIC UNISWAP V3 DEPLOYMENT SCRIPT — PSC/WETH
// Dual Compatibility: Works seamlessly on both Ethers v5 & Ethers v6
// ============================================================

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const config = require("./uniswap-config");

// ------------------------------------------------------------
// Ethers v5 / v6 Universal Compatibility Layer
// ------------------------------------------------------------
const isEthersV6 = typeof ethers.parseEther === "function";

const parseEther = (val) =>
    isEthersV6 ? ethers.parseEther(val) : ethers.utils.parseEther(val);

const formatEther = (val) =>
    isEthersV6 ? ethers.formatEther(val) : ethers.utils.formatEther(val.toString());

const formatUnits = (val, decimals) =>
    isEthersV6 ? ethers.formatUnits(val, decimals) : ethers.utils.formatUnits(val.toString(), decimals);

const getAddress = (addr) =>
    isEthersV6 ? ethers.getAddress(addr) : ethers.utils.getAddress(addr);

const isAddress = (addr) =>
    isEthersV6 ? ethers.isAddress(addr) : ethers.utils.isAddress(addr);

const ZeroAddress = isEthersV6 ? ethers.ZeroAddress : ethers.constants.AddressZero;

const createInterface = (abi) =>
    isEthersV6 ? new ethers.Interface(abi) : new ethers.utils.Interface(abi);

// ------------------------------------------------------------
// Exact Integer Math for Q64.96 (Zero Floating-Point Precision Loss)
// ------------------------------------------------------------
function encodePriceSqrt(reserve1, reserve0) {
    const r1 = BigInt(reserve1.toString());
    const r0 = BigInt(reserve0.toString());
    if (r0 === 0n || r1 === 0n) {
        throw new Error("Reserves must be strictly greater than zero");
    }
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
    console.log("  PRODUCTION PSC/WETH UNISWAP V3 BOOTSTRAPPER (v5/v6 READY)");
    console.log("============================================================");
    console.log(`  Detected Ethers SDK  : ${isEthersV6 ? "v6" : "v5"}`);

    // 1. Strict Address Validation & Checksum Normalization
    if (!config.pool.lpRecipient || !isAddress(config.pool.lpRecipient) || config.pool.lpRecipient === ZeroAddress) {
        throw new Error("Security Error: Invalid or missing LP_RECIPIENT_LEDGER_ADDRESS!");
    }
    if (!config.tokens.PSC || !isAddress(config.tokens.PSC) || config.tokens.PSC === ZeroAddress) {
        throw new Error("Config Error: Invalid or missing PSC_TOKEN_ADDRESS!");
    }
    if (!config.tokens.WETH || !isAddress(config.tokens.WETH) || config.tokens.WETH === ZeroAddress) {
        throw new Error("Config Error: Invalid or missing WETH_TOKEN_ADDRESS!");
    }

    const lpRecipient = getAddress(config.pool.lpRecipient);
    const pscAddress = getAddress(config.tokens.PSC);
    const wethAddress = getAddress(config.tokens.WETH);
    const pmAddress = getAddress(config.routers.nonfungiblePositionManager);
    const factoryAddress = getAddress(config.routers.factory);

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

    // 3. Sort Tokens & Calculate Exact Amounts (BigInt Standardized)
    const isPscToken0 = pscAddress.toLowerCase() < wethAddress.toLowerCase();
    const token0 = isPscToken0 ? pscAddress : wethAddress;
    const token1 = isPscToken0 ? wethAddress : pscAddress;

    const ethDesired = BigInt(parseEther(config.pool.liquidity.ethAmount).toString()); // 3.0 ETH
    const pscPerEth = BigInt(config.pool.liquidity.pscPerEth);                         // e.g., 100,000 PSC per 1 ETH
    const pscDesired = ethDesired * pscPerEth;                                         // Exact 18-decimal raw amount

    const amount0Desired = isPscToken0 ? pscDesired : ethDesired;
    const amount1Desired = isPscToken0 ? ethDesired : pscDesired;

    const sqrtPriceX96 = encodePriceSqrt(amount1Desired, amount0Desired);

    console.log(`  Token0               : ${token0} (${isPscToken0 ? "PSC" : "WETH"})`);
    console.log(`  Token1               : ${token1} (${isPscToken0 ? "WETH" : "PSC"})`);
    console.log(`  Initial Valuation    : 1 ETH = ${pscPerEth.toString()} PSC`);
    console.log(`  Target Deposit       : ${formatEther(ethDesired)} ETH + ${formatUnits(pscDesired, 18)} PSC`);
    console.log(`  Target sqrtPriceX96  : ${sqrtPriceX96.toString()}`);

    // 4. Pre-flight Balance Checks (ETH + Gas Buffer & PSC Balance)
    const rawEthBalance = await ethers.provider.getBalance(deployer.address);
    const ethBalance = BigInt(rawEthBalance.toString());
    const minRequiredEth = ethDesired + BigInt(parseEther("0.03").toString());

    if (ethBalance < minRequiredEth) {
        throw new Error(`Insufficient ETH! Balance: ${formatEther(ethBalance)} ETH, Required: ~${formatEther(minRequiredEth)} ETH`);
    }

    const ERC20_ABI = [
        "function balanceOf(address account) external view returns (uint256)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function approve(address spender, uint256 amount) external returns (bool)"
    ];
    const pscToken = new ethers.Contract(pscAddress, ERC20_ABI, deployer);
    const rawPscBalance = await pscToken.balanceOf(deployer.address);
    const pscBalance = BigInt(rawPscBalance.toString());

    if (pscBalance < pscDesired) {
        throw new Error(`Insufficient PSC! Balance: ${formatUnits(pscBalance, 18)}, Required: ${formatUnits(pscDesired, 18)}`);
    }

    // 5. Check Existing Pool State on Factory (Prevent Pre-Init Griefing / Price Manipulation)
    const FACTORY_ABI = ["function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"];
    const POOL_ABI = ["function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"];

    const factoryContract = new ethers.Contract(factoryAddress, FACTORY_ABI, deployer);
    const existingPoolAddress = await factoryContract.getPool(token0, token1, fee);

    if (existingPoolAddress !== ZeroAddress) {
        console.warn(`  Warning: Pool already exists at ${existingPoolAddress}. Verifying current slot0 price...`);
        const poolContract = new ethers.Contract(existingPoolAddress, POOL_ABI, deployer);
        const slot0 = await poolContract.slot0();
        const currentSqrtPrice = BigInt(slot0.sqrtPriceX96.toString());
        if (currentSqrtPrice !== 0n && currentSqrtPrice !== sqrtPriceX96) {
            throw new Error(
                `Security Abort: Pool is already initialized with a different sqrtPriceX96 (${currentSqrtPrice.toString()}) vs target (${sqrtPriceX96.toString()})!`
            );
        }
    }

    // 6. Idempotent PSC Token Approval (Only PSC; WETH is supplied natively via msg.value)
    const rawAllowance = await pscToken.allowance(deployer.address, pmAddress);
    const currentAllowance = BigInt(rawAllowance.toString());

    if (currentAllowance < pscDesired) {
        console.log("  Approving exact PSC token amount to NonfungiblePositionManager...");
        const approveTx = await pscToken.approve(pmAddress, pscDesired.toString());
        await approveTx.wait();
        console.log("  PSC approval confirmed.");
    } else {
        console.log("  Sufficient PSC allowance already granted.");
    }

    // 7. Build Atomic Multicall Payload ([createAndInitializePoolIfNecessary, mint, refundETH])
    const PositionManagerABI = [
        "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
        "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
        "function refundETH() external payable",
        "function multicall(bytes[] data) external payable returns (bytes[] results)",
        "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
    ];

    const pmContract = new ethers.Contract(pmAddress, PositionManagerABI, deployer);
    const poolInterface = createInterface(PositionManagerABI);

    const latestBlock = await ethers.provider.getBlock("latest");
    const deadline = Number(latestBlock.timestamp) + 1200; // 20 minutes buffer

    // 10,000 BPS Slippage Calculation
    const slippageBps = BigInt(config.pool.slippageBps);
    const amount0Min = (amount0Desired * (10000n - slippageBps)) / 10000n;
    const amount1Min = (amount1Desired * (10000n - slippageBps)) / 10000n;

    const createPoolData = poolInterface.encodeFunctionData("createAndInitializePoolIfNecessary", [
        token0,
        token1,
        fee,
        sqrtPriceX96.toString()
    ]);

    const mintParams = {
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        amount0Desired: amount0Desired.toString(),
        amount1Desired: amount1Desired.toString(),
        amount0Min: amount0Min.toString(),
        amount1Min: amount1Min.toString(),
        recipient: lpRecipient,
        deadline
    };

    const mintData = poolInterface.encodeFunctionData("mint", [mintParams]);
    const refundETHData = poolInterface.encodeFunctionData("refundETH", []);
    const multicallPayload = [createPoolData, mintData, refundETHData];

    // 8. StaticCall Dry-Run Verification (Compatible with both Ethers v5 & v6)
    console.log("  Simulating atomic multicall via staticCall...");
    const simResults = isEthersV6
        ? await pmContract.multicall.staticCall(multicallPayload, { value: ethDesired.toString() })
        : await pmContract.callStatic.multicall(multicallPayload, { value: ethDesired.toString() });

    const [simPoolAddress] = poolInterface.decodeFunctionResult("createAndInitializePoolIfNecessary", simResults[0]);
    const simMintDecoded = poolInterface.decodeFunctionResult("mint", simResults[1]);
    console.log(`  Simulation passed! Pool Address: ${simPoolAddress}, Expected TokenId: ${simMintDecoded.tokenId.toString()}`);

    // 9. Dynamic Gas Estimation & Atomic Broadcast (Compatible with both Ethers v5 & v6)
    let gasLimitWithBuffer = 3500000n;
    try {
        const rawEstimatedGas = isEthersV6
            ? await pmContract.multicall.estimateGas(multicallPayload, { value: ethDesired.toString() })
            : await pmContract.estimateGas.multicall(multicallPayload, { value: ethDesired.toString() });
        gasLimitWithBuffer = (BigInt(rawEstimatedGas.toString()) * 120n) / 100n;
    } catch (gasErr) {
        console.warn("  Gas estimation fallback to safe limit (3,500,000):", gasErr.message);
    }

    console.log(`  Broadcasting Atomic Multicall (Gas Limit: ${gasLimitWithBuffer.toString()})...`);
    const tx = await pmContract.multicall(multicallPayload, {
        value: ethDesired.toString(),
        gasLimit: gasLimitWithBuffer.toString()
    });

    console.log(`  Transaction Submitted: ${tx.hash}`);
    const receipt = await tx.wait();

    // 10. Parse Exact Mint Details from IncreaseLiquidity Event
    let mintedTokenId = simMintDecoded.tokenId.toString();
    let mintedLiquidity = simMintDecoded.liquidity.toString();
    let actualAmount0 = BigInt(simMintDecoded.amount0.toString());
    let actualAmount1 = BigInt(simMintDecoded.amount1.toString());

    for (const log of receipt.logs) {
        if (log.address && log.address.toLowerCase() === pmAddress.toLowerCase()) {
            try {
                const parsed = poolInterface.parseLog({
                    topics: [...log.topics],
                    data: log.data
                });
                if (parsed && parsed.name === "IncreaseLiquidity") {
                    mintedTokenId = parsed.args.tokenId.toString();
                    mintedLiquidity = parsed.args.liquidity.toString();
                    actualAmount0 = BigInt(parsed.args.amount0.toString());
                    actualAmount1 = BigInt(parsed.args.amount1.toString());
                }
            } catch (_) {
                // Ignore unrelated events on PositionManager
            }
        }
    }

    const actualPscLocked = isPscToken0 ? actualAmount0 : actualAmount1;
    const actualEthLocked = isPscToken0 ? actualAmount1 : actualAmount0;

    console.log(`  Confirmed in Block   : ${receipt.blockNumber}`);
    console.log(`  LP NFT Token ID      : ${mintedTokenId}`);
    console.log(`  Actual Locked Assets : ${formatEther(actualEthLocked)} ETH + ${formatUnits(actualPscLocked, 18)} PSC`);

    // 11. Save Structured JSON Audit Report
    const networkInfo = await ethers.provider.getNetwork();
    const chainIdStr = (networkInfo.chainId !== undefined ? networkInfo.chainId : "").toString();

    const reportData = {
        network: networkInfo.name || "unknown",
        chainId: chainIdStr,
        timestamp: new Date().toISOString(),
        deployer: deployer.address,
        lpRecipientLedger: lpRecipient,
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        poolAddress: simPoolAddress,
        poolParameters: {
            token0,
            token1,
            feeTier: fee,
            tickLower,
            tickUpper,
            sqrtPriceX96: sqrtPriceX96.toString()
        },
        positionDetails: {
            nftTokenId: mintedTokenId,
            liquidity: mintedLiquidity,
            ethLocked: formatEther(actualEthLocked),
            pscLocked: formatUnits(actualPscLocked, 18)
        }
    };

    const reportsDir = path.join(__dirname, "../reports");
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportFilePath = path.join(reportsDir, `uniswap-pool-audit-${receipt.blockNumber}.json`);
    fs.writeFileSync(reportFilePath, JSON.stringify(reportData, null, 2));
    console.log(`  Audit Report Saved   : ${reportFilePath}`);
    console.log("============================================================");
}

main().catch((error) => {
    console.error("Critical Deployment Failure:", error.message || error);
    process.exit(1);
});
