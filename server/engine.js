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
    jackpotShare: 0.50,   // Takes 50% of Pot on Mega Jackpot
    majorShare: 0.05,     // Takes 5% of Pot on Major Hit
    microShare: 0.01      // Takes 1% of Pot on Micro Hit
  },
  classic: {
    id: 2,
    name: "CLASSIC (Standard Arena)",
    price: 1.00,
    refund: 0.998,
    friction: 0.002,      // 0.2%
    minPotFloor: 25.00,   // Triggers Auto-Refuel if pot falls below this
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
    minPotFloor: 100.00,  // Triggers Auto-Refuel if pot falls below this
    seedPot: 250.00,
    jackpotShare: 1.00,   // Takes 100% of Pot on Mega Jackpot
    majorShare: 0.08,
    microShare: 0.015
  }
};

// Distribution of Friction Commissions
const COMMISSION_SPLIT = {
  FOUNDER: 0.35,          // 35% Pure Founder Profit
  AUTO_REFUEL_CUSHION: 0.35, // 35% Auto-Refuel Stabilization Cushion
  RAKEBACK_CASHBACK: 0.20,   // 20% Direct Rakeback to Bots
  LEADERBOARD_EPOCH: 0.10    // 10% Weekly Epoch Leaderboard Pool
};

class MultiTableArenaEngine {
  constructor() {
    this.tables = {};
    for (const [key, cfg] of Object.entries(TABLES_CONFIG)) {
      this.tables[key] = {
        ...cfg,
        pot: cfg.seedPot,
        totalRolls: 0,
        totalVolume: 0.0,
        totalWon: 0.0,
        jackpotsClaimed: 0
      };
    }

    // Protocol Global Accounts
    this.founderRevenue = 0.0;
    this.cushionReserve = 50.00; // Seed reserve for initial auto-refuels
    this.epochPool = 0.0;
    this.totalProtocolVolume = 0.0;
    this.totalProtocolRolls = 0;
    this.recentHits = [];

    // Provably Fair Cryptographic Seed State
    this.serverSeed = crypto.randomBytes(32).toString('hex');
    this.serverSeedHash = crypto.createHash('sha256').update(this.serverSeed).digest('hex');

    // In-memory player state
    this.players = new Map();
  }

  // Get or initialize player account
  getOrCreatePlayer(playerId, clientSeed = null) {
    if (!this.players.has(playerId)) {
      this.players.set(playerId, {
        id: playerId,
        balance: 0.00,
        rakebackPending: 0.00,
        rakebackClaimed: 0.00,
        clientSeed: clientSeed || crypto.randomBytes(8).toString('hex'),
        nonce: 0,
        rolls: 0,
        wins: 0,
        totalSpent: 0.00,
        totalWon: 0.00,
        totalRefunded: 0.00
      });
    }
    return this.players.get(playerId);
  }

  // Credit user deposit
  creditDeposit(playerId, amountUSD) {
    const p = this.getOrCreatePlayer(playerId);
    p.balance = Number((p.balance + Number(amountUSD)).toFixed(4));
    return p.balance;
  }

  // Debit withdrawal
  debitWithdrawal(playerId, amountUSD) {
    const p = this.players.get(playerId);
    if (!p || p.balance < amountUSD) {
      return { success: false, error: "Saldo insuficiente para retiro" };
    }
    p.balance = Number((p.balance - Number(amountUSD)).toFixed(4));
    return { success: true, newBalance: p.balance };
  }

