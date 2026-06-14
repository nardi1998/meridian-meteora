# Edit Plan: Apply experiment changes to meteora (preserving whale-escape)

## Strategy
- Apply `repo-root.js` path resolution pattern from experiment to all meteora files
- Apply new features from experiment (pnl config, feeSource, market fields, improved telegram, etc.)
- **PRESERVE** meteora-unique features: whale-escape, complex close rules (failed-target, time exit, age guards), solMode briefing, range bar in management report, whale escape notifications, extra OKX screening fields, minVolatility logic, etc.

---

## FILE 1: `.gitignore`
**ADD** (after line 12):
```
# Stray Claude Code worktrees
.claude/worktrees/
```
No other changes.

---

## FILE 2: `briefing.js`
**ADD** import of `repoPath` from `./repo-root.js`  
**CHANGE** `config` import to remove it (unused after changes)  
**CHANGE** `STATE_FILE` from `"./state.json"` to `repoPath("state.json")`  
**CHANGE** `LESSONS_FILE` from `"./lessons.json"` to `repoPath("lessons.json")`  
**PRESERVE** meteora's `solMode` / `cur` currency handling in briefing  
**CHANGE** variable names `totalPnL` → `totalPnLUsd`, `totalFees` → `totalFeesUsd`  
**CHANGE** PnL format from `${cur}${totalPnL.toFixed(4)}` → `$${totalPnLUsd.toFixed(2)}`  
**CHANGE** Fees format from `${cur}${totalFees.toFixed(4)}` → `$${totalFeesUsd.toFixed(2)}`  
**CHANGE** All-time PnL format from `${cur}${...}` → `$${...}`  
**NOTE**: These are experiment formatting changes. Decide if meteora's SOL-mode currency display should be kept or overridden.

### Edit 1a - imports:
```
oldString: import { config } from "./config.js";
import { getPerformanceSummary } from "./lessons.js";

const STATE_FILE = "./state.json";
const LESSONS_FILE = "./lessons.json";
newString: import { getPerformanceSummary } from "./lessons.js";
import { repoPath } from "./repo-root.js";

const STATE_FILE = repoPath("state.json");
const LESSONS_FILE = repoPath("lessons.json");
```

### Edit 1b - remove solMode/cur (if adopting experiment format):
```
oldString:  const solMode = config.management?.solMode;
  const cur = solMode ? "◎" : "$";

  // 1. Positions Activity
newString:  // 1. Positions Activity
```

### Edit 1c - PnL/Fees formatting:
```
oldString:  const totalPnL = perfLast24h.reduce((sum, p) => sum + (p.pnl_usd || 0), 0);
  const totalFees = perfLast24h.reduce((sum, p) => sum + (p.fees_earned_usd || 0), 0);
newString:  const totalPnLUsd = perfLast24h.reduce((sum, p) => sum + (p.pnl_usd || 0), 0);
  const totalFeesUsd = perfLast24h.reduce((sum, p) => sum + (p.fees_earned_usd || 0), 0);
```

### Edit 1d - format lines:
```
oldString:    `💰 Net PnL: ${totalPnL >= 0 ? "+" : ""}${cur}${totalPnL.toFixed(4)}`,
    `💎 Fees Earned: ${cur}${totalFees.toFixed(4)}`,
newString:    `💰 Net PnL: ${totalPnLUsd >= 0 ? "+" : ""}$${totalPnLUsd.toFixed(2)}`,
    `💎 Fees Earned: $${totalFeesUsd.toFixed(2)}`,
```

### Edit 1e - all-time PnL:
```
oldString:      ? `📊 All-time PnL: ${cur}${perfSummary.total_pnl_usd.toFixed(4)} (${perfSummary.win_rate_pct}% win)`
newString:      ? `📊 All-time PnL: $${perfSummary.total_pnl_usd.toFixed(2)} (${perfSummary.win_rate_pct}% win)`
```

---

## FILE 3: `config.js`
**ADD** import of `REPO_ROOT`, `repoPath` from `./repo-root.js`  
**ADD** import of `getScreeningDefaultsForTimeframe`, `normalizeTimeframe`, `scaleScreeningToTimeframe`, `TIMEFRAME_SCREENING_SCALES` from `./screening-scales.js`  
**ADD** re-export of those screening-scales symbols  
**CHANGE** `__dirname` + `path.join` → `repoPath()` for `USER_CONFIG_PATH` and `GMGN_CONFIG_PATH`  
**REMOVE** `import fs from "fs"`, `import path from "path"`, `import { fileURLToPath } from "url"`  
**CHANGE** `configuredMaxBinsBelow` default from `102` → `69`  
**ADD** `if (u.telegramChatId) process.env.TELEGRAM_CHAT_ID ||= String(u.telegramChatId);` after gmgn config  
**REMOVE** `maxVolatility` from screening defaults (it still exists in user-config)  
**ADD** `gmgn.feeSource` field  
**ADD** `config.pnl` section  
**PRESERVE** whale-escape config block in management  
**CHANGE** `takeProfitPct` to remove `Math.max(0.1, ...)` wrapper (experiment version)

