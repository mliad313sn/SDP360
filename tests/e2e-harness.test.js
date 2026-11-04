'use strict';
// B-05 — guards around the browser journeys that need no browser: the external-request classifier, the
// wiring of the CI job, the CI-only Playwright dependency, and that every journey goes through the harness
// (whose last assertion is "0 unexpected external requests").
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const { classify, ALLOWLIST } = require('./e2e/fixtures/browser');

test('classifier: localhost is local, Google Fonts is the ONLY allow-listed origin, everything else is unexpected', () => {
  for (const u of ['http://127.0.0.1:4000/x.js', 'http://localhost:3456/', 'data:image/png;base64,AA', 'blob:http://127.0.0.1/abc']) assert.strictEqual(classify(u), 'local', u);
  assert.deepStrictEqual(ALLOWLIST, ['fonts.googleapis.com', 'fonts.gstatic.com']);
  assert.strictEqual(classify('https://fonts.googleapis.com/css2?family=X'), 'allowlisted');
  for (const u of ['https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js', 'https://unpkg.com/react@18', 'https://cdn.jsdelivr.net/npm/x', 'https://fonts.googleapis.com.evil.example/', 'https://127.0.0.1.example.com/'])
    assert.strictEqual(classify(u), 'unexpected', u);
});

test('every journey spec runs through the harness (blocked-request assertion + artefact)', () => {
  const specs = fs.readdirSync(path.join(ROOT, 'tests', 'e2e')).filter((f) => f.endsWith('.spec.js'));
  for (const id of ['t1-', 't2-', 't3-', 't4-', 't7-', 't8-', 'deny-']) assert.ok(specs.some((f) => f.startsWith(id)), 'journey ' + id + ' exists');
  for (const f of specs) assert.match(read('tests/e2e/' + f), /runJourney\(/, f);
  assert.match(read('tests/e2e/fixtures/harness.js'), /external\.unexpected, \[\]/);
});

test('Playwright is a pinned devDependency only — never a runtime dependency, never in the installer payload', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.devDependencies.playwright || '', /^\d+\.\d+\.\d+$/, 'exact version');
  assert.ok(!pkg.dependencies.playwright && !pkg.dependencies['@playwright/test']);
  assert.strictEqual(pkg.scripts['test:e2e'], 'node tools/test/run-e2e.js');
  assert.match(read('tools/installer-v2/build.ps1'), /ci --omit=dev/, 'the installer installs production dependencies only');
});

test('CI: e2e job on PostgreSQL 17 with no password, journeys twice, negative control, artefact; Chromium before npm test', () => {
  const ci = read('.github/workflows/ci.yml');
  const e2e = ci.slice(ci.indexOf('\n  e2e:'));
  assert.ok(ci.indexOf('\n  e2e:') > 0, 'e2e job');
  assert.match(e2e, /image: postgres:17/);
  assert.match(e2e, /POSTGRES_HOST_AUTH_METHOD: trust/);
  assert.doesNotMatch(e2e, /POSTGRES_PASSWORD|DASH_PASS/, 'no credential literal in the e2e job');
  assert.match(e2e, /npx playwright install --with-deps chromium/);
  assert.match(e2e, /npm run test:e2e -- --runs=2/);
  assert.match(e2e, /run-e2e\.js --negative-control/);
  assert.match(e2e, /name: e2e-journeys/);
  const testJob = ci.slice(0, ci.indexOf('\n  e2e:'));
  assert.ok(testJob.indexOf('playwright install') > 0 && testJob.indexOf('playwright install') < testJob.indexOf('run: npm test'), 'test job: Chromium before npm test');
  const rel = read('.github/workflows/release.yml');
  assert.ok(rel.indexOf('playwright install') > 0 && rel.indexOf('playwright install') < rel.indexOf('run: npm test'), 'release: Chromium before npm test');
});

test('field app: a missing IndexedDB key reads as undefined, and photos never decode through a blob: URL (CSP img-src)', () => {
  const app = read('public/field/app.js');
  assert.doesNotMatch(app, /out\.result !== undefined \? out\.result : out/, 'the IDBRequest itself is never returned for a miss');
  assert.match(app, /isReq\(out\) \? out\.result : out/);
  assert.doesNotMatch(app, /URL\.createObjectURL/, 'CSP img-src is self + data: only');
  assert.match(app, /readAsDataURL\(file\)/);
  assert.doesNotMatch(read('public/field/sw.js'), /CACHE_VERSION = 'field-v[1-4]'/, 'service worker cache bumped');
});
