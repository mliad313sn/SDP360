'use strict';
// C-01 — analytics integrity (findings F03 F04 F07 F08 F09 F11 F12; report goals G03 G04 G09 G10 G18).
//
// Two layers:
//   1. the pure helpers in public/lib/analyticsLogic.js, driven with adversarial fixtures;
//   2. the REAL inline script of public/analytics.html, executed in a vm against a fake DOM and a
//      scripted fetch — so the page wiring (not just the helper) is proven: open_count 0, null
//      KPIs, 'Unknown' risk, shuffled approval rows, <script> technician name, a filter change
//      during a load, and an API 500.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const AL = require('../public/lib/analyticsLogic.js');
const PAGE = path.join(__dirname, '..', 'public', 'analytics.html');

// ── 1. Pure helpers ────────────────────────────────────────────────────────

test('F03 ratioPct: zero/absent/negative denominator → null, never NaN or Infinity', () => {
  assert.equal(AL.ratioPct(5, 0), null);            // open_count 0 with a positive backlog
  assert.equal(AL.ratioPct(0, 0), null);
  assert.equal(AL.ratioPct(5, null), null);
  assert.equal(AL.ratioPct(null, 10), null);
  assert.equal(AL.ratioPct(5, -3), null);
  assert.equal(AL.ratioPct('x', 10), null);
  assert.equal(AL.ratioPct(3, 12), 25);
  assert.equal(AL.ratioPct('3', '12'), 25);
});

test('F04 ragClass: null / NaN / Infinity → na (neutral), thresholds unchanged', () => {
  for (const v of [null, undefined, '', NaN, Infinity, -Infinity, 'abc', true]) {
    assert.equal(AL.ragClass(v, 90, 75), 'na', `value ${String(v)}`);
  }
  assert.equal(AL.ragClass(95, 90, 75), 'green');
  assert.equal(AL.ragClass(90, 90, 75), 'green');
  assert.equal(AL.ragClass(80, 90, 75), 'amber');
  assert.equal(AL.ragClass(10, 90, 75), 'red');
  assert.equal(AL.ragClass(0, 90, 75), 'red');               // a measured zero is still red
  assert.equal(AL.ragClass(10, 80, null), 'amber');          // two-tier KPI (CAB compliance)
  assert.equal(AL.ragClass(null, 80, null), 'na');
  assert.equal(AL.kpiCardClass(null, 90, 75), 'kpi na');
  assert.equal(AL.overLimitClass(null, 10), '');              // was 'good' (green) for a missing figure
  assert.equal(AL.overLimitClass(11, 10), 'bad');
  assert.equal(AL.overLimitClass(3, 10), 'good');
});

test('G03 fmtNum / fmtPct never print NaN or Infinity', () => {
  assert.equal(AL.fmtNum(null), '—');
  assert.equal(AL.fmtNum(NaN), '—');
  assert.equal(AL.fmtNum(Infinity), '—');
  assert.equal(AL.fmtNum('<script>'), '—');
  assert.equal(AL.fmtNum(0), '0');
  assert.equal(AL.fmtNum(1234.5, 1), '1,234.5');
  assert.equal(AL.fmtPct(null), '—');
  assert.equal(AL.fmtPct(Infinity), '—');
  assert.equal(AL.fmtPct(97.25), '97.3%');
});

test('F07 riskColourKey: explicit map, Unknown / blank / new labels are neutral (never green)', () => {
  assert.equal(AL.riskColourKey('Low'), 'green');
  assert.equal(AL.riskColourKey(' medium '), 'amber');
  assert.equal(AL.riskColourKey('High'), 'red');
  assert.equal(AL.riskColourKey('Very  High'), 'red');
  for (const v of ['Unknown', '', null, undefined, 'Moderate', 'not high', 'highway']) {
    assert.equal(AL.riskColourKey(v), 'neutral', String(v));
  }
});

