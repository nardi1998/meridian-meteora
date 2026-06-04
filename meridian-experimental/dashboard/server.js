/**
 * Meridian Dashboard Server
 * Express + WebSocket for real-time position monitoring
 */

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.DASHBOARD_PORT || 3210;

// ─── Dynamic imports from main project ──────────────────────
let config, getTrackedPositions, getTrackedPosition, getStateSummary;
let getPerformanceSummary, getPerformanceHistory, getRecentDecisions;
let getMyPositions, appendDecision;

async function loadModules() {
  const configMod = await import("../config.js");
  config = configMod.config;

  const stateMod = await import("../state.js");
  getTrackedPositions = stateMod.getTrackedPositions;
  getTrackedPosition = stateMod.getTrackedPosition;
  getStateSummary = stateMod.getStateSummary;

  const lessonsMod = await import("../lessons.js");
  getPerformanceSummary = lessonsMod.getPerformanceSummary;
  getPerformanceHistory = lessonsMod.getPerformanceHistory;

  const decisionMod = await import("../decision-log.js");
  getRecentDecisions = decisionMod.getRecentDecisions;
  appendDecision = decisionMod.appendDecision;

  const dlmmMod = await import("../tools/dlmm.js");
  getMyPositions = dlmmMod.getMyPositions;
}

// ─── Static files ───────────────────────────────────────────
app.use(express.static(join(__dirname, "public")));

// ─── REST API ───────────────────────────────────────────────
app.get("/api/summary", async (req, res) => {
  try {
    const state = getStateSummary();
    const perf = getPerformanceSummary();
    const decisions = getRecentDecisions(6);
    res.json({ state, performance: perf, decisions, config: sanitizeConfig() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/positions", async (req, res) => {
  try {
    const tracked = getTrackedPositions(false);
    const open = tracked.filter((p) => !p.closed);
    const closed = tracked.filter((p) => p.closed);
    res.json({ open, closed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/positions/live", async (req, res) => {
  try {
    const live = await getMyPositions({ force: true, silent: true });
    res.json(live);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/performance", async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 720;
    const history = getPerformanceHistory({ hours, limit: 100 });
    const summary = getPerformanceSummary();
    res.json({ history, summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/decisions", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const decisions = getRecentDecisions(limit);
    res.json({ decisions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/config", async (req, res) => {
  try {
    res.json(sanitizeConfig());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── WebSocket ──────────────────────────────────────────────
const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[dashboard] WS client connected (${clients.size} total)`);

  // Send initial data
  sendFullUpdate(ws);

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[dashboard] WS client disconnected (${clients.size} total)`);
  });

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "refresh") {
        await sendFullUpdate(ws);
      }
    } catch {}
  });
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

async function sendFullUpdate(ws) {
  try {
    const state = getStateSummary();
    const perf = getPerformanceSummary();
    const decisions = getRecentDecisions(10);
    const tracked = getTrackedPositions(false);
    const open = tracked.filter((p) => !p.closed);
    const closed = tracked.filter((p) => !p.closed === false);

    ws.send(JSON.stringify({
      type: "full_update",
      state,
      performance: perf,
      decisions,
      positions: { open, closed },
      config: sanitizeConfig(),
      timestamp: new Date().toISOString(),
    }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", message: e.message }));
  }
}

// ─── Polling loop: push updates every 30s ───────────────────
let lastPositionsHash = "";

setInterval(async () => {
  if (clients.size === 0) return;

  try {
    const tracked = getTrackedPositions(false);
    const open = tracked.filter((p) => !p.closed);
    const closed = tracked.filter((p) => p.closed);
    const state = getStateSummary();
    const perf = getPerformanceSummary();
    const decisions = getRecentDecisions(10);

    const hash = JSON.stringify({ open: open.length, closed: closed.length, state: state.open_positions });

    if (hash !== lastPositionsHash) {
      lastPositionsHash = hash;
      broadcast({
        type: "full_update",
        state,
        performance: perf,
        decisions,
        positions: { open, closed },
        config: sanitizeConfig(),
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error("[dashboard] Poll error:", e.message);
  }
}, 30_000);

// ─── Helpers ────────────────────────────────────────────────
function sanitizeConfig() {
  if (!config) return {};
  return {
    screening: config.screening,
    management: config.management,
    schedule: config.schedule,
    risk: config.risk,
    strategy: config.strategy,
    llm: { managementModel: config.llm?.managementModel, screeningModel: config.llm?.screeningModel },
    tokens: config.tokens,
  };
}

// ─── Start ──────────────────────────────────────────────────
async function start() {
  await loadModules();

  server.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════╗`);
    console.log(`  ║  Meridian Dashboard                  ║`);
    console.log(`  ║  http://localhost:${PORT}              ║`);
    console.log(`  ╚══════════════════════════════════════╝\n`);
  });
}

start().catch((e) => {
  console.error("Dashboard failed to start:", e);
  process.exit(1);
});
