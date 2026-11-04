'use strict';
// C-08 (F17/G17) — the composer page's REAL inline script, run in a vm against a small fake DOM and a
// stubbed fetch: question presets, refusal of an unfit type, generated fields, S-M-L placement,
// move up/down, JSON only under the admin "Advanced" disclosure, and server errors next to the field.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REG = require('../services/metricRegistry').current();
const W = require('../services/dashboardWidgets');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard-composer.html'), 'utf8').replace(/\r\n/g, '\n');

function pageScript() {
  const open = HTML.lastIndexOf('<script nonce="%%CSP_NONCE%%">');
  const start = HTML.indexOf('>', open) + 1;
  const src = HTML.slice(start, HTML.indexOf('</script>', start));
  assert.ok(src.includes('ComposerGuide'), 'sliced the wrong script');
  return src;
}

function makeEl(id) {
  const listeners = {};
  return {
    id, value: '', innerHTML: '', textContent: '', className: '', hidden: false, checked: false, dataset: {}, style: {}, children: [], selectedOptions: [],
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    fire(ev, extra) { for (const fn of listeners[ev] || []) fn(Object.assign({ preventDefault() {}, target: this }, extra || {})); },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this[k] = v; }, querySelector() { return null; },
    click() { this.fire('click'); },
  };
}

const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

async function boot({ admin = false, saveResponse = null } = {}) {
  const els = {};
  const calls = [];
  const document = { getElementById: (id) => (els[id] = els[id] || makeEl(id)), createElement: () => makeEl('') };
  const catalogue = { ok: true, widgetTypes: W.WIDGET_TYPES, creatableTypes: W.creatableTypes(), audiences: W.AUDIENCES, filterTypes: W.FILTER_TYPES, metrics: REG.list({ status: 'published' }), policies: REG.policies() };
  const fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    let status = 200, body = { ok: true };
    if (url === '/api/dashboards/catalogue') body = catalogue;
    else if (url === '/api/reports/sites') body = [{ id: 1, name: 'Sabodala' }];
    else if (opts.method === 'PUT' && saveResponse) ({ status, body } = saveResponse);
    else if (opts.method === 'PUT') body = { ok: true, dashboard: { key: 'k', status: 'draft' } };
    return { ok: status < 400, status, json: async () => body };
  };
  const window = {
    DashboardRender: require('../public/lib/dashboardRender'), ComposerGuide: require('../public/lib/composerGuide'),
    ReasonDialog: {}, __userHasRole: (r) => admin && r === 'admin', open() {},
  };
  const ctx = { window, document, fetch, console, URLSearchParams, location: { search: '' }, history: { replaceState() {} }, JSON, Object, Array, Error };
  vm.createContext(ctx);
  vm.runInContext(pageScript(), ctx);
  await flush();
  return { els, calls, $: (id) => document.getElementById(id) };
}

function widgets(calls) {
  const put = calls.filter((c) => c.opts.method === 'PUT').pop();
  return JSON.parse(put.opts.body).definition.widgets;
}

test('static: raw x/y/w/h inputs are gone and the JSON options live only inside the Advanced disclosure', () => {
  for (const id of ['w-x', 'w-y', 'w-w', 'w-h', 'w-rag', 'w-window']) assert.ok(!HTML.includes(`id="${id}"`), id);
  const adv = /<details class="advanced" id="w-adv" hidden>[\s\S]*?<\/details>/.exec(HTML);
  assert.ok(adv && adv[0].includes('<textarea id="w-extra">'), 'textarea inside details.advanced');
  assert.equal((HTML.match(/<textarea/g) || []).length, 1, 'no other free JSON field');
  assert.match(HTML, /<select id="w-size">/);
  assert.match(HTML, /src="lib\/composerGuide\.js"/);
});

