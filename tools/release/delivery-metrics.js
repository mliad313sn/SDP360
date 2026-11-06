#!/usr/bin/env node
'use strict';
// E-Q08 (audit Q-08, agent part) — delivery-quality report from git and the evidence ledgers.
//
//   node tools/release/delivery-metrics.js [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--repo=.]
//        [--guard-log=file.log ...] [--e2e-summary=e2e-artifacts/summary.json] [--deploy-log=deploys.json]
//        [--out=docs/agent-execution/DELIVERY-QUALITY.md]
//
// From git (commit date window [--from, --to]):
//   goals delivered      = distinct goal ids named by merge commits ("merge goal/<id>" or ids in the subject)
//   reverted commits     = commits whose subject starts with "Revert"
//   defect-fix lead time = for each "fix" commit that names a goal id: fix date − the first commit (whole history
//                          before it) that named the same id; median / p90 in hours
// From the ledgers:      goal statuses in docs/agent-execution/GOAL_TRACKER.csv (implementation_status, deployed)
// From test output:      skipped tests per run — the "[test-guard] … skipped N" line of each --guard-log
// From e2e:              journeys covered — summary.json when given, else the journeys DEFINED (tests/e2e/*.spec.js)
// Release failure rate, production rollbacks and escaped bugs are UNKNOWN — needs deployment records, unless a
// --deploy-log JSON ([{at, outcome:'ok'|'failed'|'rolled_back', escaped_bugs?}]) is supplied. Git never tells
// whether something reached production, so nothing about production is inferred from it.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UNKNOWN_DEPLOY = 'UNKNOWN — needs deployment records';
// Goal ids used in this repository: G00, A-17b, C-27, D-07, SEC-01, E-A03, E-Q01, B-05, EX-03, PO-08 …
const GOAL_ID = /\b([A-Z]{1,3}-[A-Z]{0,2}\d{1,3}[a-z]?|G\d{2}[a-z]?)\b/g;
const FIX = /^(fix\b|fix\(|fix:|hotfix)/i;

function goalIds(text) { return [...new Set(String(text).match(GOAL_ID) || [])]; }

/** Read commits from git: [{sha, date (ISO), parents:[], subject}], oldest first. */
function readCommits(repo, { until = null } = {}) {
  const args = ['log', '--reverse', '--format=%H%x1f%cI%x1f%P%x1f%s'];
  if (until) args.push(`--until=${until}T23:59:59Z`);
  const out = execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\n').filter(Boolean).map((l) => { const [sha, date, parents, subject] = l.split('\x1f'); return { sha, date, parents: parents ? parents.split(' ') : [], subject: subject || '' }; });
}

const inWindow = (c, from, to) => (!from || c.date.slice(0, 10) >= from) && (!to || c.date.slice(0, 10) <= to);
function percentile(values, p) { const v = values.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; return v[Math.min(v.length, Math.max(1, Math.ceil(p / 100 * v.length))) - 1]; }

/** Pure: commits (whole history, oldest first) → git-derived metrics for [from, to]. */
function gitMetrics(commits, { from = null, to = null } = {}) {
  const firstSeen = new Map();   // goal id → first commit date naming it
  const fixes = []; const goals = new Set(); const reverts = []; let merges = 0, inRange = 0;
  for (const c of commits) {
    const ids = goalIds(c.subject);
    const win = inWindow(c, from, to);
    if (win) inRange++;
    if (win && c.parents.length > 1) {
      merges++;
      const m = /merge (?:branch ')?goal\/([\w.-]+)/i.exec(c.subject);
      // a branch name (goal/a-17b) only counts when it IS a goal id; ids are compared upper-cased (A-17b = A-17B)
      const cand = m ? m[1].toUpperCase().replace(/(\d)([A-Z])$/, (x, d, l) => d + l.toLowerCase()) : '';
      const branch = cand && goalIds(cand).length === 1 && goalIds(cand)[0] === cand ? [cand] : [];
      for (const id of ids.length ? ids : branch) goals.add(id.toUpperCase());
    }
    if (win && /^revert\b/i.test(c.subject)) reverts.push({ sha: c.sha.slice(0, 7), subject: c.subject });
    if (win && FIX.test(c.subject)) for (const id of ids) if (firstSeen.has(id)) fixes.push({ id, sha: c.sha.slice(0, 7), hours: Math.round((Date.parse(c.date) - Date.parse(firstSeen.get(id))) / 36e5 * 10) / 10 });
    for (const id of ids) if (!firstSeen.has(id)) firstSeen.set(id, c.date);
  }
  const h = fixes.map((f) => f.hours);
  return { commits: inRange, merges, goals_delivered: [...goals].sort(), reverted: reverts,
    fix_lead_time_h: { n: fixes.length, median: percentile(h, 50), p90: percentile(h, 90), items: fixes } };
}

/** Pure: GOAL_TRACKER.csv text → counts per implementation_status and deployed value. */
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows; return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
}
function ledgerMetrics(csvText) {
  const rows = parseCsv(csvText || '');
  const count = (k) => rows.reduce((a, r) => { const v = r[k] || '(empty)'; a[v] = (a[v] || 0) + 1; return a; }, {});
  return { goals: rows.length, implementation_status: count('implementation_status'), deployed: count('deployed'), business_accepted: count('business_accepted') };
}

/** Pure: guard log texts → skipped tests per run (null when no guard line is found). */
function skippedPerRun(texts) {
  return texts.map((t, i) => { const m = /\[test-guard\][^\n]*?tests (\d+)[^\n]*?skipped (\d+)/.exec(String(t)); return { run: i + 1, tests: m ? Number(m[1]) : null, skipped: m ? Number(m[2]) : null }; });
}

/** Pure: deployment records → release metrics, or UNKNOWN for each when none are given. */
function deployMetrics(records) {
  if (!Array.isArray(records) || !records.length) return { releases: null, release_failure_rate_pct: UNKNOWN_DEPLOY, production_rollbacks: UNKNOWN_DEPLOY, escaped_bugs: UNKNOWN_DEPLOY };
  const failed = records.filter((r) => r.outcome === 'failed' || r.outcome === 'rolled_back').length;
  const bugs = records.every((r) => Number.isFinite(r.escaped_bugs)) ? records.reduce((a, r) => a + r.escaped_bugs, 0) : UNKNOWN_DEPLOY;
  return { releases: records.length, release_failure_rate_pct: Math.round(failed / records.length * 1000) / 10, production_rollbacks: records.filter((r) => r.outcome === 'rolled_back').length, escaped_bugs: bugs };
}

function e2eMetrics(repo, summaryPath) {
  if (summaryPath && fs.existsSync(summaryPath)) {
    const s = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    return { source: 'summary', journeys: Object.keys(s.journeys || {}).length, runs: (s.runs || []).length, green: !(s.problems || []).length };
  }
  const dir = path.join(repo, 'tests', 'e2e');
  return { source: 'defined', journeys: fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.spec.js')).length : null, runs: null, green: null };
}

function renderMarkdown(m) {
  const f = (v) => (v == null ? '—' : String(v));
  const L = ['# Delivery-quality report (E-Q08)', '',
    '> Generated by `tools/release/delivery-metrics.js` from git and the evidence ledgers. Production facts (release',
    '> failures, rollbacks, escaped bugs) are **UNKNOWN unless a deployment log is supplied** — git never says what',
    '> reached production. Goal ids are matched in commit subjects; a commit that does not name its goal is not counted.', '',
    `- Window: ${f(m.window.from)} → ${f(m.window.to)} · generated ${m.generated_at} · HEAD ${f(m.head)}`, '',
    '| Measure | Value | Source |', '|---|---|---|',
    `| Commits in the window | ${m.git.commits} | git log |`,
    `| Merge commits | ${m.git.merges} | git log (2+ parents) |`,
    `| Goals delivered (named by a merge) | ${m.git.goals_delivered.length} | merge subjects |`,
    `| Reverted commits | ${m.git.reverted.length} | subjects starting "Revert" |`,
    `| Defect-fix lead time (median / p90, h) | ${f(m.git.fix_lead_time_h.median)} / ${f(m.git.fix_lead_time_h.p90)} (n=${m.git.fix_lead_time_h.n}) | "fix" commits naming a goal id − first commit naming it |`,
    `| Skipped tests per run | ${m.skipped.length ? m.skipped.map((s) => `run ${s.run}: ${f(s.skipped)}/${f(s.tests)}`).join('; ') : 'UNKNOWN — no guard log supplied'} | \`[test-guard]\` line |`,
    `| E2E journeys | ${f(m.e2e.journeys)} ${m.e2e.source === 'summary' ? `covered (${m.e2e.runs} run(s), ${m.e2e.green ? 'green' : 'red'})` : 'defined (no run summary supplied)'} | ${m.e2e.source === 'summary' ? 'e2e summary.json' : 'tests/e2e/*.spec.js'} |`,
    `| Goal ledger rows | ${m.ledger.goals} — implementation ${JSON.stringify(m.ledger.implementation_status)}; deployed ${JSON.stringify(m.ledger.deployed)} | GOAL_TRACKER.csv |`,
    `| Release failure rate | ${f(m.deploy.release_failure_rate_pct)} | deployment log |`,
    `| Production rollbacks | ${f(m.deploy.production_rollbacks)} | deployment log |`,
    `| Escaped bugs | ${f(m.deploy.escaped_bugs)} | deployment log |`, ''];
  if (m.git.goals_delivered.length) L.push(`Goals named by merges: ${m.git.goals_delivered.join(', ')}`, '');
  if (m.git.reverted.length) L.push('Reverted:', ...m.git.reverted.map((r) => `- ${r.sha} ${r.subject}`), '');
  return L.join('\n') + '\n';
}

function main(argv = process.argv.slice(2)) {
  const all = (k) => argv.filter((x) => x.startsWith('--' + k + '=')).map((x) => x.slice(k.length + 3));
  const one = (k, d = null) => all(k)[0] || d;
  const repo = path.resolve(one('repo', path.join(__dirname, '..', '..')));
  const from = one('from'); const to = one('to');
  const commits = readCommits(repo, { until: to });
  let head = null; try { head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); } catch (_) { /* empty repo */ }
  const csv = path.join(repo, 'docs', 'agent-execution', 'GOAL_TRACKER.csv');
  const deployLog = one('deploy-log');
  const m = {
    window: { from, to }, generated_at: new Date().toISOString(), head,
    git: gitMetrics(commits, { from, to }),
    ledger: ledgerMetrics(fs.existsSync(csv) ? fs.readFileSync(csv, 'utf8') : ''),
    skipped: skippedPerRun(all('guard-log').map((p) => fs.readFileSync(p, 'utf8'))),
    e2e: e2eMetrics(repo, one('e2e-summary')),
    deploy: deployMetrics(deployLog ? JSON.parse(fs.readFileSync(deployLog, 'utf8')) : null),
  };
  const md = renderMarkdown(m);
  if (one('out')) fs.writeFileSync(path.resolve(one('out')), md);
  process.stdout.write(md);
  return m;
}

module.exports = { goalIds, gitMetrics, ledgerMetrics, parseCsv, skippedPerRun, deployMetrics, renderMarkdown, readCommits, main, UNKNOWN_DEPLOY };
if (require.main === module) { try { main(); } catch (e) { console.error('[delivery-metrics] ' + e.message); process.exit(1); } }
