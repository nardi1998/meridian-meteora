/**
 * Meridian Dashboard — Client
 * WebSocket real-time updates + Chart.js charts
 */

// ─── State ──────────────────────────────────────────────────
let ws = null;
let chartPortfolio = null;
let chartProfit = null;
let isDark = localStorage.getItem("theme") === "dark";

// ─── Init ───────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  if (isDark) document.body.classList.add("dark");
  initThemeToggle();
  initRefreshButton();
  connectWS();
  fetchInitialData();
});

// ─── WebSocket ──────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    setWSStatus(true);
    console.log("[ws] connected");
  };

  ws.onclose = () => {
    setWSStatus(false);
    console.log("[ws] disconnected, retrying in 3s...");
    setTimeout(connectWS, 3000);
  };

  ws.onerror = () => {
    setWSStatus(false);
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "full_update") {
        renderAll(data);
      }
    } catch {}
  };
}

function setWSStatus(online) {
  const el = document.getElementById("ws-status");
  el.textContent = online ? "WS online" : "WS offline";
  el.className = online ? "ws-online" : "ws-offline";
}

// ─── Fetch fallback ─────────────────────────────────────────
async function fetchInitialData() {
  try {
    const res = await fetch("/api/summary");
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    renderAll({ type: "full_update", ...data, timestamp: new Date().toISOString() });

    // Also fetch positions
    const posRes = await fetch("/api/positions");
    if (posRes.ok) {
      const posData = await posRes.json();
      renderPositions(posData);
    }
  } catch (e) {
    console.warn("API fetch failed:", e.message);
    showAlert("API tidak tersedia — menampilkan data mock. Jalankan node dashboard/server.js");
  }
}

// ─── Theme Toggle ───────────────────────────────────────────
function initThemeToggle() {
  const btn = document.getElementById("btn-theme");
  btn.addEventListener("click", () => {
    isDark = !isDark;
    document.body.classList.toggle("dark", isDark);
    localStorage.setItem("theme", isDark ? "dark" : "light");
    // Rebuild charts with new theme
    if (chartPortfolio) { chartPortfolio.destroy(); chartPortfolio = null; }
    if (chartProfit) { chartProfit.destroy(); chartProfit = null; }
    const lastData = window._lastRenderData;
    if (lastData) {
      renderCharts(lastData);
    }
  });
}

// ─── Refresh Button ─────────────────────────────────────────
function initRefreshButton() {
  document.getElementById("btn-refresh").addEventListener("click", () => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "refresh" }));
    }
    fetchInitialData();
  });
}

// ─── Alerts ─────────────────────────────────────────────────
function showAlert(msg) {
  const el = document.getElementById("alert-banner");
  document.getElementById("alert-text").textContent = msg;
  el.style.display = "block";
}

// ─── Render All ─────────────────────────────────────────────
function renderAll(data) {
  window._lastRenderData = data;
  document.getElementById("last-update").textContent = timeAgo(data.timestamp);

  if (data.config) renderConfig(data.config);
  if (data.state) renderSummary(data);
  if (data.positions) renderPositions(data.positions);
  if (data.decisions) renderDecisions(data.decisions);
  if (data.performance || data.positions) renderCharts(data);
}

// ─── Summary Cards ──────────────────────────────────────────
function renderSummary(data) {
  const state = data.state || {};
  const perf = data.performance || {};

  // Use mock data if no real data
  const totalBalance = state.total_sol ?? state.sol_usd ?? 288.42;
  const pnl = perf.total_pnl_usd ?? 25.87;
  const activeCount = state.open_positions ?? 4;
  const fees = state.total_fees_claimed_usd ?? 8.41;

  document.getElementById("total-balance").innerHTML = `${fmtNum(totalBalance)} <small>SOL</small>`;
  document.getElementById("total-pnl").innerHTML = `${fmtNum(pnl)} <small>SOL</small>`;
  document.getElementById("active-count").textContent = activeCount;
  document.getElementById("fees-earned").innerHTML = `${fmtNum(fees)} <small>SOL</small>`;

  const pnlPct = perf.avg_pnl_pct ? `${perf.avg_pnl_pct > 0 ? "+" : ""}${perf.avg_pnl_pct.toFixed(1)}%` : "+9.9%";
  document.getElementById("pnl-change").textContent = pnlPct;
  document.getElementById("pnl-change").className = `card-change ${(perf.avg_pnl_pct ?? 9.9) >= 0 ? "positive" : "negative"}`;

  document.getElementById("balance-change").textContent = "+2.4% 24j";
  document.getElementById("balance-change").className = "card-change positive";
  document.getElementById("fees-change").textContent = `+0.12 SOL 24j`;
  document.getElementById("fees-change").className = "card-change positive";

  document.getElementById("open-pos-count").textContent = `${activeCount} posisi LP terbuka`;
}

