'use strict';
// A7 — "no tile mixes definitions": every SLA compliance tile on the helpdesk page, the executive scorecard, the
// public Exec View and the weekly/monthly site report names the definition of its big number (closed tickets only /
// responded tickets only / incl. open past target), and the other definition rides below it, labelled.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').replace(/\r\n/g, '\n');
const DEF = /closed tickets only|responded tickets only|incl\. open/;

test('every SLA tile carrying a metric key also carries data-sla-definition (static markup)', () => {
  for (const f of ['index.html', 'executive.html', 'exec-view.html', 'reports.html']) {
    const html = read(f);
    const tiles = html.match(/<div[^>]*data-metric-key="[^"]*sla[^"]*"[^>]*>/g) || [];
    for (const t of tiles) assert.match(t, /data-sla-definition="(closed_only|incl_open)"/, `${f}: ${t.slice(0, 120)}`);
  }
});

test('Helpdesk page: both SLA tiles label their definition, load the shared rule and render the other rate + open & breached', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('lib/slaDual.js') > -1 && html.indexOf('lib/slaDual.js') < html.indexOf('lib/dashboard-shared.js'), 'slaDual.js loaded before dashboard-shared.js');
  for (const id of ['k-ressla', 'k-frsla']) {
    assert.match(html, new RegExp(`id="${id}-card"[^>]*data-sla-definition="closed_only"`));
    assert.match(html, new RegExp(`id="${id}-def">\\((closed|responded) tickets only\\)`));
    assert.match(html, new RegExp(`id="${id}-dual"`));
  }
  assert.match(html, /function _renderSlaTile\(/);
  assert.match(html, /open &amp; breached/);
});

test('Executive scorecard: the Resolution SLA tile names its definition and shows the other one + open & breached', () => {
  const html = read('executive.html');
  assert.match(html, /id="kv-sla-tile" data-sla-definition="closed_only"/);
  assert.match(html, /id="kv-sla-def">\(closed tickets only\)/);
  assert.match(html, /id="kv-sla-dual"/);
  assert.ok(html.indexOf('lib/slaDual.js') < html.indexOf('lib/dashboard-shared.js'));
});

test('Exec View: the SLA card is labelled with its definition and carries the other rate', () => {
  const html = read('exec-view.html');
  assert.match(html, /kpiCard\('Answered within SLA', sla, \{[^}]*labelSuffix: ' \(' \+ SLA_DEF_LBL\[/);
  assert.match(html, /slaDef: sla\.definition === 'incl_open' \? 'incl_open' : 'closed_only', note: slaNote\(sla\)/);
});

test('Site report (weekly cards + monthly table): every SLA label names its definition', () => {
  const html = read('reports.html');
  const cards = html.match(/card\('#[0-9A-F]{6}', '[^']*SLA[^']*'/g) || [];
  assert.ok(cards.length >= 2, 'weekly SLA cards found');
  for (const c of cards) assert.match(c, DEF, c);
  assert.match(html, /Res\. SLA OK% <span[^>]*>\(closed tickets only\)/);
  assert.match(html, /1st Reply OK% <span[^>]*>\(responded tickets only\)/);
  assert.match(html, /'Res\. SLA OK% \(closed tickets only\)'/);
});

test('server payloads name the definition of the field they publish', () => {
  const RP = require('../services/reportPayload');
  const b = RP.helpdeskBaseline({ inbound: 10, closed: 5, sla_res_pct: 80, sla_res_pct_incl_open: 60, sla_res_open_breached: 2 }, null);
  assert.equal(b.sla_definition, 'closed_only');
  assert.equal(b.sla_compliance, 80);
  assert.equal(b.sla_compliance_incl_open, 60);
  assert.equal(b.sla_open_breached, 2);
  const nb = RP.helpdeskBaseline(null, null);
  assert.equal(nb.sla_compliance_incl_open, null, 'not measured → null, never 0');
});
