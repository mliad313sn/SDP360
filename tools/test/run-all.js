'use strict';
// `npm test` entry point (G8.6). Runs every tests/*.test.js through node:test
// with --test-force-exit (dozens of server-booting suites keep handles open and
// would never exit otherwise) AND a preload that makes each child's stdout
// blocking: without it, force-exit killed children before their piped report
// was flushed, so the tail of a file's report was silently lost while the run
// still said "fail 0". Afterwards it proves every file reported
// and that the test count is not under tests/.min-test-count.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseEvents, check, census, checkManifest, skipReport, buildManifest } = require('./guard');

const root = path.resolve(__dirname, '..', '..');
const testsDir = path.join(root, 'tests');
const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.js')).sort()
  .map((f) => path.join(testsDir, f));
const evFile = path.join(os.tmpdir(), 'sdp-test-events-' + process.pid + '.jsonl');

// + tests/_default-env.js: throwaway admin credentials so the suite runs without a .env
// (transplanted from the 1.11 line, WP-M01-001; never overrides a value already set).
const preload = ['--require ' + JSON.stringify(path.join(__dirname, 'blocking-stdio.js')),
  '--require ' + JSON.stringify(path.join(testsDir, '_default-env.js'))].join(' ');
const env = Object.assign({}, process.env, {
  NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' ' + preload).trim(),
});
const r = spawnSync(process.execPath, [
  '--test', '--test-force-exit',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=' + path.join(__dirname, 'file-reporter.mjs'), '--test-reporter-destination=' + evFile,
  ...process.argv.slice(2).filter((a) => a !== '--update-manifest'),   // extra node:test flags (CI coverage)
  ...files,
], { cwd: root, stdio: 'inherit', env });

let events = [];
try { events = parseEvents(fs.readFileSync(evFile, 'utf8')); } catch {}
try { fs.unlinkSync(evFile); } catch {}
const manifestPath = path.join(testsDir, '.suite-manifest.json');
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
const cs = census(events);
// The floor is the reviewed manifest total (replaces the old tests/.min-test-count = 1).
const minTests = manifest ? manifest.total : NaN;
const res = check({ expectedFiles: files, events, minTests });
const problems = res.problems.slice();
if (process.argv.includes('--update-manifest')) {
  if (r.status === 0 && res.missing.length === 0) {
    fs.writeFileSync(manifestPath, JSON.stringify(buildManifest(cs), null, 1) + '\n');
    console.log('[test-guard] manifest written: ' + manifestPath + ' — review the diff before committing');
    process.exit(0);
  }
  problems.push('--update-manifest refused: the run is not green or a file reported nothing');
} else {
  if (!manifest) problems.push('tests/.suite-manifest.json is missing or unreadable');
  else problems.push(...checkManifest({ manifest, census: cs, expectedFiles: files }));
}
const skipped = Object.values(cs).reduce((a, c) => a + c.skipped, 0);
console.log('\n[test-guard] files ' + res.reportedFiles + '/' + files.length + ' · tests ' + res.tests + ' · failed ' + res.failed + ' · skipped ' + skipped + ' · floor ' + minTests);
for (const [reason, b] of skipReport(cs)) console.log(`[test-guard] skip ${b.tests} × "${reason}" (${b.files.length} file(s))`);
for (const p of problems) console.error('[test-guard] FAIL: ' + p);
process.exit(r.status !== 0 ? (r.status || 1) : (problems.length ? 1 : 0));
