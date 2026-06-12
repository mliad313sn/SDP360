/* IT Activity Tracker — React app
 *
 * Phase 2 of the rebuild: shell + Dashboard tab fully wired to
 * /api/tracker/load. Six remaining tabs (Scoring, Input, Heatmap,
 * Tracker Setup, Targets, Roadmap) ship as branded stubs that say
 * "Coming in phase N" — they get real implementations across phases
 * 3, 4 and 5.
 *
 * Architecture:
 *   - window.TR  — scoring engine (engine.js)
 *   - window.TRApi — fetch wrappers (api.js)
 *   - This file: composition, components, charts
 *
 * RBAC reads window.__authUser + window.__userHasRole, populated by
 * auth.js before our boot runs.
 */

const { useState, useEffect, useRef, useMemo } = React;

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function hasRole(role) {
  if (typeof window.__userHasRole === 'function') return window.__userHasRole(role);
  return false;
}
const _user = () => window.__authUser || null;

const SITE_NAME_TO_CODE = {
  'MANA':'MGO',  'Mana IT Agent':'MGO',
  'HOUNDE':'HGO','Hounde IT Agents':'HGO',
  'LAFIGUE':'SML','Lafigue IT Agents':'SML',
  'ITY':'ITY',   'ITY IT Agents':'ITY',
  'Sabodala':'SGO','Sabodala IT Agents':'SGO',
  'ABIDJAN':'ABJ','Abidjan IT Agents':'ABJ',
  'Dakar':'DKR', 'Dakar IT Agents':'DKR',
  'KALANA':'KLN','Kalana IT Agents':'KLN',
  'EXPLORATION':'EXP','Exploration BF Support':'EXP','Exploration CI Support':'EXP',
  'OUAGA':'EDV', 'Ouaga IT Agents':'EDV','Ouagadougou-EDV1':'EDV',
  'TANDA':'TND', 'Tanda IT Agents':'TND',
};

function computeRoles() {
  const u = _user();
  const IS_EXEC      = !u || hasRole('executive') || hasRole('tracker-admin');
  const CAN_RESET    = hasRole('super_admin') || hasRole('tracker-admin');
  const CAN_SAVE_ALL = hasRole('super_admin') || hasRole('tracker-admin');
  const CAN_SAVE_OWN = hasRole('tracker-editor');
  const CAN_SAVE     = CAN_SAVE_ALL || CAN_SAVE_OWN;
  const USER_SITE = (CAN_SAVE_OWN && !CAN_SAVE_ALL && u?.site_name)
    ? (SITE_NAME_TO_CODE[u.site_name] || null)
    : null;
  return { IS_EXEC, CAN_RESET, CAN_SAVE_ALL, CAN_SAVE_OWN, CAN_SAVE, USER_SITE };
}

const fmtDelta = (n) => {
  if (n === 0 || Math.abs(n) < 0.01) return null;
  return (n > 0 ? '▲ ' : '▼ ') + Math.round(Math.abs(n) * 100) + 'pp';
};
const deltaCls = (n) => (n > 0 ? 'dash-delta--up' : n < 0 ? 'dash-delta--down' : 'dash-delta--flat');

// Find the latest month (1-12) that has ANY non-zero input value
// recorded across all sites for the given year. Used as the boot-time
// default for S.month so a user landing on the page sees the most
// meaningful snapshot rather than whatever was stuck in D.currentMonth.
// Returns null if the year has no input data at all.
function lastMonthWithData(D, year) {
  const yearData = D?.inputs?.[year];
  if (!yearData) return null;
  let last = 0;
  for (const siteCode of Object.keys(yearData)) {
    const siteArr = yearData[siteCode];
    if (!Array.isArray(siteArr)) continue;
    for (const actRow of siteArr) {
      if (!Array.isArray(actRow)) continue;
      // Scan from the right; first non-zero index wins for this row
      for (let mi = actRow.length - 1; mi >= 0; mi--) {
        if (actRow[mi] > 0) {
          if (mi + 1 > last) last = mi + 1;
          break;
        }
      }
    }
  }
  return last || null;
}

// Pick the most useful default year for the toolbar dropdown.
// Priority chain (so the landing experience always shows something
// meaningful — never a blank year, never a year that isn't in the
// dropdown's options):
//
//   1. The current calendar year IF it's in D.years.
//   2. Otherwise, the largest year in D.years that's ≤ current year
//      (most recent past year — operator is presumably reviewing
//      last completed reporting period).
//   3. Otherwise, the smallest year in D.years that's > current year
//      (only-future years configured — start at the earliest planned).
//   4. Otherwise (D.years empty), the current calendar year as a last
//      resort. The Tracker Setup tab will prompt to add one.
//
// Returns a number. Never null.
function defaultYear(D) {
  const now = new Date().getFullYear();
  const years = (Array.isArray(D?.years) ? D.years : []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (years.includes(now))    return now;
  const past = years.filter(y => y <= now);
  if (past.length)            return past[past.length - 1];
  if (years.length)           return years[0];     // only future years configured
  return now;                                       // empty list
}

// ────────────────────────────────────────────────────────────────────
// Tab definitions
// ────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'scoring',   label: 'Scoring' },
  { id: 'input',     label: 'Input' },
  { id: 'heatmap',   label: 'Heatmap' },
  { id: 'setup',     label: 'Tracker Setup' },
  { id: 'targets',   label: 'Targets' },
  { id: 'roadmap',   label: 'Roadmap' },
];
// Exec-only tabs: editor users without admin role can't see cross-site config.
const EXEC_ONLY = new Set(['heatmap', 'setup', 'targets']);

