'use strict';
// P11 r6 O-6 — detached dropper launched by tests/_pg-boot.mjs on 'exit' (the --test-force-exit path). Drops ONE throwaway
// test database (or schema) named in SDP_DROP_CTX, then exits. Only names produced by tests/pg-helpers.js are accepted.
const { Client } = require('pg');
(async () => {
  let ctx; try { ctx = JSON.parse(process.env.SDP_DROP_CTX || '{}'); } catch (_) { return; }
  const ok = (n) => typeof n === 'string' && /^sdp_(tracker_)?test_[a-z0-9_]{1,40}$/.test(n);
  for (let attempt = 0; attempt < 5; attempt++) {
    let c;
    try {
      if (ctx.name && ok(ctx.name) && ctx.adminUrl) {
        c = new Client({ connectionString: ctx.adminUrl }); await c.connect();
        await c.query(`DROP DATABASE IF EXISTS ${ctx.name} WITH (FORCE)`);
      } else if (ctx.schema && ok(ctx.schema) && ctx.baseUrl) {
        c = new Client({ connectionString: ctx.baseUrl }); await c.connect();
        await c.query(`DROP SCHEMA IF EXISTS ${ctx.schema} CASCADE`);
      }
      await c?.end();
      return;
    } catch (_) {
      try { await c?.end(); } catch (_e) { /* ignore */ }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
})().then(() => process.exit(0), () => process.exit(0));