  // Claim Rakeback
  claimRakeback(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.rakebackPending <= 0) {
      return { success: false, error: "No hay rakeback acumulado para reclamar" };
    }
    const claimed = p.rakebackPending;
    p.balance = Number((p.balance + claimed).toFixed(4));
    p.rakebackClaimed = Number((p.rakebackClaimed + claimed).toFixed(4));
    p.rakebackPending = 0.00;
    return { success: true, claimed, newBalance: p.balance };
  }

  // Calculate Deterministic Expected Value (+EV) for each table
  calculateTableEV(tableKey) {
    const t = this.tables[tableKey];
    if (!t) return { evRatio: 1.0, evPercentage: 0, expectedBonus: 0 };

    // E[Bonus] = (P_micro * Share_micro * Pot) + (P_major * Share_major * Pot) + (P_jackpot * Share_jackpot * Pot)
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

  // Get full telemetry for all 3 tables
  getRadarTelemetry() {
    const radar = {};
    for (const key of Object.keys(this.tables)) {
      radar[key] = this.calculateTableEV(key);
    }
    return radar;
  }

  // Provably Fair Roll Computation (0 to 999)
  computeRoll(serverSeed, clientSeed, nonce) {
    const hmac = crypto.createHmac('sha256', serverSeed);
    hmac.update(`${clientSeed}:${nonce}`);
    const hash = hmac.digest('hex');
    const intVal = parseInt(hash.substring(0, 8), 16);
    const roll = intVal % 1000;
    return { roll, hash };
  }

  // Check and trigger Auto-Refuel if a table dropped below floor
  checkAutoRefuel(tableKey) {
    const t = this.tables[tableKey];
    if (t.pot < t.minPotFloor && this.cushionReserve > 1.00) {
      const deficit = Number((t.minPotFloor - t.pot).toFixed(4));
      const refuelAmount = Math.min(deficit + 5.00, this.cushionReserve); // Bring above floor
      t.pot = Number((t.pot + refuelAmount).toFixed(4));
      this.cushionReserve = Number((this.cushionReserve - refuelAmount).toFixed(4));

      return {
        triggered: true,
        tableKey,
        refuelAmount,
        newPot: t.pot,
        remainingCushion: this.cushionReserve
      };
    }
    return { triggered: false };
  }

  // Core High-Frequency Action: Open Pack / Roll Order
  executeOrder(playerId, tableKey = 'classic') {
    const t = this.tables[tableKey];
    if (!t) return { success: false, error: `Mesa '${tableKey}' no válida. Usa 'flash', 'classic' o 'whale'.` };

    const player = this.getOrCreatePlayer(playerId);
    if (player.balance < t.price) {
      return {
        success: false,
        error: "Saldo insuficiente",
        balance: player.balance,
        required: t.price,
        table: tableKey
      };
    }

    // 1. Advance Nonces
    player.nonce += 1;
    player.rolls += 1;
    player.totalSpent = Number((player.totalSpent + t.price).toFixed(4));
    t.totalRolls += 1;
    t.totalVolume = Number((t.totalVolume + t.price).toFixed(4));
    this.totalProtocolRolls += 1;
    this.totalProtocolVolume = Number((this.totalProtocolVolume + t.price).toFixed(4));

    // 2. Compute Provably Fair Roll
    const { roll, hash } = this.computeRoll(this.serverSeed, player.clientSeed, player.nonce);
    const isJackpot = (roll === 777);                     // 0.1% (1 in 1000)
    const isMajorHit = (!isJackpot && roll % 100 === 77); // 0.9% (1 in 111)
    const isMicroHit = (!isJackpot && !isMajorHit && roll % 25 === 0); // 4.0% (1 in 25)
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
      player.wins += 1;
      player.totalWon = Number((player.totalWon + bonusWon).toFixed(4));
      t.totalWon = Number((t.totalWon + bonusWon).toFixed(4));

      // Push to recent hits feed
      this.recentHits.unshift({
        playerId,
        tableKey,
        tableName: t.name,
        hitType,
        bonusWon,
        roll,
        timestamp: Date.now()
      });
      if (this.recentHits.length > 50) this.recentHits.pop();
    }

    // 3. Financial Settlement (Soft Refund + Friction Split)
    const payout = Number((t.refund + bonusWon).toFixed(4));
    const netChange = Number((payout - t.price).toFixed(4));
    player.balance = Number((player.balance - t.price + payout).toFixed(4));
    player.totalRefunded = Number((player.totalRefunded + t.refund).toFixed(4));

    // 4. Distribute Friction
    const f = t.friction;
    const founderAdd = Number((f * COMMISSION_SPLIT.FOUNDER).toFixed(6));
    const cushionAdd = Number((f * COMMISSION_SPLIT.AUTO_REFUEL_CUSHION).toFixed(6));
    const rakebackAdd = Number((f * COMMISSION_SPLIT.RAKEBACK_CASHBACK).toFixed(6));
    const epochAdd = Number((f * COMMISSION_SPLIT.LEADERBOARD_EPOCH).toFixed(6));

    this.founderRevenue = Number((this.founderRevenue + founderAdd).toFixed(4));
    this.cushionReserve = Number((this.cushionReserve + cushionAdd).toFixed(4));
    player.rakebackPending = Number((player.rakebackPending + rakebackAdd).toFixed(4));
    this.epochPool = Number((this.epochPool + epochAdd).toFixed(4));

    // 5. Automatic Pot Recycling (Friction also feeds pot growth)
    t.pot = Number((t.pot + (f * 0.10)).toFixed(4));

    // 6. Check Auto-Refuel if table pot dipped
    const refuelResult = this.checkAutoRefuel(tableKey);

    return {
      success: true,
      playerId,
      tableKey,
      tableName: t.name,
      roll,
      hitType,
      isBonus,
      bonusWon,
      payout,
      netChange,
      newBalance: player.balance,
      rakebackAccumulated: player.rakebackPending,
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

  // Leaderboard data for UI
  getLeaderboard(limit = 10) {
    return Array.from(this.players.values())
      .map(p => ({
        id: p.id,
        rolls: p.rolls,
        totalSpent: p.totalSpent,
        totalWon: p.totalWon,
        rakebackTotal: Number((p.rakebackPending + p.rakebackClaimed).toFixed(4)),
        balance: p.balance
      }))
      .sort((a, b) => b.rolls - a.rolls)
      .slice(0, limit);
  }

  // Global Protocol Snapshot
  getProtocolStats() {
    return {
      totalVolume: this.totalProtocolVolume,
      totalRolls: this.totalProtocolRolls,
      founderRevenue: this.founderRevenue,
      cushionReserve: this.cushionReserve,
      epochPool: this.epochPool,
      serverSeedHash: this.serverSeedHash,
      tables: this.tables,
      radar: this.getRadarTelemetry(),
      recentHits: this.recentHits.slice(0, 10),
      topBots: this.getLeaderboard(10)
    };
  }
}

module.exports = { MultiTableArenaEngine, TABLES_CONFIG };
