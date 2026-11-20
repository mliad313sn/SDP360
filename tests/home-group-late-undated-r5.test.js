'use strict';
// P11 round 5 (UX/field) — F-17: the Home group card said "no late project" when no project had an end date.
// Lateness cannot be measured without an end date: all undated → "not measured"; some undated → the verdict says so.
const { test } = require('node:test');
const assert = require('node:assert');
const HG = require('../public/lib/homeGroup');

test('every open project undated → not measured, never "no late project"', () => {
  const lp = HG.lateProjects({ gantt: [{ id: 1, name: 'A', late: false, slip_days: null, end: null, status: 'active' }, { id: 2, name: 'B', late: false, slip_days: null, status: 'planned' }] });
  assert.strictEqual(lp.total, 0); assert.strictEqual(lp.undated, 2); assert.strictEqual(lp.open, 2);
  for (const lang of ['fr', 'en']) {
    const html = HG.groupHtml({ late: lp, decisions: null }, lang);
    assert.doesNotMatch(html, /aucun projet en retard|no late project/, lang);
    assert.match(html, lang === 'fr' ? /non mesuré/ : /not measured/);
  }
});

test('some undated → "no late project" carries the undated count; all dated → unchanged; done/cancelled ignored', () => {
  const lp = HG.lateProjects({ gantt: [{ id: 1, name: 'A', late: false, end: '2027-01-01', status: 'active' }, { id: 2, name: 'B', late: false, status: 'active' }, { id: 3, name: 'C', late: false, status: 'done' }] });
  assert.strictEqual(lp.undated, 1); assert.strictEqual(lp.open, 2);
  const fr = HG.groupHtml({ late: lp, decisions: null }, 'fr');
  assert.match(fr, /aucun projet en retard/); assert.match(fr, /1 sans date de fin/);
  const dated = HG.lateProjects({ gantt: [{ id: 1, name: 'A', late: false, end: '2027-01-01', status: 'active' }] });
  assert.strictEqual(dated.undated, 0);
  assert.doesNotMatch(HG.groupHtml({ late: dated, decisions: null }, 'en'), /end date/);
});
