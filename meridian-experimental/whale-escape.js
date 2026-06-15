/**
 * Whale Escape Detector
 *
 * Detects large TVL withdrawals that may indicate whale selling,
 * and triggers position close before price dumps.
 *
 * Metrics tracked:
 * - Net deposit/withdrawal over a configurable window
 * - TVL percentage change
 * - Price proximity to bottom bin
 */

import { log } from "./logger.js";
import { config } from "./config.js";
import { getTrackedPosition } from "./state.js";
import { notifyWhaleEscapeWarn } from "./telegram.js";

const DEFAULT_CONFIG = {
  enabled: true,
  tvlPctWarn: 8,        // warn threshold % TVL drop
  tvlPctClose: 15,      // close threshold % TVL drop
  minWithdrawPct: 10,   // minimum withdrawal % of TVL for condition 2
  legacyAb: 5000,       // legacy absolute threshold
  netDepCache: 30,      // minutes to cache net deposit data
  priceDistBins: 5,     // close if price within N bins of bottom
};

function getConfig() {
  return { ...DEFAULT_CONFIG, ...config.management?.whaleEscape };
}

/**
 * Store TVL snapshots per pool for detecting changes.
 * Key: poolAddress, Value: [{ ts, tvlUsd, activeBin }]
 */
const tvlSnapshots = new Map();
const MAX_SNAPSHOTS = 12; // ~2h at 10min intervals

/**
 * Clear TVL snapshots for a specific pool.
 */
export function clearTvlSnapshots(poolAddress) {
  if (!poolAddress) return;
  tvlSnapshots.delete(poolAddress);
  log("whale_escape", `Cleared TVL snapshots for ${poolAddress}`);
}

/**
 * Record a TVL snapshot for a pool.
 */
export function recordTvlSnapshot(poolAddress, { tvlUsd, activeBin }) {
  if (!poolAddress || tvlUsd == null) return;
  if (!tvlSnapshots.has(poolAddress)) {
    tvlSnapshots.set(poolAddress, []);
  }
  const snaps = tvlSnapshots.get(poolAddress);
  snaps.push({ ts: Date.now(), tvlUsd, activeBin });
  // Keep only last MAX_SNAPSHOTS
  if (snaps.length > MAX_SNAPSHOTS) {
    snaps.splice(0, snaps.length - MAX_SNAPSHOTS);
  }
}

/**
 * Calculate net deposit/withdrawal over the cache window.
 * Returns { netDepUsd, tvlPctChange, currentTvl, oldestTvl, oldestAge }
 */
export function getNetDepositData(poolAddress) {
  const snaps = tvlSnapshots.get(poolAddress);
  if (!snaps || snaps.length < 2) return null;

  const cfg = getConfig();
  const windowMs = cfg.netDepCache * 60 * 1000;
  const now = Date.now();
  const cutoff = now - windowMs;

  // Find oldest snapshot within window
  let oldest = snaps[0];
  for (const s of snaps) {
    if (s.ts >= cutoff) break;
    oldest = s;
  }

  const current = snaps[snaps.length - 1];
  const netDepUsd = current.tvlUsd - oldest.tvlUsd;
  const tvlPctChange = oldest.tvlUsd > 0
    ? ((current.tvlUsd - oldest.tvlUsd) / oldest.tvlUsd) * 100
    : 0;

  return {
    netDepUsd,
    tvlPctChange,
    currentTvl: current.tvlUsd,
    oldestTvl: oldest.tvlUsd,
    oldestAge: Math.floor((now - oldest.ts) / 60000),
    currentBin: current.activeBin,
  };
}

/**
 * Check if a position should be closed due to whale escape.
 *
 * @param {Object} position - Position data from getMyPositions()
 * @returns {{ action: string, rule: number, reason: string } | null}
 */
export function checkWhaleEscape(position) {
  const cfg = getConfig();
  if (!cfg.enabled) return null;

  const { pool, lower_bin, upper_bin, active_bin, total_value_usd } = position;
  if (!pool) return null;

  const netData = getNetDepositData(pool);
  if (!netData) return null;

  const { netDepUsd, tvlPctChange, currentTvl, currentBin } = netData;

  // ── Check 1: TVL percentage drop exceeds close threshold ──
  const tvlDropPct = Math.abs(Math.min(0, tvlPctChange));
  if (tvlDropPct >= cfg.tvlPctClose) {
    const binDist = currentBin != null && lower_bin != null ? currentBin - lower_bin : null;
    const nearBottom = binDist != null && binDist <= cfg.priceDistBins;

    const reason = `Whale Escape; Net Dep ${netDepUsd >= 0 ? "+" : ""}${Math.round(netDepUsd)} USD (${tvlPctChange.toFixed(1)}% of TVL ($${Math.round(currentTvl)}))${nearBottom ? ` & Price near bottom bin (dist: ${binDist})` : ""}`;

    log("whale_escape", `CLOSE triggered for ${position.pair}: ${reason}`);
    return { action: "CLOSE", rule: 6, reason };
  }

  // ── Check 2: Large absolute withdrawal + price near bottom ──
  const minWithdrawPct = cfg.minWithdrawPct ?? 10; // minimum withdrawal % of TVL
  const minWithdrawUsd = currentTvl * (minWithdrawPct / 100);
  if (netDepUsd < -minWithdrawUsd && currentBin != null && lower_bin != null) {
    const binDist = currentBin - lower_bin;
    if (binDist <= cfg.priceDistBins) {
      const reason = `Whale Escape; Large withdraw ${Math.round(netDepUsd)} USD (>${minWithdrawPct}% of TVL) & Price near bottom bin (dist: ${binDist})`;
      log("whale_escape", `CLOSE triggered for ${position.pair}: ${reason}`);
      return { action: "CLOSE", rule: 6, reason };
    }
  }

  // ── Warn if approaching threshold ──
  if (tvlDropPct >= cfg.tvlPctWarn && tvlDropPct < cfg.tvlPctClose) {
    log("whale_escape_warn", `TVL drop ${tvlDropPct.toFixed(1)}% for ${position.pair} (warn ${cfg.tvlPctWarn}%, close ${cfg.tvlPctClose}%)`);
    notifyWhaleEscapeWarn({
      pair: position.pair,
      tvlDropPct,
      currentTvl,
      netDepUsd,
      warnThreshold: cfg.tvlPctWarn,
      closeThreshold: cfg.tvlPctClose,
    }).catch(() => null);
  }

  return null;
}

/**
 * Get whale escape status for a pool (for reporting).
 */
export function getWhaleEscapeStatus(poolAddress) {
  const netData = getNetDepositData(poolAddress);
  if (!netData) return null;

  const cfg = getConfig();
  const { netDepUsd, tvlPctChange, currentTvl, oldestAge } = netData;

  return {
    netDepUsd: Math.round(netDepUsd),
    tvlPctChange: Math.round(tvlPctChange * 10) / 10,
    currentTvl: Math.round(currentTvl),
    windowMinutes: oldestAge,
    warnThreshold: cfg.tvlPctWarn,
    closeThreshold: cfg.tvlPctClose,
  };
}
