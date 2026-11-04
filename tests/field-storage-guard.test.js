'use strict';
// B-06 — field app storage durability: persistent storage is asked for ONCE, a near-full quota is reported,
// and a quota error on a queue write is recognised (so the technician is told the entry was NOT saved).
const test = require('node:test');
const assert = require('node:assert');
const FS = require('../public/field/storage.js');

function fakeStorage(o) {
  o = o || {};
  const calls = { persist: 0, persisted: 0, estimate: 0 };
  return {
    calls,
    persisted() { calls.persisted++; return Promise.resolve(!!o.already); },
    persist() { calls.persist++; return Promise.resolve(o.grant !== false); },
    estimate() { calls.estimate++; return Promise.resolve(o.estimate || { usage: 10, quota: 100 }); },
  };
}

test('ensurePersist asks the browser at most once, even when called concurrently and repeatedly', async () => {
  const st = fakeStorage();
  const g = FS.makeGuard(st);
  const [a, b] = await Promise.all([g.ensurePersist(), g.ensurePersist()]);
  const c = await g.ensurePersist();
  assert.strictEqual(st.calls.persist, 1);
  assert.strictEqual(a, true); assert.strictEqual(b, true); assert.strictEqual(c, true);
});

test('ensurePersist does not ask when storage is already persistent; refused grant is reported, not retried', async () => {
  const st = fakeStorage({ already: true });
  assert.strictEqual(await FS.makeGuard(st).ensurePersist(), true);
  assert.strictEqual(st.calls.persist, 0);
  const st2 = fakeStorage({ grant: false });
  const g2 = FS.makeGuard(st2);
  assert.strictEqual(await g2.ensurePersist(), false);
  assert.strictEqual(await g2.ensurePersist(), false);
  assert.strictEqual(st2.calls.persist, 1);
});

test('no StorageManager (old browser) → null, never a throw', async () => {
  const g = FS.makeGuard(undefined);
  assert.strictEqual(await g.ensurePersist(), null);
  assert.strictEqual(await g.usage(), null);
  const thrower = { persisted() { throw new Error('nope'); }, persist() { throw new Error('nope'); }, estimate() { return Promise.reject(new Error('x')); } };
  assert.strictEqual(await FS.makeGuard(thrower).ensurePersist(), null);
  assert.strictEqual(await FS.makeGuard(thrower).usage(), null);
});

test('usage: ratio + warn above 70 %; an unknown quota is null, never 0', async () => {
  assert.deepStrictEqual(await FS.makeGuard(fakeStorage({ estimate: { usage: 71, quota: 100 } })).usage(), { usage: 71, quota: 100, ratio: 0.71, warn: true });
  assert.strictEqual((await FS.makeGuard(fakeStorage({ estimate: { usage: 70, quota: 100 } })).usage()).warn, false);
  assert.strictEqual(await FS.makeGuard(fakeStorage({ estimate: { usage: 5 } })).usage(), null);
  assert.strictEqual(await FS.makeGuard(fakeStorage({ estimate: { usage: 5, quota: 0 } })).usage(), null);
  assert.strictEqual(FS.WARN_RATIO, 0.7);
});

test('isQuotaError recognises the browser variants and nothing else', () => {
  assert.ok(FS.isQuotaError({ name: 'QuotaExceededError' }));
  assert.ok(FS.isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }));
  assert.ok(FS.isQuotaError({ code: 22 }));
  assert.ok(!FS.isQuotaError({ name: 'AbortError' }));
  assert.ok(!FS.isQuotaError(null));
  assert.ok(!FS.isQuotaError(new Error('boom')));
});

test('app.js wires it: persist on queue, quota → "not saved", transaction abort rejects, badge rendered at boot', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'field', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const q = src.slice(src.indexOf('function queue(kind'), src.indexOf('var flushing'));
  assert.match(q, /ensurePersist\(\)/);
  assert.match(q, /isQuotaError\(err\)/);
  assert.match(q, /NOT saved/);
  assert.match(src, /t\.onabort = function \(\) \{ rej\(t\.error/, 'a quota abort must reject, not hang');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'field', 'index.html'), 'utf8');
  assert.ok(html.indexOf('<script src="storage.js"></script>') < html.indexOf('<script src="app.js"></script>'));
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'field', 'sw.js'), 'utf8');
  assert.match(sw, /'\/field\/storage\.js'/);
  assert.doesNotMatch(sw, /CACHE_VERSION = 'field-v[123]'/);
});