test('F08 approvalColourKey: by status NAME; permuting rows does not change colours', () => {
  const P = { green: 'G', amber: 'A', red: 'R', slate: 'S' };
  const rows = [
    { approval_status: 'Approved' }, { approval_status: 'Rejected' },
    { approval_status: 'Pending Approval' }, { approval_status: 'Not Requested' },
  ];
  const colourOf = rs => Object.fromEntries(rs.map(r => [r.approval_status, AL.colourFor(AL.approvalColourKey(r.approval_status), P)]));
  const a = colourOf(rows);
  const b = colourOf([rows[3], rows[2], rows[0], rows[1]]);
  assert.deepEqual(a, b);
  assert.deepEqual(a, { 'Approved': 'G', 'Rejected': 'R', 'Pending Approval': 'A', 'Not Requested': 'S' });
  assert.equal(AL.approvalColourKey('not approved'), 'neutral');
});

test('F09 esc + miniTableHtml keep markup literal', () => {
  assert.equal(AL.esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(AL.esc(null), '');
  const html = AL.miniTableHtml([{ technician: '<script>alert(1)</script>', count: 3 }, { technician: '', count: null }],
    'technician', 'Technician', 'Tickets', AL.fmtNum);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('<td>—</td>'));
});

test('F12 fetchJson refuses a non-2xx response', async () => {
  await assert.rejects(AL.fetchJson(async () => ({ ok: false, status: 500, json: async () => ({ data: { total: 9 } }) }), '/x'),
    e => e.status === 500);
  const j = await AL.fetchJson(async () => ({ ok: true, status: 200, json: async () => ({ data: 1 }) }), '/x');
  assert.deepEqual(j, { data: 1 });
});

test('F11 createLoadCoordinator: a trigger during a load is queued, the stale run is invalidated', async () => {
  const writes = [];
  const gates = [];
  const coord = AL.createLoadCoordinator(async (gen, isCurrent) => {
    await new Promise(r => gates.push(r));
    if (isCurrent()) writes.push(gen);
  });
  const p1 = coord.trigger();              // run A
  await Promise.resolve();
  coord.trigger();                          // filter change while A is in flight
  coord.trigger();                          // and another — still only ONE re-run
  gates.shift()();                          // A settles late → must NOT write
  await new Promise(r => setTimeout(r, 0));
  assert.equal(gates.length, 1, 'exactly one re-run started');
  gates.shift()();
  await p1;
  assert.deepEqual(writes, [coord.state.gen]);
  assert.equal(coord.state.loading, false);
  assert.equal(coord.state.pending, false);
});

// ── 2. The real page script against a fake DOM ─────────────────────────────

function makeEl(id) {
  const cls = new Set();
  const el = {
    id, textContent: '', innerHTML: '', value: '', hidden: false, children: [], listeners: {},
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: c => (cls.has(c) ? cls.delete(c) : cls.add(c)), contains: c => cls.has(c) },
    get className() { return [...cls].join(' '); },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); },
    appendChild(c) { el.children.push(c); return c; },
    addEventListener(t, f) { el.listeners[t] = f; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    contains() { return false; },
    getContext() { return {}; },
  };
  return el;
}

function bootPage(fetchImpl) {
  const src = fs.readFileSync(PAGE, 'utf8').replace(/\r\n/g, '\n');
  const blocks = [...src.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const inline = blocks.find(b => b.includes('createLoadCoordinator'));
  assert.ok(inline, 'page inline script found');
  const els = new Map();
  const cards = new Map();
  const get = id => {
    if (!els.has(id)) {
      const el = makeEl(id);
      if (id.startsWith('kv-')) {
        const card = makeEl('card:' + id);
        cards.set(id, card);
        el.closest = sel => (sel === '.kpi' ? card : null);
      }
      els.set(id, el);
    }
    return els.get(id);
  };
  const document = {
    getElementById: get,
    createElement: () => makeEl(''),
    querySelectorAll: () => [],
    addEventListener() {},
    documentElement: {},
  };
  const charts = [];
  class Chart {
    constructor(ctx, cfg) { this.ctx = ctx; this.config = cfg; this.options = cfg.options; charts.push(this); }
    destroy() { this.destroyed = true; }
    update() {}
  }
  const window = {
    fetch: fetchImpl, __ak: 'k', Chart, document,
    localStorage: { getItem: () => null, setItem() {} },
  };
  const ctx = {
    window, document, Chart, console: { log() {}, warn() {}, error() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: window.localStorage, setInterval: () => 0, setTimeout, clearTimeout, Promise, Date, Math, JSON, Number, String, Object, Array, Set, Map, Error,
  };
  ctx.self = window;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'analyticsLogic.js'), 'utf8'), ctx);
  // fetch is wrapped by the page (adds x-dash-key) — route calls through the context's window.fetch.
  ctx.fetch = (...a) => window.fetch(...a);
  vm.runInContext(inline, ctx);
  return { ctx, get, cards, charts, window };
}

