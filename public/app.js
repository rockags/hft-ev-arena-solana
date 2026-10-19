// Solana Quant Arena v2 — Frontend Engine Client (Strict Real vs Demo Partition)

// Purge any stale compromised or legacy addresses from browser localStorage
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
  row.innerHTML = `<span style="color:#64748b;">[${time}]</span> ${msg}`;
  consoleStream.prepend(row);
  if (consoleStream.children.length > 70) consoleStream.lastChild.remove();
}

// Connect to WebSocket Engine
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    addLog("✅ Conectado al motor HFT de Solana Quant Arena", "info");
    ws.send(JSON.stringify({
      action: "auth",
      playerId: currentUserId
    }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (e) {}
  };

  ws.onclose = () => {
    addLog("⚠️ Conexión perdida con el motor. Reconectando en 2s...", "info");
    setTimeout(connectWS, 2000);
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
      document.getElementById('metric-tps').textContent = `${data.rollsPerSecond || 0} tiradas/s`;
      document.getElementById('metric-bots').textContent = `${data.activeClients || 0} bots`;
      if (data.realStats) {
        document.getElementById('stat-real-volume').textContent = `$${data.realStats.realVolumeUSD.toFixed(2)} USD`;
        document.getElementById('stat-real-profit').textContent = `$${data.realStats.realFounderProfitUSD.toFixed(4)} USD`;
        document.getElementById('stat-real-deposits').textContent = `${data.realStats.verifiedDepositsCount} depósitos`;
      }
      if (data.demoStats) {
        document.getElementById('stat-demo-volume').textContent = `$${data.demoStats.demoVolumeUSD.toFixed(2)} USD`;
        document.getElementById('stat-demo-rolls').textContent = `${data.demoStats.demoRollsCount.toLocaleString()} tiradas`;
        document.getElementById('stat-demo-profit').textContent = `$${data.demoStats.demoFounderProfitUSD.toFixed(4)} USD`;
      }
      if (data.radar) updateRadarUI(data.radar);
      break;

    case 'REAL_DEPOSIT_CONFIRMED':
      addLog(`💰 <strong style="color:#34d399;">[MAINNET REAL 🟢]</strong> Depósito confirmado: +${data.amountSol} SOL (~$${data.amountUsd} USD) de ${data.sender.substring(0,6)}... | <a href="${data.explorerUrl}" target="_blank" style="color:#38bdf8;">Ver en Solscan ↗</a>`, "hit");
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

        const badge = data.isReal ? `<span style="color:#34d399;font-weight:700;">[MAINNET REAL 🟢]</span>` : `<span style="color:#fbbf24;">[DEMO 🟡]</span>`;

        if (data.hitType === 'MEGA_JACKPOT') {
          addLog(`🏆🏆🏆 ¡¡¡MEGA JACKPOT EN ${data.tableName}!!! Ganaste: +$${data.bonusWon.toFixed(2)} USD ${badge} (Roll #${data.roll})`, "jackpot");
        } else if (data.hitType === 'MAJOR_HIT') {
          addLog(`💥 [MAJOR HIT 1%] ${data.tableName} | Roll #${data.roll} -> +$${data.bonusWon.toFixed(2)} USD ${badge}`, "hit");
        } else if (data.hitType === 'MICRO_HIT') {
          addLog(`⚡ [MICRO-HIT 4%] ${data.tableName} | Roll #${data.roll} -> +$${data.bonusWon.toFixed(2)} USD ${badge}`, "hit");
        } else {
          addLog(`⚡ Orden en ${data.tableName} | Roll #${data.roll} | Soft-Refund: $${data.payout.toFixed(4)} | Rakeback: +$${userRakeback.toFixed(4)} ${badge}`, "order");
        }
      }
      break;

    case 'BONUS_ALERT':
      const modeTag = data.isReal ? `[MAINNET 🟢]` : `[DEMO 🟡]`;
      addLog(`📢 ALERTA GLOBAL ${modeTag}: ${data.winner} sacó ${data.hitType} en ${data.tableName} (+${data.amount.toFixed(2)} USD)`, "hit");
      break;

    case 'AUTO_REFUEL_ALERT':
      addLog(`🔄 AUTO-REFUEL: Reinyectada liquidez a Mesa ${data.tableKey.toUpperCase()}. Bote restaurado a $${data.newPot.toFixed(2)} USD`, "refuel");
      break;

    case 'RAKEBACK_CLAIMED':
      balanceReal = data.newBalanceReal;
      balanceDemo = data.newBalanceDemo;
      userRakeback = 0.00;
      updateUserUI();
      addLog(`💸 Rakeback reclamado: +$${(data.claimedReal + data.claimedDemo).toFixed(4)} USD`, "hit");
      break;
  }
}