// ────────────────────────────────────────────────────────────────────
// Toolbar (year + month + save/reset/export)
// ────────────────────────────────────────────────────────────────────
function Toolbar({ D, S, setS, dirty, syncState, syncError, onSave, onReset, onExport, roles }) {
  return (
    <div className="tt-bar">
      <div className="tt-bar__title">
        IT Activity Tracker
        <small>{D.sites.length} sites · {D.activities.length} activities · {D.activeSites.length} active</small>
      </div>
      <div className="tt-bar__spacer" />
      <SyncIndicator dirty={dirty} syncState={syncState} syncError={syncError} />
      <div className="tt-bar__pickers">
        <label>Year</label>
        <select className="tt-select" value={S.year} onChange={e => setS({ ...S, year: +e.target.value })}>
          {(D.years || []).map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label>Period</label>
        <select className="tt-select" value={S.month} onChange={e => setS({ ...S, month: +e.target.value })}>
          {MO.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </div>
      {roles.IS_EXEC && (
        <button className="btn-ghost" type="button" onClick={onExport} title="Export the Activity Tracker as a multi-slide PPTX">
          📊 Export PPTX
        </button>
      )}
      {roles.CAN_SAVE && (
        <button
          className="btn-primary"
          type="button"
          onClick={onSave}
          disabled={syncState === 'saving'}
          title={
            syncState === 'saving' ? 'Save in progress…'
            : dirty                ? 'Save unsynced changes now (bypasses the 0.8 s debounce)'
            : 'Force a save — everything already in sync, but this re-pushes the full tracker state to the server as confirmation'
          }
        >
          {syncState === 'saving' ? '💾 Saving…' : dirty ? '💾 Save *' : '💾 Save'}
        </button>
      )}
      {roles.CAN_RESET && (
        <button className="btn-danger" type="button" onClick={onReset}>↻ Reset</button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// EXPORT MODAL — pick year/month/sites and POST /api/tracker/export
// ════════════════════════════════════════════════════════════════════
function ExportModal({ D, S, onClose }) {
  const [year, setYear]   = useState(S.year);
  const [month, setMonth] = useState(S.month);
  const [sites, setSites] = useState(() => D.activeSites || []);
  const [busy, setBusy]   = useState(false);
  const [err,  setErr]    = useState(null);
  const [done, setDone]   = useState(null);

  const activeSites = D.activeSites || [];
  const allSites    = D.sites || [];

  function toggleSite(code) {
    setSites(prev => prev.includes(code) ? prev.filter(s => s !== code) : [...prev, code]);
  }
  function selectAll()    { setSites([...activeSites]); }
  function selectNone()   { setSites([]); }

  async function run() {
    setBusy(true); setErr(null); setDone(null);
    try {
      const blob = await window.TRApi.exportPptx({ sites, yr: year, mo: month });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'IT_Ops_Strategy_' + MO[month - 1] + year + '.pptx';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDone('Downloaded IT_Ops_Strategy_' + MO[month - 1] + year + '.pptx');
    } catch (e) {
      setErr(e.message || 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={'Export PPTX — ' + MO[month - 1] + ' ' + year}
      onCancel={onClose}
      onConfirm={run}
      confirmLabel={busy ? 'Generating…' : (done ? 'Download again' : 'Generate PPTX')}
      confirmKind="primary"
      confirmDisabled={busy || sites.length === 0}
      wide
    >
      <p style={{ margin: '0 0 14px', fontSize: 12.5, lineHeight: 1.55 }}>
        Generates a multi-slide PowerPoint deck from the current tracker data — KPI strip,
        site cards, charts and per-pillar breakdowns. Inactive sites are filtered out on the
        server side regardless of selection.
      </p>

      <div className="exp-form">
        <div className="exp-row">
          <label>Year</label>
          <select className="tt-select" value={year} onChange={e => setYear(+e.target.value)} disabled={busy}>
            {(D.years || []).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="exp-row">
          <label>Reporting month</label>
          <select className="tt-select" value={month} onChange={e => setMonth(+e.target.value)} disabled={busy}>
            {MO.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>

        <div className="exp-row">
          <label>Sites <small>({sites.length} selected)</small></label>
          <div className="exp-site-grid">
            {allSites.map(code => {
              const isActive = activeSites.includes(code);
              const isPicked = sites.includes(code);
              return (
                <button
                  key={code} type="button"
                  className={'exp-site ' + (isPicked ? 'is-picked' : '') + (isActive ? '' : ' is-inactive')}
                  onClick={() => isActive && !busy && toggleSite(code)}
                  disabled={!isActive || busy}
                  title={isActive ? (D.siteNames[code] || code) : (D.siteNames[code] || code) + ' — inactive (cannot export)'}
                  style={isPicked && isActive ? { background: D.siteColors[code], borderColor: D.siteColors[code], color: '#fff' } : {}}
                >
                  <span className="exp-site__code">{code}</span>
                  <span className="exp-site__name">{D.siteNames[code] || code}</span>
                </button>
              );
            })}
          </div>
          <div className="exp-quick">
            <button type="button" className="btn-ghost" onClick={selectAll}  disabled={busy}>All active</button>
            <button type="button" className="btn-ghost" onClick={selectNone} disabled={busy}>None</button>
          </div>
        </div>

        {busy && <div className="tt-banner" style={{ background: 'rgba(20,95,174,.08)', borderLeft: '3px solid var(--edv-blue)', color: '#0F4C81' }}>⏳ Generating PPTX server-side — this can take 10–30 seconds for a fleet-wide report.</div>}
        {err  && <div className="tt-banner" style={{ background: 'rgba(217,0,56,.08)', borderLeft: '3px solid var(--color-danger)', color: '#991B1B' }}>❌ {err}</div>}
        {done && <div className="tt-banner" style={{ background: 'rgba(27,154,58,.08)', borderLeft: '3px solid var(--color-success)', color: '#166534' }}>✅ {done}</div>}
      </div>
    </Modal>
  );
}

function SyncIndicator({ dirty, syncState, syncError }) {
  if (syncState === 'saving') return <span className="tt-status tt-status--dirty"><span className="tt-status__dot" /> Saving…</span>;
  if (syncState === 'fail')   return <span className="tt-status tt-status--fail" title={syncError || ''}><span className="tt-status__dot" /> Save failed — retry</span>;
  if (dirty) return <span className="tt-status tt-status--dirty"><span className="tt-status__dot" /> Unsaved changes</span>;
  return <span className="tt-status tt-status--synced"><span className="tt-status__dot" /> Synced</span>;
}

// ────────────────────────────────────────────────────────────────────
// Tabs strip
// ────────────────────────────────────────────────────────────────────
function Tabs({ activeId, onSelect, visibleTabs }) {
  return (
    <div className="tt-tabs" role="tablist">
      {visibleTabs.map(t => (
        <button
          key={t.id}
          type="button"
          className={'tt-tab ' + (t.id === activeId ? 'is-active' : '')}
          onClick={() => onSelect(t.id)}
          role="tab"
          aria-selected={t.id === activeId}
        >
          {t.label}
          {t.badge && <span className="tt-tab__badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// DASHBOARD PANEL — fully implemented in Phase 2
// ────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────
// DASHBOARD PANEL — preview-aligned hierarchy (Phase 3.5 retrofit)
// ────────────────────────────────────────────────────────────────────
// New top section matches /dashboard-preview/:
//   Row 1  Overall Score card  +  6-month Trend card
//   Row 2  Pillar Health card  +  Site Leaderboard card
// Then kept from the legacy:
//   Executive Commentary (combined + site-specific bullets)
//   4 charts (was 6 — Trend moved to the hero, Pillar Deep-Dive
//             absorbed by Pillar Health card)

function DashboardPanel({ D, S }) {
  const TR = window.TR;
  const aS = D.activeSites || [];
  const PWmonth = S.month > 1 ? S.month - 1 : 1;

  // Per-site summary (current + prev month — used by leaderboard + deltas)
  const sm  = useMemo(() => { const m = {}; D.sites.forEach(s => { m[s] = TR.ss(D, s, S.year, S.month);  }); return m; }, [D, S.year, S.month]);
  const psm = useMemo(() => { const m = {}; D.sites.forEach(s => { m[s] = TR.ss(D, s, S.year, PWmonth); }); return m; }, [D, S.year, PWmonth]);

  // Fleet-wide stats (best / worst / attainment / completion / trends)
  const fst    = useMemo(() => TR.fleetStats(D, aS, S.year, S.month),  [D, aS.join('|'), S.year, S.month]);
  const fstPrev= useMemo(() => TR.fleetStats(D, aS, S.year, PWmonth), [D, aS.join('|'), S.year, PWmonth]);

  // Per-pillar fleet score (avg of site pillar scores across active sites)
  const pillars = useMemo(() => TR.gP(D), [D]);
  const pillarFleet = useMemo(() => {
    const out = {};
    pillars.forEach(p => {
      const cur  = aS.length ? aS.reduce((t, s) => t + TR.ps2(D, s, p, S.year, S.month),  0) / aS.length : 0;
      const prev = aS.length ? aS.reduce((t, s) => t + TR.ps2(D, s, p, S.year, PWmonth), 0) / aS.length : 0;
      const activeSitesForPillar = aS.filter(s => TR.score(D, s, S.year, S.month).some(r => r.pillar === p && r.on)).length;
      out[p] = { cur, prev, delta: cur - prev, activeSites: activeSitesForPillar };
    });
    return out;
  }, [D, aS.join('|'), S.year, S.month, PWmonth]);

  // Fleet totals + active/inactive
  const tG = aS.reduce((t, s) => t + sm[s].g, 0);
  const tA = aS.reduce((t, s) => t + sm[s].a, 0);
  const tR = aS.reduce((t, s) => t + sm[s].r, 0);
  const inactiveSites = D.sites.filter(s => !aS.includes(s));

  // Commentary
  const coms = useMemo(() => TR.genCom(D, aS, S.year, S.month), [D, aS.join('|'), S.year, S.month]);
  const combined = coms.filter(c => c.cat === 'COMBINED');
  const siteSpec = coms.filter(c => c.cat === 'SITE');
  const info     = coms.filter(c => c.cat === 'INFO');

  // ── Drill-down state + 6-month trend helpers (2026-06-04) ────────
  // Click a pillar row or a site row → expand a Chart.js mini-trend
  // inline beneath the row. Trend = last 6 months ending at S.month
  // (handles year wrap for periods before Jan).
  const [drilledPillar, setDrilledPillar] = useState(null);
  const [drilledSite,   setDrilledSite]   = useState(null);

  // Last-6-months window ending at S.{year, month}
  const trendWindow = useMemo(() => {
    const out = [];
    let y = S.year, m = S.month;
    for (let i = 0; i < 6; i++) {
      out.unshift({ year: y, month: m, label: `${MO[m - 1]} ${String(y).slice(-2)}` });
      m--; if (m < 1) { m = 12; y--; }
    }
    return out;
  }, [S.year, S.month]);

  // Score per pillar per month — fleet avg across active sites
  const pillarTrends = useMemo(() => {
    const out = {};
    pillars.forEach(p => {
      out[p] = trendWindow.map(({ year, month }) => {
        if (!aS.length) return 0;
        const sum = aS.reduce((t, s) => t + TR.ps2(D, s, p, year, month), 0);
        return Math.round(sum / aS.length * 100);
      });
    });
    return out;
  }, [D, aS.join('|'), pillars.join('|'), trendWindow]);

  // Score per site per month
  const siteTrends = useMemo(() => {
    const out = {};
    aS.forEach(s => {
      out[s] = trendWindow.map(({ year, month }) => Math.round(TR.ss(D, s, year, month).avg * 100));
    });
    return out;
  }, [D, aS.join('|'), trendWindow]);

  // Site leaderboard — active sites sorted by score desc, then code
  const ranked = useMemo(() => {
    return aS
      .slice()
      .sort((a, b) => (sm[b].avg - sm[a].avg) || a.localeCompare(b))
      .map((code, ix) => {
        const v = sm[code];
        const delta = S.month > 1 ? (v.avg - (psm[code]?.avg || 0)) : 0;
        return { rank: ix + 1, code, name: D.siteNames[code] || code, score: v.avg, delta, g: v.g, a: v.a, r: v.r };
      });
  }, [aS.join('|'), D, S.year, S.month, sm, psm]);

  // Hero stats — what surfaces on the Overall Score card
  const overallPct  = Math.round(fst.avg * 100);
  const overallDelta= S.month > 1 ? (fst.avg - fstPrev.avg) : 0;
  const onTargetPct = Math.round(fst.attainment * 100);
  const showingPct  = Math.round(fst.completion * 100);

  // ─ Charts setup (4 kept after the retrofit) ────────────────────
  const chartRefs = useRef({});
  useEffect(() => {
    if (typeof Chart === 'undefined') return;
    const P = pillars;
    const co = { responsive: true, animation: { duration: 300 }, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } };
    Object.values(chartRefs.current).forEach(c => { try { c.destroy(); } catch (e) {} });
    chartRefs.current = {};

    // hero — 6-month fleet trend (single line, no legend)
    const cHeroTrend = document.getElementById('dash-trend-hero');
    if (cHeroTrend) chartRefs.current.heroTrend = new Chart(cHeroTrend, {
      type: 'line',
      data: {
        labels: fst.trends.map(t => MO[t.month - 1]),
        datasets: [{
          label: 'Fleet', data: fst.trends.map(t => Math.round(t.avg * 100)),
          borderColor: '#145FAE', backgroundColor: 'rgba(20,95,174,0.10)',
          borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6, tension: 0.35, fill: true,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => 'Fleet avg: ' + c.parsed.y + '%' } } }, scales: { y: { max: 100, ticks: { callback: v => v + '%', font: { size: 10 } }, grid: { color: '#f1f5f9' } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } } },
    });

    // c1 — avg score by site (bar)
    const c1 = document.getElementById('dash-c1');
    if (c1) chartRefs.current.c1 = new Chart(c1, {
      type: 'bar',
      data: { labels: aS, datasets: [{ data: aS.map(s => Math.round(sm[s].avg * 100)), backgroundColor: aS.map(s => D.siteColors[s]), borderRadius: 4, barPercentage: 0.6 }] },
      options: { ...co, scales: { ...co.scales, y: { ...co.scales.y, max: 100, ticks: { callback: v => v + '%' } } } },
    });

    // c3 — RAG distribution by pillar (stacked)
    const c3 = document.getElementById('dash-c3');
    if (c3) {
      const rd = P.map(p => {
        let g = 0, a = 0, r = 0;
        aS.forEach(s => { TR.score(D, s, S.year, S.month).forEach(x => { if (x.pillar === p) { if (x.rg === 'GREEN') g++; if (x.rg === 'AMBER') a++; if (x.rg === 'RED') r++; } }); });
        return { g, a, r };
      });
      chartRefs.current.c3 = new Chart(c3, {
        type: 'bar',
        data: { labels: P.map(TR.gPS), datasets: [
          { label: 'Green', data: rd.map(d => d.g), backgroundColor: '#16a34a', borderRadius: 2 },
          { label: 'Amber', data: rd.map(d => d.a), backgroundColor: '#d97706', borderRadius: 2 },
          { label: 'Red',   data: rd.map(d => d.r), backgroundColor: '#dc2626', borderRadius: 2 },
        ] },
        options: { ...co, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } } }, scales: { y: { stacked: true, grid: { color: '#f1f5f9' } }, x: { stacked: true, grid: { display: false } } } },
      });
    }

    // c4 — site G/A/R stacked
    const c4 = document.getElementById('dash-c4');
    if (c4) chartRefs.current.c4 = new Chart(c4, {
      type: 'bar',
      data: { labels: aS, datasets: [
        { label: 'Green', data: aS.map(s => sm[s].g), backgroundColor: '#16a34a' },
        { label: 'Amber', data: aS.map(s => sm[s].a), backgroundColor: '#d97706' },
        { label: 'Red',   data: aS.map(s => sm[s].r), backgroundColor: '#dc2626' },
      ] },
      options: { ...co, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } } }, scales: { y: { stacked: true, grid: { color: '#f1f5f9' } }, x: { stacked: true, grid: { display: false } } } },
    });

    // c5 — RAG doughnut (target attainment)
    const c5 = document.getElementById('dash-c5');
    if (c5) chartRefs.current.c5 = new Chart(c5, {
      type: 'doughnut',
      data: { labels: ['Green (On Target)', 'Amber (At Risk)', 'Red (Off Track)'], datasets: [{ data: [tG, tA, tR], backgroundColor: ['#16a34a', '#d97706', '#dc2626'], borderWidth: 2, borderColor: '#fff' }] },
      options: { responsive: true, animation: { duration: 300 }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: function (c) { const t = c.dataset.data.reduce((a, b) => a + b, 0); return c.label + ': ' + c.raw + ' (' + Math.round(c.raw / t * 100) + '%)'; } } } } },
    });

    return () => {
      Object.values(chartRefs.current).forEach(c => { try { c.destroy(); } catch (e) {} });
      chartRefs.current = {};
    };
  }, [D, S.year, S.month, aS.join('|'), pillars.join('|')]);

  // ── Drill-down mini-chart effect — separate so the main dashboard
  //    charts don't re-render every time someone clicks expand. The
  //    chart is mounted/destroyed based on `drilledPillar` / `drilledSite`.
  useEffect(() => {
    if (typeof Chart === 'undefined') return;
    const cleanup = [];
    const co = { responsive: true, maintainAspectRatio: false, animation: { duration: 250 } };

    if (drilledPillar) {
      const el = document.getElementById('dash-drill-pillar-chart');
      const data = pillarTrends[drilledPillar] || [];
      if (el && data.length) {
        const ch = new Chart(el, {
          type: 'line',
          data: {
            labels: trendWindow.map(p => p.label),
            datasets: [{
              label: TR.gPS(drilledPillar),
              data,
              borderColor: TR.gPC(D, drilledPillar) || '#145FAE',
              backgroundColor: (TR.gPC(D, drilledPillar) || '#145FAE') + '22',
              borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6, tension: 0.35, fill: true,
            }],
          },
          options: { ...co, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + '% fleet avg' } } }, scales: { y: { max: 100, ticks: { callback: v => v + '%', font: { size: 9 } } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } } },
        });
        cleanup.push(ch);
      }
    }

    if (drilledSite) {
      const el = document.getElementById('dash-drill-site-chart');
      const data = siteTrends[drilledSite] || [];
      if (el && data.length) {
        const ch = new Chart(el, {
          type: 'line',
          data: {
            labels: trendWindow.map(p => p.label),
            datasets: [{
              label: D.siteNames[drilledSite] || drilledSite,
              data,
              borderColor: D.siteColors[drilledSite] || '#1A3A5F',
              backgroundColor: (D.siteColors[drilledSite] || '#1A3A5F') + '22',
              borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6, tension: 0.35, fill: true,
            }],
          },
          options: { ...co, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + '%' } } }, scales: { y: { max: 100, ticks: { callback: v => v + '%', font: { size: 9 } } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } } },
        });
        cleanup.push(ch);
      }
    }

    return () => { cleanup.forEach(c => { try { c.destroy(); } catch (e) {} }); };
  }, [drilledPillar, drilledSite, pillarTrends, siteTrends, trendWindow, D]);

  return (
    <div className="tt-panel">

      {/* HERO ROW — Overall Score + 6-month trend */}
      <div className="dash-hero">
        <div className="dash-hero__overall">
          <div className="dash-eyebrow">Overall Score · {MO[S.month - 1]} {S.year}</div>
          <div className="dash-hero__score-row">
            <span className="dash-hero__score">{overallPct}</span>
            <span className="dash-hero__pct">%</span>
            {S.month > 1 && fmtDelta(overallDelta) && (
              <span className={'dash-hero__delta ' + deltaCls(overallDelta)}>{fmtDelta(overallDelta)}</span>
            )}
          </div>
          <div className="dash-hero__stats">
            <div><b>{onTargetPct}%</b> of activities <small>on target</small></div>
            <div><b>{showingPct}%</b> <small>showing progress</small></div>
            <div><small>Best</small> <b style={{ color: D.siteColors[fst.best] }}>{fst.best}</b> <b>{Math.round((sm[fst.best]?.avg || 0) * 100)}%</b></div>
            <div className="dash-hero__watch"><small>Watch</small> <b style={{ color: D.siteColors[fst.worst] }}>{fst.worst}</b> <b>{Math.round((sm[fst.worst]?.avg || 0) * 100)}%</b></div>
          </div>
        </div>
        <div className="dash-hero__trend">
          <div className="dash-eyebrow" style={{ marginBottom: 8 }}>6-month trend</div>
          <div className="dash-hero__trend-canvas"><canvas id="dash-trend-hero" /></div>
        </div>
      </div>

      {/* TWO-COLUMN ROW — Pillar Health + Site Leaderboard */}
      <div className="dash-twocol">

        {/* Pillar Health */}
        <div className="dash-card-block">
          <div className="dash-card-block__head">
            <div>
              <h3>Pillar Health</h3>
              <small>Strategic dimensions · weighted by importance</small>
            </div>
          </div>
          <div className="dash-pillar-list">
            {pillars.map(p => {
              const color = TR.gPC(D, p);
              const cur = pillarFleet[p].cur;
              const delta = pillarFleet[p].delta;
              const weight = Math.round((D.pillarWeights?.[p] || 0) * 100);
              const pct = Math.round(cur * 100);
              const expanded = drilledPillar === p;
              return (
                <div key={p} className={'dash-pillar' + (expanded ? ' dash-pillar--expanded' : '')}>
                  <div className="dash-pillar__head"
                       style={{ cursor: 'pointer' }}
                       onClick={() => setDrilledPillar(expanded ? null : p)}
                       title={expanded ? 'Click to collapse trend' : 'Click to see 6-month trend'}>
                    <span className="dash-pillar__chip" style={{ background: color }}>{p.split('-')[0]}</span>
                    <div className="dash-pillar__meta">
                      <div className="dash-pillar__name">
                        {TR.gPS(p)}
                        <span style={{ marginLeft: 6, color: 'var(--color-text-muted)', fontSize: 11 }}>
                          {expanded ? '▴' : '▾'}
                        </span>
                      </div>
                      <small>{weight}% weight · {pillarFleet[p].activeSites} active sites</small>
                    </div>
                    <div className="dash-pillar__right">
                      <span className="dash-pillar__pct">{pct}<small>%</small></span>
                      {S.month > 1 && fmtDelta(delta) && (
                        <span className={'dash-delta ' + deltaCls(delta)}>{fmtDelta(delta)}</span>
                      )}
                    </div>
                  </div>
                  <div className="dash-pillar__bar">
                    <div className="dash-pillar__bar-fill" style={{ width: pct + '%', background: color }} />
                  </div>
                  {expanded && (
                    <div className="dash-pillar__drill" style={{ padding: '10px 8px 4px', borderTop: '1px solid var(--color-border)', marginTop: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                        6-MONTH FLEET TREND · {TR.gPS(p).toUpperCase()}
                      </div>
                      <div style={{ height: 140, position: 'relative' }}>
                        <canvas id="dash-drill-pillar-chart" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Site Leaderboard */}
        <div className="dash-card-block">
          <div className="dash-card-block__head">
            <div>
              <h3>Site Leaderboard</h3>
              <small>{aS.length} active · {inactiveSites.length} inactive · ranked by overall score</small>
            </div>
          </div>
          <div className="dash-lb">
            <div className="dash-lb__head" role="row">
              <span>#</span><span>Site</span>
              <span style={{ textAlign: 'center' }}>Activities <small>G/A/R</small></span>
              <span style={{ textAlign: 'right' }}>Score</span>
              <span style={{ textAlign: 'right' }}>vs prev</span>
            </div>
            {ranked.map(row => {
              // RAG thresholds for SITE-level score (different from the
              // activity-level 80/50 cuts — preview uses 65/55 because
              // a site weighted average is more compressed than an
              // individual activity). Matches /dashboard-preview/.
              const pct = Math.round(row.score * 100);
              const barRag = pct < 55 ? 'red' : pct < 65 ? 'amber' : 'green';
              const expanded = drilledSite === row.code;
              return (
                <React.Fragment key={row.code}>
                  <div className={'dash-lb__row' + (expanded ? ' dash-lb__row--expanded' : '')}
                       role="row"
                       style={{ cursor: 'pointer' }}
                       onClick={() => setDrilledSite(expanded ? null : row.code)}
                       title={expanded ? 'Click to collapse trend' : 'Click to see 6-month trend'}>
                    <span className="dash-lb__rank">{row.rank}</span>
                    <div className="dash-lb__site">
                      <span className="dash-lb__code" style={{ background: D.siteColors[row.code] }}>{row.code}</span>
                      <span className="dash-lb__name">
                        {row.name}
                        <span style={{ marginLeft: 6, color: 'var(--color-text-muted)', fontSize: 11 }}>
                          {expanded ? '▴' : '▾'}
                        </span>
                      </span>
                    </div>
                    <span className="dash-lb__gar">
                      <span className="g">{row.g}</span><span className="sep">/</span>
                      <span className="a">{row.a}</span><span className="sep">/</span>
                      <span className="r">{row.r}</span>
                    </span>
                    <div className="dash-lb__score">
                      <div className="dash-lb__bar">
                        <div className={'dash-lb__bar-fill dash-lb__bar-fill--' + barRag} style={{ width: pct + '%' }} />
                      </div>
                      <b>{pct}%</b>
                    </div>
                    <span className="dash-lb__delta">
                      {S.month > 1 && fmtDelta(row.delta)
                        ? <span className={'dash-delta ' + deltaCls(row.delta)}>{fmtDelta(row.delta)}</span>
                        : <small style={{ color: 'var(--color-text-muted)' }}>—</small>}
                    </span>
                  </div>
                  {expanded && (
                    <div className="dash-lb__drill" style={{
                      padding: '10px 12px 6px',
                      borderBottom: '1px solid var(--color-border)',
                      background: 'var(--color-bg-subtle, #fafafa)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                        6-MONTH SCORE TREND · {row.name.toUpperCase()}
                      </div>
                      <div style={{ height: 140, position: 'relative' }}>
                        <canvas id="dash-drill-site-chart" />
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            {inactiveSites.length > 0 && (
              <div className="dash-lb__inactives">
                <small>{inactiveSites.length} sites inactive ·</small>
                {inactiveSites.map(code => (
                  <span key={code} className="dash-lb__inactive-chip" title={(D.siteNames[code] || code) + ' — inactive'}>{code}</span>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Executive Commentary — kept from legacy */}
      <div className="dash-commentary">
        <h4>📝 Executive Commentary — {MO[S.month - 1]} {S.year}{S.month > 1 ? ' vs ' + MO[S.month - 2] : ''}</h4>
        {info.map((c, i) => <div key={'i' + i} className="dash-commentary__line" style={{ color: 'var(--color-text-muted)' }}>ℹ️ {c.text}</div>)}
        {combined.length > 0 && <div className="dash-commentary__group dash-commentary__group--combined">🌐 Cross-Site (Combined)</div>}
        {combined.map((c, i) => {
          const isG = /positive|completed/.test(c.text);
          const isB = /attention|RED|regressed/.test(c.text);
          return <div key={'c' + i} className={'dash-commentary__line ' + (isG ? 'dash-commentary__line--good' : isB ? 'dash-commentary__line--bad' : '')}>{c.text}</div>;
        })}
        {siteSpec.length > 0 && <div className="dash-commentary__group dash-commentary__group--site">📍 Site-Specific</div>}
        {siteSpec.map((c, i) => {
          const isG = /Improved|GREEN|standout/.test(c.text);
          const isB = /Declined|RED|dropped/.test(c.text);
          return <div key={'s' + i} className={'dash-commentary__line ' + (isG ? 'dash-commentary__line--good' : isB ? 'dash-commentary__line--bad' : '')}>{c.text}</div>;
        })}
      </div>

      {/* Charts — 4 kept (trend moved up, pillar deep-dive absorbed by Pillar Health) */}
      <div className="dash-charts">
        <div className="dash-chart-card"><h3>🎯 Target Attainment</h3><canvas id="dash-c5" /></div>
        <div className="dash-chart-card"><h3>Average Score by Site</h3><canvas id="dash-c1" /></div>
        <div className="dash-chart-card"><h3>RAG Distribution by Pillar</h3><canvas id="dash-c3" /></div>
        <div className="dash-chart-card"><h3>Site G/A/R Stacks</h3><canvas id="dash-c4" /></div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Site picker — used by Scoring + Input
// ────────────────────────────────────────────────────────────────────
// Renders either a dropdown of active sites (admin+) or a locked
// site badge (editor). When `lockSite` is set, the value is forced
// regardless of what the user clicks.
function SitePicker({ D, value, onChange, lockSite, label = 'Site' }) {
  const sites = (D.activeSites && D.activeSites.length ? D.activeSites : D.sites).filter(s => D.sites.includes(s));
  if (lockSite) {
    return (
      <div className="tt-site-picker">
        <label>{label}</label>
        <span className="tt-site-locked" style={{ background: D.siteColors[lockSite] || '#3A4A60' }}>
          {lockSite}
        </span>
        <small style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {D.siteNames[lockSite] || ''} · locked to your site
        </small>
      </div>
    );
  }
  return (
    <div className="tt-site-picker">
      <label>{label}</label>
      <select className="tt-select" value={value} onChange={e => onChange(e.target.value)}>
        {sites.map(s => (
          <option key={s} value={s}>{s} — {D.siteNames[s] || s}</option>
        ))}
      </select>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// SCORING PANEL — per-site activity breakdown grouped by pillar
// ────────────────────────────────────────────────────────────────────
function ScoringPanel({ D, S, setS, roles }) {
  const TR = window.TR;
  const lockSite = roles.USER_SITE;
  const initialSite = lockSite || S.site || D.activeSites?.[0] || D.sites[0];
  const [site, setSite] = useState(initialSite);

  // Recompute on year/month/site change
  const sc = useMemo(() => TR.score(D, site, S.year, S.month), [D, site, S.year, S.month]);
  const sm = useMemo(() => TR.ss(D, site, S.year, S.month),    [D, site, S.year, S.month]);
  const pillars = useMemo(() => TR.gP(D), [D]);

  // Group rows by pillar in declaration order
  const groups = pillars.map(p => ({
    pillar: p,
    color: TR.gPC(D, p),
    name: TR.gPS(p),
    pillarPct: Math.round(TR.ps2(D, site, p, S.year, S.month) * 100),
    weight: Math.round((D.pillarWeights?.[p] || 0) * 100),
    rows: sc.filter(s => s.pillar === p),
  })).filter(g => g.rows.length > 0);

  return (
    <div className="tt-panel">
      <div className="dash-eyebrow">Scoring · {MO[S.month - 1]} {S.year}</div>
      <div className="sc-hero">
        <SitePicker D={D} value={site} onChange={setSite} lockSite={lockSite} />
        <div className="sc-hero__stat">
          <span className="sc-hero__code" style={{ color: D.siteColors[site] }}>{site}</span>
          <span className="sc-hero__name">{D.siteNames[site] || site}</span>
          <span className="rag rag--green">{sm.g} on track</span>
          <span className="rag rag--amber">{sm.a} at risk</span>
          <span className="rag rag--red">{sm.r} off track</span>
          <span className="sc-hero__overall">{Math.round(sm.avg * 100)}%</span>
        </div>
      </div>

      <div className="sc-table" role="table">
        <div className="sc-thead" role="row">
          <span>#</span>
          <span>Pillar</span>
          <span>Activity</span>
          <span style={{ textAlign: 'right' }}>Weight</span>
          <span style={{ textAlign: 'right' }}>YTD</span>
          <span style={{ textAlign: 'right' }}>Target</span>
          <span>Score</span>
          <span>Status</span>
        </div>
        {groups.map(g => (
          <React.Fragment key={g.pillar}>
            <div className="sc-pillar-row" role="row" style={{ '--pillar-color': g.color }}>
              <span></span>
              <span className="sc-pillar-row__chip" style={{ background: g.color }}>{g.pillar.split('-')[0]}</span>
              <span className="sc-pillar-row__title">{g.name} <small>({g.weight}% of overall)</small></span>
              <span></span>
              <span></span>
              <span></span>
              <span style={{ textAlign: 'right', fontWeight: 800, color: g.color }}>{g.pillarPct}%</span>
              <span></span>
            </div>
            {g.rows.map(r => {
              const rg = String(r.rg).toLowerCase();
              const scorePct = typeof r.sc === 'number' ? Math.round(r.sc * 100) : null;
              const ewDiff = r.ew && Math.abs(r.ew - r.weight) > 0.001;
              return (
                <div key={r.ix} className={'sc-row ' + (r.on ? '' : 'sc-row--off')} role="row" data-rag={rg}>
                  <span className="sc-row__num">{r.num}</span>
                  <span><span className="sc-row__chip" style={{ background: g.color + '22', color: g.color, borderColor: g.color + '55' }}>{r.pillar.split('-')[0]}</span></span>
                  <span className="sc-row__name">
                    {r.name}
                    {r.shared && <span className="sc-row__shared">SHARED</span>}
                  </span>
                  <span className="sc-row__weight">
                    {ewDiff
                      ? <><span className="sc-row__weight-orig">{(r.weight * 100).toFixed(1)}%</span> <span className="sc-row__weight-eff">{(r.ew * 100).toFixed(1)}%</span></>
                      : (r.weight * 100).toFixed(1) + '%'}
                  </span>
                  <span className="sc-row__ytd">{typeof r.ya === 'number' ? r.ya : '—'}</span>
                  <span className="sc-row__target">{typeof r.yt === 'number' ? (r.yt < 10 ? r.yt.toFixed(1) : Math.round(r.yt)) : (r.yt || '—')}</span>
                  <span className="sc-row__bar-wrap">
                    {scorePct != null
                      ? <><div className="sc-row__bar"><div className="sc-row__bar-fill" style={{ width: scorePct + '%', background: ragColor(rg) }} /></div><span className="sc-row__pct">{scorePct}%</span></>
                      : <span style={{ color: 'var(--color-text-muted)' }}>N/A</span>}
                  </span>
                  <span><span className={'rag rag--' + (rg === 'green' ? 'green' : rg === 'amber' ? 'amber' : rg === 'red' ? 'red' : 'na')}>{r.rg}</span></span>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      <div className="tt-footer">
        <span>Site weighted score = Σ (pillar weight × pillar score). Pillar score = weighted avg of active activities.</span>
        <span>The orange weight on a row means the activity was redistributed because other activities in this pillar are inactive at this site.</span>
      </div>
    </div>
  );
}

function ragColor(rg) {
  return rg === 'green' ? '#16a34a'
       : rg === 'amber' ? '#d97706'
       : rg === 'red'   ? '#dc2626'
       : '#94a3b8';
}

// ────────────────────────────────────────────────────────────────────
// INPUT PANEL — monthly data entry with debounced auto-save
// ────────────────────────────────────────────────────────────────────
function InputPanel({ D, S, setS, roles, onMutate }) {
  const TR = window.TR;
  const lockSite = roles.USER_SITE;
  const initialSite = lockSite || S.site || D.activeSites?.[0] || D.sites[0];
  const [site, setSite] = useState(initialSite);

  const canSave = roles.CAN_SAVE;
  const tg = D.targets?.[site] || [];

  function setCell(ai, mi, raw) {
    // BOOLEAN cells: parse 0 / 0.5 / 1 only. Others: float.
    const a = D.activities[ai];
    let v;
    if (a.kpi === 'BOOLEAN') {
      v = (raw === '1' || raw === 1) ? 1 : (raw === '0.5' || raw === 0.5) ? 0.5 : 0;
    } else {
      v = parseFloat(raw) || 0;
    }
    TR.si2(D, S.year, site, ai, mi, v);
    onMutate();   // bumps a counter in App so React + auto-save effect see the change
  }

  return (
    <div className="tt-panel">
      <div className="dash-eyebrow">Monthly input · {MO[S.month - 1]} {S.year}</div>
      {!canSave && (
        <div className="tt-banner tt-banner--warn">
          <b>👁 View-only</b> — your role cannot edit actuals. Ask an admin for the
          <code> tracker-editor </code> (own site) or <code> tracker-admin </code> (all sites) feature role.
        </div>
      )}
      <div className="ip-toolbar">
        <SitePicker D={D} value={site} onChange={setSite} lockSite={lockSite} />
        <span className="ip-legend">
          <b style={{ color: 'var(--tracker-p3)' }}>BOOLEAN:</b> 0 = Not Started · 0.5 = In Progress · 1 = Done
          {'  ·  '}
          <b style={{ color: 'var(--tracker-p4)' }}>COUNT / PERCENT / MILESTONE / CURRENCY / RATING:</b> actual value
        </span>
      </div>

      <div className="ip-grid">
        <div className="ip-grid__head" role="row">
          <span>#</span>
          <span>Activity</span>
          <span>KPI</span>
          {MO.map((m, i) => (
            <span key={m} className={'ip-grid__month ' + (i + 1 === S.month ? 'is-current' : i + 1 > S.month ? 'is-future' : '')}>{m}</span>
          ))}
        </div>
        {D.activities.map((a, ai) => {
          const t = tg[ai];
          const isInactive = !t?.active;
          return (
            <div key={a.id || ai} className={'ip-grid__row ' + (isInactive ? 'is-inactive' : '')} role="row" data-pillar={a.pillar.split('-')[0]}>
              <span className="ip-grid__num">{a.num}</span>
              <span className="ip-grid__name">
                <span className="ip-grid__pillar-chip" style={{ background: TR.gPC(D, a.pillar) }}>{a.pillar.split('-')[0]}</span>
                {a.name}
                {a.shared && <span className="ip-grid__shared">SHARED</span>}
                {isInactive && <span className="ip-grid__inactive-tag">INACTIVE</span>}
              </span>
              <span className="ip-grid__kpi">{a.kpi}</span>
              {Array.from({ length: 12 }, (_, mi) => {
                const v = TR.gi(D, S.year, site, ai, mi);
                const isCurrent = mi + 1 === S.month;
                const isFuture  = mi + 1 > S.month;
                const cellCls = 'ip-cell' + (v > 0 ? (v === 0.5 ? ' ip-cell--half' : ' ip-cell--has') : '') + (isCurrent ? ' ip-cell--current' : '') + (isFuture ? ' ip-cell--future' : '');
                if (a.kpi === 'BOOLEAN') {
                  return (
                    <select
                      key={mi}
                      className={cellCls}
                      value={String(v)}
                      onChange={e => setCell(ai, mi, e.target.value)}
                      disabled={!canSave || isInactive}
                    >
                      <option value="0">·</option>
                      <option value="0.5">½</option>
                      <option value="1">●</option>
                    </select>
                  );
                }
                return (
                  <input
                    key={mi}
                    className={cellCls}
                    type="number"
                    step="any"
                    min="0"
                    defaultValue={v}
                    onChange={e => setCell(ai, mi, e.target.value)}
                    disabled={!canSave || isInactive}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="tt-footer">
        <span>Auto-saves to the database 0.8 s after the last edit. Watch the indicator in the toolbar.</span>
        <span>Inactive rows (greyed out) are turned off for this site in <a href="#" onClick={e => { e.preventDefault(); setS(s => ({ ...s, view: 'targets' })); }}>Targets</a>.</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// HEATMAP PANEL — RAG matrix · site × activity
// ────────────────────────────────────────────────────────────────────
function HeatmapPanel({ D, S }) {
  const TR = window.TR;
  const aS = D.activeSites || [];
  const pillars = TR.gP(D);
  const [hovered, setHovered] = useState(null);

  // Cells: { [site]: { [activityIx]: { score, rag } } }
  const cells = useMemo(() => {
    const m = {};
    aS.forEach(s => {
      m[s] = {};
      TR.score(D, s, S.year, S.month).forEach(r => {
        if (r.on && typeof r.sc === 'number') {
          m[s][r.ix] = { score: Math.round(r.sc * 100), rag: String(r.rg).toLowerCase() };
        }
      });
    });
    return m;
  }, [D, aS.join('|'), S.year, S.month]);

  return (
    <div className="tt-panel">
      <div className="hm-hero">
        <div>
          <div className="dash-eyebrow">Heatmap · {MO[S.month - 1]} {S.year}</div>
          <h2 className="hm-hero__title">RAG matrix · {aS.length} active sites × {D.activities.length} activities</h2>
          <p className="hm-hero__lede">
            Rows = sites, columns = activities (grouped by pillar). Cell colour reflects the RAG threshold; numbers
            inside are the score %. Hover any cell to see the activity name.
          </p>
        </div>
        <div className="hm-legend">
          <span className="hm-legend__item"><span className="hm-cell hm-cell--green hm-cell--legend">≥ 80</span> On target</span>
          <span className="hm-legend__item"><span className="hm-cell hm-cell--amber hm-cell--legend">50–79</span> At risk</span>
          <span className="hm-legend__item"><span className="hm-cell hm-cell--red hm-cell--legend">&lt; 50</span> Off track</span>
        </div>
      </div>

      <div className="hm-scroll">
        <div className="hm-grid" style={{ '--col-count': D.activities.length }}>
          {/* Pillar band */}
          <div className="hm-grid__pillar-row">
            <div className="hm-grid__corner">Pillar →</div>
            {pillars.map(p => {
              const span = D.activities.filter(a => a.pillar === p).length;
              return (
                <div key={p} className="hm-grid__pillar-cell" style={{ background: TR.gPC(D, p), gridColumn: 'span ' + span }}>
                  <strong>{p.split('-')[0]}</strong> <span>{TR.gPS(p)}</span>
                </div>
              );
            })}
          </div>
          {/* Activity # row */}
          <div className="hm-grid__act-row">
            <div className="hm-grid__corner">Site / Activity</div>
            {D.activities.map(a => (
              <div
                key={a.id || a.num}
                className={'hm-grid__act-cell ' + (hovered === a.num ? 'is-hovered' : '')}
                onMouseEnter={() => setHovered(a.num)}
                onMouseLeave={() => setHovered(null)}
                title={'#' + a.num + ' — ' + a.name}
              >
                {a.num}
              </div>
            ))}
          </div>
          {/* Site rows */}
          {aS.map(site => (
            <div key={site} className="hm-grid__site-row">
              <div className="hm-grid__site-cell">
                <span className="hm-site-code" style={{ background: D.siteColors[site] }}>{site}</span>
                <span className="hm-site-name">{D.siteNames[site] || site}</span>
              </div>
              {D.activities.map((a, ix) => {
                const c = cells[site]?.[ix];
                if (!c) return <div key={a.id || a.num} className="hm-cell hm-cell--na" title={site + ' · ' + a.name + ' · inactive'}>—</div>;
                return (
                  <div
                    key={a.id || a.num}
                    className={'hm-cell hm-cell--' + c.rag + (hovered === a.num ? ' is-hovered' : '')}
                    onMouseEnter={() => setHovered(a.num)}
                    onMouseLeave={() => setHovered(null)}
                    title={site + ' · #' + a.num + ' ' + a.name + ' · ' + c.score + '% · ' + c.rag.toUpperCase()}
                  >
                    {c.score}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {hovered != null && (
        <div className="hm-hover-banner">
          <strong>#{hovered}</strong>{' · '}{D.activities.find(a => a.num === hovered)?.name}
          {' · '}<small>Pillar {D.activities.find(a => a.num === hovered)?.pillar.split('-')[0]}</small>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MODAL INFRASTRUCTURE
// ════════════════════════════════════════════════════════════════════
function Modal({ title, children, onCancel, onConfirm, confirmLabel, confirmKind, confirmDisabled, wide }) {
  // Escape closes; click on backdrop closes; click on body doesn't.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="tt-modal-overlay" onClick={onCancel}>
      <div className={'tt-modal ' + (wide ? 'tt-modal--wide' : '')} onClick={e => e.stopPropagation()}>
        <header className="tt-modal__head">
          <h3>{title}</h3>
          <button type="button" className="tt-modal__close" onClick={onCancel} aria-label="Close">×</button>
        </header>
        <div className="tt-modal__body">{children}</div>
        <footer className="tt-modal__foot">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className={'btn-' + (confirmKind || 'primary')} onClick={onConfirm} disabled={confirmDisabled}>{confirmLabel || 'Confirm'}</button>
        </footer>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// REDISTRIBUTE MODAL — fired when a pillar or activity is being deleted
// ════════════════════════════════════════════════════════════════════
// Three strategies, proportional pre-selected:
//   - Proportional: split target's weight by remaining items' existing
//                   relative weights (preserves the existing balance)
//   - Equal:        evenly across all remaining items
//   - Custom:       editable inputs per row, user must hit 100% total
//
// `items` is the LIST of items that will remain after delete (each
// with .name + .weight, where weight is a fraction 0..1). `target` is
// the item being deleted.
function RedistributeModal({ kind, target, items, cascadeWarning, onCancel, onConfirm }) {
  const [strategy, setStrategy] = useState('proportional');

  // Custom weights start as the proportional split (good UX — user
  // can tweak from a sensible default rather than starting at 0)
  const proportionalNew = useMemo(() => {
    if (items.length === 0) return {};
    const remaining = items.reduce((s, x) => s + (x.weight || 0), 0);
    const out = {};
    items.forEach(x => {
      const share = remaining > 0
        ? (target.weight * (x.weight || 0) / remaining)
        : (target.weight / items.length);  // fallback if all remaining were 0
      out[x.key] = (x.weight || 0) + share;
    });
    return out;
  }, [items, target]);

  const equalNew = useMemo(() => {
    if (items.length === 0) return {};
    const share = target.weight / items.length;
    const out = {};
    items.forEach(x => { out[x.key] = (x.weight || 0) + share; });
    return out;
  }, [items, target]);

  const [customWeights, setCustomWeights] = useState(proportionalNew);
  // Reset custom to proportional whenever strategy switches into 'custom'
  useEffect(() => {
    if (strategy === 'custom') setCustomWeights(proportionalNew);
  }, [strategy, proportionalNew]);

  const preview = items.map(x => {
    let nw;
    if (strategy === 'proportional') nw = proportionalNew[x.key];
    else if (strategy === 'equal')   nw = equalNew[x.key];
    else                              nw = customWeights[x.key] || 0;
    return { ...x, newWeight: nw };
  });
  const total = preview.reduce((s, x) => s + x.newWeight, 0);
  const totalOk = Math.abs(total - 1) < 0.005;
  const showTotalCheck = items.length > 0;

  return (
    <Modal
      title={`Delete ${kind}: ${target.name}`}
      onCancel={onCancel}
      onConfirm={() => onConfirm(preview)}
      confirmLabel={'Delete & redistribute'}
      confirmKind="danger"
      confirmDisabled={items.length === 0 ? false : !totalOk}
      wide
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5 }}>
        <b>{target.name}</b> currently holds <b>{Math.round(target.weight * 100)}%</b> of the
        {' '}{kind === 'pillar' ? 'overall pillar allocation' : `weight inside ${target.parentName || 'its pillar'}`}.
        {items.length === 0
          ? <> No other {kind}s remain — the deletion will simply remove this entry. The overall total stays at <b>{Math.round((1 - target.weight) * 100)}%</b>; you'll need to add another {kind} to bring it back to 100%.</>
          : <> Choose how to redistribute the {Math.round(target.weight * 100)}% among the {items.length} remaining {kind}{items.length === 1 ? '' : 's'}.</>}
      </p>

      {cascadeWarning && (
        <div className="tt-cascade-warning">
          ⚠ {cascadeWarning}
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="tt-redistrib-options">
            <label className="tt-redistrib-option">
              <input type="radio" name="strategy" checked={strategy === 'proportional'} onChange={() => setStrategy('proportional')} />
              <span><b>Proportional</b><small>Split by each remaining {kind}'s existing relative weight — preserves the current balance.</small></span>
            </label>
            <label className="tt-redistrib-option">
              <input type="radio" name="strategy" checked={strategy === 'equal'} onChange={() => setStrategy('equal')} />
              <span><b>Equal</b><small>Divide the {Math.round(target.weight * 100)}% evenly across all remaining {kind}s.</small></span>
            </label>
            <label className="tt-redistrib-option">
              <input type="radio" name="strategy" checked={strategy === 'custom'} onChange={() => setStrategy('custom')} />
              <span><b>Custom</b><small>Edit each weight manually — must total 100% to confirm.</small></span>
            </label>
          </div>

          <div className="tt-redistrib-preview">
            <div className="tt-redistrib-preview__head">
              <span>{kind === 'pillar' ? 'Pillar' : 'Activity'}</span>
              <span style={{ textAlign: 'right' }}>Was</span>
              <span style={{ textAlign: 'center' }}>→</span>
              <span style={{ textAlign: 'right' }}>Will become</span>
            </div>
            {preview.map(x => (
              <div key={x.key} className="tt-redistrib-preview__row">
                <span className="tt-redistrib-preview__name">
                  {x.color && <span className="tt-redistrib-preview__chip" style={{ background: x.color }} />}
                  {x.name}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
                  {Math.round(x.weight * 100)}%
                </span>
                <span style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>→</span>
                <span style={{ textAlign: 'right' }}>
                  {strategy === 'custom'
                    ? <input
                        type="number" min="0" max="100" step="1"
                        className="tt-redistrib-input"
                        value={Math.round((customWeights[x.key] || 0) * 100)}
                        onChange={e => setCustomWeights(c => ({ ...c, [x.key]: (parseFloat(e.target.value) || 0) / 100 }))}
                      />
                    : <b>{Math.round(x.newWeight * 100)}%</b>}
                </span>
              </div>
            ))}
            <div className={'tt-redistrib-total ' + (showTotalCheck ? (totalOk ? 'is-ok' : 'is-fail') : '')}>
              Total: {Math.round(total * 100)}%
              {!totalOk && <span> · must equal 100%</span>}
              {totalOk && <span> ✓</span>}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════
// TRACKER SETUP PANEL — pillars, activities, active sites
// ════════════════════════════════════════════════════════════════════
const KPI_TYPES = ['BOOLEAN', 'PERCENT', 'MILESTONE', 'CURRENCY', 'RATING', 'COUNT'];

function SetupPanel({ D, S, roles, onMutate, onAddYear }) {
  const TR = window.TR;
  const canEdit = roles.CAN_SAVE_ALL;        // only super_admin / tracker-admin can change config
  const [modal, setModal] = useState(null);  // { type, kind, target, items, onConfirm }

  const pillars = TR.gP(D);
  const pillarTotal = pillars.reduce((s, p) => s + (D.pillarWeights?.[p] || 0), 0);
  const pillarTotalOk = Math.abs(pillarTotal - 1) < 0.005;

  // ─ Pillar handlers ─────────────────────────────────────────────
  function setPillarWeight(pillar, pct) {
    if (!D.pillarWeights) D.pillarWeights = {};
    D.pillarWeights[pillar] = Math.max(0, Math.min(100, pct)) / 100;
    onMutate();
  }
  function renamePillar(oldKey, newKey) {
    if (!newKey || newKey === oldKey) return;
    if (D.pillarWeights[newKey] != null) { alert('Pillar code already exists.'); return; }
    D.pillarWeights[newKey] = D.pillarWeights[oldKey] || 0;
    delete D.pillarWeights[oldKey];
    D.activities.forEach(a => { if (a.pillar === oldKey) a.pillar = newKey; });
    onMutate();
  }

  // ─ Year handlers ───────────────────────────────────────────────
  // Delete-year is destructive and irreversible. The flow is:
  //   1. GET /api/tracker/delete-year?year=N — preview (no mutation)
  //   2. Open modal with the preview baked into the body — the
  //      operator can see exactly which rows will be deleted before
  //      confirming.
  //   3. On Confirm: POST /api/tracker/delete-year — commits the
  //      delete in a single SQLite transaction.
  //   4. On success: reload the page so D, S, charts all refresh
  //      from the new state.
  async function startDeleteYear(y) {
    let preview;
    try {
      preview = await window.TRApi.previewDeleteYear(y);
    } catch (e) {
      alert('Could not prepare delete: ' + (e?.message || e));
      return;
    }
    const otherYearRows = (preview.other_years_untouched || [])
      .map(r => r.year + ' (' + r.c + ' rows)')
      .join(', ') || 'none';
    const isCurrentlySelected = y === S.year;
    setModal({
      type: 'confirm',
      title: 'Delete year ' + y + '?',
      kind: 'year',
      body: (
        <>
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA',
            borderRadius: 8, padding: '12px 14px', marginBottom: 14,
            color: '#991B1B', fontSize: 13, lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: '#7F1D1D' }}>
              ⚠ This action is permanent and cannot be undone.
            </div>
            All monthly input values entered for {y} across every site and activity
            will be deleted from the database immediately.
          </div>

          <h4 style={{ margin: '0 0 6px', fontSize: 13, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--color-text-muted)' }}>What gets deleted</h4>
          <ul style={{ marginTop: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.55, color: 'var(--color-text)' }}>
            <li>The year <b>{y}</b> entry in the Year dropdown</li>
            <li><b>{preview.inputs_will_be_deleted}</b> rows of monthly input data for {y} (all sites × activities)</li>
          </ul>

          <h4 style={{ margin: '14px 0 6px', fontSize: 13, textTransform: 'uppercase', letterSpacing: '.5px', color: '#0F766E' }}>What is preserved</h4>
          <ul style={{ marginTop: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.55, color: 'var(--color-text)' }}>
            <li>Other years' data — untouched: <code>{otherYearRows}</code></li>
            <li>Targets (per site × activity — shared across all years)</li>
            <li>Pillar weights, active sites, activities list</li>
          </ul>

          <div style={{
            marginTop: 14, padding: '10px 12px',
            background: '#F4F5F7', borderRadius: 6,
            fontSize: 12.5, color: 'var(--color-text)', lineHeight: 1.5,
          }}>
            After deletion, the years dropdown will show:&nbsp;
            <b>{preview.years_after.join(', ') || '(none — cannot proceed)'}</b>
          </div>

          <div style={{
            marginTop: 10, padding: '10px 12px',
            background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6,
            fontSize: 12.5, color: '#065F46', lineHeight: 1.5,
          }}>
            🛟 A full database backup will be created automatically <em>before</em> the
            delete runs. If anything goes wrong, the backup file path is shown on
            success so you can restore. Backups are saved to&nbsp;
            <code>data/backups/tracker-YYYYMMDD-HHMMSS-pre-delete-year-{y}.db</code>
            on the server.<br />
            <small style={{ color: '#047857' }}>Recovery instructions: <code>docs/DB_RECOVERY.md</code> · interactive helper: <code>_restore_db.cmd</code></small>
          </div>

          {isCurrentlySelected && (
            <div style={{
              marginTop: 12, padding: '10px 12px',
              background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6,
              fontSize: 12.5, color: '#9A3412',
            }}>
              ⚠ {y} is the year currently selected in the toolbar — after deletion,
              the view will jump to {preview.years_after[preview.years_after.length - 1] || 'no year'}.
            </div>
          )}

          {preview.would_leave_zero_years && (
            <div style={{
              marginTop: 12, padding: '10px 12px',
              background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6,
              fontSize: 12.5, color: '#991B1B', fontWeight: 600,
            }}>
              ⛔ Cannot proceed — at least one year must remain in the tracker.
              Add a different year first, then delete {y}.
            </div>
          )}
        </>
      ),
      confirmLabel: 'Delete ' + y,
      confirmKind: 'danger',
      confirmDisabled: !!preview.would_leave_zero_years,
      onConfirm: async () => {
        try {
          const resp = await window.TRApi.deleteYear(y);
          const backupPath = resp?.summary?.backup_path || '(see pm2 logs)';
          // Surface the backup path so the operator knows where the
          // safety copy lives. Logged to console too — visible after
          // the page reload via DevTools.
          console.log('[Tracker] year', y, 'deleted. Backup saved at:', backupPath);
          setModal(null);
          alert(
            '✓ Year ' + y + ' deleted.\n\n' +
            'Database backup created BEFORE the delete:\n' + backupPath + '\n\n' +
            'If you need to restore, copy that file back to data/tracker.db on the server ' +
            'and reload the page.'
          );
          // Full page reload so D, S, dropdown, charts all refresh
          // from the new state. Cheap (the tracker bundle is small)
          // and avoids tracking down every piece of derived state.
          window.location.reload();
        } catch (e) {
          alert('Delete failed: ' + (e?.message || e));
        }
      },
    });
  }
  // Confirm-then-insert. Wires the user's click into a modal that
  // makes the "you're about to create a config row" intent explicit.
  function startAddPillar() {
    setModal({
      type: 'confirm',
      title: 'Add new pillar',
      kind: 'pillar',
      body: (
        <>
          <p>Add a new pillar to the tracker?</p>
          <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-text)' }}>
            <li>It will start with <b>0% weight</b> — you'll need to redistribute from existing pillars to bring the total above 100%.</li>
            <li>The default code is <code>P{(pillars.length + 1)}-New Pillar</code> — you can rename it inline after creation.</li>
            <li>It will have <b>no activities</b> until you add some from the Activities section below.</li>
            <li>Auto-saves to the database 0.8 s after confirmation.</li>
          </ul>
        </>
      ),
      confirmLabel: 'Add pillar',
      confirmKind: 'primary',
      onConfirm: () => {
        let n = pillars.length + 1;
        while (D.pillarWeights[`P${n}-New Pillar`] != null) n++;
        const key = `P${n}-New Pillar`;
        D.pillarWeights[key] = 0;
        setModal(null);
        onMutate();
      },
    });
  }
  function startDeletePillar(pillar) {
    const remaining = pillars.filter(p => p !== pillar).map(p => ({
      key: p, name: TR.gPS(p), weight: D.pillarWeights[p] || 0, color: TR.gPC(D, p),
    }));
    const childActivityCount = D.activities.filter(a => a.pillar === pillar).length;
    setModal({
      type: 'redistribute', kind: 'pillar',
      target: { key: pillar, name: TR.gPS(pillar), weight: D.pillarWeights[pillar] || 0 },
      items: remaining,
      cascadeWarning: childActivityCount > 0
        ? `Heads up — deleting ${TR.gPS(pillar)} also removes its ${childActivityCount} activit${childActivityCount === 1 ? 'y' : 'ies'} from every site. Historical input data for those activities is dropped. This cannot be undone.`
        : null,
      onConfirm: (newItems) => {
        newItems.forEach(it => { D.pillarWeights[it.key] = it.newWeight; });
        delete D.pillarWeights[pillar];
        // Find activity indices that need removing (reverse-sorted so
        // splice doesn't shift later indices we still need)
        const removeIxs = D.activities
          .map((a, i) => a.pillar === pillar ? i : -1)
          .filter(i => i >= 0).sort((a, b) => b - a);
        removeIxs.forEach(ix => {
          D.activities.splice(ix, 1);
          D.sites.forEach(s => { if (Array.isArray(D.targets[s])) D.targets[s].splice(ix, 1); });
          Object.values(D.inputs || {}).forEach(siteMap => {
            Object.values(siteMap).forEach(arr => { if (Array.isArray(arr)) arr.splice(ix, 1); });
          });
        });
        setModal(null);
        onMutate();
      },
    });
  }

  // ─ Activity handlers ───────────────────────────────────────────
  function setActivityField(ix, field, value) {
    const a = D.activities[ix];
    if (!a) return;
    if (field === 'weight') a.weight = Math.max(0, Math.min(100, parseFloat(value) || 0)) / 100;
    else if (field === 'start' || field === 'end') a.start = field === 'start' ? parseInt(value) : a.start, a.end = field === 'end' ? parseInt(value) : a.end;
    else if (field === 'shared') a.shared = !!value;
    else a[field] = value;
    onMutate();
  }
  function startAddActivity(pillar) {
    const pillarName = TR.gPS(pillar);
    const siblingCount = D.activities.filter(a => a.pillar === pillar).length;
    setModal({
      type: 'confirm',
      title: 'Add new activity',
      kind: 'activity',
      body: (
        <>
          <p>Add a new activity to <b>{pillarName}</b>?</p>
          <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-text)' }}>
            <li>Default name <b>"New activity"</b> — rename it inline after creation.</li>
            <li>Default KPI <b>COUNT</b>, weight <b>0%</b>, window <b>Jan → Dec</b>, not shared.</li>
            <li>Created <b>INACTIVE</b> on every site (toggle it on per site in the Targets tab once configured).</li>
            {siblingCount > 0 && <li>{pillarName} currently has {siblingCount} activit{siblingCount === 1 ? 'y' : 'ies'}. The new one starts at 0% so the pillar total stays at the current value — bump it up by redistributing from siblings.</li>}
            <li>Auto-saves to the database 0.8 s after confirmation.</li>
          </ul>
        </>
      ),
      confirmLabel: 'Add activity',
      confirmKind: 'primary',
      onConfirm: () => {
        const maxNum = D.activities.reduce((m, a) => Math.max(m, a.num || 0), 0);
        const newAct = {
          id: maxNum + 1, num: maxNum + 1, pillar,
          name: 'New activity', kpi: 'COUNT', weight: 0,
          start: 1, end: 12, shared: false,
        };
        D.activities.push(newAct);
        D.sites.forEach(s => {
          if (!D.targets[s]) D.targets[s] = [];
          D.targets[s].push({ target: 0, active: false });
        });
        setModal(null);
        onMutate();
      },
    });
  }
  function startDeleteActivity(ix) {
    const a = D.activities[ix];
    if (!a) return;
    const siblings = D.activities
      .map((x, i) => ({ x, i }))
      .filter(({ x, i }) => x.pillar === a.pillar && i !== ix);
    // Count how much historical input data we'd be dropping
    let inputCells = 0;
    Object.values(D.inputs || {}).forEach(siteMap => {
      Object.values(siteMap).forEach(arr => {
        if (Array.isArray(arr[ix])) inputCells += arr[ix].filter(v => v > 0).length;
      });
    });
    setModal({
      type: 'redistribute', kind: 'activity',
      target: { key: ix, name: a.name, weight: a.weight || 0, parentName: TR.gPS(a.pillar) },
      items: siblings.map(({ x, i }) => ({
        key: i, name: x.name, weight: x.weight || 0, color: TR.gPC(D, x.pillar),
      })),
      cascadeWarning: inputCells > 0
        ? `Heads up — this activity has ${inputCells} non-zero monthly input value${inputCells === 1 ? '' : 's'} recorded across sites and years. Deleting it removes that data. This cannot be undone.`
        : null,
      onConfirm: (newItems) => {
        newItems.forEach(it => { D.activities[it.key].weight = it.newWeight; });
        // Remove the activity + the corresponding target index from every site
        const removedIx = ix;
        D.activities.splice(removedIx, 1);
        D.sites.forEach(s => {
          if (Array.isArray(D.targets[s])) D.targets[s].splice(removedIx, 1);
        });
        // Inputs are keyed by activity_ix too — shift down
        Object.values(D.inputs || {}).forEach(siteMap => {
          Object.values(siteMap).forEach(arr => {
            if (Array.isArray(arr)) arr.splice(removedIx, 1);
          });
        });
        setModal(null);
        onMutate();
      },
    });
  }

  // ─ Active sites toggle — wrapped in a confirm modal so the user
  //   doesn't disappear/reappear a site by accident. Activate and
  //   deactivate explain different consequences:
  //     - Activate: the site joins the Dashboard / Scoring / Heatmap /
  //                 Targets immediately. Any existing inputs in the DB
  //                 for the site start scoring.
  //     - Deactivate: the site is hidden from cross-site views and
  //                   contributes nothing to the score. Inputs are
  //                   PRESERVED in the database — toggle back on to
  //                   restore. No data loss.
  function startToggleSite(code) {
    if (!D.activeSites) D.activeSites = [];
    const isActive = D.activeSites.includes(code);
    const siteName = D.siteNames[code] || code;
    setModal({
      type: 'confirm',
      title: (isActive ? 'Deactivate ' : 'Activate ') + siteName,
      kind: 'toggle-site',
      confirmKind: isActive ? 'danger' : 'primary',
      confirmLabel: isActive ? 'Deactivate site' : 'Activate site',
      body: isActive ? (
        <>
          <p>
            <b>{siteName}</b> (<code>{code}</code>) will be removed from the active tracker scope.
          </p>
          <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55, color: 'var(--color-text)' }}>
            <li>It disappears from the <b>Dashboard</b>, <b>leaderboard</b>, <b>Scoring</b>, <b>Heatmap</b> and charts.</li>
            <li>It contributes <b>nothing to the fleet score</b> while inactive.</li>
            <li><b>Existing input data is preserved</b> in the database — you can toggle the site back on at any time to restore everything.</li>
            <li>Auto-saves to the database 0.8 s after confirmation.</li>
          </ul>
        </>
      ) : (
        <>
          <p>
            <b>{siteName}</b> (<code>{code}</code>) will start contributing to the tracker.
          </p>
          <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55, color: 'var(--color-text)' }}>
            <li>It joins the <b>Dashboard</b>, <b>leaderboard</b>, <b>Scoring</b>, <b>Heatmap</b> and charts.</li>
            <li>Any historical input data already in the database for {code} <b>starts scoring immediately</b>.</li>
            <li>Make sure <b>targets are set</b> for the activities you want to score (Targets tab).</li>
            <li>Auto-saves to the database 0.8 s after confirmation.</li>
          </ul>
        </>
      ),
      onConfirm: () => {
        if (isActive) D.activeSites = D.activeSites.filter(s => s !== code);
        else          D.activeSites = [...D.activeSites, code];
        setModal(null);
        onMutate();
      },
    });
  }

  // ─ Activities grouped by pillar (for the per-pillar tables) ────
  const byPillar = pillars.map(p => ({
    pillar: p, color: TR.gPC(D, p), name: TR.gPS(p),
    weightPct: Math.round((D.pillarWeights?.[p] || 0) * 100),
    rows: D.activities
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.pillar === p),
  }));

  // ── PHASE 4 — per-year editing context (ADR-001 Phase 4) ────────
  // When per-year mode is live, all edits below apply to S.year ONLY.
  // The "Copy from previous year" button appears when the selected
  // year has no structure yet and an earlier year has one to clone.
  const perYear = !!D.perYearEnabled;
  const prevYearWithData = perYear
    ? (D.years || []).filter(y => y < S.year && D.byYear?.[y]?.activities?.length > 0).pop()
    : null;
  const yearIsEmpty = perYear && (!D.byYear?.[S.year] || (D.byYear[S.year].activities || []).length === 0);
  function copyFromPreviousYear() {
    if (!prevYearWithData || !D.byYear) return;
    const src = D.byYear[prevYearWithData];
    D.byYear[S.year] = JSON.parse(JSON.stringify(src));   // deep copy: activities + pillarWeights + targets
    if (!D.inputs) D.inputs = {};
    if (!D.inputs[S.year]) D.inputs[S.year] = {};
    D.sites.forEach(s => {
      D.inputs[S.year][s] = D.byYear[S.year].activities.map(() => new Array(12).fill(0));
    });
    onMutate();
  }

  return (
    <div className="tt-panel">
      <div className="setup-eyebrow">Setup · {D.activities.length} activities · {pillars.length} pillars · {D.activeSites.length} of {D.sites.length} sites active</div>

      {perYear && (
        <div className="tt-banner" style={{ background: '#EFF6FF', border: '1px solid #93C5FD', color: '#1E40AF' }}>
          <b>📅 Editing year {S.year}</b> — pillars, activities and targets below apply to <b>{S.year} only</b>.
          Switch years via the toolbar Year dropdown.
          {yearIsEmpty && prevYearWithData && canEdit && (
            <button className="btn-primary" type="button" onClick={copyFromPreviousYear} style={{ marginLeft: 12 }}>
              ⧉ Copy structure from {prevYearWithData}
            </button>
          )}
          {yearIsEmpty && !prevYearWithData && (
            <span style={{ marginLeft: 8 }}>This year is empty — add pillars and activities below.</span>
          )}
        </div>
      )}

      {!canEdit && (
        <div className="tt-banner tt-banner--warn">
          <b>👁 View-only</b> — Setup changes require the <code>tracker-admin</code> or <code>super_admin</code> role.
          You can browse the configuration here but every input is disabled.
        </div>
      )}

      {/* ─── YEARS ───────────────────────────────────────────────── */}
      <section className="setup-section">
        <div className="setup-section__head">
          <h3>1 · Years</h3>
          <small>{perYear
            ? 'Reporting years configured in the tracker. Each year has its OWN pillars, activities and targets — a new year starts empty (use "Copy structure" to clone).'
            : 'Reporting years configured in the tracker. Pillar weights, targets and active sites apply across every year — only input data is per-year.'}</small>
          {canEdit && (
            <button className="btn-primary" type="button" onClick={onAddYear} style={{ marginLeft: 'auto' }}>
              + Add year
            </button>
          )}
        </div>
        <div className="setup-years">
          {(D.years || []).slice().sort((a, b) => a - b).map(y => (
            <span key={y} className={'setup-year-pill ' + (y === S.year ? 'is-current' : '')} title={y === S.year ? 'Currently selected in the toolbar' : 'Switch to ' + y + ' via the toolbar Year dropdown'}>
              {y}
              {y === S.year && <small>· current</small>}
              {canEdit && (D.years || []).length > 1 && (
                <button
                  type="button"
                  className="setup-year-pill__del"
                  title={'Delete ' + y + ' (admin only)'}
                  onClick={() => startDeleteYear(y)}
                  style={{
                    marginLeft: 8, padding: '0 6px',
                    fontSize: 13, lineHeight: '18px',
                    background: 'transparent',
                    border: '1px solid rgba(220,38,38,.35)',
                    color: '#DC2626', borderRadius: 4, cursor: 'pointer',
                  }}
                >×</button>
              )}
            </span>
          ))}
          {(!D.years || D.years.length === 0) && (
            <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontStyle: 'italic' }}>
              No years configured yet — click "Add year" to create one.
            </span>
          )}
        </div>
      </section>

      {/* ─── PILLARS ─────────────────────────────────────────────── */}
      <section className="setup-section">
        <div className="setup-section__head">
          <h3>2 · Pillars</h3>
          <small>Strategic dimensions and their weights. The four weights must total 100%.</small>
          {canEdit && <button className="btn-primary" type="button" onClick={startAddPillar} style={{ marginLeft: 'auto' }}>+ Add pillar</button>}
        </div>
        <div className="setup-pillars">
          {pillars.map(p => (
            <div key={p} className="setup-pillar-row">
              <span className="setup-pillar-row__chip" style={{ background: TR.gPC(D, p) }}>{p.split('-')[0]}</span>
              <input
                className="setup-input setup-input--name"
                type="text"
                defaultValue={p}
                onBlur={e => renamePillar(p, e.target.value.trim())}
                disabled={!canEdit}
                title="Edit and blur to rename. Format: P{N}-Name"
              />
              <span className="setup-pillar-row__weight">
                <input
                  className="setup-input setup-input--weight"
                  type="number" min="0" max="100" step="1"
                  value={Math.round((D.pillarWeights?.[p] || 0) * 100)}
                  onChange={e => setPillarWeight(p, parseFloat(e.target.value) || 0)}
                  disabled={!canEdit}
                />
                <small>%</small>
              </span>
              <small className="setup-pillar-row__count">{D.activities.filter(a => a.pillar === p).length} activities</small>
              {canEdit && (
                <button className="btn-danger setup-pillar-row__del" type="button" onClick={() => startDeletePillar(p)}>
                  Delete
                </button>
              )}
            </div>
          ))}
          <div className={'setup-pillars__total ' + (pillarTotalOk ? 'is-ok' : 'is-fail')}>
            Total weight: <b>{Math.round(pillarTotal * 100)}%</b>
            {pillarTotalOk ? <span> ✓</span> : <span> · must equal 100%</span>}
          </div>
        </div>
      </section>

      {/* ─── ACTIVE SITES ────────────────────────────────────────── */}
      <section className="setup-section">
        <div className="setup-section__head">
          <h3>3 · Active sites</h3>
          <small>Toggle which sites participate in the tracker. Inactive sites still show in the Setup tables but contribute nothing to the score.</small>
        </div>
        <div className="setup-sites">
          {D.sites.map(code => {
            const isActive = D.activeSites?.includes(code);
            return (
              <button
                key={code} type="button"
                className={'setup-site-chip ' + (isActive ? 'is-active' : '')}
                style={isActive ? { background: D.siteColors[code], borderColor: D.siteColors[code] } : {}}
                onClick={() => canEdit && startToggleSite(code)}
                disabled={!canEdit}
                title={D.siteNames[code]}
              >
                <span className="setup-site-chip__code">{code}</span>
                <span className="setup-site-chip__name">{D.siteNames[code] || code}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ─── ACTIVITIES (per pillar) ─────────────────────────────── */}
      <section className="setup-section">
        <div className="setup-section__head">
          <h3>4 · Activities</h3>
          <small>One row per activity. Weights are <em>within each pillar</em> (must total 100% per pillar). Window M1–M12 defines when the activity is in scope.</small>
        </div>
        {byPillar.map(g => {
          const rowSum = g.rows.reduce((s, { a }) => s + (a.weight || 0), 0);
          const rowSumOk = Math.abs(rowSum - 1) < 0.005;
          return (
            <div key={g.pillar} className="setup-pillar-group" style={{ '--pillar-color': g.color }}>
              <div className="setup-pillar-group__head">
                <span className="setup-pillar-row__chip" style={{ background: g.color }}>{g.pillar.split('-')[0]}</span>
                <span className="setup-pillar-group__title">{g.name}</span>
                <small>{g.weightPct}% of overall · {g.rows.length} activities</small>
                {canEdit && (
                  <button type="button" className="btn-ghost setup-pillar-group__add" onClick={() => startAddActivity(g.pillar)}>
                    + Activity
                  </button>
                )}
              </div>
              <div className="setup-act-table">
                <div className="setup-act-thead" role="row">
                  <span>#</span>
                  <span>Activity name</span>
                  <span>KPI</span>
                  <span style={{ textAlign: 'right' }}>Weight</span>
                  <span>Window</span>
                  <span style={{ textAlign: 'center' }}>Shared</span>
                  <span></span>
                </div>
                {g.rows.map(({ a, i }) => (
                  <div key={a.id || i} className="setup-act-row" role="row">
                    <span className="setup-act-num">{a.num}</span>
                    <input
                      className="setup-input setup-input--name"
                      type="text" defaultValue={a.name}
                      onBlur={e => setActivityField(i, 'name', e.target.value)}
                      disabled={!canEdit}
                    />
                    <select
                      className="setup-input setup-input--kpi"
                      value={a.kpi || 'COUNT'}
                      onChange={e => setActivityField(i, 'kpi', e.target.value)}
                      disabled={!canEdit}
                    >
                      {KPI_TYPES.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <span className="setup-act-weight">
                      <input
                        className="setup-input setup-input--weight"
                        type="number" min="0" max="100" step="0.1"
                        value={(a.weight || 0) * 100 % 1 === 0 ? (a.weight || 0) * 100 : ((a.weight || 0) * 100).toFixed(1)}
                        onChange={e => setActivityField(i, 'weight', e.target.value)}
                        disabled={!canEdit}
                      />
                      <small>%</small>
                    </span>
                    <span className="setup-act-window">
                      <select
                        className="setup-input setup-input--month"
                        value={a.start || 1}
                        onChange={e => setActivityField(i, 'start', e.target.value)}
                        disabled={!canEdit}
                        title="First month the activity is in scope"
                      >
                        {MO.map((m, mi) => <option key={m} value={mi + 1}>{m}</option>)}
                      </select>
                      <span className="setup-act-window__sep">→</span>
                      <select
                        className="setup-input setup-input--month"
                        value={a.end || 12}
                        onChange={e => setActivityField(i, 'end', e.target.value)}
                        disabled={!canEdit}
                        title="Last month the activity is in scope"
                      >
                        {MO.map((m, mi) => <option key={m} value={mi + 1}>{m}</option>)}
                      </select>
                    </span>
                    <span style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!!a.shared}
                        onChange={e => setActivityField(i, 'shared', e.target.checked)}
                        disabled={!canEdit}
                      />
                    </span>
                    <span>
                      {canEdit && (
                        <button className="btn-danger setup-act-row__del" type="button" onClick={() => startDeleteActivity(i)}>
                          ✕
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <div className={'setup-act-table__total ' + (rowSumOk ? 'is-ok' : 'is-fail')}>
                Pillar total: <b>{Math.round(rowSum * 100)}%</b>
                {rowSumOk ? <span> ✓</span> : <span> · must equal 100% within the pillar</span>}
              </div>
            </div>
          );
        })}
      </section>

      <div className="tt-footer">
        <span>Changes auto-save 0.8 s after the last edit. Watch the indicator in the toolbar.</span>
        <span>Deleting a pillar or activity opens a redistribute dialog so the totals stay at 100%.</span>
      </div>

      {/* Render whichever modal is active */}
      {modal?.type === 'redistribute' && (
        <RedistributeModal
          kind={modal.kind}
          target={modal.target}
          items={modal.items}
          cascadeWarning={modal.cascadeWarning}
          onCancel={() => setModal(null)}
          onConfirm={modal.onConfirm}
        />
      )}
      {modal?.type === 'confirm' && (
        <Modal
          title={modal.title}
          onCancel={() => setModal(null)}
          onConfirm={modal.onConfirm}
          confirmLabel={modal.confirmLabel}
          confirmKind={modal.confirmKind}
        >
          {modal.body}
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// TARGETS PANEL — per-site, per-activity target value + active flag
// ════════════════════════════════════════════════════════════════════
// The actual "target" for an activity at a site is what the engine
// compares the YTD value against. Examples:
//   BOOLEAN  — target is the string 'TRUE/FALSE' (read-only — engine
//              just checks if the activity has been done)
//   COUNT    — target is the annual count (e.g. 52 weekly meetings)
//   PERCENT  — target is the % the YTD average should reach
//   etc.
// The `active` flag toggles the whole activity on/off for that site.
// Inactive activities are excluded from the score AND from the Input
// grid for that site — useful for activities that don't apply to a
// given site (e.g. underground-only tasks at an open-pit operation).

function TargetsPanel({ D, S, roles, onMutate }) {
  const TR = window.TR;
  const lockSite = roles.USER_SITE;
  const initialSite = lockSite || S.site || D.activeSites?.[0] || D.sites[0];
  const [site, setSite] = useState(initialSite);

  // Editor scoped to own site only; admin+ can pick any.
  const canEdit = roles.CAN_SAVE_ALL || (roles.CAN_SAVE_OWN && site === lockSite);

  function ensureTargetSlot(ix) {
    if (!D.targets[site]) D.targets[site] = [];
    if (!D.targets[site][ix]) D.targets[site][ix] = { target: 0, active: false };
  }
  function setTargetValue(ix, kpi, raw) {
    ensureTargetSlot(ix);
    if (kpi === 'BOOLEAN') {
      D.targets[site][ix].target = 'TRUE/FALSE';
    } else {
      const n = parseFloat(raw);
      D.targets[site][ix].target = isNaN(n) ? raw : n;
    }
    onMutate();
  }
  function toggleActive(ix) {
    ensureTargetSlot(ix);
    D.targets[site][ix].active = !D.targets[site][ix].active;
    onMutate();
  }
  // Bulk toggles per pillar (handy on a fresh site setup)
  function setAllInPillar(pillar, value) {
    D.activities.forEach((a, i) => {
      if (a.pillar === pillar) {
        ensureTargetSlot(i);
        D.targets[site][i].active = value;
      }
    });
    onMutate();
  }

  const pillars = TR.gP(D);
  const byPillar = pillars.map(p => ({
    pillar: p, color: TR.gPC(D, p), name: TR.gPS(p),
    weightPct: Math.round((D.pillarWeights?.[p] || 0) * 100),
    rows: D.activities.map((a, i) => ({ a, i })).filter(({ a }) => a.pillar === p),
  }));

  const sites = D.sites;
  const activeCount = D.activities.filter((a, i) => D.targets?.[site]?.[i]?.active).length;

  return (
    <div className="tt-panel">
      <div className="dash-eyebrow">Targets · {S.year} · {site}</div>

      {!canEdit && (
        <div className="tt-banner tt-banner--warn">
          <b>👁 View-only</b> — Target changes for <b>{site}</b> require either the <code>tracker-admin</code>
          / <code>super_admin</code> role (any site), or <code>tracker-editor</code> scoped to this same site.
        </div>
      )}

      <div className="ip-toolbar">
        <SitePicker D={D} value={site} onChange={setSite} lockSite={lockSite} />
        <span className="ip-legend">
          <b>{activeCount}</b> of {D.activities.length} activities active at <b>{site}</b> ·
          set the per-activity target value below, then turn it on with the toggle.
        </span>
      </div>

      {byPillar.map(g => {
        const allOn = g.rows.length > 0 && g.rows.every(({ i }) => D.targets?.[site]?.[i]?.active);
        const noneOn = g.rows.every(({ i }) => !D.targets?.[site]?.[i]?.active);
        const activeInPillar = g.rows.filter(({ i }) => D.targets?.[site]?.[i]?.active).length;
        return (
          <div key={g.pillar} className="setup-pillar-group" style={{ '--pillar-color': g.color }}>
            <div className="setup-pillar-group__head">
              <span className="setup-pillar-row__chip" style={{ background: g.color }}>{g.pillar.split('-')[0]}</span>
              <span className="setup-pillar-group__title">{g.name}</span>
              <small>{g.weightPct}% of overall · {activeInPillar} of {g.rows.length} active</small>
              {canEdit && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button type="button" className="btn-ghost setup-pillar-group__add" disabled={allOn} onClick={() => setAllInPillar(g.pillar, true)}>All on</button>
                  <button type="button" className="btn-ghost setup-pillar-group__add" disabled={noneOn} onClick={() => setAllInPillar(g.pillar, false)}>All off</button>
                </div>
              )}
            </div>
            <div className="tg-table">
              <div className="tg-thead" role="row">
                <span>#</span>
                <span>Activity</span>
                <span>KPI</span>
                <span style={{ textAlign: 'right' }}>Target</span>
                <span style={{ textAlign: 'center' }}>Active</span>
              </div>
              {g.rows.map(({ a, i }) => {
                const t = D.targets?.[site]?.[i] || { target: 0, active: false };
                const isBool = a.kpi === 'BOOLEAN';
                const isActive = !!t.active;
                return (
                  <div key={a.id || i} className={'tg-row ' + (isActive ? '' : 'is-off')} role="row">
                    <span className="setup-act-num">{a.num}</span>
                    <span className="tg-row__name">
                      {a.name}
                      {a.shared && <span className="ip-grid__shared">SHARED</span>}
                    </span>
                    <span className="tg-row__kpi">{a.kpi}</span>
                    <span className="tg-row__target">
                      {isBool ? (
                        <span className="tg-row__target-bool">TRUE/FALSE</span>
                      ) : (
                        <input
                          className="setup-input setup-input--target"
                          type="number" step="any" min="0"
                          value={typeof t.target === 'number' ? t.target : (parseFloat(t.target) || 0)}
                          onChange={e => setTargetValue(i, a.kpi, e.target.value)}
                          disabled={!canEdit}
                        />
                      )}
                    </span>
                    <span style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className={'tg-toggle ' + (isActive ? 'is-on' : '')}
                        onClick={() => canEdit && toggleActive(i)}
                        disabled={!canEdit}
                        aria-pressed={isActive}
                        title={isActive ? 'Active — click to deactivate at ' + site : 'Inactive — click to activate at ' + site}
                      >
                        <span className="tg-toggle__knob" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="tt-footer">
        <span>Targets are <b>per-site</b>. The same activity can have different targets at different sites (e.g. a smaller team running fewer daily checks).</span>
        <span>Auto-saves to the database 0.8 s after the last edit. Watch the indicator in the toolbar.</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ROADMAP PANEL — 12-month Gantt by pillar (replaces legacy Timeline)
// ════════════════════════════════════════════════════════════════════
// Each pillar is a swimlane; each activity is a horizontal bar from
// its `start` month to its `end` month (the Window the user sets in
// Tracker Setup). The orange "today" line marks S.month so the user
// can see at a glance which activities should be in-flight right now.

function RoadmapPanel({ D, S }) {
  const TR = window.TR;
  const pillars = TR.gP(D);
  const periodLeftPct = ((S.month - 0.5) / 12) * 100;
  // Calendar today — independent of the toolbar period, so the user
  // sees real-world "now" alongside whichever data snapshot they're
  // reviewing. Only show the today marker if it falls within the
  // year being viewed AND differs from the selected period.
  const now = new Date();
  const isCurrentYear = now.getFullYear() === S.year;
  const todayMonth = isCurrentYear ? now.getMonth() + 1 : null;
  const showTodayMarker = todayMonth != null && todayMonth !== S.month;
  const todayLeftPct = todayMonth != null ? ((todayMonth - 0.5) / 12) * 100 : null;

  // For each activity, compute fleet-average score (across active sites)
  // — used to colour the bar so the user spots underperforming
  // windows immediately. RAG cuts match the Site Leaderboard (55/65)
  // since this is a fleet-level aggregation.
  const aS = D.activeSites || [];
  const actScores = useMemo(() => {
    const m = {};
    D.activities.forEach((a, ix) => {
      let sum = 0, n = 0;
      aS.forEach(s => {
        const r = TR.score(D, s, S.year, S.month)[ix];
        if (r?.on && typeof r.sc === 'number') { sum += r.sc; n++; }
      });
      m[ix] = n ? sum / n : null;
    });
    return m;
  }, [D, aS.join('|'), S.year, S.month]);

  function ragForScore(sc) {
    if (sc == null) return 'none';
    const pct = sc * 100;
    if (pct >= 65) return 'green';
    if (pct >= 55) return 'amber';
    return 'red';
  }

  return (
    <div className="tt-panel">
      <div className="dash-eyebrow">Roadmap · {S.year} · 12-month Gantt</div>
      <div className="rm-hero">
        <div>
          <h3 className="rm-hero__title">Activity windows by pillar</h3>
          <p className="rm-hero__lede">
            Each bar shows when an activity is <b>in scope</b> (its Window from Setup). Two vertical lines mark
            time:
            {' '}<span className="rm-legend-pill rm-legend-pill--period">▮ Solid orange = <b>{MO[S.month - 1]} {S.year}</b> (selected reporting period)</span>
            {showTodayMarker && (<>{' '}<span className="rm-legend-pill rm-legend-pill--today">▮ Dashed grey = <b>today ({MO[todayMonth - 1]})</b></span></>)}
            . Bars are coloured by the activity's fleet-average score:
            {' '}<b style={{ color: '#1B9A3A' }}>green ≥ 65%</b> ·
            <b style={{ color: '#D97706' }}> amber 55–64%</b> ·
            <b style={{ color: '#DC2626' }}> red &lt; 55%</b> ·
            <b style={{ color: 'var(--color-text-muted)' }}> grey = inactive at every site</b>.
          </p>
        </div>
      </div>

      {/* Month header */}
      <div className="rm-month-header">
        <div className="rm-row-label">Pillar / activity</div>
        <div className="rm-track-header">
          {MO.map((m, i) => (
            <div key={m} className={'rm-month-cell ' + (i + 1 === S.month ? 'is-today' : '')}>{m}</div>
          ))}
        </div>
      </div>

      {/* Swimlanes */}
      {pillars.map(p => {
        const color = TR.gPC(D, p);
        const acts = D.activities.map((a, i) => ({ a, i })).filter(({ a }) => a.pillar === p);
        return (
          <div key={p} className="rm-swimlane" style={{ '--pillar-color': color }}>
            <div className="rm-swimlane__head">
              <span className="setup-pillar-row__chip" style={{ background: color }}>{p.split('-')[0]}</span>
              <span className="rm-swimlane__name">{TR.gPS(p)}</span>
              <small>{acts.length} activities</small>
            </div>
            {acts.map(({ a, i }) => {
              const start = Math.max(1, Math.min(12, a.start || 1));
              const end   = Math.max(start, Math.min(12, a.end || 12));
              const leftPct  = ((start - 1) / 12) * 100;
              const widthPct = ((end - start + 1) / 12) * 100;
              const rag = ragForScore(actScores[i]);
              const fleetPct = actScores[i] != null ? Math.round(actScores[i] * 100) : null;
              return (
                <div key={a.id || i} className="rm-row">
                  <div className="rm-row-label" title={a.name}>
                    <span className="rm-row-label__num">{a.num}</span>
                    <span className="rm-row-label__name">{a.name}</span>
                    {a.shared && <span className="ip-grid__shared">SHARED</span>}
                  </div>
                  <div className="rm-track">
                    {MO.map((m, mi) => (
                      <div key={m} className={'rm-month-cell rm-month-cell--ghost ' + (mi + 1 === S.month ? 'is-today' : '')} />
                    ))}
                    <div
                      className={'rm-bar rm-bar--' + rag}
                      style={{ left: leftPct + '%', width: widthPct + '%' }}
                      title={a.name + ' · ' + MO[start - 1] + '→' + MO[end - 1] + (fleetPct != null ? ' · fleet ' + fleetPct + '%' : ' · no active site has this on')}
                    >
                      <span className="rm-bar__label">
                        M{start}{end !== start ? '–M' + end : ''}
                        {fleetPct != null && <span className="rm-bar__pct">{fleetPct}%</span>}
                      </span>
                    </div>
                    <div className="rm-period-line" style={{ left: periodLeftPct + '%' }} title={'Selected reporting period: ' + MO[S.month - 1]} />
                    {showTodayMarker && (
                      <div className="rm-today-line" style={{ left: todayLeftPct + '%' }} title={'Today: ' + MO[todayMonth - 1]} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="tt-footer">
        <span>Bars use the Window (start month → end month) set per activity in <a href="#" onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent('preview-switch-tab', { detail: 'setup' })); }}>Tracker Setup</a>.</span>
        <span>The vertical orange line is the current reporting period (S.month). Bars to the left of it should already be scoring.</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Stub panel — no remaining tabs use it after Phase 5, but kept as
// a safety net in case a new tab id slips into TABS without a handler.
// ────────────────────────────────────────────────────────────────────
function StubPanel({ tab, phase }) {
  return (
    <div className="tt-panel">
      <div className="tt-stub">
        <span className="tt-stub__badge">PHASE {phase} — IN PROGRESS</span>
        <h2>{tab.label}</h2>
        <p>
          This tab is coming in phase {phase} of the rebuild. The Dashboard tab above
          is the only one running on the new design today; the rest still serve from
          the legacy page if you need them.
          {' '}<a href="/activity-tracker-legacy.html">Open the legacy tracker →</a>
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Root app
// ────────────────────────────────────────────────────────────────────
function App() {
  const [D, setD] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [S, setS] = useState({ year: new Date().getFullYear(), month: 1, view: 'dashboard' });
  const [dirty, setDirty] = useState(false);
  const [syncState, setSyncState] = useState('idle');
  const [syncError, setSyncError] = useState(null);
  // mutationCounter bumps every time a child component mutates D in
  // place (engine.si2 writes into the existing object). React doesn't
  // see the mutation, so we tick the counter to force a re-render +
  // the auto-save effect to re-evaluate.
  const [mutationCounter, setMutationCounter] = useState(0);
  // Toolbar-level modal state — separate from the per-panel modal in
  // SetupPanel because + Year lives in the toolbar, not in a panel.
  const [appModal, setAppModal] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);

  const roles = useMemo(computeRoles, []);

  // ─ Cross-tab navigation: panels can dispatch a custom event to
  //   jump the user to another tab without a full re-mount. Used by
  //   the Roadmap footer's "Tracker Setup" link, the Input panel's
  //   "Targets" link, etc.
  useEffect(() => {
    const handler = (e) => setS(s => ({ ...s, view: e.detail }));
    window.addEventListener('preview-switch-tab', handler);
    return () => window.removeEventListener('preview-switch-tab', handler);
  }, []);

  // ─ Boot: fetch /api/tracker/load ─────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await window.TRApi.load();
        if (!r || !r.D) throw new Error('No D in response');
        const Dload = r.D;
        if (!Dload.pillarWeights) Dload.pillarWeights = { 'P1-Network Infrast':0.30,'P2-Business Partner':0.35,'P3-Risk & Compliance':0.20,'P4-Manage People':0.15 };
        setD(Dload);
        // Default S.year: defaultYear() resolves to the current
        // calendar year IF it's configured, otherwise the most recent
        // past year. Prevents "S.year=2027 but dropdown options are
        // [2026]" mismatch when the calendar advances faster than
        // the tracker config does. Operator can still override via
        // the toolbar dropdown.
        // Default S.month = latest month with any actual input data
        // for the resolved year. Falls back to D.currentMonth
        // (server-stored), then to S.month (in-memory default).
        const targetYear  = defaultYear(Dload);
        const lastEntered = lastMonthWithData(Dload, targetYear);
        setS(s => ({
          ...s,
          month: lastEntered || Dload.currentMonth || s.month,
          year:  targetYear,
        }));
      } catch (e) {
        setLoadErr(e.message || 'Failed to load tracker data');
      }
    })();
  }, []);

  // ─ Save handler ──────────────────────────────────────────────
  // Used by both the Save button and the debounced auto-save effect.
  // Concurrent calls are protected via the lastSaveRef counter — only
  // the freshest one updates the UI (older calls' completions are
  // dropped on the floor).
  const lastSaveRef = useRef(0);
  async function handleSave() {
    if (!D) return;
    const tag = ++lastSaveRef.current;
    setSyncState('saving');
    try {
      await window.TRApi.save(D);
      if (tag !== lastSaveRef.current) return;   // a newer save started; ignore
      setDirty(false);
      setSyncError(null);
      setSyncState('synced');
      setTimeout(() => {
        if (tag === lastSaveRef.current) setSyncState('idle');
      }, 1800);
    } catch (e) {
      if (tag !== lastSaveRef.current) return;
      setSyncError(e.message);
      setSyncState('fail');
    }
  }

  // ─ Mutation hook for child panels ─────────────────────────────
  // Children mutate D in place via engine.si2 / engine helpers. They
  // then call onMutate() which bumps the counter, triggering both a
  // re-render and the auto-save useEffect below.
  function onMutate() {
    setDirty(true);
    setMutationCounter(c => c + 1);
  }

  // ─ Debounced auto-save (Phase 3 — Input + Setup + Targets) ───
  // Fires 800 ms after the last D mutation. Cancels itself on
  // subsequent changes (textbook debounce). Manual Save bypasses
  // this and POSTs immediately. tracker-editor / -admin / super_admin
  // are the only roles that can actually persist; lower roles set
  // dirty but the POST will 403 — that's surfaced via the
  // SyncIndicator's "Save failed — retry" state.
  useEffect(() => {
    if (!dirty || !roles.CAN_SAVE) return;
    const t = setTimeout(() => { handleSave(); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutationCounter, dirty, roles.CAN_SAVE]);

  // ─ Reset handler ─────────────────────────────────────────────
  async function handleReset() {
    if (!confirm('Reset ALL tracker data to defaults? This cannot be undone.')) return;
    try {
      const r = await window.TRApi.reset();
      if (r?.D) setD(r.D);
      setDirty(false);
      setSyncState('synced');
    } catch (e) {
      setSyncError(e.message);
      setSyncState('fail');
    }
  }

  // ─ Add Year handler ──────────────────────────────────────────
  // Opens a confirm modal explaining the consequences, then on
  // confirm mutates D.years + D.inputs in place and bumps the
  // counter so React + the autosave effect see it.
  function handleAddYear() {
    if (!D) return;
    const years = D.years || [];
    const nextYear = years.length ? Math.max(...years) + 1 : new Date().getFullYear() + 1;
    const sitesCount = D.sites?.length || 0;
    const actsCount  = D.activities?.length || 0;
    setAppModal({
      type: 'confirm',
      title: `Add year ${nextYear}`,
      confirmLabel: 'Add year',
      confirmKind: 'primary',
      body: (
        <>
          <p>Add <b>{nextYear}</b> to the tracker?</p>
          <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55, color: 'var(--color-text)' }}>
            <li>An empty input grid will be created for all <b>{sitesCount} sites × {actsCount} activities × 12 months</b> (zero-filled).</li>
            <li>All <b>pillar weights</b>, <b>per-activity windows</b>, <b>targets</b> and <b>active-site list</b> stay exactly the same as the current configuration — they apply across years.</li>
            <li>After confirming, the toolbar switches to <b>{nextYear} · Jan</b> so you can start entering data immediately.</li>
            <li>Previous years remain available in the Year dropdown — switch back at any time.</li>
            <li>Auto-saves to the database 0.8 s after confirmation.</li>
          </ul>
        </>
      ),
      onConfirm: () => {
        D.years = [...years, nextYear].sort((a, b) => a - b);
        if (!D.inputs) D.inputs = {};
        D.inputs[nextYear] = {};
        if (D.perYearEnabled && D.byYear) {
          // PHASE 4 — per-year mode: a new year starts EMPTY (ADR-001
          // Phase 4 decision 1). Use "Copy from previous year" in
          // Tracker Setup to clone the previous structure on demand.
          D.byYear[nextYear] = { activities: [], pillarWeights: {}, targets: {} };
        } else {
          // Compat mode: the global activity list applies to all years.
          D.sites.forEach(s => {
            D.inputs[nextYear][s] = D.activities.map(() => new Array(12).fill(0));
          });
        }
        setS(s => ({ ...s, year: nextYear, month: 1 }));
        setAppModal(null);
        onMutate();
      },
    });
  }

  // ─ Tab visibility (RBAC) ─────────────────────────────────────
  const visibleTabs = TABS.filter(t => roles.IS_EXEC || !EXEC_ONLY.has(t.id));

  if (loadErr) return <div className="tt-page"><div className="tt-error">Failed to load tracker data: {loadErr}</div></div>;
  if (!D)      return <div className="tt-page"><div className="tt-loading">Loading…</div></div>;

  // ── PHASE 4 (ADR-001) — per-year view ─────────────────────────
  // When the server enables per-year edits, every panel receives a
  // view of D whose activities/targets/pillarWeights are those of the
  // SELECTED year (S.year — the existing toolbar year selector
  // doubles as the Tracker Setup year scope, per Phase 4 decision 2).
  // The arrays are shared by reference with D.byYear[S.year], so the
  // panels' existing in-place mutations (splice / property writes)
  // land in the right year's structure and _saveV2 persists them.
  // Compat mode (flag off): Dv === D, behaviour byte-identical.
  const Dv = (D.perYearEnabled && D.byYear && D.byYear[S.year])
    ? { ...D,
        activities:    D.byYear[S.year].activities,
        targets:       D.byYear[S.year].targets,
        pillarWeights: D.byYear[S.year].pillarWeights }
    : D;

  let panel;
  if (S.view === 'dashboard') {
    panel = <DashboardPanel D={Dv} S={S} />;
  } else if (S.view === 'scoring') {
    panel = <ScoringPanel D={Dv} S={S} setS={setS} roles={roles} />;
  } else if (S.view === 'input') {
    panel = <InputPanel D={Dv} S={S} setS={setS} roles={roles} onMutate={onMutate} />;
  } else if (S.view === 'heatmap') {
    panel = <HeatmapPanel D={Dv} S={S} />;
  } else if (S.view === 'setup') {
    panel = <SetupPanel D={Dv} S={S} roles={roles} onMutate={onMutate} onAddYear={handleAddYear} />;
  } else if (S.view === 'targets') {
    panel = <TargetsPanel D={Dv} S={S} roles={roles} onMutate={onMutate} />;
  } else if (S.view === 'roadmap') {
    panel = <RoadmapPanel D={Dv} S={S} />;
  } else {
    panel = <StubPanel tab={TABS.find(t => t.id === S.view) || { label: 'Unknown' }} phase={3} />;
  }

  return (
    <div className="tt-page">
      <Toolbar
        D={D} S={S} setS={setS}
        dirty={dirty}
        syncState={syncState}
        syncError={syncError}
        onSave={handleSave}
        onReset={handleReset}
        onExport={() => setExportOpen(true)}
        roles={roles}
      />
      <Tabs activeId={S.view} onSelect={view => setS({ ...S, view })} visibleTabs={visibleTabs} />
      {panel}
      {appModal?.type === 'confirm' && (
        <Modal
          title={appModal.title}
          onCancel={() => setAppModal(null)}
          onConfirm={appModal.onConfirm}
          confirmLabel={appModal.confirmLabel}
          confirmKind={appModal.confirmKind}
        >
          {appModal.body}
        </Modal>
      )}
      {exportOpen && <ExportModal D={D} S={S} onClose={() => setExportOpen(false)} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Mount
// ────────────────────────────────────────────────────────────────────
const _root = ReactDOM.createRoot(document.getElementById('tracker-root'));
_root.render(<App />);
