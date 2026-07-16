// tests/report-template-coordinator.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { composeCoordinator } = require('../services/reportTemplates/coordinator');

// The sbDims score contract (services/siteScore.js): `score`/`points`, UPPERCASE
// rag, `dims` as an ARRAY of {key,label,val,disp,pts,tip}, `moves` whose `gain`
// is ALREADY a formatted string, and the 3-month rolling `window`.
const data = {
  site_code: 'HGO', site_name: 'Hounde',
  period: { year: 2026, month: 7, kind: 'weekly', label: 'July 2026' },
  score: {
    score: 58, points: 7, rag: 'AMBER', trend_pts: -8,
    window: { from: '2026-04-14', to: '2026-07-14' },
    dims: [
      { key: 'reviews', label: 'Reviews', val: 7, disp: '7', pts: 1, tip: 'reviews held · G≥8 A5–7 R<5' },
      { key: 'resolution', label: 'Resolution', val: 14, disp: '14%', pts: 0, tip: 'resolved ÷ raised · G≥40 A20–39 R<20' },
      { key: 'overdue', label: 'Overdue', val: 2, disp: '2', pts: 1, tip: 'overdue issues + actions · G0 A1–5 R>5' },
      { key: 'inspections', label: 'Inspections', val: 5, disp: '5', pts: 2, tip: 'inspections run · G≥3 A2 R≤1' },
      { key: 'findings', label: 'Findings', val: 6, disp: '6', pts: 0, tip: 'critical+major findings · G0 A1–2 R≥3' },
      { key: 'signoff', label: 'Sign-off', val: 71, disp: '71%', pts: 2, tip: 'minutes fully signed % · G≥70 A30–69 R<30' },
    ],
    moves: [
      { n: 1, gain: '+17 pts', text: 'Lift resolution from 14% toward 40%: run a weekly closure sprint on the oldest in-progress items.' },
      { n: 2, gain: '+17 pts', text: 'Close out 6 critical/major inspection findings with dated corrective actions.' },
    ],
  },
  meetings: { pvs_held: 2, pvs_target: 3, open_issues: 4, high_open: 1, resolved: 6, new: 3, escalations: 1,
              departments: [{ department: 'hse', status: 'blocked' }], overdue_actions: [{ description: 'Fix X', owner: 'Jean', target_date: '2026-07-20' }] },
  inspection: { inspections_done: 1, findings_critical_major: 2, overall_risk: 'major', overdue_actions: [] },
  helpdesk: { created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1, top_categories: [{ category: 'Network', count: 12 }], recurring: [{ label: 'Network / WAN', count: 4 }],
              major_incidents_open: [{ display_id: '311587', subject: 'WAN link down at the plant', status: 'In Progress', overdue: true, created_time: '2026-07-02T08:00:00.000Z', downtime: '4h' }] },
  // Task 1's changes contract — `failed` already includes backed_out; the raw
  // counts survive only under `buckets`. success_pct may be null.
  changes: { buckets: { success: 3, backed_out: 1 }, successful: 3, failed: 1, cancelled: 0, deferred: 0,
             pending: 2, executed: 4, total: 6, emergency: 1, success_pct: 75 },
  technicians: [{ name: 'Amina', assigned: 20, resolved: 18, avg_resolution_h: 6, reopened: 1, current_load: 4, alerts: ['overloaded'] }],
  recommended: [{ kind: 'escalate', text: '1 HIGH issue(s) open — escalate to council if unresolved' }],
};

test('returns subject + htmlBody + fullHtml', () => {
  const r = composeCoordinator(data);
  assert.match(r.subject, /Hounde/);
  assert.match(r.subject, /July 2026/);
  assert.ok(r.htmlBody.length > 200);
  assert.ok(r.fullHtml.length >= r.htmlBody.length);
});

test('email body is Outlook-safe: no <script>, no external CSS link, table-based', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.ok(!/<script/i.test(htmlBody), 'no script tags');
  assert.ok(!/<link[^>]+stylesheet/i.test(htmlBody), 'no external stylesheet');
  assert.match(htmlBody, /<table/i);
});

test('surfaces the score, the points, the RAG, and both moves', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /58/);
  assert.match(htmlBody, /7\s*\/\s*12/);          // points out of 12
  assert.match(htmlBody, /amber/i);
  assert.match(htmlBody, /weekly closure sprint/);
  assert.match(htmlBody, /critical\/major inspection findings/);
});