### Edit 3a - imports:
```
oldString: import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "user-config.json");
const GMGN_CONFIG_PATH = path.join(__dirname, "gmgn-config.json");
newString: import fs from "fs";
import { REPO_ROOT, repoPath } from "./repo-root.js";
import { getScreeningDefaultsForTimeframe, normalizeTimeframe, scaleScreeningToTimeframe, TIMEFRAME_SCREENING_SCALES } from "./screening-scales.js";

export { REPO_ROOT, repoPath, getScreeningDefaultsForTimeframe, normalizeTimeframe, scaleScreeningToTimeframe, TIMEFRAME_SCREENING_SCALES };

const USER_CONFIG_PATH = repoPath("user-config.json");
const GMGN_CONFIG_PATH = repoPath("gmgn-config.json");
```

### Edit 3b - maxBinsBelow default:
```
oldString:  ?? (legacyBinsBelow != null ? Math.max(legacyBinsBelow, configuredMinBinsBelow) : 102);
newString:  ?? (legacyBinsBelow != null ? Math.max(legacyBinsBelow, configuredMinBinsBelow) : 69);
```

### Edit 3c - add telegramChatId env after gmgn key:
```
oldString:  process.env.GMGN_API_KEY ||= gmgnUserConfig.apiKey || u.gmgnApiKey;
}

const indicatorUserConfig = u.chartIndicators ?? {};
newString:  process.env.GMGN_API_KEY ||= gmgnUserConfig.apiKey || u.gmgnApiKey;
}
if (u.telegramChatId) process.env.TELEGRAM_CHAT_ID ||= String(u.telegramChatId);

const indicatorUserConfig = u.chartIndicators ?? {};
```

### Edit 3d - remove maxVolatility from screening:
```
oldString:    maxVolatility:     u.maxVolatility     ?? null, // null = no maximum
    timeframe:         u.timeframe         ?? "5m",
newString:    timeframe:         u.timeframe         ?? "5m",
```

### Edit 3e - add feeSource to gmgn:
```
oldString:  gmgn: {
    apiKey: nonEmptyString(gmgnUserConfig.apiKey, u.gmgnApiKey, process.env.GMGN_API_KEY),
    baseUrl: nonEmptyString(gmgnUserConfig.baseUrl, u.gmgnBaseUrl, "https://openapi.gmgn.ai"),
    interval: gmgnValue("interval", "gmgnInterval", "5m"),
newString:  gmgn: {
    apiKey: nonEmptyString(gmgnUserConfig.apiKey, u.gmgnApiKey, process.env.GMGN_API_KEY),
    baseUrl: nonEmptyString(gmgnUserConfig.baseUrl, u.gmgnBaseUrl, "https://openapi.gmgn.ai"),
    // gmgn = use GMGN /v1/token/info total_fee for global_fees_sol (minTokenFeesSol gate); jupiter = legacy Jupiter fees
    feeSource: nonEmptyString(gmgnUserConfig.feeSource, u.gmgnFeeSource, "gmgn"),
    interval: gmgnValue("interval", "gmgnInterval", "5m"),
```

### Edit 3f - change takeProfitPct:
```
oldString:    takeProfitPct:         Math.max(0.1, u.takeProfitPct ?? u.takeProfitFeePct ?? 5), // minimum 0.1% — prevents auto-close at 0% PnL
newString:    takeProfitPct:         u.takeProfitPct         ?? u.takeProfitFeePct ?? 5,
```

### Edit 3g - ADD pnl section after api section:
```
oldString:  api: {
    url: nonEmptyString(u.agentMeridianApiUrl, process.env.AGENT_MERIDIAN_API_URL, DEFAULT_AGENT_MERIDIAN_API_URL),
    publicApiKey: nonEmptyString(u.publicApiKey, process.env.PUBLIC_API_KEY, DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY),
    lpAgentRelayEnabled: u.lpAgentRelayEnabled ?? false,
  },

  jupiter: {
newString:  api: {
    url: nonEmptyString(u.agentMeridianApiUrl, process.env.AGENT_MERIDIAN_API_URL, DEFAULT_AGENT_MERIDIAN_API_URL),
    publicApiKey: nonEmptyString(u.publicApiKey, process.env.PUBLIC_API_KEY, DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY),
    lpAgentRelayEnabled: u.lpAgentRelayEnabled ?? false,
  },

  // ─── PnL fetcher / poller (public infra: RPC + Meteora deposits + Jupiter) ──
  pnl: {
    rpcUrl: nonEmptyString(u.pnlRpcUrl, process.env.PNL_RPC_URL, "https://pump.helius-rpc.com"),
    source: nonEmptyString(u.pnlSource, "rpc"), // rpc | meteora (fallback-only)
    pollIntervalSec: Number(u.pnlPollIntervalSec ?? 3),
    depositCacheTtlSec: Number(u.pnlDepositCacheTtlSec ?? 300),
  },

  jupiter: {
```

