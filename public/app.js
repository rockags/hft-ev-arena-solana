// Solana Quant Arena v2 — Institutional HFT Execution Client
// Theme: Avantis / Drift / Hyperliquid Quant Terminal

// Ensure Buffer polyfill is bound for Solana Web3
if (typeof window !== 'undefined' && !window.Buffer && window.buffer && window.buffer.Buffer) {
  window.Buffer = window.buffer.Buffer;
  globalThis.Buffer = window.buffer.Buffer;
}

// Sanitize and isolate client identity
let rawSavedId = localStorage.getItem('quant_user_id');
if (!rawSavedId || rawSavedId.includes('3u6p') || rawSavedId === '3u6pHbfXqiDJLMxpLtXvUxGiC1Twwo2v9aaHBxo839GM') {
  localStorage.removeItem('quant_user_id');
  rawSavedId = `trader_${Math.random().toString(36).substring(2, 7)}`;
  localStorage.setItem('quant_user_id', rawSavedId);
}
let currentUserId = rawSavedId;
let balanceReal = 0.00;
let balanceDemo = 0.00;
let userRakeback = 0.00;
let phantomAddress = null;
let activeLeaderboardTab = 'REAL';
let cachedStats = null;
let activeVaultAddress = 'GCCfiWzgd29LuS63rCpBcwD1yko46TY4tsryCiihG9V3';

const consoleStream = document.getElementById('console-stream');
const userIdDisplay = document.getElementById('user-id-display');
const userRealBalanceDisplay = document.getElementById('user-real-balance');
const userDemoBalanceDisplay = document.getElementById('user-demo-balance');
const userRakebackDisplay = document.getElementById('user-rakeback-display');
const btnClaimRakeback = document.getElementById('btn-claim-rakeback');
const btnConnectWallet = document.getElementById('btn-connect-wallet');
const btnFaucet = document.getElementById('btn-faucet');
const serverSeedHashDisplay = document.getElementById('server-seed-hash');
const selectPlayMode = document.getElementById('select-play-mode');

userIdDisplay.textContent = currentUserId;

function addLog(msg, type = 'info') {
  const row = document.createElement('div');
  row.className = `log-row ${type}`;
  const time = new Date().toLocaleTimeString();
  row.innerHTML = `<span style="color:#64748b;font-variant-numeric:tabular-nums;">[${time}]</span> ${msg}`;
  consoleStream.prepend(row);
  if (consoleStream.children.length > 75) consoleStream.lastChild.remove();
}

// Connect to WebSocket Engine
let pingInterval = null;
let isFirstConnect = true;
let reconnectTimeout = null;

function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    if (isFirstConnect) {
      addLog("⚡ Connected to Solana Quant Arena HFT Engine (Sub-10ms WebSocket Cluster)", "info");
      isFirstConnect = false;
    }
    // Re-authenticate session
    ws.send(JSON.stringify({
      action: "auth",
      playerId: currentUserId
    }));

    // Client-side keepalive ping every 15s to keep proxy stream active
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "ping", timestamp: Date.now() }));
      }
    }, 15000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (e) {}
  };

  ws.onclose = () => {
    if (pingInterval) clearInterval(pingInterval);
    // Seamless silent auto-reconnect in 500ms
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connectWS, 500);
  };
}

