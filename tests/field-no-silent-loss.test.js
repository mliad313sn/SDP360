'use strict';
// G19 — the phone only forgets an entry the server has APPLIED. A 401, a 409 "in progress", a 5xx, a refusal or
// a conflict keeps it (with its state); entries carry their author; queue buttons ignore a second tap.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'field', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const send = SRC.slice(SRC.indexOf('function sendOne(e)'), SRC.indexOf('function uploadPhotos(e)'));

test('the only deletion in sendOne follows an applied answer', () => {
  const dels = send.split('\n').filter((l) => l.includes('obDel('));
  assert.strictEqual(dels.length, 1);
  assert.match(dels[0], /j\.ok \|\| \(j\.duplicate && j\.status === 'applied'\)/);
});

test('401, in-progress and 5xx keep the entry; refusal and conflict keep it with a state', () => {
  assert.match(send, /j\.__status === 401\) \{[^}]*return true; \}/);
  assert.match(send, /j\.__status === 409 && j\.in_progress\) \{/);
  assert.match(send, /e\.state = 'needs_review'/, 'stuck too long → needs review, never re-sent automatically');
  assert.match(send, /e\.state = 'unknown_outcome'/, 'a ticket whose SDP outcome is unknown is never offered for re-send');
  assert.match(send, /j\.wrong_author\) \{ sessionMismatch = true;/);
  assert.match(send, /e\.state = 'failed'/);
  assert.match(send, /e\.state = j\.__status === 409 \? \(j\.status === 'applied' \? 'applied_before' : 'conflict'\) : 'rejected'/);
});

test('flush only sends the current user\'s pending/failed entries; discard asks first; double taps are ignored', () => {
  assert.match(SRC, /user: me, state: 'pending'/);
  assert.match(SRC, /return st === 'pending' \|\| st === 'failed';/);
  assert.match(SRC, /if \(me && e\.user !== me\) return 'other_user'/);
  assert.match(SRC, /window\.confirm\(FT\('Discard this entry for good\?'\)/);
  assert.match(SRC, /once\(\$\('i-save'\), queueInspection\)/);
});

test('review fixes: atomic swap on "Send again", conflict on an applied original = discard only, per-entry error isolation, per-user cache', () => {
  assert.match(SRC, /var obSwap = function \(oldId, e\) \{ return tx\('outbox', 'readwrite', function \(s\) \{ s\.put\(e\); s\.delete\(oldId\); \}\); \};/);
  assert.match(SRC, /j\.status === 'applied' \? 'applied_before' : 'conflict'/);
  assert.match(SRC, /\['applied_before', 'unknown_outcome', 'needs_review'\]\.indexOf\(stateOf\(e\)\) >= 0\) return;/);
  assert.match(SRC, /if \(!me \|\| sessionMismatch\) return;/);
  assert.match(SRC, /author: e\.user \|\| me/);
  assert.match(SRC, /sendOne\(e\)\.catch\(function \(err\) \{ return entryError\(e, err\); \}\)/);
  assert.match(SRC, /kvSet\('bootstrap:' \+ me, j\)/);
  assert.match(SRC, /j\.__stale && !\(j\.user && j\.user\.username === me\)/);
  assert.match(SRC, /if \(!e\.user\) return 'unknown_author'/);
  assert.match(SRC, /return obPut\(e\)\.then\(function \(\) \{ return j\.upload; \}\)/, 'upload id kept before the chunks');
});
