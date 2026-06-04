/**
 * Pool Age Cache
 *
 * Tracks when each pool was first seen in screening.
 * Used to calculate pool age and compare with token age.
 * Stored in pool-age-cache.json.
 */

import fs from "fs";
import { log } from "./logger.js";

const CACHE_FILE = "./pool-age-cache.json";
const MAX_ENTRIES = 5000;
const MAX_AGE_DAYS = 90; // auto-remove entries older than 90 days

function load() {
  if (!fs.existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

/**
 * Record pool first seen timestamp.
 * Called when a pool passes initial screening filters.
 */
export function recordPoolFirstSeen(poolAddress, { tokenCreatedAt, name } = {}) {
  if (!poolAddress) return;
  const db = load();

  if (!db[poolAddress]) {
    db[poolAddress] = {
      first_seen: Date.now(),
      token_created_at: tokenCreatedAt || null,
      name: name || null,
    };

    // Trim old entries
    const keys = Object.keys(db);
    if (keys.length > MAX_ENTRIES) {
      const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
      for (const k of keys) {
        if (db[k]?.first_seen && db[k].first_seen < cutoff) delete db[k];
      }
    }

    save(db);
  }
}

/**
 * Get pool age in days.
 * @param {string} poolAddress
 * @returns {number | null} - age in days, or null if not cached
 */
export function getPoolAgeDays(poolAddress) {
  const db = load();
  const entry = db[poolAddress];
  if (!entry?.first_seen) return null;
  return Math.floor((Date.now() - entry.first_seen) / 86400000);
}

/**
 * Get full pool age info.
 */
export function getPoolAgeInfo(poolAddress) {
  const db = load();
  const entry = db[poolAddress];
  if (!entry) return null;

  const poolAgeDays = entry.first_seen
    ? Math.floor((Date.now() - entry.first_seen) / 86400000)
    : null;

  const tokenAgeDays = entry.token_created_at
    ? Math.floor((Date.now() - entry.token_created_at) / 86400000)
    : null;

  const ageDiffDays = (poolAgeDays != null && tokenAgeDays != null)
    ? Math.abs(tokenAgeDays - poolAgeDays)
    : null;

  return {
    pool_address: poolAddress,
    name: entry.name,
    first_seen: entry.first_seen ? new Date(entry.first_seen).toISOString() : null,
    pool_age_days: poolAgeDays,
    token_age_days: tokenAgeDays,
    age_diff_days: ageDiffDays,
  };
}

/**
 * Check if pool-token age difference exceeds threshold.
 * @param {string} poolAddress
 * @param {number} tokenCreatedAt - token creation timestamp (epoch ms)
 * @param {number} maxDiffDays - maximum allowed difference in days
 * @returns {{ skip: boolean, reason: string | null }}
 */
export function checkPoolTokenAgeDiff(poolAddress, tokenCreatedAt, maxDiffDays = 30) {
  const db = load();
  const entry = db[poolAddress];

  // Pool not yet cached — can't compare, allow it
  if (!entry?.first_seen) return { skip: false, reason: null };

  const poolAgeDays = Math.floor((Date.now() - entry.first_seen) / 86400000);
  const tokenAgeDays = tokenCreatedAt
    ? Math.floor((Date.now() - tokenCreatedAt) / 86400000)
    : null;

  if (tokenAgeDays == null) return { skip: false, reason: null };

  const diff = Math.abs(tokenAgeDays - poolAgeDays);

  if (diff > maxDiffDays) {
    return {
      skip: true,
      reason: `pool-token age diff ${diff}d > ${maxDiffDays}d (pool: ${poolAgeDays}d, token: ${tokenAgeDays}d)`,
    };
  }

  return { skip: false, reason: null };
}
