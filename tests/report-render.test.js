'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderPdf } = require('../services/reportRender');

test('no browser found → degrades to htmlOnly result', async () => {
  const r = await renderPdf('<h1>hi</h1>', { findBrowser: () => null });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.htmlOnly, true);
  assert.match(r.reason, /no browser/i);
});

test('successful render returns a pdf buffer', async () => {
  const fakeSpawn = () => ({ on: (ev, cb) => { if (ev === 'close') setImmediate(() => cb(0)); }, kill: () => {} });
  const r = await renderPdf('<h1>hi</h1>', {
    findBrowser: () => 'chrome.exe',
    spawnFn: fakeSpawn,
    readOut: () => Buffer.from('%PDF-1.4 fake'),
  });
  assert.strictEqual(r.ok, true);
  assert.ok(Buffer.isBuffer(r.pdf));
  assert.match(r.pdf.toString('latin1').slice(0, 5), /%PDF/);
});

test('hung process past timeout is killed → htmlOnly', async () => {
  let killed = false;
  const hangSpawn = () => ({ on: () => {}, kill: () => { killed = true; } });
  const r = await renderPdf('<h1>hi</h1>', { findBrowser: () => 'chrome.exe', spawnFn: hangSpawn, timeoutMs: 30 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.htmlOnly, true);
  assert.strictEqual(killed, true);
});