test('a non-admin publisher never sees the JSON; a question preset fills metric, type, fields and a valid layout', async () => {
  const { $, calls } = await boot();
  assert.equal($('w-adv').hidden, true);
  assert.match($('w-preset').innerHTML, /How is ticket volume evolving\?/);
  $('w-preset').value = 'volume'; $('w-preset').fire('change');
  assert.equal($('w-metric').value, 'helpdesk.inbound');
  assert.equal($('w-type').value, 'trend');
  assert.match($('w-mdesc').textContent, /unit: count/);
  assert.match($('w-fields').innerHTML, /id="wf-series"/); assert.match($('w-fields').innerHTML, /id="wf-window"/);
  $('wf-window').value = '6m'; $('wf-series').selectedOptions = [{ value: 'helpdesk.closed' }];
  $('w-add').click();
  $('d-key').value = 'k'; $('d-title').value = 'K'; $('save').click(); await flush();
  const [w] = widgets(calls);
  assert.deepEqual({ id: w.id, type: w.type, metric: w.metric, window: w.window, series: w.series, layout: w.layout },
    { id: 'w1', type: 'trend', metric: 'helpdesk.inbound', window: '6m', series: ['helpdesk.closed'], layout: { x: 0, y: 0, w: 6, h: 3 } });
});

test('the composer refuses a trend on a snapshot metric and says why next to the type', async () => {
  const { $, calls } = await boot();
  $('w-metric').value = 'assets.total'; $('w-metric').fire('change');
  $('w-intent').value = 'trend'; $('w-intent').fire('change');
  assert.match($('ferr-type').textContent, /No widget type answers/);
  $('w-type').value = 'trend'; $('w-id').value = 'w1';
  $('w-add').click();
  assert.match($('ferr-type').textContent, /time series/);
  assert.match($('msg').innerHTML, /time series/);
  $('d-key').value = 'k'; $('save').click(); await flush();
  assert.equal(widgets(calls).length, 0, 'nothing was added');
});

test('S-M-L sizes and move up / down replace raw coordinates', async () => {
  const { $, calls } = await boot();
  $('w-preset').value = 'sla-status'; $('w-preset').fire('change'); $('w-add').click();          // kpi S
  $('w-new').click();
  $('w-preset').value = 'overdue'; $('w-preset').fire('change'); $('w-add').click();             // actions L
  $('w-new').click();
  $('w-preset').value = 'sla-sites'; $('w-preset').fire('change'); $('w-size').value = 'M'; $('w-add').click();
  assert.match($('wlist').innerHTML, /data-move="down" data-id="w1"/);
  $('wlist').fire('click', { target: { dataset: { move: 'up', id: 'w3' } } });                    // ragGrid above actions
  $('d-key').value = 'k'; $('save').click(); await flush();
  const ws = widgets(calls);
  assert.deepEqual(ws.map((w) => w.id), ['w1', 'w3', 'w2']);
  assert.deepEqual(ws.map((w) => w.layout), [{ x: 0, y: 0, w: 3, h: 2 }, { x: 3, y: 0, w: 6, h: 3 }, { x: 0, y: 3, w: 12, h: 4 }]);
  assert.ok(W.validateDashboard({ key: 'k', title: 'K', widgets: ws }).ok);
});

test('the admin tier gets the Advanced JSON, merged into the widget', async () => {
  const { $, calls } = await boot({ admin: true });
  assert.equal($('w-adv').hidden, false);
  $('w-preset').value = 'sla-status'; $('w-preset').fire('change');
  $('w-extra').value = '{"note":"x"}'; $('w-add').click();
  $('d-key').value = 'k'; $('save').click(); await flush();
  assert.equal(widgets(calls)[0].note, 'x');
});

test('server validation stays the authority: its errors show in plain words next to the field', async () => {
  const saveResponse = { status: 400, body: { error: 'invalid dashboard', errors: [{ path: 'widgets[0].layout', msg: 'kpi needs at least 4×3 cells' }, { path: 'key', msg: 'key is required (letters, digits, - or _, max 48)' }] } };
  const { $ } = await boot({ saveResponse });
  $('w-preset').value = 'sla-status'; $('w-preset').fire('change'); $('w-add').click();
  $('d-key').value = 'k'; $('save').click(); await flush();
  assert.match($('msg').innerHTML, /Widget “Resolution SLA” — Size: too small for this widget type/);
  assert.match($('ferr-size').textContent, /choose a larger size/, 'next to the size of the selected widget');
  assert.match($('ferr-d-key').textContent, /key is required/);
  assert.match($('wlist').innerHTML, /1 to fix/);
});