function updateRadarUI(radar) {
  for (const [key, t] of Object.entries(radar)) {
    const potEl = document.getElementById(`pot-${key}`);
    const evEl = document.getElementById(`ev-${key}`);
    if (potEl) potEl.textContent = `$${t.potUSD.toFixed(2)} USD`;
    if (evEl) {
      evEl.textContent = `${t.evPercentage >= 0 ? '+' : ''}${t.evPercentage.toFixed(1)}%`;
      evEl.className = `ev-percentage ${t.evPercentage >= 0 ? 'text-green' : 'text-red'}`;
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
    alert("Reconectando al servidor WebSocket...");
    return;
  }
  const minRequired = tableKey === 'flash' ? 0.10 : (tableKey === 'classic' ? 1.00 : 10.00);
  const selectedMode = selectPlayMode.value;

  if (selectedMode === 'REAL' && balanceReal < minRequired) {
    alert(`Saldo REAL insuficiente ($${balanceReal.toFixed(2)} USD). Fondea SOL a tu wallet.`);
    return;
  } else if (selectedMode === 'DEMO' && balanceDemo < minRequired) {
    alert(`Saldo DEMO insuficiente. Haz clic en '💧 Faucet Demo' para cargar $25 virtuales.`);
    return;
  } else if (selectedMode === 'AUTO' && (balanceReal < minRequired && balanceDemo < minRequired)) {
    alert(`Saldo insuficiente. Puedes usar el botón '💧 Faucet Demo' para pruebas virtuales.`);
    return;
  }

  ws.send(JSON.stringify({
    action: "order",
    table: tableKey,
    mode: selectedMode
  }));
};

// Claim Rakeback
btnClaimRakeback.addEventListener('click', () => {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ action: "claim_rakeback" }));
  }
});

// Demo Faucet
btnFaucet.addEventListener('click', async () => {
  btnFaucet.disabled = true;
  btnFaucet.textContent = "Cargando...";
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
      addLog(`💧 Faucet activado: +$25.00 USD virtuales cargados en Balance Demo`, "hit");
    }
  } catch (e) {
    alert("Error al cargar faucet: " + e.message);
  } finally {
    btnFaucet.disabled = false;
    btnFaucet.textContent = "💧 Faucet Demo (+$25)";
  }
});

// Connect Phantom Wallet
btnConnectWallet.addEventListener('click', async () => {
  if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) {
    try {
      const resp = await window.phantom.solana.connect();
      phantomAddress = resp.publicKey.toString();
      currentUserId = phantomAddress;
      localStorage.setItem('quant_user_id', currentUserId);
      userIdDisplay.textContent = `${phantomAddress.substring(0, 6)}...${phantomAddress.substring(phantomAddress.length - 4)}`;
      btnConnectWallet.textContent = `👻 ${phantomAddress.substring(0, 4)}...`;
      addLog(`Phantom conectada: ${phantomAddress}`, "hit");

      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ action: "auth", playerId: currentUserId }));
      }
    } catch (err) {
      alert("Error al conectar Phantom: " + err.message);
    }
  } else {
    alert("No se detectó Phantom Wallet. Puedes instalarla desde phantom.app");
  }
});