function handleMessage(data) {
  switch (data.type) {
    case 'AUTH_SUCCESS':
      balanceReal = data.balanceReal || 0.00;
      balanceDemo = data.balanceDemo || 0.00;
      userRakeback = (data.rakebackReal || 0.00) + (data.rakebackDemo || 0.00);
      updateUserUI();
      if (data.serverSeedHash) {
        serverSeedHashDisplay.textContent = `Hash: ${data.serverSeedHash}`;
      }
      if (data.radar) updateRadarUI(data.radar);
      break;

    case 'RADAR_TICK':
      document.getElementById('metric-tps').textContent = `${data.rollsPerSecond || 0} orders/s`;
      document.getElementById('metric-bots').textContent = `${data.activeClients || 0} bots`;
      if (data.realStats) {
        document.getElementById('stat-real-volume').textContent = `$${data.realStats.realVolumeUSD.toFixed(2)} USD`;
        document.getElementById('stat-real-profit').textContent = `$${data.realStats.realFounderProfitUSD.toFixed(4)} USD`;
        document.getElementById('stat-real-deposits').textContent = `${data.realStats.verifiedDepositsCount} verified`;
      }
      if (data.demoStats) {
        document.getElementById('stat-demo-volume').textContent = `$${data.demoStats.demoVolumeUSD.toFixed(2)} USD`;
        document.getElementById('stat-demo-rolls').textContent = `${data.demoStats.demoRollsCount.toLocaleString()} orders`;
        document.getElementById('stat-demo-profit').textContent = `$${data.demoStats.demoFounderProfitUSD.toFixed(4)} USD`;
      }
      if (data.radar) updateRadarUI(data.radar);
      break;

    case 'REAL_DEPOSIT_CONFIRMED':
      addLog(`💰 <strong style="color:#00FFA3;">[MAINNET REAL 🟢]</strong> Verified On-Chain Deposit: +${data.amountSol} SOL (~$${data.amountUsd} USD) from ${data.sender.substring(0,6)}... | <a href="${data.explorerUrl}" target="_blank" style="color:#00F5FF;text-decoration:none;">View on Solscan ↗</a>`, "hit");
      if (data.sender === currentUserId) {
        balanceReal = data.balanceReal;
        updateUserUI();
      }
      fetchProtocolStats();
      break;

    case 'ORDER_RESULT':
      if (data.playerId === currentUserId) {
        balanceReal = data.balanceReal;
        balanceDemo = data.balanceDemo;
        userRakeback = data.rakebackAccumulated;
        updateUserUI();

        const badge = data.isReal ? `<span style="color:#00FFA3;font-weight:700;">[MAINNET REAL 🟢]</span>` : `<span style="color:#FFB800;">[SANDBOX 🟡]</span>`;

        if (data.hitType === 'MEGA_JACKPOT') {
          addLog(`🏆🏆🏆 MEGA JACKPOT HIT on ${data.tableName}! Won: +$${data.bonusWon.toFixed(2)} USD ${badge} (Order #${data.roll})`, "jackpot");
        } else if (data.hitType === 'MAJOR_HIT') {
          addLog(`💥 [MAJOR HIT 1%] ${data.tableName} | Order #${data.roll} -> +$${data.bonusWon.toFixed(2)} USD ${badge}`, "hit");
        } else if (data.hitType === 'MICRO_HIT') {
          addLog(`⚡ [MICRO-HIT 4%] ${data.tableName} | Order #${data.roll} -> +$${data.bonusWon.toFixed(2)} USD ${badge}`, "hit");
        } else {
          addLog(`⚡ Order filled on ${data.tableName} | #${data.roll} | Soft-Refund: $${data.payout.toFixed(4)} | Yield: +$${userRakeback.toFixed(4)} ${badge}`, "order");
        }
      }
      break;

    case 'BONUS_ALERT':
      const modeTag = data.isReal ? `[MAINNET 🟢]` : `[SANDBOX 🟡]`;
      addLog(`📢 GLOBAL ALERT ${modeTag}: ${data.winner} triggered ${data.hitType} on ${data.tableName} (+${data.amount.toFixed(2)} USD)`, "hit");
      break;

    case 'AUTO_REFUEL_ALERT':
      addLog(`🔄 AUTO-REFUEL: Injected liquidity reserve to Table ${data.tableKey.toUpperCase()}. Pot restored to $${data.newPot.toFixed(2)} USD`, "refuel");
      break;

    case 'RAKEBACK_CLAIMED':
      balanceReal = data.newBalanceReal;
      balanceDemo = data.newBalanceDemo;
      userRakeback = 0.00;
      updateUserUI();
      addLog(`💸 Yield settled: +$${(data.claimedReal + data.claimedDemo).toFixed(4)} USD credited to active balance`, "hit");
      break;
  }
}

