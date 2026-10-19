const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { MultiTableArenaEngine } = require('./engine');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const engine = new MultiTableArenaEngine();

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

  // API Endpoints
  if (pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      rollsPerSecond,
      ...engine.getProtocolStats()
    }));
  }

  if (pathname === '/api/radar') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      radar: engine.getRadarTelemetry()
    }));
  }

  // Faucet / Demo Deposit for Instant Dev Testing
  if (pathname === '/api/deposit/demo' && req.method === 'POST') {
    try {
      const { playerId, amount } = await parseJsonBody(req);
      const targetId = playerId || 'quant_tester';
      const depositAmt = Math.min(Number(amount) || 25.00, 100.00);
      const newBal = engine.creditDeposit(targetId, depositAmt);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        message: `Fondeados $${depositAmt.toFixed(2)} USD virtuales para pruebas`,
        playerId: targetId,
        balance: newBal
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // Serve static public assets
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
    broadcast({
      type: 'RADAR_TICK',
      rollsPerSecond,
      activeClients: wss.clients.size,
      radar: engine.getRadarTelemetry(),
      epochPool: engine.epochPool,
      cushionReserve: engine.cushionReserve,
      timestamp: Date.now()
    });
  }
}, 250);

wss.on('connection', (ws) => {
  let authenticatedPlayerId = null;

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);

      switch (msg.action) {
        // Ultra-fast latency ping
        case 'ping': {
          ws.send(JSON.stringify({
            type: 'pong',
            clientTimestamp: msg.timestamp,
            serverTimestamp: Date.now(),
            activeClients: wss.clients.size,
            radar: engine.getRadarTelemetry()
          }));
          break;
        }

        // Authenticate Bot / User
        case 'auth': {
          authenticatedPlayerId = msg.playerId || `bot_${Math.random().toString(36).substring(2, 7)}`;
          const player = engine.getOrCreatePlayer(authenticatedPlayerId, msg.clientSeed);
          
          ws.send(JSON.stringify({
            type: 'AUTH_SUCCESS',
            playerId: player.id,
            balance: player.balance,
            rakebackPending: player.rakebackPending,
            clientSeed: player.clientSeed,
            serverSeedHash: engine.serverSeedHash,
            radar: engine.getRadarTelemetry()
          }));
          break;
        }

        // Execute Order on Specific Table
        case 'order': {
          if (!authenticatedPlayerId) {
            ws.send(JSON.stringify({ type: 'ERROR', error: 'No autenticado. Envía {action: "auth"} primero.' }));
            return;
          }

          const tableKey = msg.table || 'classic';
          const result = engine.executeOrder(authenticatedPlayerId, tableKey);
          currentRolls++;

          ws.send(JSON.stringify({
            type: 'ORDER_RESULT',
            ...result
          }));

          // If a jackpot or major hit was struck, broadcast alert to all bots
          if (result.success && result.isBonus) {
            broadcast({
              type: 'BONUS_ALERT',
              tableKey,
              tableName: result.tableName,
              hitType: result.hitType,
              winner: authenticatedPlayerId,
              amount: result.bonusWon,
              newPot: result.currentPot
            });
          }

          if (result.autoRefuelTriggered) {
            broadcast({
              type: 'AUTO_REFUEL_ALERT',
              tableKey,
              newPot: result.currentPot,
              remainingCushion: engine.cushionReserve
            });
          }
          break;
        }

        // Claim Rakeback
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
  console.log(`⚡ SOLANA QUANT ARENA v2 — ENGINE & WEBSOCKET ONLINE ⚡`);
  console.log(`📍 Web Terminal : http://localhost:${PORT}`);
  console.log(`📡 WebSocket    : ws://localhost:${PORT}`);
  console.log(`🎲 Mesas Activas: FLASH ($0.10) | CLASSIC ($1.00) | WHALE ($10.00)`);
  console.log(`==================================================================\n`);
});