// REGRESSION GUARD — `gain` arrives already formatted ('+17 pts' / 'sustain').
// The old renderer did `+${gain_pts} pts`; doing that here yields '++17 pts pts'
// and 'sustain' would render as '+0 pts', silently inventing a number.
test('move gain is rendered verbatim — never re-formatted', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /\+17 pts/);
  assert.ok(!/\+\+/.test(htmlBody), 'no double plus');
  assert.ok(!/pts\s*pts/.test(htmlBody), 'no doubled unit');
});

test('a sustain move renders its word, not a fabricated +0 pts', () => {
  const perfect = JSON.parse(JSON.stringify(data));
  perfect.score.moves = [{ n: 1, gain: 'sustain', text: 'All dimensions green — hold cadence and keep the register clean.' }];
  const { htmlBody } = composeCoordinator(perfect);
  assert.match(htmlBody, /sustain/);
  assert.ok(!/\+0 pts/.test(htmlBody));
});

// The score measures a 3-MONTH ROLLING window while every other block is
// monthly. Unlabelled, the two read as a contradiction.
test('the score states its own 3-month window', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /2026-04-14/);
  assert.match(htmlBody, /2026-07-14/);
});

test('renders all six dims with their display value and rating', () => {
  const { htmlBody } = composeCoordinator(data);
  ['Reviews', 'Resolution', 'Overdue', 'Inspections', 'Findings', 'Sign-off'].forEach((l) => assert.match(htmlBody, new RegExp(l)));
  assert.match(htmlBody, /14%/);      // disp, not the raw val
  assert.match(htmlBody, /71%/);
});

test('the UPPERCASE rag resolves to a colour — never the unknown-value grey', () => {
  const green = JSON.parse(JSON.stringify(data));
  green.score.rag = 'GREEN';
  const { htmlBody } = composeCoordinator(green);
  assert.match(htmlBody, /#2f7d4f/i, 'GREEN must map to the dashboard green');
  const red = JSON.parse(JSON.stringify(data));
  red.score.rag = 'RED';
  assert.match(composeCoordinator(red).htmlBody, /#c2280f/i, 'RED must map to the email-safe red (var() cannot resolve in Outlook)');
  // amber from the base fixture
  assert.match(composeCoordinator(data).htmlBody, /#d99a2b/i);
});

// var() does not resolve in Outlook's Word renderer — it would paint nothing.
test('the email body carries no CSS var() colours', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.ok(!/var\(--/.test(htmlBody), 'no CSS custom properties in the email');
});

test('surfaces the recommended actions + the overdue action owner', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /escalate to council/);
  assert.match(htmlBody, /Jean/);
});

test('escapes HTML in free-text (no injection from ticket subjects)', () => {
  const evil = JSON.parse(JSON.stringify(data));
  evil.meetings.overdue_actions[0].description = '<img src=x onerror=alert(1)>';
  const { htmlBody } = composeCoordinator(evil);
  assert.ok(!/<img src=x/i.test(htmlBody), 'raw tag must not survive');
  assert.match(htmlBody, /&lt;img/);
});

// dims/moves are free text too and ALL of them render now.
test('escapes HTML in the score dims and moves', () => {
  const evil = JSON.parse(JSON.stringify(data));
  evil.score.dims[0].label = '<b>Reviews</b>';
  evil.score.dims[0].tip = '<img src=x onerror=alert(1)>';
  evil.score.dims[0].disp = '<i>7</i>';
  evil.score.moves[0].text = '<script>alert(1)</script>';
  evil.score.moves[0].gain = '<b>+17 pts</b>';
  const { htmlBody } = composeCoordinator(evil);
  assert.ok(!/<img src=x/i.test(htmlBody));
  assert.ok(!/<script/i.test(htmlBody));
  assert.ok(!/<b>Reviews<\/b>/.test(htmlBody));
  assert.match(htmlBody, /&lt;img/);
});

// ── the changes card ────────────────────────────────────────────────────────
test('renders the changes card with its counts and the success rate', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /Changes/);
  assert.match(htmlBody, /Successful/);
  assert.match(htmlBody, /Emergency/);
  assert.match(htmlBody, /75%/);
});

test('success_pct null renders a dash — never "0%"', () => {
  const nothing = JSON.parse(JSON.stringify(data));
  nothing.changes = { buckets: {}, successful: 0, failed: 0, cancelled: 0, deferred: 0,
                      pending: 1, executed: 0, total: 1, emergency: 0, success_pct: null };
  const { htmlBody } = composeCoordinator(nothing);
  assert.ok(!/>0%</.test(htmlBody), 'a site with nothing to judge must not read "0% success"');
  assert.match(htmlBody, /&mdash;|—/);
});

