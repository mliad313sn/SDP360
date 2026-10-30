'use strict';
// E1 — the release/CI workflows are configuration that bit us once already: the signing step's
// `if: env.PFX != ''` read a step-level env that is invisible to the step's own condition, so
// every release shipped "signed: NO" without anyone noticing. These checks parse the YAML
// (a real parser when `yaml` / `js-yaml` is installed, else a strict line-based reading) and
// FAIL if any of the E1 rules regresses:
//   1. the signing condition references the secret (through a job-level env), never `env.PFX`;
//   2. the certificate password never goes to GITHUB_ENV and never appears on a command line
//      (`/p ${{ secrets...` or `/p $env:...` inside a logged `run:` is refused — it must be
//      expanded inside the wrapper script at run time);
//   3. every `uses:` is pinned to a 40-hex commit SHA with the tag kept as a comment;
//   4. `permissions:` is declared at workflow level with `contents: read`; `contents: write`
//      appears only on the publish job of release.yml;
//   5. the manifest signing key is handed to the packager step only through `env:`.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WF_DIR = path.join(__dirname, '..', '.github', 'workflows');
const files = fs.readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f)).sort();
const read = f => fs.readFileSync(path.join(WF_DIR, f), 'utf8').replace(/\r\n/g, '\n');

let yaml = null;
for (const name of ['yaml', 'js-yaml']) { try { yaml = { name, mod: require(name) }; break; } catch (_) { /* optional */ } }
function parse(text) {
  if (!yaml) return null;
  return yaml.name === 'yaml' ? yaml.mod.parse(text) : yaml.mod.load(text);
}

