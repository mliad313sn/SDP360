'use strict';
// I18N-QUALITY (2026-11-21) — French that reads as written by a francophone, not as a word-for-word swap:
//   · a status is never the verb (« Ouvert » in a status place, « Ouvrir » on a button) — context keys 'Key@status';
//   · a sentence split by inline markup is translated WHOLE (no « le suivi du Suivis du rapport »);
//   · the glossary (docs/i18n/GLOSSAIRE-FR.md) wins over variants (Council, gravité, Analyses…);
//   · numbers / dates / weeks follow the language (public/lib/format.js), unknown stays « — »;
//   · raw codes get a label (public/lib/codeLabels.js, generated from the lookup seeds);
//   · form validation errors carry a plain EN + FR sentence (services/userErrors.js), the raw message kept as a code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const DIR = path.join(PUB, 'lib', 'i18n');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const F = require('../public/lib/format.js');
const L = require('../public/lib/codeLabels.js');
const userErrors = require('../services/userErrors');

function allDicts() {
  const out = [];
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.fr.js'))) {
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
    for (const [name, d] of Object.entries(ctx.window)) if (d && typeof d === 'object' && !Array.isArray(d)) out.push({ file: f, name, d });
  }
  return out;
}
function common() { const ctx = { window: {} }; vm.runInNewContext(read('public/lib/i18n/common.fr.js'), ctx); return ctx.window; }

// ── 1. verb / status ─────────────────────────────────────────────────────────────────────────────────────────────
const VERBS = /^(Ouvrir|Fermer|Clôturer|Annuler|Soumettre|Signer|Bloquer|Résoudre|Terminer|Planifier|Valider)\b/;
test('a status-context entry is never a verb, and Open keeps both senses in the common words', () => {
  const c = common().I18N_FR_COMMON;
  assert.equal(c.Open, 'Ouvrir', 'a button "Open" is the verb');
  assert.equal(c['Open@status'], 'Ouvert', 'a status "Open" is the adjective');
  const bad = [];
  for (const { file, d } of allDicts()) for (const [k, v] of Object.entries(d)) if (/@status$/.test(k) && VERBS.test(String(v))) bad.push(`${file}: ${k} → ${v}`);
  assert.deepEqual(bad, []);
});