// A genuine 0% IS a measurement — the dash is only for "nothing executed".
test('a real 0% still prints 0%, not a dash', () => {
  const bad = JSON.parse(JSON.stringify(data));
  bad.changes = { buckets: { failed: 2 }, successful: 0, failed: 2, cancelled: 0, deferred: 0,
                  pending: 0, executed: 2, total: 2, emergency: 0, success_pct: 0 };
  assert.match(composeCoordinator(bad).htmlBody, />0%</);
});

test('a report with no changes block at all still composes', () => {
  const noChg = JSON.parse(JSON.stringify(data));
  delete noChg.changes;
  assert.ok(composeCoordinator(noChg).htmlBody.length > 200);
});

// PLAIN WORDS. This email goes to site coordinators, not to ITSM staff.
test('the coordinator email carries no ITSM jargon — no "RFC", no "CAB"', () => {
  [data, naData].forEach((d) => {
    const { htmlBody, subject } = composeCoordinator(d);
    assert.ok(!/\bRFC\b/.test(htmlBody), 'no RFC in the body');
    assert.ok(!/\bCAB\b/.test(htmlBody), 'no CAB in the body');
    assert.ok(!/\bRFC\b|\bCAB\b/.test(subject), 'no jargon in the subject');
  });
});

// ── major-incident detail ───────────────────────────────────────────────────
test('open major incidents are listed, not just counted', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /WAN link down at the plant/);
  assert.match(htmlBody, /311587/);
});

test('open major incidents are escaped like every other free-text field', () => {
  const evil = JSON.parse(JSON.stringify(data));
  evil.helpdesk.major_incidents_open[0].subject = '<img src=x onerror=alert(1)>';
  const { htmlBody } = composeCoordinator(evil);
  assert.ok(!/<img src=x/i.test(htmlBody));
  assert.match(htmlBody, /&lt;img/);
});

test('no open major incidents → the list is simply absent, no empty heading', () => {
  const none = JSON.parse(JSON.stringify(data));
  none.helpdesk.major_incidents_open = [];
  const { htmlBody } = composeCoordinator(none);
  assert.ok(!/Open major incidents/.test(htmlBody));
  assert.match(htmlBody, /Major incidents/);   // the KPI tile stays
});

test('empty/zero data still composes without throwing', () => {
  const r = composeCoordinator({ site_code: 'X', period: { label: 'Aug 2026' },
    score: { score: 0, points: 0, rag: 'RED', dims: [], moves: [], window: null },
    meetings: { departments: [], overdue_actions: [] }, inspection: { overdue_actions: [] }, helpdesk: { top_categories: [], recurring: [] },
    technicians: [], recommended: [] });
  assert.ok(r.subject && r.htmlBody);
});

// _safe/degraded paths hand the composer a score with no dims at all.
test('a score block missing every field still composes', () => {
  const r = composeCoordinator({ site_code: 'X', period: { label: 'Aug 2026' }, score: {},
    meetings: {}, inspection: {}, helpdesk: {}, technicians: [], recommended: [] });
  assert.ok(r.htmlBody.length > 200);
});

// applicable:false — the site has no data over the window. Claim no verdict:
// no hero number, no RAG chip, no dims table, no moves.
const naScore = {
  applicable: false, score: null, points: null, rag: null, trend_pts: null,
  dims: [], moves: [], window: { from: '2026-04-14', to: '2026-07-14' },
};
const naData = { ...data, score: naScore };

test('applicable:false renders "non applicable" + the window, and NO number', () => {
  const { htmlBody } = composeCoordinator(naData);
  assert.match(htmlBody, /Score non applicable/);
  assert.match(htmlBody, /aucune donn/);           // "aucune donnée sur la fenêtre"
  assert.match(htmlBody, /2026-04-14/);
  assert.match(htmlBody, /2026-07-14/);
  assert.ok(!/\/100/.test(htmlBody), 'no grey —/100: no verdict is claimed');
});

test('applicable:false omits the dims table and the moves block entirely', () => {
  const { htmlBody } = composeCoordinator(naData);
  assert.ok(!/Two moves that lift the score most/.test(htmlBody), 'no moves block');
  assert.ok(!/G&#8805;8|G≥8|reviews held/.test(htmlBody), 'no dims table');
  assert.ok(!/\/2</.test(htmlBody), 'no 0/2 rating chips');
});

test('applicable:false still composes the rest of the report', () => {
  const { htmlBody, subject } = composeCoordinator(naData);
  assert.match(subject, /Hounde/);
  assert.match(htmlBody, /Network/);               // helpdesk section intact
  assert.ok(htmlBody.length > 200);
});

// The gate keys on applicable === false, so a legacy/degraded score block with
// no `applicable` field renders exactly as before.
test('a score with no applicable field renders the normal hero', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /58/);
  assert.ok(!/Score non applicable/.test(htmlBody));
});