// Active Vault Address
let activeVaultAddress = 'GCCfiWzgd29LuS63rCpBcwD1yko46TY4tsryCiihG9V3';

// Deposit Modal Handlers
const modalDeposit = document.getElementById('modal-deposit');
const btnOpenDeposit = document.getElementById('btn-open-deposit');
const btnCopyVaultAddress = document.getElementById('btn-copy-vault-address');
const vaultDepositInput = document.getElementById('vault-deposit-input');

if (btnOpenDeposit) {
  btnOpenDeposit.addEventListener('click', () => {
    modalDeposit.classList.add('active');
  });
}

window.closeDepositModal = function() {
  modalDeposit.classList.remove('active');
};

if (btnCopyVaultAddress) {
  btnCopyVaultAddress.addEventListener('click', () => {
    navigator.clipboard.writeText(vaultDepositInput.value);
    btnCopyVaultAddress.textContent = '✅ ¡Copiado!';
    setTimeout(() => { btnCopyVaultAddress.textContent = '📋 Copiar'; }, 2000);
  });
}

// 1-Click Phantom Deposit
window.quickDepositPhantom = async function(solAmount) {
  if (!window.phantom || !window.phantom.solana || !window.phantom.solana.isPhantom) {
    alert("Por favor instala o desbloquea Phantom Wallet.");
    return;
  }
  if (!phantomAddress) {
    try {
      const resp = await window.phantom.solana.connect();
      phantomAddress = resp.publicKey.toString();
      currentUserId = phantomAddress;
      localStorage.setItem('quant_user_id', currentUserId);
      userIdDisplay.textContent = `${phantomAddress.substring(0, 6)}...${phantomAddress.substring(phantomAddress.length - 4)}`;
    } catch (e) {
      alert("Error al conectar Phantom: " + e.message);
      return;
    }
  }

  if (typeof solanaWeb3 === 'undefined') {
    alert("Cargando SDK de Solana... Intenta en 2 segundos.");
    return;
  }

  try {
    addLog(`Iniciando depósito de ${solAmount} SOL con Phantom...`, "info");
    const connection = new solanaWeb3.Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const lamports = Math.floor(solAmount * 1e9);

    const transaction = new solanaWeb3.Transaction().add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey: new solanaWeb3.PublicKey(phantomAddress),
        toPubkey: new solanaWeb3.PublicKey(activeVaultAddress),
        lamports
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new solanaWeb3.PublicKey(phantomAddress);

    const { signature } = await window.phantom.solana.signAndSendTransaction(transaction);
    addLog(`🚀 Transacción enviada: ${signature.substring(0, 10)}... Esperando acreditación...`, "hit");
    closeDepositModal();
  } catch (err) {
    alert("Error en transacción: " + err.message);
  }
};

// Withdrawal Modal Handlers
const modalWithdraw = document.getElementById('modal-withdraw');
const btnWithdraw = document.getElementById('btn-withdraw');
const withdrawDestInput = document.getElementById('withdraw-dest-input');
const withdrawAmtInput = document.getElementById('withdraw-amt-input');
const withdrawAvailableUsd = document.getElementById('withdraw-available-usd');
const btnSubmitWithdraw = document.getElementById('btn-submit-withdraw');

if (btnWithdraw) {
  btnWithdraw.addEventListener('click', () => {
    if (balanceReal <= 0.05) {
      alert(`Tu balance Real On-Chain es $${balanceReal.toFixed(2)} USD. Fondea SOL para operar o retira cuando acumules saldo.`);
      return;
    }
    withdrawAvailableUsd.textContent = `$${balanceReal.toFixed(2)} USD`;
    if (phantomAddress && !withdrawDestInput.value) {
      withdrawDestInput.value = phantomAddress;
    }
    withdrawAmtInput.value = balanceReal.toFixed(2);
    modalWithdraw.classList.add('active');
  });
}

window.closeWithdrawModal = function() {
  modalWithdraw.classList.remove('active');
};

