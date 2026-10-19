'use strict';
// meeting.html — Business Incubation form (2026-10-03). The pure half lives in
// public/lib/incubationEditor.js (UMD); the page wiring is checked statically.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const E = require('../public/lib/incubationEditor');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

test('isIncubation keys on the intake source', () => {
  assert.equal(E.isIncubation({ intake_source: 'business_incubation' }), true);
  assert.equal(E.isIncubation({ intake_source: 'dept_meeting' }), false);
  assert.equal(E.isIncubation(null), false);
});

test('fromHeader fills every part, keeping a stored blob', () => {
  const blank = E.fromHeader({});
  assert.deepEqual(blank, { roles: { incubator: '', incubator_title: '', incubation_manager: '', it_manager: '' },
    session_end: '', duration: '', business_description: '', flow: [], services: [] });
  const kept = E.fromHeader({ incubation: { roles: { incubator: 'Jean' }, flow: [{ activity: 'A' }], services: [{ service: 'S', status: 'Actif' }] } });
  assert.equal(kept.roles.incubator, 'Jean');
  assert.equal(kept.roles.it_manager, '');
  assert.equal(kept.flow[0].activity, 'A');
  assert.equal(kept.services[0].status, 'active', 'legacy free-text status shown on the closed list');
});

test('the service status select offers exactly the closed list, EN + FR', () => {
  assert.deepEqual(E.SERVICE_STATUSES.map(s => s.code), ['active', 'in_progress', 'planned', 'stopped']);
  const html = E.serviceRowsHtml([{ service: 'Data <Mobile>', beneficiary: 'Tous', status: 'planned' }], esc);
  assert.match(html, /Data &lt;Mobile>/, 'escaped');
  assert.match(html, /<option value="planned" selected>/);
  assert.equal((html.match(/<option value="/g) || []).length, 5, 'empty choice + 4 statuses');
});

test('flow rows render the three columns, escaped, with a remove button', () => {
  const html = E.flowRowsHtml([{ incoming: 'a"b', activity: 'x', outgoing: 'y' }], esc);
  assert.match(html, /data-k="incoming"[^>]*>a&quot;b|value="a&quot;b"/);
  assert.match(html, /data-rm="flow"/);
});

test('payloadIncubation: the blob for an incubation, null for a regular PV', () => {
  const inc = E.fromHeader({ incubation: { roles: { incubator: 'Jean' } } });
  const out = E.payloadIncubation({ intake_source: 'business_incubation', department_head: 'Ghislain', site_it_lead: 'Eric' }, inc);
  assert.equal(out.roles.incubator, 'Jean');
  // the two managers are typed in the header fields — mirrored into the blob's roles
  assert.equal(out.roles.incubation_manager, 'Ghislain');
  assert.equal(out.roles.it_manager, 'Eric');
  assert.equal(E.payloadIncubation({ intake_source: 'dept_meeting' }, inc), null);
});

test('meeting.html wires the incubation form', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/meeting.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /<script src="lib\/incubationEditor\.js"><\/script>/);
  // priorities + projects are PV-only; the incubation sections exist
  assert.match(src, /data-only="pv"[^>]*>\s*<div class="pv-card__head">\s*<div class="pv-card__title">2 · Three priorities/);
  for (const id of ['incDesc', 'incFlow', 'incServices', 'incEnd', 'incDuration', 'incIncubator', 'incIncubatorTitle']) {
    assert.ok(src.includes(`id="${id}"`), id);
  }
  assert.match(src, /incubation:\s*IncubationEditor\.payloadIncubation\(/, 'save sends the blob');
  assert.match(src, /\[data-mode="inc"\] \[data-only="pv"\]/, 'mode CSS');
});