function updateRadarUI(radar) {
  for (const [key, t] of Object.entries(radar)) {
    const potEl = document.getElementById(`pot-${key}`);
    const evEl = document.getElementById(`ev-${key}`);
    const statusEl = document.getElementById(`status-${key}`);

    if (potEl) potEl.textContent = `$${t.potUSD.toFixed(2)} USD`;
    if (evEl) {
      const isPos = t.evPercentage >= 0;
      evEl.textContent = `${isPos ? '+' : ''}${t.evPercentage.toFixed(1)}%`;
      evEl.className = `ev-percentage ${isPos ? 'text-green' : 'text-red'}`;
    }
    if (statusEl) {
      if (t.evPercentage > 100) {
        statusEl.textContent = '⚡ MAXIMUM +EV SURGE';
        statusEl.className = 'ev-status text-green';
      } else if (t.evPercentage >= 0) {
        statusEl.textContent = '🟢 POSITIVE ARBITRAGE ACTIVE';
        statusEl.className = 'ev-status text-cyan';
      } else {
        statusEl.textContent = '🔄 AUTO-REFUELING POT...';
        statusEl.className = 'ev-status text-gold';
      }
    }
  }
}

function updateUserUI() {
  userRealBalanceDisplay.textContent = `$${balanceReal.toFixed(2)} USD`;
  userDemoBalanceDisplay.textContent = `$${balanceDemo.toFixed(2)} USD`;
  userRakebackDisplay.textContent = `$${userRakeback.toFixed(4)} USD`;
  btnClaimRakeback.disabled = (userRakeback <= 0.0001);
}

// Trigger Order
window.triggerOrder = function(tableKey) {
  if (!ws || ws.readyState !== 1) {
    alert("Reconnecting to WebSocket HFT cluster...");
    return;
  }
  const minRequired = tableKey === 'flash' ? 0.10 : (tableKey === 'classic' ? 1.00 : 10.00);
  const selectedMode = selectPlayMode.value;

  if (selectedMode === 'REAL' && balanceReal < minRequired) {
    alert(`Insufficient REAL balance ($${balanceReal.toFixed(2)} USD). Click '💰 Deposit SOL' to fund your trading account.`);
    return;
  } else if (selectedMode === 'DEMO' && balanceDemo < minRequired) {
    alert(`Insufficient Sandbox balance. Click '💧 Sandbox Faucet' to allocate $25 in paper capital.`);
    return;
  } else if (selectedMode === 'AUTO' && (balanceReal < minRequired && balanceDemo < minRequired)) {
    alert(`Insufficient balance. Use '💧 Sandbox Faucet' for virtual testing, or '💰 Deposit SOL' for real executions.`);
    return;
  }

  ws.send(JSON.stringify({
    action: "order",
    table: tableKey,
    mode: selectedMode
  }));
};

// Claim Rakeback Yield
btnClaimRakeback.addEventListener('click', () => {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ action: "claim_rakeback" }));
  }
});

// Demo Sandbox Faucet
btnFaucet.addEventListener('click', async () => {
  btnFaucet.disabled = true;
  btnFaucet.textContent = "Allocating...";
  try {
    const res = await fetch('/api/deposit/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: currentUserId, amount: 25.00 })
    });
    const data = await res.json();
    if (data.success) {
      balanceDemo = data.balanceDemo;
      updateUserUI();
      addLog(`💧 Sandbox faucet activated: +$25.00 USD paper trading capital allocated`, "hit");
    }
  } catch (e) {
    alert("Error requesting faucet: " + e.message);
  } finally {
    btnFaucet.disabled = false;
    btnFaucet.textContent = "💧 Sandbox Faucet (+$25)";
  }
});

// Wallet Connection & Disconnect Handlers
const btnDisconnectWallet = document.getElementById('btn-disconnect-wallet');
const cashierDisconnectLink = document.getElementById('cashier-disconnect-link');

