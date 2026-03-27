/* ═══════════════════════════════════════════════════════════════════════════
   EcoSense Dashboard — dashboard.js
   Full ML result rendering, chart management, simulation, analytics
   ═══════════════════════════════════════════════════════════════════════════ */

"use strict";

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const API = {
  aquatic:       '/api/aquatic',
  terrestrial:   '/api/terrestrial',
  combined:      '/api/combined',
  simAquatic:    '/api/simulate/aquatic',
  simTerrestrial:'/api/simulate/terrestrial',
  genData:       '/api/generate-sample-data',
};

const STATUS_COLOR = {
  Healthy:    '#00d4aa',
  Stable:     '#22c55e',
  Vulnerable: '#f97316',
  Unstable:   '#eab308',
  Critical:   '#ef4444',
  'High Risk':'#ef4444',
};

const CHART_DEFAULTS = {
  gridColor:   '#162028',
  labelColor:  '#4a6470',
  tooltipBg:   '#0c1619',
  fontMono:    'IBM Plex Mono',
};

// ── STATE ────────────────────────────────────────────────────────────────────
const State = {
  charts:      {},       // keyed by canvas id
  data:        {},       // panel data cache
  panelLoaded: { aquatic: false, terrestrial: false, combined: false },
  baseline:    { aquatic: null, terrestrial: null },
};

// ── UTILS ────────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || res.statusText);
  return json;
}

function statusCls(s = '') {
  const m = { healthy:'healthy', stable:'stable', vulnerable:'vulnerable',
              unstable:'unstable', critical:'critical', 'high risk':'high-risk' };
  return m[s.toLowerCase()] || 'stable';
}

function statusColor(s) { return STATUS_COLOR[s] || '#8ba4ae'; }

function destroyChart(id) {
  if (State.charts[id]) { State.charts[id].destroy(); delete State.charts[id]; }
}

function trendIcon(dir) { return dir === 'improving' ? '▲' : '▼'; }
function trendCls(dir)  { return dir === 'improving' ? 'trend-up' : 'trend-down'; }

function pct(n) { return `${n > 0 ? '+' : ''}${n}`; }

function formatDate(year, month) {
  return `${year}/${String(month).padStart(2,'0')}`;
}

// ── LOADER / ERROR HELPERS ───────────────────────────────────────────────────
function loaderHTML(msg = 'PROCESSING…') {
  return `<div class="loader-wrap">
    <div class="eco-spinner">
      <div class="eco-spinner-ring"></div>
      <div class="eco-spinner-ring"></div>
      <div class="eco-spinner-ring"></div>
    </div>
    <span class="loader-text">${msg}</span>
  </div>`;
}

function errorHTML(err) {
  return `<div class="error-card">
    <div class="error-header">⚠ DATA ERROR</div>
    <div class="error-msg">${err}<br><br>
      Place CSV files in the <code>data/</code> folder, or generate synthetic sample data below.
    </div>
    <button class="gen-data-btn" onclick="App.generateSampleData()">⚙ Generate Sample Data</button>
  </div>`;
}

// ── CLOCK ────────────────────────────────────────────────────────────────────
function startClock() {
  const el = $('live-clock');
  if (!el) return;
  const update = () => { el.textContent = new Date().toLocaleTimeString('en-GB'); };
  update();
  setInterval(update, 1000);
}

