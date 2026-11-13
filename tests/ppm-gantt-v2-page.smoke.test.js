'use strict';
// W2-UI — interactive Gantt v2 behind report_config ppm_gantt_v2_enabled (default '0' = today's SVG Gantt).
// Over HTTP (fictitious data): the features route says off/on, project.html serves the module scripts versioned.
// Static + sandboxed: the page mounts only behind the switch, every French key exists, a11y markers, escaping,
// no CDN, and the mounted module renders only a window of rows on a 5,000-task plan.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'gantt-v2-'));
process.env.DASH_USER = process.env.DASH_USER || 'g2-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'g2-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'g2-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const vm = require('vm');
const ROOT = _path.join(__dirname, '..');
const read = (f) => _fs.readFileSync(_path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
let server, base, rdb, cfg, tok;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  await rdb.createUser({ username: 'g2_viewer', full_name: 'g2_viewer', password: 'g2_viewerpass1234', roles: ['viewer'] });
  tok = (await rdb.login('g2_viewer', 'g2_viewerpass1234')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const features = async () => (await (await fetch(base + '/api/governance/ppm/features', { headers: { 'x-report-token': tok } })).json());

test('switch: DEFAULTS keeps today (0); the features route reports gantt_v2 false, then true once switched on', async () => {
  assert.equal(cfg.DEFAULTS.ppm_gantt_v2_enabled, '0');
  assert.equal((await features()).gantt_v2, false);
  await cfg.setConfig(rdb.db, { ppm_gantt_v2_enabled: '1' }, 'smoke');
  try { assert.equal((await features()).gantt_v2, true); } finally { await cfg.setConfig(rdb.db, { ppm_gantt_v2_enabled: '0' }, 'smoke'); }
  assert.match(read('docs/ops/pilot/PILOT-PROFILE.md'), /\| `ppm_gantt_v2_enabled` \| built \| `0` \|/);
});

test('project.html is served with the Gantt v2 module scripts URL-versioned, and mounts it only behind FEAT.gantt_v2', async () => {
  const r = await fetch(base + '/project.html');
  assert.equal(r.status, 200);
  const html = await r.text();
  for (const f of ['lib/ganttCore.js', 'lib/i18n/gantt.fr.js', 'lib/ganttV2.js']) assert.match(html, new RegExp('src="' + f.replace(/\./g, '\\.') + '\\?v='), f);
  assert.match(html, /href="lib\/ganttV2\.css\?v=/);
  const src = read('public/project.html');
  assert.match(src, /var on = !!\(FEAT\.gantt_v2 && window\.GanttV2/);
  assert.match(src, /\$\("gantt"\)\.hidden = on/, 'today\'s SVG Gantt stays when off');
  assert.match(src, /<div id="gantt-v2" hidden><\/div>/);
});

const MOD = read('public/lib/ganttV2.js'), CORE = read('public/lib/ganttCore.js');
test('every text the module asks for has a French entry (lib/i18n/gantt.fr.js)', () => {
  const w = {}; vm.runInNewContext(read('public/lib/i18n/gantt.fr.js'), { window: w });
  const dict = w.I18N_FR_GANTT;
  const box = { window: { GanttCore: require('../public/lib/ganttCore') } }; vm.runInNewContext(MOD, box);
  const G2 = box.window.GanttV2;
  const keys = new Set([...MOD.matchAll(/\bT\('([^']+)'\)/g)].map((m) => m[1]));
  G2.VIEWS.forEach((v) => keys.add(v[1])); G2.COLS.forEach((c) => keys.add(c[1])); Object.values(G2.PLAIN).forEach((v) => keys.add(v));
  ['Days', 'Weeks', 'Months', 'Quarters', 'Task', 'Resource', 'Move', 'Resize', 'Link', 'Edit'].forEach((k) => keys.add(k));
  const missing = [...keys].filter((k) => !dict[k]);
  assert.deepEqual(missing, []);
  assert.equal(dict.MONTHS.split(',').length, 12);
});

test('a11y + safety (static): grid roles, labelled bars, live status, keyboard paths, list fallback, no inline handlers, no CDN, no raw value concatenation', () => {
  for (const re of [/role="grid"/, /aria-rowcount=/, /role="row"/, /role="gridcell"/, /role="columnheader"/, /role="img" aria-label="/, /role="status" aria-live="polite"/, /role="toolbar"/,
    /ArrowDown/, /'F2'/, /Escape/, /ev\.altKey/, /k === 'z'/, /max-width: ' \+ NARROW/, /NARROW = 560/]) assert.match(MOD, re, String(re));
  assert.ok(!/\son[a-z]+=\\?"/i.test(MOD), 'no inline on…= attribute');
  for (const s of [MOD, CORE]) assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(s), 'no external URL / CDN');
  // a string literal glued to a property access (x.y, not a call) would put an unescaped value in the markup
  // esc(…) / say(…) (textContent) arguments are safe: remove those balanced calls before looking for raw glue
  const strip = (src) => { let out = '', i = 0; while (i < src.length) { const m = /\b(esc|say)\(/.exec(src.slice(i)); if (!m) { out += src.slice(i); break; } out += src.slice(i, i + m.index); let j = i + m.index + m[0].length, depth = 1; while (j < src.length && depth) { const ch = src[j]; if (ch === '(') depth++; else if (ch === ')') depth--; j++; } out += 'SAFE'; i = j; } return out; };
  const raw = [...strip(MOD).matchAll(/'\s*\+\s*((?!L\.|b\.|nd\.|a\.|z\.|net\.|ROW_H|HEAD_H|c\[2\]|COLS\.length)[A-Za-z_$][\w$]*(?:\.[\w$]+)+)(?!\s*\(|[\w$.[])/g)].map((m) => m[1]);
  assert.deepEqual(raw, [], 'only geometry numbers are concatenated raw: ' + raw.join(', '));
});

// minimal DOM double: enough for render() + paint() to run and to read what they drew
function fakeDom() {
  const made = {};
  const node = (sel) => {
    const n = { sel, innerHTML: '', hidden: false, scrollTop: 0, scrollLeft: 0, clientHeight: 560, clientWidth: 900, listeners: {},
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, setAttribute() {}, getAttribute: () => null, focus() {},
      querySelector(s) { if (!made[s]) made[s] = node(s); return made[s]; }, querySelectorAll: () => [], closest: () => null, appendChild() {} };
    return n;
  };
  return { el: node('root'), made, document: { createElement: () => node('input'), createElementNS: () => node('line'), elementFromPoint: () => null } };
}
test('virtualised in the page module: a 5,000-task plan draws only a window of bars and grid rows; read-only hides the drag handles', () => {
  const G = require('../public/lib/ganttCore');
  const cal = G.makeCal(), base = G.toDay('2026-01-05');
  const tasks = [], plan = { tasks: [] };
  for (let i = 1; i <= 5000; i++) { const s = cal.add(base, i % 300), e = cal.add(s, i % 5); tasks.push({ id: i, name: 'T' + i, depends_on: i > 1 ? [i - 1] : [], version: 1 }); plan.tasks.push({ id: i, es_date: G.fromDay(s), ef_date: G.fromDay(e) }); }
  for (const canEdit of [true, false]) {
    const d = fakeDom();
    const win = { GanttCore: G, document: d.document, requestAnimationFrame: (f) => f() };
    vm.runInNewContext(MOD, { window: win });
    const t0 = Date.now();
    win.GanttV2.mount(d.el, { pid: '1', tasks, plan, canEdit, today: '2026-03-02', api: () => Promise.resolve({}), reload: () => Promise.resolve(), msg() {}, fail() {} });
    const ms = Date.now() - t0;
    const svg = d.made['.g2-svg'].innerHTML, grid = d.made['.g2-gin'].innerHTML;
    const bars = (svg.match(/class="g2-bar/g) || []).length, rowsN = (grid.match(/role="row"/g) || []).length;
    assert.ok(bars > 10 && bars < 60, 'bars drawn: ' + bars); assert.equal(rowsN, bars);
    assert.match(d.made['.g2-body'].innerHTML, /aria-rowcount="5001"/);
    assert.equal(/data-act="resize"/.test(svg), canEdit); assert.equal(/class="btn g2-undo"/.test(d.el.innerHTML), canEdit);
    assert.ok(ms < 1500, 'mount took ' + ms + ' ms');
  }
});

test('writes: edit / move / link go through PUT /api/governance/portfolio/task with the row version; undo replays the inverse; a 409 is shown, reloads, and is dropped', async () => {
  const G = require('../public/lib/ganttCore');
  const tasks = [
    { id: 11, name: 'A', start_date: '2026-11-09', end_date: '2026-11-13', duration_days: 5, depends_on: [], version: 4 },
    { id: 12, name: 'B', start_date: '2026-11-16', end_date: '2026-11-17', duration_days: 2, depends_on: [], version: 2 },
  ];
  const plan = { tasks: [{ id: 11, es_date: '2026-11-09', ef_date: '2026-11-13' }, { id: 12, es_date: '2026-11-16', ef_date: '2026-11-17' }] };
  const calls = [], fails = [], msgs = []; let reloads = 0, refuse409 = false;
  const api = (p, o) => { calls.push({ p, m: o.method, b: JSON.parse(o.body) }); if (refuse409) { const e = new Error('stale'); e.status = 409; e.code = 'STALE_VERSION'; return Promise.reject(e); } return Promise.resolve({ ok: true, id: 1 }); };
  const d = fakeDom(); const win = { GanttCore: G, document: d.document, requestAnimationFrame: (f) => f() };
  vm.runInNewContext(MOD, { window: win });
  const ctl = win.GanttV2.mount(d.el, { pid: 'w', tasks, plan, canEdit: true, today: '2026-11-12', api, reload: () => { reloads++; return Promise.resolve(); }, msg: (m, c) => msgs.push([m, c]), fail: (e) => fails.push(e.code) });
  await ctl.edit(11, 'duration', '3');
  assert.deepEqual(calls[0], { p: '/api/governance/portfolio/task', m: 'PUT', b: { id: 11, version: 4, duration_days: 3, end_date: '2026-11-11' } });
  assert.equal(ctl.history.size().undo, 1); assert.equal(reloads, 1);
  await ctl.move(12, 10 * 7, 'move');   // one week at week zoom
  assert.deepEqual(calls[1].b, { id: 12, version: 2, start_date: '2026-11-23', end_date: '2026-11-24', duration_days: 2 });
  await ctl.link(11, 12);
  assert.deepEqual(calls[2].b, { id: 12, version: 2, depends_on: [11] });
  assert.equal((await ctl.link(12, 12)).code, 'DEP_SELF'); assert.equal(calls.length, 3, 'a refused link sends nothing');
  assert.equal((await ctl.edit(11, 'progress', '150')).error, 'PROGRESS_INVALID'); assert.equal(calls.length, 3);
  await ctl.undo();
  assert.deepEqual(calls[3].b, { id: 12, version: 2, depends_on: [] }, 'undo sends the previous predecessors with the current version');
  assert.equal(ctl.history.size().redo, 1);
  refuse409 = true;
  await ctl.redo();
  assert.deepEqual(fails, ['STALE_VERSION']); assert.equal(ctl.history.size().redo, 0, 'the failed replay is dropped');
  const n0 = calls.length; refuse409 = false;
  const ro = fakeDom(); const w2 = { GanttCore: G, document: ro.document, requestAnimationFrame: (f) => f() }; vm.runInNewContext(MOD, { window: w2 });
  const view = w2.GanttV2.mount(ro.el, { pid: 'r', tasks, plan, canEdit: false, today: '2026-11-12', api, reload: () => Promise.resolve(), msg() {}, fail() {} });
  await view.move(11, 70, 'move'); await view.link(11, 12); await view.edit(11, 'name', 'X');
  assert.equal(calls.length, n0, 'read-only: nothing is ever sent');
});
