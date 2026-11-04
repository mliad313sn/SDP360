'use strict';
// A-09a — French on the coordinator pages, behind one switch (report_config ui_i18n_pages).
//   (a) every translated page loads lib/i18nText.js + the common dictionary + its own dictionary + the guarded boot;
//   (b) the boot installs only when window.__uiPolicy.i18n_pages === '1' (today: '0' → the page stays English);
//   (c) every static text / placeholder / title / aria-label of a translated page has a French entry, minus a
//       per-page ALLOW list that says why; the React tracker's runtime keys all exist in its source;
//   (d) every page that loads the shell is translated, translates itself, or is on an explicit to-do list.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/\r\n/g, '\n');

const TRANSLATED_PAGES = {
  'site-actions.html': { dict: 'I18N_FR_SITE_ACTIONS', file: 'site-actions.fr.js' },
  'meeting.html': { dict: 'I18N_FR_MEETING', file: 'meeting.fr.js' },
  'inspection.html': { dict: 'I18N_FR_INSPECTION', file: 'inspection.fr.js' },
  'activity-tracker.html': { dict: 'I18N_FR_ACTIVITY_TRACKER', file: 'activity-tracker.fr.js', jsx: 'activity-tracker/App.jsx' },
};

// Static strings deliberately left untranslated, with the reason.
const ALREADY_FR = 'already French';
const ALLOW = {
  'site-actions.html': {},
  'meeting.html': {},
  'inspection.html': {
    'EM': 'brand initials', 'Date': 'same word in French', 'Type': 'same word in French', 'Site': 'same word in French',
    'Progress': 'common', '🇬🇧 EN': 'dictation-language button (speech model), not the UI language',
    'La': ALREADY_FR, 'caméra': ALREADY_FR, 'et le': ALREADY_FR, 'microphone': ALREADY_FR,
    'ne fonctionnent pas quand le fichier est ouvert depuis le gestionnaire de fichiers.': ALREADY_FR,
    'Appuyez longuement sur le fichier': ALREADY_FR, 'IT_Inspection_SDP.html': 'file name', 'Choisissez': ALREADY_FR,
    '"Ouvrir avec"': ALREADY_FR, 'Chrome': 'product name', 'Ou copiez ce fichier sur un serveur web interne (HTTPS)': ALREADY_FR,
    'Houndé (HGO) — Burkina Faso': 'proper names', 'Mana (MGO) — Burkina Faso': 'proper names', "Ity (SMI) — Côte d'Ivoire": 'proper names',
    "Lafigué (SML) — Côte d'Ivoire": 'proper names', 'Kalana (KGO) — Mali': 'proper names',
    "L'auto-sauvegarde envoie déjà chaque modification. Le bouton ci-dessous marque l'inspection comme terminée et prête à être revue.": ALREADY_FR,
  },
  'activity-tracker.html': {},
};

// Shell pages that already translate their own body (data-lng blocks or their own I18nText install).
const SELF_TRANSLATED = ['cockpit.html', 'commitments.html', 'handoffs.html', 'help.html', 'infra-health.html', 'meetings-compliance.html',
  'meetings-import.html', 'meetings-insights.html', 'obligations.html', 'policies.html', 'site-awareness.html'];
// Shell pages not translated yet, with the reason (A-09b covers the coordinator pages listed there).
const UNTRANSLATED = {
  'reports.html': 'A-09b', 'assets.html': 'A-09b', 'wan.html': 'A-09b', 'trackers.html': 'A-09b', 'portfolio.html': 'A-09b', 'rfi.html': 'A-09b',
  'analytics.html': 'executive / group audience, English', 'executive.html': 'executive audience, English',
  'executive-report.html': 'deck builder, decks stay English (D-2)', 'it-review.html': 'faithful port of the executive dashboard, English',
  'index.html': 'helpdesk dashboard, group audience, English', 'integrations.html': 'admin console, English', 'system-logs.html': 'admin console, English',
  'dashboard-composer.html': 'admin authoring, English', 'dashboards.html': 'group dashboards, English', 'report-studio.html': 'report authoring, English',
  'tracker-builder.html': 'admin authoring, English', 'notifications.html': 'not a coordinator field page yet',
  'inspections.html': 'list page — next pass', 'inspection-actions.html': 'list page — next pass', 'meetings.html': 'list page — next pass',
  'meetings-actions.html': 'list page — next pass', 'meetings-council.html': 'list page — next pass', 'meetings-issues.html': 'list page — next pass',
  'meetings-progress.html': 'list page — next pass', 'meetings-setup.html': 'admin setup — next pass', 'meetings-unsigned.html': 'list page — next pass',
};

