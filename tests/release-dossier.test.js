'use strict';
// C-27 / G35 — the GO / NO-GO dossier is a ledger, not a claim. These checks keep it honest:
// it names the commit it was built on (and that commit exists), it keeps production at NO-GO,
// it never states field / deployed / accepted as known, and no template placeholder survives.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOSSIER = path.join(ROOT, 'docs/agent-execution/G24-DOSSIER-GO-NOGO-FR.md');
const read = () => fs.readFileSync(DOSSIER, 'utf8').replace(/\r\n/g, '\n');

test('the dossier keeps production at NO-GO and the pilot conditional, with no placeholder left', () => {
  const md = read();
  assert.match(md, /\| \*\*Mise en production\*\* \| \*\*NO-GO\*\*/);
  assert.match(md, /\*\*GO sous conditions\*\*/);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(md), 'an unfilled {{PLACEHOLDER}} remains');
  assert.ok(!/GO (pour la )?production\b(?! NO)/i.test(md.replace(/NO-GO for production/g, '')),
    'the dossier must never recommend GO for production');
  assert.match(md, /INCONNU/, 'field / deployed / accepted must be stated as unknown');
  assert.match(md, /## English summary/);
});

test('the dossier names the commit it was built on, and that commit exists', () => {
  const md = read();
  const m = md.match(/Base : commit \*\*`([0-9a-f]{7,40})`\*\*/);
  assert.ok(m, 'the header must name its base commit');
  let git = true;
  try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, stdio: 'ignore' }); } catch { git = false; }
  // CI checks out a shallow clone (fetch-depth 1): an older base commit is legitimately absent there,
  // so the existence check only runs on a full clone.
  let shallow = false;
  if (git) { try { shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT }).toString().trim() === 'true'; } catch { /* old git: treat as full */ } }
  if (git && !shallow) {
    assert.doesNotThrow(() => execFileSync('git', ['cat-file', '-e', `${m[1]}^{commit}`], { cwd: ROOT, stdio: 'ignore' }),
      `base commit ${m[1]} is not in this repository`);
  }
});

test('every goal of plan v3 and every AMDEC follow-up has a ledger row whose evidence file exists', () => {
  const md = read();
  const ids = [];
  for (let i = 1; i <= 31; i++) ids.push(`C-${String(i).padStart(2, '0')}`);
  for (let i = 1; i <= 10; i++) ids.push(`D-${String(i).padStart(2, '0')}`);
  ids.push('SEC-01', 'AMDEC');
  for (const id of ids) assert.match(md, new RegExp(`^\\| ${id} \\|`, 'm'), `no ledger row for ${id}`);
  for (const f of new Set([...md.matchAll(/`((?:C|D)-[0-9]{2,6}|SEC-01|AMDEC)\.md`/g)].map((x) => x[1]))) {
    assert.ok(fs.existsSync(path.join(ROOT, 'docs/agent-execution', `${f}.md`)), `missing evidence file ${f}.md`);
  }
});

test('the human gates include the facts no file carries: exposed secret, Entra consent, branches, Dependabot', () => {
  const md = read();
  for (const needle of ['214c0d1', '92a6a68', 'User.Read.All', 'claude/sdp360-consolidation',
    'claude/confident-pascal-03veex', 'Dependabot', 'CAB', 'Fetekro Explorarion Office']) {
    assert.ok(md.includes(needle), `human gate missing: ${needle}`);
  }
});