function setWalletConnectedState(pubKey) {
  phantomAddress = pubKey;
  currentUserId = pubKey;
  localStorage.setItem('quant_user_id', pubKey);
  userIdDisplay.textContent = `${pubKey.substring(0, 6)}...${pubKey.substring(pubKey.length - 4)}`;
  btnConnectWallet.innerHTML = `👻 ${pubKey.substring(0, 4)}...${pubKey.substring(pubKey.length - 4)}`;
  btnConnectWallet.classList.remove('btn-primary');
  btnConnectWallet.classList.add('btn-emerald');

  if (btnDisconnectWallet) btnDisconnectWallet.style.display = 'inline-flex';
  if (cashierDisconnectLink) cashierDisconnectLink.style.display = 'inline-block';

  if (cashierWalletLabel) {
    cashierWalletLabel.textContent = `👻 ${pubKey.substring(0, 6)}...${pubKey.substring(pubKey.length - 4)}`;
    cashierWalletLabel.style.color = 'var(--emerald)';
  }

  const destInput = document.getElementById('withdraw-dest-input');
  if (destInput && !destInput.value) {
    destInput.value = pubKey;
  }
}

window.disconnectPhantomWallet = async function() {
  if (window.phantom && window.phantom.solana) {
    try {
      await window.phantom.solana.disconnect();
    } catch (e) {}
  }
  phantomAddress = null;
  localStorage.removeItem('quant_user_id');
  currentUserId = `trader_${Math.random().toString(36).substring(2, 7)}`;
  localStorage.setItem('quant_user_id', currentUserId);

  userIdDisplay.textContent = currentUserId;
  btnConnectWallet.innerHTML = '👻 Connect Phantom';
  btnConnectWallet.classList.remove('btn-emerald');
  btnConnectWallet.classList.add('btn-primary');

  if (btnDisconnectWallet) btnDisconnectWallet.style.display = 'none';
  if (cashierDisconnectLink) cashierDisconnectLink.style.display = 'none';

  if (cashierWalletLabel) {
    cashierWalletLabel.textContent = 'Not connected';
    cashierWalletLabel.style.color = 'var(--cyan)';
  }

  const destInput = document.getElementById('withdraw-dest-input');
  if (destInput && destInput.value === phantomAddress) {
    destInput.value = '';
  }

  addLog('Phantom Wallet disconnected. Session reset to guest trader.', 'info');

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ action: "auth", playerId: currentUserId }));
  }
};

window.connectPhantomWallet = async function() {
  if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) {
    try {
      const resp = await window.phantom.solana.connect();
      const pubKey = resp.publicKey.toString();
      setWalletConnectedState(pubKey);
      addLog(`Phantom Wallet connected: ${pubKey}`, "hit");

      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ action: "auth", playerId: currentUserId }));
      }
    } catch (err) {
      alert("Phantom connection failed: " + err.message);
    }
  } else {
    alert("Solana Phantom Wallet not detected. Please install Phantom from phantom.app");
  }
};

if (btnConnectWallet) {
  btnConnectWallet.addEventListener('click', async () => {
    if (phantomAddress) {
      if (confirm(`Connected to Phantom:\n${phantomAddress}\n\nDo you want to disconnect / logout?`)) {
        disconnectPhantomWallet();
      }
      return;
    }
    await connectPhantomWallet();
  });
}

if (btnDisconnectWallet) {
  btnDisconnectWallet.addEventListener('click', () => {
    disconnectPhantomWallet();
  });
}

// Dynamic Rate & Previews
let solUsdRate = 105.00;

function updateInstantPreview() {
  const input = document.getElementById('instant-deposit-amount');
  const preview = document.getElementById('instant-usd-preview');
  const summaryCredited = document.getElementById('summary-credited-usd');
  if (!input) return;
  const val = parseFloat(input.value) || 0;
  const usd = (val * solUsdRate).toFixed(2);
  if (preview) preview.textContent = `≈ $${usd} USD`;
  if (summaryCredited) summaryCredited.textContent = `+$${usd} USD`;
}

function updateWithdrawPreview() {
  const input = document.getElementById('withdraw-amt-input');
  const estSol = document.getElementById('withdraw-sol-est');
  if (!input) return;
  const val = parseFloat(input.value) || 0;
  const sol = solUsdRate > 0 ? (val / solUsdRate).toFixed(4) : "0.0000";
  if (estSol) estSol.textContent = `~${sol} SOL`;
}

