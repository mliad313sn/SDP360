'use strict';
// PMO UX (2026-11) — the display helpers of the project / portfolio pages. Pure and static checks only (no server):
//   lib/ppmLabels.js   a code reads as a label, the shared table (lib/codeLabels.js) is read first, unknown → "—",
//                      an unmapped code is humanised (never raw snake_case), the value posted stays the code;
//   dictionaries       every English label of the map has a French entry on both pages (EN ⇄ FR toggles both ways);
//   lib/ppmUx.js       stepper / progress / dates: unknown stays "—", never 0;
//   lib/portfolioRegister.js  bars: a null value draws no bar; cells print labels and keep the code;
//   pages              one frame on the six pages, no orange table header, no "Entry id" field, a real not-found card,
//                      strict pages carry no inline script.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/\r\n/g, '\n');
const L = require('../public/lib/ppmLabels.js');
const UX = require('../public/lib/ppmUx.js');
const PR = require('../public/lib/portfolioRegister.js');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('labels: codes read as labels in English and French; the shared code table is read first', () => {
  const S = require('../public/lib/codeLabels.js');
  assert.equal(L.label('status', 'on_track'), 'On track');
  assert.equal(L.label('status', 'on_track', 'fr'), S.label('project_status', 'on_track', 'fr'), 'one French wording for the whole application');
  assert.equal(L.label('stage', 'in_progress'), 'In delivery', 'a stage is not a task status');
  assert.equal(L.label('kind', 'group_monthly'), 'Group monthly review');
  assert.match(L.label('gate', 'GATE_OPEN_TASKS'), /tasks are still open/);
  assert.equal(L.label('severity', 'high', 'fr'), S.label('priority', 'high', 'fr'));
});