const ok = body => ({ ok: true, status: 200, json: async () => body });
const settle = () => new Promise(r => setTimeout(r, 5));

function stubFetch(map) {
  return async (url) => {
    for (const [prefix, fn] of map) if (String(url).startsWith(prefix)) return fn(url);
    return ok({ data: {} });
  };
}

test('page: open_count 0 → backlog "— of open", null SLA neutral, no NaN/Infinity anywhere', async () => {
  const { get, cards } = bootPage(stubFetch([
    ['/api/metrics/requests', () => ok({ data: { total: 40, open_count: 0, backlog_count: 5, sla_ok_pct: null, first_resp_violated_pct: null } })],
    ['/api/metrics/change', () => ok({ data: { change_success_rate: null, by_risk: [] } })],
    ['/api/metrics/cab', () => ok({ data: { cab_compliance_pct: null } })],
    ['/api/metrics/survey', () => ok({ data: { response_rate_pct: null, avg_score: null } })],
  ]));
  await settle();
  assert.equal(get('ks-req-backlog').innerHTML, '<span>— of open</span>');
  assert.equal(cards.get('kv-req-sla').className, 'kpi na');
  assert.equal(cards.get('kv-chg-success').className, 'kpi na');
  assert.equal(cards.get('kv-cab-comp').className, 'kpi na');
  assert.equal(cards.get('kv-sur-rate').className, 'kpi na');
  assert.equal(cards.get('kv-sur-avg').className, 'kpi na');
  assert.ok(!/class="good"/.test(get('ks-req-frsla').innerHTML), 'missing first-reply figure is not green');
  for (const id of ['kv-req-sla', 'kv-req-frsla', 'ks-req-backlog', 'kv-sur-sat']) {
    const t = get(id).textContent + get(id).innerHTML;
    assert.ok(!/NaN|Infinity/.test(t), `${id}: ${t}`);
  }
});

test('page: Unknown risk is neutral, CAB colours follow status names when rows are shuffled, labels escaped', async () => {
  const { get, charts } = bootPage(stubFetch([
    ['/api/metrics/requests', () => ok({ data: { open_count: 2, by_technician: [{ technician: '<script>alert(1)</script>', count: 2 }] } })],
    ['/api/metrics/change', () => ok({ data: { by_risk: [{ risk: 'Unknown', count: 3 }, { risk: 'Low', count: 1 }, { risk: 'High', count: 2 }] } })],
    ['/api/metrics/cab', () => ok({ data: {
      by_status: [{ approval_status: 'Pending Approval', count: 1 }, { approval_status: 'Approved', count: 5 }, { approval_status: 'Rejected', count: 2 }],
      by_rule_type: [{ rule_type: '<img src=x onerror=alert(1)>', count: 1 }],
    } })],
  ]));
  await settle();
  const risk = charts.find(c => c.ctx.id === 'chartChgRisk');
  const [unknown, low, high] = risk.config.data.datasets[0].backgroundColor;
  assert.equal(unknown, '#979BABCC');          // slate (neutral), not green
  assert.equal(low, '#1B9A3ACC');
  assert.equal(high, '#D90038CC');
  const cab = charts.find(c => c.ctx.id === 'chartCabStatus');
  assert.deepEqual(cab.config.data.labels, ['Pending Approval', 'Approved', 'Rejected']);
  assert.deepEqual(cab.config.data.datasets[0].backgroundColor, ['#D97706', '#1B9A3A', '#D90038']);
  assert.ok(!get('reqTechTable').innerHTML.includes('<script>'));
  assert.ok(get('reqTechTable').innerHTML.includes('&lt;script&gt;'));
  assert.ok(!get('cabRuleTable').innerHTML.includes('<img'));
});