// ── CHART FACTORY ────────────────────────────────────────────────────────────
const ChartFactory = {

  _baseScales(yMin = 0, yMax = 100) {
    return {
      x: {
        ticks: { color: CHART_DEFAULTS.labelColor,
          font: { family: CHART_DEFAULTS.fontMono, size: 9 },
          maxTicksLimit: 14, maxRotation: 0 },
        grid: { color: CHART_DEFAULTS.gridColor },
      },
      y: {
        min: yMin, max: yMax,
        ticks: { color: CHART_DEFAULTS.labelColor,
          font: { family: CHART_DEFAULTS.fontMono, size: 9 } },
        grid: { color: CHART_DEFAULTS.gridColor },
      },
    };
  },

  _basePlugins(title = '') {
    return {
      legend: { labels: { color: '#6b8f9a',
        font: { family: CHART_DEFAULTS.fontMono, size: 9 }, boxWidth: 10 } },
      tooltip: {
        backgroundColor: CHART_DEFAULTS.tooltipBg,
        titleColor: '#00d4aa', bodyColor: '#ddeaee',
        borderColor: '#1e3040', borderWidth: 1,
        titleFont: { family: CHART_DEFAULTS.fontMono, size: 10 },
        bodyFont:  { family: CHART_DEFAULTS.fontMono, size: 9 },
        padding: 10,
      },
    };
  },

  /* Stability + Resilience timeline */
  stability(canvasId, trendData, scoreKey = 'stability_score') {
    destroyChart(canvasId);
    const ctx = $(canvasId);
    if (!ctx) return;

    const labels     = trendData.map(d => formatDate(d.year, d.month));
    const scores     = trendData.map(d => d[scoreKey] ?? d.final_stability ?? 0);
    const resilience = trendData.map(d => d.resilience_score);
    const risk       = trendData.map(d => d.risk_score ?? (100 - (d[scoreKey] ?? 50)));

    const hasResilience = resilience.some(v => v !== undefined && v !== null);

    const datasets = [
      {
        label: 'Stability Score',
        data: scores,
        borderColor: '#00d4aa',
        backgroundColor: 'rgba(0,212,170,0.06)',
        borderWidth: 2,
        fill: true, tension: 0.45,
        pointRadius: 0, pointHoverRadius: 5,
      },
      {
        label: 'Collapse Risk',
        data: risk,
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.04)',
        borderWidth: 1.5,
        fill: true, tension: 0.45,
        pointRadius: 0, pointHoverRadius: 4,
        borderDash: [5,3],
      },
    ];

    if (hasResilience) {
      datasets.push({
        label: 'Resilience',
        data: resilience,
        borderColor: '#6366f1',
        borderWidth: 1.5,
        fill: false, tension: 0.45,
        pointRadius: 0, pointHoverRadius: 4,
        borderDash: [2,4],
      });
    }

    State.charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: this._basePlugins(),
        scales: this._baseScales(0, 100),
        animation: { duration: 800, easing: 'easeOutQuart' },
      },
    });
  },

  /* Doughnut status distribution */
  doughnut(canvasId, distribution) {
    destroyChart(canvasId);
    const ctx = $(canvasId);
    if (!ctx) return;

    const entries = Object.entries(distribution);
    State.charts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]),
          backgroundColor: entries.map(e => statusColor(e[0])),
          borderColor: '#0c1619',
          borderWidth: 4,
          hoverBorderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#6b8f9a',
              font: { family: CHART_DEFAULTS.fontMono, size: 9 },
              padding: 14, boxWidth: 10, usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: CHART_DEFAULTS.tooltipBg,
            titleColor: '#00d4aa', bodyColor: '#ddeaee',
            borderColor: '#1e3040', borderWidth: 1,
            bodyFont: { family: CHART_DEFAULTS.fontMono, size: 9 },
          },
        },
        animation: { animateRotate: true, duration: 900 },
      },
    });
  },

  /* Rolling variance / STD — early warning chart */
  earlyWarning(canvasId, trendData) {
    destroyChart(canvasId);
    const ctx = $(canvasId);
    if (!ctx) return;

    const labels = trendData.map(d => formatDate(d.year, d.month));
    const scores = trendData.map(d => d.stability_score ?? d.final_stability ?? 0);

    // Compute rolling std (window=6) in JS for the chart
    const rollStd = scores.map((_, i) => {
      if (i < 5) return null;
      const slice = scores.slice(i - 5, i + 1);
      const mean = slice.reduce((a,b) => a+b, 0) / slice.length;
      const variance = slice.reduce((a,b) => a + (b-mean)**2, 0) / slice.length;
      return parseFloat(Math.sqrt(variance).toFixed(3));
    });

    const rollMean = scores.map((_, i) => {
      if (i < 5) return null;
      const slice = scores.slice(i - 5, i + 1);
      return parseFloat((slice.reduce((a,b) => a+b, 0) / slice.length).toFixed(3));
    });

    State.charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Rolling Mean (6mo)', data: rollMean,
            borderColor: '#f97316', borderWidth: 1.5, fill: false, tension: 0.4,
            pointRadius: 0, borderDash: [4,3] },
          { label: 'Rolling STD (volatility)', data: rollStd,
            borderColor: '#eab308', borderWidth: 1.5, fill: true,
            backgroundColor: 'rgba(234,179,8,0.05)',
            tension: 0.4, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: this._basePlugins(),
        scales: this._baseScales(0, null),
        animation: { duration: 800 },
      },
    });
  },

  /* Combined 3-line comparison */
  combined(canvasId, trendData) {
    destroyChart(canvasId);
    const ctx = $(canvasId);
    if (!ctx) return;

    const labels = trendData.map(d => formatDate(d.year, d.month));
    State.charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Final Combined', data: trendData.map(d => d.final_stability),
            borderColor: '#00d4aa', borderWidth: 2.5, fill: false, tension: 0.45, pointRadius: 0 },
          { label: 'Aquatic',        data: trendData.map(d => d.aquatic_stability),
            borderColor: '#3fa9f5', borderWidth: 1.5, fill: false, tension: 0.45, pointRadius: 0, borderDash:[4,3] },
          { label: 'Terrestrial',    data: trendData.map(d => d.terrestrial_stability),
            borderColor: '#5ddc72', borderWidth: 1.5, fill: false, tension: 0.45, pointRadius: 0, borderDash:[4,3] },
          { label: 'Risk Score',     data: trendData.map(d => d.risk_score),
            borderColor: '#ef4444', borderWidth: 1.5, fill: false, tension: 0.45, pointRadius: 0, borderDash:[2,4] },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: this._basePlugins(),
        scales: this._baseScales(0, 100),
        animation: { duration: 900 },
      },
    });
  },
};

