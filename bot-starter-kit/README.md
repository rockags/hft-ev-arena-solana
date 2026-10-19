# ⚡ Solana Quant Multi-Table Sniper Kit (Python)

Official Starter Kit for the **Solana Quant Arena** High-Frequency Trading Protocol.

## 🚀 Quickstart

1. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Run Latency Benchmark (`--bench`):**
   Measure your real round-trip WebSocket latency to the matching engine:
   ```bash
   python multi_table_sniper.py --bench
   ```

3. **Run Paper Trading Sandbox (`--demo`):**
   Test the multi-table arbitrage algorithm with $25 USD in simulated capital:
   ```bash
   python multi_table_sniper.py --demo
   ```

4. **Run Live Autonomous Sniper:**
   ```bash
   python multi_table_sniper.py
   ```

---

## 🎯 Multi-Table Architecture

| Table | Price | Soft-Refund | Friction | Target Style |
| :--- | :--- | :--- | :--- | :--- |
| **FLASH** | **$0.10** | $0.0998 | $0.0002 (0.2%) | Ultra-rapid micro-orders |
| **CLASSIC** | **$1.00** | $0.998 | $0.0020 (0.2%) | High-throughput volume |
| **WHALE** | **$10.00** | $9.980 | $0.0200 (0.2%) | Mega-Jackpot hunting |

---

## 🛡️ Provably Fair Offline Verification

Every roll is computed deterministically using HMAC-SHA256:
```python
import hmac, hashlib
hash_val = hmac.new(server_seed.encode(), f"{client_seed}:{nonce}".encode(), hashlib.sha256).hexdigest()
roll = int(hash_val[:8], 16) % 1000
```
* **Roll 777:** Mega Jackpot (0.1% odds).
* **Roll ending in 77:** Major Hit (0.9% odds).
* **Roll multiple of 25:** Micro Hit (4.0% odds).
