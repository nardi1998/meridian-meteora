/**
 * Order Block Detection Module
 * 
 * Detects order blocks across multiple timeframes with pool-age priority:
 * - Pool age < 12h: 1H → 30M → 15M → 5M
 * - Pool age >= 12h: 2H → 1H → 30M
 * 
 * Fresh Zone Logic:
 * - Find FVG/OB that hasn't been touched yet
 * - If cover >70%, fallback to lower timeframe
 * - SMC rejection always enabled
 * 
 * SMC Rules:
 * - Do NOT open if price already touched OB/FVG and rejected without new ATH
 * - CAN open if price returns to OB (second touch)
 */

import { config } from "../config.js";
import { log } from "../logger.js";

const TIMEFRAME_PRIORITY = ["1H", "30M", "15M", "5M"];
const MAX_COVER_PCT = 70; // Maximum cover percentage before falling back to lower timeframe

const TIMEFRAME_MS = {
  "5M": 5 * 60 * 1000,
  "15M": 15 * 60 * 1000,
  "30M": 30 * 60 * 1000,
  "1H": 60 * 60 * 1000,
  "2H": 2 * 60 * 60 * 1000,
};

/**
 * Get timeframes based on pool age
 * @param {number} poolAgeHours - Pool age in hours
 * @returns {Array} - Array of timeframes
 */
function getTimeframesForPoolAge(poolAgeHours) {
  if (poolAgeHours < 12) {
    return ["1H", "30M", "15M", "5M"];
  }
  return ["2H", "1H", "30M"];
}

/**
 * Check if price has touched a zone (FVG/OB)
 * @param {Array} candles - Candle data
 * @param {number} zoneHigh - Zone high price
 * @param {number} zoneLow - Zone low price
 * @param {number} afterIndex - Only check candles after this index
 * @returns {boolean} - true if zone was touched
 */
function isZoneTouched(candles, zoneHigh, zoneLow, afterIndex = 0) {
  for (let i = afterIndex; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;
    // Touch = candle low entered the zone
    if (c.low <= zoneHigh && c.low >= zoneLow) {
      return true;
    }
  }
  return false;
}

/**
 * Find all FVGs and OBs below current price, sorted by distance (closest first)
 * @param {Array} candles - Candle data
 * @param {string} timeframe - Timeframe label
 * @param {number} currentPrice - Current price
 * @returns {Array} - Sorted array of FVGs and OBs below current price
 */
function findAllFVGsAndOBs(candles, timeframe, currentPrice) {
  const fvgResults = detectFVG(candles, timeframe);
  const obResults = detectAllOrderBlocks(candles, timeframe);
  
  const allZones = [];
  
  // Add FVGs that are below current price
  for (const fvg of fvgResults) {
    if (fvg.high < currentPrice) {
      allZones.push({
        ...fvg,
        zoneType: fvg.type === "bullish" ? "fvg_bullish" : "fvg_bearish",
        zoneHigh: fvg.high,
        zoneLow: fvg.low,
      });
    }
  }
  
  // Add OBs that are below current price
  for (const ob of obResults) {
    if (ob.high < currentPrice) {
      allZones.push({
        ...ob,
        zoneType: `ob_${ob.direction}`,
        zoneHigh: ob.high,
        zoneLow: ob.low,
      });
    }
  }
  
  // Sort by distance from current price (closest first)
  allZones.sort((a, b) => {
    const distA = currentPrice - a.zoneHigh;
    const distB = currentPrice - b.zoneHigh;
    return distA - distB;
  });
  
  return allZones;
}

/**
 * Fetch candle data from Agent Meridian API
 */