if (btnSubmitWithdraw) {
  btnSubmitWithdraw.addEventListener('click', async () => {
    const dest = withdrawDestInput.value.trim();
    const amt = parseFloat(withdrawAmtInput.value);

    if (!dest || dest.length < 32) {
      alert("Por favor ingresa una dirección de Solana válida (32-44 caracteres).");
      return;
    }
    if (isNaN(amt) || amt <= 0 || amt > balanceReal) {
      alert(`Monto inválido. Ingresa un valor entre $0.10 y $${balanceReal.toFixed(2)} USD.`);
      return;
    }

    btnSubmitWithdraw.disabled = true;
    btnSubmitWithdraw.textContent = "Procesando retiro On-Chain...";

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
        addLog(`✅ Retiro On-Chain confirmado: $${amt.toFixed(2)} USD enviados a ${dest.substring(0, 6)}... | <a href="${data.explorerUrl}" target="_blank" style="color:#38bdf8;">Ver en Solscan ↗</a>`, "hit");
        alert(`¡Retiro exitoso! Transacción enviada a la red de Solana.`);
        closeWithdrawModal();
      } else {
        alert("Error en retiro: " + (data.error || "No se pudo procesar"));
      }
    } catch (e) {
      alert("Error de conexión: " + e.message);
    } finally {
      btnSubmitWithdraw.disabled = false;
      btnSubmitWithdraw.textContent = "Confirmar y Enviar Retiro On-Chain";
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
    tbody.innerHTML = `<tr><td colspan="5" class="text-muted">${activeLeaderboardTab === 'REAL' ? 'Aún no hay depósitos de SOL real en Mainnet' : 'Esperando actividad de bots demo...'}</td></tr>`;
    return;
  }

  tbody.innerHTML = bots.map(b => {
    const isReal = activeLeaderboardTab === 'REAL';
    const rolls = isReal ? b.rollsReal : b.rollsDemo;
    const vol = isReal ? b.volumeReal : b.volumeDemo;
    const badge = isReal
      ? `<span class="badge-verified-onchain">🟢 <a href="https://solscan.io/account/${b.id}" target="_blank" style="color:#34d399;text-decoration:none;">SOLSCAN ↗</a></span>`
      : `<span class="badge-demo-sandbox">🟡 DEMO</span>`;

    return `
      <tr>
        <td style="color:#38bdf8;">${b.id.substring(0, 8)}...</td>
        <td>${rolls.toLocaleString()}</td>
        <td>$${vol.toFixed(2)}</td>
        <td style="color:#fbbf24;">+$${b.rakebackReal.toFixed(4)}</td>
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
        if (data.vaultInfo.address) {
          activeVaultAddress = data.vaultInfo.address;
          if (vaultDepositInput) vaultDepositInput.value = data.vaultInfo.address;
          const auditLinks = document.querySelectorAll('.audit-link, .proof-links a[href*="solscan"], #deposit-solscan-link, #footer-solscan-link');
          auditLinks.forEach(link => {
            link.href = `https://solscan.io/account/${data.vaultInfo.address}`;
          });
        }
      }
      if (data.realStats) {
        document.getElementById('stat-real-volume').textContent = `$${data.realStats.realVolumeUSD.toFixed(2)} USD`;
        document.getElementById('stat-real-profit').textContent = `$${data.realStats.realFounderProfitUSD.toFixed(4)} USD`;
        document.getElementById('stat-real-deposits').textContent = `${data.realStats.verifiedDepositsCount} depósitos`;
      }
      if (data.demoStats) {
        document.getElementById('stat-demo-volume').textContent = `$${data.demoStats.demoVolumeUSD.toFixed(2)} USD`;
        document.getElementById('stat-demo-rolls').textContent = `${data.demoStats.demoRollsCount.toLocaleString()} tiradas`;
        document.getElementById('stat-demo-profit').textContent = `$${data.demoStats.demoFounderProfitUSD.toFixed(4)} USD`;
      }
      renderLeaderboard();
    }
  } catch (e) {}
}

setInterval(fetchProtocolStats, 3000);
fetchProtocolStats();
connectWS();