// ── RENDER HELPERS ───────────────────────────────────────────────────────────
function renderImportance(containerId, importance) {
  const el = $(containerId);
  if (!el) return;
  const sorted = Object.entries(importance)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const max = sorted[0]?.[1] || 1;

  el.innerHTML = `<div class="importance-list">${
    sorted.map(([k, v]) => `
      <div class="imp-row">
        <div class="imp-name-col">
          <span class="imp-name" title="${k}">${k}</span>
        </div>
        <div class="imp-track-col">
          <div class="imp-track">
            <div class="imp-fill" data-w="${(v / max * 100).toFixed(1)}"></div>
          </div>
        </div>
        <div class="imp-pct">${(v * 100).toFixed(1)}%</div>
      </div>`).join('')
  }</div>`;

  // Animate after paint
  requestAnimationFrame(() => {
    setTimeout(() => {
      el.querySelectorAll('.imp-fill').forEach(bar => {
        bar.style.width = bar.dataset.w + '%';
      });
    }, 80);
  });
}

function renderStatusTable(containerId, trendData, limit = 24) {
  const el = $(containerId);
  if (!el) return;

  const recent = [...trendData].reverse().slice(0, limit);
  el.innerHTML = `
    <div class="table-scroll">
      <table class="status-table">
        <thead><tr>
          <th>Period</th>
          <th>Stability</th>
          <th>Status</th>
          <th>Resilience</th>
        </tr></thead>
        <tbody>${
          recent.map(d => {
            const s = d.status || '';
            const col = statusColor(s);
            return `<tr>
              <td>${formatDate(d.year, d.month)}</td>
              <td>${(d.stability_score ?? d.final_stability ?? 0).toFixed(1)}</td>
              <td><span class="tbl-dot" style="background:${col}"></span>${s}</td>
              <td>${d.resilience_score ? d.resilience_score.toFixed(1) : '—'}</td>
            </tr>`;
          }).join('')
        }</tbody>
      </table>
    </div>`;
}

function renderWarningCards(containerId, data) {
  const el = $(containerId);
  if (!el) return;

  const td = data.trend_data || [];
  const scores = td.map(d => d.stability_score ?? d.final_stability ?? 0);
  const last12 = scores.slice(-12);
  const mean12 = last12.reduce((a, b) => a + b, 0) / (last12.length || 1);
  const variance = last12.reduce((a, b) => a + (b - mean12) ** 2, 0) / (last12.length || 1);
  const std12 = Math.sqrt(variance).toFixed(2);
  const minScore = Math.min(...scores).toFixed(1);
  const maxScore = Math.max(...scores).toFixed(1);
  const lastScore = scores[scores.length - 1]?.toFixed(1) ?? '—';

  const warningLevel = parseFloat(std12) > 8 ? '⚠ HIGH' : parseFloat(std12) > 4 ? '⚡ MOD' : '✓ LOW';
  const warningCol   = parseFloat(std12) > 8 ? '#ef4444' : parseFloat(std12) > 4 ? '#f59e0b' : '#22c55e';

  el.innerHTML = `
    <div class="warning-grid">
      <div class="warning-card">
        <span class="warn-icon">📉</span>
        <span class="warn-label">Min Stability</span>
        <span class="warn-value" style="color:#ef4444">${minScore}</span>
        <span class="warn-sub">All-time low</span>
      </div>
      <div class="warning-card">
        <span class="warn-icon">📈</span>
        <span class="warn-label">Max Stability</span>
        <span class="warn-value" style="color:#22c55e">${maxScore}</span>
        <span class="warn-sub">All-time peak</span>
      </div>
      <div class="warning-card">
        <span class="warn-icon">🔁</span>
        <span class="warn-label">Volatility (STD)</span>
        <span class="warn-value" style="color:${warningCol}">${std12}</span>
        <span class="warn-sub">12-month window</span>
      </div>
      <div class="warning-card">
        <span class="warn-icon">🚨</span>
        <span class="warn-label">Warning Signal</span>
        <span class="warn-value" style="color:${warningCol};font-size:1.1rem">${warningLevel}</span>
        <span class="warn-sub">Based on volatility</span>
      </div>
      <div class="warning-card">
        <span class="warn-icon">⚖️</span>
        <span class="warn-label">12-mo Mean</span>
        <span class="warn-value" style="color:#00d4aa">${mean12.toFixed(1)}</span>
        <span class="warn-sub">Recent average</span>
      </div>
      <div class="warning-card">
        <span class="warn-icon">🎯</span>
        <span class="warn-label">Current Score</span>
        <span class="warn-value" style="color:#00d4aa">${lastScore}</span>
        <span class="warn-sub">Latest reading</span>
      </div>
    </div>`;
}

