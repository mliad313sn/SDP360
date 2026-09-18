// tests/report-template-weekly.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { composeWeekly } = require('../services/reportTemplates/weekly');

// The shape loadWeeklyReportData returns (services/weeklyReportData.js:203) plus
// `pptxFailed` from the sender, plus `site_code` — which neither getReport nor
// the loader supplies (the `sites` table has no code column: reports-db.js:30),
// so the sender passes back the code it was called with.
function fixture() {
  return {
    site_code: 'HGO',
    week: { year: 2026, week: 30, label: 'W30 2026', start: '2026-07-20', end: '2026-07-26' },
    pptxFailed: false,
    report: {
      id: 11,
      status: 'submitted',
      year: 2026,
      week_number: 30,
      start_date: '2026-07-20',
      end_date: '2026-07-26',
      week_label: 'W30 2026',
      site_name: 'Hounde',
      zoho_group: 'Hounde IT Agents',
      infra_kpis: [
        { service: 'WAN1 Fetekro', kpi: 'Availability', target: '99.5%', status_value: '99.8%', status_color: 'green', trend: 'up' },
        { service: 'Radio network', kpi: 'Coverage', target: '95%', status_value: '88%', status_color: 'orange', trend: 'down' },
        { service: 'Backup', kpi: 'Success rate', target: '100%', status_value: '72%', status_color: 'red', trend: 'stable' },
      ],
      helpdesk: {
        time_to_assign: 1.4,
        time_to_assign_prev: 2.1,
        first_reply: 0.8,
        first_reply_prev: null,
        resolution_time: null,
        resolution_time_prev: null,
        closing_time: 12.5,
        closing_time_prev: 11.0,
        comments_metrics: 'Volume stable cette semaine',
        comments_sla: 'Deux violations sur la categorie reseau',
        techs_on_duty: 'Ali, Fatou',
        tech_on_break: 'Moussa',
        fetched_at: '2026-07-27T06:15:00.000Z',
        chart_data: { group: 'x', weeks: [1, 2, 3] },
        group_metrics: [{ label: 'W30' }],
        all_groups: ['a', 'b'],
      },
      lights: [
        { type: 'high_light', content: 'Migration du serveur de fichiers terminee' },
        { type: 'low_light', content: 'Coupure electrique de 3h le mardi' },
        { type: 'change_in_progress', content: 'Deploiement du nouveau firewall' },
        { type: 'change_pending', content: 'Remplacement des switchs coeur' },
      ],
      action_items: [
        { task: 'Commander les onduleurs de remplacement', priority: 'High', due_date: '2026-08-05', owner: 'Ali', status: 'open' },
        { task: 'Revoir la politique de sauvegarde', priority: 'Medium', due_date: '2026-08-12', owner: 'Fatou', status: 'in_progress' },
      ],
    },
    assets: {
      hygiene: { no_owner: 14, never_scanned: 3 },
      effort: { effort_score: 72, rank: 2 },
    },
  };
}

// ── 1 · subject ──────────────────────────────────────────────────────────────
// "weekly" with no dates is exactly the ambiguity this feature removes.
test('the subject carries the site code, the week label AND the date range', () => {
  const { subject } = composeWeekly(fixture());
  assert.match(subject, /HGO/, 'site code');
  assert.match(subject, /W30 2026/, 'week label');
  assert.match(subject, /2026-07-20/, 'range start');
  assert.match(subject, /2026-07-26/, 'range end');
});

// ── 2 · the authored content is the point of the email ───────────────────────
test("renders the coordinator's authored content", () => {
  const { htmlBody } = composeWeekly(fixture());
  assert.match(htmlBody, /WAN1 Fetekro/, 'infra_kpis service');
  assert.match(htmlBody, /Availability/, 'infra_kpis kpi');
  assert.match(htmlBody, /Migration du serveur de fichiers/, 'lights content');
  assert.match(htmlBody, /Commander les onduleurs/, 'action_items task');
});

