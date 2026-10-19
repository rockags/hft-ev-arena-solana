const fs = require('node:fs');
const path = require('node:path');
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  clusterApiUrl
} = require('@solana/web3.js');

// Persistent Master Vault Secret Key (Never lost on container restarts)
const EMBEDDED_VAULT_SECRET = [163,178,128,110,212,49,238,65,78,3,12,64,204,187,139,254,186,180,8,102,196,19,10,126,164,107,157,180,234,181,112,68,43,16,38,186,93,240,78,139,184,255,141,8,134,14,202,231,148,131,109,160,176,110,12,181,103,126,195,165,212,91,61,218];

const KEYPAIR_FILE = path.join(__dirname, '..', 'vault-keypair.json');
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'mainnet-beta';
const RPC_ENDPOINT = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
let SOL_USD_RATE = 105.35;
let LAST_RATE_SOURCE = 'Coinbase';

async function updateSolUsdRate() {
  // Source 1: Coinbase Spot (Ultra-low latency, US compliant)
  try {
    const res = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot');
    const data = await res.json();
    if (data && data.data && data.data.amount) {
      SOL_USD_RATE = Number(parseFloat(data.data.amount).toFixed(2));
      LAST_RATE_SOURCE = 'Coinbase';
      return;
    }
  } catch (e) {}

  // Source 2: Binance Ticker (Global market depth)
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
    const data = await res.json();
    if (data && data.price) {
      SOL_USD_RATE = Number(parseFloat(data.price).toFixed(2));
      LAST_RATE_SOURCE = 'Binance';
      return;
    }
  } catch (e) {}

  // Source 3: CoinGecko (Fallback)
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await res.json();
    if (data && data.solana && data.solana.usd) {
      SOL_USD_RATE = Number(data.solana.usd.toFixed(2));
      LAST_RATE_SOURCE = 'CoinGecko';
      return;
    }
  } catch (e) {}
}
updateSolUsdRate();
setInterval(updateSolUsdRate, 5000); // Live tick every 5 seconds

class SolanaVault {
  constructor() {
    this.network = SOLANA_NETWORK;
    this.connection = new Connection(RPC_ENDPOINT, 'confirmed');
    this.keypair = this.loadOrGenerateKeypair();
    this.processedSignatures = new Set();
    this.isWatching = false;
    this.onDeposit = null;
  }

  loadOrGenerateKeypair() {
    if (process.env.VAULT_SECRET_KEY) {
      try {
        const secretKey = Uint8Array.from(JSON.parse(process.env.VAULT_SECRET_KEY));
        const kp = Keypair.fromSecretKey(secretKey);
        console.log(`🔑 Loaded Solana Vault from VAULT_SECRET_KEY env: ${kp.publicKey.toBase58()}`);
        return kp;
      } catch (e) {}
    }

    if (fs.existsSync(KEYPAIR_FILE)) {
      try {
        const raw = fs.readFileSync(KEYPAIR_FILE, 'utf-8');
        const secretKey = Uint8Array.from(JSON.parse(raw));
        const kp = Keypair.fromSecretKey(secretKey);
        console.log(`🔑 Loaded existing Solana Vault Keypair: ${kp.publicKey.toBase58()}`);
        return kp;
      } catch (err) {
        console.error("Error reading vault keypair, using embedded key...", err.message);
      }
    }

    // Default to the persistent master keypair
    const kp = Keypair.fromSecretKey(Uint8Array.from(EMBEDDED_VAULT_SECRET));
    console.log(`🔑 Using Master Solana Vault Keypair: ${kp.publicKey.toBase58()}`);
    return kp;
  }

  getVaultAddress() {
    return this.keypair.publicKey.toBase58();
  }

  getSolUsdRate() {
    return SOL_USD_RATE;
  }

  getRateSource() {
    return LAST_RATE_SOURCE;
  }

  async getVaultBalance() {
    try {
      const lamports = await this.connection.getBalance(this.keypair.publicKey);
      const sol = lamports / LAMPORTS_PER_SOL;
      return {
        address: this.getVaultAddress(),
        network: SOLANA_NETWORK,
        lamports,
        sol,
        solUsdRate: SOL_USD_RATE,
        rateSource: LAST_RATE_SOURCE,
        usdEquivalent: sol * SOL_USD_RATE
      };
    } catch (err) {
      return { address: this.getVaultAddress(), sol: 0, error: err.message };
    }
  }

  // Request Devnet SOL for vault funding if needed
  async requestAirdrop(solAmount = 1) {
    return this.requestAirdropTo(this.keypair.publicKey.toBase58(), solAmount);
  }