function gaugeGradient(score) {
  if (score >= 80) return 'linear-gradient(90deg,#22c55e,#00d4aa)';
  if (score >= 60) return 'linear-gradient(90deg,#eab308,#22c55e)';
  if (score >= 40) return 'linear-gradient(90deg,#f97316,#eab308)';
  if (score >= 20) return 'linear-gradient(90deg,#ef4444,#f97316)';
  return 'linear-gradient(90deg,#7f1d1d,#ef4444)';
}

function kpiCardHTML(opts) {
  const { label, icon, value, valueCls, badge, badgeCls, trendDir, trendSlope, subline, gauge } = opts;
  const gaugeBar = gauge !== undefined ? `
    <div class="kpi-gauge-wrap">
      <div class="gauge-track">
        <div class="gauge-fill" style="width:${gauge}%;background:${gaugeGradient(gauge)}"></div>
      </div>
    </div>` : '';
  const trendHtml = trendDir ? `
    <div class="kpi-trend">
      <span class="${trendCls(trendDir)}">${trendIcon(trendDir)} ${trendDir}</span>
      ${trendSlope !== undefined ? `<span>slope ${trendSlope > 0 ? '+' : ''}${trendSlope}</span>` : ''}
    </div>` : '';
  return `
    <div class="kpi-card" style="--kpi-color:${opts.color||'var(--accent)'};--kpi-glow:${opts.glow||'var(--accent-dim)'}">
      <div class="kpi-label"><span class="kpi-icon">${icon||''}</span>${label}</div>
      <div class="kpi-value ${valueCls||''}">${value}</div>
      <span class="kpi-status status-${badgeCls||'stable'}">${badge}</span>
      ${gaugeBar}
      ${trendHtml}
      ${subline ? `<div style="font-family:var(--font-mono);font-size:0.52rem;color:var(--text-muted);margin-top:4px">${subline}</div>` : ''}
    </div>`;
}