### Edit 3h - remove athFilterPct from reloadScreeningThresholds:
```
oldString:    if (fresh.athFilterPct      !== undefined) s.athFilterPct     = fresh.athFilterPct;
    if (fresh.maxBundlePct      != null) s.maxBundlePct     = fresh.maxBundlePct;
newString:    if (fresh.maxBundlePct      != null) s.maxBundlePct     = fresh.maxBundlePct;
```

---

## FILE 4: `decision-log.js`
**ADD** import of `repoPath` from `./repo-root.js`  
**CHANGE** `DECISION_LOG_FILE` from `"./decision-log.json"` to `repoPath("decision-log.json")`

### Edit 4:
```
oldString: import fs from "fs";

const DECISION_LOG_FILE = "./decision-log.json";
newString: import fs from "fs";
import { repoPath } from "./repo-root.js";

const DECISION_LOG_FILE = repoPath("decision-log.json");
```

---

## FILE 5: `dev-blocklist.js`
**ADD** import of `repoPath` from `./repo-root.js`  
**CHANGE** `BLOCKLIST_FILE` from `"./dev-blocklist.json"` to `repoPath("dev-blocklist.json")`

### Edit 5:
```
oldString: import fs from "fs";
import { log } from "./logger.js";

const BLOCKLIST_FILE = "./dev-blocklist.json";
newString: import fs from "fs";
import { log } from "./logger.js";
import { repoPath } from "./repo-root.js";

const BLOCKLIST_FILE = repoPath("dev-blocklist.json");
```

---

## FILE 6: `ecosystem.config.cjs`
**REPLACE** entire content with experiment version (path.join for script, merge_logs, time, comment).

---

## FILE 7: `envcrypt.js`
**ADD** import of `repoPath` from `./repo-root.js`  
**CHANGE** `DEFAULT_ENV_PATH` from `path.join(process.cwd(), ".env")` to `repoPath(".env")`  
**CHANGE** `DEFAULT_KEY_PATH` from `path.join(process.cwd(), ".envrypt")` to `repoPath(".envrypt")`  
**CHANGE** `loadEnv` override default from `false` to `true`  
**ADD** comment about override  
**CHANGE** `rawPath` default in `encryptEnvRaw` from `path.join(process.cwd(), ".env.raw")` to `repoPath(".env.raw")`

### Edit 7a - imports and paths:
```
oldString: import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const DEFAULT_ENV_PATH = path.join(process.cwd(), ".env");
const DEFAULT_KEY_PATH = path.join(process.cwd(), ".envrypt");
newString: import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { repoPath } from "./repo-root.js";

const DEFAULT_ENV_PATH = repoPath(".env");
const DEFAULT_KEY_PATH = repoPath(".envrypt");
```

### Edit 7b - override default:
```
oldString: export function loadEnv({ envPath = DEFAULT_ENV_PATH, keyPath = DEFAULT_KEY_PATH, override = false } = {}) {
  dotenv.config({ path: envPath, override, quiet: true });
newString: export function loadEnv({ envPath = DEFAULT_ENV_PATH, keyPath = DEFAULT_KEY_PATH, override = true } = {}) {
  // override=true so repo .env wins over stale PM2-injected env on restart
  dotenv.config({ path: envPath, override, quiet: true });
```

### Edit 7c - rawPath:
```
oldString:  rawPath = path.join(process.cwd(), ".env.raw"),
newString:  rawPath = repoPath(".env.raw"),
```

---

## FILE 8: `gmgn-config.example.json`
**ADD** `"feeSource": "gmgn",` after `"baseUrl"` line.

### Edit 8:
```
oldString:   "baseUrl": "https://openapi.gmgn.ai",
  "interval": "5m",
newString:   "baseUrl": "https://openapi.gmgn.ai",
  "feeSource": "gmgn",
  "interval": "5m",
```

---

## FILE 9: `hivemind.js`
**CHANGE** imports: remove `path` and `fileURLToPath`, add `repoPath`  
**CHANGE** path constants to use `repoPath()`  
**ADD** `numberOrNull` helper  
**ADD** `buildMarketFields` function  
**CHANGE** `buildLessonEvent` to include `market` and `context` fields  
**CHANGE** `pushHivePerformanceEvent` to include `market` field

### Edit 9a - imports:
```
oldString: import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { log } from "./logger.js";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "user-config.json");
const CACHE_PATH = path.join(__dirname, "hivemind-cache.json");
const PACKAGE_JSON_PATH = path.join(__dirname, "package.json");
newString: import fs from "fs";
import crypto from "crypto";
import { log } from "./logger.js";
import { config } from "./config.js";
import { repoPath } from "./repo-root.js";

const USER_CONFIG_PATH = repoPath("user-config.json");
const CACHE_PATH = repoPath("hivemind-cache.json");
const PACKAGE_JSON_PATH = repoPath("package.json");
```

### Edit 9b - add buildLessonEvent context/market (before buildLessonEvent):
Add `numberOrNull` and `buildMarketFields` functions before `buildLessonEvent`.

### Edit 9c - modify buildLessonEvent to add context + market fields.

