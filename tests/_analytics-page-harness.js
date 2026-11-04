'use strict';
// Shared harness: run the REAL inline script of public/analytics.html in a vm against a fake DOM
// and a scripted fetch, with the page's real libs (analyticsLogic, chartTheme, charts) loaded.
// Used by tests/analytics-logic.test.js (C-01) and tests/analytics-charts.test.js (C-06).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUB = path.join(__dirname, '..', 'public');
const PAGE = path.join(PUB, 'analytics.html');
const TREND_IDS = new Set(['chartReqTrend', 'chartSurTrend']);

function makeEl(id, tag) {
  const cls = new Set();
  const attrs = {};
  const el = {
    id, tagName: tag || 'DIV', textContent: '', innerHTML: '', value: '', hidden: false, children: [], listeners: {}, style: {},
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: c => (cls.has(c) ? cls.delete(c) : cls.add(c)), contains: c => cls.has(c) },
    get className() { return [...cls].join(' '); },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); },
    attrs,
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    insertBefore(c, ref) { const i = ref ? el.children.indexOf(ref) : -1; if (i < 0) el.children.push(c); else el.children.splice(i, 0, c); c.parentNode = el; return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c; },
    addEventListener(t, f) { el.listeners[t] = f; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    contains() { return false; },
    getContext() { return { canvas: el }; },
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
  const chartCards = new Map();
  const get = id => {
    if (!els.has(id)) {
      const isCanvas = /^chart/.test(id) && !TREND_IDS.has(id);
      const el = makeEl(id, isCanvas ? 'CANVAS' : 'DIV');
      if (id.startsWith('kv-')) {
        const card = makeEl('card:' + id);
        cards.set(id, card);
        el.closest = sel => (sel === '.kpi' ? card : null);
      }
      if (/^chart/.test(id)) {
        // card > card-body > (chart-wrap > canvas) | trend container
        const card = makeEl('card:' + id);
        const body = makeEl('body:' + id);
        card.appendChild(body);
        let wrap = null;
        if (isCanvas) { wrap = makeEl('wrap:' + id); wrap.closest = s => (s === '.card' ? card : null); body.appendChild(wrap); wrap.appendChild(el); }
        else body.appendChild(el);
        el.closest = s => (s === '.card' ? card : s === '.chart-wrap' ? wrap : null);
        chartCards.set(id, { card, body, wrap });
      }
      els.set(id, el);
    }
    return els.get(id);
  };
  const created = [];
  const document = {
    getElementById: id => (els.has(id) || (!/-table$/.test(id) && /^(kv-|ks-|chart|fresh-|err-|f[A-Z]|reqTech|cabRule|sync-|refresh|lastRef|mf)/.test(id)) ? get(id) : null),
    createElement: tag => { const e = makeEl('', String(tag).toUpperCase()); created.push(e); return e; },
    querySelectorAll: () => [],
    addEventListener() {},
    documentElement: {},
  };
  // Elements created by the page and later given an id (ChartTable's <details>) must be findable.
  const origGet = document.getElementById;
  document.getElementById = id => created.find(e => e.id === id && e.parentNode) || origGet(id);
  const charts = [];
  class Chart {
    constructor(ctx, cfg) { this.ctx = ctx && ctx.canvas ? ctx.canvas : ctx; this.config = cfg; this.options = cfg.options; charts.push(this); }
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
  for (const lib of ['analyticsLogic.js', 'chartTheme.js', 'charts.js']) {
    vm.runInContext(fs.readFileSync(path.join(PUB, 'lib', lib), 'utf8'), ctx);
  }
  ctx.fetch = (...a) => window.fetch(...a);
  vm.runInContext(inline, ctx);
  return { ctx, get, cards, chartCards, charts, window, created, inline };
}

const ok = body => ({ ok: true, status: 200, json: async () => body });
const settle = () => new Promise(r => setTimeout(r, 5));
function stubFetch(map) {
  return async (url) => {
    for (const [prefix, fn] of map) if (String(url).startsWith(prefix)) return fn(url);
    return ok({ data: {} });
  };
}

module.exports = { bootPage, makeEl, ok, settle, stubFetch, PAGE, PUB };
