'use strict';
// E11 — restore drill, pure half. A backup is only proven once it has been restored and
// compared with the live database; this module holds everything in that proof that needs no
// I/O (table list, row-count comparison, the schema rewrite used by the throwaway-schema
// fallback, the dated report), so it is unit-testable. The I/O (pg_dump/psql spawn, pg
// connections, file writes) lives in tools/pg/restore-drill.js.

// The 10 main tables whose row counts are compared (one per module + the audit log).
// A table absent from BOTH sides is reported as `n/a` and does not fail the drill
// (a fresh install has no assets yet); absent on one side only is a mismatch.
const MAIN_TABLES = [
  'users', 'weekly_reports', 'action_items', 'md_meetings', 'md_issues', 'md_actions',
  'insp_inspections', 'request_records', 'assets', 'system_log',
];

/**
 * @param {Record<string, number|null>} live      table → count on the live database (null = table missing)
 * @param {Record<string, number|null>} restored  table → count on the restored copy
 * @param {string[]} [tables]
 * @returns {{ ok:boolean, rows:Array<{table, live, restored, diff, status}>, mismatches:number }}
 */
function compareCounts(live, restored, tables = MAIN_TABLES) {
  const rows = tables.map((table) => {
    const l = live && live[table] != null ? Number(live[table]) : null;
    const r = restored && restored[table] != null ? Number(restored[table]) : null;
    let status, diff = null;
    if (l == null && r == null) status = 'n/a';
    else if (l == null || r == null) status = 'missing';
    else { diff = r - l; status = diff === 0 ? 'ok' : 'mismatch'; }
    return { table, live: l, restored: r, diff, status };
  });
  const mismatches = rows.filter((x) => x.status === 'mismatch' || x.status === 'missing').length;
  return { ok: mismatches === 0, rows, mismatches };
}

/**
 * Throwaway-SCHEMA fallback (CLAUDE.md recipe G-02): since PostgreSQL 10.3 pg_dump qualifies every
 * object with `public.`, so a plain dump cannot be redirected by search_path alone — the schema
 * name is rewritten in the SQL. Only `public.` preceded by a non-identifier character is touched
 * (COPY data lines are tab-separated values; a literal "public." inside a value would have to be
 * at a word boundary to be hit — accepted, documented limitation of the fallback; the preferred
 * target is a throwaway DATABASE when an admin URL is available).
 */
function rewriteSchema(sql, schema) {
  if (!/^[a-z_][a-z0-9_]*$/.test(String(schema))) throw new Error('rewriteSchema: invalid schema name');
  return String(sql)
    .replace(/(^|[^A-Za-z0-9_."])public\./g, `$1${schema}.`)
    .replace(/CREATE SCHEMA (IF NOT EXISTS )?public\b/g, `CREATE SCHEMA $1${schema}`)
    .replace(/ALTER SCHEMA public OWNER/g, `ALTER SCHEMA ${schema} OWNER`)
    .replace(/COMMENT ON SCHEMA public /g, `COMMENT ON SCHEMA ${schema} `);
}

/** psql stderr → number of `ERROR:` lines + the first few (ownership errors are expected on a foreign cluster). */
function summarizePsqlErrors(stderr, { max = 8 } = {}) {
  const lines = String(stderr || '').split(/\r?\n/).filter((l) => /^(psql:)?.*\bERROR:/.test(l));
  const owner = lines.filter((l) => /role .* does not exist|must be owner|OWNER TO/.test(l)).length;
  return { count: lines.length, owner_role_errors: owner, sample: lines.slice(0, max) };
}

function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

/**
 * Dated Markdown report for docs/ops/restore-drills/<date>.md.
 * @param {object} d  { date, dumpFile, dumpBytes, storedBytes, encrypted, target:{kind,name}, comparison, durationMs, psql, notes[], actor }
 */
function renderReport(d) {
  const c = d.comparison || compareCounts({}, {});
  const verdict = c.ok ? 'PASS' : 'FAIL';
  const L = [];
  L.push(`# Restore drill — ${d.date}`);
  L.push('');
  L.push(`**Result: ${verdict}** — ${c.ok ? 'every compared table has the same row count on the restored copy and on the live database.' : `${c.mismatches} table(s) differ between the restored copy and the live database.`}`);
  L.push('');
  L.push('| Item | Value |');
  L.push('|---|---|');
  L.push(`| Dump | \`${d.dumpFile || '—'}\` |`);
  L.push(`| Dump size (plain SQL / stored) | ${fmtBytes(d.dumpBytes)} / ${fmtBytes(d.storedBytes)} |`);
  L.push(`| Encrypted at rest | ${d.encrypted ? 'yes (AES-256-GCM, SDP_BACKUP_KEY)' : 'NO — plaintext gzip (SDP_BACKUP_KEY not set)'} |`);
  L.push(`| Restore target | ${d.target ? `${d.target.kind} \`${d.target.name}\`` : '—'} (disposable, dropped after the drill) |`);
  L.push(`| Restore duration | ${d.durationMs != null ? (d.durationMs / 1000).toFixed(1) + ' s' : '—'} |`);
  L.push(`| psql errors during restore | ${d.psql ? `${d.psql.count} (of which ${d.psql.owner_role_errors} ownership / missing-role, expected on a foreign cluster)` : '—'} |`);
  L.push(`| Run by | ${d.actor || 'scheduled job db.restore_drill'} |`);
  L.push('');
  L.push('## Row counts');
  L.push('');
  L.push('| Table | Live | Restored | Δ | Status |');
  L.push('|---|---:|---:|---:|---|');
  for (const r of c.rows) L.push(`| ${r.table} | ${r.live == null ? '—' : r.live} | ${r.restored == null ? '—' : r.restored} | ${r.diff == null ? '—' : (r.diff > 0 ? '+' : '') + r.diff} | ${r.status} |`);
  L.push('');
  if (d.psql && d.psql.sample && d.psql.sample.length) {
    L.push('## psql errors (sample)');
    L.push('');
    L.push('```');
    for (const s of d.psql.sample) L.push(s.replace(/postgres(ql)?:\/\/[^\s]+/g, '<url>'));
    L.push('```');
    L.push('');
  }
  if (d.notes && d.notes.length) {
    L.push('## Notes');
    L.push('');
    for (const n of d.notes) L.push(`- ${n}`);
    L.push('');
  }
  L.push('_Generated by `tools/pg/restore-drill.js` (fiche E11). A FAIL exits non-zero and is alerted like any sync job._');
  L.push('');
  return L.join('\n');
}

/** The `details` object of the `restore_drill` system_log row (counts + result, no paths with secrets). */
function logDetails(d) {
  const c = d.comparison || compareCounts({}, {});
  return {
    ok: c.ok, mismatches: c.mismatches, date: d.date,
    dump: d.dumpFile ? require('path').basename(d.dumpFile) : null,
    dump_bytes: d.dumpBytes != null ? d.dumpBytes : null, encrypted: !!d.encrypted,
    target: d.target ? `${d.target.kind}:${d.target.name}` : null,
    duration_ms: d.durationMs != null ? d.durationMs : null,
    psql_errors: d.psql ? d.psql.count : null,
    counts: Object.fromEntries(c.rows.map((r) => [r.table, { live: r.live, restored: r.restored, status: r.status }])),
    report: d.reportFile ? require('path').basename(d.reportFile) : null,
  };
}

module.exports = { MAIN_TABLES, compareCounts, rewriteSchema, summarizePsqlErrors, renderReport, logDetails, fmtBytes };