  // Request Devnet SOL for any address (vault or user)
  async requestAirdropTo(recipientAddress, solAmount = 1) {
    try {
      const recipient = new PublicKey(recipientAddress);
      console.log(`💧 Requesting airdrop of ${solAmount} SOL to ${recipientAddress} on ${SOLANA_NETWORK}...`);
      const sig = await this.connection.requestAirdrop(
        recipient,
        solAmount * LAMPORTS_PER_SOL
      );
      const latestBlockhash = await this.connection.getLatestBlockhash();
      await this.connection.confirmTransaction({
        signature: sig,
        ...latestBlockhash
      });
      console.log(`✅ Airdrop confirmed! Tx: ${sig}`);
      return { success: true, signature: sig };
    } catch (err) {
      console.error("Airdrop error:", err.message);
      return { success: false, error: err.message };
    }
  }

  // Real-time watcher for incoming deposits on Solana
  startDepositWatcher(callback) {
    this.onDeposit = callback;
    if (this.isWatching) return;
    this.isWatching = true;

    console.log(`👀 Solana Deposit Watcher started on ${this.getVaultAddress()} (${SOLANA_NETWORK})`);

    // Poll every 3 seconds for new confirmed signatures
    setInterval(async () => {
      try {
        const signatures = await this.connection.getSignaturesForAddress(
          this.keypair.publicKey,
          { limit: 8 }
        );

        for (const sigInfo of signatures) {
          if (this.processedSignatures.has(sigInfo.signature)) continue;
          if (sigInfo.err) {
            this.processedSignatures.add(sigInfo.signature);
            continue;
          }

          // Fetch full parsed transaction
          const tx = await this.connection.getParsedTransaction(sigInfo.signature, {
            maxSupportedTransactionVersion: 0
          });

          if (!tx || !tx.meta) continue;

          // Check for incoming SOL transfer
          const vaultIndex = tx.transaction.message.accountKeys.findIndex(
            acc => (acc.pubkey ? acc.pubkey.toBase58() : acc.toBase58()) === this.getVaultAddress()
          );

          if (vaultIndex !== -1) {
            const preBalance = tx.meta.preBalances[vaultIndex] || 0;
            const postBalance = tx.meta.postBalances[vaultIndex] || 0;
            const netLamports = postBalance - preBalance;

            // If vault balance increased, it's an incoming deposit!
            if (netLamports > 5000) { // filter out dust/fees
              const solReceived = netLamports / LAMPORTS_PER_SOL;
              const usdAmount = Number((solReceived * SOL_USD_RATE).toFixed(2));
              
              // Sender is typically the first signer
              const senderKey = tx.transaction.message.accountKeys[0];
              const sender = senderKey.pubkey ? senderKey.pubkey.toBase58() : senderKey.toBase58();

              console.log(`\n💰 [ON-CHAIN DEPOSIT DETECTED!]`);
              console.log(`- From     : ${sender}`);
              console.log(`- Amount   : ${solReceived.toFixed(4)} SOL (≈ $${usdAmount.toFixed(2)} USD)`);
              console.log(`- Tx Sig   : ${sigInfo.signature}`);

              if (this.onDeposit) {
                this.onDeposit({
                  sender,
                  amountSol: solReceived,
                  amountUsd: usdAmount,
                  signature: sigInfo.signature,
                  timestamp: Date.now()
                });
              }
            }
          }

          this.processedSignatures.add(sigInfo.signature);
        }
      } catch (err) {
        // Silent RPC network hiccup ignore
      }
    }, 3000);
  }

  // Execute real on-chain withdrawal
  async withdrawSOL(destinationAddress, amountUSD) {
    try {
      const recipient = new PublicKey(destinationAddress);
      const solToSend = amountUSD / SOL_USD_RATE;
      const lamports = Math.floor(solToSend * LAMPORTS_PER_SOL);

      const vaultBal = await this.connection.getBalance(this.keypair.publicKey);
      if (vaultBal < lamports + 5000) {
        throw new Error(`Vault has insufficient SOL (${(vaultBal/LAMPORTS_PER_SOL).toFixed(4)} SOL). Please request faucet.`);
      }

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.keypair.publicKey,
          toPubkey: recipient,
          lamports
        })
      );

      const signature = await sendAndConfirmTransaction(this.connection, tx, [this.keypair]);
      console.log(`🚀 [ON-CHAIN WITHDRAWAL EXECUTED] ${amountUSD} USD (${solToSend.toFixed(4)} SOL) -> ${destinationAddress} | Tx: ${signature}`);

      return {
        success: true,
        signature,
        amountUSD,
        solSent: solToSend,
        explorerUrl: (SOLANA_NETWORK === 'mainnet-beta' || SOLANA_NETWORK === 'mainnet')
          ? `https://explorer.solana.com/tx/${signature}`
          : `https://explorer.solana.com/tx/${signature}?cluster=${SOLANA_NETWORK}`
      };
    } catch (err) {
      console.error("Withdrawal error:", err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = {
  SolanaVault,
  get SOL_USD_RATE() { return SOL_USD_RATE; },
  get LAST_RATE_SOURCE() { return LAST_RATE_SOURCE; }
};
