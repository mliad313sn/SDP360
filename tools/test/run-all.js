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
const { parseEvents, check } = require('./guard');

const root = path.resolve(__dirname, '..', '..');
const testsDir = path.join(root, 'tests');
const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.js')).sort()
  .map((f) => path.join(testsDir, f));
const evFile = path.join(os.tmpdir(), 'sdp-test-events-' + process.pid + '.jsonl');

// Ported from SDP360 G8.6 (2026-10-28, F-M01-004). Also preloads tests/_default-env.js (WP-M01-001).
const preload = ['--require ' + JSON.stringify(path.join(__dirname, 'blocking-stdio.js')),
  '--require ' + JSON.stringify(path.join(testsDir, '_default-env.js'))].join(' ');
const env = Object.assign({}, process.env, {
  NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' ' + preload).trim(),
});
const r = spawnSync(process.execPath, [
  '--test', '--test-force-exit',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=' + path.join(__dirname, 'file-reporter.mjs'), '--test-reporter-destination=' + evFile,
  ...files,
], { cwd: root, stdio: 'inherit', env });

let events = [];
try { events = parseEvents(fs.readFileSync(evFile, 'utf8')); } catch {}
try { fs.unlinkSync(evFile); } catch {}
let minTests = NaN;
try { minTests = parseInt(fs.readFileSync(path.join(testsDir, '.min-test-count'), 'utf8'), 10); } catch {}

const res = check({ expectedFiles: files, events, minTests });
console.log('\n[test-guard] files ' + res.reportedFiles + '/' + files.length + ' · tests ' + res.tests + ' · failed ' + res.failed + ' · floor ' + minTests);
for (const p of res.problems) console.error('[test-guard] FAIL: ' + p);
process.exit(r.status !== 0 ? (r.status || 1) : (res.ok ? 0 : 1));