### Edit 9d - modify pushHivePerformanceEvent to add market field.

---

## FILE 10: `index.js`
This is the largest and most complex file. Key changes:

**ADD** imports: `repoPath`, remove `swapToken` import  
**CHANGE** entrypoint detection to use `pm_id`  
**ADD** repo root logging at startup  
**REMOVE** whale-escape import and all whale-escape calls in management cycle  
**REMOVE** `loadTrackedWithSave` import (replaced with `getTrackedPosition`)  
**CHANGE** `getDeterministicCloseRule` to simpler experiment version (without failed-target, without time exit)  
**CHANGE** management prompt CLOSE rule text  
**CHANGE** screening prompt: strategy block, bins_below formula, RISK section removal  
**CHANGE** PnL poller interval to use `config.pnl.pollIntervalSec`  
**PRESERVE** whale-escape in `runManagementCycle`  
**CHANGE** report format in management to remove range bar, use simplified format  
**CHANGE** `buildRangeBar` function removal (if not preserving range bar)

**DECISION POINT**: The user wants to preserve meteora's unique features including whale-escape and different close rules. This means:
- PRESERVE whale-escape calls in management cycle
- PRESERVE complex `getDeterministicCloseRule` (failed-target, time exit, age guards)
- PRESERVE `loadTrackedWithSave` usage
- PRESERVE range bar in management report
- PRESERVE OKX signals in candidate blocks

Apply experiment changes:
- ADD repo-root path resolution
- ADD PnL config section usage
- CHANGE screening strategy block format
- CHANGE bins_below formula in screening prompt
- REMOVE RISK section from screening prompt (per experiment)

---

## FILE 11: `lessons.js`
**CHANGE** imports to use `repoPath`  
**CHANGE** path constants to use `repoPath()`  
**ADD** `entry_mcap`, `entry_tvl`, `entry_volume` to `PERFORMANCE_SIGNAL_FIELDS`  
**REMOVE** notification callback (`_notifyCallback`, `setLearnNotifyCallback`, `notifyLearn`)  
**ADD** entry/exit market fields in `derivLesson` context and return  
**ADD** `fmtNum` helper for formatting large numbers  
**CHANGE** `evolveThresholds` to use `minFeeActiveTvlRatio` instead of `minFeeTvlRatio`, remove `maxVolatility` evolution  
**CHANGE** `recordPoolDeploy` call to include entry/exit market fields

### Edit 11a - imports:
```
oldString: import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";
import { getSharedLessonsForPrompt, pushHiveLesson, pushHivePerformanceEvent } from "./hivemind.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "user-config.json");

const LESSONS_FILE = "./lessons.json";
newString: import fs from "fs";
import { log } from "./logger.js";
import { getSharedLessonsForPrompt, pushHiveLesson, pushHivePerformanceEvent } from "./hivemind.js";
import { repoPath } from "./repo-root.js";

const USER_CONFIG_PATH = repoPath("user-config.json");

const LESSONS_FILE = repoPath("lessons.json");
```

### Edit 11b - add entry_mcap/tvl/volume to signal fields:
```
oldString:  "volatility",
];
const MAX_MANUAL_LESSON_LENGTH = 400;
newString:  "volatility",
  "entry_mcap",
  "entry_tvl",
  "entry_volume",
];
const MAX_MANUAL_LESSON_LENGTH = 400;
```

### Edit 11c - remove notification callback:
```
oldString: // ─── Notification callback (set by index.js to send Telegram alerts) ───
let _notifyCallback = null;
export function setLearnNotifyCallback(fn) { _notifyCallback = fn; }
function notifyLearn(msg) {
  if (_notifyCallback) _notifyCallback(msg).catch?.(() => {});
}
const PERFORMANCE_SIGNAL_FIELDS = [
newString: const PERFORMANCE_SIGNAL_FIELDS = [
```

### Edit 11d - remove notifyLearn calls in recordPerformance:
Remove `notifyLearn(...)` calls.

### Edit 11e - add entry/exit fields to recordPoolDeploy:
```
oldString:      strategy: perf.strategy,
      volatility: perf.volatility,
    });
newString:      strategy: perf.strategy,
      volatility: perf.volatility,
      entry_mcap: perf.entry_mcap,
      entry_tvl: perf.entry_tvl,
      entry_volume: perf.entry_volume,
      exit_mcap: perf.exit_mcap,
      exit_tvl: perf.exit_tvl,
      exit_volume: perf.exit_volume,
    });
```

### Edit 11f - add context/entry/exit to derivLesson:
Add `fmtNum` helper, modify context building to include entry/exit market data, add entry/exit fields to returned lesson object.

### Edit 11g - change evolveThresholds:
Replace `minFeeTvlRatio` with `minFeeActiveTvlRatio`, remove `maxVolatility` evolution section, change `apply changes` to only `minFeeActiveTvlRatio` and `minOrganic`.

---

## FILE 12: `logger.js`
**ADD** import of `repoPath` from `./repo-root.js`  
**CHANGE** `LOG_DIR` from `"./logs"` to `repoPath("logs")`

