// ============================================================
// UNISWAP V3 CONFIGURATION — PSC/USDT (Modular Architecture)
// ============================================================

module.exports = {
    // ============================
    // Network Configuration
    // ============================
    networks: {
        mainnet: {
            name: "Ethereum Mainnet",
            chainId: 1,
            rpc: process.env.MAINNET_RPC_URL || "https://eth.llamarpc.com",
            factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
            positionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
            weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        },
        sepolia: {
            name: "Sepolia Testnet",
            chainId: 11155111,
            rpc: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
            factory: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",
            positionManager: "0x1238536071E1c677A632429e3655c799b22cDA52",
            weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
        },
    },

    // ============================
    // Token Configuration
    // ============================
    tokens: {
        usdt: {
            mainnet: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            sepolia: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", // USDT تستی روی سپولیا
        },
        psc: {
            // آدرس قرارداد PSCToken مستقر شده
            mainnet: process.env.PSC_MAINNET_ADDRESS || "",
            sepolia: process.env.PSC_SEPOLIA_ADDRESS || "",
        },
    },

    // ============================
    // Pool Configuration
    // ============================
    pool: {
        // کارمزد: 0.3٪ (مناسب برای جفت ارزهای نوسانی معیارهای استاندارد)
        fee: 3000,

        // قیمت اولیه: هر 1 PSC معادل 0.01 USDT (یعنی هر 1 USDT معادل 100 PSC)
        initialPricePSCInUSDT: "0.01",

        liquidity: {
            usdtAmount: "1000", // میزان USDT برای افزودن به نقدینگی اولیه
            pscAmount: "",      // به صورت خودکار بر اساس قیمت اولیه محاسبه می‌شود
        },

        // بازه تیک برای نقدینگی متمرکز (Full Range)
        tickLower: -887272,
        tickUpper: 887272,
    },
};