test('page: a filter change during a load is not dropped — the later filter state wins', async () => {
  const pending = [];
  const { ctx, get } = bootPage(async (url) => {
    if (String(url).startsWith('/api/metrics/requests')) {
      const site = /site=([^&]*)/.exec(url);
      const tag = site ? decodeURIComponent(site[1]) : 'ALL';
      return new Promise(r => pending.push({ tag, resolve: () => r(ok({ data: { open_count: tag === 'B' ? 222 : 111 } })) }));
    }
    return ok({ data: {} });
  });
  await settle();                              // initial load (site ALL) in flight
  get('fSite').value = 'B';
  ctx.loadAll();                               // user changes filter while load A runs
  await settle();
  assert.equal(pending.length, 1, 'no second concurrent request yet');
  pending.shift().resolve();                   // A answers late
  await settle();
  assert.notEqual(get('kv-req-open').textContent, '111', 'stale A response must not paint');
  assert.equal(pending.length, 1, 'the queued re-run for B started');
  assert.equal(pending[0].tag, 'B');
  pending.shift().resolve();
  await settle();
  assert.equal(get('kv-req-open').textContent, '222');
});

test('page: API 500 → figures withheld ("—"), error badge, Retry reloads the section', async () => {
  let fail = false;
  const { ctx, get, cards } = bootPage(stubFetch([
    ['/api/metrics/requests', () => (fail
      ? { ok: false, status: 500, json: async () => ({ data: { open_count: 999 } }) }
      : ok({ data: { open_count: 7, sla_ok_pct: 95 } }))],
  ]));
  await settle();
  assert.equal(get('kv-req-open').textContent, '7');
  assert.equal(cards.get('kv-req-sla').className, 'kpi green');
  fail = true;
  ctx.loadAll();                               // refresh while the API fails
  await settle();
  assert.equal(get('kv-req-open').textContent, '—', 'previous value not left on screen, error body not rendered');
  assert.equal(cards.get('kv-req-sla').className, 'kpi na error');
  assert.equal(get('fresh-requests').textContent, 'Error');
  assert.equal(get('fresh-requests').className, 'freshness-badge error');
  const host = get('err-requests');
  assert.equal(host.hidden, false);
  assert.ok(host.children.some(c => /HTTP 500/.test(c.textContent)));
  const btn = host.children.find(c => c.className === 'btn-retry');
  assert.ok(btn && typeof btn.listeners.click === 'function', 'Retry wired by listener, no inline handler');
  fail = false;
  btn.listeners.click();
  await settle();
  assert.equal(get('kv-req-open').textContent, '7');
  assert.equal(host.hidden, true);
});

test('page source: no positional colour arrays, no raw API label interpolation, no early-return load guard', () => {
  const src = fs.readFileSync(PAGE, 'utf8');
  assert.ok(!src.includes('[PALETTE.green, PALETTE.red, PALETTE.amber, PALETTE.slate]'), 'F08 positional CAB colours');
  assert.ok(!/\$\{t\.technician/.test(src), 'F09 technician raw');
  assert.ok(!/\$\{r\.rule_type/.test(src), 'F09 rule_type raw');
  assert.ok(!/if \(_loading\) return;/.test(src), 'F11 dropped reload');
  assert.ok(!/d\.backlog_count \/ d\.open_count/.test(src), 'F03 unguarded ratio');
  assert.ok(!/:\s*PALETTE\.green \+ 'CC'/.test(src), 'F07 default-green risk');
  assert.ok(src.includes('<script src="lib/analyticsLogic.js"></script>'), 'lib loaded before the inline script');
});
