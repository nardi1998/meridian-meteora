/**
 * Order Block Detection Module
 * 
 * Detects order blocks across multiple timeframes with priority:
 * 1H → 30M → 15M → 5M
 * 
 * Order Block = Consolidation zone before impulsive move (institutional accumulation)
 * 
 * SMC Rules:
 * - Do NOT open if price already touched OB/FVG and rejected without new ATH
 * - CAN open if price returns to OB (second touch)
 */

import { config } from "../config.js";
import { log } from "../logger.js";

const TIMEFRAME_PRIORITY = ["1H", "30M", "15M", "5M"];

const TIMEFRAME_MS = {
  "5M": 5 * 60 * 1000,
  "15M": 15 * 60 * 1000,
  "30M": 30 * 60 * 1000,
  "1H": 60 * 60 * 1000,
};

/**
 * Fetch candle data from Agent Meridian API
 */
async function fetchCandles(mint, timeframe, limit = 100) {
  const apiBase = String(config.api.url || "https://api.agentmeridian.xyz/api").replace(/\/+$/, "");
  const headers = {};
  if (config.api.publicApiKey) headers["x-api-key"] = config.api.publicApiKey;

  // Map our timeframe to API format
  const apiTimeframe = timeframe === "1H" ? "1HOUR" : timeframe === "30M" ? "30_MINUTE" : timeframe === "15M" ? "15_MINUTE" : "5_MINUTE";
  
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
 * Find order block across multiple timeframes with priority
 * 
 * @param {string} mint - Token mint address
 * @param {number} currentPrice - Current price for reference
 * @param {Object} options - Options
 * @returns {Object|null} - Order block zone with metadata
 */
export async function findOrderBlock(mint, currentPrice, options = {}) {
  const {
    timeframes = config.screening.orderBlockTimeframes || TIMEFRAME_PRIORITY,
    minStrength = 0.5,
    maxDistancePct = config.screening.orderBlockCoveragePct || 20,
  } = options;

  const maxDistance = currentPrice * (maxDistancePct / 100);

  for (const timeframe of timeframes) {
    try {
      log("orderblock", `Checking ${timeframe} for order block...`);
      
      const candles = await fetchCandles(mint, timeframe, 100);
      
      if (!candles || candles.length < 10) {
        log("orderblock", `${timeframe}: Insufficient candle data (${candles?.length || 0} candles)`);
        continue;
      }

      const ob = detectOrderBlock(candles, timeframe);
      const fvgs = detectFVG(candles, timeframe);
      
      if (!ob && fvgs.length === 0) {
        log("orderblock", `${timeframe}: No order block or FVG detected`);
        continue;
      }

      // Analyze rejection pattern
      const rejectionAnalysis = analyzeOBRejection(candles, ob, fvgs, currentPrice);
      
      if (rejectionAnalysis.rejected && !rejectionAnalysis.canOpen) {
        log("orderblock", `${timeframe}: REJECTED - ${rejectionAnalysis.reason}`);
        return {
          found: false,
          rejected: true,
          canOpen: false,
          timeframe,
          reason: rejectionAnalysis.reason,
          analysis: rejectionAnalysis,
        };
      }

      // Check if OB is within acceptable distance
      if (ob) {
        const distance = Math.abs(currentPrice - ob.mid);
        if (distance > maxDistance * 2) {
          log("orderblock", `${timeframe}: Order block too far (${(distance/currentPrice*100).toFixed(1)}% away)`);
          continue;
        }

        // Check strength
        if (ob.strength < minStrength) {
          log("orderblock", `${timeframe}: Order block too weak (${(ob.strength*100).toFixed(0)}%)`);
          continue;
        }

        log("orderblock", `${timeframe}: Found order block at ${ob.low.toFixed(8)}-${ob.high.toFixed(8)} (strength: ${(ob.strength*100).toFixed(0)}%)`);

        return {
          ...ob,
          found: true,
          distanceFromCurrent: distance,
          distancePct: (distance / currentPrice) * 100,
          coveredByDefault: ob.low >= (currentPrice - maxDistance),
          rejectionAnalysis,
          fvgs: fvgs.slice(0, 3), // Return top 3 FVGs
        };
      }

    } catch (error) {
      log("orderblock", `${timeframe}: Error - ${error.message}`);
      continue;
    }
  }

  log("orderblock", "No order block found in any timeframe");
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

  const rejectionInfo = orderBlock.rejectionAnalysis?.rejected 
    ? ` | Touch: ${orderBlock.rejectionAnalysis.touchCount}x`
    : '';

  return `Order Block (${orderBlock.timeframe}): ${orderBlock.low.toFixed(8)}-${orderBlock.high.toFixed(8)} | Direction: ${orderBlock.direction} | Strength: ${(orderBlock.strength * 100).toFixed(0)}% | Distance: ${orderBlock.distancePct.toFixed(1)}%${rejectionInfo}`;
}