### Edit 12:
```
oldString: import fs from "fs";
import path from "path";

const LOG_DIR = "./logs";
newString: import fs from "fs";
import path from "path";
import { repoPath } from "./repo-root.js";

const LOG_DIR = repoPath("logs");
```

---

## FILE 13: `pool-memory.js`
**ADD** import of `repoPath` from `./repo-root.js`  
**CHANGE** `POOL_MEMORY_FILE` from `"./pool-memory.json"` to `repoPath("pool-memory.json")`  
**ADD** entry/exit market fields to deploy record  
**CHANGE** `recallForPool` win_rate display from `(entry.win_rate * 100).toFixed(0)` to `entry.win_rate`

### Edit 13a - imports:
```
oldString: import fs from "fs";
import { log } from "./logger.js";
import { config } from "./config.js";

const POOL_MEMORY_FILE = "./pool-memory.json";
newString: import fs from "fs";
import { log } from "./logger.js";
import { config } from "./config.js";

import { repoPath } from "./repo-root.js";

const POOL_MEMORY_FILE = repoPath("pool-memory.json");
```

### Edit 13b - add market fields to deploy record:
```
oldString:    strategy: deployData.strategy || null,
    volatility_at_deploy: deployData.volatility ?? null,
  };
newString:    strategy: deployData.strategy || null,
    volatility_at_deploy: deployData.volatility ?? null,
    entry_mcap: deployData.entry_mcap ?? null,
    entry_tvl: deployData.entry_tvl ?? null,
    entry_volume: deployData.entry_volume ?? null,
    exit_mcap: deployData.exit_mcap ?? null,
    exit_tvl: deployData.exit_tvl ?? null,
    exit_volume: deployData.exit_volume ?? null,
  };
```

### Edit 13c - change win_rate display:
```
oldString:    lines.push(`POOL MEMORY [${entry.name}]: ${entry.total_deploys} past deploy(s), avg PnL ${entry.avg_pnl_pct}%, win rate ${(entry.win_rate * 100).toFixed(0)}%, last outcome: ${entry.last_outcome}`);
newString:    lines.push(`POOL MEMORY [${entry.name}]: ${entry.total_deploys} past deploy(s), avg PnL ${entry.avg_pnl_pct}%, win rate ${entry.win_rate}%, last outcome: ${entry.last_outcome}`);
```

---

## FILE 14: `prompt.js`
**CHANGE** dust threshold from `$0.01` to `$0.10` in MANAGER and GENERAL prompts  
**CHANGE** timeframe scaling table: remove 15m row, add 30m and 12h rows  
**CHANGE** remove TOKEN TAGS section  
**CHANGE** remove "CLOSE REASON REQUIRED" from behavioral core  
**CHANGE** SCREENER prompt: simplify risk signals (remove bundle, rugpull, wash, OKX-specific), simplify deploy rules (remove sqrt-based bins_below formula, remove volatility pass)  
**CHANGE** GENERAL prompt: change dust threshold

### Edit 14a - MANAGER dust:
```
oldString: 2. GAS EFFICIENCY: close_position costs gas — only close for clear reasons. After close, swap_token is MANDATORY for any token worth >= $0.01 (dust < $0.01 = skip). Always check token USD value before swapping.
newString: 2. GAS EFFICIENCY: close_position costs gas — only close for clear reasons. After close, swap_token is MANDATORY for any token worth >= $0.10 (dust < $0.10 = skip). Always check token USD value before swapping.
```

### Edit 14b - GENERAL behavioral dust:
```
oldString: 2. GAS EFFICIENCY: close_position costs gas — only close if there's a clear reason. However, swap_token after a close is MANDATORY for any token worth >= $0.01. Skip tokens below $0.01 (dust — not worth the gas). Always check token USD value before swapping.
3. CLOSE REASON REQUIRED: When calling close_position, ALWAYS include the "reason" parameter with the exact reason provided in the management instructions. This ensures Telegram notifications display the correct close reason.
4. DATA-DRIVEN AUTONOMY: You have full autonomy. Guidelines are heuristics. Use all tools to justify your actions.
4. POST-DEPLOY INTERVAL:
newString: 2. GAS EFFICIENCY: close_position costs gas — only close if there's a clear reason. However, swap_token after a close is MANDATORY for any token worth >= $0.10. Skip tokens below $0.10 (dust — not worth the gas). Always check token USD value before swapping.
3. DATA-DRIVEN AUTONOMY: You have full autonomy. Guidelines are heuristics. Use all tools to justify your actions.
4. POST-DEPLOY INTERVAL:
```

### Edit 14c - timeframe table:
Replace the timeframe table with experiment version (add 30m/12h, remove 15m).

### Edit 14d - SCREENER prompt:
Replace the SCREENER section with experiment version (simplified risk signals, no OKX-specific rules, no sqrt formula, no volatility pass).

