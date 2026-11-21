'use strict';
// VISUAL POLISH 3 (UX committee follow-up) — static and unit proofs for the items closed on this branch. Each test
// names the committee finding it covers. Browser behaviour is covered by the e2e journeys; these tests keep the
// markup and the small pure functions from drifting back.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fnSource } = require('./_fn-source');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8').replace(/\r\n/g, '\n');

test('inspection: a Type that was never changed is stored as the default option (the list is not blank after a reload)', () => {
  const src = read('inspection.html');
  const ctx = vm.createContext({});
  const sel = { options: [{ value: 'Routine' }, { value: 'Pre-Audit' }], _v: '', get value() { return this._v; }, set value(v) { this._v = this.options.some((o) => o.value === v) ? v : ''; },
    set selectedIndex(i) { this._v = this.options[i].value; } };
  ctx.document = { getElementById: (id) => (id === 'f_type' ? sel : null) };
  vm.runInContext('var state = { meta: {} };\n' + fnSource(src, '_defaultType'), ctx);
  sel.value = '';                       // what applyStateToUI does when meta.f_type is unset
  vm.runInContext('_defaultType()', ctx);
  assert.strictEqual(sel.value, 'Routine');
  assert.strictEqual(vm.runInContext('state.meta.f_type', ctx), 'Routine');
  // a stored type is never overwritten
  vm.runInContext('state.meta.f_type = "Pre-Audit"', ctx); sel.value = 'Pre-Audit';
  vm.runInContext('_defaultType()', ctx);
  assert.strictEqual(vm.runInContext('state.meta.f_type', ctx), 'Pre-Audit');
  // both call sites: after the form is filled from the record, and after the lookups replaced the options
  assert.match(fnSource(src, 'applyStateToUI'), /_defaultType\(\)/);
  assert.match(src, /_hydrateSelect\('f_type'[^\n]+\n\s+if \(typeof _defaultType === 'function'\) _defaultType\(\);/);
});

test('inspection (field F13): rename and delete sit behind one "more" menu in the header', () => {
  const src = read('inspection.html');
  const menu = src.slice(src.indexOf('<details class="hdr-more"'), src.indexOf('</details>', src.indexOf('<details class="hdr-more"')));
  assert.match(menu, /aria-label="More actions"/);
  assert.match(menu, /renameInspection\(\)/);
  assert.match(menu, /deleteInspection\(\)/);
  assert.ok(read('brand/icons.js').includes("'more-horizontal':"));
});

// Item 2 — the pages below no longer call the browser's confirm() / prompt(): they ask through the shared dialog
// (lib/reasonDialog.js), which names its target and is not suppressed by embedded browsers.
for (const f of ['executive-report.html', 'inspection.html', 'inspections.html', 'meeting.html', 'meetings-import.html', 'meetings-setup.html', 'reports.html', 'lib/reports-backups.js']) {
  test(`${f}: no native confirm()/prompt(); the shared dialog is used`, () => {
    const src = read(f);
    // comment lines are dropped line by line (a block-comment regex would swallow code after a '/*' inside a string)
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|<!--|Branded replacement)/.test(l)).map((l) => l.replace(/\s\/\/ [^\n]*$/, '')).join('\n');
    assert.ok(!/(^|[^.\w])(window\.)?(prompt|confirm)\s*\(/.test(code), 'calls window.prompt / confirm');
    if (f.endsWith('.html')) assert.ok(src.includes('src="lib/reasonDialog.js"'), 'loads lib/reasonDialog.js');
    assert.match(src, /ReasonDialog\.(confirm|ask|form)\(|askConfirm\(|_askConfirm\(/);
  });
}

test('shared confirmation dialog: follows the page language when none is given; Enter on Cancel does not confirm', () => {
  const src = read('lib/reasonDialog.js');
  assert.match(fnSource(src, 'pageLang'), /document\.documentElement\.lang/);
  assert.match(src, /e\.key === 'Enter' && e\.target !== cancel/);
  assert.match(src, /\(first \|\| \(opts\.danger \? cancel : ok\)\)\.focus\(\)/);
});

test('deck builder: page styles live in executive-report.css, loaded where the <style> block was', () => {
  const html = read('executive-report.html');
  assert.ok(html.indexOf('href="executive-report.css"') > 0 && html.indexOf('href="executive-report.css"') < html.indexOf('href="_tokens.css"'));
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'executive-report.css')));
});

