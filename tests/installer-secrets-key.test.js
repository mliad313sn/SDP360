'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.argv.push('--dir', fs.mkdtempSync(path.join(os.tmpdir(), 'sdpsk-')));
const pi = require('../tools/installer-v2/post-install.js');
const cs = require('../services/configSecrets');
const PASS = 'original-passphrase-123456';
const enc = cs.encryptValue('smtp-secret', cs.keyFrom(PASS));
const fakeDb = (rows) => async () => ({ query: async () => ({ rows }), end: async () => {} });

test('no encrypted secrets: the guard lets a key be generated', async () => {
  await pi.secretsKeyGuard({ PG_URL: 'x' }, { connect: fakeDb([{ key: 'smtp_pass', value: 'plain' }]) });
});
test('encrypted secrets and no key in .env: refuses, names the keys', async () => {
  await assert.rejects(pi.secretsKeyGuard({ PG_URL: 'x' }, { connect: fakeDb([{ key: 'smtp_pass', value: enc }]) }), /smtp_pass.*no SDP_CONFIG_KEY/);
});
test('a key that opens none of the secrets: refuses', async () => {
  await assert.rejects(pi.secretsKeyGuard({ PG_URL: 'x', SDP_CONFIG_KEY: 'another-key-9876543210' }, { connect: fakeDb([{ key: 'smtp_pass', value: enc }]) }), /cannot decrypt/);
});
test('the original key passes', async () => {
  await pi.secretsKeyGuard({ PG_URL: 'x', SDP_CONFIG_KEY: PASS }, { connect: fakeDb([{ key: 'smtp_pass', value: enc }]) });
});
test('database unreachable: skipped with a log, not a crash', async () => {
  await pi.secretsKeyGuard({ PG_URL: 'x' }, { connect: async () => { throw new Error('down'); } });
});
