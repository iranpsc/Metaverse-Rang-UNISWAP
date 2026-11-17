Uniswap V3 Pool Deployment & Liquidity Suite (PSC/USDT)

This repository contains a professional automation suite designed to programmatically deploy, initialize, and bootstrap liquidity for the Paradise Supply Chain (PSC) token against USDT on Uniswap V3.

🎯 Purpose & Why It ExistsBootstrapping liquidity on decentralized exchanges (DEXs) like Uniswap V3 requires precise mathematical computations (such as calculating sqrtPriceX96 for concentrated liquidity ranges), strict token sorting (token0 < token1), and multi-step transaction handling (Factory creation $\rightarrow$ Pool Initialization $\rightarrow$ Token Approvals $\rightarrow$ Position Minting).This suite automates the entire bootstrapping lifecycle, ensuring that the PSC token market is established with exact parameters, correct pricing, and zero human error during deployment.

🛠️ Architecture & Components

The suite consists of two core files:

    uniswap-config.js:

        Centralized configuration registry containing network parameters (Mainnet & Sepolia), official Uniswap V3 contract addresses (Factory, NonfungiblePositionManager, WETH), token mappings, and pool specifications (fee tiers, initial target price, liquidity amounts, and tick ranges).

    deploy-uniswap-pool.js:

        The execution engine built with ethers.js. It performs the following sequential actions:

            Validates network configuration and deployer balances.

            Verifies or creates the Uniswap V3 pool for the PSC/USDT pair at the specified fee tier (default: 0.3%).

            Calculates precision-adjusted sqrtPriceX96 based on the configured initial price (e.g., 1 PSC = 0.01 USDT).

            Initializes the pool if uninitialized.

            Computes required token ratios, handles token approvals for the Position Manager, and mints the initial liquidity position (Full Range or custom ticks).

            Exports a comprehensive deployment summary JSON file (deployment-uniswap-<network>.json).


      📋 Prerequisites

Before running the scripts, ensure you have the following installed and configured:

    Node.js (v16+ recommended)

    Hardhat environment

    An active RPC URL for your target network (Ethereum Mainnet or Sepolia Testnet)

    A deployer wallet funded with native ETH (for gas) and sufficient PSC & USDT tokens.


    ⚙️ Configuration Guide

Modify uniswap-config.js to adjust your pool parameters:

pool: {
    fee: 3000,                          // Fee tier: 3000 (0.3%), 500 (0.05%), 10000 (1%)
    initialPricePSCInUSDT: "0.01",      // Target initial price: 1 PSC = 0.01 USDT
    liquidity: {
        usdtAmount: "1000",             // Amount of USDT to supply in the initial position
    },
    tickLower: -887272,                 // Lower tick boundary (-887272 to 887272 for full range)
    tickUpper: 887272,                  // Upper tick boundary
}


🚀 Usage & Execution
1. Set Environment Variables

Create a .env file in the root of your project and populate the required keys:

MAINNET_RPC_URL=https://eth.llamarpc.com
SEPOLIA_RPC_URL=https://rpc.sepolia.org
PRIVATE_KEY=your_deployer_wallet_private_key_here
PSC_MAINNET_ADDRESS=0x_your_deployed_psc_mainnet_address
PSC_SEPOLIA_ADDRESS=0x_your_deployed_psc_sepolia_address

2. Run the Deployment Script

Execute the script via Hardhat targeting your desired network (default is sepolia):
npx hardhat run scripts/deploy-uniswap-pool.js --network sepolia
Or by setting the NETWORK environment variable explicitly:
NETWORK=mainnet npx hardhat run scripts/deploy-uniswap-pool.js

📄 Output Artifacts

Upon successful execution, the script generates a deployment receipt log in the root directory:

    deployment-uniswap-<network>.json: Contains the pool address, resolved token0 and token1, fee tier, initial price, added token amounts, and the mint transaction hash for verification on Etherscan/Sepolia Etherscan.

🔒 Security & Best Practices

    No Fee-on-Transfer Risks: Designed specifically to interface cleanly with standard ERC-20 tokens like PSCToken.

    Allowance Checks: Automatically checks existing token allowances before broadcasting redundant approval transactions to save gas.

    Slippage Protection: Implements configurable deadlines on mint transactions.
    
