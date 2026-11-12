'use strict';
// R8 (REBUILD-SPEC) — sync write fence: "a sync writes only inside a fenced lease so two runs never interleave".
// R1-DEMO pinned two guarantees + four holes as characterisations (docs/agent-execution/F-R1-DEMO.md). G1-SYNC
// closed the four holes (compare-and-set lease with a token, release by token, fence handed to the write step,
// manual triggers through the runner): the four DEFECT pins are now the FENCED assertions — each failed on the
// pre-fix code (docs/agent-execution/F-G1-SYNC.md) and passes now. PostgreSQL store on this file's throwaway db.
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');
const { createSyncRunner } = require('../services/sync/syncRunner');
const { makeSyncStore } = require('../services/sync/syncStore');

const quiet = () => {};
const pg = () => rdb.pgHandle();
let n = 0;
const uniqueJob = () => `fence.test.${process.pid}.${++n}`;

function gate() { let open; const p = new Promise((r) => { open = r; }); return { wait: () => p, open }; }

async function scratch() {
  const t = `fence_scratch_${process.pid}_${++n}`;
  await pg().exec(`CREATE TABLE ${t} (writer TEXT NOT NULL, k INTEGER NOT NULL)`);
  return t;
}
/** A job whose apply is a DELETE-then-INSERT (the replace pattern every full sync uses), pausable mid-apply. */
function replaceJob(name, table, writer, log, pause) {
  return {
    name, opts: { emptyGuard: false, maxAttempts: 1 },
    fetch: async () => ({ rows: [{ k: 1 }, { k: 2 }] }),
    apply: async ({ rows, fence }) => {
      log.push(`${writer}:delete`); await pg().prepare(`DELETE FROM ${table}`).run();
      if (pause) await pause();
      if (fence) await fence.assert();                  // a fenced job checks its lease before each write batch
      for (const r of rows) await pg().prepare(`INSERT INTO ${table} (writer, k) VALUES (?, ?)`).run(writer, r.k);
      log.push(`${writer}:insert`);
      return { upserted: rows.length, deleted: 0 };
    },
  };
}

test('fresh lock: a second run of the same job while the first is writing is SKIPPED (no interleaving)', async () => {
  const store = makeSyncStore(pg());
  const r = createSyncRunner({ store, log: quiet });
  const job = uniqueJob(), table = await scratch(), log = [], g = gate(), inApply = gate();
  const first = r.run(replaceJob(job, table, 'A', log, async () => { inApply.open(); await g.wait(); }));
  await inApply.wait();
  const second = await r.run(replaceJob(job, table, 'B', log));
  assert.deepEqual(second, { status: 'skipped', reason: 'overlap', job });
  g.open();
  assert.equal((await first).status, 'ok');
  assert.deepEqual(log, ['A:delete', 'A:insert'], 'only the first run wrote');
  const rows = await pg().prepare(`SELECT writer FROM ${table}`).all();
  assert.deepEqual([...new Set(rows.map((x) => x.writer))], ['A']);
  assert.equal(await pg().prepare('SELECT job FROM sync_locks WHERE job=?').get(job), undefined, 'lock released after the run');
});

test('two processes (two stores, two owners, one database): the PRIMARY KEY lock still lets only one in', async () => {
  const rA = createSyncRunner({ store: makeSyncStore(pg(), { owner: 'hostA:1' }), log: quiet });
  const rB = createSyncRunner({ store: makeSyncStore(pg(), { owner: 'hostB:2' }), log: quiet });
  const job = uniqueJob(), table = await scratch(), log = [], g = gate(), inApply = gate();
  const first = rA.run(replaceJob(job, table, 'A', log, async () => { inApply.open(); await g.wait(); }));
  await inApply.wait();
  assert.equal((await rB.run(replaceJob(job, table, 'B', log))).status, 'skipped');
  g.open(); await first;
  assert.deepEqual(log, ['A:delete', 'A:insert']);
});

/** Seed a lock row as a crashed run (or a pre-086 row without a token) would have left it. */
async function seedStale(job) {
  await pg().prepare('INSERT INTO sync_locks (job, locked_at, owner) VALUES (?, ?, ?)').run(job, new Date(0).toISOString(), 'crashed:0');
}

test('R8 hole 1 FIXED: two runs that both find a STALE lock never both acquire it (50 races)', async () => {
  for (let i = 0; i < 50; i++) {
    const job = uniqueJob();
    await seedStale(job);
    const sA = makeSyncStore(pg(), { owner: 'A' }), sB = makeSyncStore(pg(), { owner: 'B' });
    const [a, b] = await Promise.all([sA.acquireLock(job, Date.now(), 60_000), sB.acquireLock(job, Date.now(), 60_000)]);
    assert.ok(!(a && b), `race ${i}: exactly one may hold the lock — got A=${a} B=${b}`);
    assert.ok(a || b, `race ${i}: the stale lock is taken over by one of them`);
    const row = await pg().prepare('SELECT owner, token FROM sync_locks WHERE job=?').get(job);
    assert.equal(row.token, a || b, 'the row carries the winner\'s token');
  }
});

