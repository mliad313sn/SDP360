'use strict';
// RBAC audit 2026-10-02, lot 3 — buttons the server refuses must not be offered.
// Each control below was visible to every role while its route 403'd for most of them.
// Same pattern as the existing admin-only Excel button: hidden in the markup, revealed by
// window.__userHasRole(<the route's role>). The server stays the enforcement point.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').replace(/\r\n/g, '\n');
const tagOf = (src, id) => {
  const m = new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`).exec(src);
  assert.ok(m, `#${id} not found`);
  return m[0];
};

test('A4/4b inspections roll-up PPTX: hidden by default, revealed for editor+ (route forces their site)', () => {
  const src = read('inspections.html');
  assert.match(tagOf(src, 'exportBtn'), /display:\s*none/);
  assert.match(src, /__userHasRole\('editor'\)\) document\.getElementById\('exportBtn'\)\.style\.display = ''/);
});

test('4b inspections: Excel and Delete open to editors, Delete only on their own site rows', () => {
  const src = read('inspections.html');
  assert.match(src, /xl && window\.__userHasRole && window\.__userHasRole\('editor'\)/);
  assert.match(src, /const canDelete = hasRole\('editor'\)/);
  assert.match(src, /canDelete && \(!_inspScope \|\| r\.site_code === _inspScope\)/);
  assert.match(read('inspection-actions.html'), /__userHasRole\('editor'\)\)\) \{ b\.style\.display = 'none'/);
});

test('4b inspection form: Re-open offered to editors (the server checks the site)', () => {
  const src = read('inspection.html');
  assert.match(src, /const canReopen = has\('editor'\)/);
});

test('A6/4c PV delete: shown to editor+ (the server keeps them on their own site)', () => {
  const src = read('meeting.html');
  assert.doesNotMatch(src, /getElementById\('pvDeleteBtn'\)\.style\.display = '';/);
  assert.match(src, /pvDeleteBtn[\s\S]{0,200}__userHasRole\('editor'\)/);
});

test('4c meetings: import page, Excel exports and the closed-PV banner are opened to editors', () => {
  assert.match(read('meetings-import.html'), /src="auth\.js" data-require="editor"/);
  assert.match(read('meetings.html'), /!\(window\.__userHasRole && window\.__userHasRole\('editor'\)\)\) return;/);
  assert.match(read('meetings-actions.html'), /__userHasRole\('editor'\)\)\) \{ b\.style\.display = 'none'/);
  assert.doesNotMatch(read('meeting.html'), /admins can re-open/);
});

test('A15 assets inventory Excel: hidden by default, revealed for admin+ (route = admin)', () => {
  const src = read('assets.html');
  assert.match(tagOf(src, 'inv-exportBtn'), /display:\s*none/);
  assert.match(src, /__userHasRole\('admin'\)\)\s*document\.getElementById\('inv-exportBtn'\)\.style\.display = ''/);
});

test('Revert to Draft is offered to editors, like the server (own site — decision 2026-10-02)', () => {
  const src = read('reports.html');
  assert.doesNotMatch(src, /btnRevert\.style\.display = currentUser\.role === 'super_admin'/);
  assert.match(src, /btnRevert\.style\.display = \(window\.__userHasRole && window\.__userHasRole\('editor'\)\)/);
});

test('A19 Deck Builder nav link matches the page gate (super_admin)', () => {
  const shell = read('_shell.js');
  const page = read('executive-report.html');
  const gate = /<script src="auth\.js" data-require="([^"]+)"/.exec(page)[1];
  const link = /\{ id: 'reports-builder'[^}]*roles: \[([^\]]*)\]/.exec(shell)[1];
  const roles = link.split(',').map(s => s.trim().replace(/'/g, ''));
  assert.deepEqual(roles, gate.split('|'));
});

test('lot 4a: reports.html decides admin-tier UI by the role hierarchy, never the exact role string', () => {
  const src = read('reports.html');
  // `role === 'admin'` excluded executives (and super_admins whose legacy role column differs).
  assert.doesNotMatch(src, /\.role\s*[!=]==\s*'admin'/);
  assert.match(src, /function _adminTier\(\)/);
});

test('4d WAN SLA tab is offered to editors (the server limits every SLA read to their site)', () => {
  const src = read('wan.html');
  assert.match(src, /const canSeeSla = !!\(window\.__userHasRole && window\.__userHasRole\('editor'\)\)/);
  assert.match(src, /if \(name === 'sla' && !canSeeSla\) name = 'health';/);
});
