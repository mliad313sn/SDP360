'use strict';
// Pure logic of the test-runner guard (G8.6): from the JSON lines written by
// file-reporter.mjs, check that every test file reported and that the total
// test count did not fall under the recorded floor.
const path = require('path');

function parseEvents(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* ignore a torn line */ }
  }
  return out;
}

function summarize(events) {
  const files = new Set();
  let tests = 0, failed = 0;
  for (const e of events) {
    if (e.file) files.add(path.resolve(e.file));
    if (e.kind === 'suite') continue;
    tests++;
    if (!e.ok) failed++;
  }
  return { files, tests, failed };
}

function check({ expectedFiles, events, minTests }) {
  const s = summarize(events);
  const missing = expectedFiles.map((f) => path.resolve(f)).filter((f) => !s.files.has(f));
  const problems = [];
  if (missing.length) problems.push(missing.length + ' test file(s) produced no result: ' + missing.map((f) => path.basename(f)).join(', '));
  if (!Number.isFinite(minTests)) problems.push('tests/.min-test-count is missing or unreadable');
  else if (s.tests < minTests) problems.push('only ' + s.tests + ' tests reported, floor is ' + minTests + ' (tests/.min-test-count)');
  return { ok: problems.length === 0, problems, missing, tests: s.tests, failed: s.failed, reportedFiles: s.files.size };
}

module.exports = { parseEvents, summarize, check };
