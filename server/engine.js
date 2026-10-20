const crypto = require('node:crypto');

// Multi-Table Architecture Configuration
const TABLES_CONFIG = {
  flash: {
    id: 1,
    name: "FLASH (Micro Blitz)",
    price: 0.10,
    refund: 0.0998,
    friction: 0.0002,     // 0.2%
    minPotFloor: 5.00,    // Triggers Auto-Refuel if pot falls below this
    seedPot: 10.00,
    jackpotShare: 0.50,
    majorShare: 0.05,
    microShare: 0.01
  },
  classic: {
    id: 2,
    name: "CLASSIC (Standard Arena)",
    price: 1.00,
    refund: 0.998,
    friction: 0.002,      // 0.2%
    minPotFloor: 25.00,
    seedPot: 50.00,
    jackpotShare: 0.75,
    majorShare: 0.05,
    microShare: 0.01
  },
  whale: {
    id: 3,
    name: "WHALE (Macro Syndicate)",
    price: 10.00,
    refund: 9.98,
    friction: 0.02,       // 0.2%
    minPotFloor: 100.00,
    seedPot: 250.00,
    jackpotShare: 1.00,
    majorShare: 0.08,
    microShare: 0.015
  }
};

const COMMISSION_SPLIT = {
  FOUNDER: 0.35,             // 35% Pure Founder Profit
  AUTO_REFUEL_CUSHION: 0.35,    // 35% Auto-Refuel Cushion
  RAKEBACK_CASHBACK: 0.20,      // 20% Direct Rakeback to Bots
  LEADERBOARD_EPOCH: 0.10       // 10% Weekly Epoch Leaderboard
};

class MultiTableArenaEngine {
  constructor() {
    this.tables = {};
    for (const [key, cfg] of Object.entries(TABLES_CONFIG)) {
      this.tables[key] = {
        ...cfg,
        pot: cfg.seedPot,
        totalRollsReal: 0,
        totalRollsDemo: 0,
        totalVolumeReal: 0.0,
        totalVolumeDemo: 0.0,
        totalWonReal: 0.0,
        totalWonDemo: 0.0,
        jackpotsClaimed: 0
      };
    }

    // 🟢 REAL METRICS (Solana Mainnet On-Chain)
    this.realStats = {
      realVolumeUSD: 0.0,
      realRollsCount: 0,
      realFounderProfitUSD: 0.0,
      realCushionReserveUSD: 0.0,
      realEpochPoolUSD: 0.0,
      verifiedDepositsCount: 0,
      recentRealDeposits: [] // { sender, amountSol, amountUsd, signature, explorerUrl, timestamp }
    };

    // 🟡 DEMO SANDBOX METRICS (Virtual Faucet)
    this.demoStats = {
      demoVolumeUSD: 0.0,
      demoRollsCount: 0,
      demoFounderProfitUSD: 0.0,
      cushionReserveDemo: 50.00
    };

    this.recentHits = [];

    // Provably Fair Cryptographic Seed State
    this.serverSeed = crypto.randomBytes(32).toString('hex');
    this.serverSeedHash = crypto.createHash('sha256').update(this.serverSeed).digest('hex');

    // In-memory players state
    this.players = new Map();
  }

  // Get or initialize player account
  getOrCreatePlayer(playerId, clientSeed = null) {
    if (!this.players.has(playerId)) {
      this.players.set(playerId, {
        id: playerId,
        isVerifiedOnChain: false,
        // Balances strictly partitioned
        balanceReal: 0.00,       // Only from real Solana transfers
        balanceDemo: 25.00,      // $25.00 Instant Welcome Sandbox Grant for immediate bot/user testing
        rakebackReal: 0.00,      // Real cashable rakeback
        rakebackDemo: 0.00,      // Demo rakeback
        rakebackClaimedReal: 0.00,
        realDepositsHistory: [],
        clientSeed: clientSeed || crypto.randomBytes(8).toString('hex'),
        nonce: 0,
        // Separate roll counts
        rollsReal: 0,
        rollsDemo: 0,
        volumeReal: 0.00,
        volumeDemo: 0.00,
        wonReal: 0.00,
        wonDemo: 0.00
      });
    }
    return this.players.get(playerId);
  }

