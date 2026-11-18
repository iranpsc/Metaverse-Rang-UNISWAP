# 🦄 Uniswap V3 Atomic Bootstrapper & LP Custody Protocol

This repository contains a professional automation suite designed to programmatically deploy, initialize, and bootstrap liquidity for the **Paradise Supply Chain (PSC)** token against **USDT** on **Uniswap V3**.

Paradise Supply Chain (PSC) & Metaverse Rang Ecosystem

An enterprise-grade, MEV-resistant atomic liquidity bootstrapping and institutional custody protocol designed for the PSC/WETH Uniswap V3 ecosystem.
---

📖 Table of Contents

    Overview

    Core Engineering Features

    Architecture & Security Measures

    Repository Structure

    Pool Specification

    Installation & Environment Setup

    Execution & Testing Guide

    Audit & Automated Reporting

    Author & Maintainer

🧐 Overview

The Uniswap V3 Atomic Bootstrapper is a high-security automated liquidity deployment framework engineered for the Paradise Supply Chain (PSC) and Metaverse Rang ecosystem.

Deploying initial liquidity (Bootstrapping Liquidity) to Uniswap V3 typically exposes protocols to severe MEV exploits (sandwich attacks) during the gap between pool creation, price initialization, and position minting. This repository solves these critical vectors by executing all deployment phases within a single, unbreakable atomic transaction on Ethereum Mainnet.


⚡ Core Engineering Features

    🛡️ MEV-Immune Atomic Execution: Combines pool creation (createAndInitializePoolIfNecessary), price initialization, and liquidity minting (mint) into a single atomic payload using Uniswap's multicall.

    🔢 Exact Q64.96 BigInt Mathematics: Eliminates JavaScript floating-point precision errors during sqrtPriceX96 calculation using native BigInt implementations.

    🌐 Universal Ethers SDK Compatibility: Fully compatible with both Ethers.js v5 and Ethers.js v6 execution environments.

    🔒 Institutional LP Custody: Automatically locks and assigns the minted ERC-721 LP Position NFT directly to the employer's hardware wallet (Ledger / Multi-Sig Treasury).

    🧪 Pre-flight Dry-Run Simulation: Executes a local staticCall simulation prior to broadcasting on-chain to catch revert conditions early and save gas fees.

    📊 Automated JSON Audit Logging: Automatically compiles and stores a cryptographically verifiable deployment audit report in reports/ upon success.


    🛡️ Architecture & Security MeasuresVulnerability VectorRisk LevelMitigation Strategy in CodeFront-Running / Sandwich Attacks🔴 CriticalAtomic multicall prevents third-party insertion between init and mint [cite: 22].Floating-Point Math Inaccuracy🔴 CriticalReplaced parseFloat with custom BigInt square root encoder (sqrtBigInt) [cite: 21, 34].Tick Spacing Revert (TLU/TLM)🟠 HighEnforced strict validation ensuring ticks are exact multiples of tickSpacing (60).Slippage Exploitation🟠 HighImplemented strict 100 BPS (1%) boundaries (amount0Min, amount1Min).Dust Loss / Stuck ETH🟡 MediumAppended Uniswap's native refundETH() function to the atomic execution queue.Pre-Initialization Griefing🟡 MediumFactory pre-check validates existing pool state against target sqrtPriceX96.



├── contracts/                   # Smart contract artifacts and interfaces
├── scripts/
│   ├── uniswap-config.js        # Centralized pool parameters and router addresses
│   └── deploy-uniswap-pool.js   # Production atomic deployment and liquidity script
├── test/
│   └── uniswap-pool.fork.test.js# Automated Hardhat Mainnet Fork integration test
├── reports/                     # Automatically generated JSON audit logs
├── .env.example                 # Template for secure environment variables
└── package.json                 # Project dependencies & Hardhat configurations



⚙️ Pool Specification

    Trading Pair: PSC / WETH [cite: 5, 53]

    Fee Tier: 3000 (0.3% fee tier with tickSpacing = 60) [cite: 51]

    Liquidity Range: Full Range (tickLower = -887220, tickUpper = 887220) [cite: 52]

    Initial Capital: Exactly 3.0 ETH paired with corresponding PSC based on target valuation [cite: 70, 209].


📥 Installation & Environment Setup
1. Clone the Repository
    git clone https://github.com/iranpsc/Metaverse-Rang-UNISWAP.git
cd Metaverse-Rang-UNISWAP

2. Install Dependencies
npm install

3. Configure Environment Variables

Copy the template .env.example to .env and fill in your secure parameters:
cp .env.example .env



MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_API_KEY
PRIVATE_KEY=your_deployer_wallet_private_key_here
PSC_TOKEN_ADDRESS=your_deployed_psc_token_address_here
WETH_TOKEN_ADDRESS=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
LP_RECIPIENT_LEDGER_ADDRESS=your_hardware_ledger_or_multisig_address_here


🚀 Execution & Testing Guide
Running Automated Fork Tests

Verify price accuracy (slot0), locked asset quantities, and Ledger custody assignment:


npx hardhat test test/uniswap-pool.fork.test.js --network hardhat


Local Dry-Run Simulation

Simulate the deployment transaction locally without broadcasting to the live network:
npx hardhat run scripts/deploy-uniswap-pool.js --network localhost

Mainnet Production Deployment

Execute the atomic bootstrapper on Ethereum Mainnet:
npx hardhat run scripts/deploy-uniswap-pool.js --network mainnet

📊 Audit & Automated Reporting

Upon successful execution, the script generates a timestamped JSON audit log inside the reports/ directory containing:

    Transaction Hash & Block Number [cite: 76]

    Exact Gas Units Consumed [cite: 76]

    Verified Pool Contract Address [cite: 76]

    Minted LP NFT Token ID & Liquidity Units [cite: 76]

    Locked Asset Amounts (ETH & PSC) [cite: 76]

 ✍️ Author & Maintainer

Parsa Abolhasani Rad

Senior Full-Stack Blockchain Developer & Smart Contract Architect [cite: 76]

    Member of the Iran Blockchain Association [cite: 76]

Protected under the MIT Open-Source License.   

    