// ── ECOSYSTEM PANEL RENDERER ─────────────────────────────────────────────────
function renderEcosystem(panelId, data) {
  const el = $(panelId);
  if (!el) return;

  const uid     = panelId.replace('-panel','');
  const stab    = data.stability_score;
  const risk    = data.collapse_risk_score;
  const metrics = data.model_metrics || {};
  const hasRobust = metrics.r2 !== undefined;

  el.innerHTML = `

    <!-- KPI CARDS -->
    <div class="section-header">
      <span class="section-title">Key Performance Indicators</span>
      <span class="panel-meta">Model: Random Forest · 100 trees</span>
    </div>
    <div class="kpi-grid" id="${uid}-kpis"></div>

    <!-- EARLY WARNING -->
    <div class="section-header" style="margin-top:1.75rem">
      <span class="section-title">Early Warning Indicators</span>
    </div>
    <div id="${uid}-warnings"></div>

    <!-- CHART ROW 1 -->
    <div class="section-header" style="margin-top:1.75rem">
      <span class="section-title">Stability & Risk Timeline (2013–2020)</span>
      <span class="panel-meta">${data.trend_data?.length || 0} monthly observations</span>
    </div>
    <div class="analytics-grid wide" style="margin-bottom:1.5rem">
      <div class="panel-card">
        <div class="panel-header">
          <span class="panel-title"><span class="panel-title-dot"></span>Stability · Risk · Resilience</span>
        </div>
        <div class="chart-container" style="height:260px">
          <canvas id="${uid}-trend-chart"></canvas>
        </div>
      </div>
      <div class="panel-card">
        <div class="panel-header">
          <span class="panel-title"><span class="panel-title-dot" style="background:#f97316"></span>Status Distribution</span>
        </div>
        <div class="chart-container" style="height:260px">
          <canvas id="${uid}-pie-chart"></canvas>
        </div>
      </div>
    </div>

    <!-- CHART ROW 2 -->
    <div class="analytics-grid wide" style="margin-bottom:1.5rem">
      <div class="panel-card">
        <div class="panel-header">
          <span class="panel-title"><span class="panel-title-dot" style="background:#eab308"></span>Volatility & Rolling Mean (Early Warning Signal)</span>
        </div>
        <div class="chart-container" style="height:220px">
          <canvas id="${uid}-ew-chart"></canvas>
        </div>
      </div>
      <div class="panel-card">
        <div class="panel-header">
          <span class="panel-title"><span class="panel-title-dot" style="background:#6366f1"></span>Feature Importance (RF Explainability)</span>
        </div>
        <div id="${uid}-importance" style="padding-top:4px"></div>
      </div>
    </div>

    <!-- STATUS TABLE -->
    <div class="panel-card" style="margin-bottom:1.5rem">
      <div class="panel-header">
        <span class="panel-title"><span class="panel-title-dot" style="background:#8ba4ae"></span>Monthly Status Log</span>
        <span class="panel-meta">Latest 24 months</span>
      </div>
      <div id="${uid}-table"></div>
    </div>

    <!-- FOOTER -->
    <div class="footer-strip">
      <div class="footer-left">
        <div class="sdg-pill sdg-14">🐠 SDG 14</div>
        <div class="sdg-pill sdg-15">🌲 SDG 15</div>
        <div class="ml-badge">⚙ RandomForest</div>
        <div class="ml-badge">⚙ MinMaxScaler</div>
        <div class="ml-badge">⚙ LinearRegression</div>
      </div>
      <div class="footer-right">DATA PERIOD: 2013 – 2020</div>
    </div>
  `;

  // Populate KPIs
  const kpiEl = $(`${uid}-kpis`);
  kpiEl.innerHTML =
    kpiCardHTML({
      label: 'Stability Score', icon: '🌿', value: stab,
      color: '#00d4aa', glow: 'rgba(0,212,170,0.12)',
      badge: data.status, badgeCls: statusCls(data.status),
      trendDir: data.trend_direction, trendSlope: data.trend_slope,
      gauge: stab,
    }) +
    kpiCardHTML({
      label: 'Collapse Risk Score', icon: '⚠',value: risk,
      color: '#ef4444', glow: 'rgba(239,68,68,0.1)',
      badge: data.risk_category, badgeCls: statusCls(data.risk_category),
      gauge: risk,
    }) +
    (hasRobust ? kpiCardHTML({
      label: 'Model R² Score', icon: '🤖', value: metrics.r2,
      valueCls: 'sm',
      color: '#eab308', glow: 'rgba(234,179,8,0.1)',
      badge: metrics.r2 >= 0.85 ? 'High Fit' : metrics.r2 >= 0.6 ? 'Good Fit' : 'Moderate',
      badgeCls: metrics.r2 >= 0.85 ? 'stable' : 'vulnerable',
      subline: `MAE: ${metrics.mae}`,
    }) : '') +
    kpiCardHTML({
      label: 'Trend Direction', icon: '📊',
      value: `<span style="font-size:1.8rem">${trendIcon(data.trend_direction)}</span>`,
      valueCls: 'xs',
      color: data.trend_direction === 'improving' ? '#22c55e' : '#ef4444',
      glow: data.trend_direction === 'improving' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
      badge: data.trend_direction,
      badgeCls: data.trend_direction === 'improving' ? 'stable' : 'critical',
    });

  // Charts
  ChartFactory.stability(`${uid}-trend-chart`, data.trend_data);
  ChartFactory.doughnut(`${uid}-pie-chart`,    data.status_distribution || {});
  ChartFactory.earlyWarning(`${uid}-ew-chart`, data.trend_data);

  // Feature importance
  renderImportance(`${uid}-importance`, data.feature_importance || {});

  // Warning cards
  renderWarningCards(`${uid}-warnings`, data);

  // Table
  renderStatusTable(`${uid}-table`, data.trend_data);
}