### Edit 14e - GENERAL swap dust:
```
oldString: SWAP AFTER CLOSE: After any close_position, immediately swap base tokens back to SOL — unless the user explicitly said to hold or keep the token. Skip tokens worth < $0.01 (dust). Always check token USD value before swapping.
newString: SWAP AFTER CLOSE: After any close_position, immediately swap base tokens back to SOL — unless the user explicitly said to hold or keep the token. Skip tokens worth < $0.10 (dust). Always check token USD value before swapping.
```

---

## FILE 15: `setup.js`
**CHANGE** imports to use `repoPath`  
**CHANGE** `CONFIG_PATH` and `GMGN_CONFIG_PATH` to use `repoPath()`  
**ADD** `ENV_PATH` constant  
**CHANGE** example file reads to use `repoPath()`  
**REMOVE** `maxBundlePct` from Screening Filters section  
**REMOVE** `athFilterPct` from Screening Filters section

### Edit 15a - imports:
```
oldString: import "./envcrypt.js";
import readline from "readline";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "user-config.json");
const GMGN_CONFIG_PATH = path.join(__dirname, "gmgn-config.json");
newString: import "./envcrypt.js";
import readline from "readline";
import fs from "fs";
import { repoPath } from "./repo-root.js";

const CONFIG_PATH = repoPath("user-config.json");
const GMGN_CONFIG_PATH = repoPath("gmgn-config.json");
const ENV_PATH = repoPath(".env");
```

### Edit 15b - example file reads:
```
oldString: const EXAMPLE_DEFAULTS = JSON.parse(fs.readFileSync(path.join(__dirname, "user-config.example.json"), "utf8"));
const GMGN_EXAMPLE_DEFAULTS = JSON.parse(fs.readFileSync(path.join(__dirname, "gmgn-config.example.json"), "utf8"));
newString: const EXAMPLE_DEFAULTS = JSON.parse(fs.readFileSync(repoPath("user-config.example.json"), "utf8"));
const GMGN_EXAMPLE_DEFAULTS = JSON.parse(fs.readFileSync(repoPath("gmgn-config.example.json"), "utf8"));
```

---

## FILE 16: `signal-weights.js`
**ADD** import of `repoPath` from `./repo-root.js`  
**CHANGE** `WEIGHTS_FILE` from `"./signal-weights.json"` to `repoPath("signal-weights.json")`  
**ADD** `entry_mcap`, `entry_tvl`, `entry_volume` to `SIGNAL_NAMES`

### Edit 16a - imports:
```
oldString: import fs from "fs";
import { log } from "./logger.js";

const WEIGHTS_FILE = "./signal-weights.json";
newString: import fs from "fs";
import { log } from "./logger.js";

import { repoPath } from "./repo-root.js";

const WEIGHTS_FILE = repoPath("signal-weights.json");
```

### Edit 16b - add signals:
```
oldString:  "volatility",
];
const DEFAULT_WEIGHTS = Object.fromEntries(SIGNAL_NAMES.map((s) => [s, 1.0]));
newString:  "volatility",
  "entry_mcap",
  "entry_tvl",
  "entry_volume",
];
const DEFAULT_WEIGHTS = Object.fromEntries(SIGNAL_NAMES.map((s) => [s, 1.0]));
```

---

## FILE 17: `smart-wallets.js`
**CHANGE** imports to use `repoPath`  
**CHANGE** `WALLETS_PATH` to use `repoPath()`

### Edit 17:
```
oldString: import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLETS_PATH = path.join(__dirname, "smart-wallets.json");
newString: import fs from "fs";
import { log } from "./logger.js";
import { repoPath } from "./repo-root.js";

const WALLETS_PATH = repoPath("smart-wallets.json");
```

---

## FILE 18: `state.js`
**ADD** import of `repoPath` from `./repo-root.js`  
**CHANGE** `STATE_FILE` from `"./state.json"` to `repoPath("state.json")`  
**REMOVE** `saveTrackedPosition` and `loadTrackedWithSave` exports  
**CHANGE** `trackPosition` to accept entry market fields  
**CHANGE** `updatePnlAndCheckExits` trailing TP to use custom thresholds for failed_target  
**CHANGE** low yield check to require `(pnl_pct ?? 0) > 0` (in profit)  
**CHANGE** `queuePeakConfirmation` log message from "relay poll" to "rpc poll"  
**CHANGE** `failed_target_trailing_*` fields removal (if simplifying to experiment version)

**DECISION**: Since we're preserving meteora's complex close rules, we keep `loadTrackedWithSave`, `failed_target_*` fields, and the complex trailing logic.

### Edit 18a - imports:
```
oldString: import fs from "fs";
import { log } from "./logger.js";

const STATE_FILE = "./state.json";
newString: import fs from "fs";
import { log } from "./logger.js";
import { repoPath } from "./repo-root.js";

const STATE_FILE = repoPath("state.json");
```

### Edit 18b - add entry market fields to trackPosition:
```
oldString:  organic_score,
  initial_value_usd,
  signal_snapshot = null,
}) {
newString:  organic_score,
  initial_value_usd,
  signal_snapshot = null,
  entry_mcap = null,
  entry_tvl = null,
  entry_volume = null,
  entry_holders = null,
}) {
```

