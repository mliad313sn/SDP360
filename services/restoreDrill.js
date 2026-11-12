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
  const fullFailed = !!d.full && !fullVerdict(d.full.steps).ok;
  const verdict = c.ok && !fullFailed ? 'PASS' : 'FAIL';
  const L = [];
  L.push(`# Restore drill — ${d.date}`);
  L.push('');
  L.push(`**Result: ${verdict}** — ${!c.ok ? `${c.mismatches} table(s) differ between the restored copy and the live database.` : fullFailed ? 'the database matches, but a full-service step failed (see below).' : 'every compared table has the same row count on the restored copy and on the live database.'}`);
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
  if (d.full) L.push(renderFullSection(d.full));
  L.push('_Generated by `tools/pg/restore-drill.js` (fiche E11). A FAIL exits non-zero and is alerted like any sync job._');
  L.push('');
  return L.join('\n');
}

// ── F-ARCH-05 — full-service drill (pure half) ─────────────────────────────────────────────
// A restored database is not a restored SERVICE: the photos/signatures/attachments live on disk
// (data/blobs, where completed field uploads also land), and two secrets that are in no dump are
// needed to read what was restored (SDP_BACKUP_KEY opens the dump, SDP_CONFIG_KEY opens the
// encrypted config values). Each step has THREE states — 'ok', 'failed', 'unknown' — and
// 'unknown' is never shown as a pass: a step that could not be exercised proves nothing.

const STEP_LABELS = {
  database: 'Database row counts',
  backup_key: 'Backup key opens the dump (SDP_BACKUP_KEY)',
  config_key: 'Config key opens a stored secret (SDP_CONFIG_KEY)',
  blobs: 'File store matches its backup copy (data/blobs)',
  field_uploads: 'Completed field uploads have their file in the backup copy',
  rto: 'Drill duration against the recovery-time target',
};
function step(id, status, detail) { return { id, label: STEP_LABELS[id] || id, status, detail: detail || '' }; }

/** Evenly spaced deterministic sample of at most `max` items (all of them when fewer). */
function sampleEvenly(list, max = 200) {
  const a = Array.isArray(list) ? list : [];
  const m = Math.max(1, Math.floor(Number(max)) || 200);
  if (a.length <= m) return a.slice();
  const out = [];
  for (let i = 0; i < m; i++) out.push(a[Math.floor((i * a.length) / m)]);
  return out;
}

/**
 * @param {{keySet:boolean, encrypted:boolean, opened:boolean}} o
 *   keySet    — SDP_BACKUP_KEY is present and long enough
 *   encrypted — the dump under drill is an encrypted box
 *   opened    — the dump was opened and carries pg_dump's trailer
 */
function backupKeyStep(o = {}) {
  if (!o.keySet) return step('backup_key', 'failed', 'SDP_BACKUP_KEY is not set (or too short): backups are not encrypted at rest and the key cannot be proven');
  if (!o.encrypted) return step('backup_key', 'unknown', 'the dump under drill is plaintext gzip — the key is set but this dump does not exercise it');
  if (!o.opened) return step('backup_key', 'failed', 'the key did not open the dump');
  return step('backup_key', 'ok', 'the key decrypted the dump and the pg_dump trailer is present');
}

/**
 * @param {{keySet:boolean, boxes:number|null, opened:number|null}} o
 *   boxes  — encrypted values found in report_config of the RESTORED copy (null = table unreadable)
 *   opened — how many of them the key opened
 * Never receives, returns or prints a secret value.
 */
function configKeyStep(o = {}) {
  if (!o.keySet) return step('config_key', 'failed', 'SDP_CONFIG_KEY is not set (or too short): stored secrets cannot be read after a restore');
  if (o.boxes == null) return step('config_key', 'unknown', 'report_config could not be read on the restored copy');
  if (o.boxes === 0) return step('config_key', 'unknown', 'no encrypted secret in the restored report_config — nothing to decrypt, the key is not proven');
  if (o.opened !== o.boxes) return step('config_key', 'failed', `${o.boxes - (o.opened || 0)} of ${o.boxes} encrypted secret(s) did not open with the key`);
  return step('config_key', 'ok', `${o.boxes} encrypted secret(s) opened (values never read out)`);
}

/**
 * Compare a sample of the live file store with its backup copy.
 * @param {Array<{ref,sha256,size}>|null} live    hashed sample of the live store (null = store unreadable)
 * @param {Record<string,{sha256,size}>|null} copy  ref → hash in the backup copy (null = no copy configured)
 */
function compareBlobs(live, copy, { total = null } = {}) {
  if (copy == null) return { ...step('blobs', 'unknown', 'no backup copy of the file store was given (--blob-backup / SDP_BLOB_BACKUP_DIR) — files are NOT proven restorable'), checked: 0, missing: [], different: [] };
  if (live == null) return { ...step('blobs', 'unknown', 'the live file store could not be read'), checked: 0, missing: [], different: [] };
  const missing = [], different = [];
  for (const f of live) {
    const c = copy[f.ref];
    if (!c) missing.push(f.ref);
    else if (c.sha256 !== f.sha256 || Number(c.size) !== Number(f.size)) different.push(f.ref);
  }
  const bad = missing.length + different.length;
  const of = total != null && total !== live.length ? ` (sample of ${total})` : '';
  if (live.length === 0) return { ...step('blobs', 'ok', 'the live file store is empty — nothing to restore'), checked: 0, missing, different };
  if (bad) return { ...step('blobs', 'failed', `${missing.length} file(s) missing and ${different.length} different in the backup copy, out of ${live.length} checked${of}`), checked: live.length, missing, different };
  return { ...step('blobs', 'ok', `${live.length} file(s) checked${of}: same size and SHA-256 in the backup copy`), checked: live.length, missing, different };
}

