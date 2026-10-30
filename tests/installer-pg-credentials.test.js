'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');

test('previousEnvFiles finds the install .env and renamed .old-* copies, newest first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdpprev-'));
  const dir = path.join(root, 'SDP-Dashboard');
  for (const d of [dir, dir + '.old-20261001', dir + '.old-20261030', path.join(root, 'Other')]) { fs.mkdirSync(d); fs.writeFileSync(path.join(d, '.env'), 'PG_URL=x\n'); }
  const argv = process.argv; process.argv = [...argv, '--dir', dir];
  delete require.cache[require.resolve('../tools/installer-v2/post-install.js')];
  const pi = require('../tools/installer-v2/post-install.js');
  process.argv = argv;
  const got = pi.previousEnvFiles().map((f) => path.basename(path.dirname(f)));
  assert.deepStrictEqual(got, ['SDP-Dashboard', 'SDP-Dashboard.old-20261030', 'SDP-Dashboard.old-20261001']);
});

test('fourMyPeoplePassword reads StandardPgSuperPassword from FMP_CONFIG_PSD1', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fmp-')), 'config.psd1');
  fs.writeFileSync(f, "@{\n  StandardPgSuperPassword = 'pw-from-psd1'\n}\n");
  process.env.FMP_CONFIG_PSD1 = f;
  const pi = require('../tools/installer-v2/post-install.js');
  assert.strictEqual(pi.fourMyPeoplePassword(), 'pw-from-psd1');
  delete process.env.FMP_CONFIG_PSD1;
});
