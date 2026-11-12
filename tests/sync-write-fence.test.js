'use strict';
// R8 (REBUILD-SPEC) — sync write fence: "a sync writes only inside a fenced lease so two runs never interleave".
// Characterisation of head (services/sync/syncRunner.js + syncStore.js, PostgreSQL store on this file's throwaway
// database). R1-DEMO does NOT edit services/sync/* (F1-SYNC owns it): the two guarantees head already gives are
// pinned as normal tests; the three holes found are pinned as DEFECT characterisations (they reproduce the hole and
// pass today). When the fence lands, INVERT each one: the expected (fenced) assertion is written next to it, and the
// goal prompt is in docs/agent-execution/F-R1-DEMO.md (R8).
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
    apply: async ({ rows }) => {
      log.push(`${writer}:delete`); await pg().prepare(`DELETE FROM ${table}`).run();
      if (pause) await pause();
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

/** A pgDb wrapper that holds each sync_locks statement until it is its turn in `order` ("A:SELECT", "B:DELETE", …). */
function scripted(order) {
  let i = 0; const waiters = [];
  const kick = () => { for (const w of waiters.splice(0)) w(); };
  const turn = async (key) => { while (order[i] !== key) await new Promise((r) => waiters.push(r)); };
  const done = () => { i++; kick(); };
  const wrap = (who) => ({
    prepare(sql) {
      const st = pg().prepare(sql);
      const kind = /sync_locks/.test(sql) ? (sql.trim().split(/\s+/)[0] || '').toUpperCase() : null;
      const call = (m) => async (...a) => {
        if (!kind || !order.includes(`${who}:${kind}`)) return st[m](...a);
        await turn(`${who}:${kind}`);
        try { return await st[m](...a); } finally { done(); }
      };
      return { run: call('run'), get: call('get'), all: call('all') };
    },
  });
  return { A: wrap('A'), B: wrap('B') };
}

test('R8 DEFECT (pinned — invert when fenced) hole 1: two runs that both find a STALE lock both acquire it', async () => {
    const job = uniqueJob();
    await pg().prepare('INSERT INTO sync_locks (job, locked_at, owner) VALUES (?, ?, ?)').run(job, new Date(0).toISOString(), 'crashed:0');
    const db = scripted(['A:SELECT', 'B:SELECT', 'A:DELETE', 'A:INSERT', 'B:DELETE', 'B:INSERT']);
    const sA = makeSyncStore(db.A, { owner: 'A' }), sB = makeSyncStore(db.B, { owner: 'B' });
    const [a, b] = await Promise.all([sA.acquireLock(job, Date.now(), 60_000), sB.acquireLock(job, Date.now(), 60_000)]);
    // FENCED: assert.ok(!(a && b), 'exactly one may hold the lock')
    assert.ok(a && b, `today both hold it (check-then-delete-then-insert race) — got A=${a} B=${b}`);
  });

test('R8 DEFECT (pinned — invert when fenced) hole 2: a run whose lock was taken over releases the NEW holder\'s lock on exit', async () => {
    const job = uniqueJob();
    const sA = makeSyncStore(pg(), { owner: 'A' }), sB = makeSyncStore(pg(), { owner: 'B' });
    assert.equal(await sA.acquireLock(job, 0, 1000), true);
    assert.equal(await sB.acquireLock(job, 5000, 1000), true, 'B takes the stale lock over (A looks crashed)');
    await sA.releaseLock(job);                                  // A was only slow; it finishes and releases
    const row = await pg().prepare('SELECT owner FROM sync_locks WHERE job=?').get(job);
    // FENCED: assert.equal(row && row.owner, 'B', 'B must still hold its lock after A exits')
    assert.equal(row, undefined, 'today A\'s release deletes B\'s lock (releaseLock deletes by job, not by owner/token)');
  });

test('R8 DEFECT (pinned — invert when fenced) hole 3: apply() gets no fence, a run whose lease expired keeps writing', async () => {
    let now = 0;
    const store = makeSyncStore(pg(), { owner: 'one' });
    const r = createSyncRunner({ store, log: quiet, now: () => now });
    const job = uniqueJob(), table = await scratch(), log = [], g = gate(), inApply = gate();
    let fenceSeen = null;
    const slow = replaceJob(job, table, 'A', log, async () => { inApply.open(); await g.wait(); });
    const applyA = slow.apply;
    slow.opts = { ...slow.opts, lockTtlMs: 1000 };
    slow.apply = async (ctx) => { fenceSeen = ctx.fence || ctx.lease || null; return applyA(ctx); };
    const first = r.run(slow);
    await inApply.wait();
    now = 10_000;                                                // A's lease is now stale
    const fast = replaceJob(job, table, 'B', log); fast.opts = { ...fast.opts, lockTtlMs: 1000 };
    assert.equal((await r.run(fast)).status, 'ok', 'B took over the stale lease and wrote');
    g.open(); await first;
    // FENCED: assert.ok(fenceSeen); assert.deepEqual(log, ['A:delete', 'B:delete', 'B:insert'])  (A refused after losing its lease)
    assert.equal(fenceSeen, null, 'today apply() receives no lease / fence');
    assert.deepEqual(log, ['A:delete', 'B:delete', 'B:insert', 'A:insert'], 'today A writes AFTER B took over: interleaved delete+insert');
    const rows = await pg().prepare(`SELECT writer FROM ${table} ORDER BY writer`).all();
    assert.deepEqual([...new Set(rows.map((x) => x.writer))], ['A', 'B'], 'the table ends with rows of BOTH runs (2 × 2 = duplicated replace)');
  });

test('R8 DEFECT (pinned — invert when fenced) hole 4: the manual triggers run the sync OUTSIDE the runner lock', () => {
  // POST /api/sync/trigger/assets and /api/sync/trigger/:job call zoho-sync / assets-sync directly, so a manual
  // run and the cron run of the same job (which goes through getRunner().run) can write at the same time.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
  const at = (re) => { const i = src.search(re); assert.ok(i >= 0, 'route not found: ' + re); return src.slice(i, i + 2500); };
  const assets = at(/app\.post\('\/api\/sync\/trigger\/assets'/), jobs = at(/app\.post\('\/api\/sync\/trigger\/:job'/);
  // FENCED: both blocks go through the sync runner (getRunner().run(<the scheduled job entry>)) and answer 'skipped' on overlap
  assert.match(assets.slice(0, 400), /syncAllAssets\(\)/, 'today the assets trigger calls syncAllAssets directly');
  assert.match(jobs.slice(0, 600), /sync\.syncRequestData\(/, 'today the requests trigger calls syncRequestData directly');
  assert.doesNotMatch(assets.slice(0, 400) + jobs.slice(0, 1500), /getRunner\(/, 'today neither trigger takes the runner lock');
});
