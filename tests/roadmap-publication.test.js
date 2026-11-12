'use strict';
// R2-WB-06 — controlled roadmap publication: the pure duplicate finder, the page helpers and the static wiring.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const RP = require('../services/roadmapPublication');
const UI = require('../public/lib/roadmapPublish');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'itsm-roadmap.html'), 'utf8').replace(/\r\n/g, '\n');
const plan = () => ({ programme: { key: 'itsm-roadmap' }, objectives: [
  { key: 'itsm-roadmap-a', name: 'A', deliverables: [{ name: 'Form One' }, { name: 'form  one ' }, { name: 'Form Two' }] },
  { key: 'itsm-roadmap-b', name: 'B', deliverables: [{ name: 'Form Twó' }, { name: 'Three' }] },
  { key: 'itsm-roadmap-a', name: 'A again', deliverables: [{ name: 'Four' }] },
  { key: 'itsm-roadmap-c', name: 'C', deliverables: [] }] });

test('duplicates: existing keys (live or deleted), keys repeated in the source, deliverable names repeated after normalisation', () => {
  const d = RP.duplicates(plan(), { existingObjectiveKeys: ['itsm-roadmap-c'] });
  assert.deepEqual(d.objectives.map((o) => [o.key, o.reason]), [['itsm-roadmap-a', 'repeated'], ['itsm-roadmap-c', 'exists']]);
  assert.deepEqual(d.deliverables.map((x) => x.name), ['form  one ', 'Form Twó'], 'case, spaces and accents folded; first occurrence kept');
  assert.equal(d.count, 4);
  assert.equal(RP.duplicates({ objectives: [] }).count, 0); assert.equal(RP.duplicates(null).count, 0);
});

test('withoutDuplicates: drops the reported objectives and later repeated deliverables, never the first occurrence', () => {
  const p = plan(); const out = RP.withoutDuplicates(p, RP.duplicates(p, { existingObjectiveKeys: ['itsm-roadmap-c'] }));
  assert.deepEqual(out.objectives.map((o) => o.name), ['A', 'B']);
  assert.deepEqual(out.objectives[0].deliverables.map((d) => d.name), ['Form One', 'Form Two']);
  assert.deepEqual(out.objectives[1].deliverables.map((d) => d.name), ['Three']);
  assert.equal(p.objectives.length, 4, 'input not mutated');
});

test('page helpers: steps gate the archive behind a publication, plan html escapes and lists duplicates', () => {
  assert.deepEqual(UI.steps({}).map((s) => s.available), [true, false, false, false]);
  assert.deepEqual(UI.steps({ dryRun: true }).map((s) => s.available), [true, true, false, false]);
  assert.deepEqual(UI.steps({ dryRun: true, migrated: true }).map((s) => s.available), [false, false, true, true]);
  assert.equal(UI.steps({ migrated: true, readOnly: true })[3].done, true);
  const p = plan(); p.objectives[0].name = '<b>x</b>';
  const h = UI.planHtml(p, RP.duplicates(p), esc);
  assert.ok(!h.includes('<b>x</b>') && h.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.match(h, /doublon/); assert.match(h, /id="rp-skip"/);
  assert.match(UI.planHtml(plan(), { count: 0, objectives: [], deliverables: [] }, esc), /Aucun doublon/);
  assert.match(UI.stateHtml({ migrated: true, parity: 'drift', read_only: false }, esc), /écarts constatés/);
});

test('page wiring: hidden section, libs loaded, mount guarded; nothing publishes on load', () => {
  assert.match(page, /<section id="rm-publish"[^>]*\shidden/);
  assert.match(page, /src="lib\/reasonDialog\.js"/); assert.match(page, /src="lib\/roadmapPublish\.js"/);
  assert.match(page, /RoadmapPublish\.mount\(/);
  const lib = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'roadmapPublish.js'), 'utf8');
  assert.match(lib, /roadmap_publication/, 'mount reads the switch');
  assert.ok(!/setTimeout|setInterval/.test(lib), 'nothing on a timer');
  const applies = lib.match(/apply=1/g) || [];
  assert.equal(applies.length, 2, 'two apply calls (publish, rollback), each behind a click');
});