// Cashier Terminal Modal Handlers (Predict.fun Architecture)
const modalCashier = document.getElementById('modal-cashier');
const cashierWalletLabel = document.getElementById('cashier-wallet-label');
const vaultDepositInput = document.getElementById('vault-deposit-input');
const btnCopyVaultAddress = document.getElementById('btn-copy-vault-address');
const instantDepositAmount = document.getElementById('instant-deposit-amount');
const btnConfirmInstantDeposit = document.getElementById('btn-confirm-instant-deposit');
const withdrawAmtInput = document.getElementById('withdraw-amt-input');
const withdrawDestInput = document.getElementById('withdraw-dest-input');
const withdrawAvailableUsd = document.getElementById('withdraw-available-usd');
const btnSubmitWithdraw = document.getElementById('btn-submit-withdraw');
const btnOpenDeposit = document.getElementById('btn-open-deposit');
const btnWithdraw = document.getElementById('btn-withdraw');

window.switchCashierTab = function(tabName) {
  document.querySelectorAll('.cashier-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.cashier-view').forEach(view => view.classList.remove('active'));

  const targetBtn = document.getElementById(`tab-btn-${tabName}`);
  const targetView = document.getElementById(`view-${tabName}`);
  if (targetBtn) targetBtn.classList.add('active');
  if (targetView) targetView.classList.add('active');
};

window.openCashierModal = function(defaultTab = 'instant') {
  const cashierDisc = document.getElementById('cashier-disconnect-link');
  if (cashierWalletLabel) {
    if (phantomAddress) {
      cashierWalletLabel.textContent = `👻 ${phantomAddress.substring(0, 6)}...${phantomAddress.substring(phantomAddress.length - 4)}`;
      cashierWalletLabel.style.color = 'var(--emerald)';
      if (cashierDisc) cashierDisc.style.display = 'inline-block';
    } else {
      cashierWalletLabel.textContent = 'Not connected (1-click connects Phantom)';
      cashierWalletLabel.style.color = 'var(--cyan)';
      if (cashierDisc) cashierDisc.style.display = 'none';
    }
  }
  if (withdrawAvailableUsd) {
    withdrawAvailableUsd.textContent = `$${balanceReal.toFixed(2)} USD`;
  }
  if (phantomAddress && withdrawDestInput && !withdrawDestInput.value) {
    withdrawDestInput.value = phantomAddress;
  }
  updateInstantPreview();
  updateWithdrawPreview();
  switchCashierTab(defaultTab);
  if (modalCashier) modalCashier.classList.add('active');
};

window.closeCashierModal = function() {
  if (modalCashier) modalCashier.classList.remove('active');
};

// Aliases for backwards compatibility
window.closeDepositModal = window.closeCashierModal;
window.closeWithdrawModal = window.closeCashierModal;

window.setInstantDeposit = function(amountSol) {
  if (instantDepositAmount) {
    instantDepositAmount.value = amountSol.toFixed(2);
    updateInstantPreview();
  }
};

window.setWithdrawPercent = function(pct) {
  if (withdrawAmtInput) {
    const amt = Math.max(0, balanceReal * pct);
    withdrawAmtInput.value = amt.toFixed(2);
    updateWithdrawPreview();
  }
};

if (btnOpenDeposit) {
  btnOpenDeposit.addEventListener('click', () => openCashierModal('instant'));
}

if (btnWithdraw) {
  btnWithdraw.addEventListener('click', () => {
    if (balanceReal <= 0.05) {
      alert(`Your Real On-Chain balance is $${balanceReal.toFixed(2)} USD. Fund SOL to trade or withdraw accumulated earnings.`);
      return;
    }
    openCashierModal('withdraw');
  });
}

if (instantDepositAmount) {
  instantDepositAmount.addEventListener('input', updateInstantPreview);
}

if (withdrawAmtInput) {
  withdrawAmtInput.addEventListener('input', updateWithdrawPreview);
}

if (btnCopyVaultAddress) {
  btnCopyVaultAddress.addEventListener('click', () => {
    if (vaultDepositInput) {
      navigator.clipboard.writeText(vaultDepositInput.value);
      btnCopyVaultAddress.textContent = '✅ Copied!';
      setTimeout(() => { btnCopyVaultAddress.textContent = '📋 Copy Address'; }, 2000);
    }
  });
}