  // 🟢 Credit Real On-Chain Deposit (Triggered only by Solana RPC Watcher with Tx Signature)
  creditRealDeposit(senderAddress, amountSol, amountUsd, signature, explorerUrl) {
    const p = this.getOrCreatePlayer(senderAddress);
    p.isVerifiedOnChain = true;
    p.balanceReal = Number((p.balanceReal + Number(amountUsd)).toFixed(4));
    
    const depRecord = {
      sender: senderAddress,
      amountSol: Number(amountSol.toFixed(6)),
      amountUsd: Number(amountUsd.toFixed(2)),
      signature,
      explorerUrl,
      timestamp: Date.now()
    };

    p.realDepositsHistory.unshift(depRecord);
    if (p.realDepositsHistory.length > 20) p.realDepositsHistory.pop();

    this.realStats.verifiedDepositsCount += 1;
    this.realStats.recentRealDeposits.unshift(depRecord);
    if (this.realStats.recentRealDeposits.length > 50) this.realStats.recentRealDeposits.pop();

    return {
      playerId: senderAddress,
      balanceReal: p.balanceReal,
      signature,
      explorerUrl
    };
  }

  // 🟡 Credit Virtual Demo Faucet
  creditDemoFaucet(playerId, amountUsd = 25.00) {
    const p = this.getOrCreatePlayer(playerId);
    p.balanceDemo = Number((p.balanceDemo + Number(amountUsd)).toFixed(4));
    return p.balanceDemo;
  }

  // Debit withdrawal (Real balance only)
  debitWithdrawal(playerId, amountUSD) {
    const p = this.players.get(playerId);
    if (!p || p.balanceReal < amountUSD) {
      return { success: false, error: "Saldo on-chain real insuficiente para retiro" };
    }
    p.balanceReal = Number((p.balanceReal - Number(amountUSD)).toFixed(4));
    return { success: true, newBalanceReal: p.balanceReal };
  }

  // Claim Rakeback
  claimRakeback(playerId) {
    const p = this.players.get(playerId);
    if (!p) return { success: false, error: "Jugador no encontrado" };

    const claimedReal = p.rakebackReal;
    const claimedDemo = p.rakebackDemo;

    if (claimedReal <= 0 && claimedDemo <= 0) {
      return { success: false, error: "No hay rakeback acumulado para reclamar" };
    }

    p.balanceReal = Number((p.balanceReal + claimedReal).toFixed(4));
    p.rakebackClaimedReal = Number((p.rakebackClaimedReal + claimedReal).toFixed(4));
    p.rakebackReal = 0.00;

    p.balanceDemo = Number((p.balanceDemo + claimedDemo).toFixed(4));
    p.rakebackDemo = 0.00;

    return {
      success: true,
      claimedReal,
      claimedDemo,
      newBalanceReal: p.balanceReal,
      newBalanceDemo: p.balanceDemo
    };
  }

  // Calculate Deterministic Expected Value (+EV)
  calculateTableEV(tableKey) {
    const t = this.tables[tableKey];
    if (!t) return { evRatio: 1.0, evPercentage: 0, expectedBonus: 0 };

    const pMicro = 0.040;
    const pMajor = 0.009;
    const pJackpot = 0.001;

    const expectedBonus = (pMicro * t.microShare * t.pot) +
                          (pMajor * t.majorShare * t.pot) +
                          (pJackpot * t.jackpotShare * t.pot);

    const evRatio = Number((expectedBonus / t.friction).toFixed(4));
    const evPercentage = Number(((evRatio - 1.0) * 100).toFixed(2));

    return {
      tableKey,
      tableName: t.name,
      potUSD: Number(t.pot.toFixed(2)),
      frictionUSD: t.friction,
      expectedBonusUSD: Number(expectedBonus.toFixed(6)),
      evRatio,
      evPercentage,
      isPositiveEV: evRatio >= 1.0
    };
  }

  getRadarTelemetry() {
    const radar = {};
    for (const key of Object.keys(this.tables)) {
      radar[key] = this.calculateTableEV(key);
    }
    return radar;
  }

  computeRoll(serverSeed, clientSeed, nonce) {
    const hmac = crypto.createHmac('sha256', serverSeed);
    hmac.update(`${clientSeed}:${nonce}`);
    const hash = hmac.digest('hex');
    const intVal = parseInt(hash.substring(0, 8), 16);
    const roll = intVal % 1000;
    return { roll, hash };
  }

  checkAutoRefuel(tableKey) {
    const t = this.tables[tableKey];
    const reserve = this.realStats.realCushionReserveUSD > 5 ? this.realStats.realCushionReserveUSD : this.demoStats.cushionReserveDemo;
    if (t.pot < t.minPotFloor && reserve > 1.00) {
      const deficit = Number((t.minPotFloor - t.pot).toFixed(4));
      const refuelAmount = Math.min(deficit + 5.00, reserve);
      t.pot = Number((t.pot + refuelAmount).toFixed(4));
      if (this.realStats.realCushionReserveUSD > 5) {
        this.realStats.realCushionReserveUSD = Number((this.realStats.realCushionReserveUSD - refuelAmount).toFixed(4));
      } else {
        this.demoStats.cushionReserveDemo = Number((this.demoStats.cushionReserveDemo - refuelAmount).toFixed(4));
      }
      return { triggered: true, tableKey, refuelAmount, newPot: t.pot };
    }
    return { triggered: false };
  }

