'use strict';
// B-05 — `npm run test:e2e`: the browser journeys (tests/e2e/*.spec.js) + the browser unit tests that need
// Chromium (tests/*-browser.test.js), on PostgreSQL, Chromium only, every non-localhost request blocked.
//
//   node tools/test/run-e2e.js [--runs=N] [--negative-control]
//     --runs=N             run the journeys N times in a row (flake detection; CI uses 2)
//     --negative-control   prove the job CAN go red: run T1 with a deliberately broken selector and exit 0
//                          only if it FAILS
//
// Fails when: a test fails or is skipped, a journey wrote no artefact, an artefact is not 'passed', or any
// artefact counts an unexpected external request. Writes <artefacts>/summary.json.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const artDir = process.env.E2E_ARTIFACT_DIR || path.join(root, 'e2e-artifacts');
const arg = (k) => { const a = process.argv.find((x) => x.startsWith('--' + k)); return a ? (a.split('=')[1] || true) : null; };
const specs = fs.readdirSync(path.join(root, 'tests', 'e2e')).filter((f) => f.endsWith('.spec.js')).sort().map((f) => path.join('tests', 'e2e', f));
const browserUnits = fs.readdirSync(path.join(root, 'tests')).filter((f) => /-browser\.test\.js$/.test(f)).sort().map((f) => path.join('tests', f));

function run(files, extraEnv, preload) {
  const env = Object.assign({}, process.env, { E2E_ARTIFACT_DIR: artDir }, extraEnv || {});
  if (preload) {
    const pre = ['--require ' + JSON.stringify(path.join(root, 'tests', '_default-env.js')),
      '--import ' + JSON.stringify(require('url').pathToFileURL(path.join(root, 'tests', '_pg-boot.mjs')).href)].join(' ');
    env.NODE_OPTIONS = ((env.NODE_OPTIONS || '') + ' ' + pre).trim();
  }
  const r = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-concurrency=1', '--test-reporter=tap', ...files], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out.split('\n').filter((l) => /^(not )?ok |^# (tests|pass|fail|skipped|cancelled)|error:|Error|assert/.test(l)).join('\n') + '\n');
  const n = (k) => { const m = new RegExp('^# ' + k + ' (\\d+)', 'm').exec(out); return m ? Number(m[1]) : NaN; };
  return { status: r.status, tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), cancelled: n('cancelled') };
}

if (arg('negative-control')) {
  const r = run([path.join('tests', 'e2e', 't1-site-action.spec.js')], { E2E_NEGATIVE_CONTROL: '1', E2E_ARTIFACT_DIR: path.join(artDir, 'negative-control') });
  if (r.status !== 0 && r.fail >= 1) { console.log('[e2e] negative control OK — a broken selector turns the journey red'); process.exit(0); }
  console.error('[e2e] negative control FAILED — a broken selector did not fail the journey'); process.exit(1);
}

fs.rmSync(artDir, { recursive: true, force: true });
fs.mkdirSync(artDir, { recursive: true });
const runs = Math.max(1, Number(arg('runs')) || 1);
const problems = [];
const summary = { started_at: new Date().toISOString(), runs: [], browser_units: null, journeys: {} };
for (let i = 1; i <= runs; i++) {
  console.log(`[e2e] journeys run ${i}/${runs} (${specs.length} specs)`);
  const r = run(specs);
  summary.runs.push(r);
  if (r.status !== 0 || r.fail || r.cancelled || r.skipped) problems.push(`run ${i}: ${JSON.stringify(r)}`);
  if (r.tests !== specs.length) problems.push(`run ${i}: ${r.tests} journeys reported, ${specs.length} spec files`);
  for (const f of fs.readdirSync(artDir).filter((x) => x.endsWith('.json') && x !== 'summary.json' && !/^run\d+-/.test(x))) {
    const a = JSON.parse(fs.readFileSync(path.join(artDir, f), 'utf8'));
    (summary.journeys[a.journey] = summary.journeys[a.journey] || []).push({ run: i, status: a.status, unexpected_external: a.external.unexpected_count, allowlisted_external: a.external.allowlisted_count, pages: a.pages, page_errors: a.page_errors.length });
    if (a.status !== 'passed') problems.push(`run ${i}: ${a.journey} status ${a.status}`);
    if (a.external.unexpected_count) problems.push(`run ${i}: ${a.journey} made ${a.external.unexpected_count} external request(s): ${a.external.unexpected.slice(0, 5).join(', ')}`);
    fs.renameSync(path.join(artDir, f), path.join(artDir, `run${i}-${f}`));
  }
}
const seen = Object.keys(summary.journeys).length;
if (seen !== specs.length) problems.push(`${seen} journey artefacts for ${specs.length} specs`);
if (browserUnits.length) {
  console.log(`[e2e] browser unit tests (${browserUnits.length})`);
  const r = run(browserUnits, null, true);
  summary.browser_units = Object.assign({ files: browserUnits }, r);
  if (r.status !== 0 || r.fail || r.skipped || r.cancelled) problems.push('browser unit tests: ' + JSON.stringify(r));
}
summary.finished_at = new Date().toISOString();
summary.problems = problems;
fs.writeFileSync(path.join(artDir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
for (const p of problems) console.error('[e2e] FAIL: ' + p);
console.log(`[e2e] ${problems.length ? 'RED' : 'GREEN'} — ${specs.length} journeys × ${runs} run(s); artefacts in ${path.relative(root, artDir) || artDir}`);
process.exit(problems.length ? 1 : 0);