async function fetchCandles(mint, timeframe, limit = 100) {
  const apiBase = String(config.api.url || "https://api.agentmeridian.xyz/api").replace(/\/+$/, "");
  const headers = {};
  if (config.api.publicApiKey) headers["x-api-key"] = config.api.publicApiKey;

  // Map our timeframe to API format
  const apiTimeframe = timeframe === "2H" ? "2HOUR" 
    : timeframe === "1H" ? "1HOUR" 
    : timeframe === "30M" ? "30_MINUTE" 
    : timeframe === "15M" ? "15_MINUTE" 
    : "5_MINUTE";
  
  const search = new URLSearchParams({
    interval: apiTimeframe,
    candles: String(limit),
  });

  const res = await fetch(`${apiBase}/chart-indicators/${mint}?${search.toString()}`, {
    headers,
  });

  if (!res.ok) {
    throw new Error(`Candle fetch failed: ${res.status}`);
  }

  const data = await res.json();
  return data?.candles || [];
}

/**
 * Detect order block from candle data
 * 
 * Order Block Detection Logic:
 * 1. Find consolidation zone (small bodies, tight range)
 * 2. Followed by impulsive move (large candle in one direction)
 * 3. The consolidation zone is the order block
 * 
 * @param {Array} candles - Array of OHLCV candles
 * @param {string} timeframe - Timeframe label
 * @returns {Object|null} - Order block zone or null
 */
function detectOrderBlock(candles, timeframe) {
  if (!candles || candles.length < 10) return null;

  // Look for pattern: consolidation → breakout
  // Consolidation = candles with small bodies relative to range
  // Breakout = large candle closing strongly in one direction

  const results = [];

  for (let i = 5; i < candles.length - 3; i++) {
    const current = candles[i];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];
    const next3 = candles[i + 3];

    if (!current || !next1 || !next2 || !next3) continue;

    // Calculate body size and range
    const bodySize = Math.abs(current.close - current.open);
    const range = current.high - current.low;
    
    // Skip if no range (doji-like)
    if (range === 0) continue;

    // Check for consolidation (small body relative to range)
    const bodyRatio = bodySize / range;
    const isConsolidation = bodyRatio < 0.4; // Body < 40% of range

    if (!isConsolidation) continue;

    // Check for impulsive move after consolidation
    const next1Body = Math.abs(next1.close - next1.open);
    const next1Range = next1.high - next1.low;
    const next1Ratio = next1Body / next1Range;

    // Impulsive = large body closing strongly
    const isImpulsive = next1Ratio > 0.6 && (
      (next1.close > next1.open && next1.close > current.high) || // Bullish breakout
      (next1.close < next1.open && next1.close < current.low)     // Bearish breakout
    );

    if (!isImpulsive) continue;

    // Calculate order block zone
    const obHigh = current.high;
    const obLow = current.low;
    const obMid = (obHigh + obLow) / 2;

    // Determine direction
    const isBullishOB = next1.close > next1.open; // Bullish breakout (OB is support)

    results.push({
      timeframe,
      high: obHigh,
      low: obLow,
      mid: obMid,
      direction: isBullishOB ? "bullish" : "bearish",
      strength: 1 - bodyRatio, // Smaller body = stronger OB
      candleIndex: i,
      timestamp: current.timestamp || current.time,
    });
  }

  // Return strongest (most recent) order block
  if (results.length === 0) return null;

  // Sort by strength and recency
  results.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    return b.candleIndex - a.candleIndex;
  });

  return results[0];
}

/**
 * Detect ALL order blocks from candle data (returns array)
 * @param {Array} candles - Array of OHLCV candles
 * @param {string} timeframe - Timeframe label
 * @returns {Array} - Array of all order blocks found
 */
function detectAllOrderBlocks(candles, timeframe) {
  if (!candles || candles.length < 10) return [];

  const results = [];

  for (let i = 5; i < candles.length - 3; i++) {
    const current = candles[i];
    const next1 = candles[i + 1];

    if (!current || !next1) continue;

    const bodySize = Math.abs(current.close - current.open);
    const range = current.high - current.low;
    
    if (range === 0) continue;

    const bodyRatio = bodySize / range;
    const isConsolidation = bodyRatio < 0.4;

    if (!isConsolidation) continue;

    const next1Body = Math.abs(next1.close - next1.open);
    const next1Range = next1.high - next1.low;
    const next1Ratio = next1Body / next1Range;

    const isImpulsive = next1Ratio > 0.6 && (
      (next1.close > next1.open && next1.close > current.high) ||
      (next1.close < next1.open && next1.close < current.low)
    );

    if (!isImpulsive) continue;

    const isBullishOB = next1.close > next1.open;

    results.push({
      timeframe,
      high: current.high,
      low: current.low,
      mid: (current.high + current.low) / 2,
      direction: isBullishOB ? "bullish" : "bearish",
      strength: 1 - bodyRatio,
      candleIndex: i,
      timestamp: current.timestamp || current.time,
    });
  }

  // Sort by recency (most recent first)
  results.sort((a, b) => b.candleIndex - a.candleIndex);
  
  return results;
}

