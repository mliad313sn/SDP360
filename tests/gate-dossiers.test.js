'use strict';
// P10 — the release-gate decision dossiers must never cite evidence older than the tree they describe.
// They are generated from tools/release/gate-dossiers.source.js; when a cited file changes, when a parallel lot
// delivers an "awaited" file, or when RELEASE-GATES.md changes, this test fails until someone runs
//   node tools/release/gate-dossiers.js --sha=<target sha>
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const gd = require('../tools/release/gate-dossiers.js');

const ROOT = path.join(__dirname, '..');
const read = (rel, root = ROOT) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const SECTIONS = {
  en: ['## 1. Question to decide', '## 2. Evidence at the target SHA', '## 3. Not evidenced, and why', '## 4. Options and consequences', '## 5. Residual risks if approved today', '## 6. What the approver must supply'],
  fr: ['## 1. La question à trancher', '## 2. Preuves au SHA cible', '## 3. Ce qui n\'est pas prouvé, et pourquoi', '## 4. Options et conséquences', '## 5. Risques résiduels en cas d\'accord aujourd\'hui', '## 6. Ce que l\'approbateur doit fournir'],
};

test('every RELEASE-GATES row has a dossier in English and in French, with the six sections', () => {
  const rows = gd.parseGateRows(read(gd.GATES_MD));
  assert.strictEqual(rows.length, 21, 'RELEASE-GATES.md is expected to list 21 gates');
  const { gates } = require('../tools/release/gate-dossiers.source.js');
  assert.deepStrictEqual(gd.validate(require('../tools/release/gate-dossiers.source.js'), rows), []);
  for (const g of gates) {
    for (const lang of ['en', 'fr']) {
      const md = read(`${gd.OUT_DIR}/${lang}/${g.id}-${g.slug}.md`);
      for (const s of SECTIONS[lang]) assert.ok(md.includes(s), `${lang}/${g.id} lacks "${s}"`);
    }
  }
});

test('the dossiers are fresh: no cited evidence changed after they were generated', () => {
  const reasons = gd.checkStale(ROOT);
  assert.deepStrictEqual(reasons, [], 'regenerate with: node tools/release/gate-dossiers.js --sha=<target sha>\n' + reasons.join('\n'));
});

test('no dossier fills a decision: every gate is shown NO-GO while its RELEASE-GATES cell is empty', () => {
  const manifest = JSON.parse(read(gd.MANIFEST));
  const { gates } = require('../tools/release/gate-dossiers.source.js');
  for (const g of gates) {
    const row = manifest.rows.find((r) => r.gate === g.row);
    if (row.decision) continue; // a person filled it; the dossier reproduces, never decides
    assert.match(read(`${gd.OUT_DIR}/en/${g.id}-${g.slug}.md`), /this gate is \*\*NO-GO\*\* until the approver fills it/);
    assert.match(read(`${gd.OUT_DIR}/fr/${g.id}-${g.slug}.md`), /cette porte est \*\*NO-GO\*\* tant que/);
  }
});

test('the critical path to the pilot is ordered by dependency and ends with gates that block the pilot', () => {
  const { gates } = require('../tools/release/gate-dossiers.source.js');
  const pathIds = gd.pilotPath(gates);
  const pos = new Map(pathIds.map((id, i) => [id, i]));
  for (const id of pathIds) for (const d of gates.find((g) => g.id === id).depends || []) assert.ok(pos.get(d) < pos.get(id), `${d} must come before ${id}`);
  for (const g of gates) if (g.blocks === 'pilot') assert.ok(pos.has(g.id), `${g.id} blocks the pilot but is not on the path`);
});

test('the target SHA is a commit of this history (full clone only)', (t) => {
  const manifest = JSON.parse(read(gd.MANIFEST));
  let full = false;
  try { full = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT }).toString().trim() === 'false'; } catch { /* no git */ }
  // P11 r5 R5-A5 — this used to `return` (a silent PASS) on CI's shallow clone. A check that cannot run SKIPS with its
  // reason, so tools/test/guard.js judges it against tests/.skip-allowlist.json (CI now checks out full history).
  if (!full) { t.skip('shallow clone or no git: the dossier ancestry cannot be checked here'); return; }
  assert.doesNotThrow(() => execFileSync('git', ['merge-base', '--is-ancestor', manifest.target_sha, 'HEAD'], { cwd: ROOT, stdio: 'ignore' }),
    `target SHA ${manifest.target_sha} is not an ancestor of HEAD`);
});

// Mutation control: the freshness check must actually catch stale evidence and newly delivered lot evidence.
test('the freshness check fails when cited evidence changes or awaited evidence lands', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-dossiers-'));
  try {
    const manifest = JSON.parse(read(gd.MANIFEST));
    const files = new Set([gd.SOURCE, gd.GATES_MD, gd.MANIFEST, ...Object.keys(manifest.evidence)]);
    for (const lang of ['en', 'fr']) for (const n of fs.readdirSync(path.join(ROOT, gd.OUT_DIR, lang))) files.add(`${gd.OUT_DIR}/${lang}/${n}`);
    files.add(`${gd.OUT_DIR}/INDEX.md`);
    for (const rel of files) {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), path.join(tmp, rel));
    }
    assert.deepStrictEqual(gd.checkStale(tmp), [], 'the copy must start fresh');
    fs.appendFileSync(path.join(tmp, 'docs/ops/AUTHZ-MATRIX.md'), '\nchanged after generation\n');
    assert.ok(gd.checkStale(tmp).some((r) => r.includes('docs/ops/AUTHZ-MATRIX.md')), 'a changed evidence file must be reported');
    fs.copyFileSync(path.join(ROOT, 'docs/ops/AUTHZ-MATRIX.md'), path.join(tmp, 'docs/ops/AUTHZ-MATRIX.md'));
    const landed = Object.entries(manifest.awaited).find(([, list]) => !list.length);
    if (landed) {
      const glob = landed[0];
      fs.writeFileSync(path.join(tmp, glob.replace('*', 'delivered')), '# delivered by a parallel lot\n');
      assert.ok(gd.checkStale(tmp).some((r) => r.includes('awaited evidence changed')), 'newly delivered lot evidence must be reported');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
