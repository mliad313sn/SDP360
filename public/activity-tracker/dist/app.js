/* built by tools/build/build-frontend.js — do not edit; edit public/activity-tracker/App.jsx */
(() => {
  const { useState, useEffect, useRef, useMemo } = React;
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function hasRole(role) {
    if (typeof window.__userHasRole === "function") return window.__userHasRole(role);
    return false;
  }
  const _user = () => window.__authUser || null;
  function computeRoles(scope, scopes) {
    const u = _user();
    const IS_EXEC = !u || hasRole("executive") || hasRole("tracker-admin");
    const CAN_RESET = hasRole("super_admin") || hasRole("tracker-admin");
    const CAN_SAVE_ALL = hasRole("super_admin") || hasRole("tracker-admin");
    const CAN_SAVE_OWN = hasRole("tracker-editor") && scope !== "";
    const CAN_SAVE = CAN_SAVE_ALL || CAN_SAVE_OWN;
    const locked = CAN_SAVE_OWN && !CAN_SAVE_ALL && !!scope;
    const USER_SITES = locked ? Array.isArray(scopes) && scopes.length ? scopes.slice() : [scope] : null;
    const USER_SITE = USER_SITES ? USER_SITES[0] : null;
    const CAN_EXPORT = hasRole("admin") || hasRole("tracker-admin");
    const IS_SUPER = hasRole("super_admin");
    return { IS_EXEC, CAN_RESET, CAN_SAVE_ALL, CAN_SAVE_OWN, CAN_SAVE, USER_SITE, USER_SITES, CAN_EXPORT, IS_SUPER };
  }
  const fmtDelta = (n) => {
    if (n === 0 || Math.abs(n) < 0.01) return null;
    return (n > 0 ? "\u25B2 " : "\u25BC ") + Math.round(Math.abs(n) * 100) + "pp";
  };
  const deltaCls = (n) => n > 0 ? "dash-delta--up" : n < 0 ? "dash-delta--down" : "dash-delta--flat";
  function lastMonthWithData(D, year) {
    var _a;
    const yearData = (_a = D == null ? void 0 : D.inputs) == null ? void 0 : _a[year];
    if (!yearData) return null;
    let last = 0;
    for (const siteCode of Object.keys(yearData)) {
      const siteArr = yearData[siteCode];
      if (!Array.isArray(siteArr)) continue;
      for (const actRow of siteArr) {
        if (!Array.isArray(actRow)) continue;
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
  function defaultYear(D) {
    const now = (/* @__PURE__ */ new Date()).getFullYear();
    const years = (Array.isArray(D == null ? void 0 : D.years) ? D.years : []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (years.includes(now)) return now;
    const past = years.filter((y) => y <= now);
    if (past.length) return past[past.length - 1];
    if (years.length) return years[0];
    return now;
  }
  const TABS = [
    { id: "dashboard", label: "Dashboard" },
    { id: "scoring", label: "Scoring" },
    { id: "input", label: "Input" },
    { id: "heatmap", label: "Heatmap" },
    { id: "setup", label: "Tracker Setup" },
    { id: "targets", label: "Targets" },
    { id: "roadmap", label: "Roadmap" }
  ];
  const EXEC_ONLY = /* @__PURE__ */ new Set(["heatmap", "setup", "targets"]);
  function Toolbar({ D, S, setS, dirty, syncState, syncError, onSave, onReset, onExport, roles }) {
    return /* @__PURE__ */ React.createElement("div", { className: "tt-bar" }, /* @__PURE__ */ React.createElement("div", { className: "tt-bar__title" }, "IT Activity Tracker", /* @__PURE__ */ React.createElement("small", null, D.sites.length, " sites \xB7 ", D.activities.length, " activities \xB7 ", D.activeSites.length, " active")), /* @__PURE__ */ React.createElement("div", { className: "tt-bar__spacer" }), /* @__PURE__ */ React.createElement(SyncIndicator, { dirty, syncState, syncError }), /* @__PURE__ */ React.createElement("div", { className: "tt-bar__pickers" }, /* @__PURE__ */ React.createElement("label", null, "Year"), /* @__PURE__ */ React.createElement("select", { className: "tt-select", value: S.year, onChange: (e) => setS({ ...S, year: +e.target.value }) }, (D.years || []).map((y) => /* @__PURE__ */ React.createElement("option", { key: y, value: y }, y))), /* @__PURE__ */ React.createElement("label", null, "Period"), /* @__PURE__ */ React.createElement("select", { className: "tt-select", value: S.month, onChange: (e) => setS({ ...S, month: +e.target.value }) }, MO.map((m, i) => /* @__PURE__ */ React.createElement("option", { key: m, value: i + 1 }, m)))), roles.CAN_EXPORT && /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", type: "button", onClick: onExport, title: "Export the Activity Tracker as a multi-slide PPTX" }, "\u{1F4CA} Export PPTX"), roles.CAN_SAVE && /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "btn-primary",
        type: "button",
        onClick: onSave,
        disabled: syncState === "saving",
        title: syncState === "saving" ? "Save in progress\u2026" : dirty ? "Save unsynced changes now (bypasses the 0.8 s debounce)" : "Force a save \u2014 everything already in sync, but this re-pushes the full tracker state to the server as confirmation"
      },
      syncState === "saving" ? "\u{1F4BE} Saving\u2026" : dirty ? "\u{1F4BE} Save *" : "\u{1F4BE} Save"
    ), roles.CAN_RESET && /* @__PURE__ */ React.createElement("button", { className: "btn-danger", type: "button", onClick: onReset }, "\u21BB Reset"));
  }
  function ExportModal({ D, S, onClose }) {
    const [year, setYear] = useState(S.year);
    const [month, setMonth] = useState(S.month);
    const [sites, setSites] = useState(() => D.activeSites || []);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const [done, setDone] = useState(null);
    const activeSites = D.activeSites || [];
    const allSites = D.sites || [];
    function toggleSite(code) {
      setSites((prev) => prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]);
    }
    function selectAll() {
      setSites([...activeSites]);
    }
    function selectNone() {
      setSites([]);
    }
    async function run() {
      setBusy(true);
      setErr(null);
      setDone(null);
      try {
        const blob = await window.TRApi.exportPptx({ sites, yr: year, mo: month });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "IT_Ops_Strategy_" + MO[month - 1] + year + ".pptx";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1e3);
        setDone("Downloaded IT_Ops_Strategy_" + MO[month - 1] + year + ".pptx");
      } catch (e) {
        setErr(e.message || "Export failed");
      } finally {
        setBusy(false);
      }
    }
    return /* @__PURE__ */ React.createElement(
      Modal,
      {
        title: "Export PPTX \u2014 " + MO[month - 1] + " " + year,
        onCancel: onClose,
        onConfirm: run,
        confirmLabel: busy ? "Generating\u2026" : done ? "Download again" : "Generate PPTX",
        confirmKind: "primary",
        confirmDisabled: busy || sites.length === 0,
        wide: true
      },
      /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 14px", fontSize: 12.5, lineHeight: 1.55 } }, "Generates a multi-slide PowerPoint deck from the current tracker data \u2014 KPI strip, site cards, charts and per-pillar breakdowns. Inactive sites are filtered out on the server side regardless of selection."),
      /* @__PURE__ */ React.createElement("div", { className: "exp-form" }, /* @__PURE__ */ React.createElement("div", { className: "exp-row" }, /* @__PURE__ */ React.createElement("label", null, "Year"), /* @__PURE__ */ React.createElement("select", { className: "tt-select", value: year, onChange: (e) => setYear(+e.target.value), disabled: busy }, (D.years || []).map((y) => /* @__PURE__ */ React.createElement("option", { key: y, value: y }, y)))), /* @__PURE__ */ React.createElement("div", { className: "exp-row" }, /* @__PURE__ */ React.createElement("label", null, "Reporting month"), /* @__PURE__ */ React.createElement("select", { className: "tt-select", value: month, onChange: (e) => setMonth(+e.target.value), disabled: busy }, MO.map((m, i) => /* @__PURE__ */ React.createElement("option", { key: m, value: i + 1 }, m)))), /* @__PURE__ */ React.createElement("div", { className: "exp-row" }, /* @__PURE__ */ React.createElement("label", null, "Sites ", /* @__PURE__ */ React.createElement("small", null, "(", sites.length, " selected)")), /* @__PURE__ */ React.createElement("div", { className: "exp-site-grid" }, allSites.map((code) => {
        const isActive = activeSites.includes(code);
        const isPicked = sites.includes(code);
        return /* @__PURE__ */ React.createElement(
          "button",
          {
            key: code,
            type: "button",
            className: "exp-site " + (isPicked ? "is-picked" : "") + (isActive ? "" : " is-inactive"),
            onClick: () => isActive && !busy && toggleSite(code),
            disabled: !isActive || busy,
            title: isActive ? D.siteNames[code] || code : (D.siteNames[code] || code) + " \u2014 inactive (cannot export)",
            style: isPicked && isActive ? { background: D.siteColors[code], borderColor: D.siteColors[code], color: "#fff" } : {}
          },
          /* @__PURE__ */ React.createElement("span", { className: "exp-site__code" }, code),
          /* @__PURE__ */ React.createElement("span", { className: "exp-site__name" }, D.siteNames[code] || code)
        );
      })), /* @__PURE__ */ React.createElement("div", { className: "exp-quick" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn-ghost", onClick: selectAll, disabled: busy }, "All active"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn-ghost", onClick: selectNone, disabled: busy }, "None"))), busy && /* @__PURE__ */ React.createElement("div", { className: "tt-banner", style: { background: "rgba(20,95,174,.08)", borderLeft: "3px solid var(--edv-blue)", color: "#0F4C81" } }, "\u23F3 Generating PPTX server-side \u2014 this can take 10\u201330 seconds for a fleet-wide report."), err && /* @__PURE__ */ React.createElement("div", { className: "tt-banner", style: { background: "rgba(217,0,56,.08)", borderLeft: "3px solid var(--color-danger)", color: "#991B1B" } }, "\u274C ", err), done && /* @__PURE__ */ React.createElement("div", { className: "tt-banner", style: { background: "rgba(27,154,58,.08)", borderLeft: "3px solid var(--color-success)", color: "#166534" } }, "\u2705 ", done))
    );
  }
  function SyncIndicator({ dirty, syncState, syncError }) {
    if (syncState === "saving") return /* @__PURE__ */ React.createElement("span", { className: "tt-status tt-status--dirty" }, /* @__PURE__ */ React.createElement("span", { className: "tt-status__dot" }), " Saving\u2026");
    if (syncState === "fail") return /* @__PURE__ */ React.createElement("span", { className: "tt-status tt-status--fail", title: syncError || "" }, /* @__PURE__ */ React.createElement("span", { className: "tt-status__dot" }), " Save failed \u2014 retry");
    if (dirty) return /* @__PURE__ */ React.createElement("span", { className: "tt-status tt-status--dirty" }, /* @__PURE__ */ React.createElement("span", { className: "tt-status__dot" }), " Unsaved changes");
    return /* @__PURE__ */ React.createElement("span", { className: "tt-status tt-status--synced" }, /* @__PURE__ */ React.createElement("span", { className: "tt-status__dot" }), " Synced");
  }
  function Tabs({ activeId, onSelect, visibleTabs }) {
    return /* @__PURE__ */ React.createElement("div", { className: "tt-tabs", role: "tablist" }, visibleTabs.map((t) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: t.id,
        type: "button",
        className: "tt-tab " + (t.id === activeId ? "is-active" : ""),
        onClick: () => onSelect(t.id),
        role: "tab",
        "aria-selected": t.id === activeId
      },
      t.label,
      t.badge && /* @__PURE__ */ React.createElement("span", { className: "tt-tab__badge" }, t.badge)
    )));
  }
  function DashboardPanel({ D, S }) {
    var _a, _b;
    const TR = window.TR;
    const aS = D.activeSites || [];
    const PWmonth = S.month > 1 ? S.month - 1 : 1;
    const sm = useMemo(() => {
      const m = {};
      D.sites.forEach((s) => {
        m[s] = TR.ss(D, s, S.year, S.month);
      });
      return m;
    }, [D, S.year, S.month]);
    const psm = useMemo(() => {
      const m = {};
      D.sites.forEach((s) => {
        m[s] = TR.ss(D, s, S.year, PWmonth);
      });
      return m;
    }, [D, S.year, PWmonth]);
    const fst = useMemo(() => TR.fleetStats(D, aS, S.year, S.month), [D, aS.join("|"), S.year, S.month]);
    const fstPrev = useMemo(() => TR.fleetStats(D, aS, S.year, PWmonth), [D, aS.join("|"), S.year, PWmonth]);
    const pillars = useMemo(() => TR.gP(D), [D]);
    const pillarFleet = useMemo(() => {
      const out = {};
      pillars.forEach((p) => {
        const cur = aS.length ? aS.reduce((t, s) => t + TR.ps2(D, s, p, S.year, S.month), 0) / aS.length : 0;
        const prev = aS.length ? aS.reduce((t, s) => t + TR.ps2(D, s, p, S.year, PWmonth), 0) / aS.length : 0;
        const activeSitesForPillar = aS.filter((s) => TR.score(D, s, S.year, S.month).some((r) => r.pillar === p && r.on)).length;
        out[p] = { cur, prev, delta: cur - prev, activeSites: activeSitesForPillar };
      });
      return out;
    }, [D, aS.join("|"), S.year, S.month, PWmonth]);
    const tG = aS.reduce((t, s) => t + sm[s].g, 0);
    const tA = aS.reduce((t, s) => t + sm[s].a, 0);
    const tR = aS.reduce((t, s) => t + sm[s].r, 0);
    const inactiveSites = D.sites.filter((s) => !aS.includes(s));
    const coms = useMemo(() => TR.genCom(D, aS, S.year, S.month), [D, aS.join("|"), S.year, S.month]);
    const combined = coms.filter((c) => c.cat === "COMBINED");
    const siteSpec = coms.filter((c) => c.cat === "SITE");
    const info = coms.filter((c) => c.cat === "INFO");
    const [drilledPillar, setDrilledPillar] = useState(null);
    const [drilledSite, setDrilledSite] = useState(null);
    const trendWindow = useMemo(() => {
      const out = [];
      let y = S.year, m = S.month;
      for (let i = 0; i < 6; i++) {
        out.unshift({ year: y, month: m, label: `${MO[m - 1]} ${String(y).slice(-2)}` });
        m--;
        if (m < 1) {
          m = 12;
          y--;
        }
      }
      return out;
    }, [S.year, S.month]);
    const pillarTrends = useMemo(() => {
      const out = {};
      pillars.forEach((p) => {
        out[p] = trendWindow.map(({ year, month }) => {
          if (!aS.length) return 0;
          const sum = aS.reduce((t, s) => t + TR.ps2(D, s, p, year, month), 0);
          return Math.round(sum / aS.length * 100);
        });
      });
      return out;
    }, [D, aS.join("|"), pillars.join("|"), trendWindow]);
    const siteTrends = useMemo(() => {
      const out = {};
      aS.forEach((s) => {
        out[s] = trendWindow.map(({ year, month }) => Math.round(TR.ss(D, s, year, month).avg * 100));
      });
      return out;
    }, [D, aS.join("|"), trendWindow]);
    const ranked = useMemo(() => {
      return aS.slice().sort((a, b) => sm[b].avg - sm[a].avg || a.localeCompare(b)).map((code, ix) => {
        var _a2;
        const v = sm[code];
        const delta = S.month > 1 ? v.avg - (((_a2 = psm[code]) == null ? void 0 : _a2.avg) || 0) : 0;
        return { rank: ix + 1, code, name: D.siteNames[code] || code, score: v.avg, delta, g: v.g, a: v.a, r: v.r };
      });
    }, [aS.join("|"), D, S.year, S.month, sm, psm]);
    const overallPct = Math.round(fst.avg * 100);
    const overallDelta = S.month > 1 ? fst.avg - fstPrev.avg : 0;
    const onTargetPct = Math.round(fst.attainment * 100);
    const showingPct = Math.round(fst.completion * 100);
    const chartRefs = useRef({});
    useEffect(() => {
      if (typeof Chart === "undefined") return;
      const P = pillars;
      const co = { responsive: true, animation: { duration: 300 }, plugins: { legend: { display: false } }, scales: { y: { grid: { color: "#f1f5f9" } }, x: { grid: { display: false } } } };
      Object.values(chartRefs.current).forEach((c) => {
        try {
          c.destroy();
        } catch (e) {
        }
      });
      chartRefs.current = {};
      const cHeroTrend = document.getElementById("dash-trend-hero");
      if (cHeroTrend) chartRefs.current.heroTrend = new Chart(cHeroTrend, {
        type: "line",
        data: {
          labels: fst.trends.map((t) => MO[t.month - 1]),
          datasets: [{
            label: "Fleet",
            data: fst.trends.map((t) => Math.round(t.avg * 100)),
            borderColor: "#145FAE",
            backgroundColor: "rgba(20,95,174,0.10)",
            borderWidth: 2.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.35,
            fill: true
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => "Fleet avg: " + c.parsed.y + "%" } } }, scales: { y: { max: 100, ticks: { callback: (v) => v + "%", font: { size: 10 } }, grid: { color: "#f1f5f9" } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } } }
      });
      const c1 = document.getElementById("dash-c1");
      if (c1) chartRefs.current.c1 = new Chart(c1, {
        type: "bar",
        data: { labels: aS, datasets: [{ data: aS.map((s) => Math.round(sm[s].avg * 100)), backgroundColor: aS.map((s) => D.siteColors[s]), borderRadius: 4, barPercentage: 0.6 }] },
        options: { ...co, scales: { ...co.scales, y: { ...co.scales.y, max: 100, ticks: { callback: (v) => v + "%" } } } }
      });
      const c3 = document.getElementById("dash-c3");
      if (c3) {
        const rd = P.map((p) => {
          let g = 0, a = 0, r = 0;
          aS.forEach((s) => {
            TR.score(D, s, S.year, S.month).forEach((x) => {
              if (x.pillar === p) {
                if (x.rg === "GREEN") g++;
                if (x.rg === "AMBER") a++;
                if (x.rg === "RED") r++;
              }
            });
          });
          return { g, a, r };
        });
        chartRefs.current.c3 = new Chart(c3, {
          type: "bar",
          data: { labels: P.map(TR.gPS), datasets: [
            { label: "Green", data: rd.map((d) => d.g), backgroundColor: "#16a34a", borderRadius: 2 },
            { label: "Amber", data: rd.map((d) => d.a), backgroundColor: "#d97706", borderRadius: 2 },
            { label: "Red", data: rd.map((d) => d.r), backgroundColor: "#dc2626", borderRadius: 2 }
          ] },
          options: { ...co, plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 9 } } } }, scales: { y: { stacked: true, grid: { color: "#f1f5f9" } }, x: { stacked: true, grid: { display: false } } } }
        });
      }
      const c4 = document.getElementById("dash-c4");
      if (c4) chartRefs.current.c4 = new Chart(c4, {
        type: "bar",
        data: { labels: aS, datasets: [
          { label: "Green", data: aS.map((s) => sm[s].g), backgroundColor: "#16a34a" },
          { label: "Amber", data: aS.map((s) => sm[s].a), backgroundColor: "#d97706" },
          { label: "Red", data: aS.map((s) => sm[s].r), backgroundColor: "#dc2626" }
        ] },
        options: { ...co, plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 9 } } } }, scales: { y: { stacked: true, grid: { color: "#f1f5f9" } }, x: { stacked: true, grid: { display: false } } } }
      });
      const c5 = document.getElementById("dash-c5");
      if (c5) chartRefs.current.c5 = new Chart(c5, {
        type: "doughnut",
        data: { labels: ["Green (On Target)", "Amber (At Risk)", "Red (Off Track)"], datasets: [{ data: [tG, tA, tR], backgroundColor: ["#16a34a", "#d97706", "#dc2626"], borderWidth: 2, borderColor: "#fff" }] },
        options: { responsive: true, animation: { duration: 300 }, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: function(c) {
          const t = c.dataset.data.reduce((a, b) => a + b, 0);
          return c.label + ": " + c.raw + " (" + Math.round(c.raw / t * 100) + "%)";
        } } } } }
      });
      const wSum = { g: 0, a: 0, r: 0 };
      aS.forEach((s) => {
        TR.score(D, s, S.year, S.month).forEach((row) => {
          if (!row.on) return;
          if (row.rg === "GREEN") wSum.g += row.ew || 0;
          else if (row.rg === "AMBER") wSum.a += row.ew || 0;
          else if (row.rg === "RED") wSum.r += row.ew || 0;
        });
      });
      const c6 = document.getElementById("dash-c6");
      if (c6) chartRefs.current.c6 = new Chart(c6, {
        type: "doughnut",
        data: { labels: ["Green (On Target)", "Amber (At Risk)", "Red (Off Track)"], datasets: [{ data: [wSum.g, wSum.a, wSum.r], backgroundColor: ["#16a34a", "#d97706", "#dc2626"], borderWidth: 2, borderColor: "#fff" }] },
        options: { responsive: true, animation: { duration: 300 }, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: function(c) {
          const t = c.dataset.data.reduce((a, b) => a + b, 0) || 1;
          return c.label + ": " + (c.raw / t * 100).toFixed(1) + "% of programme weight";
        } } } } }
      });
      return () => {
        Object.values(chartRefs.current).forEach((c) => {
          try {
            c.destroy();
          } catch (e) {
          }
        });
        chartRefs.current = {};
      };
    }, [D, S.year, S.month, aS.join("|"), pillars.join("|")]);
    useEffect(() => {
      if (typeof Chart === "undefined") return;
      const cleanup = [];
      const co = { responsive: true, maintainAspectRatio: false, animation: { duration: 250 } };
      if (drilledPillar) {
        const el = document.getElementById("dash-drill-pillar-chart");
        const data = pillarTrends[drilledPillar] || [];
        if (el && data.length) {
          const ch = new Chart(el, {
            type: "line",
            data: {
              labels: trendWindow.map((p) => p.label),
              datasets: [{
                label: TR.gPS(drilledPillar),
                data,
                borderColor: TR.gPC(D, drilledPillar) || "#145FAE",
                backgroundColor: (TR.gPC(D, drilledPillar) || "#145FAE") + "22",
                borderWidth: 2.5,
                pointRadius: 4,
                pointHoverRadius: 6,
                tension: 0.35,
                fill: true
              }]
            },
            options: { ...co, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.y + "% fleet avg" } } }, scales: { y: { max: 100, ticks: { callback: (v) => v + "%", font: { size: 9 } } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } } }
          });
          cleanup.push(ch);
        }
      }
      if (drilledSite) {
        const el = document.getElementById("dash-drill-site-chart");
        const data = siteTrends[drilledSite] || [];
        if (el && data.length) {
          const ch = new Chart(el, {
            type: "line",
            data: {
              labels: trendWindow.map((p) => p.label),
              datasets: [{
                label: D.siteNames[drilledSite] || drilledSite,
                data,
                borderColor: D.siteColors[drilledSite] || "#1A3A5F",
                backgroundColor: (D.siteColors[drilledSite] || "#1A3A5F") + "22",
                borderWidth: 2.5,
                pointRadius: 4,
                pointHoverRadius: 6,
                tension: 0.35,
                fill: true
              }]
            },
            options: { ...co, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.y + "%" } } }, scales: { y: { max: 100, ticks: { callback: (v) => v + "%", font: { size: 9 } } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } } }
          });
          cleanup.push(ch);
        }
      }
      return () => {
        cleanup.forEach((c) => {
          try {
            c.destroy();
          } catch (e) {
          }
        });
      };
    }, [drilledPillar, drilledSite, pillarTrends, siteTrends, trendWindow, D]);
    return /* @__PURE__ */ React.createElement("div", { className: "tt-panel" }, /* @__PURE__ */ React.createElement("div", { className: "dash-hero" }, /* @__PURE__ */ React.createElement("div", { className: "dash-hero__overall" }, /* @__PURE__ */ React.createElement("div", { className: "dash-eyebrow" }, "Overall Score \xB7 ", MO[S.month - 1], " ", S.year), /* @__PURE__ */ React.createElement("div", { className: "dash-hero__score-row" }, /* @__PURE__ */ React.createElement("span", { className: "dash-hero__score" }, overallPct), /* @__PURE__ */ React.createElement("span", { className: "dash-hero__pct" }, "%"), S.month > 1 && fmtDelta(overallDelta) && /* @__PURE__ */ React.createElement("span", { className: "dash-hero__delta " + deltaCls(overallDelta) }, fmtDelta(overallDelta))), /* @__PURE__ */ React.createElement("div", { className: "dash-hero__stats" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, onTargetPct, "%"), " of activities ", /* @__PURE__ */ React.createElement("small", null, "on target")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, showingPct, "%"), " ", /* @__PURE__ */ React.createElement("small", null, "showing progress")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("small", null, "Best"), " ", /* @__PURE__ */ React.createElement("b", { style: { color: D.siteColors[fst.best] } }, fst.best), " ", /* @__PURE__ */ React.createElement("b", null, Math.round((((_a = sm[fst.best]) == null ? void 0 : _a.avg) || 0) * 100), "%")), /* @__PURE__ */ React.createElement("div", { className: "dash-hero__watch" }, /* @__PURE__ */ React.createElement("small", null, "Watch"), " ", /* @__PURE__ */ React.createElement("b", { style: { color: D.siteColors[fst.worst] } }, fst.worst), " ", /* @__PURE__ */ React.createElement("b", null, Math.round((((_b = sm[fst.worst]) == null ? void 0 : _b.avg) || 0) * 100), "%")))), /* @__PURE__ */ React.createElement("div", { className: "dash-hero__trend" }, /* @__PURE__ */ React.createElement("div", { className: "dash-eyebrow", style: { marginBottom: 8 } }, "6-month trend"), /* @__PURE__ */ React.createElement("div", { className: "dash-hero__trend-canvas" }, /* @__PURE__ */ React.createElement("canvas", { id: "dash-trend-hero" })))), /* @__PURE__ */ React.createElement("div", { className: "dash-twocol" }, /* @__PURE__ */ React.createElement("div", { className: "dash-card-block" }, /* @__PURE__ */ React.createElement("div", { className: "dash-card-block__head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", null, "Pillar Health"), /* @__PURE__ */ React.createElement("small", null, "Strategic dimensions \xB7 weighted by importance"))), /* @__PURE__ */ React.createElement("div", { className: "dash-pillar-list" }, pillars.map((p) => {
      var _a2;
      const color = TR.gPC(D, p);
      const cur = pillarFleet[p].cur;
      const delta = pillarFleet[p].delta;
      const weight = Math.round((((_a2 = D.pillarWeights) == null ? void 0 : _a2[p]) || 0) * 100);
      const pct = Math.round(cur * 100);
      const expanded = drilledPillar === p;
      return /* @__PURE__ */ React.createElement("div", { key: p, className: "dash-pillar" + (expanded ? " dash-pillar--expanded" : "") }, /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "dash-pillar__head",
          style: { cursor: "pointer" },
          onClick: () => setDrilledPillar(expanded ? null : p),
          title: expanded ? "Click to collapse trend" : "Click to see 6-month trend"
        },
        /* @__PURE__ */ React.createElement("span", { className: "dash-pillar__chip", style: { background: color } }, p.split("-")[0]),
        /* @__PURE__ */ React.createElement("div", { className: "dash-pillar__meta" }, /* @__PURE__ */ React.createElement("div", { className: "dash-pillar__name" }, TR.gPS(p), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: 6, color: "var(--color-text-muted)", fontSize: 11 } }, expanded ? "\u25B4" : "\u25BE")), /* @__PURE__ */ React.createElement("small", null, weight, "% weight \xB7 ", pillarFleet[p].activeSites, " active sites")),
        /* @__PURE__ */ React.createElement("div", { className: "dash-pillar__right" }, /* @__PURE__ */ React.createElement("span", { className: "dash-pillar__pct" }, pct, /* @__PURE__ */ React.createElement("small", null, "%")), S.month > 1 && fmtDelta(delta) && /* @__PURE__ */ React.createElement("span", { className: "dash-delta " + deltaCls(delta) }, fmtDelta(delta)))
      ), /* @__PURE__ */ React.createElement("div", { className: "dash-pillar__bar" }, /* @__PURE__ */ React.createElement("div", { className: "dash-pillar__bar-fill", style: { width: pct + "%", background: color } })), expanded && /* @__PURE__ */ React.createElement("div", { className: "dash-pillar__drill", style: { padding: "10px 8px 4px", borderTop: "1px solid var(--color-border)", marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", marginBottom: 4 } }, "6-MONTH FLEET TREND \xB7 ", TR.gPS(p).toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { height: 140, position: "relative" } }, /* @__PURE__ */ React.createElement("canvas", { id: "dash-drill-pillar-chart" }))));
    }))), /* @__PURE__ */ React.createElement("div", { className: "dash-card-block" }, /* @__PURE__ */ React.createElement("div", { className: "dash-card-block__head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", null, "Site Leaderboard"), /* @__PURE__ */ React.createElement("small", null, aS.length, " active \xB7 ", inactiveSites.length, " inactive \xB7 ranked by overall score"))), /* @__PURE__ */ React.createElement("div", { className: "dash-lb" }, /* @__PURE__ */ React.createElement("div", { className: "dash-lb__head", role: "row" }, /* @__PURE__ */ React.createElement("span", null, "#"), /* @__PURE__ */ React.createElement("span", null, "Site"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "center" } }, "Activities ", /* @__PURE__ */ React.createElement("small", null, "G/A/R")), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right" } }, "Score"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right" } }, "vs prev")), ranked.map((row) => {
      const pct = Math.round(row.score * 100);
      const barRag = pct < 55 ? "red" : pct < 65 ? "amber" : "green";
      const expanded = drilledSite === row.code;
      return /* @__PURE__ */ React.createElement(React.Fragment, { key: row.code }, /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "dash-lb__row" + (expanded ? " dash-lb__row--expanded" : ""),
          role: "row",
          style: { cursor: "pointer" },
          onClick: () => setDrilledSite(expanded ? null : row.code),
          title: expanded ? "Click to collapse trend" : "Click to see 6-month trend"
        },
        /* @__PURE__ */ React.createElement("span", { className: "dash-lb__rank" }, row.rank),
        /* @__PURE__ */ React.createElement("div", { className: "dash-lb__site" }, /* @__PURE__ */ React.createElement("span", { className: "dash-lb__code", style: { background: D.siteColors[row.code] } }, row.code), /* @__PURE__ */ React.createElement("span", { className: "dash-lb__name" }, row.name, /* @__PURE__ */ React.createElement("span", { style: { marginLeft: 6, color: "var(--color-text-muted)", fontSize: 11 } }, expanded ? "\u25B4" : "\u25BE"))),
        /* @__PURE__ */ React.createElement("span", { className: "dash-lb__gar" }, /* @__PURE__ */ React.createElement("span", { className: "g" }, row.g), /* @__PURE__ */ React.createElement("span", { className: "sep" }, "/"), /* @__PURE__ */ React.createElement("span", { className: "a" }, row.a), /* @__PURE__ */ React.createElement("span", { className: "sep" }, "/"), /* @__PURE__ */ React.createElement("span", { className: "r" }, row.r)),
        /* @__PURE__ */ React.createElement("div", { className: "dash-lb__score" }, /* @__PURE__ */ React.createElement("div", { className: "dash-lb__bar" }, /* @__PURE__ */ React.createElement("div", { className: "dash-lb__bar-fill dash-lb__bar-fill--" + barRag, style: { width: pct + "%" } })), /* @__PURE__ */ React.createElement("b", null, pct, "%")),
        /* @__PURE__ */ React.createElement("span", { className: "dash-lb__delta" }, S.month > 1 && fmtDelta(row.delta) ? /* @__PURE__ */ React.createElement("span", { className: "dash-delta " + deltaCls(row.delta) }, fmtDelta(row.delta)) : /* @__PURE__ */ React.createElement("small", { style: { color: "var(--color-text-muted)" } }, "\u2014"))
      ), expanded && /* @__PURE__ */ React.createElement("div", { className: "dash-lb__drill", style: {
        padding: "10px 12px 6px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-subtle, #fafafa)"
      } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", marginBottom: 4 } }, "6-MONTH SCORE TREND \xB7 ", row.name.toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { height: 140, position: "relative" } }, /* @__PURE__ */ React.createElement("canvas", { id: "dash-drill-site-chart" }))));
    }), inactiveSites.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "dash-lb__inactives" }, /* @__PURE__ */ React.createElement("small", null, inactiveSites.length, " sites inactive \xB7"), inactiveSites.map((code) => /* @__PURE__ */ React.createElement("span", { key: code, className: "dash-lb__inactive-chip", title: (D.siteNames[code] || code) + " \u2014 inactive" }, code)))))), /* @__PURE__ */ React.createElement("div", { className: "dash-commentary" }, /* @__PURE__ */ React.createElement("h4", null, "\u{1F4DD} Executive Commentary \u2014 ", MO[S.month - 1], " ", S.year, S.month > 1 ? " vs " + MO[S.month - 2] : ""), info.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: "i" + i, className: "dash-commentary__line", style: { color: "var(--color-text-muted)" } }, "\u2139\uFE0F ", c.text)), combined.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "dash-commentary__group dash-commentary__group--combined" }, "\u{1F310} Cross-Site (Combined)"), combined.map((c, i) => {
      const isG = /positive|completed/.test(c.text);
      const isB = /attention|RED|regressed/.test(c.text);
      return /* @__PURE__ */ React.createElement("div", { key: "c" + i, className: "dash-commentary__line " + (isG ? "dash-commentary__line--good" : isB ? "dash-commentary__line--bad" : "") }, c.text);
    }), siteSpec.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "dash-commentary__group dash-commentary__group--site" }, "\u{1F4CD} Site-Specific"), siteSpec.map((c, i) => {
      const isG = /Improved|GREEN|standout/.test(c.text);
      const isB = /Declined|RED|dropped/.test(c.text);
      return /* @__PURE__ */ React.createElement("div", { key: "s" + i, className: "dash-commentary__line " + (isG ? "dash-commentary__line--good" : isB ? "dash-commentary__line--bad" : "") }, c.text);
    })), /* @__PURE__ */ React.createElement("div", { className: "dash-charts" }, /* @__PURE__ */ React.createElement("div", { className: "dash-chart-card" }, /* @__PURE__ */ React.createElement("h3", null, "\u{1F3AF} Target Attainment \u2014 by Activity Count"), /* @__PURE__ */ React.createElement("canvas", { id: "dash-c5" })), /* @__PURE__ */ React.createElement("div", { className: "dash-chart-card" }, /* @__PURE__ */ React.createElement("h3", null, "\u2696 Target Attainment \u2014 by Weight"), /* @__PURE__ */ React.createElement("canvas", { id: "dash-c6" })), /* @__PURE__ */ React.createElement("div", { className: "dash-chart-card" }, /* @__PURE__ */ React.createElement("h3", null, "Average Score by Site"), /* @__PURE__ */ React.createElement("canvas", { id: "dash-c1" })), /* @__PURE__ */ React.createElement("div", { className: "dash-chart-card" }, /* @__PURE__ */ React.createElement("h3", null, "RAG Distribution by Pillar"), /* @__PURE__ */ React.createElement("canvas", { id: "dash-c3" })), /* @__PURE__ */ React.createElement("div", { className: "dash-chart-card" }, /* @__PURE__ */ React.createElement("h3", null, "Site G/A/R Stacks"), /* @__PURE__ */ React.createElement("canvas", { id: "dash-c4" }))));
  }
  function SitePicker({ D, value, onChange, lockSites, label = "Site" }) {
    const all = (D.activeSites && D.activeSites.length ? D.activeSites : D.sites).filter((s) => D.sites.includes(s));
    const sites = lockSites ? lockSites.filter((s) => D.sites.includes(s)) : all;
    const lockSite = lockSites && sites.length === 1 ? sites[0] : null;
    if (lockSite) {
      return /* @__PURE__ */ React.createElement("div", { className: "tt-site-picker" }, /* @__PURE__ */ React.createElement("label", null, label), /* @__PURE__ */ React.createElement("span", { className: "tt-site-locked", style: { background: D.siteColors[lockSite] || "#3A4A60" } }, lockSite), /* @__PURE__ */ React.createElement("small", { style: { fontSize: 11, color: "var(--color-text-muted)" } }, D.siteNames[lockSite] || "", " \xB7 locked to your site"));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "tt-site-picker" }, /* @__PURE__ */ React.createElement("label", null, label), /* @__PURE__ */ React.createElement("select", { className: "tt-select", value, onChange: (e) => onChange(e.target.value) }, sites.map((s) => /* @__PURE__ */ React.createElement("option", { key: s, value: s }, s, " \u2014 ", D.siteNames[s] || s))), lockSites ? /* @__PURE__ */ React.createElement("small", { style: { fontSize: 11, color: "var(--color-text-muted)" } }, "your sites only") : null);
  }
  function ScoringPanel({ D, S, setS, roles }) {
    var _a;
    const TR = window.TR;
    const lockSites = roles.USER_SITES;
    const initialSite = lockSites ? lockSites.includes(S.site) ? S.site : lockSites[0] : S.site || ((_a = D.activeSites) == null ? void 0 : _a[0]) || D.sites[0];
    const [site, setSite] = useState(initialSite);
    const sc = useMemo(() => TR.score(D, site, S.year, S.month), [D, site, S.year, S.month]);
    const sm = useMemo(() => TR.ss(D, site, S.year, S.month), [D, site, S.year, S.month]);
    const pillars = useMemo(() => TR.gP(D), [D]);
    const groups = pillars.map((p) => {
      var _a2;
      return {
        pillar: p,
        color: TR.gPC(D, p),
        name: TR.gPS(p),
        pillarPct: Math.round(TR.ps2(D, site, p, S.year, S.month) * 100),
        weight: Math.round((((_a2 = D.pillarWeights) == null ? void 0 : _a2[p]) || 0) * 100),
        rows: sc.filter((s) => s.pillar === p)
      };
    }).filter((g) => g.rows.length > 0);
    return /* @__PURE__ */ React.createElement("div", { className: "tt-panel" }, /* @__PURE__ */ React.createElement("div", { className: "dash-eyebrow" }, "Scoring \xB7 ", MO[S.month - 1], " ", S.year), /* @__PURE__ */ React.createElement("div", { className: "sc-hero" }, /* @__PURE__ */ React.createElement(SitePicker, { D, value: site, onChange: setSite, lockSites }), /* @__PURE__ */ React.createElement("div", { className: "sc-hero__stat" }, /* @__PURE__ */ React.createElement("span", { className: "sc-hero__code", style: { color: D.siteColors[site] } }, site), /* @__PURE__ */ React.createElement("span", { className: "sc-hero__name" }, D.siteNames[site] || site), /* @__PURE__ */ React.createElement("span", { className: "rag rag--green" }, sm.g, " on track"), /* @__PURE__ */ React.createElement("span", { className: "rag rag--amber" }, sm.a, " at risk"), /* @__PURE__ */ React.createElement("span", { className: "rag rag--red" }, sm.r, " off track"), /* @__PURE__ */ React.createElement("span", { className: "sc-hero__overall" }, Math.round(sm.avg * 100), "%"))), /* @__PURE__ */ React.createElement("div", { className: "sc-table", role: "table" }, /* @__PURE__ */ React.createElement("div", { className: "sc-thead", role: "row" }, /* @__PURE__ */ React.createElement("span", null, "#"), /* @__PURE__ */ React.createElement("span", null, "Pillar"), /* @__PURE__ */ React.createElement("span", null, "Activity"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right" } }, "Weight"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right" } }, "YTD"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right" } }, "Target"), /* @__PURE__ */ React.createElement("span", null, "Score"), /* @__PURE__ */ React.createElement("span", null, "Status")), groups.map((g) => /* @__PURE__ */ React.createElement(React.Fragment, { key: g.pillar }, /* @__PURE__ */ React.createElement("div", { className: "sc-pillar-row", role: "row", style: { "--pillar-color": g.color } }, /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", { className: "sc-pillar-row__chip", style: { background: g.color } }, g.pillar.split("-")[0]), /* @__PURE__ */ React.createElement("span", { className: "sc-pillar-row__title" }, g.name, " ", /* @__PURE__ */ React.createElement("small", null, "(", g.weight, "% of overall)")), /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right", fontWeight: 800, color: g.color } }, g.pillarPct, "%"), /* @__PURE__ */ React.createElement("span", null)), g.rows.map((r) => {
      const rg = String(r.rg).toLowerCase();
      const scorePct = typeof r.sc === "number" ? Math.round(r.sc * 100) : null;
      const ewDiff = r.ew && Math.abs(r.ew - r.weight) > 1e-3;
      return /* @__PURE__ */ React.createElement("div", { key: r.ix, className: "sc-row " + (r.on ? "" : "sc-row--off"), role: "row", "data-rag": rg }, /* @__PURE__ */ React.createElement("span", { className: "sc-row__num" }, r.num), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "sc-row__chip", style: { background: g.color + "22", color: g.color, borderColor: g.color + "55" } }, r.pillar.split("-")[0])), /* @__PURE__ */ React.createElement("span", { className: "sc-row__name" }, r.name, r.shared && /* @__PURE__ */ React.createElement("span", { className: "sc-row__shared" }, "SHARED")), /* @__PURE__ */ React.createElement("span", { className: "sc-row__weight" }, ewDiff ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "sc-row__weight-orig" }, (r.weight * 100).toFixed(1), "%"), " ", /* @__PURE__ */ React.createElement("span", { className: "sc-row__weight-eff" }, (r.ew * 100).toFixed(1), "%")) : (r.weight * 100).toFixed(1) + "%"), /* @__PURE__ */ React.createElement("span", { className: "sc-row__ytd" }, typeof r.ya === "number" ? r.ya : "\u2014"), /* @__PURE__ */ React.createElement("span", { className: "sc-row__target" }, typeof r.yt === "number" ? r.yt < 10 ? r.yt.toFixed(1) : Math.round(r.yt) : r.yt || "\u2014"), /* @__PURE__ */ React.createElement("span", { className: "sc-row__bar-wrap" }, scorePct != null ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "sc-row__bar" }, /* @__PURE__ */ React.createElement("div", { className: "sc-row__bar-fill", style: { width: scorePct + "%", background: ragColor(rg) } })), /* @__PURE__ */ React.createElement("span", { className: "sc-row__pct" }, scorePct, "%")) : /* @__PURE__ */ React.createElement("span", { style: { color: "var(--color-text-muted)" } }, "N/A")), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "rag rag--" + (rg === "green" ? "green" : rg === "amber" ? "amber" : rg === "red" ? "red" : "na") }, r.rg)));
    })))), /* @__PURE__ */ React.createElement("div", { className: "tt-footer" }, /* @__PURE__ */ React.createElement("span", null, "Site weighted score = \u03A3 (pillar weight \xD7 pillar score). Pillar score = weighted avg of active activities."), /* @__PURE__ */ React.createElement("span", null, "The orange weight on a row means the activity was redistributed because other activities in this pillar are inactive at this site.")));
  }
  function ragColor(rg) {
    return rg === "green" ? "#16a34a" : rg === "amber" ? "#d97706" : rg === "red" ? "#dc2626" : "#94a3b8";
  }
  function InputPanel({ D, S, setS, roles, onMutate }) {
    var _a, _b;
    const TR = window.TR;
    const lockSites = roles.USER_SITES;
    const initialSite = lockSites ? lockSites.includes(S.site) ? S.site : lockSites[0] : S.site || ((_a = D.activeSites) == null ? void 0 : _a[0]) || D.sites[0];
    const [site, setSite] = useState(initialSite);
    const canSave = roles.CAN_SAVE;
    const ML = window.TrackerMonthLock;
    const isClosedMonth = (mi) => !!(ML && !roles.IS_SUPER && ML.isClosed(S.year, mi));
    const anyClosed = canSave && Array.from({ length: 12 }, (_, mi) => isClosedMonth(mi)).some(Boolean);
    const [importing, setImporting] = useState(false);
    const [gridGen, setGridGen] = useState(0);
    const tg = ((_b = D.targets) == null ? void 0 : _b[site]) || [];
    async function importDeptMeetings() {
      if (!window.confirm('Import the real departmental-meeting counts from the Meetings module into the "Monthly Department Meeting" row for ' + site + " / " + S.year + "? This overwrites that row (it stays editable afterward).")) return;
      setImporting(true);
      try {
        const res = await window.TRApi.importDeptMeetings(S.year, site);
        const ai = D.activities.findIndex((a) => /monthly department meeting/i.test(a.name || ""));
        if (ai >= 0 && Array.isArray(res.months)) {
          res.months.forEach((v, mi) => TR.si2(D, S.year, site, ai, mi, v));
          setGridGen((g) => g + 1);
          onMutate();
        }
        window.alert("Imported " + (res.total || 0) + " meeting(s) for " + site + " (" + S.year + ") from the Meetings module.");
      } catch (e) {
        window.alert("Import failed: " + (e.message || ""));
      } finally {
        setImporting(false);
      }
    }
    function exportInputCsv() {
      const yr = S.year, mo = S.month;
      const R = TR.score(D, site, yr, mo);
      const esc = (v) => {
        const s = String(v == null ? "" : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const head = [
        "#",
        "Pillar",
        "Activity",
        "KPI",
        "Shared",
        "Active",
        "Window",
        "Annual target",
        ...MO,
        "Sum Jan-" + MO[mo - 1],
        "Engine YTD (ya)",
        "Engine target (yt)",
        "Score",
        "RAG"
      ];
      const lines = [head.map(esc).join(",")];
      D.activities.forEach((a, ai) => {
        var _a2;
        const t = tg[ai];
        const months = Array.from({ length: 12 }, (_, mi) => TR.gi(D, yr, site, ai, mi));
        let sum = 0;
        for (let m = 0; m < mo; m++) sum += months[m];
        const r = R[ai] || {};
        lines.push([
          a.num,
          a.pillar,
          a.name,
          a.kpi,
          a.shared ? "yes" : "",
          (t == null ? void 0 : t.active) ? "yes" : "no",
          (a.start || 1) + "-" + (a.end || 12),
          (_a2 = t == null ? void 0 : t.target) != null ? _a2 : "",
          ...months,
          Math.round(sum * 100) / 100,
          r.on ? r.ya : "N/A",
          r.on ? r.yt : "N/A",
          typeof r.sc === "number" ? Math.round(r.sc * 100) + "%" : r.sc || "",
          r.rg || ""
        ].map(esc).join(","));
      });
      const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const aEl = document.createElement("a");
      aEl.href = URL.createObjectURL(blob);
      aEl.download = "tracker-input_" + site + "_" + yr + "_" + MO[mo - 1] + ".csv";
      aEl.click();
      setTimeout(() => URL.revokeObjectURL(aEl.href), 1e3);
    }
    function setCell(ai, mi, raw) {
      const a = D.activities[ai];
      let v;
      if (a.kpi === "BOOLEAN") {
        v = raw === "1" || raw === 1 ? 1 : raw === "0.5" || raw === 0.5 ? 0.5 : 0;
      } else {
        v = parseFloat(raw) || 0;
      }
      TR.si2(D, S.year, site, ai, mi, v);
      onMutate();
    }
    return /* @__PURE__ */ React.createElement("div", { className: "tt-panel" }, /* @__PURE__ */ React.createElement("div", { className: "dash-eyebrow" }, "Monthly input \xB7 ", MO[S.month - 1], " ", S.year), !canSave && /* @__PURE__ */ React.createElement("div", { className: "tt-banner tt-banner--warn" }, /* @__PURE__ */ React.createElement("b", null, "\u{1F441} View-only"), " \u2014 your role cannot edit actuals. Ask an admin for the", /* @__PURE__ */ React.createElement("code", null, " tracker-editor "), " (own site) or ", /* @__PURE__ */ React.createElement("code", null, " tracker-admin "), " (all sites) feature role."), anyClosed && /* @__PURE__ */ React.createElement("div", { className: "tt-banner tt-banner--warn" }, /* @__PURE__ */ React.createElement("b", null, "\u{1F512} Closed months"), " \u2014 past months are read-only (the previous month stays editable until the", ML.GRACE_DAY, "th of the current month). Only a ", /* @__PURE__ */ React.createElement("code", null, "super_admin"), " can correct a closed month."), /* @__PURE__ */ React.createElement("div", { className: "ip-toolbar" }, /* @__PURE__ */ React.createElement(SitePicker, { D, value: site, onChange: setSite, lockSites }), canSave && /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "tt-btn tt-btn--ghost",
        disabled: importing,
        onClick: importDeptMeetings,
        title: "Pull the real departmental-meeting counts from the Meetings module into the Monthly Department Meeting row (still editable after)",
        style: { whiteSpace: "nowrap" }
      },
      importing ? "\u23F3 Importing\u2026" : "\u2B07 Import dept meetings"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "tt-btn tt-btn--ghost",
        onClick: exportInputCsv,
        title: "Export this site's 12-month input matrix as CSV, with the engine's YTD / target / score per row for cross-checking",
        style: { whiteSpace: "nowrap" }
      },
      "\u2B07 Export CSV"
    ), /* @__PURE__ */ React.createElement("span", { className: "ip-legend" }, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--tracker-p3)" } }, "BOOLEAN:"), " 0 = Not Started \xB7 0.5 = In Progress \xB7 1 = Done", "  \xB7  ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--tracker-p4)" } }, "COUNT / PERCENT / MILESTONE / CURRENCY / RATING:"), " actual value")), /* @__PURE__ */ React.createElement("div", { className: "ip-grid" }, /* @__PURE__ */ React.createElement("div", { className: "ip-grid__head", role: "row" }, /* @__PURE__ */ React.createElement("span", null, "#"), /* @__PURE__ */ React.createElement("span", null, "Activity"), /* @__PURE__ */ React.createElement("span", null, "KPI"), MO.map((m, i) => /* @__PURE__ */ React.createElement("span", { key: m, className: "ip-grid__month " + (i + 1 === S.month ? "is-current" : i + 1 > S.month ? "is-future" : "") }, m))), D.activities.map((a, ai) => {
      const t = tg[ai];
      const isInactive = !(t == null ? void 0 : t.active);
      return /* @__PURE__ */ React.createElement("div", { key: a.id || ai, className: "ip-grid__row " + (isInactive ? "is-inactive" : ""), role: "row", "data-pillar": a.pillar.split("-")[0] }, /* @__PURE__ */ React.createElement("span", { className: "ip-grid__num" }, a.num), /* @__PURE__ */ React.createElement("span", { className: "ip-grid__name" }, /* @__PURE__ */ React.createElement("span", { className: "ip-grid__pillar-chip", style: { background: TR.gPC(D, a.pillar) } }, a.pillar.split("-")[0]), a.name, a.shared && /* @__PURE__ */ React.createElement("span", { className: "ip-grid__shared" }, "SHARED"), isInactive && /* @__PURE__ */ React.createElement("span", { className: "ip-grid__inactive-tag" }, "INACTIVE")), /* @__PURE__ */ React.createElement("span", { className: "ip-grid__kpi" }, a.kpi), Array.from({ length: 12 }, (_, mi) => {
        const v = TR.gi(D, S.year, site, ai, mi);
        const isCurrent = mi + 1 === S.month;
        const isFuture = mi + 1 > S.month;
        const closed = isClosedMonth(mi);
        const cellCls = "ip-cell" + (v > 0 ? v === 0.5 ? " ip-cell--half" : " ip-cell--has" : "") + (isCurrent ? " ip-cell--current" : "") + (isFuture ? " ip-cell--future" : "") + (closed ? " ip-cell--closed" : "");
        const closedTitle = closed ? "Closed month \u2014 only a super_admin can change it" : void 0;
        if (a.kpi === "BOOLEAN") {
          return /* @__PURE__ */ React.createElement(
            "select",
            {
              key: mi,
              className: cellCls,
              value: String(v),
              onChange: (e) => setCell(ai, mi, e.target.value),
              disabled: !canSave || isInactive || closed,
              title: closedTitle
            },
            /* @__PURE__ */ React.createElement("option", { value: "0" }, "\xB7"),
            /* @__PURE__ */ React.createElement("option", { value: "0.5" }, "\xBD"),
            /* @__PURE__ */ React.createElement("option", { value: "1" }, "\u25CF")
          );
        }
        return /* @__PURE__ */ React.createElement(
          "input",
          {
            key: S.year + ":" + site + ":" + gridGen + ":" + mi,
            className: cellCls,
            type: "number",
            step: "any",
            min: "0",
            defaultValue: v,
            onChange: (e) => setCell(ai, mi, e.target.value),
            disabled: !canSave || isInactive || closed,
            title: closedTitle
          }
        );
      }));
    })), /* @__PURE__ */ React.createElement("div", { className: "tt-footer" }, /* @__PURE__ */ React.createElement("span", null, "Auto-saves to the database 0.8 s after the last edit. Watch the indicator in the toolbar."), /* @__PURE__ */ React.createElement("span", null, "Inactive rows (greyed out) are turned off for this site in ", /* @__PURE__ */ React.createElement("a", { href: "#", onClick: (e) => {
      e.preventDefault();
      setS((s) => ({ ...s, view: "targets" }));
    } }, "Targets"), ".")));
  }
  function HeatmapPanel({ D, S }) {
    var _a, _b;
    const TR = window.TR;
    const aS = D.activeSites || [];
    const pillars = TR.gP(D);
    const [hovered, setHovered] = useState(null);
    const cells = useMemo(() => {
      const m = {};
      aS.forEach((s) => {
        m[s] = {};
        TR.score(D, s, S.year, S.month).forEach((r) => {
          if (r.on && typeof r.sc === "number") {
            m[s][r.ix] = { score: Math.round(r.sc * 100), rag: String(r.rg).toLowerCase() };
          }
        });
      });
      return m;
    }, [D, aS.join("|"), S.year, S.month]);
    return /* @__PURE__ */ React.createElement("div", { className: "tt-panel" }, /* @__PURE__ */ React.createElement("div", { className: "hm-hero" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "dash-eyebrow" }, "Heatmap \xB7 ", MO[S.month - 1], " ", S.year), /* @__PURE__ */ React.createElement("h2", { className: "hm-hero__title" }, "RAG matrix \xB7 ", aS.length, " active sites \xD7 ", D.activities.length, " activities"), /* @__PURE__ */ React.createElement("p", { className: "hm-hero__lede" }, "Rows = sites, columns = activities (grouped by pillar). Cell colour reflects the RAG threshold; numbers inside are the score %. Hover any cell to see the activity name.")), /* @__PURE__ */ React.createElement("div", { className: "hm-legend" }, /* @__PURE__ */ React.createElement("span", { className: "hm-legend__item" }, /* @__PURE__ */ React.createElement("span", { className: "hm-cell hm-cell--green hm-cell--legend" }, "\u2265 80"), " On target"), /* @__PURE__ */ React.createElement("span", { className: "hm-legend__item" }, /* @__PURE__ */ React.createElement("span", { className: "hm-cell hm-cell--amber hm-cell--legend" }, "50\u201379"), " At risk"), /* @__PURE__ */ React.createElement("span", { className: "hm-legend__item" }, /* @__PURE__ */ React.createElement("span", { className: "hm-cell hm-cell--red hm-cell--legend" }, "< 50"), " Off track"))), /* @__PURE__ */ React.createElement("div", { className: "hm-scroll" }, /* @__PURE__ */ React.createElement("div", { className: "hm-grid", style: { "--col-count": D.activities.length } }, /* @__PURE__ */ React.createElement("div", { className: "hm-grid__pillar-row" }, /* @__PURE__ */ React.createElement("div", { className: "hm-grid__corner" }, "Pillar \u2192"), pillars.map((p) => {
      const span = D.activities.filter((a) => a.pillar === p).length;
      return /* @__PURE__ */ React.createElement("div", { key: p, className: "hm-grid__pillar-cell", style: { background: TR.gPC(D, p), gridColumn: "span " + span } }, /* @__PURE__ */ React.createElement("strong", null, p.split("-")[0]), " ", /* @__PURE__ */ React.createElement("span", null, TR.gPS(p)));
    })), /* @__PURE__ */ React.createElement("div", { className: "hm-grid__act-row" }, /* @__PURE__ */ React.createElement("div", { className: "hm-grid__corner" }, "Site / Activity"), D.activities.map((a) => /* @__PURE__ */ React.createElement(
      "div",
      {
        key: a.id || a.num,
        className: "hm-grid__act-cell " + (hovered === a.num ? "is-hovered" : ""),
        onMouseEnter: () => setHovered(a.num),
        onMouseLeave: () => setHovered(null),
        title: "#" + a.num + " \u2014 " + a.name
      },
      a.num
    ))), aS.map((site) => /* @__PURE__ */ React.createElement("div", { key: site, className: "hm-grid__site-row" }, /* @__PURE__ */ React.createElement("div", { className: "hm-grid__site-cell" }, /* @__PURE__ */ React.createElement("span", { className: "hm-site-code", style: { background: D.siteColors[site] } }, site), /* @__PURE__ */ React.createElement("span", { className: "hm-site-name" }, D.siteNames[site] || site)), D.activities.map((a, ix) => {
      var _a2;
      const c = (_a2 = cells[site]) == null ? void 0 : _a2[ix];
      if (!c) return /* @__PURE__ */ React.createElement("div", { key: a.id || a.num, className: "hm-cell hm-cell--na", title: site + " \xB7 " + a.name + " \xB7 inactive" }, "\u2014");
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: a.id || a.num,
          className: "hm-cell hm-cell--" + c.rag + (hovered === a.num ? " is-hovered" : ""),
          onMouseEnter: () => setHovered(a.num),
          onMouseLeave: () => setHovered(null),
          title: site + " \xB7 #" + a.num + " " + a.name + " \xB7 " + c.score + "% \xB7 " + c.rag.toUpperCase()
        },
        c.score
      );
    }))))), hovered != null && /* @__PURE__ */ React.createElement("div", { className: "hm-hover-banner" }, /* @__PURE__ */ React.createElement("strong", null, "#", hovered), " \xB7 ", (_a = D.activities.find((a) => a.num === hovered)) == null ? void 0 : _a.name, " \xB7 ", /* @__PURE__ */ React.createElement("small", null, "Pillar ", (_b = D.activities.find((a) => a.num === hovered)) == null ? void 0 : _b.pillar.split("-")[0])));
  }
  function Modal({ title, children, onCancel, onConfirm, confirmLabel, confirmKind, confirmDisabled, wide }) {
    useEffect(() => {
      const onKey = (e) => {
        if (e.key === "Escape") onCancel();
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [onCancel]);
    return /* @__PURE__ */ React.createElement("div", { className: "tt-modal-overlay", onClick: onCancel }, /* @__PURE__ */ React.createElement("div", { className: "tt-modal " + (wide ? "tt-modal--wide" : ""), onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("header", { className: "tt-modal__head" }, /* @__PURE__ */ React.createElement("h3", null, title), /* @__PURE__ */ React.createElement("button", { type: "button", className: "tt-modal__close", onClick: onCancel, "aria-label": "Close" }, "\xD7")), /* @__PURE__ */ React.createElement("div", { className: "tt-modal__body" }, children), /* @__PURE__ */ React.createElement("footer", { className: "tt-modal__foot" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn-ghost", onClick: onCancel }, "Cancel"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn-" + (confirmKind || "primary"), onClick: onConfirm, disabled: confirmDisabled }, confirmLabel || "Confirm"))));
  }
  function RedistributeModal({ kind, target, items, cascadeWarning, onCancel, onConfirm }) {
    const [strategy, setStrategy] = useState("proportional");
    const proportionalNew = useMemo(() => {
      if (items.length === 0) return {};
      const remaining = items.reduce((s, x) => s + (x.weight || 0), 0);
      const out = {};
      items.forEach((x) => {
        const share = remaining > 0 ? target.weight * (x.weight || 0) / remaining : target.weight / items.length;
        out[x.key] = (x.weight || 0) + share;
      });
      return out;
    }, [items, target]);
    const equalNew = useMemo(() => {
      if (items.length === 0) return {};
      const share = target.weight / items.length;
      const out = {};
      items.forEach((x) => {
        out[x.key] = (x.weight || 0) + share;
      });
      return out;
    }, [items, target]);
    const [customWeights, setCustomWeights] = useState(proportionalNew);
    useEffect(() => {
      if (strategy === "custom") setCustomWeights(proportionalNew);
    }, [strategy, proportionalNew]);
    const preview = items.map((x) => {
      let nw;
      if (strategy === "proportional") nw = proportionalNew[x.key];
      else if (strategy === "equal") nw = equalNew[x.key];
      else nw = customWeights[x.key] || 0;
      return { ...x, newWeight: nw };
    });
    const total = preview.reduce((s, x) => s + x.newWeight, 0);
    const totalOk = Math.abs(total - 1) < 5e-3;
    const showTotalCheck = items.length > 0;
    return /* @__PURE__ */ React.createElement(
      Modal,
      {
        title: `Delete ${kind}: ${target.name}`,
        onCancel,
        onConfirm: () => onConfirm(preview),
        confirmLabel: "Delete & redistribute",
        confirmKind: "danger",
        confirmDisabled: items.length === 0 ? false : !totalOk,
        wide: true
      },
      /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 14px", fontSize: 13, lineHeight: 1.5 } }, /* @__PURE__ */ React.createElement("b", null, target.name), " currently holds ", /* @__PURE__ */ React.createElement("b", null, Math.round(target.weight * 100), "%"), " of the", " ", kind === "pillar" ? "overall pillar allocation" : `weight inside ${target.parentName || "its pillar"}`, ".", items.length === 0 ? /* @__PURE__ */ React.createElement(React.Fragment, null, " No other ", kind, "s remain \u2014 the deletion will simply remove this entry. The overall total stays at ", /* @__PURE__ */ React.createElement("b", null, Math.round((1 - target.weight) * 100), "%"), "; you'll need to add another ", kind, " to bring it back to 100%.") : /* @__PURE__ */ React.createElement(React.Fragment, null, " Choose how to redistribute the ", Math.round(target.weight * 100), "% among the ", items.length, " remaining ", kind, items.length === 1 ? "" : "s", ".")),
      cascadeWarning && /* @__PURE__ */ React.createElement("div", { className: "tt-cascade-warning" }, "\u26A0 ", cascadeWarning),
      items.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "tt-redistrib-options" }, /* @__PURE__ */ React.createElement("label", { className: "tt-redistrib-option" }, /* @__PURE__ */ React.createElement("input", { type: "radio", name: "strategy", checked: strategy === "proportional", onChange: () => setStrategy("proportional") }), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", null, "Proportional"), /* @__PURE__ */ React.createElement("small", null, "Split by each remaining ", kind, "'s existing relative weight \u2014 preserves the current balance."))), /* @__PURE__ */ React.createElement("label", { className: "tt-redistrib-option" }, /* @__PURE__ */ React.createElement("input", { type: "radio", name: "strategy", checked: strategy === "equal", onChange: () => setStrategy("equal") }), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", null, "Equal"), /* @__PURE__ */ React.createElement("small", null, "Divide the ", Math.round(target.weight * 100), "% evenly across all remaining ", kind, "s."))), /* @__PURE__ */ React.createElement("label", { className: "tt-redistrib-option" }, /* @__PURE__ */ React.createElement("input", { type: "radio", name: "strategy", checked: strategy === "custom", onChange: () => setStrategy("custom") }), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", null, "Custom"), /* @__PURE__ */ React.createElement("small", null, "Edit each weight manually \u2014 must total 100% to confirm.")))), /* @__PURE__ */ React.createElement("div", { className: "tt-redistrib-preview" }, /* @__PURE__ */ React.createElement("div", { className: "tt-redistrib-preview__head" }, /* @__PURE__ */ React.createElement("span", null, kind === "pillar" ? "Pillar" : "Activity"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right" } }, "Was"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "center" } }, "\u2192"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right" } }, "Will become")), preview.map((x) => /* @__PURE__ */ React.createElement("div", { key: x.key, className: "tt-redistrib-preview__row" }, /* @__PURE__ */ React.createElement("span", { className: "tt-redistrib-preview__name" }, x.color && /* @__PURE__ */ React.createElement("span", { className: "tt-redistrib-preview__chip", style: { background: x.color } }), x.name), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" } }, Math.round(x.weight * 100), "%"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "center", color: "var(--color-text-muted)" } }, "\u2192"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right" } }, strategy === "custom" ? /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "number",
          min: "0",
          max: "100",
          step: "1",
          className: "tt-redistrib-input",
          value: Math.round((customWeights[x.key] || 0) * 100),
          onChange: (e) => setCustomWeights((c) => ({ ...c, [x.key]: (parseFloat(e.target.value) || 0) / 100 }))
        }
      ) : /* @__PURE__ */ React.createElement("b", null, Math.round(x.newWeight * 100), "%")))), /* @__PURE__ */ React.createElement("div", { className: "tt-redistrib-total " + (showTotalCheck ? totalOk ? "is-ok" : "is-fail" : "") }, "Total: ", Math.round(total * 100), "%", !totalOk && /* @__PURE__ */ React.createElement("span", null, " \xB7 must equal 100%"), totalOk && /* @__PURE__ */ React.createElement("span", null, " \u2713"))))
    );
  }
  const KPI_TYPES = ["BOOLEAN", "PERCENT", "MILESTONE", "CURRENCY", "RATING", "COUNT"];
  function SetupPanel({ D, S, roles, onMutate, onAddYear }) {
    var _a;
    const TR = window.TR;
    const canEdit = roles.CAN_SAVE_ALL;
    const [modal, setModal] = useState(null);
    const pillars = TR.gP(D);
    const pillarTotal = pillars.reduce((s, p) => {
      var _a2;
      return s + (((_a2 = D.pillarWeights) == null ? void 0 : _a2[p]) || 0);
    }, 0);
    const pillarTotalOk = Math.abs(pillarTotal - 1) < 5e-3;
    function setPillarWeight(pillar, pct) {
      if (!D.pillarWeights) D.pillarWeights = {};
      D.pillarWeights[pillar] = Math.max(0, Math.min(100, pct)) / 100;
      onMutate();
    }
    function renamePillar(oldKey, newKey) {
      if (!newKey || newKey === oldKey) return;
      if (D.pillarWeights[newKey] != null) {
        alert("Pillar code already exists.");
        return;
      }
      D.pillarWeights[newKey] = D.pillarWeights[oldKey] || 0;
      delete D.pillarWeights[oldKey];
      D.activities.forEach((a) => {
        if (a.pillar === oldKey) a.pillar = newKey;
      });
      onMutate();
    }
    async function startDeleteYear(y) {
      let preview;
      try {
        preview = await window.TRApi.previewDeleteYear(y);
      } catch (e) {
        alert("Could not prepare delete: " + ((e == null ? void 0 : e.message) || e));
        return;
      }
      const otherYearRows = (preview.other_years_untouched || []).map((r) => r.year + " (" + r.c + " rows)").join(", ") || "none";
      const isCurrentlySelected = y === S.year;
      setModal({
        type: "confirm",
        title: "Delete year " + y + "?",
        kind: "year",
        body: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: {
          background: "#FEF2F2",
          border: "1px solid #FECACA",
          borderRadius: 8,
          padding: "12px 14px",
          marginBottom: 14,
          color: "#991B1B",
          fontSize: 13,
          lineHeight: 1.5
        } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, marginBottom: 6, color: "#7F1D1D" } }, "\u26A0 This action is permanent and cannot be undone."), "All monthly input values entered for ", y, " across every site and activity will be deleted from the database immediately."), /* @__PURE__ */ React.createElement("h4", { style: { margin: "0 0 6px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--color-text-muted)" } }, "What gets deleted"), /* @__PURE__ */ React.createElement("ul", { style: { marginTop: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.55, color: "var(--color-text)" } }, /* @__PURE__ */ React.createElement("li", null, "The year ", /* @__PURE__ */ React.createElement("b", null, y), " entry in the Year dropdown"), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("b", null, preview.inputs_will_be_deleted), " rows of monthly input data for ", y, " (all sites \xD7 activities)")), /* @__PURE__ */ React.createElement("h4", { style: { margin: "14px 0 6px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".5px", color: "#0F766E" } }, "What is preserved"), /* @__PURE__ */ React.createElement("ul", { style: { marginTop: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.55, color: "var(--color-text)" } }, /* @__PURE__ */ React.createElement("li", null, "Other years' data \u2014 untouched: ", /* @__PURE__ */ React.createElement("code", null, otherYearRows)), /* @__PURE__ */ React.createElement("li", null, "Targets (per site \xD7 activity \u2014 shared across all years)"), /* @__PURE__ */ React.createElement("li", null, "Pillar weights, active sites, activities list")), /* @__PURE__ */ React.createElement("div", { style: {
          marginTop: 14,
          padding: "10px 12px",
          background: "#F4F5F7",
          borderRadius: 6,
          fontSize: 12.5,
          color: "var(--color-text)",
          lineHeight: 1.5
        } }, "After deletion, the years dropdown will show:\xA0", /* @__PURE__ */ React.createElement("b", null, preview.years_after.join(", ") || "(none \u2014 cannot proceed)")), /* @__PURE__ */ React.createElement("div", { style: {
          marginTop: 10,
          padding: "10px 12px",
          background: "#ECFDF5",
          border: "1px solid #A7F3D0",
          borderRadius: 6,
          fontSize: 12.5,
          color: "#065F46",
          lineHeight: 1.5
        } }, "\u{1F6DF} A full database backup will be created automatically ", /* @__PURE__ */ React.createElement("em", null, "before"), " the delete runs. If anything goes wrong, the backup file path is shown on success so you can restore. Backups are saved to\xA0", /* @__PURE__ */ React.createElement("code", null, "data/backups/tracker-YYYYMMDD-HHMMSS-pre-delete-year-", y, ".db"), "on the server.", /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("small", { style: { color: "#047857" } }, "Recovery instructions: ", /* @__PURE__ */ React.createElement("code", null, "docs/DB_RECOVERY.md"), " \xB7 interactive helper: ", /* @__PURE__ */ React.createElement("code", null, "_restore_db.cmd"))), isCurrentlySelected && /* @__PURE__ */ React.createElement("div", { style: {
          marginTop: 12,
          padding: "10px 12px",
          background: "#FFF7ED",
          border: "1px solid #FED7AA",
          borderRadius: 6,
          fontSize: 12.5,
          color: "#9A3412"
        } }, "\u26A0 ", y, " is the year currently selected in the toolbar \u2014 after deletion, the view will jump to ", preview.years_after[preview.years_after.length - 1] || "no year", "."), preview.would_leave_zero_years && /* @__PURE__ */ React.createElement("div", { style: {
          marginTop: 12,
          padding: "10px 12px",
          background: "#FEF2F2",
          border: "1px solid #FECACA",
          borderRadius: 6,
          fontSize: 12.5,
          color: "#991B1B",
          fontWeight: 600
        } }, "\u26D4 Cannot proceed \u2014 at least one year must remain in the tracker. Add a different year first, then delete ", y, ".")),
        confirmLabel: "Delete " + y,
        confirmKind: "danger",
        confirmDisabled: !!preview.would_leave_zero_years,
        onConfirm: async () => {
          var _a2;
          try {
            const resp = await window.TRApi.deleteYear(y);
            const backupPath = ((_a2 = resp == null ? void 0 : resp.summary) == null ? void 0 : _a2.backup_path) || "(see pm2 logs)";
            console.log("[Tracker] year", y, "deleted. Backup saved at:", backupPath);
            setModal(null);
            alert(
              "\u2713 Year " + y + " deleted.\n\nDatabase backup created BEFORE the delete:\n" + backupPath + "\n\nIf you need to restore, copy that file back to data/tracker.db on the server and reload the page."
            );
            window.location.reload();
          } catch (e) {
            alert("Delete failed: " + ((e == null ? void 0 : e.message) || e));
          }
        }
      });
    }
    function startAddPillar() {
      setModal({
        type: "confirm",
        title: "Add new pillar",
        kind: "pillar",
        body: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", null, "Add a new pillar to the tracker?"), /* @__PURE__ */ React.createElement("ul", { style: { marginTop: 8, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5, color: "var(--color-text)" } }, /* @__PURE__ */ React.createElement("li", null, "It will start with ", /* @__PURE__ */ React.createElement("b", null, "0% weight"), " \u2014 you'll need to redistribute from existing pillars to bring the total above 100%."), /* @__PURE__ */ React.createElement("li", null, "The default code is ", /* @__PURE__ */ React.createElement("code", null, "P", pillars.length + 1, "-New Pillar"), " \u2014 you can rename it inline after creation."), /* @__PURE__ */ React.createElement("li", null, "It will have ", /* @__PURE__ */ React.createElement("b", null, "no activities"), " until you add some from the Activities section below."), /* @__PURE__ */ React.createElement("li", null, "Auto-saves to the database 0.8 s after confirmation."))),
        confirmLabel: "Add pillar",
        confirmKind: "primary",
        onConfirm: () => {
          let n = pillars.length + 1;
          while (D.pillarWeights[`P${n}-New Pillar`] != null) n++;
          const key = `P${n}-New Pillar`;
          D.pillarWeights[key] = 0;
          setModal(null);
          onMutate();
        }
      });
    }
    function startDeletePillar(pillar) {
      const remaining = pillars.filter((p) => p !== pillar).map((p) => ({
        key: p,
        name: TR.gPS(p),
        weight: D.pillarWeights[p] || 0,
        color: TR.gPC(D, p)
      }));
      const childActivityCount = D.activities.filter((a) => a.pillar === pillar).length;
      setModal({
        type: "redistribute",
        kind: "pillar",
        target: { key: pillar, name: TR.gPS(pillar), weight: D.pillarWeights[pillar] || 0 },
        items: remaining,
        cascadeWarning: childActivityCount > 0 ? `Heads up \u2014 deleting ${TR.gPS(pillar)} also removes its ${childActivityCount} activit${childActivityCount === 1 ? "y" : "ies"} from every site. Historical input data for those activities is dropped. This cannot be undone.` : null,
        onConfirm: (newItems) => {
          newItems.forEach((it) => {
            D.pillarWeights[it.key] = it.newWeight;
          });
          delete D.pillarWeights[pillar];
          const removeIxs = D.activities.map((a, i) => a.pillar === pillar ? i : -1).filter((i) => i >= 0).sort((a, b) => b - a);
          removeIxs.forEach((ix) => {
            D.activities.splice(ix, 1);
            D.sites.forEach((s) => {
              if (Array.isArray(D.targets[s])) D.targets[s].splice(ix, 1);
            });
            Object.values(D.inputs || {}).forEach((siteMap) => {
              Object.values(siteMap).forEach((arr) => {
                if (Array.isArray(arr)) arr.splice(ix, 1);
              });
            });
          });
          setModal(null);
          onMutate();
        }
      });
    }
    function setActivityField(ix, field, value) {
      const a = D.activities[ix];
      if (!a) return;
      if (field === "weight") a.weight = Math.max(0, Math.min(100, parseFloat(value) || 0)) / 100;
      else if (field === "start" || field === "end") a.start = field === "start" ? parseInt(value) : a.start, a.end = field === "end" ? parseInt(value) : a.end;
      else if (field === "shared") a.shared = !!value;
      else a[field] = value;
      onMutate();
    }
    function startAddActivity(pillar) {
      const pillarName = TR.gPS(pillar);
      const siblingCount = D.activities.filter((a) => a.pillar === pillar).length;
      setModal({
        type: "confirm",
        title: "Add new activity",
        kind: "activity",
        body: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", null, "Add a new activity to ", /* @__PURE__ */ React.createElement("b", null, pillarName), "?"), /* @__PURE__ */ React.createElement("ul", { style: { marginTop: 8, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5, color: "var(--color-text)" } }, /* @__PURE__ */ React.createElement("li", null, "Default name ", /* @__PURE__ */ React.createElement("b", null, '"New activity"'), " \u2014 rename it inline after creation."), /* @__PURE__ */ React.createElement("li", null, "Default KPI ", /* @__PURE__ */ React.createElement("b", null, "COUNT"), ", weight ", /* @__PURE__ */ React.createElement("b", null, "0%"), ", window ", /* @__PURE__ */ React.createElement("b", null, "Jan \u2192 Dec"), ", not shared."), /* @__PURE__ */ React.createElement("li", null, "Created ", /* @__PURE__ */ React.createElement("b", null, "INACTIVE"), " on every site (toggle it on per site in the Targets tab once configured)."), siblingCount > 0 && /* @__PURE__ */ React.createElement("li", null, pillarName, " currently has ", siblingCount, " activit", siblingCount === 1 ? "y" : "ies", ". The new one starts at 0% so the pillar total stays at the current value \u2014 bump it up by redistributing from siblings."), /* @__PURE__ */ React.createElement("li", null, "Auto-saves to the database 0.8 s after confirmation."))),
        confirmLabel: "Add activity",
        confirmKind: "primary",
        onConfirm: () => {
          const maxNum = D.activities.reduce((m, a) => Math.max(m, a.num || 0), 0);
          const newAct = {
            id: maxNum + 1,
            num: maxNum + 1,
            pillar,
            name: "New activity",
            kpi: "COUNT",
            weight: 0,
            start: 1,
            end: 12,
            shared: false
          };
          D.activities.push(newAct);
          D.sites.forEach((s) => {
            if (!D.targets[s]) D.targets[s] = [];
            D.targets[s].push({ target: 0, active: false });
          });
          setModal(null);
          onMutate();
        }
      });
    }
    function startDeleteActivity(ix) {
      const a = D.activities[ix];
      if (!a) return;
      const siblings = D.activities.map((x, i) => ({ x, i })).filter(({ x, i }) => x.pillar === a.pillar && i !== ix);
      let inputCells = 0;
      Object.values(D.inputs || {}).forEach((siteMap) => {
        Object.values(siteMap).forEach((arr) => {
          if (Array.isArray(arr[ix])) inputCells += arr[ix].filter((v) => v > 0).length;
        });
      });
      setModal({
        type: "redistribute",
        kind: "activity",
        target: { key: ix, name: a.name, weight: a.weight || 0, parentName: TR.gPS(a.pillar) },
        items: siblings.map(({ x, i }) => ({
          key: i,
          name: x.name,
          weight: x.weight || 0,
          color: TR.gPC(D, x.pillar)
        })),
        cascadeWarning: inputCells > 0 ? `Heads up \u2014 this activity has ${inputCells} non-zero monthly input value${inputCells === 1 ? "" : "s"} recorded across sites and years. Deleting it removes that data. This cannot be undone.` : null,
        onConfirm: (newItems) => {
          newItems.forEach((it) => {
            D.activities[it.key].weight = it.newWeight;
          });
          const removedIx = ix;
          D.activities.splice(removedIx, 1);
          D.sites.forEach((s) => {
            if (Array.isArray(D.targets[s])) D.targets[s].splice(removedIx, 1);
          });
          Object.values(D.inputs || {}).forEach((siteMap) => {
            Object.values(siteMap).forEach((arr) => {
              if (Array.isArray(arr)) arr.splice(removedIx, 1);
            });
          });
          setModal(null);
          onMutate();
        }
      });
    }
    function startToggleSite(code) {
      if (!D.activeSites) D.activeSites = [];
      const isActive = D.activeSites.includes(code);
      const siteName = D.siteNames[code] || code;
      setModal({
        type: "confirm",
        title: (isActive ? "Deactivate " : "Activate ") + siteName,
        kind: "toggle-site",
        confirmKind: isActive ? "danger" : "primary",
        confirmLabel: isActive ? "Deactivate site" : "Activate site",
        body: isActive ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("b", null, siteName), " (", /* @__PURE__ */ React.createElement("code", null, code), ") will be removed from the active tracker scope."), /* @__PURE__ */ React.createElement("ul", { style: { marginTop: 8, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55, color: "var(--color-text)" } }, /* @__PURE__ */ React.createElement("li", null, "It disappears from the ", /* @__PURE__ */ React.createElement("b", null, "Dashboard"), ", ", /* @__PURE__ */ React.createElement("b", null, "leaderboard"), ", ", /* @__PURE__ */ React.createElement("b", null, "Scoring"), ", ", /* @__PURE__ */ React.createElement("b", null, "Heatmap"), " and charts."), /* @__PURE__ */ React.createElement("li", null, "It contributes ", /* @__PURE__ */ React.createElement("b", null, "nothing to the fleet score"), " while inactive."), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("b", null, "Existing input data is preserved"), " in the database \u2014 you can toggle the site back on at any time to restore everything."), /* @__PURE__ */ React.createElement("li", null, "Auto-saves to the database 0.8 s after confirmation."))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("b", null, siteName), " (", /* @__PURE__ */ React.createElement("code", null, code), ") will start contributing to the tracker."), /* @__PURE__ */ React.createElement("ul", { style: { marginTop: 8, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55, color: "var(--color-text)" } }, /* @__PURE__ */ React.createElement("li", null, "It joins the ", /* @__PURE__ */ React.createElement("b", null, "Dashboard"), ", ", /* @__PURE__ */ React.createElement("b", null, "leaderboard"), ", ", /* @__PURE__ */ React.createElement("b", null, "Scoring"), ", ", /* @__PURE__ */ React.createElement("b", null, "Heatmap"), " and charts."), /* @__PURE__ */ React.createElement("li", null, "Any historical input data already in the database for ", code, " ", /* @__PURE__ */ React.createElement("b", null, "starts scoring immediately"), "."), /* @__PURE__ */ React.createElement("li", null, "Make sure ", /* @__PURE__ */ React.createElement("b", null, "targets are set"), " for the activities you want to score (Targets tab)."), /* @__PURE__ */ React.createElement("li", null, "Auto-saves to the database 0.8 s after confirmation."))),
        onConfirm: () => {
          if (isActive) D.activeSites = D.activeSites.filter((s) => s !== code);
          else D.activeSites = [...D.activeSites, code];
          setModal(null);
          onMutate();
        }
      });
    }
    const byPillar = pillars.map((p) => {
      var _a2;
      return {
        pillar: p,
        color: TR.gPC(D, p),
        name: TR.gPS(p),
        weightPct: Math.round((((_a2 = D.pillarWeights) == null ? void 0 : _a2[p]) || 0) * 100),
        rows: D.activities.map((a, i) => ({ a, i })).filter(({ a }) => a.pillar === p)
      };
    });
    const perYear = !!D.perYearEnabled;
    const prevYearWithData = perYear ? (D.years || []).filter((y) => {
      var _a2, _b, _c;
      return y < S.year && ((_c = (_b = (_a2 = D.byYear) == null ? void 0 : _a2[y]) == null ? void 0 : _b.activities) == null ? void 0 : _c.length) > 0;
    }).pop() : null;
    const yearIsEmpty = perYear && (!((_a = D.byYear) == null ? void 0 : _a[S.year]) || (D.byYear[S.year].activities || []).length === 0);
    function copyFromPreviousYear() {
      if (!prevYearWithData || !D.byYear) return;
      const src = D.byYear[prevYearWithData];
      D.byYear[S.year] = JSON.parse(JSON.stringify(src));
      if (!D.inputs) D.inputs = {};
      if (!D.inputs[S.year]) D.inputs[S.year] = {};
      D.sites.forEach((s) => {
        D.inputs[S.year][s] = D.byYear[S.year].activities.map(() => new Array(12).fill(0));
      });
      onMutate();
    }
    return /* @__PURE__ */ React.createElement("div", { className: "tt-panel" }, /* @__PURE__ */ React.createElement("div", { className: "setup-eyebrow" }, "Setup \xB7 ", D.activities.length, " activities \xB7 ", pillars.length, " pillars \xB7 ", D.activeSites.length, " of ", D.sites.length, " sites active"), perYear && /* @__PURE__ */ React.createElement("div", { className: "tt-banner", style: { background: "#EFF6FF", border: "1px solid #93C5FD", color: "#1E40AF" } }, /* @__PURE__ */ React.createElement("b", null, "\u{1F4C5} Editing year ", S.year), " \u2014 pillars, activities and targets below apply to ", /* @__PURE__ */ React.createElement("b", null, S.year, " only"), ". Switch years via the toolbar Year dropdown.", yearIsEmpty && prevYearWithData && canEdit && /* @__PURE__ */ React.createElement("button", { className: "btn-primary", type: "button", onClick: copyFromPreviousYear, style: { marginLeft: 12 } }, "\u29C9 Copy structure from ", prevYearWithData), yearIsEmpty && !prevYearWithData && /* @__PURE__ */ React.createElement("span", { style: { marginLeft: 8 } }, "This year is empty \u2014 add pillars and activities below.")), !canEdit && /* @__PURE__ */ React.createElement("div", { className: "tt-banner tt-banner--warn" }, /* @__PURE__ */ React.createElement("b", null, "\u{1F441} View-only"), " \u2014 Setup changes require the ", /* @__PURE__ */ React.createElement("code", null, "tracker-admin"), " or ", /* @__PURE__ */ React.createElement("code", null, "super_admin"), " role. You can browse the configuration here but every input is disabled."), /* @__PURE__ */ React.createElement("section", { className: "setup-section" }, /* @__PURE__ */ React.createElement("div", { className: "setup-section__head" }, /* @__PURE__ */ React.createElement("h3", null, "1 \xB7 Years"), /* @__PURE__ */ React.createElement("small", null, perYear ? 'Reporting years configured in the tracker. Each year has its OWN pillars, activities and targets \u2014 a new year starts empty (use "Copy structure" to clone).' : "Reporting years configured in the tracker. Pillar weights, targets and active sites apply across every year \u2014 only input data is per-year."), canEdit && /* @__PURE__ */ React.createElement("button", { className: "btn-primary", type: "button", onClick: onAddYear, style: { marginLeft: "auto" } }, "+ Add year")), /* @__PURE__ */ React.createElement("div", { className: "setup-years" }, (D.years || []).slice().sort((a, b) => a - b).map((y) => /* @__PURE__ */ React.createElement("span", { key: y, className: "setup-year-pill " + (y === S.year ? "is-current" : ""), title: y === S.year ? "Currently selected in the toolbar" : "Switch to " + y + " via the toolbar Year dropdown" }, y, y === S.year && /* @__PURE__ */ React.createElement("small", null, "\xB7 current"), canEdit && (D.years || []).length > 1 && /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "setup-year-pill__del",
        title: "Delete " + y + " (admin only)",
        onClick: () => startDeleteYear(y),
        style: {
          marginLeft: 8,
          padding: "0 6px",
          fontSize: 13,
          lineHeight: "18px",
          background: "transparent",
          border: "1px solid rgba(220,38,38,.35)",
          color: "#DC2626",
          borderRadius: 4,
          cursor: "pointer"
        }
      },
      "\xD7"
    ))), (!D.years || D.years.length === 0) && /* @__PURE__ */ React.createElement("span", { style: { color: "var(--color-text-muted)", fontSize: 12, fontStyle: "italic" } }, 'No years configured yet \u2014 click "Add year" to create one.'))), /* @__PURE__ */ React.createElement("section", { className: "setup-section" }, /* @__PURE__ */ React.createElement("div", { className: "setup-section__head" }, /* @__PURE__ */ React.createElement("h3", null, "2 \xB7 Pillars"), /* @__PURE__ */ React.createElement("small", null, "Strategic dimensions and their weights. The four weights must total 100%."), canEdit && /* @__PURE__ */ React.createElement("button", { className: "btn-primary", type: "button", onClick: startAddPillar, style: { marginLeft: "auto" } }, "+ Add pillar")), /* @__PURE__ */ React.createElement("div", { className: "setup-pillars" }, pillars.map((p) => {
      var _a2;
      return /* @__PURE__ */ React.createElement("div", { key: p, className: "setup-pillar-row" }, /* @__PURE__ */ React.createElement("span", { className: "setup-pillar-row__chip", style: { background: TR.gPC(D, p) } }, p.split("-")[0]), /* @__PURE__ */ React.createElement(
        "input",
        {
          className: "setup-input setup-input--name",
          type: "text",
          defaultValue: p,
          onBlur: (e) => renamePillar(p, e.target.value.trim()),
          disabled: !canEdit,
          title: "Edit and blur to rename. Format: P{N}-Name"
        }
      ), /* @__PURE__ */ React.createElement("span", { className: "setup-pillar-row__weight" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          className: "setup-input setup-input--weight",
          type: "number",
          min: "0",
          max: "100",
          step: "1",
          value: Math.round((((_a2 = D.pillarWeights) == null ? void 0 : _a2[p]) || 0) * 100),
          onChange: (e) => setPillarWeight(p, parseFloat(e.target.value) || 0),
          disabled: !canEdit
        }
      ), /* @__PURE__ */ React.createElement("small", null, "%")), /* @__PURE__ */ React.createElement("small", { className: "setup-pillar-row__count" }, D.activities.filter((a) => a.pillar === p).length, " activities"), canEdit && /* @__PURE__ */ React.createElement("button", { className: "btn-danger setup-pillar-row__del", type: "button", onClick: () => startDeletePillar(p) }, "Delete"));
    }), /* @__PURE__ */ React.createElement("div", { className: "setup-pillars__total " + (pillarTotalOk ? "is-ok" : "is-fail") }, "Total weight: ", /* @__PURE__ */ React.createElement("b", null, Math.round(pillarTotal * 100), "%"), pillarTotalOk ? /* @__PURE__ */ React.createElement("span", null, " \u2713") : /* @__PURE__ */ React.createElement("span", null, " \xB7 must equal 100%")))), /* @__PURE__ */ React.createElement("section", { className: "setup-section" }, /* @__PURE__ */ React.createElement("div", { className: "setup-section__head" }, /* @__PURE__ */ React.createElement("h3", null, "3 \xB7 Active sites"), /* @__PURE__ */ React.createElement("small", null, "Toggle which sites participate in the tracker. Inactive sites still show in the Setup tables but contribute nothing to the score.")), /* @__PURE__ */ React.createElement("div", { className: "setup-sites" }, D.sites.map((code) => {
      var _a2;
      const isActive = (_a2 = D.activeSites) == null ? void 0 : _a2.includes(code);
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: code,
          type: "button",
          className: "setup-site-chip " + (isActive ? "is-active" : ""),
          style: isActive ? { background: D.siteColors[code], borderColor: D.siteColors[code] } : {},
          onClick: () => canEdit && startToggleSite(code),
          disabled: !canEdit,
          title: D.siteNames[code]
        },
        /* @__PURE__ */ React.createElement("span", { className: "setup-site-chip__code" }, code),
        /* @__PURE__ */ React.createElement("span", { className: "setup-site-chip__name" }, D.siteNames[code] || code)
      );
    }))), /* @__PURE__ */ React.createElement("section", { className: "setup-section" }, /* @__PURE__ */ React.createElement("div", { className: "setup-section__head" }, /* @__PURE__ */ React.createElement("h3", null, "4 \xB7 Activities"), /* @__PURE__ */ React.createElement("small", null, "One row per activity. Weights are ", /* @__PURE__ */ React.createElement("em", null, "within each pillar"), " (must total 100% per pillar). Window M1\u2013M12 defines when the activity is in scope.")), byPillar.map((g) => {
      const rowSum = g.rows.reduce((s, { a }) => s + (a.weight || 0), 0);
      const rowSumOk = Math.abs(rowSum - 1) < 5e-3;
      return /* @__PURE__ */ React.createElement("div", { key: g.pillar, className: "setup-pillar-group", style: { "--pillar-color": g.color } }, /* @__PURE__ */ React.createElement("div", { className: "setup-pillar-group__head" }, /* @__PURE__ */ React.createElement("span", { className: "setup-pillar-row__chip", style: { background: g.color } }, g.pillar.split("-")[0]), /* @__PURE__ */ React.createElement("span", { className: "setup-pillar-group__title" }, g.name), /* @__PURE__ */ React.createElement("small", null, g.weightPct, "% of overall \xB7 ", g.rows.length, " activities"), canEdit && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn-ghost setup-pillar-group__add", onClick: () => startAddActivity(g.pillar) }, "+ Activity")), /* @__PURE__ */ React.createElement("div", { className: "setup-act-table" }, /* @__PURE__ */ React.createElement("div", { className: "setup-act-thead", role: "row" }, /* @__PURE__ */ React.createElement("span", null, "#"), /* @__PURE__ */ React.createElement("span", null, "Activity name"), /* @__PURE__ */ React.createElement("span", null, "KPI"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right" } }, "Weight"), /* @__PURE__ */ React.createElement("span", null, "Window"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "center" } }, "Shared"), /* @__PURE__ */ React.createElement("span", null)), g.rows.map(({ a, i }) => /* @__PURE__ */ React.createElement("div", { key: a.id || i, className: "setup-act-row", role: "row" }, /* @__PURE__ */ React.createElement("span", { className: "setup-act-num" }, a.num), /* @__PURE__ */ React.createElement(
        "input",
        {
          className: "setup-input setup-input--name",
          type: "text",
          defaultValue: a.name,
          onBlur: (e) => setActivityField(i, "name", e.target.value),
          disabled: !canEdit
        }
      ), /* @__PURE__ */ React.createElement(
        "select",
        {
          className: "setup-input setup-input--kpi",
          value: a.kpi || "COUNT",
          onChange: (e) => setActivityField(i, "kpi", e.target.value),
          disabled: !canEdit
        },
        KPI_TYPES.map((k) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, k))
      ), /* @__PURE__ */ React.createElement("span", { className: "setup-act-weight" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          className: "setup-input setup-input--weight",
          type: "number",
          min: "0",
          max: "100",
          step: "0.1",
          value: (a.weight || 0) * 100 % 1 === 0 ? (a.weight || 0) * 100 : ((a.weight || 0) * 100).toFixed(1),
          onChange: (e) => setActivityField(i, "weight", e.target.value),
          disabled: !canEdit
        }
      ), /* @__PURE__ */ React.createElement("small", null, "%")), /* @__PURE__ */ React.createElement("span", { className: "setup-act-window" }, /* @__PURE__ */ React.createElement(
        "select",
        {
          className: "setup-input setup-input--month",
          value: a.start || 1,
          onChange: (e) => setActivityField(i, "start", e.target.value),
          disabled: !canEdit,
          title: "First month the activity is in scope"
        },
        MO.map((m, mi) => /* @__PURE__ */ React.createElement("option", { key: m, value: mi + 1 }, m))
      ), /* @__PURE__ */ React.createElement("span", { className: "setup-act-window__sep" }, "\u2192"), /* @__PURE__ */ React.createElement(
        "select",
        {
          className: "setup-input setup-input--month",
          value: a.end || 12,
          onChange: (e) => setActivityField(i, "end", e.target.value),
          disabled: !canEdit,
          title: "Last month the activity is in scope"
        },
        MO.map((m, mi) => /* @__PURE__ */ React.createElement("option", { key: m, value: mi + 1 }, m))
      )), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "center" } }, /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "checkbox",
          checked: !!a.shared,
          onChange: (e) => setActivityField(i, "shared", e.target.checked),
          disabled: !canEdit
        }
      )), /* @__PURE__ */ React.createElement("span", null, canEdit && /* @__PURE__ */ React.createElement("button", { className: "btn-danger setup-act-row__del", type: "button", onClick: () => startDeleteActivity(i) }, "\u2715"))))), /* @__PURE__ */ React.createElement("div", { className: "setup-act-table__total " + (rowSumOk ? "is-ok" : "is-fail") }, "Pillar total: ", /* @__PURE__ */ React.createElement("b", null, Math.round(rowSum * 100), "%"), rowSumOk ? /* @__PURE__ */ React.createElement("span", null, " \u2713") : /* @__PURE__ */ React.createElement("span", null, " \xB7 must equal 100% within the pillar")));
    })), /* @__PURE__ */ React.createElement("div", { className: "tt-footer" }, /* @__PURE__ */ React.createElement("span", null, "Changes auto-save 0.8 s after the last edit. Watch the indicator in the toolbar."), /* @__PURE__ */ React.createElement("span", null, "Deleting a pillar or activity opens a redistribute dialog so the totals stay at 100%.")), (modal == null ? void 0 : modal.type) === "redistribute" && /* @__PURE__ */ React.createElement(
      RedistributeModal,
      {
        kind: modal.kind,
        target: modal.target,
        items: modal.items,
        cascadeWarning: modal.cascadeWarning,
        onCancel: () => setModal(null),
        onConfirm: modal.onConfirm
      }
    ), (modal == null ? void 0 : modal.type) === "confirm" && /* @__PURE__ */ React.createElement(
      Modal,
      {
        title: modal.title,
        onCancel: () => setModal(null),
        onConfirm: modal.onConfirm,
        confirmLabel: modal.confirmLabel,
        confirmKind: modal.confirmKind
      },
      modal.body
    ));
  }
  function TargetsPanel({ D, S, roles, onMutate }) {
    var _a;
    const TR = window.TR;
    const lockSites = roles.USER_SITES;
    const initialSite = lockSites ? lockSites.includes(S.site) ? S.site : lockSites[0] : S.site || ((_a = D.activeSites) == null ? void 0 : _a[0]) || D.sites[0];
    const [site, setSite] = useState(initialSite);
    const canEdit = roles.CAN_SAVE_ALL || roles.CAN_SAVE_OWN && !!lockSites && lockSites.includes(site);
    function ensureTargetSlot(ix) {
      if (!D.targets[site]) D.targets[site] = [];
      if (!D.targets[site][ix]) D.targets[site][ix] = { target: 0, active: false };
    }
    function setTargetValue(ix, kpi, raw) {
      ensureTargetSlot(ix);
      if (kpi === "BOOLEAN") {
        D.targets[site][ix].target = "TRUE/FALSE";
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
    const byPillar = pillars.map((p) => {
      var _a2;
      return {
        pillar: p,
        color: TR.gPC(D, p),
        name: TR.gPS(p),
        weightPct: Math.round((((_a2 = D.pillarWeights) == null ? void 0 : _a2[p]) || 0) * 100),
        rows: D.activities.map((a, i) => ({ a, i })).filter(({ a }) => a.pillar === p)
      };
    });
    const sites = D.sites;
    const activeCount = D.activities.filter((a, i) => {
      var _a2, _b, _c;
      return (_c = (_b = (_a2 = D.targets) == null ? void 0 : _a2[site]) == null ? void 0 : _b[i]) == null ? void 0 : _c.active;
    }).length;
    return /* @__PURE__ */ React.createElement("div", { className: "tt-panel" }, /* @__PURE__ */ React.createElement("div", { className: "dash-eyebrow" }, "Targets \xB7 ", S.year, " \xB7 ", site), !canEdit && /* @__PURE__ */ React.createElement("div", { className: "tt-banner tt-banner--warn" }, /* @__PURE__ */ React.createElement("b", null, "\u{1F441} View-only"), " \u2014 Target changes for ", /* @__PURE__ */ React.createElement("b", null, site), " require either the ", /* @__PURE__ */ React.createElement("code", null, "tracker-admin"), "/ ", /* @__PURE__ */ React.createElement("code", null, "super_admin"), " role (any site), or ", /* @__PURE__ */ React.createElement("code", null, "tracker-editor"), " scoped to this same site."), /* @__PURE__ */ React.createElement("div", { className: "ip-toolbar" }, /* @__PURE__ */ React.createElement(SitePicker, { D, value: site, onChange: setSite, lockSites }), /* @__PURE__ */ React.createElement("span", { className: "ip-legend" }, /* @__PURE__ */ React.createElement("b", null, activeCount), " of ", D.activities.length, " activities active at ", /* @__PURE__ */ React.createElement("b", null, site), " \xB7 set the per-activity target value below, then turn it on with the toggle.")), byPillar.map((g) => {
      const allOn = g.rows.length > 0 && g.rows.every(({ i }) => {
        var _a2, _b, _c;
        return (_c = (_b = (_a2 = D.targets) == null ? void 0 : _a2[site]) == null ? void 0 : _b[i]) == null ? void 0 : _c.active;
      });
      const noneOn = g.rows.every(({ i }) => {
        var _a2, _b, _c;
        return !((_c = (_b = (_a2 = D.targets) == null ? void 0 : _a2[site]) == null ? void 0 : _b[i]) == null ? void 0 : _c.active);
      });
      const activeInPillar = g.rows.filter(({ i }) => {
        var _a2, _b, _c;
        return (_c = (_b = (_a2 = D.targets) == null ? void 0 : _a2[site]) == null ? void 0 : _b[i]) == null ? void 0 : _c.active;
      }).length;
      return /* @__PURE__ */ React.createElement("div", { key: g.pillar, className: "setup-pillar-group", style: { "--pillar-color": g.color } }, /* @__PURE__ */ React.createElement("div", { className: "setup-pillar-group__head" }, /* @__PURE__ */ React.createElement("span", { className: "setup-pillar-row__chip", style: { background: g.color } }, g.pillar.split("-")[0]), /* @__PURE__ */ React.createElement("span", { className: "setup-pillar-group__title" }, g.name), /* @__PURE__ */ React.createElement("small", null, g.weightPct, "% of overall \xB7 ", activeInPillar, " of ", g.rows.length, " active"), canEdit && /* @__PURE__ */ React.createElement("div", { style: { marginLeft: "auto", display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn-ghost setup-pillar-group__add", disabled: allOn, onClick: () => setAllInPillar(g.pillar, true) }, "All on"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn-ghost setup-pillar-group__add", disabled: noneOn, onClick: () => setAllInPillar(g.pillar, false) }, "All off"))), /* @__PURE__ */ React.createElement("div", { className: "tg-table" }, /* @__PURE__ */ React.createElement("div", { className: "tg-thead", role: "row" }, /* @__PURE__ */ React.createElement("span", null, "#"), /* @__PURE__ */ React.createElement("span", null, "Activity"), /* @__PURE__ */ React.createElement("span", null, "KPI"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "right" } }, "Target"), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "center" } }, "Active")), g.rows.map(({ a, i }) => {
        var _a2, _b;
        const t = ((_b = (_a2 = D.targets) == null ? void 0 : _a2[site]) == null ? void 0 : _b[i]) || { target: 0, active: false };
        const isBool = a.kpi === "BOOLEAN";
        const isActive = !!t.active;
        return /* @__PURE__ */ React.createElement("div", { key: a.id || i, className: "tg-row " + (isActive ? "" : "is-off"), role: "row" }, /* @__PURE__ */ React.createElement("span", { className: "setup-act-num" }, a.num), /* @__PURE__ */ React.createElement("span", { className: "tg-row__name" }, a.name, a.shared && /* @__PURE__ */ React.createElement("span", { className: "ip-grid__shared" }, "SHARED")), /* @__PURE__ */ React.createElement("span", { className: "tg-row__kpi" }, a.kpi), /* @__PURE__ */ React.createElement("span", { className: "tg-row__target" }, isBool ? /* @__PURE__ */ React.createElement("span", { className: "tg-row__target-bool" }, "TRUE/FALSE") : /* @__PURE__ */ React.createElement(
          "input",
          {
            className: "setup-input setup-input--target",
            type: "number",
            step: "any",
            min: "0",
            value: typeof t.target === "number" ? t.target : parseFloat(t.target) || 0,
            onChange: (e) => setTargetValue(i, a.kpi, e.target.value),
            disabled: !canEdit
          }
        )), /* @__PURE__ */ React.createElement("span", { style: { textAlign: "center" } }, /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            className: "tg-toggle " + (isActive ? "is-on" : ""),
            onClick: () => canEdit && toggleActive(i),
            disabled: !canEdit,
            "aria-pressed": isActive,
            title: isActive ? "Active \u2014 click to deactivate at " + site : "Inactive \u2014 click to activate at " + site
          },
          /* @__PURE__ */ React.createElement("span", { className: "tg-toggle__knob" })
        )));
      })));
    }), /* @__PURE__ */ React.createElement("div", { className: "tt-footer" }, /* @__PURE__ */ React.createElement("span", null, "Targets are ", /* @__PURE__ */ React.createElement("b", null, "per-site"), ". The same activity can have different targets at different sites (e.g. a smaller team running fewer daily checks)."), /* @__PURE__ */ React.createElement("span", null, "Auto-saves to the database 0.8 s after the last edit. Watch the indicator in the toolbar.")));
  }
  function RoadmapPanel({ D, S }) {
    const TR = window.TR;
    const pillars = TR.gP(D);
    const periodLeftPct = (S.month - 0.5) / 12 * 100;
    const now = /* @__PURE__ */ new Date();
    const isCurrentYear = now.getFullYear() === S.year;
    const todayMonth = isCurrentYear ? now.getMonth() + 1 : null;
    const showTodayMarker = todayMonth != null && todayMonth !== S.month;
    const todayLeftPct = todayMonth != null ? (todayMonth - 0.5) / 12 * 100 : null;
    const aS = D.activeSites || [];
    const actScores = useMemo(() => {
      const m = {};
      D.activities.forEach((a, ix) => {
        let sum = 0, n = 0;
        aS.forEach((s) => {
          const r = TR.score(D, s, S.year, S.month)[ix];
          if ((r == null ? void 0 : r.on) && typeof r.sc === "number") {
            sum += r.sc;
            n++;
          }
        });
        m[ix] = n ? sum / n : null;
      });
      return m;
    }, [D, aS.join("|"), S.year, S.month]);
    function ragForScore(sc) {
      if (sc == null) return "none";
      const pct = sc * 100;
      if (pct >= 65) return "green";
      if (pct >= 55) return "amber";
      return "red";
    }
    return /* @__PURE__ */ React.createElement("div", { className: "tt-panel" }, /* @__PURE__ */ React.createElement("div", { className: "dash-eyebrow" }, "Roadmap \xB7 ", S.year, " \xB7 12-month Gantt"), /* @__PURE__ */ React.createElement("div", { className: "rm-hero" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "rm-hero__title" }, "Activity windows by pillar"), /* @__PURE__ */ React.createElement("p", { className: "rm-hero__lede" }, "Each bar shows when an activity is ", /* @__PURE__ */ React.createElement("b", null, "in scope"), " (its Window from Setup). Two vertical lines mark time:", " ", /* @__PURE__ */ React.createElement("span", { className: "rm-legend-pill rm-legend-pill--period" }, "\u25AE Solid orange = ", /* @__PURE__ */ React.createElement("b", null, MO[S.month - 1], " ", S.year), " (selected reporting period)"), showTodayMarker && /* @__PURE__ */ React.createElement(React.Fragment, null, " ", /* @__PURE__ */ React.createElement("span", { className: "rm-legend-pill rm-legend-pill--today" }, "\u25AE Dashed grey = ", /* @__PURE__ */ React.createElement("b", null, "today (", MO[todayMonth - 1], ")"))), ". Bars are coloured by the activity's fleet-average score:", " ", /* @__PURE__ */ React.createElement("b", { style: { color: "#1B9A3A" } }, "green \u2265 65%"), " \xB7", /* @__PURE__ */ React.createElement("b", { style: { color: "#D97706" } }, " amber 55\u201364%"), " \xB7", /* @__PURE__ */ React.createElement("b", { style: { color: "#DC2626" } }, " red < 55%"), " \xB7", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--color-text-muted)" } }, " grey = inactive at every site"), "."))), /* @__PURE__ */ React.createElement("div", { className: "rm-month-header" }, /* @__PURE__ */ React.createElement("div", { className: "rm-row-label" }, "Pillar / activity"), /* @__PURE__ */ React.createElement("div", { className: "rm-track-header" }, MO.map((m, i) => /* @__PURE__ */ React.createElement("div", { key: m, className: "rm-month-cell " + (i + 1 === S.month ? "is-today" : "") }, m)))), pillars.map((p) => {
      const color = TR.gPC(D, p);
      const acts = D.activities.map((a, i) => ({ a, i })).filter(({ a }) => a.pillar === p);
      return /* @__PURE__ */ React.createElement("div", { key: p, className: "rm-swimlane", style: { "--pillar-color": color } }, /* @__PURE__ */ React.createElement("div", { className: "rm-swimlane__head" }, /* @__PURE__ */ React.createElement("span", { className: "setup-pillar-row__chip", style: { background: color } }, p.split("-")[0]), /* @__PURE__ */ React.createElement("span", { className: "rm-swimlane__name" }, TR.gPS(p)), /* @__PURE__ */ React.createElement("small", null, acts.length, " activities")), acts.map(({ a, i }) => {
        const start = Math.max(1, Math.min(12, a.start || 1));
        const end = Math.max(start, Math.min(12, a.end || 12));
        const leftPct = (start - 1) / 12 * 100;
        const widthPct = (end - start + 1) / 12 * 100;
        const rag = ragForScore(actScores[i]);
        const fleetPct = actScores[i] != null ? Math.round(actScores[i] * 100) : null;
        return /* @__PURE__ */ React.createElement("div", { key: a.id || i, className: "rm-row" }, /* @__PURE__ */ React.createElement("div", { className: "rm-row-label", title: a.name }, /* @__PURE__ */ React.createElement("span", { className: "rm-row-label__num" }, a.num), /* @__PURE__ */ React.createElement("span", { className: "rm-row-label__name" }, a.name), a.shared && /* @__PURE__ */ React.createElement("span", { className: "ip-grid__shared" }, "SHARED")), /* @__PURE__ */ React.createElement("div", { className: "rm-track" }, MO.map((m, mi) => /* @__PURE__ */ React.createElement("div", { key: m, className: "rm-month-cell rm-month-cell--ghost " + (mi + 1 === S.month ? "is-today" : "") })), /* @__PURE__ */ React.createElement(
          "div",
          {
            className: "rm-bar rm-bar--" + rag,
            style: { left: leftPct + "%", width: widthPct + "%" },
            title: a.name + " \xB7 " + MO[start - 1] + "\u2192" + MO[end - 1] + (fleetPct != null ? " \xB7 fleet " + fleetPct + "%" : " \xB7 no active site has this on")
          },
          /* @__PURE__ */ React.createElement("span", { className: "rm-bar__label" }, "M", start, end !== start ? "\u2013M" + end : "", fleetPct != null && /* @__PURE__ */ React.createElement("span", { className: "rm-bar__pct" }, fleetPct, "%"))
        ), /* @__PURE__ */ React.createElement("div", { className: "rm-period-line", style: { left: periodLeftPct + "%" }, title: "Selected reporting period: " + MO[S.month - 1] }), showTodayMarker && /* @__PURE__ */ React.createElement("div", { className: "rm-today-line", style: { left: todayLeftPct + "%" }, title: "Today: " + MO[todayMonth - 1] })));
      }));
    }), /* @__PURE__ */ React.createElement("div", { className: "tt-footer" }, /* @__PURE__ */ React.createElement("span", null, "Bars use the Window (start month \u2192 end month) set per activity in ", /* @__PURE__ */ React.createElement("a", { href: "#", onClick: (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("preview-switch-tab", { detail: "setup" }));
    } }, "Tracker Setup"), "."), /* @__PURE__ */ React.createElement("span", null, "The vertical orange line is the current reporting period (S.month). Bars to the left of it should already be scoring.")));
  }
  function StubPanel({ tab, phase }) {
    return /* @__PURE__ */ React.createElement("div", { className: "tt-panel" }, /* @__PURE__ */ React.createElement("div", { className: "tt-stub" }, /* @__PURE__ */ React.createElement("span", { className: "tt-stub__badge" }, "PHASE ", phase, " \u2014 IN PROGRESS"), /* @__PURE__ */ React.createElement("h2", null, tab.label), /* @__PURE__ */ React.createElement("p", null, "This tab is coming in phase ", phase, " of the rebuild. The Dashboard tab above is the only one running on the new design today; the rest still serve from the legacy page if you need them.", " ", /* @__PURE__ */ React.createElement("a", { href: "/activity-tracker-legacy.html" }, "Open the legacy tracker \u2192"))));
  }
  function App() {
    const [D, setD] = useState(null);
    const [loadErr, setLoadErr] = useState(null);
    const [S, setS] = useState({ year: (/* @__PURE__ */ new Date()).getFullYear(), month: 1, view: "dashboard" });
    const [dirty, setDirty] = useState(false);
    const [syncState, setSyncState] = useState("idle");
    const [syncError, setSyncError] = useState(null);
    const [mutationCounter, setMutationCounter] = useState(0);
    const [appModal, setAppModal] = useState(null);
    const [exportOpen, setExportOpen] = useState(false);
    const [scope, setScope] = useState(void 0);
    const [scopes, setScopes] = useState(null);
    const roles = useMemo(() => computeRoles(scope, scopes), [scope, scopes]);
    useEffect(() => {
      const handler = (e) => setS((s) => ({ ...s, view: e.detail }));
      window.addEventListener("preview-switch-tab", handler);
      return () => window.removeEventListener("preview-switch-tab", handler);
    }, []);
    useEffect(() => {
      (async () => {
        try {
          const r = await window.TRApi.load();
          if (!r || !r.D) throw new Error("No D in response");
          const Dload = r.D;
          setScope(r.scope === void 0 ? null : r.scope);
          setScopes(Array.isArray(r.scopes) ? r.scopes : null);
          if (!Dload.pillarWeights) Dload.pillarWeights = { "P1-Network Infrast": 0.3, "P2-Business Partner": 0.35, "P3-Risk & Compliance": 0.2, "P4-Manage People": 0.15 };
          setD(Dload);
          const targetYear = defaultYear(Dload);
          const lastEntered = lastMonthWithData(Dload, targetYear);
          setS((s) => ({
            ...s,
            month: lastEntered || Dload.currentMonth || s.month,
            year: targetYear
          }));
        } catch (e) {
          setLoadErr(e.message || "Failed to load tracker data");
        }
      })();
    }, []);
    const lastSaveRef = useRef(0);
    async function handleSave() {
      if (!D) return;
      const tag = ++lastSaveRef.current;
      setSyncState("saving");
      try {
        const res = await window.TRApi.save(D);
        if (tag !== lastSaveRef.current) return;
        if (res && res.closed_blocked) {
          window.alert(res.closed_blocked + " value(s) in closed months were not saved: only a super_admin can change a past month. The page will reload.");
          window.location.reload();
          return;
        }
        setDirty(false);
        setSyncError(null);
        setSyncState("synced");
        setTimeout(() => {
          if (tag === lastSaveRef.current) setSyncState("idle");
        }, 1800);
      } catch (e) {
        if (tag !== lastSaveRef.current) return;
        setSyncError(e.message);
        setSyncState("fail");
      }
    }
    function onMutate() {
      setDirty(true);
      setMutationCounter((c) => c + 1);
    }
    useEffect(() => {
      if (!dirty || !roles.CAN_SAVE) return;
      const t = setTimeout(() => {
        handleSave();
      }, 800);
      return () => clearTimeout(t);
    }, [mutationCounter, dirty, roles.CAN_SAVE]);
    async function handleReset() {
      if (!confirm("Reset ALL tracker data to defaults? This cannot be undone.")) return;
      try {
        const r = await window.TRApi.reset();
        if (r == null ? void 0 : r.D) setD(r.D);
        setDirty(false);
        setSyncState("synced");
      } catch (e) {
        setSyncError(e.message);
        setSyncState("fail");
      }
    }
    function handleAddYear() {
      var _a, _b;
      if (!D) return;
      const years = D.years || [];
      const nextYear = years.length ? Math.max(...years) + 1 : (/* @__PURE__ */ new Date()).getFullYear() + 1;
      const sitesCount = ((_a = D.sites) == null ? void 0 : _a.length) || 0;
      const actsCount = ((_b = D.activities) == null ? void 0 : _b.length) || 0;
      setAppModal({
        type: "confirm",
        title: `Add year ${nextYear}`,
        confirmLabel: "Add year",
        confirmKind: "primary",
        body: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", null, "Add ", /* @__PURE__ */ React.createElement("b", null, nextYear), " to the tracker?"), /* @__PURE__ */ React.createElement("ul", { style: { marginTop: 8, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55, color: "var(--color-text)" } }, /* @__PURE__ */ React.createElement("li", null, "An empty input grid will be created for all ", /* @__PURE__ */ React.createElement("b", null, sitesCount, " sites \xD7 ", actsCount, " activities \xD7 12 months"), " (zero-filled)."), /* @__PURE__ */ React.createElement("li", null, "All ", /* @__PURE__ */ React.createElement("b", null, "pillar weights"), ", ", /* @__PURE__ */ React.createElement("b", null, "per-activity windows"), ", ", /* @__PURE__ */ React.createElement("b", null, "targets"), " and ", /* @__PURE__ */ React.createElement("b", null, "active-site list"), " stay exactly the same as the current configuration \u2014 they apply across years."), /* @__PURE__ */ React.createElement("li", null, "After confirming, the toolbar switches to ", /* @__PURE__ */ React.createElement("b", null, nextYear, " \xB7 Jan"), " so you can start entering data immediately."), /* @__PURE__ */ React.createElement("li", null, "Previous years remain available in the Year dropdown \u2014 switch back at any time."), /* @__PURE__ */ React.createElement("li", null, "Auto-saves to the database 0.8 s after confirmation."))),
        onConfirm: () => {
          D.years = [...years, nextYear].sort((a, b) => a - b);
          if (!D.inputs) D.inputs = {};
          D.inputs[nextYear] = {};
          if (D.perYearEnabled && D.byYear) {
            D.byYear[nextYear] = { activities: [], pillarWeights: {}, targets: {} };
          } else {
            D.sites.forEach((s) => {
              D.inputs[nextYear][s] = D.activities.map(() => new Array(12).fill(0));
            });
          }
          setS((s) => ({ ...s, year: nextYear, month: 1 }));
          setAppModal(null);
          onMutate();
        }
      });
    }
    const visibleTabs = TABS.filter((t) => roles.IS_EXEC || !EXEC_ONLY.has(t.id));
    if (loadErr) return /* @__PURE__ */ React.createElement("div", { className: "tt-page" }, /* @__PURE__ */ React.createElement("div", { className: "tt-error" }, "Failed to load tracker data: ", loadErr));
    if (!D) return /* @__PURE__ */ React.createElement("div", { className: "tt-page" }, /* @__PURE__ */ React.createElement("div", { className: "tt-loading" }, "Loading\u2026"));
    const Dv = D.perYearEnabled && D.byYear && D.byYear[S.year] ? {
      ...D,
      activities: D.byYear[S.year].activities,
      targets: D.byYear[S.year].targets,
      pillarWeights: D.byYear[S.year].pillarWeights
    } : D;
    let panel;
    if (S.view === "dashboard") {
      panel = /* @__PURE__ */ React.createElement(DashboardPanel, { D: Dv, S });
    } else if (S.view === "scoring") {
      panel = /* @__PURE__ */ React.createElement(ScoringPanel, { D: Dv, S, setS, roles });
    } else if (S.view === "input") {
      panel = /* @__PURE__ */ React.createElement(InputPanel, { D: Dv, S, setS, roles, onMutate });
    } else if (S.view === "heatmap") {
      panel = /* @__PURE__ */ React.createElement(HeatmapPanel, { D: Dv, S });
    } else if (S.view === "setup") {
      panel = /* @__PURE__ */ React.createElement(SetupPanel, { D: Dv, S, roles, onMutate, onAddYear: handleAddYear });
    } else if (S.view === "targets") {
      panel = /* @__PURE__ */ React.createElement(TargetsPanel, { D: Dv, S, roles, onMutate });
    } else if (S.view === "roadmap") {
      panel = /* @__PURE__ */ React.createElement(RoadmapPanel, { D: Dv, S });
    } else {
      panel = /* @__PURE__ */ React.createElement(StubPanel, { tab: TABS.find((t) => t.id === S.view) || { label: "Unknown" }, phase: 3 });
    }
    return /* @__PURE__ */ React.createElement("div", { className: "tt-page" }, /* @__PURE__ */ React.createElement(
      Toolbar,
      {
        D,
        S,
        setS,
        dirty,
        syncState,
        syncError,
        onSave: handleSave,
        onReset: handleReset,
        onExport: () => setExportOpen(true),
        roles
      }
    ), /* @__PURE__ */ React.createElement(Tabs, { activeId: S.view, onSelect: (view) => setS({ ...S, view }), visibleTabs }), panel, (appModal == null ? void 0 : appModal.type) === "confirm" && /* @__PURE__ */ React.createElement(
      Modal,
      {
        title: appModal.title,
        onCancel: () => setAppModal(null),
        onConfirm: appModal.onConfirm,
        confirmLabel: appModal.confirmLabel,
        confirmKind: appModal.confirmKind
      },
      appModal.body
    ), exportOpen && /* @__PURE__ */ React.createElement(ExportModal, { D, S, onClose: () => setExportOpen(false) }));
  }
  const _root = ReactDOM.createRoot(document.getElementById("tracker-root"));
  _root.render(/* @__PURE__ */ React.createElement(App, null));
})();