/**
 * Detect Fair Value Gap (FVG) from candle data
 * 
 * FVG = Gap between candle 1 high and candle 3 low (bullish)
 *    or Gap between candle 1 low and candle 3 high (bearish)
 * 
 * @param {Array} candles - Array of OHLCV candles
 * @param {string} timeframe - Timeframe label
 * @returns {Array} - Array of FVG zones
 */
function detectFVG(candles, timeframe) {
  if (!candles || candles.length < 5) return [];

  const fvgs = [];

  for (let i = 2; i < candles.length - 1; i++) {
    const candle1 = candles[i - 2];
    const candle2 = candles[i - 1];
    const candle3 = candles[i];

    if (!candle1 || !candle2 || !candle3) continue;

    // Bullish FVG: Gap between candle1.high and candle3.low
    if (candle3.low > candle1.high) {
      fvgs.push({
        type: "bullish",
        high: candle3.low,
        low: candle1.high,
        mid: (candle3.low + candle1.high) / 2,
        timeframe,
        candleIndex: i,
        timestamp: candle2.timestamp || candle2.time,
      });
    }

    // Bearish FVG: Gap between candle1.low and candle3.high
    if (candle3.high < candle1.low) {
      fvgs.push({
        type: "bearish",
        high: candle1.low,
        low: candle3.high,
        mid: (candle1.low + candle3.high) / 2,
        timeframe,
        candleIndex: i,
        timestamp: candle2.timestamp || candle2.time,
      });
    }
  }

  return fvgs;
}

/**
 * Analyze if price has already touched OB/FVG and rejected without new ATH
 * 
 * SMC Rule:
 * - If price touched OB/FVG and rejected UP but didn't make new ATH → DO NOT OPEN
 * - If price returns to OB (second touch) → CAN OPEN
 * 
 * @param {Array} candles - Array of OHLCV candles
 * @param {Object} orderBlock - Detected order block
 * @param {Array} fvgs - Detected FVGs
 * @param {number} currentPrice - Current price
 * @returns {Object} - Rejection analysis result
 */
