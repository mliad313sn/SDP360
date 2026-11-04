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

// A-28c — temp files go into a fresh mkdtemp directory (unpredictable name) that is removed in every
// outcome; --no-sandbox stays the default (pm2 runs as SYSTEM) and SDP_PDF_SANDBOX=1 drops it.
const fs = require('fs');
const os = require('os');
const path = require('path');
function _spy() {
  const seen = { writes: [], removed: [] };
  return {
    seen,
    writeFile: (p, s) => { seen.writes.push(p); fs.writeFileSync(p, s); },
    rmDir: (d) => { seen.removed.push(d); fs.rmSync(d, { recursive: true, force: true }); },
  };
}
for (const [label, spawnFn, extra] of [
  ['success', () => ({ on: (ev, cb) => { if (ev === 'close') setImmediate(() => cb(0)); }, kill() {} }), { readOut: () => Buffer.from('%PDF') }],
  ['failure', () => ({ on: (ev, cb) => { if (ev === 'close') setImmediate(() => cb(1)); }, kill() {} }), {}],
  ['timeout', () => ({ on: () => {}, kill() {} }), { timeoutMs: 20 }],
]) {
  test(`A-28c: temp dir is fresh, unpredictable and removed after ${label}`, async () => {
    const s = _spy(); let args = null;
    await renderPdf('<p>x</p>', { findBrowser: () => 'chrome', spawnFn: (b, a) => { args = a; return spawnFn(); }, writeFile: s.writeFile, rmDir: s.rmDir, stamp: 'HGO-2026-07', ...extra });
    assert.strictEqual(s.seen.writes.length, 1);
    const dir = path.dirname(s.seen.writes[0]);
    assert.strictEqual(path.dirname(dir), os.tmpdir(), 'inside the OS temp folder');
    assert.match(path.basename(dir), /^sdp-pdf-.{6,}$/, 'mkdtemp directory');
    assert.ok(!s.seen.writes[0].includes('HGO-2026-07'), 'file name does not reveal site/period');
    assert.ok(args.some((a) => a.startsWith('--print-to-pdf=' + dir)), 'pdf written in the same private dir');
    assert.deepStrictEqual(s.seen.removed, [dir]);
    assert.strictEqual(fs.existsSync(dir), false, 'directory removed');
  });
}

test('A-28c: default args keep --no-sandbox; SDP_PDF_SANDBOX=1 removes it', async () => {
  const run = async () => { let args; await renderPdf('<p/>', { findBrowser: () => 'c', spawnFn: (b, a) => { args = a; return { on: (ev, cb) => { if (ev === 'close') setImmediate(() => cb(1)); }, kill() {} }; } }); return args; };
  const prev = process.env.SDP_PDF_SANDBOX;
  try {
    delete process.env.SDP_PDF_SANDBOX;
    assert.ok((await run()).includes('--no-sandbox'));
    process.env.SDP_PDF_SANDBOX = '1';
    assert.ok(!(await run()).includes('--no-sandbox'));
  } finally { if (prev === undefined) delete process.env.SDP_PDF_SANDBOX; else process.env.SDP_PDF_SANDBOX = prev; }
});
