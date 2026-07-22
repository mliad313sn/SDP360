// tests/report-template-coordinator.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
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

// ── the asset-effort block (Task 1) ──────────────────────────────────────────
// effortForSite → { score, rank, of, delta } | null. When present, the block
// states the site's parc-hygiene standing; when absent, NOTHING is emitted —
// the section must be spread-inserted, never injected as an empty string (that
// would add a stray '\n' and break the byte-for-byte monthly goldens).
test('renders the asset-effort block with score, rank, of, and signed delta', () => {
  const withEffort = { ...data, assetEffort: { score: 71, rank: 3, of: 9, delta: 5 } };
  const { htmlBody } = composeCoordinator(withEffort);
  assert.match(htmlBody, /Tenue du parc/);        // the section marker
  assert.match(htmlBody, /71/);                    // score /100
  assert.match(htmlBody, /#3/);                    // rank
  assert.match(htmlBody, /9 sites/);               // of
  assert.match(htmlBody, /\+5/);                   // signed delta
});

test('a report with NO assetEffort emits no effort section at all', () => {
  const { htmlBody } = composeCoordinator(data);   // base fixture carries no assetEffort
  assert.ok(!/Tenue du parc/.test(htmlBody), 'the effort section must be absent, not an empty stub');
});

test('assetEffort with null delta omits the delta line but still renders score+rank', () => {
  const withEffort = { ...data, assetEffort: { score: 44, rank: 8, of: 9, delta: null } };
  const { htmlBody } = composeCoordinator(withEffort);
  assert.match(htmlBody, /Tenue du parc/);
  assert.match(htmlBody, /44/);
  assert.match(htmlBody, /#8/);
  assert.ok(!/~30/.test(htmlBody), 'no evolution line when delta is null');
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

// ── Technicians: an unknown average is not a fast one ────────────────────────
// reports-db.js:1896 emits avg_resolution_h: null DELIBERATELY (the `+null === 0`
// trap is commented at its site). num(null) is 0, so the row used to read
// "Resolved 0 · 0h" — the best possible average handed to whoever closed
// nothing at all.

test('a technician with NO resolution average renders "—", never "0h"', () => {
  const d = JSON.parse(JSON.stringify(data));
  d.technicians = [{ name: 'Amina', assigned: 4, resolved: 0, avg_resolution_h: null, reopened: 0, current_load: 4, alerts: [] }];
  const { htmlBody } = composeCoordinator(d);
  assert.ok(!/>0h</.test(htmlBody), 'nothing was resolved — there is no average to state');
  assert.match(htmlBody, />&mdash;<\/td>|>—<\/td>/, 'the cell states the absence');
});

test('a technician with a genuine 0h average still prints 0h', () => {
  const d = JSON.parse(JSON.stringify(data));
  d.technicians = [{ name: 'Amina', assigned: 4, resolved: 4, avg_resolution_h: 0, reopened: 0, current_load: 1, alerts: [] }];
  const { htmlBody } = composeCoordinator(d);
  assert.match(htmlBody, />0h</, 'a real measured 0 is a measurement, not an absence');
});

test('an undefined resolution average is treated as absent too', () => {
  const d = JSON.parse(JSON.stringify(data));
  d.technicians = [{ name: 'Amina', assigned: 4, resolved: 0, reopened: 0, current_load: 4, alerts: [] }];
  const { htmlBody } = composeCoordinator(d);
  assert.ok(!/>0h</.test(htmlBody));
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

// ── Recommendations: silence is not good news on an unmeasured site ──────────
// _recommend (siteReport.js:120-127) only pushes on a POSITIVE signal, so zero
// data yields an empty list — and the renderer used to reward that with
// "Nothing needs your attention this period." in the same email whose first card
// reads "Score non applicable — aucune donnée".

test('no recommendations + an UNSCORED site → says there is no data, not "nothing to do"', () => {
  const { htmlBody } = composeCoordinator({ ...naData, recommended: [] });
  assert.ok(!/Nothing needs your attention/.test(htmlBody),
    'the same email says "aucune donnée" in card 1 — it cannot reassure in card 8');
  assert.match(htmlBody, /Aucune donn&eacute;e sur la p&eacute;riode/);
});

test('no recommendations + a SCORED site keeps the reassuring message', () => {
  const { htmlBody } = composeCoordinator({ ...data, recommended: [] });
  assert.match(htmlBody, /Nothing needs your attention this period/,
    'the site WAS measured and nothing was flagged — that is real good news');
});

test('applicable:false still composes the rest of the report', () => {
  const { htmlBody, subject } = composeCoordinator(naData);
  assert.match(subject, /Hounde/);
  assert.match(htmlBody, /Network/);               // helpdesk section intact
  assert.ok(htmlBody.length > 200);
});

// ── The intro ────────────────────────────────────────────────────────────────
// It exists to stop a coordinator reading "25/100 OFF TRACK" as a verdict on
// their service while their team is drowning in tickets. The score measures the
// PROGRAMME, not the service — if that sentence ever goes missing, the number
// becomes unfair on exactly the sites that need it least.

test('the intro says what the score is — and what it is NOT', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /What this score measures/);
  assert.match(htmlBody, /not<\/strong> a rating of IT service quality/,
    'the disclaimer is the whole point — a busy site can score low');
  assert.match(htmlBody, /Ce que mesure cette note/, 'the FR half must ship too');
  assert.match(htmlBody, /pas<\/strong> une note sur la qualit/);
});

test('the intro is bilingual in BOTH halves — an email cannot toggle', () => {
  const { htmlBody } = composeCoordinator(data);
  // Stacked, not switched: the coordinator email has no JS. If someone later
  // "tidies" this into a toggle, the FR half silently vanishes in Outlook.
  for (const fr of [/r&eacute;unions d&eacute;partementales/, /PV sign&eacute;s/, /Commencez par les deux actions/]) {
    assert.match(htmlBody, fr);
  }
});

test('the intro does NOT point at moves when there are none (applicable:false)', () => {
  const { htmlBody } = composeCoordinator(naData);
  assert.match(htmlBody, /What this score measures/, 'the explanation still helps — it says what is missing');
  assert.ok(!/Start with the two moves/.test(htmlBody), 'no moves exist on an unscored site');
  assert.ok(!/Commencez par les deux actions/.test(htmlBody));
});

test('the intro does NOT repeat the rolling-window disclosure', () => {
  // scoreHero already prints it WITH the real dates. Saying it twice, once
  // without dates, is worse than saying it once.
  const { htmlBody } = composeCoordinator(data);
  assert.strictEqual((htmlBody.match(/rolling window/g) || []).length, 1);
});

test('the page and the email carry the SAME intro wording', () => {
  // One product, two surfaces. They drift the moment nobody checks — and they
  // ALREADY did once: an earlier version of this test compared only the four
  // headline phrases, so the page kept saying "reviews held, issues resolved"
  // while the email had moved to "reviews, issues closed" and it stayed green.
  // Compare the WHOLE English sentence, normalised for markup and entities.
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'site-report.html'), 'utf8');
  const { htmlBody } = composeCoordinator(data);
  const plain = (html) => html
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ').replace(/&rsquo;/g, '’')
    .replace(/\s+/g, ' ');
  const EN = 'What this score measures — how well the site keeps up the Group IT operating routine: '
           + 'departmental reviews, issues closed, inspections run, PVs signed. It is not a rating of '
           + 'IT service quality: a busy site can score low if it skips its reviews, a quiet one can '
           + 'score well. Start with the two moves — the highest-value gaps you can close this month.';
  assert.ok(plain(page).includes(EN), 'site-report.html has drifted from the email');
  assert.ok(plain(htmlBody).includes(EN), 'coordinator.js has drifted from the page');

  // The FR half: compare on the accent-free spine, since the email entity-escapes.
  const FR = 'Ce que mesure cette note';
  assert.ok(plain(page).includes(FR) && plain(htmlBody).includes(FR));
  assert.ok(plain(page).includes('Commencez par les deux actions'));
});

// ── The RAG legend ───────────────────────────────────────────────────────────
// `G≥8 A5–7 R<5` under every dimension is the AUTHOR's own text (source :182) —
// a faithful port, not ours to reword. So the legend decodes it instead.

test('the legend decodes G/A/R into plain words, in both languages', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /Reading the colours \(RAG\)/);
  assert.match(htmlBody, /reen = on track/);
  assert.match(htmlBody, /mber = at risk/);
  assert.match(htmlBody, /ed = off track/);
  assert.match(htmlBody, /Lire les couleurs \(RAG\)/);
  assert.match(htmlBody, /dans les clous/);
  assert.match(htmlBody, /d&eacute;croch&eacute;/);
});