export function analyzeOBRejection(candles, orderBlock, fvgs, currentPrice) {
  if (!candles || candles.length < 10) {
    return { rejected: false, canOpen: true, reason: "Insufficient data" };
  }

  // Find the ATH (All Time High) in the candle data
  const ath = Math.max(...candles.map(c => c.high));
  const athCandleIndex = candles.findIndex(c => c.high === ath);
  
  // Check if current price is at or near ATH
  const isAtATH = currentPrice >= ath * 0.98; // Within 2% of ATH

  // Check for OB rejection pattern
  if (orderBlock && orderBlock.found) {
    const obHigh = orderBlock.high;
    const obLow = orderBlock.low;
    
    // Find candles that touched the OB zone
    const touchCandles = candles.filter((c, idx) => {
      const touchedOB = c.low <= obHigh && c.low >= obLow;
      return touchedOB && idx < candles.length - 5; // Not the most recent candles
    });

    if (touchCandles.length > 0) {
      // Found touch(es) to OB
      const lastTouch = touchCandles[touchCandles.length - 1];
      const lastTouchIndex = candles.indexOf(lastTouch);
      
      // Check price action after the touch
      const candlesAfterTouch = candles.slice(lastTouchIndex + 1);
      
      if (candlesAfterTouch.length > 0) {
        // Find the high after touch
        const highAfterTouch = Math.max(...candlesAfterTouch.map(c => c.high));
        const lowAfterTouch = Math.min(...candlesAfterTouch.map(c => c.low));
        
        // Check if price rejected upward from OB
        const rejectedUpward = highAfterTouch > obHigh;
        
        // Check if new ATH was made after touch
        const madeNewATH = highAfterTouch > ath;
        
        // Check if price came back to OB (second touch)
        const cameBackToOB = lowAfterTouch <= obHigh && lowAfterTouch >= obLow * 0.98;
        
        // Check if current price is near OB (potential second touch)
        const currentNearOB = currentPrice <= obHigh * 1.05 && currentPrice >= obLow * 0.95;

        if (rejectedUpward && !madeNewATH) {
          // Price touched OB, rejected up, but NO new ATH
          if (cameBackToOB || currentNearOB) {
            // Price came back to OB - this is second touch, CAN open
            return {
              rejected: true,
              canOpen: true,
              touchCount: 2,
              reason: `Second touch to OB after rejection without new ATH. Valid entry.`,
              lastTouchPrice: lastTouch.low,
              highAfterRejection: highAfterTouch,
              athAtTouch: ath,
            };
          } else {
            // Price rejected and hasn't come back yet
            return {
              rejected: true,
              canOpen: false,
              touchCount: 1,
              reason: `OB already touched and rejected without new ATH. Wait for second touch.`,
              lastTouchPrice: lastTouch.low,
              highAfterRejection: highAfterTouch,
              athAtTouch: ath,
            };
          }
        }
      }
    }
  }

  // Check for FVG rejection pattern
  for (const fvg of fvgs) {
    const fvgHigh = fvg.high;
    const fvgLow = fvg.low;
    
    // Find candles that touched the FVG zone
    const touchCandles = candles.filter((c, idx) => {
      const touchedFVG = c.low <= fvgHigh && c.low >= fvgLow;
      return touchedFVG && idx < candles.length - 5;
    });

    if (touchCandles.length > 0) {
      const lastTouch = touchCandles[touchCandles.length - 1];
      const lastTouchIndex = candles.indexOf(lastTouch);
      
      const candlesAfterTouch = candles.slice(lastTouchIndex + 1);
      
      if (candlesAfterTouch.length > 0) {
        const highAfterTouch = Math.max(...candlesAfterTouch.map(c => c.high));
        const lowAfterTouch = Math.min(...candlesAfterTouch.map(c => c.low));
        
        const rejectedUpward = highAfterTouch > fvgHigh;
        const madeNewATH = highAfterTouch > ath;
        const cameBackToFVG = lowAfterTouch <= fvgHigh && lowAfterTouch >= fvgLow * 0.98;
        const currentNearFVG = currentPrice <= fvgHigh * 1.05 && currentPrice >= fvgLow * 0.95;

        if (rejectedUpward && !madeNewATH) {
          if (cameBackToFVG || currentNearFVG) {
            return {
              rejected: true,
              canOpen: true,
              touchCount: 2,
              reason: `Second touch to FVG after rejection without new ATH. Valid entry.`,
              lastTouchPrice: lastTouch.low,
              highAfterRejection: highAfterTouch,
              athAtTouch: ath,
            };
          } else {
            return {
              rejected: true,
              canOpen: false,
              touchCount: 1,
              reason: `FVG already touched and rejected without new ATH. Wait for second touch.`,
              lastTouchPrice: lastTouch.low,
              highAfterRejection: highAfterTouch,
              athAtTouch: ath,
            };
          }
        }
      }
    }
  }

  // No rejection pattern found
  return { rejected: false, canOpen: true, reason: "No rejection pattern detected" };
}