test('known wrong verb/status mixes are gone (the committee findings)', () => {
  const offenders = [];
  for (const { file, d } of allDicts()) {
    for (const [k, v] of Object.entries(d)) {
      // a status word given the verb: the status labels of lib/statusTransfer.js / md_statuses
      if (/^(Open|open)$/.test(k) && /^Ouvrir/.test(v) && file !== 'common.fr.js') offenders.push(`${file}: "${k}" → "${v}" (verb where a page needs the status)`);
      if (/^(Closed|Resolved|Cancelled|Blocked|Submitted|Signed)(@status)?$/.test(k) && VERBS.test(v)) offenders.push(`${file}: "${k}" → "${v}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

// ── 2. nonsense fragments / glossary variants ────────────────────────────────────────────────────────────────────
const FORBIDDEN = [
  [/le suivi du Suivis/i, 'fragment swap « le suivi du Suivis du rapport »'],
  [/Incubation métier sessions/i, 'English word order « Incubation métier sessions »'],
  [/Council décisions/i, '« Mine IT Council décisions »'],
  [/Enquête IT préoccupations/i, '« Enquête IT préoccupations »'],
  [/\bInsights\b/, 'glossary: Insights → Analyses'],
  [/sévérité/i, 'glossary: Severity → Gravité'],
  [/\b(au|le|du) Conseil\b/, 'glossary: Council → Council (never « Conseil »)'],
  [/Thème Council/, 'glossary: Council theme → Thème du Council'],
  [/Filtrer par site/, 'imperative like the rest of the sentence (« Filtrez »)'],
];
test('no dictionary value carries a known nonsense fragment or an avoided variant', () => {
  const bad = [];
  for (const { file, name, d } of allDicts()) {
    for (const [k, v] of Object.entries(d)) for (const [re, why] of FORBIDDEN) if (re.test(String(v)) && !(k === '· Thème Council')) bad.push(`${file}:${name} "${k.slice(0, 50)}" → ${why}`);
  }
  assert.deepEqual(bad, []);
});

test('dictionary values hold no markup except the inline allow-list (strong, em, b, i, br)', () => {
  const bad = [];
  for (const { file, d } of allDicts()) for (const [k, v] of Object.entries(d)) {
    const tags = String(v).match(/<\/?([a-z0-9]+)\b[^>]*>/gi) || [];
    for (const t of tags) if (!/^<\/?(strong|em|b|i)>$|^<br\s*\/?>$/i.test(t)) bad.push(`${file}: "${k.slice(0, 40)}" has ${t}`);
  }
  assert.deepEqual(bad, []);
});

test('glossary: the I18N-QUALITY glossary exists, is a proposal awaiting a francophone, and spot-checked terms are used', () => {
  const md = read('docs/i18n/GLOSSAIRE-FR.md');
  assert.match(md, /proposition IA, à relire par un francophone \(décision D-2/);
  const rows = [...md.matchAll(/^\| ([^|]+?) \| ([^|]+?) \|/gm)].filter((m) => m[1].trim() !== 'English' && !/^-+$/.test(m[1].trim()));
  assert.ok(rows.length >= 80, `glossary rows (${rows.length})`);
  const G = new Map(rows.map((m) => [m[1].trim(), m[2].trim()]));
  for (const [en, fr] of [['Owner', 'Responsable'], ['Due date', 'Échéance'], ['Severity', 'Gravité'], ['Milestone', 'Jalon'],
    ['Residual risk', 'Risque résiduel'], ['Dual approval', 'Double validation'], ['Portfolio', 'Portefeuille'], ['Committee', 'Comité'],
    ['Inspection', 'Inspection'], ['Action', 'Action'], ['Ticket', 'Ticket'], ['Council theme', 'Thème du Council']]) assert.equal(G.get(en), fr, en);
  // spot-check: these English keys, wherever a dictionary translates them on their own, use the glossary rendering
  const want = { 'Council theme': 'Thème du Council', Owner: 'Responsable', 'Due date': 'Échéance', Severity: 'Gravité', Escalated: 'Escaladé' };
  const bad = [];
  for (const { file, d } of allDicts()) for (const [k, v] of Object.entries(d)) if (want[k] && v !== want[k]) bad.push(`${file}: ${k} → ${v}`);
  assert.deepEqual(bad, []);
});

// ── 3. the translation layer itself (minimal DOM) ───────────────────────────────────────────────────────────────
function fakeDom() {
  class Node {
    constructor(type) { this.nodeType = type; this.childNodes = []; this.parentNode = null; this.attrs = {}; }
    get firstChild() { return this.childNodes[0] || null; }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; }
    removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
    getAttribute(a) { return a in this.attrs ? this.attrs[a] : null; }
    hasAttribute(a) { return a in this.attrs; }
    setAttribute(a, v) { this.attrs[a] = String(v); }
    get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((c) => c.textContent).join(''); }
    cloneNode(deep) {
      const n = this.nodeType === 3 ? doc.createTextNode(this.nodeValue) : doc.createElement(this.tagName);
      if (this.nodeType === 1) { n.attrs = Object.assign({}, this.attrs); n.className = this.className; if (deep) this.childNodes.forEach((c) => n.appendChild(c.cloneNode(true))); }
      return n;
    }
    get innerHTML() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`)).join(''); }
  }
  const doc = {
    createTextNode(v) { const n = new Node(3); n.nodeValue = v; n.ownerDocument = doc; return n; },
    createElement(t) { const n = new Node(1); n.tagName = String(t).toUpperCase(); n.className = ''; n.ownerDocument = doc; return n; },
    documentElement: { lang: 'en', dataset: {} },
  };
  const el = (tag, cls, ...kids) => { const n = doc.createElement(tag); n.className = cls || ''; kids.forEach((k) => n.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k)); return n; };
  doc.body = el('BODY');
  return { doc, el };
}
function install(dicts, html) {
  const { doc, el } = fakeDom();
  const body = doc.body;
  html(el).forEach((n) => body.appendChild(n));
  const win = {};
  const ctx = { window: win, document: doc, localStorage: { getItem: () => 'fr', setItem: () => {} }, navigator: { language: 'fr-FR' }, MutationObserver: class { observe() {} disconnect() {} } };
  win.SDPLabels = L;
  vm.runInNewContext(read('public/lib/i18nText.js'), ctx);
  for (const f of dicts) vm.runInNewContext(read('public/lib/i18n/' + f), ctx);
  const W = ctx.window;
  W.I18nText.install({ dict: W.I18nText.merge(W.I18N_FR_COMMON, W.I18N_FR_LOOKUPS, W.I18N_FR_SITE_ACTIONS, W.I18N_FR_MEETINGS) });
  return { body, I: W.I18nText };
}

