// Solana Quant Arena v2 — Frontend Engine Client

let ws = null;
let currentUserId = localStorage.getItem('quant_user_id') || `trader_${Math.random().toString(36).substring(2, 7)}`;
let userBalance = 0.00;
let userRakeback = 0.00;
let phantomAddress = null;

const consoleStream = document.getElementById('console-stream');
const userIdDisplay = document.getElementById('user-id-display');
const userBalanceDisplay = document.getElementById('user-balance-display');
const userRakebackDisplay = document.getElementById('user-rakeback-display');
const btnClaimRakeback = document.getElementById('btn-claim-rakeback');
const btnConnectWallet = document.getElementById('btn-connect-wallet');
const btnFaucet = document.getElementById('btn-faucet');
const serverSeedHashDisplay = document.getElementById('server-seed-hash');

userIdDisplay.textContent = currentUserId;

function addLog(msg, type = 'info') {
  const row = document.createElement('div');
  row.className = `log-row ${type}`;
  const time = new Date().toLocaleTimeString();
  row.innerHTML = `<span style="color:#64748b;">[${time}]</span> ${msg}`;
  consoleStream.prepend(row);
  if (consoleStream.children.length > 60) consoleStream.lastChild.remove();
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
      userBalance = data.balance;
      userRakeback = data.rakebackPending || 0.00;
      updateUserUI();
      if (data.serverSeedHash) {
        serverSeedHashDisplay.textContent = `Hash: ${data.serverSeedHash}`;
      }
      if (data.radar) updateRadarUI(data.radar);
      break;

    case 'RADAR_TICK':
      document.getElementById('metric-tps').textContent = `${data.rollsPerSecond || 0} tiradas/s`;
      document.getElementById('metric-bots').textContent = `${data.activeClients || 0} bots`;
      document.getElementById('metric-cushion').textContent = `$${(data.cushionReserve || 50).toFixed(2)} USD`;
      document.getElementById('metric-epoch').textContent = `$${(data.epochPool || 0).toFixed(2)} USD`;
      if (data.radar) updateRadarUI(data.radar);
      break;

    case 'ORDER_RESULT':
      if (data.playerId === currentUserId) {
        userBalance = data.newBalance;
        userRakeback = data.rakebackAccumulated;
        updateUserUI();

        if (data.hitType === 'MEGA_JACKPOT') {
          addLog(`🏆🏆🏆 ¡¡¡MEGA JACKPOT EN ${data.tableName}!!! Ganaste: +$${data.bonusWon.toFixed(2)} USD (Roll #${data.roll})`, "jackpot");
        } else if (data.hitType === 'MAJOR_HIT') {
          addLog(`💥 [MAJOR HIT 1%] ${data.tableName} | Roll #${data.roll} -> +$${data.bonusWon.toFixed(2)} USD`, "hit");
        } else if (data.hitType === 'MICRO_HIT') {
          addLog(`⚡ [MICRO-HIT 4%] ${data.tableName} | Roll #${data.roll} -> +$${data.bonusWon.toFixed(2)} USD`, "hit");
        } else {
          addLog(`⚡ Orden procesada en ${data.tableName} | Roll #${data.roll} | Soft-Refund: $${data.payout.toFixed(4)} | Rakeback: +$${userRakeback.toFixed(4)}`, "order");
        }
      }
      break;

    case 'BONUS_ALERT':
      addLog(`📢 ALERTA GLOBAL: ${data.winner} sacó ${data.hitType} en ${data.tableName} (+${data.amount.toFixed(2)} USD)`, "hit");
      break;

    case 'AUTO_REFUEL_ALERT':
      addLog(`🔄 AUTO-REFUEL: Inyectada liquidez a Mesa ${data.tableKey.toUpperCase()}. Bote restaurado a $${data.newPot.toFixed(2)} USD`, "refuel");
      break;

    case 'RAKEBACK_CLAIMED':
      userBalance = data.newBalance;
      userRakeback = 0.00;
      updateUserUI();
      addLog(`💸 Rakeback reclamado con éxito: +$${data.claimed.toFixed(4)} USD`, "hit");
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
  userBalanceDisplay.textContent = `$${userBalance.toFixed(2)} USD`;
  userRakebackDisplay.textContent = `$${userRakeback.toFixed(4)} USD`;
  btnClaimRakeback.disabled = (userRakeback <= 0.0001);
}

// Trigger Order via button
window.triggerOrder = function(tableKey) {
  if (!ws || ws.readyState !== 1) {
    alert("Reconectando al servidor WebSocket...");
    return;
  }
  const minRequired = tableKey === 'flash' ? 0.10 : (tableKey === 'classic' ? 1.00 : 10.00);
  if (userBalance < minRequired) {
    alert(`Saldo insuficiente. Puedes usar el botón '💧 Faucet Demo' para cargar $25 USD de prueba.`);
    return;
  }
  ws.send(JSON.stringify({
    action: "order",
    table: tableKey
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
      userBalance = data.balance;
      updateUserUI();
      addLog(`💧 Faucet activado: +$25.00 USD cargados para pruebas`, "hit");
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

      // Re-authenticate WS with Phantom address
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ action: "auth", playerId: currentUserId }));
      }
    } catch (err) {
      alert("Error al conectar Phantom: " + err.message);
    }
  } else {
    alert("No se detectó Phantom Wallet en este navegador. Puedes instalarla desde phantom.app");
  }
});

// Withdrawal Placeholder
document.getElementById('btn-withdraw').addEventListener('click', () => {
  if (userBalance <= 0) {
    alert("No tienes balance para retirar.");
    return;
  }
  alert(`Retiro No-Custodial: Puedes extraer tus $${userBalance.toFixed(2)} USD en SOL directamente a tu wallet en cualquier momento.`);
});

// Refresh Leaderboard periodically
async function fetchLeaderboard() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success && data.topBots) {
      const tbody = document.getElementById('leaderboard-body');
      if (data.topBots.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-muted">Esperando actividad de bots...</td></tr>`;
      } else {
        tbody.innerHTML = data.topBots.map(b => `
          <tr>
            <td style="color:#38bdf8;">${b.id.substring(0, 10)}...</td>
            <td>${b.rolls.toLocaleString()}</td>
            <td>$${b.totalSpent.toFixed(2)}</td>
            <td style="color:#fbbf24;">+$${b.rakebackTotal.toFixed(4)}</td>
          </tr>
        `).join('');
      }
    }
  } catch (e) {}
}

setInterval(fetchLeaderboard, 4000);
fetchLeaderboard();
connectWS();
