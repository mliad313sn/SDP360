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

// ── Suite census (consolidation P0-C, 2026-10-28) ─────────────────────────────
// tests/.suite-manifest.json records, per test file, the number of tests it reported in a
// reviewed run. A run FAILS when a listed file is gone or reports fewer tests than recorded
// (silent drop, accidental deletion, a loop that stopped generating cases) or when a test file
// is not in the manifest (a new file must be reviewed in: `npm test -- --update-manifest`).
// Skipped tests count as reported; their reasons are listed separately (environment ≠ defect).
function census(events) {
  const out = {};
  for (const e of events) {
    if (!e.file || e.kind === 'suite') continue;
    const k = path.basename(e.file);
    const c = out[k] || (out[k] = { tests: 0, skipped: 0, reasons: {} });
    c.tests++;
    if (e.skip) { c.skipped++; c.reasons[e.skip] = (c.reasons[e.skip] || 0) + 1; }
  }
  return out;
}

function checkManifest({ manifest, census: cs, expectedFiles }) {
  const problems = [];
  const files = (manifest && manifest.files) || {};
  const onDisk = new Set(expectedFiles.map((f) => path.basename(f)));
  for (const [f, want] of Object.entries(files)) {
    if (!onDisk.has(f)) { problems.push(`${f} is in the suite manifest but no longer exists (deleted test file?)`); continue; }
    const got = cs[f] ? cs[f].tests : 0;
    if (got < want) problems.push(`${f} reported ${got} tests, manifest expects at least ${want}`);
  }
  for (const f of onDisk) if (!(f in files)) problems.push(`${f} is not in tests/.suite-manifest.json — review it in with \`npm test -- --update-manifest\``);
  return problems;
}

function skipReport(cs) {
  const byReason = {};
  for (const [f, c] of Object.entries(cs)) for (const [r, n] of Object.entries(c.reasons)) {
    const b = byReason[r] || (byReason[r] = { tests: 0, files: [] }); b.tests += n; b.files.push(f);
  }
  return Object.entries(byReason).sort((a, b) => b[1].tests - a[1].tests);
}

function buildManifest(cs) {
  const files = {};
  for (const k of Object.keys(cs).sort()) files[k] = cs[k].tests;
  return { note: 'Reviewed per-file test census. Regenerate only after a reviewed green run: npm test -- --update-manifest', total: Object.values(files).reduce((a, b) => a + b, 0), files };
}

// tests/.skip-allowlist.json — every reason a test may be skipped for, with the most tests it may cover and
// an owner. A skip under an unlisted reason, or more skips than allowed, fails the run: no hidden skip.
function checkSkips(cs, allow) {
  const problems = [];
  const reasons = (allow && allow.reasons) || {};
  for (const [reason, b] of skipReport(cs)) {
    const a = reasons[reason];
    if (!a) problems.push(`${b.tests} test(s) skipped for an unlisted reason "${reason}" (${b.files.join(', ')}) — add it to tests/.skip-allowlist.json with an owner, or fix the test`);
    else if (b.tests > a.max) problems.push(`${b.tests} test(s) skipped for "${reason}", allow-list permits ${a.max}`);
  }
  return problems;
}

module.exports = { parseEvents, summarize, check, census, checkManifest, skipReport, buildManifest, checkSkips };
