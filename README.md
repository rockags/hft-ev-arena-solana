<div align="center">

# ⚡ SOLANA QUANT ARENA v2 ⚡
### Autonomous High-Frequency Expected Value (+EV) Protocol & Multi-Table Swarm Engine

[![Solana](https://img.shields.io/badge/Solana-Mainnet%20%26%20Devnet-14F195?logo=solana&logoColor=black)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.30.1-5c6ac4)](https://www.anchor-lang.com)
[![Release](https://img.shields.io/badge/Release-v2.1.0-blueviolet)](https://github.com/rockags/hft-ev-arena-solana/releases)
[![Latency](https://img.shields.io/badge/Latency-Sub--8ms-00C7B7)](https://github.com/rockags/hft-ev-arena-solana)
[![Provably Fair](https://img.shields.io/badge/Provably%20Fair-HMAC--SHA256-blue)](https://github.com/rockags/hft-ev-arena-solana)
[![Non-Custodial](https://img.shields.io/badge/Custody-100%25%20PDA%20Escrow-green)](https://github.com/rockags/hft-ev-arena-solana)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

*An open-source quantitative liquidity protocol engineered for high-frequency bots, algorithmic traders, and Solana developers.*

[Quickstart](#-quickstart) • [Multi-Table Architecture](#-multi-table-architecture) • [Mathematical Proof](#-mathematical-proof--ev) • [Non-Custodial Anchor Contract](#-non-custodial-anchor-smart-contract) • [Bot Starter Kit](#-bot-starter-kit-python)

</div>

---

## 💡 Overview

Most bot developers on Solana lose capital to toxic MEV sandwiches, gas wars, and liquidity rug-pulls. 

**Solana Quant Arena** inverts this dynamic by introducing a **Provably Fair, Non-Custodial Multi-Table Protocol** engineered around positive mathematical expected value (+EV) and extreme capital longevity:
* **99.8% Soft-Refund Guarantee:** Every non-winning round refunds **99.8% of capital** ($0.002 fee on $1.00 orders). A $5.00 deposit provides **over 2,500 continuous execution rounds**.
* **Autonomous Multi-Table Arbitrage:** 3 concurrent tables (Flash, Classic, Whale) with variable jackpot velocities and live +EV telemetry.
* **Perpetual +EV via Auto-Refuel:** Accumulated friction fees automatically refill depleted prize pots, ensuring the expected return remains permanently positive (`+120% ... +240% EV`).
* **Direct Rakeback Cashback:** 20% of all friction fees are returned directly to active bot accounts as instant cashback.
* **100% Non-Custodial PDA Architecture:** Player funds live strictly inside Program Derived Addresses on Solana with unconstrained `withdraw()` functionality.

---

## 🎯 Multi-Table Architecture

```mermaid
flowchart TD
    Bot["🤖 Quantitative Bot Swarm (Python / Rust)"] --> Radar["📡 Real-Time +EV Radar Feed (WebSocket)"]
    
    Radar -->|Routes to highest EV| T1["⚡ MESA 1: FLASH ($0.10)
    • Soft-Refund: $0.0998
    • Micro Blitz Jackpot (50%)
    • Optimal for high-frequency testing"]
    
    Radar -->|Routes to highest EV| T2["⚖️ MESA 2: CLASSIC ($1.00)
    • Soft-Refund: $0.998
    • Standard Arena Jackpot (75%)
    • 4% Micro-Hits & 0.9% Major-Hits"]
    
    Radar -->|Routes to highest EV| T3["🐋 MESA 3: WHALE ($10.00)
    • Soft-Refund: $9.98
    • Mega Syndicate Jackpot (100%)
    • Deepest EV Return (+240%)"]

    T1 & T2 & T3 --> Fees["⚙️ Automated Fee Split Engine"]
    
    Fees -->|35%| Founder["💰 Founder Treasury"]
    Fees -->|35%| Cushion["🔄 Auto-Refuel Stabilization Cushion"]
    Fees -->|20%| Rakeback["💸 Direct Rakeback Cashback to Bots"]
    Fees -->|10%| Leaderboard["🏆 Weekly Epoch Leaderboard Pool"]
    
    Cushion -.->|Restores depleted pots automatically| T1 & T2 & T3
```

---

## 📊 Mathematical Proof (+EV)

Every round computes an offline-verifiable HMAC-SHA256 roll between `0` and `999` (1,000 discrete outcomes):
* **0.1% Odds (Roll = 777):** Mega Jackpot (50% to 100% of Table Pot).
* **0.9% Odds (Roll % 100 == 77):** Major Hit (5% to 8% of Table Pot).
* **4.0% Odds (Roll % 25 == 0):** Micro Hit (1% to 1.5% of Table Pot).
* **5.0% Total Winning Rounds / 95.0% Soft-Refund Rounds.**

### The Deterministic Expected Value Formula:
$$\mathbb{E}[\text{Bonus}] = (0.040 \times B_{\text{micro}} \times \text{Pot}) + (0.009 \times B_{\text{major}} \times \text{Pot}) + (0.001 \times B_{\text{jackpot}} \times \text{Pot})$$

$$\text{EV Factor (\%)} = \left( \frac{\mathbb{E}[\text{Bonus Payout}]}{\text{Friction Cost}} - 1 \right) \times 100$$

Whenever the pot crosses the floor threshold, **the mathematical expected return turns overwhelmingly positive for the bot**.

---

## 🚀 Quickstart

### 1. Launch the Engine & Web Terminal
```bash
cd server
npm install
npm start
```
Open your browser at `http://localhost:8080` to access the live Bloomberg-style quantitative radar.

### 2. Run the Autonomous Bot Kit
```bash
cd bot-starter-kit
pip install -r requirements.txt

# Measure round-trip ping latency
python multi_table_sniper.py --bench

# Run zero-risk paper trading simulation ($25 virtual capital)
python multi_table_sniper.py --demo

# Run autonomous multi-table live sniper (Auto-funded with $25.00 sandbox credits on connection)
python multi_table_sniper.py
```

---

## 🛡️ Non-Custodial Anchor Smart Contract

The Solana program is located at `programs/quant-arena/`:
* **Zero Private Key Risk:** No human holds access to protocol balances.
* **Unconditional User Withdrawal:**
  ```rust
  pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
      let user_escrow = &mut ctx.accounts.user_escrow;
      require!(user_escrow.balance_lamports >= amount, ArenaError::InsufficientBalance);
      // Immediate non-custodial transfer from Program PDA back to user wallet
      ...
  }
  ```

---

## 📜 License
Distributed under the MIT License. Open-source and free for developers, quants, and the Solana community.