test('the legend quotes a real dim band and the real score bands', () => {
  const { htmlBody } = composeCoordinator(data);
  // The example must be a band that actually appears under a dimension.
  assert.ok(data.score.dims.some((d) => d.tip.includes('G≥8 A5–7 R<5')),
    'the fixture must still carry the band the legend quotes');
  assert.match(htmlBody, /G&#8805;8 A5&ndash;7 R&lt;5/);
  // rag2(): >=70 GREEN, >=45 AMBER, else RED (services/siteScore.js).
  assert.match(htmlBody, /green &#8805;70, amber 45&ndash;69, red below 45/);
});

test('the legend is NOT rendered when there is nothing to colour', () => {
  // applicable:false → no chip, no dims, no moves. A legend would decode
  // colours the reader cannot see.
  const { htmlBody } = composeCoordinator(naData);
  assert.ok(!/Reading the colours/.test(htmlBody));
  assert.ok(!/Lire les couleurs/.test(htmlBody));
});

test('the score chip says what the colour MEANS — the page and email agree', () => {
  // The email used to print a bare "RED" while the page said "Off track".
  const red = JSON.parse(JSON.stringify(data)); red.score.rag = 'RED';
  assert.match(composeCoordinator(red).htmlBody, /Off track/);
  assert.ok(!/>RED</.test(composeCoordinator(red).htmlBody), 'no bare colour name as the verdict');
  const green = JSON.parse(JSON.stringify(data)); green.score.rag = 'GREEN';
  assert.match(composeCoordinator(green).htmlBody, /On track/);
  assert.match(composeCoordinator(data).htmlBody, /At risk/);   // amber fixture
  // …and the page's own mapping, so the two cannot drift apart.
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'site-report.js'), 'utf8');
  ['On track', 'Off track', 'At risk'].forEach((l) => assert.ok(js.includes(l), `page is missing: ${l}`));
});

test('the page can hide its legend and its moves pointer', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'site-report.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'site-report.js'), 'utf8');
  assert.match(page, /class="intro-p intro-legend"/, 'the legend must be targetable');
  assert.match(js, /intro-legend/, 'renderScoreNA must hide it');
});

test('the page can hide its moves pointer — it is a real element, not a bare sentence', () => {
  // The page's intro is static markup: without these hooks, site-report.js
  // cannot drop the pointer on an unscored site the way the email does, and the
  // two surfaces would disagree on exactly the report that needs care.
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'site-report.html'), 'utf8');
  assert.match(page, /id="introMovesEn"/);
  assert.match(page, /id="introMovesFr"/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'site-report.js'), 'utf8');
  assert.match(js, /introMovesEn/, 'renderScoreNA must hide it');
  assert.match(js, /introMovesFr/);
});

// The gate keys on applicable === false, so a legacy/degraded score block with
// no `applicable` field renders exactly as before.
test('a score with no applicable field renders the normal hero', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /58/);
  assert.ok(!/Score non applicable/.test(htmlBody));
});