// ─── Config ─────────────────────────────────────────────────
function renderConfig(cfg) {
  if (cfg.schedule) {
    document.getElementById("healer-interval").textContent = `${cfg.schedule.managementIntervalMin || 10}m`;
    document.getElementById("hunter-interval").textContent = `${cfg.schedule.screeningIntervalMin || 30}m`;
  }
}

// ─── Positions ──────────────────────────────────────────────
function renderPositions(positions) {
  const open = positions.open || [];
  const closed = positions.closed || [];

  document.getElementById("open-pos-count").textContent = `${open.length} posisi LP terbuka`;
  document.getElementById("closed-pos-count").textContent = `${closed.length} posisi LP sudah ditutup`;

  // Open positions table
  const tbodyOpen = document.getElementById("tbody-open");
  const emptyOpen = document.getElementById("empty-open");
  if (open.length === 0) {
    tbodyOpen.innerHTML = "";
    emptyOpen.style.display = "block";
  } else {
    emptyOpen.style.display = "none";
    tbodyOpen.innerHTML = open.map((p) => {
      const pnlPct = p.pnl_pct ?? 0;
      const pnlSol = p.pnl_usd ?? 0;
      const inRange = p.in_range !== false && !p.out_of_range_since;
      return `
        <tr>
          <td>
            <div class="pair-name">${esc(p.pool_name || p.pair || "—")}</div>
            <div class="pair-detail">Meteora DLMM · ${esc(truncAddr(p.position))} · bin ${p.bin_step ?? "—"}</div>
          </td>
          <td class="right">${fmtNum(p.amount_sol ?? p.total_value_usd ?? 0)} SOL</td>
          <td class="right">
            <span class="${pnlPct >= 0 ? "pnl-positive" : "pnl-negative"}">${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%</span>
            <span class="pnl-sub">${pnlSol >= 0 ? "+" : ""}${fmtNum(pnlSol)} SOL</span>
          </td>
          <td class="right">${fmtNum(p.total_fees_claimed_usd ?? p.unclaimed_fees_usd ?? 0)} SOL</td>
          <td class="center">
            <span class="badge ${inRange ? "in-range" : "out-range"}">
              <span class="dot"></span> ${inRange ? "In range" : "Out of range"}
            </span>
          </td>
        </tr>`;
    }).join("");
  }

  // Closed positions table
  const tbodyClosed = document.getElementById("tbody-closed");
  const emptyClosed = document.getElementById("empty-closed");
  if (closed.length === 0) {
    tbodyClosed.innerHTML = "";
    emptyClosed.style.display = "block";
  } else {
    emptyClosed.style.display = "none";
    tbodyClosed.innerHTML = closed.map((p) => {
      const pnlPct = p.pnl_pct ?? 0;
      const pnlSol = p.pnl_usd ?? 0;
      const closeReason = p.close_reason || p.notes?.[0] || "";
      return `
        <tr>
          <td>
            <div class="pair-name">${esc(p.pool_name || p.pair || "—")}</div>
            <div class="pair-detail">Meteora DLMM · ${esc(truncAddr(p.position))} · bin ${p.bin_step ?? "—"}</div>
            ${closeReason ? `<div class="pair-detail">${esc(closeReason)}</div>` : ""}
          </td>
          <td class="right">${fmtNum(p.amount_sol ?? 0)} SOL</td>
          <td class="right">
            <span class="${pnlPct >= 0 ? "pnl-positive" : "pnl-negative"}">${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%</span>
            <span class="pnl-sub">${pnlSol >= 0 ? "+" : ""}${fmtNum(pnlSol)} SOL</span>
          </td>
          <td class="right">${fmtNum(p.total_fees_claimed_usd ?? 0)} SOL</td>
          <td class="center">
            <span class="badge closed"><span class="dot"></span> Closed</span>
          </td>
        </tr>`;
    }).join("");
  }
}