test('a sentence split by <strong> is translated whole and keeps its inline tags', () => {
  const src = read('public/site-actions.html').match(/<div class="sa-hero">[\s\S]*?<p>([\s\S]*?)<\/p>/)[1];
  const { body } = install(['common.fr.js', 'site-actions.fr.js'], (el) => {
    const p = el('P');
    for (const part of src.split(/(<strong>[^<]*<\/strong>)/)) {
      const m = part.match(/^<strong>([^<]*)<\/strong>$/);
      p.appendChild(m ? el('STRONG', '', m[1]) : p.ownerDocument.createTextNode(part.replace(/&mdash;/g, '—')));
    }
    return [p];
  });
  const html = body.childNodes[0].innerHTML;
  assert.doesNotMatch(html, /Suivis du rapport|le suivi du|sessions,/, html);
  assert.match(html, /sessions d’<strong>incubation métier<\/strong>/);
  assert.match(html, /<strong>suivis du rapport<\/strong> hebdomadaire/);
  assert.equal((html.match(/<strong>/g) || []).length, 5, 'the five bold words survive');
});

test('status context: an option or a status pill gets the status, a button keeps the verb; raw codes get a label', () => {
  const { body } = install(['common.fr.js', 'site-actions.fr.js'], (el) => [
    el('SELECT', 'sa-status-sel', el('OPTION', '', 'Open'), el('OPTION', '', 'In progress')),
    el('BUTTON', 'btn', 'Open'),
    el('SPAN', 'pill on_track', 'on_track'), el('SPAN', 'status-pill', 'HIGH'), el('SPAN', 'note', 'on_track'),
    el('SELECT', '', el('OPTION', '', 'Survey')), el('SPAN', 'title', 'Survey'),
  ]);
  const t = body.childNodes.map((n) => n.textContent);
  assert.deepEqual(t, ['OuvertEn cours', 'Ouvrir', 'Dans les temps', 'Haute', 'on_track', 'Topographie', 'Survey']);
});

test('I18nText.t() takes the context and strips inline markup from block values', () => {
  const { I } = install(['common.fr.js', 'site-actions.fr.js', 'meetings.fr.js'], () => []);
  assert.equal(I.t('Open'), 'Ouvrir');
  assert.equal(I.t('Open', 'status'), 'Ouvert');
  assert.doesNotMatch(I.t('Single source of truth for the four-level engagement: Department Meetings (monthly per site IT), IT Survey concerns, and Mine IT Council decisions. Issues captured here flow through to the Council view when they cross any of the six escalation criteria. The 5 Engagements monitor tracks site IT discipline.'), /<strong>/);
});

