'use strict';
// Security review (2026-10-29, EA-01): the installer configuration is in git and in every package, so
// it must never hold a password. The PostgreSQL superuser password comes from PG_SUPER_PASSWORD, the
// silent-mode answers kept outside git, or a masked prompt.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'tools', 'installer');

test('no installer configuration file stores a password value', () => {
  const bad = [];
  for (const f of fs.readdirSync(DIR).filter((n) => /\.(psd1|template|ini|json)$/i.test(n))) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const [i, line] of src.split(/\r?\n/).entries()) {
      if (/^\s*#/.test(line)) continue;
      const m = /(pass(word)?|secret)\w*\s*=\s*'([^']*)'/i.exec(line);
      if (m && m[3] !== '') bad.push(`${f}:${i + 1}`);       // the value itself is never printed
    }
  }
  assert.deepEqual(bad, []);
});

test('the scripts read the superuser password from the environment or a prompt, never a fixed value', () => {
  const inst = fs.readFileSync(path.join(DIR, 'Install-SDP.ps1'), 'utf8');
  assert.match(inst, /\$env:PG_SUPER_PASSWORD/);
  assert.match(inst, /Read-Host 'PostgreSQL superuser \(postgres\) password' -AsSecureString/);
  assert.ok(!/--superpassword', \$cfg\.StandardPgSuperPassword/.test(inst), 'the PostgreSQL install uses the resolved password');
  const man = fs.readFileSync(path.join(DIR, 'Manage-SDP.ps1'), 'utf8');
  assert.match(man, /throw 'The PostgreSQL superuser password is required/);
});