test('R8 hole 1 FIXED: a fresh lock is refused, a stale one is stolen, in one statement', async () => {
  const job = uniqueJob();
  const s = makeSyncStore(pg(), { owner: 'A' });
  const t1 = await s.acquireLock(job, 1_000_000, 1000);
  assert.ok(t1);
  assert.equal(await s.acquireLock(job, 1_000_500, 1000), false, 'fresh → refused');
  const t2 = await s.acquireLock(job, 1_001_000, 1000);
  assert.ok(t2 && t2 !== t1, 'stale (age = ttl) → stolen with a new token');
});

test('R8 hole 2 FIXED: a run whose lock was taken over does NOT release the new holder\'s lock on exit', async () => {
  const job = uniqueJob();
  const sA = makeSyncStore(pg(), { owner: 'A' }), sB = makeSyncStore(pg(), { owner: 'B' });
  const tA = await sA.acquireLock(job, 0, 1000);
  assert.ok(tA);
  const tB = await sB.acquireLock(job, 5000, 1000);
  assert.ok(tB, 'B takes the stale lock over (A looks crashed)');
  assert.equal(await sA.releaseLock(job, tA), false, 'A was only slow; its release finds nothing of its own');
  const row = await pg().prepare('SELECT owner FROM sync_locks WHERE job=?').get(job);
  assert.equal(row && row.owner, 'B', 'B must still hold its lock after A exits');
  assert.equal(await sB.releaseLock(job, tB), true);
  assert.equal(await pg().prepare('SELECT job FROM sync_locks WHERE job=?').get(job), undefined);
});

test('R8 hole 3 FIXED: apply() gets the fence; a run whose lease expired stops before writing again', async () => {
  let now = 0;
  const store = makeSyncStore(pg(), { owner: 'one' });
  const r = createSyncRunner({ store, log: quiet, now: () => now });
  const job = uniqueJob(), table = await scratch(), log = [], g = gate(), inApply = gate();
  let fenceSeen = null;
  // heartbeatMs 0 models a FROZEN holder (blocked event loop / suspended VM): a live run renews its lease (next test)
  const slow = replaceJob(job, table, 'A', log, async () => { inApply.open(); await g.wait(); });
  const applyA = slow.apply;
  slow.opts = { ...slow.opts, lockTtlMs: 1000, heartbeatMs: 0 };
  slow.apply = async (ctx) => { fenceSeen = ctx.fence || null; return applyA(ctx); };
  const first = r.run(slow);
  await inApply.wait();
  now = 10_000;                                                // A's lease is now stale
  const fast = replaceJob(job, table, 'B', log); fast.opts = { ...fast.opts, lockTtlMs: 1000, heartbeatMs: 0 };
  assert.equal((await r.run(fast)).status, 'ok', 'B took over the stale lease and wrote');
  g.open();
  const outA = await first;
  assert.ok(fenceSeen && fenceSeen.token, 'apply() receives the lease fence');
  assert.deepEqual(log, ['A:delete', 'B:delete', 'B:insert'], 'A refused after losing its lease');
  assert.equal(outA.status, 'error');
  assert.equal(outA.reason, 'lease_lost');
  assert.equal(outA.attempts, 1, 'a lost lease is never retried');
  const rows = await pg().prepare(`SELECT writer FROM ${table} ORDER BY writer`).all();
  assert.deepEqual([...new Set(rows.map((x) => x.writer))], ['B'], 'the table holds only the new holder\'s replace');
  assert.equal(await store.getWatermark(job), null, 'no watermark recorded by either native test job');
});

test('R8 hole 3 FIXED: a live slow run renews its lease (heartbeat), so it is not taken over', async () => {
  const store = makeSyncStore(pg(), { owner: 'one' });
  let now = 1_000_000;
  const r = createSyncRunner({ store, log: quiet, now: () => now });
  const job = uniqueJob(), table = await scratch(), log = [], g = gate(), inApply = gate();
  const slow = replaceJob(job, table, 'A', log, async () => { inApply.open(); await g.wait(); });
  slow.opts = { ...slow.opts, lockTtlMs: 1000, heartbeatMs: 20 };
  const first = r.run(slow);
  await inApply.wait();
  now += 5000;                                                  // time passes; the heartbeat renews at the new now
  await new Promise((res) => setTimeout(res, 120));
  const second = replaceJob(job, table, 'B', log); second.opts = { ...second.opts, lockTtlMs: 1000 };
  assert.equal((await r.run(second)).status, 'skipped', 'the renewed lease is fresh: B is refused');
  g.open();
  assert.equal((await first).status, 'ok');
  assert.deepEqual(log, ['A:delete', 'A:insert']);
});