// ── 3 · status_color is green|orange|red|none — NOT amber ────────────────────
// reports-db.js:90 stores 'orange'; RAG_COLORS is keyed 'amber'. A naive
// RAG_COLORS[status_color] returns undefined for every warning KPI.
test("status_color 'orange' renders the AMBER hex, never the string undefined", () => {
  const { htmlBody } = composeWeekly(fixture());
  assert.match(htmlBody, /#D97706/i, "'orange' must map to RAG_COLORS.amber");
  assert.ok(!/undefined/.test(htmlBody), 'no "undefined" may leak into the markup');
});

test("status_color 'none' renders with no RAG colour and no undefined", () => {
  const d = fixture();
  d.report.infra_kpis = [
    { service: 'Printer fleet', kpi: 'Uptime', target: '—', status_value: 'n/a', status_color: 'none', trend: 'no_change' },
  ];
  // Lights group labels and action priorities carry RAG colours of their own and
  // legitimately so — empty them, leaving the KPI as the ONLY possible source.
  d.report.lights = [];
  d.report.action_items = [];
  const { htmlBody } = composeWeekly(d);
  assert.match(htmlBody, /Printer fleet/);
  assert.ok(!/undefined/.test(htmlBody), 'no "undefined" may leak into the markup');
  assert.ok(!/#16A34A|#D97706|#DC2626/i.test(htmlBody), "'none' must paint no RAG colour");
});

// ── 4 · the four lights types ────────────────────────────────────────────────
test('all four lights types render under distinct labels', () => {
  const { htmlBody } = composeWeekly(fixture());
  assert.match(htmlBody, /Migration du serveur/, 'high_light');
  assert.match(htmlBody, /Coupure electrique/, 'low_light');
  assert.match(htmlBody, /Deploiement du nouveau firewall/, 'change_in_progress');
  assert.match(htmlBody, /Remplacement des switchs/, 'change_pending');

  // four DISTINCT group headings, not one merged list
  const labels = ['Points positifs', 'Points d&rsquo;attention', 'Changements en cours', 'Changements planifi&eacute;s'];
  for (const l of labels) assert.ok(htmlBody.includes(l), `missing lights group label: ${l}`);
});

// ── 5 · the human-authored helpdesk commentary ───────────────────────────────
test('renders comments_metrics and comments_sla', () => {
  const { htmlBody } = composeWeekly(fixture());
  assert.match(htmlBody, /Volume stable cette semaine/);
  assert.match(htmlBody, /Deux violations sur la categorie reseau/);
});

test('an empty helpdesk object states so in French — not blank, not undefined', () => {
  const d = fixture();
  d.report.helpdesk = {};
  const { htmlBody } = composeWeekly(d);
  assert.match(htmlBody, /Aucune donn&eacute;e/i, 'a stated "no helpdesk data" note');
  assert.ok(!/undefined/.test(htmlBody));
});

test('null timing columns are omitted, non-null ones render', () => {
  const { htmlBody } = composeWeekly(fixture());
  // kpiGrid escapes its labels, so accents there are literal characters — the
  // entity form is only used in the hand-written raw copy (lights, notes).
  assert.match(htmlBody, /Prise en charge/, 'time_to_assign is non-null → rendered');
  assert.ok(!/Résolution/.test(htmlBody), 'resolution_time is null → omitted');
  assert.match(htmlBody, /Clôture/, 'closing_time is non-null → rendered');
});

// ── 6 · order: their work first, the CMDB reminder after ─────────────────────
test('the authored report appears BEFORE the assets block', () => {
  const { htmlBody } = composeWeekly(fixture());
  const authored = htmlBody.indexOf('WAN1 Fetekro');
  const assets = htmlBody.indexOf('Parc informatique');
  assert.ok(authored > -1 && assets > -1, 'both markers present');
  assert.ok(authored < assets, "the coordinator's report must lead, not the CMDB reminder");
});

// ── 6b · the meeting report carries NO link into Assets (2026-09-18) ────────
// The weekly e-mail is the document presented in the meeting: counts only, as
// plain text. The reminder e-mails (assetReminderReport.js) keep their links.
test('even with base_url + one label, the hygiene counts are plain text — no Assets link', () => {
  const d = fixture();
  d.base_url = 'https://itops-dashboard.edv-ops.com';
  d.assets.labels = ['Hounde'];
  const { htmlBody, fullHtml } = composeWeekly(d);
  assert.ok(!htmlBody.includes('assets.html'), 'no assets.html link in the body');
  assert.ok(!fullHtml.includes('assets.html'), 'no assets.html link in the preview/PDF');
  assert.ok(!/<a\s/i.test(htmlBody), 'no anchor at all in the weekly e-mail');
  assert.ok(htmlBody.includes('14'), 'the count itself is still reported');
});

test('without base_url the counts stay plain text — never a guessed origin', () => {
  const d = fixture();
  d.assets.labels = ['Hounde'];                 // labels present, origin absent
  const { htmlBody } = composeWeekly(d);
  assert.ok(!htmlBody.includes('assets.html?'), 'no link at all');
  assert.ok(htmlBody.includes('14'), 'the count itself is still reported');
});

// A code folding to SEVERAL labels gets NO link: the count is the SUM across
// them, so linking one label would open a list smaller than the number promises.
test('a multi-label site (SGO ← Sabodala + MASSAWA) is not linked', () => {
  const d = fixture();
  d.base_url = 'https://itops-dashboard.edv-ops.com';
  d.assets.labels = ['Sabodala', 'MASSAWA'];
  const { htmlBody } = composeWeekly(d);
  assert.ok(!htmlBody.includes('assets.html?'), 'no partial link');
  assert.ok(htmlBody.includes('14'), 'the summed count is still reported');
});

// ── 7 · no assets → no section at all (zeros would read as a clean site) ─────
test('assets:null omits the assets section entirely', () => {
  const d = fixture();
  d.assets = null;
  const { htmlBody } = composeWeekly(d);
  assert.ok(!htmlBody.includes('Parc informatique'), 'no assets card');
  assert.ok(!/undefined/.test(htmlBody));
});

// ── 8 · the PPTX footnote ────────────────────────────────────────────────────
test('pptxFailed toggles the footer note', () => {
  const failed = composeWeekly(Object.assign(fixture(), { pptxFailed: true }));
  assert.match(failed.htmlBody, /pr&eacute;sentation/i, 'a note when the deck could not be attached');

  const ok = composeWeekly(fixture());
  assert.ok(!/pr&eacute;sentation/i.test(ok.htmlBody), 'no note when the deck attached fine');
});

// ── 9 · snapshot staleness must be visible ───────────────────────────────────
test('fetched_at renders in the footer', () => {
  const { htmlBody } = composeWeekly(fixture());
  assert.match(htmlBody, /2026-07-27/, 'the helpdesk snapshot timestamp');
});

// ── 10 · Outlook guard — asserted over htmlBody, which is what Outlook renders
test('the email body carries no flex/grid layout and no CSS var()', () => {
  const { htmlBody } = composeWeekly(fixture());
  // inline-flex is as broken as flex in Outlook's Word renderer
  assert.ok(!/display:\s*(inline-)?(flex|grid)/i.test(htmlBody), 'no flexbox/grid');
  assert.ok(!/var\(--/.test(htmlBody), 'no CSS custom properties');
});

// ── 11 · every free-text field is untrusted ──────────────────────────────────
test('escapes HTML in authored free-text', () => {
  const d = fixture();
  d.report.lights[0].content = '<script>alert(1)</script>';
  const { htmlBody } = composeWeekly(d);
  assert.ok(!/<script>alert/i.test(htmlBody), 'raw tag must not survive');
  assert.match(htmlBody, /&lt;script&gt;/);
});

// ── shape ────────────────────────────────────────────────────────────────────
test('fullHtml wraps htmlBody verbatim in a real document', () => {
  const { htmlBody, fullHtml } = composeWeekly(fixture());
  assert.match(fullHtml, /^<!doctype html>/i);
  assert.ok(fullHtml.includes(htmlBody), 'the PDF and the email must never drift apart');
});

test('a degenerate report does not throw', () => {
  for (const d of [{}, { report: {} }, { report: { infra_kpis: null, lights: null, action_items: null } }]) {
    const out = composeWeekly(d);
    assert.ok(out.subject && out.htmlBody && out.fullHtml);
    assert.ok(!/undefined/.test(out.htmlBody));
  }
});

// ── asset engagement review (2026-09-18) ─────────────────────────────────────
test('absent / null / non-applicable asset_review → byte-identical output', () => {
  const base = composeWeekly(fixture()).htmlBody;
  for (const ar of [undefined, null, { applicable: false, counts: null, handled_note: '', plan_note: '' }]) {
    const f = fixture(); if (ar !== undefined) f.report.asset_review = ar;
    assert.strictEqual(composeWeekly(f).htmlBody, base);
  }
});

test('applicable review renders frozen counts and the notes; empty note = non renseigné', () => {
  const f = fixture();
  f.report.asset_review = { applicable: true, counts: { new: 2, unassigned: 5, no_cost: 7, no_date: 1 }, handled_note: '', plan_note: 'Commande <étiquettes>' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, /Nouveau matériel/);
  assert.match(htmlBody, />7</);
  assert.match(htmlBody, /non renseign&eacute;/);
  assert.match(htmlBody, /Commande &lt;étiquettes&gt;/, 'notes are escaped');
  assert.ok(!htmlBody.includes('<étiquettes>'));
});

test('counts null (assets down at submission) says so, notes still shown', () => {
  const f = fixture();
  f.report.asset_review = { applicable: true, counts: null, handled_note: 'ok', plan_note: 'ok2' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, /Compteurs non disponibles/);
  assert.match(htmlBody, /ok2/);
});

test('assets:null but a frozen applicable review → the review still renders on its own', () => {
  const f = fixture(); f.assets = null;
  f.report.asset_review = { applicable: true, counts: { new: 0, unassigned: 3, no_cost: 0, no_date: 0 }, handled_note: 'h', plan_note: '' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, /Parc informatique/i);
  assert.match(htmlBody, /non renseign&eacute;/);
});

test('assets:null and no review → still no assets card (unchanged)', () => {
  const f = fixture(); f.assets = null;
  assert.ok(!/PARC INFORMATIQUE|Parc informatique/.test(composeWeekly(f).htmlBody));
});

// ── review-block fixes: multi-line notes, null counts (post-review) ──────────
test('a multi-line note preserves its line breaks (white-space:pre-line)', () => {
  const f = fixture();
  f.report.asset_review = { applicable: true, counts: { new: 1, unassigned: 1, no_cost: 1, no_date: 1 }, handled_note: 'Ligne 1\nLigne 2', plan_note: '' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, /white-space:pre-line/, 'the note wrapper preserves newlines');
  assert.match(htmlBody, /Ligne 1\nLigne 2/, 'the raw newline survives escaping');
});

// CLAUDE.md pitfall: `+null === 0` and `+'' === 0`, so `Number.isFinite(+v)`
// ALONE reads null/'' as a legitimate zero. A test that only checks "at least
// one dash is present" does NOT catch this — NaN correctly dashes on its own
// and masks a broken null right next to it. Count the dashes: with the bug,
// null silently becomes "0" (same text as the REAL zero below) and only NaN
// dashes → count is 1, not 2.
test('a null or non-finite count renders "—", never a fabricated 0 (null isolated)', () => {
  const f = fixture();
  f.report.asset_review = { applicable: true, counts: { new: null, unassigned: NaN, no_cost: 0, no_date: 3 }, handled_note: 'x', plan_note: 'y' };
  const { htmlBody } = composeWeekly(f);
  const dashCount = (htmlBody.match(/>&mdash;</g) || []).length + (htmlBody.match(/>—</g) || []).length;
  assert.strictEqual(dashCount, 2, 'BOTH null (new) and NaN (unassigned) must dash — null must not silently become 0');
  assert.strictEqual((htmlBody.match(/>0</g) || []).length, 1, 'exactly ONE real zero (no_cost) renders as 0');
  assert.match(htmlBody, />3</, 'a real count still renders');
});

test('an empty-string count also renders "—" (+"" === 0 is the same trap as +null)', () => {
  const f = fixture();
  f.report.asset_review = { applicable: true, counts: { new: '', unassigned: 2, no_cost: 0, no_date: 3 }, handled_note: 'x', plan_note: 'y' };
  const { htmlBody } = composeWeekly(f);
  const dashCount = (htmlBody.match(/>&mdash;</g) || []).length + (htmlBody.match(/>—</g) || []).length;
  assert.strictEqual(dashCount, 1, "an empty-string count ('') must dash, not render as 0");
});

// ── frozen-wording depends on report.status, not just the presence of a review ─
// The server only STOPS recomputing asset_review counts once status is
// 'submitted' (server.js ~6285); before that every save recomputes them live.
// The weekly e-mail can legitimately go out for a report that is complete but
// never submitted (CLAUDE.md: "weekly_reports.status is FOUR values"), so the
// wording must not claim the counts are frozen when they are not.
test('submitted report: assetReviewBlock says counts are frozen at submission', () => {
  const f = fixture();
  f.report.status = 'submitted';
  f.report.asset_review = { applicable: true, counts: { new: 1, unassigned: 1, no_cost: 1, no_date: 1 }, handled_note: 'x', plan_note: 'y' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, /compteurs fig&eacute;s &agrave; la soumission/);
  assert.ok(!/dernier enregistrement/.test(htmlBody), 'submitted wording must not also carry the other phrasing');
});

test('report not submitted (e.g. status "ready"): assetReviewBlock says counts are as of the last save', () => {
  const f = fixture();
  f.report.status = 'ready';
  f.report.asset_review = { applicable: true, counts: { new: 1, unassigned: 1, no_cost: 1, no_date: 1 }, handled_note: 'x', plan_note: 'y' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, /compteurs au dernier enregistrement/);
  assert.ok(!/fig&eacute;s &agrave; la soumission/.test(htmlBody), 'unsubmitted wording must not claim the counts are frozen');
});

// rev 5 (2026-09-18): the meeting report's review block carries counts + notes
// only — never an asset list nor a link into Assets.
test('review block alone (assets:null) has no asset list and no Assets link', () => {
  const f = fixture(); f.assets = null;
  f.report.asset_review = { applicable: true, counts: { new: 2, unassigned: 1, no_cost: 0, no_date: 4 }, handled_note: 'h', plan_note: 'p' };
  const { htmlBody } = composeWeekly(f);
  assert.ok(!htmlBody.includes('assets.html'), 'no Assets link');
  assert.ok(!/voir dans Assets/i.test(htmlBody));
  assert.match(htmlBody, /Parc informatique/i);
});

// ── colour presentation (2026-09-18) ─────────────────────────────────────────
// The two blocks presented in the meeting carry a coloured header band each,
// with distinct accents: Assistance = NAVY (house), Parc = violet.
function bandRe(accent, title) {
  return new RegExp(`background:${accent};[^>]*>\\s*<div[^>]*>${title}</div>`, 'i');
}

test('Assistance aux utilisateurs and Parc informatique each have a coloured header band', () => {
  const f = fixture();
  f.report.asset_review = { applicable: true, counts: { new: 1, unassigned: 2, no_cost: 3, no_date: 4 }, handled_note: 'x', plan_note: 'y' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, bandRe('#1E293B', 'Assistance aux utilisateurs'), 'helpdesk band = NAVY');
  assert.match(htmlBody, bandRe('#7C3AED', 'Parc informatique'), 'parc band = violet');
});

test('the Parc band also shows when only the frozen review renders (assets:null)', () => {
  const f = fixture(); f.assets = null;
  f.report.asset_review = { applicable: true, counts: { new: 1, unassigned: 2, no_cost: 3, no_date: 4 }, handled_note: 'x', plan_note: '' };
  assert.match(composeWeekly(f).htmlBody, bandRe('#7C3AED', 'Parc informatique'));
});

function withSla(res, fr) {
  const f = fixture();
  f.report.helpdesk.chart_data = { weeks: [
    { label: 'W29', inbound: 38, closed: 30, res_ok_pct: 95, fr_ok_pct: 85 },
    { label: 'W30', inbound: 42, closed: 36, res_ok_pct: res, fr_ok_pct: fr },
  ] };
  return f;
}

test('an SLA tile below target is painted red; one at/above target green', () => {
  const { htmlBody } = composeWeekly(withSla(92, 64));
  // resolution 92 % >= 90 → green; first reply 64 % < 70 (warn) → red
  assert.match(htmlBody, /color:#16A34A;[^>]*>92&nbsp;%</, 'resolution SLA at target → green value');
  assert.match(htmlBody, /color:#DC2626;[^>]*>64&nbsp;%</, 'first-reply SLA below target → red value');
  assert.match(htmlBody, /cible/i, 'the target is stated next to the tile');
  assert.match(htmlBody, /W29/, 'the previous week is quoted for context');
});

test('an SLA tile between warn and target is painted amber', () => {
  const { htmlBody } = composeWeekly(withSla(87, 75));
  assert.match(htmlBody, /color:#D97706;[^>]*>87&nbsp;%</);
  assert.match(htmlBody, /color:#D97706;[^>]*>75&nbsp;%</);
});

test('a null SLA value renders "—" in a neutral colour, never a RAG colour', () => {
  const { htmlBody } = composeWeekly(withSla(null, 88));
  assert.match(htmlBody, /color:#64748B;[^>]*>—</, 'null SLA → neutral dash');
  assert.ok(!/#DC2626;[^>]*>—</.test(htmlBody) && !/#16A34A;[^>]*>—</.test(htmlBody));
});

test('no week data at all → no SLA tiles, no RAG colour from the helpdesk block', () => {
  const f = fixture();
  f.report.lights = []; f.report.action_items = []; f.report.infra_kpis = [];
  const { htmlBody } = composeWeekly(f);           // chart_data.weeks = [1,2,3] (not objects)
  assert.ok(!/SLA de r&eacute;solution|SLA de résolution/.test(htmlBody));
  assert.ok(!/#16A34A|#D97706|#DC2626/i.test(htmlBody));
});

test('« non renseigné » is rendered as an amber attention pill', () => {
  const f = fixture();
  f.report.asset_review = { applicable: true, counts: { new: 1, unassigned: 2, no_cost: 3, no_date: 4 }, handled_note: '', plan_note: 'p' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, /background:#FEF3C7;[^>]*color:#B45309;[^>]*>non renseign&eacute;</);
});

test('filled notes sit in light tinted boxes', () => {
  const f = fixture();
  f.report.asset_review = { applicable: true, counts: { new: 1, unassigned: 2, no_cost: 3, no_date: 4 }, handled_note: 'Etiquetage fait', plan_note: 'Commande' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, /background:#F5F3FF;[^>]*>[\s\S]{0,400}Etiquetage fait/);
});

test('parc counters are neutral (no previous-week counts reach the e-mail) and null reads "—"', () => {
  const f = fixture();
  f.report.lights = []; f.report.action_items = []; f.report.infra_kpis = [];
  f.report.asset_review = { applicable: true, counts: { new: null, unassigned: 2, no_cost: 0, no_date: 4 }, handled_note: 'x', plan_note: 'y' };
  const { htmlBody } = composeWeekly(f);
  assert.match(htmlBody, /color:#64748B;[^>]*>—</, 'null count → neutral dash');
  assert.ok(!/#16A34A|#D97706|#DC2626/i.test(htmlBody), 'no trend colour without a previous week');
});
