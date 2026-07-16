'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS A PORT of the boss's authoritative IT Review Dashboard scoring model.
//
//   SOURCE OF TRUTH: docs/reference/it-review-dashboard.source.js
//   RULES:           docs/reference/README.md
//
// Every threshold, weight, rounding, clamp and sentence here is copied from that
// file. DO NOT retune any of it. If our number disagrees with the source, OUR
// CODE IS WRONG — the team reads the numbers the source produces.
// tests/composite-fidelity.test.js pins this port to the source's own dataset.
//
// Deliberate, mechanical deviations from the source (nothing else):
//   • `this.x()` → plain function calls (the source is a class method body).
//   • `d(s)` → `dUTC(s)` (a one-letter export is a footgun).
//   • `effClose`/`openAt`/`OPEN` are NOT re-implemented here — they are imported
//     from ../meetings-db, which already ports them byte-for-faithfully for the
//     sbDims model. Two copies would silently drift; that drift is the exact
//     class of bug this whole effort exists to kill.
//
// Note the two coexisting date idioms, both correct and both from the source:
//   • days()/dUTC()  → real UTC Date arithmetic (a day COUNT).
//   • effClose/openAt → ISO STRING comparison ('2026-07-01' <= '2026-07-14').
//
// FIVE KNOWN QUIRKS — ported AS-IS, pinned by tests, never "fixed" here:
//   1. eMetrics.cov has a hardcoded /12 and NO upper clamp → >12 departments
//      pushes cov>100, eng>100 and composite above 100 (floored at 0, no ceiling).
//   2. `pen` is uncapped: +3 per stale escalated issue, linear.
//   3. mttrIdx defaults to 60 when the site has resolved NOTHING (not 0).
//   4. fleetMttr is the median across ALL sites → composite() is NOT
//      per-site-isolated. It must be passed the WHOLE fleet's D, never a slice.
//   5. odRate = 0 on an empty backlog → an empty log scores 100 on that term.
// ─────────────────────────────────────────────────────────────────────────────

const { _effClose: effClose, _openAt: openAt, MD_OPEN } = require('../meetings-db');

const ANCHOR = '2026-07-14';

// source line 17 (renamed from `d`)
function dUTC(s) { return s ? new Date(String(s).slice(0, 10) + 'T00:00:00Z') : null; }
// source line 18
function days(a, b) { return Math.round((dUTC(a) - dUTC(b)) / 86400000); }
// source line 21
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// source line 24
function isOpenNow(i) { return !!MD_OPEN[i.status]; }

// source line 74 — engagement metrics per site over programme (Apr 1 – anchor)
function eMetrics(site, D, asOf) {
  const A = asOf || ANCHOR;
  const meets = D.meetings.filter(m => m.site_code === site && m.meeting_date <= A);
  const isss = D.issues.filter(i => i.site_code === site && i.meeting_date <= A);
  if (!meets.length) return { e1: 0, e2: 0, e3: 0, e5: 0, cov: 0, nextRate: 0 };
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
  const cov = Math.round(100 * depts.size / 12);   // QUIRK 1 — hardcoded /12, no clamp
  return { e1, e2, e3, e5, cov, nextRate: Math.round(100 * withNext / meets.length) };
}

