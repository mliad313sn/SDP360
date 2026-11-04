'use strict';
// A-06 — the PV page sends the edit token it was given and, on 409, blocks with a banner
// instead of reloading (a reload would silently discard what the coordinator typed).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fnSource } = require('./_fn-source');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'meeting.html'), 'utf8').replace(/\r\n/g, '\n');
// save(opts = {}) — the default parameter's `{}` defeats fnSource's brace fallback (the page
// is one indented IIFE, no column-0 brace), so slice it to the line after its own close.
function saveSource() {
  const start = src.indexOf('async function save(opts = {}) {');
  const end = src.indexOf("\n  document.getElementById('pvSaveBtn')", start);
  if (start < 0 || end < 0) throw new Error('save() not found');
  return src.slice(start, end);
}

test('save() sends header.expected_edit_token from the token the GET returned', () => {
  const code = saveSource();
  assert.match(code, /expected_edit_token\s*:\s*state\.header\.edit_token/);
});

test('on a 409 save() shows the conflict banner and does not call reload()', async () => {
  const code = saveSource();
  const calls = { reload: 0, conflict: 0, banner: [] };
  const btn = { disabled: false };
  const state = { id: 7, header: { status: 'draft', edit_token: 'T1' }, projects: [], issues: [], actions: [] };
  let sent = null;
  const fetchStub = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: false, status: 409, json: async () => ({ error: 'changed elsewhere', code: 'CONFLICT', current_token: 'T2' }) }; };
  const fn = new Function('document', 'state', 'API', 'fetch', 'authHeaders', 'IncubationEditor', 'showBanner', 'reload', 'showConflictBanner', 'history',
    code + '\nreturn save;')(
    { getElementById: () => btn }, state, '/api/meetings', fetchStub, () => ({}), { payloadIncubation: () => null },
    (t, k) => calls.banner.push([t, k]), async () => { calls.reload++; }, () => { calls.conflict++; }, { replaceState() {} });
  const ok = await fn();
  assert.equal(ok, false);
  assert.equal(sent.state.header.expected_edit_token, 'T1');
  assert.equal(calls.reload, 0, 'never reload on a conflict');
  assert.equal(calls.conflict, 1, 'conflict banner shown');
  assert.equal(btn.disabled, false);
});

test('the conflict banner offers Reload and Copy my edits, wired without inline handlers', () => {
  const code = fnSource(src, 'showConflictBanner');
  assert.match(code, /Your edits were NOT saved/);
  assert.match(code, /Copy my edits/);
  assert.match(code, /Reload/);
  assert.match(code, /clipboard/);
  assert.ok(!/onclick=/i.test(code));
});