test('labels: unknown stays "—", an unmapped code is humanised, and the option value stays the code', () => {
  assert.equal(L.label('status', null), '—'); assert.equal(L.label('status', ''), '—');
  assert.equal(L.label('status', 'some_new_code'), 'Some new code', 'never raw snake_case, never an invented meaning');
  assert.match(L.pill('status', null, esc), /pill NA">—</);
  const pill = L.pill('status', 'at_risk', esc);
  assert.match(pill, /class="pill at_risk"/); assert.match(pill, /data-code="at_risk"/); assert.match(pill, />At risk</);
  const opts = L.options('status', ['planned', 'done'], 'done', esc);
  assert.match(opts, /<option value="planned">Planned<\/option>/); assert.match(opts, /<option value="done" selected>Done<\/option>/);
});

test('every English label of the map has a French entry in the project and the portfolio dictionaries', () => {
  for (const [file, name] of [['project.fr.js', 'I18N_FR_PROJECT'], ['portfolio.fr.js', 'I18N_FR_PORTFOLIO']]) {
    const ctx = { window: {} };
    vm.runInNewContext(read('lib/i18n/common.fr.js'), ctx); vm.runInNewContext(read('lib/i18n/' + file), ctx);
    const dict = Object.assign({}, ctx.window.I18N_FR_COMMON, ctx.window.I18N_FR_LOOKUPS || {}, ctx.window[name]);
    const missing = [];
    for (const g of Object.keys(L.MAP)) for (const c of Object.keys(L.MAP[g])) {
      const en = L.label(g, c, 'en'), fr = L.label(g, c, 'fr');
      if (en === fr) continue;                                       // same word in both languages (Programme, Site…)
      if (!(en in dict) && !((en + '@status') in dict)) missing.push(file + ': ' + g + '.' + c + ' "' + en + '"');
    }
    assert.deepStrictEqual(missing, []);
  }
});

test('risk scale is 1–3 on every probability / impact control of the project page', () => {
  const html = read('project.html');
  for (const id of ['r-prob', 'r-imp', 'w3-r-p', 'w3-r-i']) {
    const m = new RegExp('<select id="' + id + '">(.*?)</select>').exec(html);
    assert.ok(m, id + ' is a select');
    assert.deepStrictEqual((m[1].match(/value="(\d*)"/g) || []).map((x) => x.replace(/\D/g, '')), ['', '1', '2', '3'], id + ': not scored, 1, 2, 3');
  }
});

test('ux helpers: unknown progress / date / number read "—" (never 0); a stepper names the current stage', () => {
  assert.equal(UX.progressHtml(null), '—'); assert.equal(UX.progressHtml(''), '—');
  assert.match(UX.progressHtml(0), /aria-valuenow="0"/, 'a measured zero is a zero');
  assert.equal(UX.date(null), '—'); assert.equal(UX.date(''), '—'); assert.equal(UX.number(null), '—'); assert.equal(UX.number('x'), '—');
  assert.equal(UX.date('2026-09-01T10:00:00Z'), '2026-09-01', 'without lib/format.js the ISO day is shown');
  const st = UX.stepperHtml(['proposal', 'approval', 'in_progress'], 'approval', (s) => L.label('stage', s));
  assert.match(st, /2 \/ 3 · Approval/); assert.match(st, /ppm-step-name">Approval</);
  assert.equal(UX.stepperHtml([], null, (s) => s), '—');
});

test('checklist builder helpers are exported; sortable keeps unknown last (cellKey)', () => {
  assert.equal(typeof UX.checklistBuilder, 'function'); assert.equal(typeof UX.chipSelect, 'function'); assert.equal(typeof UX.openDrawer, 'function');
  assert.equal(UX.cellKey({ getAttribute: () => null, textContent: ' 12 % ' }), 12);
  assert.equal(UX.cellKey({ getAttribute: () => null, textContent: '—' }), '—');
  assert.equal(UX.cellKey({ getAttribute: () => '2026-01-05', textContent: '5 Jan 2026' }), '2026-01-05', 'data-sort wins over the formatted text');
});

test('register: a null value draws no bar and reads "—"; cells print the label and keep the code; tooltips explain status vs stage', () => {
  const svg = PR.barsHtml([{ label: '2026-01', value: 3 }, { label: '2026-02', value: null }, { label: '2026-03', value: 0 }], { esc, T: PR.T.en, title: 'load' });
  assert.equal((svg.match(/class="pr-bars-b/g) || []).length, 1, 'one bar: null and 0 draw none');
  assert.match(svg, />—<\/text>/, 'the unknown month reads —'); assert.match(svg, />0<\/text>/, 'the measured zero reads 0');
  assert.ok(!/style=/.test(svg), 'no inline style (strict CSP page)');
  const html = PR.tableHtml([{ id: 1, ref: 'P-1', name: 'One', status: 'on_track', stage: 'in_progress', start_date: '2026-09-01', end_date: null }], { cols: ['ref', 'name', 'status', 'stage', 'start_date', 'end_date'], esc, T: PR.T.en, lang: 'en', label: (g, c) => L.label(g, c), date: () => '1 Sep 2026' });
  assert.match(html, /data-code="on_track">On track</); assert.match(html, /data-code="in_progress">In delivery</);
  assert.match(html, /Delivery status/); assert.match(html, /Lifecycle stage/); assert.match(html, /title="Where the project stands/);
  assert.match(html, /1 Sep 2026/); assert.match(html, /<td class="">—<\/td>/, 'a missing date stays —');
  const raw = PR.tableHtml([{ id: 1, ref: 'P-1', name: 'One', status: 'on_track' }], { cols: ['ref', 'status'], esc, T: PR.T.en, lang: 'en' });
  assert.match(raw, />on_track</, 'without a labeller the lib stays pure and prints the stored value');
  assert.equal(PR.T.en.budget, 'Budget'); assert.match(PR.T.en.budget_tip, /never added across currencies/, 'the currency rule stays written');
});

test('one frame on the six pages; grey headers; strict pages carry no inline script', () => {
  for (const f of ['project.html', 'portfolio.html', 'portfolio-register.html', 'portfolio-decisions.html', 'portfolio-phase2.html']) {
    const s = read(f);
    assert.match(s, /<main id="main" class="[^"]*\bppm-page\b/, f + ': the shared frame');
    assert.ok(s.indexOf('lib/ppmUx.css') > s.indexOf('</style>'), f + ': ppmUx.css is loaded after the page style, so it wins');
    assert.match(s, /class="ppm-page-header"/, f + ': one page header');
  }
  const css = read('lib/ppmUx.css');
  assert.match(css, /\.ppm-page \.pr-table thead th, \.ppm-page \.pd-table thead th \{ background: var\(--color-bg\)/, 'register and decisions headers are grey');
  for (const f of ['portfolio-register.html', 'portfolio-decisions.html', 'portfolio-phase2.html']) {
    const s = read(f);
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(s), f + ': no inline script');
    assert.ok(!/\son[a-z]+="/.test(s), f + ': no inline handler');
  }
});

test('project page: one RAID entry form per register, no "Entry id" field, a real not-found card, areas over the tabs', () => {
  const s = read('project.html');
  assert.ok(!/Entry id/.test(s), 'no free-text entry id');
  assert.match(s, /<input type="hidden" id="w3-r-id"/); assert.match(s, /<input type="hidden" id="r-id"/);
  assert.match(s, /id="p-notfound"[^>]*hidden/); assert.match(s, /Back to portfolio/);
  assert.deepStrictEqual((s.match(/data-group="([a-z]+)"/g) || []).map((x) => x.slice(12, -1)), ['overview', 'plan', 'raid', 'finance', 'governance', 'activity']);
  assert.deepStrictEqual((s.match(/data-sub="([a-z]+)"/g) || []).map((x) => x.slice(10, -1)), ['schedule', 'quality', 'baselines', 'resources', 'time']);
  assert.match(s, /<aside class="ppm-drawer" id="task-edit" role="dialog"/, 'the task editor is a drawer beside the grid');
  assert.match(s, /lib\/ppmRaidForm\.js/, 'the pre-filled RAID form helper is loaded');
  assert.match(s, /href="help\.html#project"/); assert.match(read('portfolio.html'), /href="help\.html#portfolio"/);
});