// source line 102 — composite v2 at a point in time.
// NOTE (quirk 4): `D` MUST be the whole fleet's data, not one site's slice —
// `fleetMttr` below reads D.issues with NO site filter.
function composite(site, D, asOf) {
  const A = asOf || ANCHOR;
  const isss = D.issues.filter(i => i.site_code === site);
  const openA = isss.filter(i => openAt(i, A));
  const overdue = openA.filter(i => i.target_date && i.target_date < A).length;
  const odRate = openA.length ? 100 * overdue / openA.length : 0;   // QUIRK 5
  const resolved = isss.filter(i => { const c = effClose(i); return i.status === 'resolved' && c && c <= A && i.meeting_date; });
  const mttr = median(resolved.map(i => days(effClose(i), i.meeting_date)));
  const allRes = D.issues.filter(i => { const c = effClose(i); return i.status === 'resolved' && c && c <= A && i.meeting_date; });
  const fleetMttr = median(allRes.map(i => days(effClose(i), i.meeting_date))) || 1;   // QUIRK 4
  const mttrIdx = mttr == null ? 60 : Math.max(0, Math.min(100, 100 * fleetMttr / Math.max(mttr, 1)));   // QUIRK 3
  const highOpen = openA.filter(i => i.severity === 'HIGH');
  const highAging = highOpen.length ? 100 * highOpen.filter(i => days(A, i.meeting_date) > 30).length / highOpen.length : 0;
  const del = (100 - odRate) * 0.4 + mttrIdx * 0.3 + (100 - highAging) * 0.3;
  const e = eMetrics(site, D, A);
  const gov = e.e1 * 0.35 + e.e2 * 0.30 + e.e3 * 0.15 + e.e5 * 0.20;
  const eng = e.cov * 0.6 + e.nextRate * 0.4;
  let pen = 0;   // QUIRK 2 — uncapped
  openA.filter(i => (i.escalate === '1' || i.escalate === 1) && days(A, i.meeting_date) > 60).forEach(() => pen += 3);
  if (highOpen.some(i => days(A, i.meeting_date) > 90)) pen += 5;
  const score = Math.max(0, Math.round(del * 0.4 + gov * 0.35 + eng * 0.25 - pen));   // floored at 0, no ceiling
  return { score, del: Math.round(del), gov: Math.round(gov), eng: Math.round(eng), pen, e, open: openA.length, overdue, high: highOpen.length, odRate: Math.round(odRate), mttr };
}

// source line 138 — the ranked candidate list (9 branches), top 2 returned.
function twoMoves(site, D, comp) {
  const A = ANCHOR;
  const cands = [];
  const openA = D.issues.filter(i => i.site_code === site && isOpenNow(i));
  const od = openA.filter(i => i.target_date && i.target_date < A).sort((a, b) => a.target_date < b.target_date ? -1 : 1);
  if (comp.odRate > 20 && od.length) cands.push([100 + comp.odRate, 'Clear the overdue backlog — ' + od.length + ' items past target (' + comp.odRate + '% of open). Start with “' + (od[0].title || '').slice(0, 60) + '” (' + days(A, od[0].target_date) + ' d late).']);
  if (comp.high >= 4) cands.push([90 + comp.high, 'Reduce HIGH exposure: ' + comp.high + ' HIGH items open (red ≥ 4). Review each in the next GM meeting with a dated plan.']);
  if (comp.e.e2 < 50) cands.push([85, 'Fix PV diffusion: only ' + comp.e.e2 + '% of minutes signed within 48 h. Chase both signatures at the meeting close, not after.']);
  const noTarget = openA.filter(i => !i.target_date).length;
  if (noTarget >= 3) cands.push([70 + noTarget, 'Set target dates on ' + noTarget + ' open issues that have none — they are invisible to overdue tracking.']);
  const insp = D.inspections.filter(i => i.site_code === site).map(i => i.inspection_date).sort();
  const lastI = insp[insp.length - 1];
  if (!lastI || days(A, lastI) > 45) cands.push([80, 'Schedule an infrastructure inspection — last one ' + (lastI ? days(A, lastI) + ' days ago' : 'never recorded') + ' (cadence target ≤ 45 d).']);
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

// source line 126 — composite RAG bands: GREEN ≥75 · AMBER 55–74 · RED <55
// (NOT rag2, which is the sbDims model's 70/45.)
function rag(score) {
  if (score >= 75) return { label: 'GREEN', bg: '#dcefe2', fg: '#2f7d4f' };
  if (score >= 55) return { label: 'AMBER', bg: '#f5e7c8', fg: '#b07a17' };
  return { label: 'RED', bg: 'var(--color-accent-100)', fg: '#c2280f' };
}

// source line 131 — higher better
function ragPct(v, g, a) {
  if (v == null) return { bg: 'var(--color-neutral-200)', fg: 'var(--color-neutral-500)' };
  if (v >= g) return { bg: '#dcefe2', fg: '#2f7d4f' };
  if (v >= a) return { bg: '#f5e7c8', fg: '#7a5510' };
  return { bg: 'var(--color-accent-100)', fg: '#c2280f' };
}

module.exports = { dUTC, days, median, isOpenNow, effClose, openAt, eMetrics, composite, twoMoves, rag, ragPct, ANCHOR };