test('R8 hole 3 FIXED: fence.transaction serialises a DELETE+INSERT replace and refuses a lost lease', async () => {
  const store = makeSyncStore(pg(), { owner: 'one' });
  const job = uniqueJob(), table = await scratch();
  const tA = await store.acquireLock(job, 0, 1000);
  const tB = await store.acquireLock(job, 5000, 1000);         // B took over
  await assert.rejects(store.fencedTransaction(job, tA, async () => {
    await pg().prepare(`INSERT INTO ${table} (writer, k) VALUES ('A', 1)`).run();
  }), (e) => e.code === 'LEASE_LOST');
  await store.fencedTransaction(job, tB, async () => {
    await pg().prepare(`DELETE FROM ${table}`).run();
    await pg().prepare(`INSERT INTO ${table} (writer, k) VALUES ('B', 1)`).run();
  });
  const rows = await pg().prepare(`SELECT writer FROM ${table}`).all();
  assert.deepEqual(rows.map((x) => x.writer), ['B']);
});

test('R8 hole 4 FIXED: the manual triggers run under the runner lease (source pin on server.js)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
  const at = (re) => { const i = src.search(re); assert.ok(i >= 0, 'route not found: ' + re); return src.slice(i, i + 1500); };
  const assets = at(/app\.post\('\/api\/sync\/trigger\/assets'/), jobs = at(/app\.post\('\/api\/sync\/trigger\/:job'/);
  assert.match(assets.slice(0, 500), /startManualSync\(res, 'assets'/);
  assert.match(jobs.slice(0, 900), /startManualSync\(res, job,/);
  assert.doesNotMatch(assets.slice(0, 500) + jobs.slice(0, 900), /syncAllAssets\(\)|sync\.syncRequestData\(|sync\.syncChangeCab\(/, 'no direct call outside the runner');
});

function fakeRes() {
  const r = { statusCode: 200, body: null, headersSent: false, req: { method: 'POST', originalUrl: '/api/sync/trigger/x' },
    status(c) { r.statusCode = c; return r; }, json(b) { r.body = b; r.headersSent = true; return r; } };
  return r;
}

test('R8 hole 4 FIXED: a manual trigger while the scheduled run holds the lease answers 409 and writes nothing', async () => {
  const { startManualSync } = require('../services/sync/manualTrigger');
  const { buildJobs } = require('../services/sync/jobs');
  const store = makeSyncStore(pg(), { owner: 'cron' });
  const runner = createSyncRunner({ store, log: quiet });
  const syncModule = { ensureReady: async () => {}, getRunner: () => runner };
  const g = gate(), inRun = gate();
  let manualCalls = 0;
  const d = {
    sync: { syncRequestData: async () => { inRun.open(); await g.wait(); return { upserted: 1 }; },
      syncChangeCab: async () => ({ upserted: 0 }), syncSurveyData: async () => ({ upserted: 0 }) },
    assets: { syncAllAssets: async () => [], afterAssetsSync: async () => {} },
  };
  // the cron entry (same name, same lock) holds the lease
  await pg().prepare('DELETE FROM sync_locks WHERE job=?').run('zoho.requests');
  const cron = buildJobs(d).find((j) => j.name === 'zoho.requests');
  const scheduled = runner.run(cron.job);
  await inRun.wait();
  const res = fakeRes();
  const manual = { ...d, sync: { ...d.sync, syncRequestData: async () => { manualCalls++; return {}; } } };
  assert.equal(await startManualSync(res, 'requests', manual, { force: true }, { syncModule }), null);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'overlap');
  assert.match(res.body.error, /already running/);
  g.open(); assert.equal((await scheduled).status, 'ok');
  assert.equal(manualCalls, 0, 'the manual run never started');

  // free lease → started, recorded under the scheduled job's name, force passed through
  const res2 = fakeRes(); let forced = null;
  const ok = await startManualSync(res2, 'requests', { ...d, sync: { ...d.sync, syncRequestData: async (o) => { forced = o; return { upserted: 2 }; } } }, { force: true }, { syncModule });
  assert.deepEqual(ok, { job: 'zoho.requests' });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(forced, { force: true });
  const last = await pg().prepare(`SELECT status FROM sync_runs WHERE job='zoho.requests' ORDER BY id DESC LIMIT 1`).get();
  assert.equal(last.status, 'ok');

  const res3 = fakeRes();
  assert.equal(await startManualSync(res3, 'nope', d, {}, { syncModule }), null);
  assert.equal(res3.statusCode, 400);
});