// ── COMBINED PANEL ───────────────────────────────────────────────────────────
function renderCombined(data) {
  const el = $('combined-panel');
  if (!el) return;

  el.innerHTML = `
    <!-- COMPARE STRIP -->
    <div class="section-header">
      <span class="section-title">Combined Ecosystem Overview</span>
      <span class="panel-meta">Weighted: Aquatic 60% · Terrestrial 40%</span>
    </div>
    <div class="compare-strip" id="co-compare"></div>

    <!-- EARLY WARNING -->
    <div class="section-header" style="margin-top:1.75rem">
      <span class="section-title">Ecosystem Stress Indicators</span>
    </div>
    <div id="co-warnings"></div>

    <!-- CHARTS -->
    <div class="section-header" style="margin-top:1.75rem">
      <span class="section-title">Combined Stability Timeline</span>
    </div>
    <div class="analytics-grid wide" style="margin-bottom:1.5rem">
      <div class="panel-card">
        <div class="panel-header">
          <span class="panel-title"><span class="panel-title-dot"></span>Aquatic · Terrestrial · Combined · Risk</span>
        </div>
        <div class="chart-container" style="height:280px">
          <canvas id="co-trend-chart"></canvas>
        </div>
      </div>
      <div class="panel-card">
        <div class="panel-header">
          <span class="panel-title"><span class="panel-title-dot" style="background:#f97316"></span>Risk Distribution</span>
        </div>
        <div class="chart-container" style="height:280px">
          <canvas id="co-pie-chart"></canvas>
        </div>
      </div>
    </div>

    <!-- FEATURE IMPORTANCE -->
    <div class="panel-card" style="margin-bottom:1.5rem">
      <div class="panel-header">
        <span class="panel-title"><span class="panel-title-dot" style="background:#6366f1"></span>Combined RF Feature Importance</span>
        <span class="panel-meta">Joint model across both ecosystems</span>
      </div>
      <div id="co-importance"></div>
    </div>

    <!-- TABLE -->
    <div class="panel-card" style="margin-bottom:1.5rem">
      <div class="panel-header">
        <span class="panel-title"><span class="panel-title-dot" style="background:#8ba4ae"></span>Monthly Breakdown</span>
      </div>
      <div class="table-scroll">
        <table class="status-table">
          <thead><tr>
            <th>Period</th>
            <th>Aquatic</th>
            <th>Terrestrial</th>
            <th>Combined</th>
            <th>Risk</th>
            <th>Category</th>
          </tr></thead>
          <tbody id="co-table-body"></tbody>
        </table>
      </div>
    </div>

    <div class="footer-strip">
      <div class="footer-left">
        <div class="sdg-pill sdg-14">🐠 SDG 14</div>
        <div class="sdg-pill sdg-15">🌲 SDG 15</div>
        <div class="ml-badge">⚙ Joint RandomForest</div>
      </div>
      <div class="footer-right">WEIGHTED FUSION MODEL</div>
    </div>
  `;

  // Compare strip
  const cmpEl = $('co-compare');
  const aqSum = data.aquatic_summary || {};
  const teSum = data.terrestrial_summary || {};
  cmpEl.innerHTML = `
    <div class="compare-card">
      <div class="cc-label">🌊 Aquatic</div>
      <div class="cc-value" style="color:#3fa9f5">${data.aquatic_stability_score}</div>
      <span class="kpi-status status-${statusCls(aqSum.status)}">${aqSum.status || '—'}</span>
      <div style="margin-top:6px;font-family:var(--font-mono);font-size:0.52rem;color:var(--text-muted)">${aqSum.trend_direction || ''}</div>
    </div>
    <div class="compare-card">
      <div class="cc-label">🌿 Terrestrial</div>
      <div class="cc-value" style="color:#5ddc72">${data.terrestrial_stability_score}</div>
      <span class="kpi-status status-${statusCls(teSum.status)}">${teSum.status || '—'}</span>
      <div style="margin-top:6px;font-family:var(--font-mono);font-size:0.52rem;color:var(--text-muted)">${teSum.trend_direction || ''}</div>
    </div>
    <div class="compare-card featured">
      <div class="cc-label">🌍 Final Combined Score</div>
      <div class="cc-value" style="color:#00d4aa">${data.final_stability_score}</div>
      <span class="kpi-status status-${statusCls(data.risk_category)}">${data.risk_category}</span>
      <div class="kpi-gauge-wrap" style="margin-top:8px">
        <div class="gauge-track"><div class="gauge-fill" style="width:${data.final_stability_score}%;background:${gaugeGradient(data.final_stability_score)}"></div></div>
      </div>
    </div>
    <div class="compare-card danger-card">
      <div class="cc-label">⚠ Collapse Risk</div>
      <div class="cc-value" style="color:#ef4444">${data.collapse_risk_score}</div>
      <span class="kpi-status status-critical">Risk Score</span>
      <div class="kpi-gauge-wrap" style="margin-top:8px">
        <div class="gauge-track"><div class="gauge-fill" style="width:${data.collapse_risk_score}%;background:linear-gradient(90deg,#7f1d1d,#ef4444)"></div></div>
      </div>
    </div>`;

  // Charts
  ChartFactory.combined('co-trend-chart', data.trend_data);
  ChartFactory.doughnut('co-pie-chart', data.risk_distribution || {});
  renderImportance('co-importance', data.feature_importance || {});
  renderWarningCards('co-warnings', { trend_data: data.trend_data?.map(d => ({
    ...d, stability_score: d.final_stability
  })) || [] });

  // Table body
  const tbody = $('co-table-body');
  if (tbody) {
    tbody.innerHTML = [...(data.trend_data || [])].reverse().slice(0, 30).map(d => {
      const col = statusColor(d.risk_category || '');
      return `<tr>
        <td>${formatDate(d.year, d.month)}</td>
        <td>${d.aquatic_stability?.toFixed(1) ?? '—'}</td>
        <td>${d.terrestrial_stability?.toFixed(1) ?? '—'}</td>
        <td>${d.final_stability?.toFixed(1) ?? '—'}</td>
        <td>${d.risk_score?.toFixed(1) ?? '—'}</td>
        <td><span class="tbl-dot" style="background:${col}"></span>${d.risk_category || '—'}</td>
      </tr>`;
    }).join('');
  }
}

