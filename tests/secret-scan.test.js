'use strict';
// EX-01 — the secret scanner blocks a release on a credential-shaped value in the tracked files, never
// prints a value, and knows the shapes that leaked before. Samples are built at run time so this file
// holds no credential-shaped literal itself.
const test = require('node:test');
const assert = require('node:assert');
const scan = require('../tools/security/secret-scan');

const pw = ['Xq7', 'vR2', 'pL9', 'mT4'].join('');
test('detects a password in a connection string, an assigned password, a private key and a webhook signature', () => {
  const lines = [
    `PG_URL=postgres://sdp_app:${pw}@db:5432/x`,
    `StandardPgSuperPassword = '${pw}${pw}'`,
    '-----BEGIN ' + 'PRIVATE KEY-----',
    `https://prod-01.westeurope.logic.azure.com/workflows/abc?api-version=1&sig=${pw}${pw}`,
  ];
  const rules = lines.map((l) => scan.scanText('f', l).map((h) => h.rule)[0]);
  assert.deepStrictEqual(rules, ['pg-url-password', 'assigned-password', 'private-key', 'teams-webhook']);
});

test('placeholders, variable names and CI throwaway values are not findings', () => {
  for (const l of ['PG_URL=postgres://sdp_app:<PG_PASSWORD>@db/x', "password: '${{ secrets.X }}'", 'PG_URL=postgres://postgres:postgres@localhost:5432/postgres',
    "const PASSWORD = 'analytics_client_secret'", "SDP_SETUP_PGSUPERPASS = '$env:SDP_SETUP_PGSUPERPASS'"]) {
    assert.deepStrictEqual(scan.scanText('f', l), [], l.replace(/:.*/, ''));
  }
});

test('findings carry file, line and rule only — never the value', () => {
  const h = scan.scanText('f', `PG_URL=postgres://u:${pw}@h/x`)[0];
  assert.deepStrictEqual(Object.keys(h).sort(), ['file', 'line', 'rule']);
});

test('the tracked files are clean (the release gate)', () => {
  assert.deepStrictEqual(scan.scanTree(), []);
});
