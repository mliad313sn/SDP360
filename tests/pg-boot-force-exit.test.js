'use strict';
// P11 r6 O-6 — the mandated command (`node --test --test-force-exit`) never fired tests/_pg-boot.mjs's 'beforeExit' drop,
// so every PG test file leaked its throwaway database until the end-of-run sweep. A child test file is run here with
// --test-force-exit; afterwards its database must be gone (dropped by the detached 'exit' dropper).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const REPO = path.join(__dirname, '..');

test('O-6: a PG test file run with --test-force-exit leaves no database behind', async (t) => {
  const admin = process.env.PG_ADMIN_URL;
  if (!admin) { t.skip('needs PG_ADMIN_URL (throwaway databases)'); return; }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pgboot-fx-'));
  try {
    // the boot only provisions for a file named <...>/tests/<name>.test.js
    const dir = path.join(work, 'tests'); fs.mkdirSync(dir);
    const out = path.join(work, 'db.txt');
    fs.writeFileSync(path.join(dir, 'probe.test.js'), `'use strict';
const { test } = require('node:test');
test('probe', () => { require('fs').writeFileSync(${JSON.stringify(out)}, String(globalThis.__sdpPgTestCtx && globalThis.__sdpPgTestCtx.name)); });
// a pool left open, like many real files: without --test-force-exit the process would not even reach beforeExit
setInterval(() => {}, 1 << 30);
`);
    const env = { ...process.env, NODE_OPTIONS: `--require ${path.join(REPO, 'tools', 'test', 'blocking-stdio.js')} --require ${path.join(REPO, 'tests', '_default-env.js')} --import ${require('url').pathToFileURL(path.join(REPO, 'tests', '_pg-boot.mjs')).href}` };
    delete env.SDP_TEST_PG_URL; delete env.NODE_TEST_CONTEXT;   // a nested node --test run, not a subtest of this one
    const r = spawnSync(process.execPath, ['--test', '--test-force-exit', path.join(dir, 'probe.test.js')], { env, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
    if (!fs.existsSync(out)) assert.fail('probe did not run: ' + (r.stdout || '').slice(-1500) + (r.stderr || '').slice(-800));
    const name = fs.readFileSync(out, 'utf8');
    assert.match(name, /^sdp_tracker_test_[a-z0-9_]+$/, 'the probe ran on a throwaway database');
    const c = new Client({ connectionString: admin }); await c.connect();
    try {
      let left = 1;
      for (let i = 0; i < 40 && left; i++) {
        left = Number((await c.query('SELECT count(*)::int AS n FROM pg_database WHERE datname = $1', [name])).rows[0].n);
        if (left) await new Promise((res) => setTimeout(res, 250));
      }
      if (left) await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);   // never leak from this test itself
      assert.equal(left, 0, `${name} still exists after the child exited`);
    } finally { await c.end(); }
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});