// ── DATA LOADING ─────────────────────────────────────────────────────────────
async function loadPanel(panelName) {
  const ids = { aquatic: 'aquatic-panel', terrestrial: 'terrestrial-panel', combined: 'combined-panel' };
  const panelEl = $(ids[panelName]);
  if (!panelEl) return;

  panelEl.innerHTML = loaderHTML(`RUNNING ${panelName.toUpperCase()} MODEL…`);

  try {
    const data = await apiFetch(API[panelName]);
    State.data[panelName] = data;

    if (panelName === 'aquatic')      { State.baseline.aquatic     = data; renderEcosystem('aquatic-panel', data); }
    if (panelName === 'terrestrial')  { State.baseline.terrestrial = data; renderEcosystem('terrestrial-panel', data); }
    if (panelName === 'combined')     { renderCombined(data); }

  } catch (err) {
    panelEl.innerHTML = errorHTML(err.message);
  }
}

// ── SIMULATION ───────────────────────────────────────────────────────────────
function buildSimResult(data, baseline) {
  const delta = baseline ? (data.stability_score - baseline.stability_score).toFixed(2) : null;
  const deltaDir = delta >= 0 ? 'up' : 'down';

  return `
    <div class="sim-result-header">SIMULATION OUTPUT</div>
    ${delta !== null ? `<div class="sim-result-row">
      <span class="sim-key">Stability Δ</span>
      <span class="sim-val ${deltaDir}">${pct(delta)}</span>
    </div>` : ''}
    <div class="sim-result-row">
      <span class="sim-key">Stability Score</span>
      <span class="sim-val">${data.stability_score}</span>
    </div>
    <div class="sim-result-row">
      <span class="sim-key">Collapse Risk</span>
      <span class="sim-val ${data.collapse_risk_score > 60 ? 'down' : data.collapse_risk_score > 40 ? 'warn' : 'up'}">${data.collapse_risk_score}</span>
    </div>
    <div class="sim-result-row">
      <span class="sim-key">Status</span>
      <span class="sim-val">${data.status}</span>
    </div>
    <div class="sim-result-row">
      <span class="sim-key">Risk Category</span>
      <span class="sim-val">${data.risk_category}</span>
    </div>
    <div class="sim-result-row">
      <span class="sim-key">Trend</span>
      <span class="sim-val ${trendCls(data.trend_direction)}">${trendIcon(data.trend_direction)} ${data.trend_direction}</span>
    </div>
    <div class="sim-result-row">
      <span class="sim-key">R² / MAE</span>
      <span class="sim-val">${data.model_metrics?.r2} / ${data.model_metrics?.mae}</span>
    </div>`;
}