/**
 * Completed field uploads recorded in the RESTORED database must have their file in the copy.
 * @param {string[]|null} refs      field_uploads.ref of done uploads (null = table absent)
 * @param {Record<string,object>|null} copy
 */
function compareUploadRefs(refs, copy) {
  if (refs == null) return { ...step('field_uploads', 'unknown', 'field_uploads is absent from the restored copy'), checked: 0, missing: [] };
  if (copy == null) return { ...step('field_uploads', 'unknown', 'no backup copy of the file store was given — upload files are NOT proven restorable'), checked: 0, missing: [] };
  const missing = refs.filter((r) => !copy[r]);
  if (!refs.length) return { ...step('field_uploads', 'ok', 'no completed field upload in the restored database'), checked: 0, missing };
  if (missing.length) return { ...step('field_uploads', 'failed', `${missing.length} of ${refs.length} completed upload(s) have no file in the backup copy`), checked: refs.length, missing };
  return { ...step('field_uploads', 'ok', `${refs.length} completed upload(s) all have their file in the backup copy`), checked: refs.length, missing };
}

/**
 * Duration against report_config.restore_rto_minutes. An empty / non-numeric / non-positive target
 * is UNKNOWN — never "met": there is no target to meet until the operations owner sets one.
 */
function rtoStep(durationMs, rtoMinutes) {
  const raw = rtoMinutes == null ? '' : String(rtoMinutes).trim();
  const target = raw === '' ? NaN : Number(raw);
  const secs = durationMs == null ? null : Math.round(durationMs / 100) / 10;
  if (!Number.isFinite(target) || target <= 0) return { ...step('rto', 'unknown', `no recovery-time target is set (restore_rto_minutes empty)${secs != null ? ` — the drill took ${secs} s` : ''}`), target_minutes: null, duration_ms: durationMs == null ? null : durationMs };
  if (durationMs == null) return { ...step('rto', 'unknown', `target ${target} min, but the drill duration was not measured`), target_minutes: target, duration_ms: null };
  const met = durationMs <= target * 60000;
  return { ...step('rto', met ? 'ok' : 'failed', `drill took ${secs} s against a target of ${target} min — ${met ? 'within' : 'OVER'} the target (database restore + verification only: a lower bound of a real recovery)`), target_minutes: target, duration_ms: durationMs };
}

/** steps → { ok (no failed step), complete (no unknown step), failed[], unknown[] }. */
function fullVerdict(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const failed = list.filter((s) => s.status === 'failed').map((s) => s.id);
  const unknown = list.filter((s) => s.status !== 'failed' && s.status !== 'ok').map((s) => s.id);
  return { ok: failed.length === 0, complete: failed.length === 0 && unknown.length === 0, failed, unknown };
}

/** Markdown section appended to the dated report when the drill ran with --full. */
function renderFullSection(full) {
  const v = fullVerdict(full && full.steps);
  const L = [];
  L.push('## Full-service drill (files + keys + timing)');
  L.push('');
  L.push(`**Full-service result: ${!v.ok ? 'FAIL' : v.complete ? 'PASS' : 'NOT PROVEN'}** — ${!v.ok ? `${v.failed.length} step(s) failed.` : v.complete ? 'every step was exercised and passed.' : `${v.unknown.length} step(s) could not be exercised (UNKNOWN is not a pass).`}`);
  L.push('');
  L.push('| Step | Status | Detail |');
  L.push('|---|---|---|');
  for (const s of (full && full.steps) || []) L.push(`| ${s.label} | ${s.status === 'ok' ? 'ok' : s.status === 'failed' ? 'FAILED' : 'UNKNOWN'} | ${String(s.detail || '').replace(/\|/g, '/')} |`);
  L.push('');
  const lists = [];
  for (const s of (full && full.steps) || []) for (const k of ['missing', 'different']) if (s[k] && s[k].length) lists.push(`- ${s.id} — ${k}: ${s[k].slice(0, 10).map((r) => '`' + r + '`').join(', ')}${s[k].length > 10 ? ` … (+${s[k].length - 10})` : ''}`);
  if (lists.length) { L.push(...lists); L.push(''); }
  L.push('_Recovery-time and recovery-point targets, key escrow and the packaged-installer (EXE) qualification are decisions and environments owned by the operations owner; this drill does not assert them._');
  L.push('');
  return L.join('\n');
}

/** The `details` object of the `restore_drill` system_log row (counts + result, no paths with secrets). */
function logDetails(d) {
  const c = d.comparison || compareCounts({}, {});
  return {
    ok: c.ok && (!d.full || fullVerdict(d.full.steps).ok), mismatches: c.mismatches, date: d.date,
    dump: d.dumpFile ? require('path').basename(d.dumpFile) : null,
    dump_bytes: d.dumpBytes != null ? d.dumpBytes : null, encrypted: !!d.encrypted,
    target: d.target ? `${d.target.kind}:${d.target.name}` : null,
    duration_ms: d.durationMs != null ? d.durationMs : null,
    psql_errors: d.psql ? d.psql.count : null,
    counts: Object.fromEntries(c.rows.map((r) => [r.table, { live: r.live, restored: r.restored, status: r.status }])),
    report: d.reportFile ? require('path').basename(d.reportFile) : null,
    ...(d.full ? { full: { ...fullVerdict(d.full.steps), steps: Object.fromEntries(d.full.steps.map((x) => [x.id, x.status])) } } : {}),
  };
}

module.exports = { MAIN_TABLES, compareCounts, rewriteSchema, summarizePsqlErrors, renderReport, logDetails, fmtBytes,
  STEP_LABELS, sampleEvenly, backupKeyStep, configKeyStep, compareBlobs, compareUploadRefs, rtoStep, fullVerdict, renderFullSection };