And in the position object:
```
oldString:    initial_value_usd,
    signal_snapshot: signal_snapshot || null,
newString:    initial_value_usd,
    entry_mcap,
    entry_tvl,
    entry_volume,
    entry_holders,
    signal_snapshot: signal_snapshot || null,
```

---

## FILE 19: `strategy-library.js`
**ADD** import of `repoPath` from `./repo-root.js`  
**CHANGE** `STRATEGY_FILE` from `"./strategy-library.json"` to `repoPath("strategy-library.json")`

### Edit 19:
```
oldString: import fs from "fs";
import { log } from "./logger.js";

const STRATEGY_FILE = "./strategy-library.json";
newString: import fs from "fs";
import { log } from "./logger.js";
import { repoPath } from "./repo-root.js";

const STRATEGY_FILE = repoPath("strategy-library.json");
```

---

## FILE 20: `telegram.js`
**CHANGE** imports to use `repoPath`  
**CHANGE** chatId initialization to `null`  
**ADD** `nonEmptyChatId` helper  
**CHANGE** `loadChatId` to use `resolveChatId` pattern  
**ADD** `resolveChatId` function  
**CHANGE** `isAuthorizedIncomingMessage` to use `String(chatId)`  
**CHANGE** `postTelegram` to add 401 error logging  
**CHANGE** `postTelegramRaw` to add 401 error logging  
**CHANGE** `startPolling` to call `loadChatId()` and warn if no chatId  
**CHANGE** `notifyDeploy` to use experiment format (no separate binStep/baseFee vars)  
**CHANGE** `notifyClose` to remove `reason` parameter, use `$` instead of `cur`  
**ADD** `notifyWhaleEscapeWarn` function (PRESERVE from meteora)

### Edit 20a - imports:
```
oldString: import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "user-config.json");
newString: import fs from "fs";
import { log } from "./logger.js";
import { repoPath } from "./repo-root.js";

const USER_CONFIG_PATH = repoPath("user-config.json");
```

### Edit 20b - chatId init:
```
oldString: let chatId   = process.env.TELEGRAM_CHAT_ID || null;
newString: let chatId = null;
```

### Edit 20c - add nonEmptyChatId and resolveChatId:
```
oldString: let _warnedMissingChatId = false;
let _warnedMissingAllowedUsers = false;

// ─── chatId persistence ──────────────────────────────────────────
function loadChatId() {
newString: let _warnedMissingChatId = false;
let _warnedMissingAllowedUsers = false;

function nonEmptyChatId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

// ─── chatId persistence ──────────────────────────────────────────
function resolveChatId() {
  const fromEnv = nonEmptyChatId(process.env.TELEGRAM_CHAT_ID);
  let fromConfig = null;
  try {
    if (fs.existsSync(USER_CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
      fromConfig = nonEmptyChatId(cfg.telegramChatId);
    }
  } catch (error) {
    log("telegram_warn", `Invalid user-config.json; chatId not loaded: ${error.message}`);
  }
  // user-config wins when set; otherwise fall back to .env
  const resolved = fromConfig || fromEnv || null;
  return resolved != null ? String(resolved) : null;
}

function loadChatId() {
  chatId = resolveChatId();
}
```

### Edit 20d - isAuthorizedIncomingMessage:
```
oldString:  if (incomingChatId !== chatId) return false;
newString:  if (incomingChatId !== String(chatId)) return false;
```

### Edit 20e - postTelegram 401:
```
oldString:      log("telegram_error", `${method} ${res.status}: ${err.slice(0, 200)}`);
newString:      if (res.status === 401) {
        log("telegram_error", `${method} 401 Unauthorized — check TELEGRAM_BOT_TOKEN in .env (invalid, revoked, or encrypted without .envrypt key)`);
      } else {
        log("telegram_error", `${method} ${res.status}: ${err.slice(0, 200)}`);
      }
```
Same for `postTelegramRaw`.

### Edit 20f - startPolling:
```
oldString:export function startPolling(onMessage) {
  if (!TOKEN) return;
  _polling = true;
  poll(onMessage); // fire-and-forget
  registerCommands();
  log("telegram", "Bot polling started");
}
newString:export function startPolling(onMessage) {
  if (!TOKEN) return;
  loadChatId();
  if (!chatId) {
    log("telegram_warn", "TELEGRAM_CHAT_ID not set in .env or user-config.telegramChatId — outbound notifications and inbound control disabled until configured.");
  }
  _polling = true;
  poll(onMessage); // fire-and-forget
  registerCommands();
  log("telegram", "Bot polling started");
}
```

### Edit 20g - notifyDeploy:
Simplify to experiment format.

### Edit 20h - notifyClose:
**PRESERVE** meteora's `reason` parameter and `solMode` currency display (this is a meteora-unique feature).

---

## FILE 21: `token-blacklist.js`
**ADD** import of `repoPath` from `./repo-root.js`  
**CHANGE** `BLACKLIST_FILE` from `"./token-blacklist.json"` to `repoPath("token-blacklist.json")`

