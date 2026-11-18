// ============================================================
// ULTIMATE ENTERPRISE UNISWAP V3 POOL CONFIGURATION — PSC / WETH
// ============================================================

require("dotenv").config();

module.exports = {
  pool: {
    fee: 3000,                          // 0.3% Fee Tier (tickSpacing = 60)
    tickSpacing: 60,
    tickLower: -887220,                 // Exact multiple of 60 for Full Range
    tickUpper: 887220,                  // Exact multiple of 60 for Full Range
    liquidity: {
      ethAmount: "3.0",                 // Fixed 3 ETH initial bootstrapping liquidity
      pscPerEth: "100000",             // Initial valuation ratio: 1 ETH = 100,000 PSC
    },
    slippageBps: 100,                   // Max 1.00% slippage (100 BPS out of 10,000)
    lpRecipient: process.env.LP_RECIPIENT_LEDGER_ADDRESS || "",
  },
  tokens: {
    PSC: process.env.PSC_TOKEN_ADDRESS || "",
    WETH: process.env.WETH_TOKEN_ADDRESS || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  routers: {
    nonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Official Uniswap V3 Mainnet Position Manager
    factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  }
};
