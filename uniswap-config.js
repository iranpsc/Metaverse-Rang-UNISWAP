// ============================================================
// UNISWAP V3 POOL CONFIGURATION — PSC / WETH ECOSYSTEM
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
      pscPerEth: "100000",             // Initial ratio: 1 ETH = 100,000 PSC
    },
    slippageBps: 100,                   // Max 1.00% slippage (min amount = 99% of desired)
    lpRecipient: process.env.LP_RECIPIENT_LEDGER_ADDRESS || "0xYOUR_LEDGER_OR_MULTISIG_ADDRESS",
  },
  // Network RPC & Router Addresses (Ethereum Mainnet / Sepolia)
  tokens: {
    PSC: process.env.PSC_TOKEN_ADDRESS || "",
    WETH: process.env.WETH_TOKEN_ADDRESS || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // Mainnet WETH
  },
  routers: {
    nonfungiblePositionManager: "0xC36442b4a4522FB871190453e043640b68b224f6",
    factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  }
};