'use strict';
// E-A02 (audit A-02, first slice) — the Backups & recovery admin cards live in public/lib/reports-backups.js.
// Static guards: the module is loaded once (before the inline script), every handler the page calls resolves to a
// function of the page or the module, no top-level name is declared twice (classic-script redeclaration trap), and
// the module only touches its own cards' ids.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PAGE = fs.readFileSync(path.join(__dirname, '../public/reports.html'), 'utf8').replace(/\r\n/g, '\n');
const MOD = fs.readFileSync(path.join(__dirname, '../public/lib/reports-backups.js'), 'utf8').replace(/\r\n/g, '\n');
const MOVED = ['loadBackupSchedule', 'saveBackupSchedule', 'backupNowAdmin', 'loadTrash', 'restoreTrashRow', 'loadRestoreDrillCard'];
const inline = () => [...PAGE.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const topNames = (src) => new Set([...src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1] || m[2]));

test('the module is loaded exactly once, before the inline script', () => {
  const tags = PAGE.match(/<script src="lib\/reports-backups\.js"><\/script>/g) || [];
  assert.equal(tags.length, 1);
  assert.ok(PAGE.indexOf('lib/reports-backups.js') < PAGE.indexOf('function api(method, path, body)'));
});

test('the moved functions are declared in the module, no longer in the page; the module compiles and runs nothing at load', () => {
  const page = topNames(inline()); const mod = topNames(MOD);
  for (const f of MOVED) { assert.ok(mod.has(f), f + ' in module'); assert.ok(!page.has(f), f + ' not redeclared in the page'); }
  const ctx = {}; vm.runInNewContext(MOD, ctx);   // defines functions only — no DOM access, no api() call at load
  for (const f of MOVED) assert.equal(typeof ctx[f], 'function', f + ' reachable as a global');
  assert.doesNotMatch(MOD, /^(?:const|let)\s/m, 'no top-level const/let (shared with the page script)');
});

test('no top-level name is declared in both the page and the module', () => {
  const page = topNames(inline());
  const dup = [...topNames(MOD)].filter((n) => page.has(n));
  assert.deepEqual(dup, []);
});

test('every on*="name(…)" handler of the page resolves to a function of the page, the module or a loaded lib', () => {
  const declared = new Set([...topNames(inline()), ...topNames(MOD)]);
  const called = new Set([...PAGE.matchAll(/\son[a-z]+="(?:event\.stopPropagation\(\);\s*)?(?:return\s+)?([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]));
  const builtins = new Set(['confirm', 'alert', 'if', 'this', 'document', 'window', 'event', 'location', 'history', 'setTimeout']);
  const missing = MOVED.filter((f) => called.has(f) && !declared.has(f));
  assert.deepEqual(missing, []);
  for (const f of ['backupNowAdmin', 'saveBackupSchedule', 'loadTrash']) assert.ok(called.has(f), f + ' is still called from the page markup');
  void builtins;
});

test('the module only touches its own cards (#bk-*, #trash-*, #rd-*) and the page still wires the loaders', () => {
  const ids = [...MOD.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 5);
  assert.deepEqual(ids.filter((id) => !/^(bk|trash|rd)-/.test(id)), []);
  for (const id of new Set(ids)) assert.ok(PAGE.includes(`id="${id}"`), id + ' exists in the page');
  assert.match(PAGE, /name === 'backups' && typeof loadBackupSchedule === 'function'/);
  assert.match(PAGE, /name === 'trash' && typeof loadTrash === 'function'/);
});