  // Core High-Frequency Order Execution with strict REAL vs DEMO segregation
  executeOrder(playerId, tableKey = 'classic', requestedMode = 'AUTO') {
    const t = this.tables[tableKey];
    if (!t) return { success: false, error: `Mesa '${tableKey}' no válida.` };

    const player = this.getOrCreatePlayer(playerId);

    // Determine Mode: REAL vs DEMO
    let isReal = false;
    if (requestedMode === 'REAL') {
      if (player.balanceReal < t.price) {
        return { success: false, error: "Saldo REAL insuficiente en tu cuenta on-chain", required: t.price, balanceReal: player.balanceReal };
      }
      isReal = true;
    } else if (requestedMode === 'DEMO') {
      if (player.balanceDemo < t.price) {
        return { success: false, error: "Saldo DEMO insuficiente. Usa el botón Faucet Demo.", required: t.price, balanceDemo: player.balanceDemo };
      }
      isReal = false;
    } else {
      // AUTO mode: Prioritize REAL if funded, otherwise DEMO
      if (player.balanceReal >= t.price) {
        isReal = true;
      } else if (player.balanceDemo >= t.price) {
        isReal = false;
      } else {
        return {
          success: false,
          error: "Saldo insuficiente. Fondea SOL real o activa el botón Faucet Demo.",
          required: t.price,
          balanceReal: player.balanceReal,
          balanceDemo: player.balanceDemo
        };
      }
    }

    // 1. Advance Nonces
    player.nonce += 1;

    if (isReal) {
      player.rollsReal += 1;
      player.volumeReal = Number((player.volumeReal + t.price).toFixed(4));
      t.totalRollsReal += 1;
      t.totalVolumeReal = Number((t.totalVolumeReal + t.price).toFixed(4));
      this.realStats.realRollsCount += 1;
      this.realStats.realVolumeUSD = Number((this.realStats.realVolumeUSD + t.price).toFixed(4));
    } else {
      player.rollsDemo += 1;
      player.volumeDemo = Number((player.volumeDemo + t.price).toFixed(4));
      t.totalRollsDemo += 1;
      t.totalVolumeDemo = Number((t.totalVolumeDemo + t.price).toFixed(4));
      this.demoStats.demoRollsCount += 1;
      this.demoStats.demoVolumeUSD = Number((this.demoStats.demoVolumeUSD + t.price).toFixed(4));
    }

    // 2. Compute Provably Fair Roll
    const { roll, hash } = this.computeRoll(this.serverSeed, player.clientSeed, player.nonce);
    const isJackpot = (roll === 777);                     // 0.1%
    const isMajorHit = (!isJackpot && roll % 100 === 77); // 0.9%
    const isMicroHit = (!isJackpot && !isMajorHit && roll % 25 === 0); // 4.0%
    const isBonus = isJackpot || isMajorHit || isMicroHit;

    let hitType = 'NORMAL';
    let bonusWon = 0.0;

    if (isBonus) {
      if (isJackpot) {
        hitType = 'MEGA_JACKPOT';
        bonusWon = Number((t.pot * t.jackpotShare).toFixed(4));
        t.jackpotsClaimed += 1;
      } else if (isMajorHit) {
        hitType = 'MAJOR_HIT';
        bonusWon = Number((t.pot * t.majorShare).toFixed(4));
      } else if (isMicroHit) {
        hitType = 'MICRO_HIT';
        bonusWon = Number((t.pot * t.microShare).toFixed(4));
      }

      t.pot = Math.max(0.00, Number((t.pot - bonusWon).toFixed(4)));

      if (isReal) {
        player.wonReal = Number((player.wonReal + bonusWon).toFixed(4));
        t.totalWonReal = Number((t.totalWonReal + bonusWon).toFixed(4));
      } else {
        player.wonDemo = Number((player.wonDemo + bonusWon).toFixed(4));
        t.totalWonDemo = Number((t.totalWonDemo + bonusWon).toFixed(4));
      }

      this.recentHits.unshift({
        playerId,
        isReal,
        tableKey,
        tableName: t.name,
        hitType,
        bonusWon,
        roll,
        timestamp: Date.now()
      });
      if (this.recentHits.length > 50) this.recentHits.pop();
    }

    // 3. Financial Settlement
    const payout = Number((t.refund + bonusWon).toFixed(4));
    const netChange = Number((payout - t.price).toFixed(4));

    if (isReal) {
      player.balanceReal = Number((player.balanceReal - t.price + payout).toFixed(4));
    } else {
      player.balanceDemo = Number((player.balanceDemo - t.price + payout).toFixed(4));
    }

    // 4. Distribute Friction
    const f = t.friction;
    const founderAdd = Number((f * COMMISSION_SPLIT.FOUNDER).toFixed(6));
    const cushionAdd = Number((f * COMMISSION_SPLIT.AUTO_REFUEL_CUSHION).toFixed(6));
    const rakebackAdd = Number((f * COMMISSION_SPLIT.RAKEBACK_CASHBACK).toFixed(6));
    const epochAdd = Number((f * COMMISSION_SPLIT.LEADERBOARD_EPOCH).toFixed(6));

    if (isReal) {
      this.realStats.realFounderProfitUSD = Number((this.realStats.realFounderProfitUSD + founderAdd).toFixed(4));
      this.realStats.realCushionReserveUSD = Number((this.realStats.realCushionReserveUSD + cushionAdd).toFixed(4));
      this.realStats.realEpochPoolUSD = Number((this.realStats.realEpochPoolUSD + epochAdd).toFixed(4));
      player.rakebackReal = Number((player.rakebackReal + rakebackAdd).toFixed(4));
    } else {
      this.demoStats.demoFounderProfitUSD = Number((this.demoStats.demoFounderProfitUSD + founderAdd).toFixed(4));
      this.demoStats.cushionReserveDemo = Number((this.demoStats.cushionReserveDemo + cushionAdd).toFixed(4));
      player.rakebackDemo = Number((player.rakebackDemo + rakebackAdd).toFixed(4));
    }

    // 5. Pot recycling
    t.pot = Number((t.pot + (f * 0.10)).toFixed(4));
    const refuelResult = this.checkAutoRefuel(tableKey);

    return {
      success: true,
      playerId,
      isReal,
      modeLabel: isReal ? "🟢 REAL ON-CHAIN" : "🟡 DEMO SANDBOX",
      tableKey,
      tableName: t.name,
      roll,
      hitType,
      isBonus,
      bonusWon,
      payout,
      netChange,
      balanceReal: player.balanceReal,
      balanceDemo: player.balanceDemo,
      activeBalance: isReal ? player.balanceReal : player.balanceDemo,
      rakebackAccumulated: isReal ? player.rakebackReal : player.rakebackDemo,
      currentPot: t.pot,
      autoRefuelTriggered: refuelResult.triggered,
      proof: {
        serverSeedHash: this.serverSeedHash,
        clientSeed: player.clientSeed,
        nonce: player.nonce,
        hash
      }
    };
  }