### Edit 21:
```
oldString: import fs from "fs";
import { log } from "./logger.js";

const BLACKLIST_FILE = "./token-blacklist.json";
newString: import fs from "fs";
import { log } from "./logger.js";
import { repoPath } from "./repo-root.js";

const BLACKLIST_FILE = repoPath("token-blacklist.json");
```

---

## FILE 22: `user-config.example.json`
**REPLACE** entire content with experiment version (different defaults, new pnl/gmgnFeeSource fields, remove whaleEscape fields).

**NOTE**: The whale-escape fields in user-config.example.json are meteora-unique. Since we're preserving whale-escape, keep them. Only update the fields that differ.

Changes to apply from experiment:
- `llmBaseUrl`: `""` (was `"https://openrouter.ai/api/v1"`)
- `llmModel`: `"minimax/minimax-m2.7"` (was `"deepseek/deepseek-v4-flash"`)
- `dryRun`: `true` (was `false`)
- `deployAmountSol`: `0.5` (was `0.1`)
- `minSolToOpen`: `0.55` (was `0.1`)
- `maxDeployAmount`: `50` (was `0.1`)
- `maxBinsBelow`: `69` (was `102`)
- `timeframe`: `"5m"` (was `"30m"`)
- `minVolume`: `500` (was `2000`)
- `minOrganic`: `60` (was `65`)
- `minFeeActiveTvlRatio`: `0.05` (was `0.1`)
- `minTokenFeesSol`: `30` (was `25`)
- `maxBotHoldersPct`: `30` (was `40`)
- Remove `maxVolatility`, `minQuoteOrganic`, `maxBundlePct`, `athFilterPct`, `maxPoolTokenAgeDiffDays`
- `repeatDeployCooldownHours`: `12` (was `0.3`)
- `stopLossPct`: `-50` (was `-15`)
- `emergencyPriceDropPct`: `-50` (was `-30`)
- `minFeePerTvl24h`: `7` (was `2`)
- `trailingDropPct`: `1.5` (was `1`)
- `solMode`: `false` (was `true`)
- Remove whaleEscape fields
- `managementModel`: `"minimax/minimax-m2.5"` (was `"deepseek/deepseek-v4-flash"`)
- `screeningModel`: `"minimax/minimax-m2.5"` (was `"minimax/minimax-m2.5"`)
- `generalModel`: `"minimax/minimax-m2.7"` (was `"deepseek/deepseek-v4-flash"`)
- `publicApiKey`: `""` (was the default key)
- `lpAgentRelayEnabled`: `false` (was `true`)
- Add `pnlSource`, `pnlRpcUrl`, `pnlPollIntervalSec`, `pnlDepositCacheTtlSec`, `gmgnFeeSource`
- Remove `hiveMindUrl`, `hiveMindApiKey` defaults (set to `""`)

---

## FILE 23: `tools/definitions.js`
**CHANGE** `get_pool_detail` timeframe enum to remove `"15m"` (experiment doesn't have it)  
**CHANGE** `deploy_position` description to match experiment (simpler, no sqrt formula)

### Edit 23a - get_pool_detail timeframe:
```
oldString:            enum: ["5m", "15m", "30m", "1h", "2h", "4h", "12h", "24h"],
newString:            enum: ["5m", "30m", "1h", "2h", "4h", "12h", "24h"],
```

### Edit 23b - deploy_position description:
Replace the entire `deploy_position` function description with experiment version (remove sqrt formula, simplify guidelines).

---

## FILE 24-28: tools/dlmm.js, tools/executor.js, tools/gmgn.js, tools/screening.js, tools/token.js

These files are very large and complex. The primary change is the `repo-root.js` path pattern. The remaining tool files need to be read and compared individually. Based on the patterns observed:

**For each tool file:**
- Add `import { repoPath } from "../repo-root.js";`
- Replace any `__dirname`-based or relative path constants with `repoPath()`
- Apply any functional changes from experiment

Due to the size of these files (dlmm.js alone is likely 1000+ lines), I recommend reading and diffing them individually. The most important changes to look for:
1. Path resolution → repoPath()
2. PnL source configuration (experiment adds RPC-based PnL)
3. Fee source configuration (gmgn vs jupiter)
4. Screening scale adjustments
5. Any new utility functions added in experiment

---

## Execution Order
1. Create `repo-root.js` first (if not already present in meteora)
2. Apply all import + path changes (pattern: add `repoPath` import, change path constants)
3. Apply config.js changes (feeSource, pnl section, remove maxVolatility)
4. Apply lessons.js changes (market fields, remove notifyLearn)
5. Apply hivemind.js changes (market fields in events)
6. Apply state.js changes (entry market fields)
7. Apply index.js changes (the most complex - add repo-root, adjust management/screening)
8. Apply prompt.js changes (dust threshold, timeframe table, simplified screener)
9. Apply remaining files (telegram, pool-memory, etc.)
10. Apply user-config.example.json and gmgn-config.example.json
11. Apply ecosystem.config.cjs
12. Apply tools/definitions.js
13. Read and apply tools/dlmm.js, executor.js, gmgn.js, screening.js, token.js