const norm = (t) => t.replace(/\s+/g, ' ').trim();
const ENT = { '&amp;': '&', '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&mdash;': '—', '&middot;': '·', '&hellip;': '…', '&rarr;': '→' };
const dec = (s) => s.replace(/&[a-z#0-9]+;/g, (e) => (e in ENT ? ENT[e] : e));
function staticStrings(html) {
  let body = html.slice(html.indexOf('<body'));
  body = body.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<template\b[\s\S]*?<\/template>/gi, '');
  const texts = [...body.matchAll(/>([^<>]+)</g)].map((m) => norm(dec(m[1])));
  const attrs = [...body.matchAll(/\s(?:placeholder|aria-label|title)="([^"]+)"/g)].map((m) => norm(dec(m[1])));
  return [...new Set([...texts, ...attrs])].filter((t) => /[A-Za-z]{2}/.test(t));
}
function loadDicts(file) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(PUB, 'lib', 'i18n', 'common.fr.js'), 'utf8'), ctx);
  vm.runInNewContext(fs.readFileSync(path.join(PUB, 'lib', 'i18n', file), 'utf8'), ctx);
  return ctx.window;
}

for (const [page, spec] of Object.entries(TRANSLATED_PAGES)) {
  test(`${page}: loads i18nText, the common and page dictionaries, then the guarded boot`, () => {
    const html = read(page);
    const pos = (src) => html.search(new RegExp(`src="${src.replace(/[.]/g, '\\.')}"`));
    const order = ['lib/i18nText.js', 'lib/i18n/common.fr.js', `lib/i18n/${spec.file}`, 'lib/i18n/boot.js'].map(pos);
    assert.ok(order.every((p) => p > 0), `all four scripts present (${order})`);
    assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order, 'loaded in that order');
    assert.match(html, new RegExp(`src="lib/i18n/boot\\.js" data-dict="${spec.dict}"`));
    assert.match(html, /<html lang="en">/, 'the page stays lang="en" by default (only the install switches it)');
  });

  test(`${page}: every static text and label has a French entry (minus the documented allow-list)`, () => {
    const w = loadDicts(spec.file);
    const dict = Object.assign({}, w.I18N_FR_COMMON, w[spec.dict]);
    assert.ok(Object.keys(w[spec.dict]).length > 0, 'page dictionary not empty');
    const allow = ALLOW[page] || {};
    const missing = staticStrings(read(page)).filter((t) => !(t in dict) && !(t in allow));
    assert.deepStrictEqual(missing, [], 'missing French entries');
    for (const [k, v] of Object.entries(allow)) assert.ok(v && v.length > 3, `allow-list entry "${k}" has a reason`);
    for (const [k, v] of Object.entries(w[spec.dict])) assert.strictEqual(typeof v, 'string', `${k} → string`);
    assert.ok(Array.isArray(w[spec.dict + '_RUNTIME']), 'runtime keys listed');
  });
}

test('activity tracker: every runtime key exists in App.jsx (the dictionary cannot drift from the React source)', () => {
  const w = loadDicts('activity-tracker.fr.js');
  const src = norm(dec(read('activity-tracker/App.jsx')));
  const gone = Array.from(w.I18N_FR_ACTIVITY_TRACKER_RUNTIME).filter((k) => !src.includes(k));
  assert.deepStrictEqual(gone, []);
});

test('the boot installs only when ui_i18n_pages is on, and marks <html data-i18n="on">', () => {
  const src = read('lib/i18n/boot.js');
  function run(policy) {
    const calls = []; const de = { dataset: {} };
    const win = { __uiPolicy: policy, I18N_FR_COMMON: { Save: 'Enregistrer' }, I18N_FR_X: { Hi: 'Salut' },
      I18nText: { install: (o) => calls.push(o), merge: (...d) => Object.assign({}, ...d) },
      document: { currentScript: { dataset: { dict: 'I18N_FR_X' } }, documentElement: de, body: { id: 'body' }, getElementById: () => null } };
    win.window = win;
    vm.runInNewContext(src, win);
    return { calls, de };
  }
  assert.strictEqual(run({ i18n_pages: '0' }).calls.length, 0, 'today: nothing installed');
  assert.strictEqual(run(undefined).calls.length, 0, 'no policy: nothing installed');
  const on = run({ i18n_pages: '1' });
  assert.strictEqual(on.calls.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(on.calls[0].dict)), { Save: 'Enregistrer', Hi: 'Salut' });
  assert.strictEqual(on.calls[0].storageKey, 'ui_lang');
  assert.strictEqual(on.de.dataset.i18n, 'on');
});

test('every page that loads the shell is translated, self-translated or listed as not yet translated', () => {
  const shellPages = fs.readdirSync(PUB).filter((f) => f.endsWith('.html') && /src="_shell\.js"/.test(read(f)));
  const known = new Set([...Object.keys(TRANSLATED_PAGES), ...SELF_TRANSLATED, ...Object.keys(UNTRANSLATED)]);
  const unknown = shellPages.filter((f) => !known.has(f));
  assert.deepStrictEqual(unknown, [], 'classify the new shell page (translated / self-translated / UNTRANSLATED with a reason)');
  const stale = [...known].filter((f) => !shellPages.includes(f));
  assert.deepStrictEqual(stale, [], 'a listed page no longer loads the shell');
});