  // Partitioned Leaderboard
  getLeaderboard(filter = 'ALL', limit = 10) {
    const list = Array.from(this.players.values()).map(p => ({
      id: p.id,
      isVerifiedOnChain: p.isVerifiedOnChain,
      hasRealActivity: p.rollsReal > 0,
      rollsReal: p.rollsReal,
      rollsDemo: p.rollsDemo,
      volumeReal: p.volumeReal,
      volumeDemo: p.volumeDemo,
      rakebackReal: p.rakebackReal,
      balanceReal: p.balanceReal,
      balanceDemo: p.balanceDemo
    }));

    if (filter === 'REAL') {
      return list.filter(p => p.rollsReal > 0 || p.isVerifiedOnChain)
                 .sort((a, b) => b.volumeReal - a.volumeReal)
                 .slice(0, limit);
    } else if (filter === 'DEMO') {
      return list.filter(p => p.rollsDemo > 0)
                 .sort((a, b) => b.volumeDemo - a.volumeDemo)
                 .slice(0, limit);
    }

    // Default: Sort by real volume first, then demo
    return list.sort((a, b) => (b.volumeReal * 1000 + b.volumeDemo) - (a.volumeReal * 1000 + a.volumeDemo)).slice(0, limit);
  }

  // Global Partitioned Protocol Snapshot
  getProtocolStats() {
    return {
      realStats: this.realStats,
      demoStats: this.demoStats,
      serverSeedHash: this.serverSeedHash,
      tables: this.tables,
      radar: this.getRadarTelemetry(),
      recentHits: this.recentHits.slice(0, 10),
      topRealBots: this.getLeaderboard('REAL', 10),
      topDemoBots: this.getLeaderboard('DEMO', 10),
      allBots: this.getLeaderboard('ALL', 15)
    };
  }
}

module.exports = { MultiTableArenaEngine, TABLES_CONFIG };
