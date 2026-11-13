'use strict';
// W4-CONNECTORS — .mpp via an admin-configured local converter: nothing runs while unconfigured (501 with how-to), the
// command path is validated (absolute, no shell characters, executable), the upload is checked (OLE2 magic, size), the
// converter runs with an ARGUMENT ARRAY (no shell) and a timeout in a private temp dir that is always removed.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../services/ppm/mppConverter');
const MSPDI = require('../services/ppm/mspdi');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpp-fake-'));
const write = (name, body) => { const p = path.join(dir, name); fs.writeFileSync(p, body, { mode: 0o755 }); return p; };
const XML = MSPDI.toXml({ name: 'Fictitious converted', start_date: '2027-01-04', tasks: [{ uid: 1, id: 1, name: 'A', outline_level: 1, duration_days: 2 }] });
const xmlFile = write('out.fixture.xml', XML);
const okConv = write('fake-mpxj', `#!/bin/sh\n[ "$#" -eq 2 ] || exit 3\nhead -c 8 "$1" | od -An -tx1 | grep -q "d0 cf 11 e0" || exit 4\ncp "${xmlFile}" "$2"\n`);
const slowConv = write('slow-conv', '#!/bin/sh\nsleep 5\n');
const badConv = write('bad-conv', '#!/bin/sh\nexit 7\n');
const noOut = write('noout-conv', '#!/bin/sh\nexit 0\n');
const mpp = Buffer.concat([C.OLE2_MAGIC, Buffer.from('fictitious body')]);

test('no command configured → 501 with the how-to; nothing executed', async () => {
  let ran = false;
  await assert.rejects(C.convert(mpp, { cmd: '', run: () => { ran = true; } }), (e) => e.status === 501 && e.reason === 'MPP_CONVERTER_NOT_CONFIGURED' && /ppm_mpp_converter_cmd/.test(e.message));
  assert.strictEqual(ran, false);
});

test('command validation: relative, shell characters, missing, not executable', () => {
  assert.throws(() => C.validateCommand('mpxj'), (e) => e.reason === 'MPP_CONVERTER_INVALID');
  assert.throws(() => C.validateCommand(okConv + ' ; rm -rf /'), (e) => e.reason === 'MPP_CONVERTER_INVALID');
  assert.throws(() => C.validateCommand('/bin/sh -c id'), (e) => e.reason === 'MPP_CONVERTER_INVALID');
  assert.throws(() => C.validateCommand(path.join(dir, 'nope')), (e) => e.reason === 'MPP_CONVERTER_MISSING');
  if (process.platform !== 'win32') { const ne = path.join(dir, 'noexec'); fs.writeFileSync(ne, 'x', { mode: 0o644 }); assert.throws(() => C.validateCommand(ne), (e) => e.reason === 'MPP_CONVERTER_INVALID'); }
  assert.strictEqual(C.validateCommand(okConv), okConv);
});

test('upload validation: empty, not OLE2, too large', async () => {
  await assert.rejects(C.convert(Buffer.alloc(0), { cmd: okConv }), (e) => e.reason === 'EMPTY_BODY');
  await assert.rejects(C.convert(Buffer.from('<Project/>'), { cmd: okConv }), (e) => e.reason === 'MPP_NOT_OLE2');
  assert.throws(() => C.validateUpload(Buffer.concat([C.OLE2_MAGIC, Buffer.alloc(C.MAX_BYTES)])), (e) => e.status === 413);
});

test('the fake converter turns the upload into MSPDI; argument array, no shell, temp dir removed', async () => {
  let seen;
  const run = (cmd, args, opts, cb) => { seen = { cmd, args, opts }; return require('child_process').execFile(cmd, args, opts, cb); };
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('sdp-mpp-')).length;
  const xml = await C.convert(mpp, { cmd: okConv, run });
  assert.strictEqual(MSPDI.fromXml(xml).name, 'Fictitious converted');
  assert.strictEqual(seen.opts.shell, false); assert.strictEqual(seen.args.length, 2); assert.ok(seen.args[0].endsWith('in.mpp'));
  assert.ok(!fs.existsSync(path.dirname(seen.args[0])), 'temp dir removed');
  assert.strictEqual(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('sdp-mpp-')).length, before);
});

test('converter failures: exit code, no output, timeout', async () => {
  await assert.rejects(C.convert(mpp, { cmd: badConv }), (e) => e.reason === 'MPP_CONVERTER_FAILED' && e.status === 502);
  await assert.rejects(C.convert(mpp, { cmd: noOut }), (e) => e.reason === 'MPP_CONVERTER_NO_OUTPUT');
  await assert.rejects(C.convert(mpp, { cmd: slowConv, timeoutMs: 300 }), (e) => e.reason === 'MPP_CONVERTER_TIMEOUT' && e.status === 504);
});