// 1-Click Phantom Deposit
window.quickDepositPhantom = async function(solAmount) {
  if (typeof window !== 'undefined' && !window.Buffer && window.buffer && window.buffer.Buffer) {
    window.Buffer = window.buffer.Buffer;
    globalThis.Buffer = window.buffer.Buffer;
  }

  if (!window.phantom || !window.phantom.solana || !window.phantom.solana.isPhantom) {
    alert("Please unlock or install Phantom Wallet from phantom.app");
    return;
  }

  const confirmBtn = document.getElementById('btn-confirm-instant-deposit');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Connecting & Preparing Transaction...";
  }

  try {
    if (!phantomAddress) {
      const resp = await window.phantom.solana.connect();
      setWalletConnectedState(resp.publicKey.toString());
    }

    if (typeof solanaWeb3 === 'undefined') {
      alert("Solana Web3 SDK is initializing. Please retry in 2 seconds.");
      return;
    }

    if (confirmBtn) {
      confirmBtn.textContent = "Sign in Phantom Wallet...";
    }

    addLog(`Initiating ${solAmount} SOL transfer via Phantom...`, "info");
    const connection = new solanaWeb3.Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const lamports = Math.floor(solAmount * 1e9);

    const transaction = new solanaWeb3.Transaction().add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey: new solanaWeb3.PublicKey(phantomAddress),
        toPubkey: new solanaWeb3.PublicKey(activeVaultAddress),
        lamports
      })
    );

    // Fetch latest blockhash reliably (fast server proxy with fallback)
    let blockhash;
    try {
      const bRes = await fetch('/api/blockhash');
      const bData = await bRes.json();
      if (bData.success && bData.blockhash) {
        blockhash = bData.blockhash;
      }
    } catch (e) {}

    if (!blockhash) {
      const latest = await connection.getLatestBlockhash('confirmed');
      blockhash = latest.blockhash;
    }

    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new solanaWeb3.PublicKey(phantomAddress);

    const { signature } = await window.phantom.solana.signAndSendTransaction(transaction);
    addLog(`🚀 Transaction broadcasted: ${signature.substring(0, 10)}... Awaiting on-chain confirmation...`, "hit");
    closeCashierModal();
  } catch (err) {
    alert("Transaction cancelled or failed: " + err.message);
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "⚡ Confirm & Deposit via Phantom";
    }
  }
};

if (btnConfirmInstantDeposit) {
  btnConfirmInstantDeposit.addEventListener('click', () => {
    const val = parseFloat(instantDepositAmount ? instantDepositAmount.value : '0.10') || 0.10;
    quickDepositPhantom(val);
  });
}

if (btnSubmitWithdraw) {
  btnSubmitWithdraw.addEventListener('click', async () => {
    const dest = withdrawDestInput.value.trim();
    const amt = parseFloat(withdrawAmtInput.value);

    if (!dest || dest.length < 32) {
      alert("Please provide a valid Solana address (32-44 base58 characters).");
      return;
    }
    if (isNaN(amt) || amt <= 0 || amt > balanceReal) {
      alert(`Invalid amount. Enter a value between $0.10 and $${balanceReal.toFixed(2)} USD.`);
      return;
    }

    btnSubmitWithdraw.disabled = true;
    btnSubmitWithdraw.textContent = "Broadcasting On-Chain Settlement...";

    try {
      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: currentUserId,
          destinationAddress: dest,
          amountUSD: amt
        })
      });
      const data = await res.json();
      if (data.success) {
        balanceReal = Math.max(0, balanceReal - amt);
        updateUserUI();
        addLog(`✅ On-Chain Settlement broadcasted: $${amt.toFixed(2)} USD sent to ${dest.substring(0, 6)}... | <a href="${data.explorerUrl}" target="_blank" style="color:#00F5FF;text-decoration:none;">View on Solscan ↗</a>`, "hit");
        alert("Settlement successful! Real SOL transaction broadcasted to Solana Mainnet.");
        closeCashierModal();
      } else {
        alert("Settlement error: " + (data.error || "Could not process request"));
      }
    } catch (e) {
      alert("Network communication error: " + e.message);
    } finally {
      btnSubmitWithdraw.disabled = false;
      btnSubmitWithdraw.textContent = "💸 Broadcast On-Chain Withdrawal";
    }
  });
}