/**
 * Find order block across multiple timeframes with pool-age priority
 * 
 * Fresh Zone Logic:
 * - Find FVG/OB that hasn't been touched yet
 * - If cover >70%, fallback to lower timeframe (30M → 15M → 5M)
 * - SMC rejection still applies to fresh zones
 * 
 * @param {string} mint - Token mint address
 * @param {number} currentPrice - Current price for reference
 * @param {Object} options - Options
 * @param {number} options.poolAgeHours - Pool age in hours (determines timeframes)
 * @param {Array} options.timeframes - Override timeframes (ignores pool age)
 * @param {number} options.minStrength - Minimum OB strength (default: 0.5)
 * @param {number} options.maxDistancePct - Max distance % from current price (default: 20)
 * @param {number} options.maxCoverPct - Max cover percentage (default: 70)
 * @returns {Object|null} - Order block zone with metadata
 */
export async function findOrderBlock(mint, currentPrice, options = {}) {
  const {
    poolAgeHours,
    timeframes: overrideTimeframes,
    minStrength = 0.5,
    maxDistancePct = config.screening.orderBlockCoveragePct || 20,
    maxCoverPct = config.screening.orderBlockMaxCoverPct || MAX_COVER_PCT,
  } = options;

  // Determine timeframes based on pool age
  let timeframes;
  if (overrideTimeframes) {
    timeframes = overrideTimeframes;
  } else if (poolAgeHours != null) {
    timeframes = getTimeframesForPoolAge(poolAgeHours);
    log("orderblock", `Pool age: ${poolAgeHours}h → Using timeframes: ${timeframes.join(", ")}`);
  } else {
    timeframes = config.screening.orderBlockTimeframes || TIMEFRAME_PRIORITY;
  }

  const maxDistance = currentPrice * (maxDistancePct / 100);

  for (const timeframe of timeframes) {
    try {
      log("orderblock", `Checking ${timeframe} for fresh FVG/OB...`);
      
      const candles = await fetchCandles(mint, timeframe, 100);
      
      if (!candles || candles.length < 10) {
        log("orderblock", `${timeframe}: Insufficient candle data (${candles?.length || 0} candles)`);
        continue;
      }

      // Find all FVGs and OBs below current price
      const allZones = findAllFVGsAndOBs(candles, timeframe, currentPrice);
      
      if (allZones.length === 0) {
        log("orderblock", `${timeframe}: No FVG/OB found below current price`);
        continue;
      }

      log("orderblock", `${timeframe}: Found ${allZones.length} zones below current price`);

      // Check each zone for freshness and cover percentage
      for (const zone of allZones) {
        // Check if zone is too far
        const distance = currentPrice - zone.zoneHigh;
        if (distance > maxDistance * 2) {
          log("orderblock", `${timeframe}: Zone ${zone.zoneType} too far (${(distance/currentPrice*100).toFixed(1)}% away)`);
          continue;
        }

        // Check zone strength (for OB only)
        if (zone.zoneType?.startsWith("ob_") && zone.strength < minStrength) {
          log("orderblock", `${timeframe}: Zone ${zone.zoneType} too weak (${(zone.strength*100).toFixed(0)}%)`);
          continue;
        }

        // Check if zone has been touched AFTER it was created
        const zoneCandleIndex = zone.candleIndex || 0;
        const touched = isZoneTouched(candles, zone.zoneHigh, zone.zoneLow, zoneCandleIndex + 1);
        
        if (touched) {
          log("orderblock", `${timeframe}: Zone ${zone.zoneType} at ${zone.zoneLow.toFixed(8)}-${zone.zoneHigh.toFixed(8)} already TOUCHED`);
          continue;
        }

        // Zone is FRESH - check cover percentage
        const coverPct = ((currentPrice - zone.zoneLow) / currentPrice) * 100;
        
        log("orderblock", `${timeframe}: Fresh ${zone.zoneType} at ${zone.zoneLow.toFixed(8)}-${zone.zoneHigh.toFixed(8)} | Cover: ${coverPct.toFixed(1)}%`);
        
        if (coverPct > maxCoverPct) {
          log("orderblock", `${timeframe}: Cover ${coverPct.toFixed(1)}% exceeds max ${maxCoverPct}%, trying next zone or timeframe`);
          continue;
        }

        // Found a fresh zone within cover limit!

        // Run SMC rejection check on this zone
        const singleOB = zone.zoneType?.startsWith("ob_") ? {
          found: true,
          high: zone.zoneHigh,
          low: zone.zoneLow,
          mid: zone.mid,
          direction: zone.direction,
        } : null;
        
        const singleFVG = zone.zoneType?.startsWith("fvg_") ? [{
          high: zone.zoneHigh,
          low: zone.zoneLow,
          mid: zone.mid,
          type: zone.zoneType === "fvg_bullish" ? "bullish" : "bearish",
        }] : [];
        
        const rejectionAnalysis = analyzeOBRejection(candles, singleOB, singleFVG, currentPrice);
        
        if (rejectionAnalysis.rejected && !rejectionAnalysis.canOpen) {
          log("orderblock", `${timeframe}: SMC REJECTED - ${rejectionAnalysis.reason}`);
          return {
            found: false,
            rejected: true,
            canOpen: false,
            timeframe,
            reason: rejectionAnalysis.reason,
            analysis: rejectionAnalysis,
          };
        }

        log("orderblock", `${timeframe}: ✅ Using fresh ${zone.zoneType} | Cover: ${coverPct.toFixed(1)}% | Bins needed: ${Math.ceil(coverPct)}`);

        return {
          found: true,
          timeframe,
          type: zone.zoneType,
          high: zone.zoneHigh,
          low: zone.zoneLow,
          mid: (zone.zoneHigh + zone.zoneLow) / 2,
          coverPct,
          isFresh: true,
          direction: zone.direction || "bullish",
          strength: zone.strength || 0.7,
          distanceFromCurrent: distance,
          distancePct: (distance / currentPrice) * 100,
          rejectionAnalysis,
        };
      }

      log("orderblock", `${timeframe}: No fresh zone within ${maxCoverPct}% cover limit`);

    } catch (error) {
      log("orderblock", `${timeframe}: Error - ${error.message}`);
      continue;
    }
  }

  log("orderblock", "No fresh FVG/OB found within cover limit in any timeframe");
  return { found: false, timeframe: null };
}

