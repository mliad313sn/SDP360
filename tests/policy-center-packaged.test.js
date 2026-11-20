'use strict';
// P11 round 4 N-10 (operations seat): in a packaged install the Policy Center lost its catalogue (docs/ was excluded)
// and silently dropped to 0 four-eyes rules. (1) The update package now carries the runtime data files under docs/.
// (2) If the catalogue still cannot be read, the center FAILS CLOSED: every report_config rule needs a second person.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PC = require('../services/policyCatalogue');

test('a packaged tree without docs/: every report_config rule is four-eyes (never 0), the error is reported', () => {
  const gone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-nodocs-')), 'docs', 'ops');   // does not exist
  const b = PC.build({ fresh: true, catalogueFile: path.join(gone, 'policy-catalogue.json'), registerFile: path.join(gone, 'FLAG-REGISTER.json') });
  try {
    assert.strictEqual(b.catalogue_missing, true);
    assert.match(b.catalogue_error, /not readable/);
    const rc = b.entries.filter((e) => e.source === 'report_config' && !e.secret);
    assert.ok(rc.length > 100);
    assert.ok(rc.every((e) => e.four_eyes === true && e.four_eyes_rule === 'second_person_always'), 'every editable report_config rule is four-eyes');
    for (const k of ['authz_enforce_caps', 'dashkey_scope_mode', 'emergency_access_enabled', 'csp_strict_pages', 'ui_week_labels']) {
      const e = b.by.get(k);
      assert.strictEqual(PC.needsSecondPerson(e, String(e.default), e.allowed ? String(e.allowed.find((a) => String(a) !== String(e.default))) : 'x'), true, k);
    }
  } finally { PC.build({ fresh: true }); }
});

test('a corrupt catalogue file also fails closed', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-bad-'));
  fs.writeFileSync(path.join(d, 'policy-catalogue.json'), '{ not json');
  const b = PC.build({ fresh: true, catalogueFile: path.join(d, 'policy-catalogue.json') });
  try { assert.strictEqual(b.catalogue_missing, true); assert.ok(b.entries.filter((e) => e.source === 'report_config' && e.four_eyes).length > 100); }
  finally { PC.build({ fresh: true }); }
});

test('the repository catalogue loads: 79 four-eyes report_config rules, not in fail-closed mode', () => {
  const b = PC.build({ fresh: true });
  assert.strictEqual(b.catalogue_missing, false);
  assert.strictEqual(b.entries.filter((e) => e.source === 'report_config' && e.four_eyes).length, 79);
});

test('the update package carries the runtime data files read under docs/', (t) => {
  const M = require('../tools/deploy/make-update-package');
  for (const f of ['docs/ops/policy-catalogue.json', 'docs/ops/FLAG-REGISTER.json']) {
    assert.ok(M.RUNTIME_DOCS.has(f), f + ' is a runtime file');
    assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f + ' exists');
  }
  // every docs/ path read by services/ or routes/ through path.join(..., 'docs', ...) is in RUNTIME_DOCS
  const root = path.join(__dirname, '..');
  const reads = new Set();
  for (const dir of ['services', 'routes']) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (!f.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(root, dir, f), 'utf8');
      for (const m of src.matchAll(/path\.join\([^)]*?'docs'((?:\s*,\s*'[^']+')+)\s*\)/g)) reads.add('docs/' + [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).join('/'));
    }
  }
  assert.ok(reads.size >= 3, 'scan finds the runtime reads: ' + [...reads].join(', '));
  for (const r of reads) assert.ok(M.RUNTIME_DOCS.has(r), r + ' is read at runtime but not shipped');
  let files = null; try { files = M.listRuntimeFiles(); } catch (_) { files = null; }
  if (!files) return t.skip('no git in this checkout');
  for (const f of M.RUNTIME_DOCS) assert.ok(files.includes(f), f + ' in listRuntimeFiles()');
});