// Line-based helpers (always run — the parser, when present, is a second opinion).
const codeLines = text => text.split('\n').filter(l => !/^\s*#/.test(l));

test('workflow directory holds the four expected workflows', () => {
  assert.deepEqual(files, ['ci.yml', 'codeql.yml', 'installer.yml', 'release.yml']);
});

test('every `uses:` is pinned to a 40-hex commit SHA with a version comment', () => {
  for (const f of files) {
    const uses = codeLines(read(f)).filter(l => /^\s*-?\s*uses:\s*/.test(l));
    assert.ok(uses.length > 0, `${f}: no uses:`);
    for (const l of uses) {
      const m = /uses:\s*([^\s@]+)@([^\s#]+)\s*(#\s*v?\d[\w.-]*)?\s*$/.exec(l);
      assert.ok(m, `${f}: unparsable uses line: ${l.trim()}`);
      assert.match(m[2], /^[0-9a-f]{40}$/, `${f}: ${m[1]} is pinned to "${m[2]}", not a commit SHA`);
      assert.ok(m[3], `${f}: ${m[1]} pin lacks the "# vX.Y.Z" comment`);
    }
  }
});

test('workflow-level permissions are contents: read; contents: write only on the release publish job', () => {
  for (const f of files) {
    const text = read(f);
    const lines = codeLines(text);
    const top = lines.findIndex(l => /^permissions:\s*$/.test(l));
    assert.ok(top >= 0, `${f}: no workflow-level permissions block`);
    assert.match(lines[top + 1], /^\s+contents:\s*read\s*$/, `${f}: workflow permissions must start with contents: read`);
    const writes = lines.filter(l => /^\s+contents:\s*write/.test(l));
    if (f === 'release.yml') assert.equal(writes.length, 1, 'release.yml: exactly one contents: write (publish job)');
    else assert.equal(writes.length, 0, `${f}: contents: write not allowed`);
    const doc = parse(text);
    if (doc) {
      assert.deepEqual(doc.permissions, { contents: 'read' }, `${f}: parsed workflow permissions`);
      for (const [name, job] of Object.entries(doc.jobs)) {
        const w = !!(job.permissions && job.permissions.contents === 'write');   // a job without permissions inherits read
        assert.equal(w, f === 'release.yml' && name === 'publish', `${f}: job ${name} contents:write`);
      }
    }
  }
});

test('release.yml: the signing condition reads the secret through a JOB-level env, never a step-level env.PFX', () => {
  const text = read('release.yml');
  const lines = codeLines(text);
  assert.ok(!lines.some(l => /if:.*env\.PFX/.test(l)), 'the step-level `if: env.PFX` regression is back');
  // the job-level flag is computed from the secret…
  const flag = lines.find(l => /^\s{6}SIGN:\s*\$\{\{\s*secrets\.SIGNING_CERT_PFX_BASE64\s*!=\s*''\s*\}\}/.test(l));
  assert.ok(flag, 'installer job must declare env SIGN: ${{ secrets.SIGNING_CERT_PFX_BASE64 != \'\' }}');
  // …and the import step is gated on it
  const gate = lines.find(l => /^\s+if:\s*env\.SIGN\s*==\s*'true'\s*$/.test(l));
  assert.ok(gate, 'the certificate import step must be gated with if: env.SIGN == \'true\'');
  const doc = parse(text);
  if (doc) {
    const job = doc.jobs.installer;
    assert.match(String(job.env.SIGN), /secrets\.SIGNING_CERT_PFX_BASE64/);
    const imp = job.steps.find(s => /signing certificate/i.test(s.name || ''));
    assert.ok(imp && /env\.SIGN == 'true'/.test(String(imp.if)));
    assert.ok(!Object.keys(imp.env || {}).includes('SIGNING_CERT_PASSWORD'), 'the import step must not receive the password');
  }
});

test('release.yml: the certificate password never reaches GITHUB_ENV nor a logged command line', () => {
  const text = read('release.yml');
  const lines = codeLines(text);
  assert.ok(!lines.some(l => /GITHUB_ENV/.test(l)), 'no step may write to GITHUB_ENV (the old step wrote the signtool command, password included)');
  // the password reaches exactly one step, as env:, and is never interpolated with ${{ }} in a run block
  const refs = lines.filter(l => /secrets\.SIGNING_CERT_PASSWORD/.test(l));
  assert.equal(refs.length, 1, 'SIGNING_CERT_PASSWORD referenced exactly once');
  assert.match(refs[0], /^\s+SIGNING_CERT_PASSWORD:\s*\$\{\{\s*secrets\.SIGNING_CERT_PASSWORD\s*\}\}\s*$/, 'must be an env: mapping, not an inline expression');
  // signtool's /p must be read from the env var INSIDE the wrapper (expanded at run time), never an expression
  for (const l of lines) {
    if (/\/p\s/.test(l)) assert.match(l, /\/p\s+"?%SIGNING_CERT_PASSWORD%"?/, `signtool /p must read %SIGNING_CERT_PASSWORD% in the wrapper: ${l.trim()}`);
    assert.ok(!/\/p\s+\$\{\{/.test(l) && !/\/p\s+\$env:/.test(l), `password interpolated on a command line: ${l.trim()}`);
  }
  // the manifest signing key: env: of the packager step only, never in a run line
  const keyRefs = lines.filter(l => /secrets\.SIGNING_MANIFEST_KEY/.test(l));
  assert.ok(keyRefs.length >= 1);
  for (const l of keyRefs) assert.match(l, /^\s+SIGNING_MANIFEST_KEY:\s*\$\{\{\s*secrets\.SIGNING_MANIFEST_KEY\s*\}\}\s*$/, `manifest key must be an env: mapping only: ${l.trim()}`);
  const doc = parse(text);
  if (doc) {
    const build = doc.jobs.installer.steps.find(s => /Build Setup/i.test(s.name || ''));
    assert.ok(build && build.env && /secrets\.SIGNING_CERT_PASSWORD/.test(String(build.env.SIGNING_CERT_PASSWORD)));
    const pkgStep = doc.jobs.package.steps.find(s => s.id === 'pkg');
    assert.ok(pkgStep && pkgStep.env && /secrets\.SIGNING_MANIFEST_KEY/.test(String(pkgStep.env.SIGNING_MANIFEST_KEY)));
  }
});

test('release.yml: the release job verifies the built package with the Manager and publishes SIGNING.txt', () => {
  const text = read('release.yml');
  assert.match(text, /node tools\/sdp-manager\.js verify/, 'the package job must run the Manager verify on the built zip');
  assert.match(text, /SIGNING\.txt/);
  assert.match(text, /manifest signed/);
});

test('installer.yml: builds Setup.exe with build.ps1 and runs the Windows end-to-end test', () => {
  const text = read('installer.yml');
  assert.match(text, /runs-on:\s*windows-latest/);
  assert.match(text, /tools\/installer-v2\/build\.ps1/);
  assert.match(text, /tools\/installer-v2\/tests\/e2e\.ps1/);
  assert.ok(!/secrets\./.test(text), 'installer.yml handles no secret');
});

test('release.yml: the installer job builds through build.ps1 around the already-built package', () => {
  const text = read('release.yml');
  assert.match(text, /build\.ps1 -Version \$v -PackageZip/);
});

test('G01: the PostgreSQL service gets enough shared memory (one database per test file exhausted Docker\'s 64 MB default)', () => {
  const ci = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /--shm-size=\d+[gm]/);
});
