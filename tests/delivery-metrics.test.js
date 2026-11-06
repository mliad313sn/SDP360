'use strict';
// E-Q08 — the delivery-quality generator, on a FIXTURE git repository (dated commits, a merge, a revert,
// a fix naming its goal) plus fixture ledgers. Production facts stay UNKNOWN without a deployment log.
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync } = require('child_process');
const DM = require('../tools/release/delivery-metrics');

let repo;
function git(args, date) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'fx', GIT_AUTHOR_EMAIL: 'fx@example.test', GIT_COMMITTER_NAME: 'fx', GIT_COMMITTER_EMAIL: 'fx@example.test' };
  if (date) { env.GIT_AUTHOR_DATE = date; env.GIT_COMMITTER_DATE = date; }
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' });
}
function commit(msg, date, file = 'f.txt') { fs.appendFileSync(path.join(repo, file), msg + '\n'); git(['add', '-A']); git(['commit', '-qm', msg], date); }

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-fx-'));
  git(['init', '-q', '-b', 'main']);
  commit('Initial', '2026-10-01T08:00:00Z');
  git(['checkout', '-qb', 'goal/e-a03']);
  commit('E-A03: contract tests', '2026-10-02T08:00:00Z', 'a.txt');
  git(['checkout', '-q', 'main']);
  commit('Unrelated main work', '2026-10-02T09:00:00Z');
  git(['merge', '--no-ff', '-qm', 'Merge goal/e-a03 (E-A03 contract tests)', 'goal/e-a03'], '2026-10-03T08:00:00Z');
  commit('fix: E-A03 schema accepted a null id', '2026-10-04T20:00:00Z', 'a.txt');
  commit('Bad change', '2026-10-05T08:00:00Z');
  git(['revert', '--no-edit', 'HEAD'], '2026-10-05T09:00:00Z');
  commit('Outside the window G07', '2026-11-20T08:00:00Z');
  fs.mkdirSync(path.join(repo, 'docs', 'agent-execution'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'agent-execution', 'GOAL_TRACKER.csv'), 'id,title,implementation_status,deployed,business_accepted\nE-A03,"Contracts, errors",IMPLEMENTED,UNKNOWN,UNKNOWN\nE-Q08,Report,PARTIAL,UNKNOWN,UNKNOWN\n');
  fs.mkdirSync(path.join(repo, 'tests', 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'e2e', 't1.spec.js'), '');
});

test('goalIds: the id shapes this repository uses', () => {
  assert.deepEqual(DM.goalIds('Merge goal/c-27 (C-27, A-17b, SEC-01, G24, E-Q01, PO-08) bundle W1-QA'), ['C-27', 'A-17b', 'SEC-01', 'G24', 'E-Q01', 'PO-08'], 'a bundle name is not a goal id');
  assert.deepEqual(DM.goalIds('Release notes'), []);
});

test('git metrics on the fixture repo: window, merge, goals, revert, fix lead time', () => {
  const m = DM.gitMetrics(DM.readCommits(repo), { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(m.merges, 1);
  assert.deepEqual(m.goals_delivered, ['E-A03']);
  assert.equal(m.reverted.length, 1); assert.match(m.reverted[0].subject, /^Revert "Bad change"/);
  assert.equal(m.fix_lead_time_h.n, 1);
  assert.equal(m.fix_lead_time_h.median, 60, 'fix 2026-10-04 20:00 − first E-A03 commit 2026-10-02 08:00');
  assert.ok(!m.goals_delivered.includes('G07'), 'outside the window');
  assert.equal(m.commits, 7);
});

test('ledgers, skipped tests and deploy records; production facts UNKNOWN without a deployment log', () => {
  const l = DM.ledgerMetrics(fs.readFileSync(path.join(repo, 'docs', 'agent-execution', 'GOAL_TRACKER.csv'), 'utf8'));
  assert.equal(l.goals, 2); assert.deepEqual(l.implementation_status, { IMPLEMENTED: 1, PARTIAL: 1 });
  assert.deepEqual(DM.skippedPerRun(['…\n[test-guard] files 900/900 · tests 4100 · failed 0 · skipped 3 · floor 4000\n', 'no guard here']),
    [{ run: 1, tests: 4100, skipped: 3 }, { run: 2, tests: null, skipped: null }]);
  const none = DM.deployMetrics(null);
  for (const k of ['release_failure_rate_pct', 'production_rollbacks', 'escaped_bugs']) assert.equal(none[k], DM.UNKNOWN_DEPLOY);
  const some = DM.deployMetrics([{ at: '2026-10-10', outcome: 'ok', escaped_bugs: 0 }, { at: '2026-10-20', outcome: 'rolled_back', escaped_bugs: 2 }]);
  assert.deepEqual([some.releases, some.release_failure_rate_pct, some.production_rollbacks, some.escaped_bugs], [2, 50, 1, 2]);
  assert.equal(DM.deployMetrics([{ outcome: 'ok' }]).escaped_bugs, DM.UNKNOWN_DEPLOY, 'a record without a bug count does not invent 0');
});

test('main: writes the report; never infers a production event from git', () => {
  const out = path.join(repo, 'DQ.md');
  const m = DM.main([`--repo=${repo}`, '--from=2026-10-01', '--to=2026-10-31', `--out=${out}`]);
  const md = fs.readFileSync(out, 'utf8');
  assert.match(md, /Release failure rate \| UNKNOWN — needs deployment records/);
  assert.match(md, /Production rollbacks \| UNKNOWN — needs deployment records/);
  assert.match(md, /E2E journeys \| 1 defined/);
  assert.match(md, /Skipped tests per run \| UNKNOWN — no guard log supplied/);
  assert.equal(m.git.goals_delivered[0], 'E-A03');
});
