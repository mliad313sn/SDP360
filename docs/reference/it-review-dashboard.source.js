
class Component extends DCLogic {
  state = { view: 'dashboard', period: null, site: 'ALL', dataReady: !!window.EM_DATA };

  componentDidMount() {
    if (!window.EM_DATA) {
      this._t = setInterval(() => { if (window.EM_DATA) { clearInterval(this._t); this.setState({ dataReady: true }); } }, 100);
    }
  }

  // ---------- helpers ----------
  static SITES = { SML: { name: 'Lafigué', country: 'Côte d’Ivoire' }, SMI: { name: 'Ity', country: 'Côte d’Ivoire' }, HGO: { name: 'Houndé', country: 'Burkina Faso' }, MGO: { name: 'Mana', country: 'Burkina Faso' }, SGO: { name: 'Sabodala-Massawa', country: 'Senegal' } };
  static ANCHOR = '2026-07-14';
  static OPEN = { open: 1, in_progress: 1, on_hold: 1, blocked: 1 };
  static GREEN = '#2f7d4f'; static AMBER = '#b07a17'; static RED = 'var(--color-accent)'; static REDT = '#c2280f';

  d(s) { return s ? new Date(String(s).slice(0, 10) + 'T00:00:00Z') : null; }
  days(a, b) { return Math.round((this.d(a) - this.d(b)) / 86400000); }
  addDays(iso, n) { const t = this.d(iso); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  fmt(iso) { if (!iso) return '—'; const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const d = this.d(iso); return d.getUTCDate() + ' ' + m[d.getUTCMonth()]; }
  median(arr) { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; }

  effClose(i) { if (i.closed_at) return String(i.closed_at).slice(0, 10); if (i.status === 'resolved' || i.status === 'cancelled') return i.updated_at ? String(i.updated_at).slice(0, 10) : null; return null; }
  isOpenNow(i) { return !!Component.OPEN[i.status]; }
  openAt(i, t) { const raised = i.meeting_date; if (!raised || raised > t) return false; const c = this.effClose(i); return !c || c > t; }

  windows(period) {
    const A = Component.ANCHOR;
    if (period === 'week') return { cur: [this.addDays(A, -6), A], prev: [this.addDays(A, -13), this.addDays(A, -7)], short: 'WoW', note: 'vs prior week' };
    if (period === 'month') return { cur: ['2026-07-01', A], prev: ['2026-06-01', '2026-06-30'], short: 'MoM', note: 'vs June' };
    if (period === 'quarter') return { cur: ['2026-07-01', A], prev: ['2026-04-01', '2026-06-30'], short: 'QoQ', note: 'vs Q2' };
    return { cur: ['2026-07-01', A], prev: ['2026-01-01', '2026-06-30'], short: 'HoH', note: 'vs H1' };
  }

  filterSite(rows, site) { return site === 'ALL' ? rows : rows.filter(r => r.site_code === site); }

  // stock/flow metric extraction for a site scope
  metrics(issues, meetings, win) {
    const [c0, c1] = win.cur; const [p0, p1] = win.prev;
    const inWin = (d, w0, w1) => d && d >= w0 && d <= w1;
    const raisedCur = issues.filter(i => inWin(i.meeting_date, c0, c1)).length;
    const raisedPrev = issues.filter(i => inWin(i.meeting_date, p0, p1)).length;
    const closedCur = issues.filter(i => { const c = this.effClose(i); return i.status !== 'cancelled' && inWin(c, c0, c1); }).length;
    const closedPrev = issues.filter(i => { const c = this.effClose(i); return i.status !== 'cancelled' && inWin(c, p0, p1); }).length;
    const openNow = issues.filter(i => this.isOpenNow(i));
    const openPrev = issues.filter(i => this.openAt(i, p1)).length;
    const A = Component.ANCHOR;
    const overdueNow = openNow.filter(i => i.target_date && i.target_date < A).length;
    const overduePrev = issues.filter(i => this.openAt(i, p1) && i.target_date && i.target_date < p1).length;
    const highNow = openNow.filter(i => i.severity === 'HIGH').length;
    const highPrev = issues.filter(i => this.openAt(i, p1) && i.severity === 'HIGH').length;
    const escNow = openNow.filter(i => i.escalate === '1' || i.escalate === 1).length;
    const mttrOf = (w0, w1) => { const v = issues.filter(i => { const c = this.effClose(i); return i.status === 'resolved' && c && inWin(c, w0, w1) && i.meeting_date; }).map(i => this.days(this.effClose(i), i.meeting_date)); return this.median(v); };
    const covOf = (w0, w1) => new Set(meetings.filter(m => inWin(m.meeting_date, w0, w1)).map(m => m.site_code + '|' + m.department)).size;
    return { raisedCur, raisedPrev, closedCur, closedPrev, openNow: openNow.length, openPrev, overdueNow, overduePrev, highNow, highPrev, escNow, mttrCur: mttrOf(c0, c1), mttrPrev: mttrOf(p0, p1), covCur: covOf(c0, c1), covPrev: covOf(p0, p1), openList: openNow };
  }

  delta(cur, prev, invert, unit) {
    if (cur == null || prev == null) return { txt: '—', color: 'var(--color-neutral-500)' };
    const d = Math.round((cur - prev) * 10) / 10;
    if (d === 0) return { txt: '· 0', color: 'var(--color-neutral-500)' };
    const good = invert ? d < 0 : d > 0;
    return { txt: (d > 0 ? '▲ +' : '▼ ') + d + (unit || ''), color: good ? Component.GREEN : Component.REDT };
  }

  spark(series) {
    const max = Math.max(...series, 1); const n = series.length;
    const pts = series.map((v, i) => (4 + i * (56 / Math.max(n - 1, 1))) + ',' + (19 - (v / max) * 16));
    const last = pts[pts.length - 1].split(',');
    return { pts: pts.join(' '), x: last[0], y: last[1] };
  }

  // engagement metrics per site over programme (Apr 1 – anchor)
  eMetrics(site, D, asOf) {
    const A = asOf || Component.ANCHOR;
    const meets = D.meetings.filter(m => m.site_code === site && m.meeting_date <= A);
    const isss = D.issues.filter(i => i.site_code === site && i.meeting_date <= A);
    if (!meets.length) return { e1: 0, e2: 0, e3: 0, e5: 0, cov: 0, nextRate: 0 };
    const months = [...new Set(meets.map(m => String(m.meeting_date).slice(0, 7)))];
    const firstMonth = meets.map(m => String(m.meeting_date).slice(0, 7)).sort()[0];
    const allMonths = ['2026-04', '2026-05', '2026-06', '2026-07'].filter(mo => mo >= firstMonth && mo <= A.slice(0, 7));
    const depts = new Set(meets.map(m => m.department));
    const deptMonths = new Set(meets.map(m => m.department + '|' + String(m.meeting_date).slice(0, 7))).size;
    const e1 = Math.min(100, Math.round(100 * deptMonths / Math.max(depts.size * allMonths.length, 1)));
    const submitted = meets.filter(m => m.submitted_at);
    const signed48 = submitted.filter(m => {
      if (!m.dept_head_signed_at || !m.site_it_signed_at) return false;
      const sub = new Date(m.submitted_at.replace(' ', 'T') + 'Z');
      const s1 = new Date(m.dept_head_signed_at.replace(' ', 'T') + 'Z');
      const s2 = new Date(m.site_it_signed_at.replace(' ', 'T') + 'Z');
      return (Math.max(s1, s2) - sub) <= 48 * 3600000;
    }).length;
    const e2 = submitted.length ? Math.round(100 * signed48 / submitted.length) : 0;
    const e3 = isss.length ? Math.round(100 * isss.filter(i => (i.champion || '').trim()).length / isss.length) : 0;
    const withNext = meets.filter(m => m.next_meeting_date).length;
    const e5 = Math.round(100 * meets.filter(m => m.next_meeting_date && (m.priority_1 || '').trim()).length / meets.length);
    const cov = Math.round(100 * depts.size / 12);
    return { e1, e2, e3, e5, cov, nextRate: Math.round(100 * withNext / meets.length) };
  }

  // composite v2 at a point in time
  composite(site, D, asOf) {
    const A = asOf || Component.ANCHOR;
    const isss = D.issues.filter(i => i.site_code === site);
    const openA = isss.filter(i => this.openAt(i, A));
    const overdue = openA.filter(i => i.target_date && i.target_date < A).length;
    const odRate = openA.length ? 100 * overdue / openA.length : 0;
    const resolved = isss.filter(i => { const c = this.effClose(i); return i.status === 'resolved' && c && c <= A && i.meeting_date; });
    const mttr = this.median(resolved.map(i => this.days(this.effClose(i), i.meeting_date)));
    const allRes = D.issues.filter(i => { const c = this.effClose(i); return i.status === 'resolved' && c && c <= A && i.meeting_date; });
    const fleetMttr = this.median(allRes.map(i => this.days(this.effClose(i), i.meeting_date))) || 1;
    const mttrIdx = mttr == null ? 60 : Math.max(0, Math.min(100, 100 * fleetMttr / Math.max(mttr, 1)));
    const highOpen = openA.filter(i => i.severity === 'HIGH');
    const highAging = highOpen.length ? 100 * highOpen.filter(i => this.days(A, i.meeting_date) > 30).length / highOpen.length : 0;
    const del = (100 - odRate) * 0.4 + mttrIdx * 0.3 + (100 - highAging) * 0.3;
    const e = this.eMetrics(site, D, A);
    const gov = e.e1 * 0.35 + e.e2 * 0.30 + e.e3 * 0.15 + e.e5 * 0.20;
    const eng = e.cov * 0.6 + e.nextRate * 0.4;
    let pen = 0;
    openA.filter(i => (i.escalate === '1' || i.escalate === 1) && this.days(A, i.meeting_date) > 60).forEach(() => pen += 3);
    if (highOpen.some(i => this.days(A, i.meeting_date) > 90)) pen += 5;
    const score = Math.max(0, Math.round(del * 0.4 + gov * 0.35 + eng * 0.25 - pen));
    return { score, del: Math.round(del), gov: Math.round(gov), eng: Math.round(eng), pen, e, open: openA.length, overdue, high: highOpen.length, odRate: Math.round(odRate), mttr };
  }

  rag(score) {
    if (score >= 75) return { label: 'GREEN', bg: '#dcefe2', fg: Component.GREEN };
    if (score >= 55) return { label: 'AMBER', bg: '#f5e7c8', fg: Component.AMBER };
    return { label: 'RED', bg: 'var(--color-accent-100)', fg: Component.REDT };
  }
  ragPct(v, g, a) { // higher better
    if (v == null) return { bg: 'var(--color-neutral-200)', fg: 'var(--color-neutral-500)' };
    if (v >= g) return { bg: '#dcefe2', fg: Component.GREEN };
    if (v >= a) return { bg: '#f5e7c8', fg: '#7a5510' };
    return { bg: 'var(--color-accent-100)', fg: Component.REDT };
  }

  twoMoves(site, D, comp) {
    const A = Component.ANCHOR;
    const cands = [];
    const openA = D.issues.filter(i => i.site_code === site && this.isOpenNow(i));
    const od = openA.filter(i => i.target_date && i.target_date < A).sort((a, b) => a.target_date < b.target_date ? -1 : 1);
    if (comp.odRate > 20 && od.length) cands.push([100 + comp.odRate, 'Clear the overdue backlog — ' + od.length + ' items past target (' + comp.odRate + '% of open). Start with “' + (od[0].title || '').slice(0, 60) + '” (' + this.days(A, od[0].target_date) + ' d late).']);
    if (comp.high >= 4) cands.push([90 + comp.high, 'Reduce HIGH exposure: ' + comp.high + ' HIGH items open (red ≥ 4). Review each in the next GM meeting with a dated plan.']);
    if (comp.e.e2 < 50) cands.push([85, 'Fix PV diffusion: only ' + comp.e.e2 + '% of minutes signed within 48 h. Chase both signatures at the meeting close, not after.']);
    const noTarget = openA.filter(i => !i.target_date).length;
    if (noTarget >= 3) cands.push([70 + noTarget, 'Set target dates on ' + noTarget + ' open issues that have none — they are invisible to overdue tracking.']);
    const insp = D.inspections.filter(i => i.site_code === site).map(i => i.inspection_date).sort();
    const lastI = insp[insp.length - 1];
    if (!lastI || this.days(A, lastI) > 45) cands.push([80, 'Schedule an infrastructure inspection — last one ' + (lastI ? this.days(A, lastI) + ' days ago' : 'never recorded') + ' (cadence target ≤ 45 d).']);
    const crit = D.findings.filter(f => f.site_code === site && (f.status === 'critical' || f.status === 'major')).length;
    if (crit > 0) cands.push([75 + crit, 'Close out ' + crit + ' critical/major inspection findings with dated corrective actions in the register.']);
    if (comp.e.e1 < 70) cands.push([65, 'Restore review cadence: ' + comp.e.e1 + '% of expected department reviews held. Book next-month PVs for every engaged department now.']);
    const load = {}; openA.forEach(i => { const c = (i.champion || '').trim(); if (c) load[c] = (load[c] || 0) + 1; });
    const heavy = Object.entries(load).filter(([, n]) => n >= 7).sort((a, b) => b[1] - a[1]);
    if (heavy.length) cands.push([88, 'Rebalance workload: ' + heavy[0][0] + ' holds ' + heavy[0][1] + ' open items (alert ≥ 7). Reassign or co-own before dates slip.']);
    if (comp.e.cov < 60) cands.push([60, 'Widen department coverage: only ' + Math.round(comp.e.cov / 100 * 12) + ' of 12 departments engaged. Book intake meetings with the missing functions.']);
    cands.sort((a, b) => b[0] - a[0]);
    while (cands.length < 2) cands.push([0, 'Hold the line: keep closure ratio ≥ 1.0 and sign every PV within 48 h.']);
    return cands.slice(0, 2).map((c, i) => ({ n: i + 1, text: c[1] }));
  }

  // ---------- Site Position & Effort Scoreboard model ----------
  // six dimensions × 2 pts, score = pts/12 × 100
  sbDims(site, D, asOf) {
    const A = asOf || Component.ANCHOR;
    const W0 = '2026-04-01';
    const meets = D.meetings.filter(m => m.site_code === site && m.meeting_date >= W0 && m.meeting_date <= A);
    const isss = D.issues.filter(i => i.site_code === site && i.meeting_date >= W0 && i.meeting_date <= A);
    const reviews = meets.length;
    const resolved = isss.filter(i => { const c = this.effClose(i); return i.status === 'resolved' && c && c <= A; }).length;
    const resolution = isss.length ? Math.round(100 * resolved / isss.length) : 0;
    const odIss = D.issues.filter(i => i.site_code === site && this.openAt(i, A) && i.target_date && i.target_date < A).length;
    const odAct = D.actions.filter(a => a.site_code === site && a.meeting_date && a.meeting_date <= A && (!a.closed_at || String(a.closed_at).slice(0, 10) > A) && Component.OPEN[a.status] && a.target_date && a.target_date < A).length;
    const overdue = odIss + odAct;
    const insp = D.inspections.filter(i => i.site_code === site && i.inspection_date <= A).length;
    const findings = D.findings.filter(f => f.site_code === site && f.inspection_date <= A && (f.status === 'critical' || f.status === 'major')).length;
    const signed = meets.filter(m => m.dept_head_signed_at && m.site_it_signed_at && String(m.dept_head_signed_at).slice(0, 10) <= A && String(m.site_it_signed_at).slice(0, 10) <= A).length;
    const signoff = meets.length ? Math.round(100 * signed / meets.length) : 0;
    const pt = (v, g, a, invert) => invert ? (v <= g ? 2 : v <= a ? 1 : 0) : (v >= g ? 2 : v >= a ? 1 : 0);
    const dims = [
      { key: 'reviews', label: 'Reviews', val: reviews, disp: String(reviews), pts: pt(reviews, 8, 5), tip: 'reviews held · G≥8 A5–7 R<5' },
      { key: 'resolution', label: 'Resolution', val: resolution, disp: resolution + '%', pts: pt(resolution, 40, 20), tip: 'resolved ÷ raised · G≥40 A20–39 R<20' },
      { key: 'overdue', label: 'Overdue', val: overdue, disp: String(overdue), pts: pt(overdue, 0, 5, true), tip: 'overdue issues + actions · G0 A1–5 R>5' },
      { key: 'inspections', label: 'Inspections', val: insp, disp: String(insp), pts: pt(insp, 3, 2), tip: 'inspections run · G≥3 A2 R≤1' },
      { key: 'findings', label: 'Findings', val: findings, disp: String(findings), pts: pt(findings, 0, 2, true), tip: 'critical+major findings · G0 A1–2 R≥3' },
      { key: 'signoff', label: 'Sign-off', val: signoff, disp: signoff + '%', pts: pt(signoff, 70, 30), tip: 'minutes fully signed % · G≥70 A30–69 R<30' },
    ];
    const points = dims.reduce((s, d) => s + d.pts, 0);
    return { dims, points, score: Math.round(points / 12 * 100), reviews, resolution, overdue };
  }

  sbMoveText(d, site, D) {
    const A = Component.ANCHOR;
    if (d.key === 'reviews') return 'Hold ' + Math.max(8 - d.val, 1) + ' more departmental reviews to reach the green cadence of 8 — book them with GM sponsorship now.';
    if (d.key === 'resolution') return 'Lift resolution from ' + d.val + '% toward 40%: run a weekly closure sprint on the oldest in-progress items.';
    if (d.key === 'overdue') return 'Clear ' + d.val + ' overdue commitments — re-date with dept heads what is still real, close the rest this week.';
    if (d.key === 'inspections') return 'Run ' + Math.max(3 - d.val, 1) + ' more infrastructure inspection' + (3 - d.val > 1 ? 's' : '') + ' to reach the quarterly green of 3.';
    if (d.key === 'findings') return 'Close out ' + d.val + ' critical/major inspection findings with dated corrective actions.';
    return 'Get minutes counter-signed: sign-off at ' + d.val + '% vs 70% green — capture both signatures at meeting close.';
  }

  renderVals() {
    const G = Component.GREEN, AM = Component.AMBER, RD = Component.REDT;
    if (!this.state.dataReady) {
      return { isDashboard: true, isBrief: false, viewOpts: [], periodOpts: [], siteOpts: [], kpis: [], leaderboard: [], groupRows: [], flowMonths: [], eMatrix: [], eHeaders: [], sigFunnel: [], aging: [], champLoad: [], overdueRows: [], inspSiteRows: [], findCats: [], pipeline: [], dqItems: [], briefKpis: [], briefSites: [], scopeLabel: 'Loading…', backlogPts: '' };
    }
    const D = window.EM_DATA;
    const A = Component.ANCHOR;
    const period = this.state.period ?? (this.props.defaultPeriod ?? 'week');
    const site = this.state.site;
    const win = this.windows(period);
    const codes = ['SML', 'SMI', 'HGO', 'MGO', 'SGO'];

    // controls
    const mk = (label, active, pick) => ({ label, bg: active ? 'var(--color-text)' : 'var(--color-bg)', fg: active ? 'var(--color-bg)' : 'var(--color-text)', pick });
    const viewOpts = [mk('DASHBOARD', this.state.view === 'dashboard', () => this.setState({ view: 'dashboard' })), mk('SCOREBOARD', this.state.view === 'scoreboard', () => this.setState({ view: 'scoreboard' })), mk('WEEKLY BRIEF', this.state.view === 'brief', () => this.setState({ view: 'brief' }))];
    const periodOpts = [['week', 'WEEK'], ['month', 'MONTH'], ['quarter', 'QUARTER'], ['semester', 'SEMESTER']].map(([k, l]) => mk(l, period === k, () => this.setState({ period: k })));
    const siteOpts = [['ALL', 'ALL'], ...codes.map(c => [c, c])].map(([k, l]) => mk(l, site === k, () => this.setState({ site: k })));

    // scope
    const issues = this.filterSite(D.issues, site);
    const meetings = this.filterSite(D.meetings, site);
    const M = this.metrics(issues, meetings, win);
    const scopeLabel = site === 'ALL' ? 'All sites — group view' : Component.SITES[site].name + ' (' + site + ')';
    const scopeSuffix = site === 'ALL' ? '— all sites' : '— ' + Component.SITES[site].name;

    // monthly series for sparks
    const months = ['2026-04', '2026-05', '2026-06', '2026-07'];
    const ends = ['2026-04-30', '2026-05-31', '2026-06-30', A];
    const serRaised = months.map(mo => issues.filter(i => String(i.meeting_date || '').slice(0, 7) === mo).length);
    const serOpen = ends.map(e => issues.filter(i => this.openAt(i, e)).length);
    const serOver = ends.map(e => issues.filter(i => this.openAt(i, e) && i.target_date && i.target_date < e).length);
    const serHigh = ends.map(e => issues.filter(i => this.openAt(i, e) && i.severity === 'HIGH').length);

    const targetDepts = site === 'ALL' ? 12 * 5 : 12;
    const kd = (label, value, unit, dlt, series, note) => { const sp = this.spark(series); return { label, value, unit, deltaTxt: dlt.txt, deltaColor: dlt.color, spark: sp.pts, sparkX: sp.x, sparkY: sp.y, deltaNote: note || win.note }; };
    const kpis = [
      kd('Raised', M.raisedCur, 'in window', this.delta(M.raisedCur, M.raisedPrev, false), serRaised),
      kd('Open now', M.openNow, 'backlog', this.delta(M.openNow, M.openPrev, true), serOpen),
      kd('Overdue', M.overdueNow, 'past target', this.delta(M.overdueNow, M.overduePrev, true), serOver),
      kd('HIGH open', M.highNow, 'severity', this.delta(M.highNow, M.highPrev, true), serHigh),
      kd('Escalations', M.escNow, 'open', { txt: M.escNow ? '● live' : '· none', color: M.escNow ? RD : G }, ends.map(e => issues.filter(i => this.openAt(i, e) && (i.escalate === '1' || i.escalate === 1)).length), 'to Council'),
      kd('Actions open', this.filterSite(D.actions, site).filter(a => Component.OPEN[a.status]).length, 'IT promises', { txt: '', color: 'var(--color-neutral-500)' }, ends.map(e => this.filterSite(D.actions, site).filter(a => { if (!a.meeting_date || a.meeting_date > e) return false; const c = a.closed_at ? String(a.closed_at).slice(0, 10) : null; return !c || c > e; }).length), 'from reviews'),
      kd('MTTR', M.mttrCur != null ? M.mttrCur : '—', 'days median', this.delta(M.mttrCur, M.mttrPrev, true, ' d'), months.map(mo => { const v = issues.filter(i => { const c = this.effClose(i); return i.status === 'resolved' && c && String(c).slice(0, 7) === mo && i.meeting_date; }).map(i => this.days(this.effClose(i), i.meeting_date)); return this.median(v) || 0; })),
      kd('Dept coverage', M.covCur + '/' + targetDepts, 'depts met', this.delta(M.covCur, M.covPrev, false), months.map(mo => new Set(meetings.filter(m => String(m.meeting_date || '').slice(0, 7) === mo).map(m => m.site_code + '|' + m.department)).size)),
    ];

    // leaderboard
    const comps = {}; const compsPrev = {};
    codes.forEach(c => { comps[c] = this.composite(c, D); compsPrev[c] = this.composite(c, D, win.prev[1]); });
    const leaderboard = codes.map(c => ({ c, comp: comps[c] })).sort((a, b) => b.comp.score - a.comp.score).map((x, idx) => {
      const { c, comp } = x; const rg = this.rag(comp.score);
      const dl = this.delta(comp.score, compsPrev[c].score, false);
      const tot = Math.max(comp.del * 0.4 + comp.gov * 0.35 + comp.eng * 0.25, 1);
      return {
        rank: idx + 1, code: c, name: Component.SITES[c].name, country: Component.SITES[c].country,
        wDel: Math.round(comp.del * 0.4 / tot * 100), wGov: Math.round(comp.gov * 0.35 / tot * 100), wEng: Math.round(comp.eng * 0.25 / tot * 100),
        del: comp.del, gov: comp.gov, eng: comp.eng, score: comp.score, delta: dl.txt, deltaColor: dl.color,
        open: comp.open, overdue: comp.overdue, high: comp.high, penalty: comp.pen ? '−' + comp.pen : '·',
        overdueColor: comp.odRate > 20 ? RD : 'var(--color-text)', overdueWeight: comp.odRate > 20 ? 700 : 400,
        highColor: comp.high >= 4 ? RD : 'var(--color-text)', highWeight: comp.high >= 4 ? 700 : 400,
        rag: rg.label, ragBg: rg.bg, ragFg: rg.fg,
        rowBg: site === c ? 'var(--color-accent-100)' : 'var(--color-bg)',
        pick: () => this.setState({ site: site === c ? 'ALL' : c }),
      };
    });
    const groups = [['Côte d’Ivoire', ['SML', 'SMI']], ['Burkina Faso', ['HGO', 'MGO']], ['Senegal', ['SGO']], ['GROUP — ALL SITES', codes]];
    const groupRows = groups.map(([name, cs]) => {
      const sc = Math.round(cs.reduce((s, c) => s + comps[c].score, 0) / cs.length);
      const scP = Math.round(cs.reduce((s, c) => s + compsPrev[c].score, 0) / cs.length);
      const dl = this.delta(sc, scP, false);
      return { name, sites: cs.join(' · '), score: sc, delta: dl.txt, deltaColor: dl.color, open: cs.reduce((s, c) => s + comps[c].open, 0), overdue: cs.reduce((s, c) => s + comps[c].overdue, 0), high: cs.reduce((s, c) => s + comps[c].high, 0) };
    });

    // flow months
    const maxFlow = Math.max(...months.map(mo => Math.max(issues.filter(i => String(i.meeting_date || '').slice(0, 7) === mo).length, issues.filter(i => { const c = this.effClose(i); return i.status !== 'cancelled' && c && String(c).slice(0, 7) === mo; }).length)), 1);
    const flowMonths = months.map(mo => {
      const r = issues.filter(i => String(i.meeting_date || '').slice(0, 7) === mo).length;
      const cl = issues.filter(i => { const c = this.effClose(i); return i.status !== 'cancelled' && c && String(c).slice(0, 7) === mo; }).length;
      const ratio = r ? Math.round(cl / r * 100) / 100 : null;
      return { label: ['APR', 'MAY', 'JUN', 'JUL'][months.indexOf(mo)], raised: r, closed: cl, hRaised: Math.round(r / maxFlow * 100), hClosed: Math.round(cl / maxFlow * 100), ratio: ratio == null ? '—' : ratio.toFixed(2), ratioColor: ratio == null ? 'var(--color-neutral-500)' : ratio >= 1 ? G : ratio >= 0.7 ? AM : RD };
    });

    // backlog weekly polyline
    const wk = []; let t = '2026-04-01';
    while (t <= A) { wk.push(t); t = this.addDays(t, 7); }
    if (wk[wk.length - 1] !== A) wk.push(A);
    const blSeries = wk.map(e => issues.filter(i => this.openAt(i, e)).length);
    const blMax = Math.max(...blSeries, 1);
    const blPts = blSeries.map((v, i) => (i * (600 / (blSeries.length - 1))).toFixed(1) + ',' + (145 - v / blMax * 135).toFixed(1));
    const blEnd = blPts[blPts.length - 1].split(',');
    const blTrend = blSeries[blSeries.length - 1] - blSeries[blSeries.length - 3];

    // 5E matrix
    const eHeaders = [{ label: 'E1', sub: 'cadence' }, { label: 'E2', sub: '48 h diffusion' }, { label: 'E3', sub: 'champions' }, { label: 'E4', sub: 'not measured' }, { label: 'E5', sub: 'discipline' }];
    const eMatrix = codes.map(c => {
      const e = comps[c].e;
      const cell = (v, g, a, tip) => { const rg = this.ragPct(v, g, a); return { val: v == null ? '—' : v + '%', bg: rg.bg, fg: rg.fg, tip }; };
      return { site: Component.SITES[c].name + ' · ' + c, cells: [cell(e.e1, 90, 70, 'PV cadence held'), cell(e.e2, 80, 50, 'both signatures ≤48h'), cell(e.e3, 90, 70, 'issues with champion'), { val: '—', bg: 'var(--color-neutral-200)', fg: 'var(--color-neutral-500)', tip: 'E4 not yet measured' }, cell(e.e5, 90, 70, 'next date + priorities set')] };
    });

    // signature funnel (fleet or site)
    const subM = meetings.filter(m => m.submitted_at);
    const dhSigned = subM.filter(m => m.dept_head_signed_at);
    const itSigned = subM.filter(m => m.site_it_signed_at);
    const both48 = subM.filter(m => { if (!m.dept_head_signed_at || !m.site_it_signed_at) return false; return (Math.max(new Date(m.dept_head_signed_at.replace(' ', 'T') + 'Z'), new Date(m.site_it_signed_at.replace(' ', 'T') + 'Z')) - new Date(m.submitted_at.replace(' ', 'T') + 'Z')) <= 48 * 3600000; });
    const medLatH = (list, f) => { const v = list.filter(m => m[f]).map(m => (new Date(m[f].replace(' ', 'T') + 'Z') - new Date(m.submitted_at.replace(' ', 'T') + 'Z')) / 3600000).filter(h => h >= 0); const md = this.median(v); return md == null ? null : Math.round(md * 10) / 10; };
    const dhLat = medLatH(subM, 'dept_head_signed_at'); const itLat = medLatH(subM, 'site_it_signed_at');
    const sigFunnel = [
      { label: 'PVs submitted', value: subM.length, note: 'of ' + meetings.length + ' meetings', noteColor: 'var(--color-neutral-600)' },
      { label: 'Dept head signed', value: dhSigned.length, note: dhLat != null ? 'median ' + dhLat + ' h' : 'no data', noteColor: dhLat != null && dhLat <= 48 ? G : RD },
      { label: 'Site IT signed', value: itSigned.length, note: itLat != null ? 'median ' + itLat + ' h' : 'no data', noteColor: itLat != null && itLat <= 48 ? G : RD },
      { label: 'Both ≤ 48 h', value: both48.length + ' / ' + subM.length, note: subM.length ? Math.round(100 * both48.length / subM.length) + '% — target ≥ 80%' : '—', noteColor: subM.length && both48.length / subM.length >= 0.8 ? G : RD },
    ];

    // aging
    const buckets = [['≤ 30 d', 0, 30], ['31–60 d', 31, 60], ['61–90 d', 61, 90], ['> 90 d', 91, 9999]];
    const openList = M.openList;
    const maxB = Math.max(...buckets.map(([, lo, hi]) => openList.filter(i => { const a2 = this.days(A, i.meeting_date); return a2 >= lo && a2 <= hi; }).length), 1);
    const aging = buckets.map(([label, lo, hi]) => {
      const rows = openList.filter(i => { const a2 = this.days(A, i.meeting_date); return a2 >= lo && a2 <= hi; });
      const h = rows.filter(i => i.severity === 'HIGH').length, m2 = rows.filter(i => i.severity === 'MEDIUM').length, l = rows.filter(i => i.severity === 'LOW').length;
      const scale = 100 / maxB;
      return { label, total: rows.length, wHigh: (h * scale).toFixed(1), wMed: (m2 * scale).toFixed(1), wLow: (l * scale).toFixed(1), highTxt: h ? '· ' + h + ' HIGH' : '' };
    });

    // champion load
    const loadMap = {};
    openList.forEach(i => { const c = (i.champion || '').trim(); if (c) loadMap[c] = (loadMap[c] || 0) + 1; });
    const champSorted = Object.entries(loadMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxL = Math.max(...champSorted.map(x => x[1]), 1);
    const champLoad = champSorted.map(([name, n]) => ({ name, n, w: Math.round(n / maxL * 100), color: n >= 7 ? 'var(--color-accent)' : n >= 5 ? '#d9a13b' : 'var(--color-neutral-600)', numColor: n >= 7 ? RD : 'var(--color-text)', flag: n >= 7 ? ' ⚠' : '' }));

    // overdue register
    const odAll = openList.filter(i => i.target_date && i.target_date < A).sort((a, b) => a.target_date < b.target_date ? -1 : 1);
    const sevTag = s => s === 'HIGH' ? { bg: 'var(--color-accent-100)', fg: RD } : s === 'MEDIUM' ? { bg: '#f5e7c8', fg: '#7a5510' } : { bg: 'var(--color-neutral-200)', fg: 'var(--color-neutral-700)' };
    const overdueRows = odAll.slice(0, 9).map(o => { const dl = this.days(A, o.target_date); const st = sevTag(o.severity); return { days: dl, dColor: dl > 60 ? RD : dl > 30 ? AM : 'var(--color-text)', title: (o.title || '').slice(0, 80), meta: o.site_code + ' · ' + (o.department || '') + ' · ' + ((o.champion || '').trim() || 'no champion') + ' · due ' + this.fmt(o.target_date), sev: o.severity, sevBg: st.bg, sevFg: st.fg }; });
    const noTargetN = openList.filter(i => !i.target_date).length;

    // inspections
    const inspAll = site === 'ALL' ? D.inspections : D.inspections.filter(i => i.site_code === site);
    const findAll = site === 'ALL' ? D.findings : D.findings.filter(f => f.site_code === site);
    const inspSiteRows = (site === 'ALL' ? codes : [site]).map(c => {
      const ins = D.inspections.filter(i => i.site_code === c);
      const fs = D.findings.filter(f => f.site_code === c);
      const crit = fs.filter(f => f.status === 'critical').length, maj = fs.filter(f => f.status === 'major').length, min2 = fs.filter(f => f.status === 'minor').length;
      const appl = fs.filter(f => f.status !== 'na').length;
      const ok = fs.filter(f => f.status === 'ok').length;
      const conf = appl ? Math.round(100 * ok / appl) : null;
      const last = ins.map(i => i.inspection_date).sort().pop();
      const dAgo = last ? this.days(A, last) : null;
      const acts = D.inspActions.filter(a => a.site_code === c && a.status !== 'Closed').length;
      const maxD = Math.max(crit + maj + min2, 1);
      return { site: Component.SITES[c].name + ' · ' + c, count: ins.length, last: this.fmt(last), daysAgo: dAgo == null ? '—' : dAgo, daysColor: dAgo == null || dAgo > 45 ? RD : 'var(--color-text)', wCrit: Math.round(crit / maxD * 100), wMaj: Math.round(maj / maxD * 100), wMin: Math.round(min2 / maxD * 100), defTxt: crit + ' / ' + maj + ' / ' + min2, conf: conf == null ? '—' : conf + '%', confColor: conf == null ? 'var(--color-neutral-500)' : conf >= 90 ? G : conf >= 75 ? AM : RD, actOpen: acts };
    });
    const catNames = { pwr: 'Power / UPS', env: 'Environment', net: 'Network', fire: 'Fire safety', radio: 'Radio', tower: 'Towers', sec: 'Security', srv: 'Servers', sto: 'Storage', cell: 'Cellular', rack: 'Racks', doc: 'Documentation', cctv: 'CCTV', bcp: 'BCP / DR', hse: 'HSE', op: 'Operations', ug: 'Underground' };
    const defects = findAll.filter(f => f.status === 'critical' || f.status === 'major' || f.status === 'minor');
    const byCat = {};
    defects.forEach(f => { byCat[f.category] = byCat[f.category] || { n: 0, crit: 0 }; byCat[f.category].n++; if (f.status !== 'minor') byCat[f.category].crit++; });
    const catSorted = Object.entries(byCat).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
    const maxC = Math.max(...catSorted.map(x => x[1].n), 1);
    const findCats = catSorted.map(([k, v]) => ({ label: catNames[k] || k, n: v.n, w: Math.round(v.n / maxC * 100), color: v.crit ? 'var(--color-accent)' : 'var(--color-neutral-600)' }));

    // projects pipeline
    const projs = site === 'ALL' ? D.projects : D.projects.filter(p => p.site_code === site);
    const phases = [['scoping', 'Scoping'], ['design', 'Design'], ['build', 'Build'], ['deploy', 'Deploy']];
    const pipeline = phases.map(([k, label], i) => { const n = projs.filter(p => p.phase === k).length; return { label, n, flex: Math.max(n, 1), bg: i === 0 && n > projs.length / 2 ? 'var(--color-accent)' : 'var(--color-neutral-' + (800 - i * 150) + ')', fg: 'var(--color-bg)' }; });
    const scopingN = projs.filter(p => p.phase === 'scoping').length;
    const pipelineNote = scopingN + ' of ' + projs.length + ' projects still in scoping — uncosted exposure. ' + projs.filter(p => !p.target_end).length + ' have no target end date.';

    // data quality
    const unsigned7 = D.meetings.filter(m => m.submitted_at && (!m.dept_head_signed_at || !m.site_it_signed_at) && (new Date(A) - new Date(m.submitted_at.replace(' ', 'T') + 'Z')) > 7 * 86400000).length;
    const openNoTarget = D.issues.filter(i => this.isOpenNow(i) && !i.target_date).length;
    const noChampEmail = D.issues.filter(i => this.isOpenNow(i) && (i.champion || '').trim() && !(i.champion_email || '').trim()).length;
    const nameKeys = {}; D.issues.forEach(i => { const c = (i.champion || '').trim(); if (c) { const k = c.toLowerCase().replace(/[^a-z]/g, ''); nameKeys[k] = nameKeys[k] || new Set(); nameKeys[k].add(c); } });
    const variants = Object.values(nameKeys).filter(s => s.size > 1).length;
    const dqScore = Math.max(0, 100 - unsigned7 * 3 - openNoTarget * 2 - noChampEmail * 1 - variants * 2);
    const dqItems = [
      { label: 'PVs unsigned > 7 days', value: unsigned7, color: unsigned7 ? RD : G },
      { label: 'Open issues without target date', value: openNoTarget, color: openNoTarget ? RD : G },
      { label: 'Open issues, champion has no email', value: noChampEmail, color: noChampEmail ? AM : G },
      { label: 'Champion name-spelling variants', value: variants, color: variants ? AM : G },
    ];

    // ---------- weekly brief ----------
    const winW = this.windows('week');
    const MF = this.metrics(D.issues, D.meetings, winW);
    const briefKpis = [
      { label: 'Open backlog', value: MF.openNow, ...this.pack(this.delta(MF.openNow, MF.openPrev, true)) },
      { label: 'Overdue', value: MF.overdueNow, ...this.pack(this.delta(MF.overdueNow, MF.overduePrev, true)) },
      { label: 'HIGH open', value: MF.highNow, ...this.pack(this.delta(MF.highNow, MF.highPrev, true)) },
      { label: 'Raised this week', value: MF.raisedCur, ...this.pack(this.delta(MF.raisedCur, MF.raisedPrev, false)) },
    ];
    const fleetScore = Math.round(codes.reduce((s, c) => s + comps[c].score, 0) / 5);
    const worst = [...codes].sort((a, b) => comps[a].score - comps[b].score)[0];
    const best = [...codes].sort((a, b) => comps[b - 0] ? 0 : comps[b].score - comps[a].score)[0];
    const briefNarrative = 'Fleet health stands at ' + fleetScore + '/100. ' + Component.SITES[best].name + ' leads the board; ' + Component.SITES[worst].name + ' needs the most attention this week with ' + comps[worst].overdue + ' overdue and ' + comps[worst].high + ' HIGH items open. Signature diffusion (E2) remains the weakest engagement fleet-wide — ' + (subM.length ? Math.round(100 * both48.length / Math.max(subM.length, 1)) : 0) + '% of PVs fully signed within 48 h against a target of 80%.';
    const briefSites = [...codes].sort((a, b) => comps[b].score - comps[a].score).map(c => {
      const comp = comps[c]; const rg = this.rag(comp.score);
      const deltas = ['week', 'month', 'quarter', 'semester'].map((p, i) => {
        const w = this.windows(p); const prev = this.composite(c, D, w.prev[1]);
        const dl = this.delta(comp.score, prev.score, false);
        return { label: ['WoW', 'MoM', 'QoQ', 'HoH'][i], txt: dl.txt, color: dl.color };
      });
      const ins = D.inspections.filter(i => i.site_code === c);
      const lastI = ins.map(i => i.inspection_date).sort().pop();
      const fs = D.findings.filter(f => f.site_code === c);
      const crit = fs.filter(f => f.status === 'critical' || f.status === 'major').length;
      const stats = [
        { label: 'Open', value: comp.open, color: 'var(--color-text)' },
        { label: 'Overdue', value: comp.overdue + ' (' + comp.odRate + '%)', color: comp.odRate > 20 ? RD : 'var(--color-text)' },
        { label: 'HIGH', value: comp.high, color: comp.high >= 4 ? RD : 'var(--color-text)' },
        { label: 'MTTR', value: comp.mttr != null ? comp.mttr + ' d' : '—', color: 'var(--color-text)' },
        { label: 'E2 48 h', value: comp.e.e2 + '%', color: comp.e.e2 >= 80 ? G : comp.e.e2 >= 50 ? AM : RD },
        { label: 'Last inspection', value: lastI ? this.days(A, lastI) + ' d ago' + (crit ? ' · ' + crit + ' def.' : '') : 'none', color: !lastI || this.days(A, lastI) > 45 ? RD : 'var(--color-text)' },
      ];
      return { code: c, name: Component.SITES[c].name, country: Component.SITES[c].country, score: comp.score, rag: rg.label, ragBg: rg.bg, ragFg: rg.fg, deltas, stats, moves: this.twoMoves(c, D, comp) };
    });

    // ---------- scoreboard view ----------
    const dimColors = { reviews: '#1d6b5e', resolution: '#2a9d8f', overdue: '#7fb7d9', inspections: '#2f7d4f', findings: '#d9a13b', signoff: '#8a8a8a' };
    const ragPts = p => p === 2 ? { bg: '#dcefe2', fg: G } : p === 1 ? { bg: '#f5e7c8', fg: '#7a5510' } : { bg: 'var(--color-accent-100)', fg: RD };
    const sbs = {}; const sbsPrev = {};
    codes.forEach(c => { sbs[c] = this.sbDims(c, D); sbsPrev[c] = this.sbDims(c, D, win.prev[1]); });
    const sbSorted = [...codes].sort((a, b) => sbs[b].score - sbs[a].score);
    const sbAvg = Math.round(codes.reduce((s, c) => s + sbs[c].score, 0) / 5);
    const sbAvgPrev = Math.round(codes.reduce((s, c) => s + sbsPrev[c].score, 0) / 5);
    const sbAvgD = this.delta(sbAvg, sbAvgPrev, false);
    const sbDimHeaders = [{ label: 'REVIEWS', sub: 'held' }, { label: 'RESOLUTION', sub: 'resolved ÷ raised' }, { label: 'OVERDUE', sub: 'issues + actions' }, { label: 'INSPECTIONS', sub: 'run' }, { label: 'FINDINGS', sub: 'crit + major' }, { label: 'SIGN-OFF', sub: 'both signatures' }];
    const sbRows = sbSorted.map((c, idx) => {
      const sb = sbs[c]; const rg = this.rag2(sb.score);
      const dl = this.delta(sb.score, sbsPrev[c].score, false);
      return {
        rank: idx + 1, code: c, name: Component.SITES[c].name,
        score: sb.score, scoreColor: rg.fg, delta: dl.txt, deltaColor: dl.color,
        cells: sb.dims.map(d => { const r = ragPts(d.pts); return { val: d.disp, bg: r.bg, fg: r.fg, tip: d.tip }; }),
        rag: rg.label, ragBg: rg.solidBg, ragFg: rg.solidFg,
      };
    });
    // effort matrix: x = resolution %, y = overdue, r = reviews
    const emMaxX = Math.max(...codes.map(c => sbs[c].resolution), 50) * 1.15;
    const emMaxY = Math.max(...codes.map(c => sbs[c].overdue), 10) * 1.2;
    const px = v => 40 + v / emMaxX * 510;
    const py = v => 10 + v / emMaxY * 300; // more overdue = lower on chart? scoreboard: fewer better toward bottom-left origin; put 0 at bottom
    const emBubbles = codes.map(c => {
      const sb = sbs[c]; const rg = this.rag2(sb.score);
      const x = px(sb.resolution), y = 310 - (sb.overdue / emMaxY * 300);
      const r = 8 + sb.reviews * 1.6;
      return { x: x.toFixed(1), y: y.toFixed(1), r: r.toFixed(1), fill: rg.solidBg, label: c, lx: (x + r + 4).toFixed(1), ly: (y + 4).toFixed(1) };
    });
    const emSplitX = px(30).toFixed(1), emSplitY = (310 - 10 / emMaxY * 300).toFixed(1);
    const emQ2x = (px(30) + 12).toFixed(1);
    // gap to green
    const gapRows = sbSorted.map(c => {
      const sb = sbs[c];
      const segs = sb.dims.filter(d => d.pts > 0).map(d => ({ w: (d.pts / 12 * 100).toFixed(1), color: dimColors[d.key], tip: d.label + ' ' + d.pts + ' pts' }));
      const loss = 12 - sb.points;
      return { code: c, segs, loss: loss > 0 ? '−' + Math.round(loss / 12 * 100) + ' pts lost' : 'at max', lossColor: loss >= 6 ? RD : loss >= 3 ? AM : G };
    });
    const gapLegend = [['reviews', 'Reviews'], ['resolution', 'Resolution'], ['overdue', 'Overdue'], ['inspections', 'Inspections'], ['findings', 'Findings'], ['signoff', 'Sign-off']].map(([k, label]) => ({ label, color: dimColors[k] }));
    // two moves per site (points-ranked)
    const sbMoves = sbSorted.map(c => {
      const sb = sbs[c]; const rg = this.rag2(sb.score);
      const gaps = sb.dims.filter(d => d.pts < 2).sort((a, b) => (2 - b.pts) - (2 - a.pts) || (a.key === 'overdue' ? -1 : 0));
      const moves = gaps.slice(0, 2).map((d, i) => ({ n: i + 1, gain: '+' + Math.round((2 - d.pts) / 12 * 100) + ' pts', text: this.sbMoveText(d, c, D) }));
      while (moves.length < 2) moves.push({ n: moves.length + 1, gain: 'sustain', text: 'All dimensions green — hold cadence and keep the register clean.' });
      return { code: c, name: Component.SITES[c].name, score: sb.score, hdrBg: rg.solidBg, hdrFg: rg.solidFg, moves };
    });

    return {
      isDashboard: this.state.view === 'dashboard', isBrief: this.state.view === 'brief', isScoreboard: this.state.view === 'scoreboard',
      sbAvg, sbAvgColor: this.rag2(sbAvg).fg, sbAvgDelta: sbAvgD.txt, sbAvgDeltaColor: sbAvgD.color,
      sbDimHeaders, sbRows, emBubbles, emSplitX, emSplitY, emQ2x, gapRows, gapLegend, sbMoves,
      viewOpts, periodOpts, siteOpts,
      scopeLabel, scopeSuffix, anchorLabel: this.fmt(A) + ' 2026', dataThrough: this.fmt(A),
      curWinLabel: this.fmt(win.cur[0]) + ' – ' + this.fmt(win.cur[1]), prevWinLabel: win.note.replace('vs ', ''),
      nIssues: D.issues.length, nMeetings: D.meetings.length, nInspections: D.inspections.length, nFindings: D.findings.filter(f => f.status !== 'na').length,
      defectCount: D.findings.filter(f => f.status === 'critical' || f.status === 'major' || f.status === 'minor').length,
      periodShort: win.short,
      kpis, leaderboard, groupRows, flowMonths,
      backlogPts: blPts.join(' '), backlogEndX: blEnd[0], backlogEndY: blEnd[1], backlogNow: blSeries[blSeries.length - 1], backlogPeak: Math.max(...blSeries), backlogStartLabel: 'Apr 1',
      backlogTrendTxt: blTrend < 0 ? '▼ falling' : blTrend > 0 ? '▲ rising' : '· flat', backlogTrendColor: blTrend < 0 ? G : blTrend > 0 ? RD : 'var(--color-neutral-500)',
      eHeaders, eMatrix, sigFunnel, aging, champLoad, overdueRows, overdueCount: odAll.length,
      noTargetNote: noTargetN ? '+ ' + noTargetN + ' open issues have no target date — invisible to this register (see Data quality).' : 'Every open issue carries a target date.',
      inspSiteRows, findCats, pipeline, pipelineNote, dqScore, dqColor: dqScore >= 90 ? G : dqScore >= 75 ? AM : RD, dqItems,
      briefKpis, briefNarrative, briefSites,
    };
  }

  pack(dl) { return { deltaTxt: dl.txt, deltaColor: dl.color }; }

  // scoreboard RAG bands: GREEN ≥70 · AMBER 45–69 · RED <45
  rag2(score) {
    if (score >= 70) return { label: 'GREEN', fg: Component.GREEN, solidBg: '#2f7d4f', solidFg: '#fff' };
    if (score >= 45) return { label: 'AMBER', fg: Component.AMBER, solidBg: '#d99a2b', solidFg: '#fff' };
    return { label: 'RED', fg: Component.REDT, solidBg: 'var(--color-accent)', solidFg: '#fff' };
  }
}