// ── 4. format.js ─────────────────────────────────────────────────────────────────────────────────────────────────
test('format: French and English numbers, percentages, dates, durations, weeks', () => {
  const fr = { lang: 'fr' }, en = { lang: 'en' }, N = ' ';
  assert.equal(F.number(1629, fr), '1' + N + '629'); assert.equal(F.number(1629, en), '1,629');
  assert.equal(F.number(1234.567, { lang: 'fr', decimals: 2 }), '1' + N + '234,57');
  assert.equal(F.percent(73.5, fr), '73,5' + N + '%'); assert.equal(F.percent(73.5, en), '73.5%');
  assert.equal(F.date('2026-01-15', fr), '15 janv. 2026'); assert.equal(F.date('2026-01-15', en), '15 Jan 2026');
  assert.equal(F.dateTime('2026-01-15 07:20:00', fr), '15 janv. 2026 à 07:20 UTC');
  assert.equal(F.dateTime('2026-01-15T07:20:00Z', en), '15 Jan 2026, 07:20 UTC');
  assert.equal(F.duration(46, fr), '1' + N + 'j 22' + N + 'h'); assert.equal(F.duration(46, en), '1d 22h');
  assert.equal(F.duration(0.75, fr), '45' + N + 'min'); assert.equal(F.duration(3.5, fr), '3,5' + N + 'h');
  assert.equal(F.week(45, fr), 'S45'); assert.equal(F.week(45, en), 'W45');
  assert.equal(F.week('2026-W07', fr), 'S7'); assert.equal(F.week('2026-11-21', en), 'W47');
  assert.equal(F.plural(1, 'action ouverte', 'actions ouvertes', fr), 'action ouverte');
  assert.equal(F.plural(0, 'jour', 'jours', fr), 'jour'); assert.equal(F.plural(0, 'day', 'days', en), 'days');
});

test('format: the unknown stays unknown — null / undefined / "" / garbage give "—", never 0', () => {
  for (const lang of ['fr', 'en']) {
    const o = { lang };
    for (const v of [null, undefined, '', 'abc', NaN, Infinity]) {
      assert.equal(F.number(v, o), '—'); assert.equal(F.percent(v, o), '—'); assert.equal(F.duration(v, o), '—');
      assert.equal(F.date(v, o), '—'); assert.equal(F.dateTime(v, o), '—'); assert.equal(F.week(v, o), '—');
    }
    assert.equal(F.week(54, o), '—'); assert.equal(F.duration(-1, o), '—');
    assert.equal(F.number(0, o), '0', 'a measured zero is still shown');
  }
});

test('format: the language follows the page body (translation layer installed → its language; else <html lang>; else English)', () => {
  const run = (g) => { const ctx = { self: g }; vm.runInNewContext(read('public/lib/format.js'), ctx); return ctx.self.SDPFormat.lang(); };
  assert.equal(run({ document: { documentElement: { dataset: { i18n: 'on' }, lang: 'en' } }, I18nText: { lang: () => 'fr' } }), 'fr');
  assert.equal(run({ document: { documentElement: { dataset: {}, lang: 'fr' } } }), 'fr');
  assert.equal(run({ document: { documentElement: { dataset: {}, lang: 'en' } } }), 'en');
  assert.equal(run({}), 'en');
});

test('the shared display helpers use format.js on a French body and stay byte-identical in English', () => {
  const AL = require('../public/lib/analyticsLogic.js');
  assert.equal(AL.fmtNum(1629), '1,629'); assert.equal(AL.fmtPct(73.45), '73.5%');
  const g = globalThis; const saved = { window: g.window };
  g.window = { SDPFormat: Object.assign({}, F, { lang: () => 'fr' }) };
  try { assert.equal(AL.fmtNum(1629), '1 629'); assert.equal(AL.fmtPct(73.45), '73,5 %'); assert.equal(AL.fmtPct(null), '—'); }
  finally { if (saved.window === undefined) delete g.window; else g.window = saved.window; }
  assert.match(read('public/lib/dashboard-shared.js'), /window\.SDPFormat\.duration\(hours, \{ lang: 'fr' \}\)/);
  assert.match(read('public/lib/chartTheme.js'), /f\.number\(n, \{ lang: 'fr' \}\)/);
  assert.match(read('public/lib/dashboardRender.js'), /_frFmt\(\)/);
});

