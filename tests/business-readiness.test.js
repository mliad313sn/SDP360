'use strict';
// Business-readiness pack (docs/business-readiness/) — the pilot plan, UAT scripts, profile guides, runbook,
// human-decision register and go-live checklist must only cite switches, lots and gates that exist, must never
// carry a filled decision / name / date / signature cell, and the two generated files must be fresh.
//   node tools/release/business-readiness-check.js --write   (regenerate the register + checklist)
//   node tools/release/business-readiness-check.js --check
const test = require('node:test');
const assert = require('node:assert');
const br = require('../tools/release/business-readiness-check.js');

const known = br.loadKnown(br.ROOT);
const LABEL = br.AI_LABEL;

test('the six documents exist, carry the AI label and pass every reference check', () => {
  assert.strictEqual(br.DOCS.length, 6);
  const problems = br.check(br.ROOT);
  assert.deepStrictEqual(problems, [], problems.join('\n'));
});

test('the register and the checklist are what the sources render to (no hand edit, no stale source)', () => {
  assert.deepStrictEqual(br.staleGenerated(br.ROOT), []);
});

test('a stale switch key, an unknown lot and an unknown gate are refused', () => {
  const p = br.scanText(`${LABEL}\nTurn on \`no_such_switch_enabled\` in L99 after G42.`, known, 'x.md');
  assert.ok(p.some((s) => s.includes('no_such_switch_enabled')), p.join('\n'));
  assert.ok(p.some((s) => s.includes('L99')), p.join('\n'));
  assert.ok(p.some((s) => s.includes('G42')), p.join('\n'));
});

test('real keys, lots, keep groups and gates pass', () => {
  const p = br.scanText(`${LABEL}\n\`commitments_enabled\` (L01, K:outbound) after G07 — \`calendar.skip_weekends\`.`, known, 'x.md');
  assert.deepStrictEqual(p, []);
});

test('an --apply command without --lots or --reason, or with a refused keep group, is refused', () => {
  const a = br.scanText(`${LABEL}\nnode tools/ops/activate-switches.js --apply --db-url=env`, known, 'x.md');
  assert.ok(a.some((s) => s.includes('--lots')) && a.some((s) => s.includes('--reason')), a.join('\n'));
  const b = br.scanText(`${LABEL}\nnode tools/ops/activate-switches.js --plan --lots=K:source_system_write`, known, 'x.md');
  assert.ok(b.some((s) => s.includes('K:source_system_write')), b.join('\n'));
});

test('a filled decision / name / date / signature cell is refused', () => {
  const md = `${LABEL}\n\n| Gate | Décision | Nom | Date | Signature |\n|---|---|---|---|---|\n| G11 | GO | Jane | 2026-11-21 | x |\n`;
  const p = br.scanText(md, known, 'x.md');
  assert.ok(p.some((s) => s.includes('filled')), p.join('\n'));
  const empty = br.scanText(`${LABEL}\n\n| Gate | Décision | Nom | Date | Signature |\n|---|---|---|---|---|\n| G11 | | | | |\n`, known, 'x.md');
  assert.deepStrictEqual(empty, []);
});

test('a missing repository path and a missing AI label are refused', () => {
  const p = br.scanText('See `docs/ops/NO-SUCH-FILE.md`.', known, 'x.md');
  assert.ok(p.some((s) => s.includes('NO-SUCH-FILE')), p.join('\n'));
  assert.ok(p.some((s) => s.includes('label')), p.join('\n'));
});

test('the register counts every decision once, under a known decider, with no decision recorded', () => {
  const src = require('../tools/release/business-readiness.source.js');
  const ids = src.items.map((i) => i.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate decision id');
  for (const it of src.items) assert.ok(src.DECIDEURS.includes(it.decideur), `${it.id}: unknown decider ${it.decideur}`);
  const counts = br.countByDecider(src);
  assert.strictEqual(Object.values(counts).reduce((a, b) => a + b, 0), src.items.length);
  // every RELEASE-GATES row has its own decision line
  for (let n = 1; n <= 21; n++) assert.ok(ids.includes(`HD-G${String(n).padStart(2, '0')}`), `no line for gate ${n}`);
});

// P11 r5 N-15 — a real apply of a lot carrying a four-eyes switch must name the second operator in the pack.
test('an --apply of a four-eyes lot without --second-operator is refused; dry run and L01 are not', () => {
  assert.ok(known.fourEyesLots.has('L12') && known.fourEyesLots.has('L03') && !known.fourEyesLots.has('L01'));
  const cmd = 'node tools/ops/activate-switches.js --apply --lots=L12 --db-url=env --reason="vague 3 — réf. comité X" --operator=<op>';
  const bad = br.scanText(`${LABEL}\n${cmd}`, known, 'x.md');
  assert.ok(bad.some((s) => /four-eyes switch\) without --second-operator/.test(s)), bad.join('\n'));
  assert.deepStrictEqual(br.scanText(`${LABEL}\n${cmd} --second-operator=<second>`, known, 'x.md'), []);
  assert.deepStrictEqual(br.scanText(`${LABEL}\n${cmd.replace('--apply', '--apply --dry-run')}`, known, 'x.md'), []);
  assert.deepStrictEqual(br.scanText(`${LABEL}\n${cmd.replace('L12', 'L01')}`, known, 'x.md'), []);
});