// Leaderboard Tabs
window.switchLeaderboardTab = function(tab) {
  activeLeaderboardTab = tab;
  document.getElementById('tab-btn-real').className = `tab-btn ${tab === 'REAL' ? 'active' : ''}`;
  document.getElementById('tab-btn-demo').className = `tab-btn ${tab === 'DEMO' ? 'active' : ''}`;
  renderLeaderboard();
};

function renderLeaderboard() {
  if (!cachedStats) return;
  const tbody = document.getElementById('leaderboard-body');
  const bots = activeLeaderboardTab === 'REAL' ? cachedStats.topRealBots : cachedStats.topDemoBots;

  if (!bots || bots.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:1.5rem 0;">${activeLeaderboardTab === 'REAL' ? 'No real on-chain executions yet. Be the first to trade on Mainnet.' : 'Awaiting bot swarm execution data...'}</td></tr>`;
    return;
  }

  tbody.innerHTML = bots.map(b => {
    const isReal = activeLeaderboardTab === 'REAL';
    const rolls = isReal ? b.rollsReal : b.rollsDemo;
    const vol = isReal ? b.volumeReal : b.volumeDemo;
    const badge = isReal
      ? `<span class="badge-verified-onchain" style="color:#00FFA3;font-weight:700;">🟢 <a href="https://solscan.io/account/${b.id}" target="_blank" style="color:#00FFA3;text-decoration:none;">SOLSCAN ↗</a></span>`
      : `<span class="badge-demo-sandbox" style="color:#94A3B8;">🟡 SANDBOX</span>`;

    return `
      <tr>
        <td style="color:#00F5FF;font-weight:700;">${b.id.substring(0, 8)}...</td>
        <td>${rolls.toLocaleString()}</td>
        <td>$${vol.toFixed(2)}</td>
        <td style="color:#FFB800;">+$${b.rakebackReal.toFixed(4)}</td>
        <td>${badge}</td>
      </tr>
    `;
  }).join('');
}

// Fetch Stats periodically
async function fetchProtocolStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success) {
      cachedStats = data;
      if (data.vaultInfo && data.vaultInfo.sol !== undefined) {
        document.getElementById('vault-real-sol').textContent = `${data.vaultInfo.sol.toFixed(5)} SOL (~$${data.vaultInfo.usdEquivalent.toFixed(2)} USD)`;
        if (data.vaultInfo.solUsdRate) {
          solUsdRate = data.vaultInfo.solUsdRate;
          updateInstantPreview();
          updateWithdrawPreview();
        }
        if (data.vaultInfo.address) {
          activeVaultAddress = data.vaultInfo.address;
          if (vaultDepositInput) vaultDepositInput.value = data.vaultInfo.address;
          const qrCode = document.getElementById('vault-qr-code');
          if (qrCode) {
            qrCode.src = `https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=solana:${data.vaultInfo.address}`;
          }
          const auditLinks = document.querySelectorAll('.audit-link, .proof-links a[href*="solscan"], #footer-solscan-link');
          auditLinks.forEach(link => {
            link.href = `https://solscan.io/account/${data.vaultInfo.address}`;
          });
        }
      }
      if (data.realStats) {
        document.getElementById('stat-real-volume').textContent = `$${data.realStats.realVolumeUSD.toFixed(2)} USD`;
        document.getElementById('stat-real-profit').textContent = `$${data.realStats.realFounderProfitUSD.toFixed(4)} USD`;
        document.getElementById('stat-real-deposits').textContent = `${data.realStats.verifiedDepositsCount} verified`;
      }
      if (data.demoStats) {
        document.getElementById('stat-demo-volume').textContent = `$${data.demoStats.demoVolumeUSD.toFixed(2)} USD`;
        document.getElementById('stat-demo-rolls').textContent = `${data.demoStats.demoRollsCount.toLocaleString()} orders`;
        document.getElementById('stat-demo-profit').textContent = `$${data.demoStats.demoFounderProfitUSD.toFixed(4)} USD`;
      }
      renderLeaderboard();
    }
  } catch (e) {}
}

setInterval(fetchProtocolStats, 3000);
fetchProtocolStats();
connectWS();