/**
 * Calculate bins needed to cover order block
 * 
 * @param {Object} orderBlock - Order block from findOrderBlock
 * @param {number} currentPrice - Current price
 * @param {number} binStep - Pool bin step in bps
 * @returns {number} - Bins needed to cover OB low
 */
export function calculateBinsForOrderBlock(orderBlock, currentPrice, binStep) {
  if (!orderBlock || !orderBlock.found) return 0;

  // Use coverPct if available (new fresh zone format)
  if (orderBlock.coverPct != null) {
    const binsNeeded = Math.ceil(orderBlock.coverPct / (binStep / 100));
    return Math.max(0, binsNeeded);
  }

  // Fallback to price difference calculation
  const priceDiff = currentPrice - orderBlock.low;
  const priceDiffPct = (priceDiff / currentPrice) * 100;
  const binsNeeded = Math.ceil(priceDiffPct / (binStep / 100));

  return Math.max(0, binsNeeded);
}

/**
 * Get order block summary for logging/reporting
 */
export function getOrderBlockSummary(orderBlock) {
  if (!orderBlock || !orderBlock.found) {
    if (orderBlock?.rejected) {
      return `REJECTED: ${orderBlock.reason}`;
    }
    return "No order block detected";
  }

  const freshTag = orderBlock.isFresh ? " [FRESH]" : "";
  const coverInfo = orderBlock.coverPct != null ? ` | Cover: ${orderBlock.coverPct.toFixed(1)}%` : "";
  const rejectionInfo = orderBlock.rejectionAnalysis?.rejected 
    ? ` | Touch: ${orderBlock.rejectionAnalysis.touchCount}x`
    : '';

  return `${orderBlock.type || "OB"} (${orderBlock.timeframe})${freshTag}: ${orderBlock.low.toFixed(8)}-${orderBlock.high.toFixed(8)} | Direction: ${orderBlock.direction} | Strength: ${(orderBlock.strength * 100).toFixed(0)}%${coverInfo}${rejectionInfo}`;
}