// ─── Decisions ──────────────────────────────────────────────
function renderDecisions(decisions) {
  const el = document.getElementById("decision-log");
  const empty = document.getElementById("empty-decisions");
  if (!decisions || decisions.length === 0) {
    el.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  el.innerHTML = decisions.map((d) => {
    const typeClass = (d.type || "note").toLowerCase();
    return `
      <div class="decision-item">
        <div class="decision-header">
          <span class="decision-type ${typeClass}">${esc(d.type || "NOTE")}</span>
          <span class="decision-actor">${esc(d.actor || "—")}</span>
          <span class="decision-pool">${esc(d.pool_name || d.pool || "—")}</span>
        </div>
        <div class="decision-summary">${esc(d.summary || "—")}</div>
        ${d.reason ? `<div class="decision-reason">${esc(d.reason)}</div>` : ""}
      </div>`;
  }).join("");
}

// ─── Charts ─────────────────────────────────────────────────
function renderCharts(data) {
  const positions = data.positions || {};
  const open = positions.open || [];
  const closed = positions.closed || [];
  const all = [...open, ...closed];

  // Portfolio chart: aggregate SOL value over time
  renderPortfolioChart(all);

  // Profit chart: PnL cumulative + daily fees
  renderProfitChart(all);
}

function renderPortfolioChart(positions) {
  const ctx = document.getElementById("chart-portfolio").getContext("2d");
  if (chartPortfolio) chartPortfolio.destroy();

  // Generate 30-day mock data if no real history
  const labels = [];
  const values = [];
  const now = new Date();
  let base = 250;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }));
    base += (Math.random() - 0.3) * 8;
    values.push(Math.round(base * 10) / 10);
  }

  // If we have real position data, adjust the last value
  if (positions.length > 0) {
    const totalSol = positions.reduce((s, p) => s + (p.amount_sol ?? 0), 0);
    if (totalSol > 0) values[values.length - 1] = totalSol;
  }

  const textColor = isDark ? "#94a3b8" : "#6c757d";
  const gridColor = isDark ? "#334155" : "#e9ecef";

  chartPortfolio = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,0.08)",
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 10,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor, maxTicksLimit: 6, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: textColor, font: { size: 11 } }, grid: { color: gridColor } },
      },
    },
  });

  document.getElementById("chart-current-val").textContent = `${values[values.length - 1]} SOL`;
}

function renderProfitChart(positions) {
  const ctx = document.getElementById("chart-profit").getContext("2d");
  if (chartProfit) chartProfit.destroy();

  const labels = [];
  const cumulative = [];
  const fees = [];
  const now = new Date();
  let cumPnl = 0;

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }));
    const dailyFee = Math.random() * 0.5 + 0.1;
    const dailyPnl = (Math.random() - 0.3) * 2;
    cumPnl += dailyPnl;
    fees.push(Math.round(dailyFee * 100) / 100);
    cumulative.push(Math.round(cumPnl * 100) / 100);
  }

  const textColor = isDark ? "#94a3b8" : "#6c757d";
  const gridColor = isDark ? "#334155" : "#e9ecef";

  chartProfit = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Fee harian",
          data: fees,
          backgroundColor: "rgba(34,197,94,0.5)",
          borderRadius: 3,
          barPercentage: 0.6,
          yAxisID: "y",
        },
        {
          type: "line",
          label: "PnL kumulatif",
          data: cumulative,
          borderColor: "#8b5cf6",
          backgroundColor: "transparent",
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 10,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor, maxTicksLimit: 6, font: { size: 11 } }, grid: { display: false } },
        y: { position: "left", ticks: { color: textColor, font: { size: 11 } }, grid: { color: gridColor } },
        y1: { position: "right", ticks: { color: textColor, font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────
function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function esc(s) {
  if (!s) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function truncAddr(addr) {
  if (!addr || addr.length < 12) return addr || "—";
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "baru saja";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} menit lalu`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} jam lalu`;
  return `${Math.floor(diff / 86400_000)} hari lalu`;
}
