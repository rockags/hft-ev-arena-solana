const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { MultiTableArenaEngine } = require('./engine');
const { SolanaVault } = require('./solana-vault');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const engine = new MultiTableArenaEngine();
const vault = new SolanaVault();

// Start Solana Live Deposit Watcher (Listens for Real SOL on Mainnet)
vault.startDepositWatcher(({ sender, amountSol, amountUsd, signature }) => {
  const explorerUrl = `https://solscan.io/tx/${signature}`;
  const credit = engine.creditRealDeposit(sender, amountSol, amountUsd, signature, explorerUrl);

  broadcast({
    type: 'REAL_DEPOSIT_CONFIRMED',
    sender,
    amountSol,
    amountUsd,
    balanceReal: credit.balanceReal,
    signature,
    explorerUrl,
    timestamp: Date.now()
  });

  console.log(`\n🟢 [REAL ON-CHAIN DEPOSIT DETECTED]`);
  console.log(`- From     : ${sender}`);
  console.log(`- Amount   : ${amountSol} SOL (~$${amountUsd} USD)`);
  console.log(`- Solscan  : ${explorerUrl}\n`);
});

// Throughput tracking
let lastSecRolls = 0;
let currentRolls = 0;
let rollsPerSecond = 0;

setInterval(() => {
  rollsPerSecond = currentRolls - lastSecRolls;
  lastSecRolls = currentRolls;
}, 1000);

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. Partitioned Global Stats
  if (pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const vaultBal = await vault.getVaultBalance();
    return res.end(JSON.stringify({
      success: true,
      rollsPerSecond,
      vaultInfo: {
        ...vaultBal,
        solscanUrl: `https://solscan.io/account/${vault.getVaultAddress()}`
      },
      ...engine.getProtocolStats()
    }));
  }

  // 2. Real-time EV Radar
  if (pathname === '/api/radar') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      radar: engine.getRadarTelemetry()
    }));
  }

  // 3. Vault On-Chain Info
  if (pathname === '/api/vault/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const bal = await vault.getVaultBalance();
    return res.end(JSON.stringify({
      ...bal,
      solscanUrl: `https://solscan.io/account/${vault.getVaultAddress()}`,
      solUsdRate: vault.getSolUsdRate(),
      rateSource: vault.getRateSource()
    }));
  }

  // 4. Demo Virtual Faucet
  if (pathname === '/api/deposit/demo' && req.method === 'POST') {
    try {
      const { playerId, amount } = await parseJsonBody(req);
      const targetId = playerId || 'quant_tester';
      const depositAmt = Math.min(Number(amount) || 25.00, 100.00);
      const newBal = engine.creditDemoFaucet(targetId, depositAmt);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        mode: "DEMO_SANDBOX",
        message: `Fondeados $${depositAmt.toFixed(2)} USD virtuales para pruebas`,
        playerId: targetId,
        balanceDemo: newBal
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // 5. Withdrawal (Real Balance Only)
  if (pathname === '/api/withdraw' && req.method === 'POST') {
    try {
      const { playerId, destinationAddress, amountUSD } = await parseJsonBody(req);
      const debitRes = engine.debitWithdrawal(playerId, Number(amountUSD));
      if (!debitRes.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(debitRes));
      }
      const txRes = await vault.withdrawSOL(destinationAddress, Number(amountUSD));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, ...txRes }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // Serve static assets
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// WebSocket Server
const wss = new WebSocketServer({ server });

function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

// 250ms Live Telemetry Pulse
setInterval(() => {
  if (wss.clients.size > 0) {
    const radar = engine.getRadarTelemetry();
    broadcast({
      type: 'RADAR_TICK',
      rollsPerSecond,
      activeClients: wss.clients.size,
      radar,
      realStats: engine.realStats,
      demoStats: engine.demoStats,
      timestamp: Date.now(),
      // Legacy v1 backward compatibility
      pot: engine.tables.classic.pot,
      currentPot: engine.tables.classic.pot
    });

    // Legacy TICKER broadcast
    broadcast({
      type: 'TICKER',
      pot: engine.tables.classic.pot,
      currentPot: engine.tables.classic.pot,
      activeClients: wss.clients.size,
      rollsPerSecond
    });
  }
}, 250);

// Keep-alive heartbeat ping every 20s
setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) return client.terminate();
    client.isAlive = false;
    client.ping();
  }
}, 20000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let authenticatedPlayerId = null;

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);

      switch (msg.action) {
        case 'ping': {
          ws.send(JSON.stringify({
            type: 'pong',
            clientTimestamp: msg.timestamp,
            serverTimestamp: Date.now(),
            activeClients: wss.clients.size,
            radar: engine.getRadarTelemetry(),
            pot: engine.tables.classic.pot
          }));
          break;
        }

        case 'auth': {
          authenticatedPlayerId = msg.playerId || `bot_${Math.random().toString(36).substring(2, 7)}`;
          const player = engine.getOrCreatePlayer(authenticatedPlayerId, msg.clientSeed);

          ws.send(JSON.stringify({
            type: 'AUTH_SUCCESS',
            playerId: player.id,
            isVerifiedOnChain: player.isVerifiedOnChain,
            balanceReal: player.balanceReal,
            balanceDemo: player.balanceDemo,
            rakebackReal: player.rakebackReal,
            rakebackDemo: player.rakebackDemo,
            clientSeed: player.clientSeed,
            serverSeedHash: engine.serverSeedHash,
            radar: engine.getRadarTelemetry(),
            currentPot: engine.tables.classic.pot
          }));
          break;
        }

        case 'open_pack':
        case 'order': {
          if (!authenticatedPlayerId) {
            ws.send(JSON.stringify({ type: 'ERROR', error: 'No autenticado. Envía {action: "auth"} primero.' }));
            return;
          }

          let tableKey = msg.table;
          if (!tableKey) {
            if (msg.tier === 'gold') tableKey = 'whale';
            else if (msg.tier === 'bronze') tableKey = 'classic';
            else tableKey = 'classic';
          }

          const mode = msg.mode || 'AUTO'; // 'REAL' | 'DEMO' | 'AUTO'
          const result = engine.executeOrder(authenticatedPlayerId, tableKey, mode);
          currentRolls++;

          ws.send(JSON.stringify({
            type: 'ORDER_RESULT',
            ...result
          }));

          // Legacy PACK_RESULT
          ws.send(JSON.stringify({
            type: 'PACK_RESULT',
            playerId: authenticatedPlayerId,
            success: result.success,
            balance: result.activeBalance,
            hitType: result.hitType,
            roll: result.roll,
            payout: result.payout,
            netChange: result.netChange,
            bonusWon: result.bonusWon,
            jackpotWon: result.bonusWon,
            currentPot: result.currentPot
          }));

          if (result.success && result.isBonus) {
            broadcast({
              type: 'BONUS_ALERT',
              isReal: result.isReal,
              modeLabel: result.modeLabel,
              tableKey,
              tableName: result.tableName,
              hitType: result.hitType,
              winner: authenticatedPlayerId,
              amount: result.bonusWon,
              newPot: result.currentPot
            });

            broadcast({
              type: 'JACKPOT_ALERT',
              winner: authenticatedPlayerId,
              jackpotAmount: result.bonusWon
            });
          }

          if (result.autoRefuelTriggered) {
            broadcast({
              type: 'AUTO_REFUEL_ALERT',
              tableKey,
              newPot: result.currentPot
            });
          }
          break;
        }

        case 'claim_rakeback': {
          if (!authenticatedPlayerId) {
            ws.send(JSON.stringify({ type: 'ERROR', error: 'No autenticado.' }));
            return;
          }
          const claimRes = engine.claimRakeback(authenticatedPlayerId);
          ws.send(JSON.stringify({
            type: 'RAKEBACK_CLAIMED',
            ...claimRes
          }));
          break;
        }

        default:
          ws.send(JSON.stringify({ type: 'ERROR', error: `Acción desconocida: ${msg.action}` }));
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'ERROR', error: 'Malformed JSON payload' }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`==================================================================`);
  console.log(`⚡ SOLANA QUANT ARENA v2 — PARTITIONED ENGINE ACTIVE ⚡`);
  console.log(`🟢 On-Chain Vault : ${vault.getVaultAddress()}`);
  console.log(`📍 Web Terminal   : http://localhost:${PORT}`);
  console.log(`📡 WebSocket Feed : ws://localhost:${PORT}`);
  console.log(`==================================================================\n`);
});