// ── 5. code labels ───────────────────────────────────────────────────────────────────────────────────────────────
test('codeLabels: the generated table matches the lookup seeds (no drift, nothing invented)', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/i18n/build-code-labels.js'), '--check'], { stdio: 'pipe' });
  const m = JSON.parse(read('meetings-init.json')); const ins = JSON.parse(read('inspection-init.json'));
  for (const [kind, rows] of [['department', m.departments], ['category', m.categories], ['intake_source', m.intake_sources], ['severity', m.severities], ['meeting_issue_status', m.statuses], ['council_theme', m.council_themes]]) {
    for (const r of rows) { assert.equal(L.label(kind, r.code, 'fr'), r.name_fr, `${kind}/${r.code}`); assert.equal(L.label(kind, r.code, 'en'), r.name_en); }
  }
  for (const r of ins.statuses) assert.equal(L.label('inspection_finding', r.code, 'fr'), r.label_fr);
});

test('codeLabels: the code sets users meet have a French label (status, RAG, severity, priority, projects)', () => {
  const want = {
    on_track: 'Dans les temps', at_risk: 'À risque', blocked: 'Bloqué', done: 'Terminé', planned: 'Planifié', active: 'Actif',
    in_progress: 'En cours', on_hold: 'En attente', resolved: 'Résolu', cancelled: 'Annulé', open: 'Ouvert',
    HIGH: 'Haute', MEDIUM: 'Moyenne', LOW: 'Basse', high: 'Élevée', medium: 'Moyenne', low: 'Faible',
    GREEN: 'Vert', AMBER: 'Orange', RED: 'Rouge', demand: 'Demande / Initiative', helpdesk_ticket: 'Ticket Helpdesk',
  };
  for (const [code, fr] of Object.entries(want)) assert.equal(L.label('status', code, 'fr'), fr, code);
  assert.equal(L.label('status', 'on_track', 'en'), 'On track');
  assert.equal(L.label('department', 'mining', 'fr'), 'Exploitation minière');
  assert.equal(L.label('intake_source', 'business_incubation', 'fr'), 'Incubation métier');
  assert.equal(L.label('inspection_category', 'env', 'fr'), 'Environnement');
  assert.equal(L.label('status', 'no_such_code', 'fr'), 'no_such_code', 'unknown code shown as is, never guessed');
  assert.equal(L.label('status', null, 'fr'), '—'); assert.equal(L.label('status', '', 'fr'), '—');
  for (const k of L.kinds()) assert.ok(Object.keys(k).length, k);
});

// ── 6. server validation messages ────────────────────────────────────────────────────────────────────────────────
test('form errors: plain EN + FR sentence, raw message kept as error_code, and the page dictionary carries the pair', () => {
  const b = userErrors.body('Missing state.header.department');
  assert.deepEqual(b, { error: 'Choose a department before saving.', error_code: 'Missing state.header.department', error_fr: 'Choisissez un département avant d’enregistrer.' });
  assert.deepEqual(userErrors.body('Something else'), { error: 'Something else' });
  const c = common().I18N_FR_COMMON;
  for (const m of Object.values(userErrors.MESSAGES)) { assert.equal(c[m.en], m.fr, m.en); assert.doesNotMatch(m.en, /state\.|_code|\bD\b in/); }
});

test('form errors: httpError.fail decorates an exposed validation message, never a 5xx', () => {
  const { fail } = require('../services/httpError');
  const res = () => { const r = { req: {}, headersSent: false, set() {}, status(s) { r.s = s; return r; }, json(j) { r.j = j; return r; } }; return r; };
  const origErr = console.error; console.error = () => {};
  try {
    const r1 = res(); fail(r1, new Error('Missing meeting_date'), 400);
    assert.equal(r1.s, 400); assert.equal(r1.j.error, 'Enter the meeting date before saving.'); assert.equal(r1.j.error_code, 'Missing meeting_date');
    const r2 = res(); fail(r2, new Error('Missing meeting_date'));
    assert.equal(r2.s, 500); assert.equal(r2.j.error, 'internal_error');
  } finally { console.error = origErr; }
  const src = read('routes/meetings.js');
  for (const raw of ['Missing site_code', 'Missing department', 'Missing meeting_date']) assert.ok(src.includes(`fail(res, typed('VALIDATION', '${raw}'), 400)`), raw);
});