// ── PUBLIC APP OBJECT ─────────────────────────────────────────────────────────
const App = {

  switchTab(id) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    $(`panel-${id}`).classList.add('active');
    document.querySelector(`[data-tab="${id}"]`).classList.add('active');

    if (!State.panelLoaded[id] && id !== 'simulate') {
      State.panelLoaded[id] = true;
      loadPanel(id);
    }
  },

  async runAquaticSim() {
    const btn = $('aq-run-btn');
    const resultEl = $('aq-sim-results');
    btn.disabled = true; btn.textContent = '⏳ RUNNING…';
    try {
      const payload = {
        capture_change:   +$('aq-capture').value,
        temp_change:      +$('aq-temp').value,
        turbidity_change: +$('aq-turbidity').value,
      };
      const data = await apiFetch(API.simAquatic, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      resultEl.innerHTML = buildSimResult(data, State.baseline.aquatic);
      resultEl.classList.add('show');
    } catch(e) {
      resultEl.innerHTML = `<div class="sim-result-row"><span class="sim-key" style="color:var(--danger)">${e.message}</span></div>`;
      resultEl.classList.add('show');
    }
    btn.disabled = false; btn.innerHTML = '▶ RUN SIMULATION';
  },

  async runTerrestrialSim() {
    const btn = $('te-run-btn');
    const resultEl = $('te-sim-results');
    btn.disabled = true; btn.textContent = '⏳ RUNNING…';
    try {
      const payload = {
        temp_change:          +$('te-temp').value,
        co2_change:           +$('te-co2').value,
        deforestation_change: +$('te-deforest').value,
        soil_change:          +$('te-soil').value,
      };
      const data = await apiFetch(API.simTerrestrial, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      resultEl.innerHTML = buildSimResult(data, State.baseline.terrestrial);
      resultEl.classList.add('show');
    } catch(e) {
      resultEl.innerHTML = `<div class="sim-result-row"><span class="sim-key" style="color:var(--danger)">${e.message}</span></div>`;
      resultEl.classList.add('show');
    }
    btn.disabled = false; btn.innerHTML = '▶ RUN SIMULATION';
  },

  resetAquaticSim() {
    ['aq-capture','aq-temp','aq-turbidity'].forEach(id => {
      const el = $(id); if (el) el.value = 0;
    });
    document.querySelectorAll('#aq-sim-panel .slider-val').forEach(el => el.textContent = '0%');
    const r = $('aq-sim-results');
    if (r) { r.classList.remove('show'); r.innerHTML = ''; }
  },

  resetTerrestrialSim() {
    ['te-temp','te-co2','te-deforest','te-soil'].forEach(id => {
      const el = $(id); if (el) el.value = 0;
    });
    document.querySelectorAll('#te-sim-panel .slider-val').forEach(el => el.textContent = '0%');
    const r = $('te-sim-results');
    if (r) { r.classList.remove('show'); r.innerHTML = ''; }
  },

  async generateSampleData() {
    try {
      await apiFetch(API.genData, { method: 'POST' });
      window.location.reload();
    } catch(e) {
      alert('Failed to generate sample data: ' + e.message);
    }
  },

  init() {
    startClock();

    // Load aquatic immediately
    State.panelLoaded.aquatic = true;
    loadPanel('aquatic');

    // Wire sliders — aquatic
    [
      { id: 'aq-capture',   valId: 'aq-capture-val',   unit: '%' },
      { id: 'aq-temp',      valId: 'aq-temp-val',      unit: '%' },
      { id: 'aq-turbidity', valId: 'aq-turbidity-val', unit: '%' },
    ].forEach(({ id, valId, unit }) => {
      const el = $(id);
      if (el) el.addEventListener('input', () => {
        const v = $(id).value;
        $(valId).textContent = (v > 0 ? '+' : '') + v + unit;
      });
    });

    // Wire sliders — terrestrial
    [
      { id: 'te-temp',     valId: 'te-temp-val',     unit: '%' },
      { id: 'te-co2',      valId: 'te-co2-val',      unit: '%' },
      { id: 'te-deforest', valId: 'te-deforest-val', unit: '%' },
      { id: 'te-soil',     valId: 'te-soil-val',     unit: '%' },
    ].forEach(({ id, valId, unit }) => {
      const el = $(id);
      if (el) el.addEventListener('input', () => {
        $(valId).textContent = '+' + $(id).value + unit;
      });
    });
  },
};

// ── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