// ─── Young Token Rejection Rule ─────────────────────────────────
// For tokens < 12h old:
// - If price dropped >45% from ATH then rejected upward but new ATH
//   does NOT exceed old ATH by >35% → block deploy
// - CAN open if price returns to the drop zone (where it dropped to)
const YOUNG_TOKEN_ATH_DROP_PCT = 45;    // max drop from ATH to trigger rule
const YOUNG_TOKEN_NEW_ATH_BOOST_PCT = 35; // new ATH must exceed old by this %
const YOUNG_TOKEN_MAX_AGE_HOURS = 12;

export async function checkYoungTokenRejection(mint, currentPrice, poolAgeHours) {
  if (poolAgeHours == null || poolAgeHours >= YOUNG_TOKEN_MAX_AGE_HOURS) {
    return { rejected: false, canOpen: true };
  }

  try {
    // Fetch 1H candles to calculate ATH and lowest point
    const candles = await fetchCandles(mint, "1H", 100);
    if (!candles || candles.length < 5) {
      return { rejected: false, canOpen: true, reason: "Insufficient candle data" };
    }

    // Calculate ATH and lowest point from all candles
    const ath = Math.max(...candles.map(c => c.high));
    const lowestPoint = Math.min(...candles.map(c => c.low));
    if (ath <= 0 || currentPrice <= 0) {
      return { rejected: false, canOpen: true };
    }

    // Check if price dropped >45% from ATH
    const dropPct = ((ath - currentPrice) / ath) * 100;
    if (dropPct <= YOUNG_TOKEN_ATH_DROP_PCT) {
      return { rejected: false, canOpen: true, reason: `Drop ${dropPct.toFixed(1)}% <= ${YOUNG_TOKEN_ATH_DROP_PCT}% threshold` };
    }

    // Price dropped >45% from ATH — check if new ATH was made (>35% above old ATH)
    const newAthThreshold = ath * (1 + YOUNG_TOKEN_NEW_ATH_BOOST_PCT / 100);
    const madeValidNewATH = currentPrice >= newAthThreshold;

    if (madeValidNewATH) {
      return {
        rejected: false,
        canOpen: true,
        reason: `Valid new ATH: ${currentPrice.toFixed(8)} >= ${newAthThreshold.toFixed(8)} (old ATH: ${ath.toFixed(8)})`,
        ath,
        dropPct,
      };
    }

    // Dropped >45% but no valid new ATH — check if price returned to drop zone
    // Drop zone = lowest point where price dropped to
    // If current price is near the lowest point, it's a second touch to the drop zone
    const dropZoneHigh = lowestPoint * 1.05; // within 5% above lowest point
    const nearDropZone = currentPrice <= dropZoneHigh && currentPrice >= lowestPoint * 0.95;

    if (nearDropZone) {
      return {
        rejected: false,
        canOpen: true,
        touchCount: 2,
        reason: `Second touch to drop zone (${lowestPoint.toFixed(8)}-${dropZoneHigh.toFixed(8)}) after ${dropPct.toFixed(1)}% drop from ATH. Valid entry.`,
        ath,
        dropPct,
        lowestPoint,
      };
    }

    // Rejected upward but no valid new ATH and not at drop zone — block
    return {
      rejected: true,
      canOpen: false,
      reason: `Young token (<${YOUNG_TOKEN_MAX_AGE_HOURS}h): dropped ${dropPct.toFixed(1)}% from ATH (${ath.toFixed(8)}) to ${lowestPoint.toFixed(8)}, rejected but no valid new ATH (needs >${YOUNG_TOKEN_NEW_ATH_BOOST_PCT}% above old = ${newAthThreshold.toFixed(8)}). Current: ${currentPrice.toFixed(8)}. Wait for price to return to drop zone (${lowestPoint.toFixed(8)}-${dropZoneHigh.toFixed(8)}).`,
      ath,
      dropPct,
      lowestPoint,
    };
  } catch (error) {
    log("orderblock", `Young token rejection check failed: ${error.message}`);
    return { rejected: false, canOpen: true, reason: `Check failed: ${error.message}` };
  }
}
