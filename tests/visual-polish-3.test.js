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