// …and the other non-PMO pages that still called the browser's dialogs
for (const f of ['dashboards.html', 'site-actions.html', 'lib/homeQueue.js', 'assets.html', 'inspection-actions.html', 'report-studio.html', 'login.html']) {
  test(`${f}: no native confirm()/prompt()`, () => {
    const code = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).map((l) => l.replace(/\s\/\/ [^\n]*$/, '')).join('\n');
    assert.ok(!/(^|[^.\w])(window\.)?(prompt|confirm)\s*\(/.test(code), 'calls window.prompt / confirm');
    assert.match(code, /ReasonDialog/);
  });
}

test('helpdesk (visual F15): secondary filters fold behind "More filters"; the controls and their handlers are unchanged', () => {
  const src = read('index.html');
  const bar = src.slice(src.indexOf('<div class="filter-bar">'), src.indexOf('<div class="page">'));
  const panel = bar.slice(bar.indexOf('id="fltMorePanel"'));
  const primary = bar.slice(0, bar.indexOf('id="fltMorePanel"'));
  for (const id of ['fSite', 'fPeriod', 'grpWidget']) assert.ok(primary.includes(`id="${id}"`), id + ' stays in the first row');
  for (const id of ['fCat', 'fPri', 'mfStatus', 'mfType', 'mfImpact', 'mfMode', 'fTrend']) assert.ok(panel.includes(`id="${id}"`), id + ' is inside the disclosure');
  assert.match(primary, /id="fltMoreBtn" aria-expanded="false" aria-controls="fltMorePanel"/);
  assert.match(primary, /id="fltChips"/);
  // every control keeps its own change handler — the chips only call them
  assert.match(panel, /id="fCat" aria-label="Category" onchange="applyFilters\(\)"/);
  const chips = fnSource(src, '_activeSecondaryFilters');
  assert.match(chips, /applyFilters\(\)/);
  assert.match(chips, /mfAll\(wid,true\)/);
  // the two exports are one menu, same ids
  const menu = src.slice(src.indexOf('<details class="pb-menu"'), src.indexOf('</details>', src.indexOf('<details class="pb-menu"')));
  assert.ok(menu.includes('id="btnExport"') && menu.includes('id="btnRiskRegister"'));
});

// ── Site coordinator seat ───────────────────────────────────────────────────────────────────────────────────────
test('weekly report: ONE status vocabulary — the reports page uses the words Home gets from the server', () => {
  const { weeklyLabel } = require('../services/myWork');
  const ctx = vm.createContext({});
  vm.runInContext(fnSource(read('reports.html'), 'reportStatusLabel') + '\nthis.f = reportStatusLabel;', ctx);
  for (const st of ['draft', 'in_progress', 'ready', 'submitted', null, undefined]) assert.strictEqual(ctx.f(st), weeklyLabel(st), String(st));
  const src = read('reports.html');
  assert.doesNotMatch(src, /'✏ Draft'|'⏳ In Progress'|'✔ Ready to Submit'/, 'the old per-page labels are gone');
});

test('report editor (P2-10): a tab is green by its completeness rule, never just because it was saved', () => {
  const src = read('reports.html');
  const ctx = vm.createContext({});
  vm.runInContext('var currentReport = {}; var _actionsSavedEmpty = false;\n' + fnSource(src, '_infraComplete') + '\n' + fnSource(src, '_assetReviewDone') + '\n' + fnSource(src, '_sectionComplete') + '\nthis.c = _sectionComplete; this.set = (r, e) => { currentReport = r; _actionsSavedEmpty = !!e; };', ctx);
  ctx.set({ infra_kpis: [{ status_value: '' }], helpdesk: null, lights: [], action_items: [], asset_review: null });
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((n) => ctx.c(n)), [false, false, false, false, false], 'an empty saved report has no green tab');
  ctx.set({ infra_kpis: [{ status_value: '99' }], helpdesk: { fetched_at: 'x' }, lights: [{}], action_items: [{}], asset_review: { applicable: false } });
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((n) => ctx.c(n)), [true, true, true, true, true]);
  ctx.set({ action_items: [] }, true);
  assert.strictEqual(ctx.c(3), true, 'an action list explicitly saved empty is a complete answer');
  // no blind tick is left in the save paths
  assert.doesNotMatch(src, /getElementById\('stab-[0-3]'\)\.classList\.add\('done'\)/);
  assert.match(fnSource(src, '_afterSectionSaved'), /if \(n !== 4\) _paintSectionTab\(n\);/);
  assert.match(src, /id="report-progress"/);
});

test('report editor (P2-9, P2-11): one save signal with a retry state; one primary per row; imports in one menu', () => {
  const src = read('reports.html');
  const sv = fnSource(src, 'setSaving');
  assert.match(sv, /Saved at /); assert.match(sv, /Not saved — retry/); assert.match(sv, /saveSection\(/);
  assert.doesNotMatch(fnSource(src, 'saveSection'), /toast\('Saved/, 'no success toast on top of the inline signal');
  assert.match(fnSource(src, 'autoSaveSection'), /setSaving\('failed', n\)/, 'an autosave failure is shown');
  const row = src.slice(src.indexOf('<div class="act-row">'), src.indexOf('<div style="margin-top:18px">', src.indexOf('<div class="act-row">')));
  assert.strictEqual((row.match(/btn-primary/g) || []).length, 1, 'one primary in the action row');
  for (const id of ['btn-carry-over', 'btn-import-modules', 'btn-merge-dupes', 'actions-csv-file']) assert.ok(row.includes(`id="${id}"`), id);
  assert.strictEqual((src.slice(src.indexOf('id="page-form"')).match(/class="btn btn-primary" onclick="saveSection/g) || []).length, 0, 'section saves are secondary — Submit is the primary');
  assert.match(src, /<button class="btn btn-primary" id="btn-submit"/);
});

test('reports landing (P2-17): the due report leads with one primary button that uses the picker path', () => {
  const src = read('reports.html');
  assert.ok(src.indexOf('id="rl-lead"') < src.indexOf('Open or Create a Weekly Report'));
  const fn = fnSource(src, 'renderLeadCard');
  assert.match(fn, /openReportById\(rep\.id\) : openOrCreateReport\(\)/);
  assert.match(fn, /known \? reportStatusLabel\(status\) : '—'/, 'a failed read shows —, never "Not started"');
});

test('home (P2-14): the two PV lines say what each counts; the oldest action is dated from its opening', () => {
  const src = read('lib/home-page.js');
  assert.match(src, /unsigned: 'Unsigned PVs of the site'/); assert.match(src, /pvs: 'PVs waiting for my signature'/);
  assert.match(src, /unsigned: 'PV du site non signés'/); assert.match(src, /pvs: 'PV en attente de ma signature'/);
  assert.match(src, /oldest: 'oldest opened', days: 'days ago'/);
  assert.doesNotMatch(src, /PVs to sign|PV à signer/);
});

// ── Admin seat ──────────────────────────────────────────────────────────────────────────────────────────────────
test('admin users table (P2-5): role / site / status facets, sign-in method, status badge; no invented last sign-in', () => {
  const src = read('reports.html');
  for (const f of ['role', 'site', 'status']) assert.match(src, new RegExp(`data-table-facet="#user-table" data-facet="${f}"`));
  assert.match(src, /<tr data-f-role="\$\{esc\(roleArr\.join\(' '\)\)\}" data-f-site="\$\{esc\(siteFacet\)\}" data-f-status=/);
  assert.match(src, /u\.has_entra \? '<span class="edv-badge edv-badge--info"/);
  assert.doesNotMatch(src, /last_login|last_sign_in/, 'the users API returns no last sign-in: none is shown');
  assert.match(src, /\.role-super_admin\{/);
  // the facet filter itself (lib/tableFilter.js) on a stub table
  const rows = [{ t: 'alice hounde', a: { 'data-f-role': 'editor', 'data-f-status': 'active' } }, { t: 'bob', a: { 'data-f-role': 'viewer committee-member', 'data-f-status': 'disabled' } }]
    .map((r) => ({ textContent: r.t, hidden: false, getAttribute: (k) => r.a[k] || null }));
  const facet = { value: 'committee-member', getAttribute: (k) => ({ 'data-table-facet': '#t', 'data-facet': 'role' }[k]) };
  const input = { value: '', getAttribute: (k) => ({ 'data-table-filter': '#t' }[k] || null) };
  const document = { querySelector: () => ({ querySelectorAll: () => rows }), querySelectorAll: (sel) => (sel === '[data-table-filter]' ? [input] : sel === '[data-table-facet]' ? [facet] : []), getElementById: () => null, addEventListener() {} };
  const window = {};
  vm.runInNewContext(read('lib/tableFilter.js'), { document, window });
  window.TableFilter.apply('#t');
  assert.deepStrictEqual(rows.map((r) => r.hidden), [true, false]);
  facet.value = ''; input.value = 'Hounde'; window.TableFilter.apply('#t');
  assert.deepStrictEqual(rows.map((r) => r.hidden), [false, true]);
});

test('admin settings (P2-4, P2-7): secret presence only; four-eyes badge from the catalogue, never a client rule', () => {
  const route = fs.readFileSync(path.join(ROOT, 'routes', 'adminConfig.js'), 'utf8');
  const fn = fnSource(route, 'redactSecrets');
  const reportConfig = { _SECRET_BLANK_KEEP: new Set(['smtp_pass', 'meraki_api_key']) };
  const redact = new Function('reportConfig', fn + '\nreturn redactSecrets;')(reportConfig);
  const out = redact({ smtp_pass: 'hunter2-very-secret', meraki_api_key: '', other: 'x' });
  assert.deepStrictEqual(out.secrets_set, { smtp_pass: true, meraki_api_key: false });
  assert.strictEqual(out.smtp_pass, '');
  assert.ok(!JSON.stringify(out).includes('hunter2'), 'no part of a secret is returned');
  assert.deepStrictEqual(redact(out).secrets_set, { smtp_pass: true, meraki_api_key: false }, 'a second pass (PUT answer) keeps the flags');
  const src = read('reports.html');
  const fe = fnSource(src, 'paintFourEyesBadges');
  assert.match(fe, /__uiPolicy\.policy_center_page === '1'/, 'no request while the Policy Center is off');
  assert.match(fe, /r\.four_eyes \|\| r\.source !== 'report_config'/);
  assert.match(fe, /Needs a second approver/);
  assert.match(fnSource(src, 'secretBadge'), /isSet == null\) return/);
});

test('admin (P2-6, P2-9, P2-10, P3-5): dirty-row Save on sites, grouped policy list, section fold on a phone, one-time key reveal', () => {
  const src = read('reports.html');
  assert.match(src, /class="btn btn-primary btn-sm site-save" data-site-save="\$\{s\.id\}" onclick="saveSiteGroup\(\$\{s\.id\}\)" hidden>/);
  assert.match(src, /id="admin-rail-toggle" aria-expanded="false" aria-controls="admin-rail"/);
  assert.match(src, /\.admin-rail:not\(\.is-open\)\{display:none\}/);
  const pc = read('lib/policyCenterPage.js');
  assert.match(pc, /<details class="pc-card pc-cat" data-cat=/); assert.match(pc, /filtering \|\| openCats\.has\(k\) \? ' open' : ''/);
  assert.match(read('policy-center.html'), /id="pcCats"/);
  const rd = read('lib/reasonDialog.js');
  const reveal = fnSource(rd, 'reveal');
  assert.match(reveal, /readOnly: true/); assert.match(reveal, /close\.disabled = !tick\.checked/); assert.match(reveal, /field\.value = ''; back\.remove\(\)/);
  assert.doesNotMatch(reveal, /keydown|Escape/, 'the reveal cannot be dismissed by accident');
  const integ = read('integrations.html');
  assert.match(integ, /D\.reveal\(\{ title: "API key created"/);
});
