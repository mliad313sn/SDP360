'use strict';
// Recipients directory for the reporting suite. report_recipients keyed by
// site_code. suggestFromMeetings() PRE-FILLS blank fields from meetings data
// but NEVER overwrites a confirmed value. resolveRecipient() enforces the
// "no confirmed email → no send" safety rule.

const COLS = ['site_name', 'coordinator_name', 'coordinator_email', 'coordinator_email_confirmed',
  'fm_name', 'fm_email', 'fm_email_confirmed', 'cc_emails', 'active',
  'asset_manager_name', 'asset_manager_email', 'asset_manager_email_confirmed'];

function _h(db) {
  const rdb = require('../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: db, isPg: false };
}

const _inited = new WeakSet();
function _initSchema(db) {
  if (_h(db).isPg) return;
  if (_inited.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS report_recipients (
    site_code TEXT PRIMARY KEY, site_name TEXT,
    coordinator_name TEXT, coordinator_email TEXT, coordinator_email_confirmed INTEGER DEFAULT 0,
    fm_name TEXT, fm_email TEXT, fm_email_confirmed INTEGER DEFAULT 0,
    cc_emails TEXT, active INTEGER DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_by TEXT
  );`);
  // Asset engagement (2026-09-18) — per-site asset manager. sqlite has no ADD COLUMN
  // IF NOT EXISTS → plain ALTER in try/catch (duplicate column = already migrated).
  for (const c of ['asset_manager_name TEXT', 'asset_manager_email TEXT', 'asset_manager_email_confirmed INTEGER DEFAULT 0']) {
    try { db.exec(`ALTER TABLE report_recipients ADD COLUMN ${c}`); } catch (_) { /* already present */ }
  }
  _inited.add(db);
}

function listRecipients(db) {
  const { H, isPg } = _h(db);
  const SQL = 'SELECT * FROM report_recipients ORDER BY site_code';
  if (isPg) return H.prepare(SQL).all();
  _initSchema(db);
  try { return H.prepare(SQL).all(); } catch (e) { console.warn('[report-dir] list failed:', e.message); return []; }
}

function upsertRecipient(db, siteCode, patch, user) {
  const { H, isPg } = _h(db);
  const set = COLS.filter(c => patch[c] !== undefined);
  const insCols = ['site_code', ...set, 'updated_by'];
  const insVals = [siteCode, ...set.map(c => patch[c]), user || 'unknown'];
  const ph = insCols.map(() => '?').join(', ');
  const upd = set.map(c => `${c}=excluded.${c}`).concat('updated_by=excluded.updated_by').join(', ');
  const SQL = `INSERT INTO report_recipients (${insCols.join(', ')}) VALUES (${ph})
               ON CONFLICT(site_code) DO UPDATE SET ${upd}`;
  if (isPg) return (async () => { await H.prepare(SQL).run(...insVals); return { ok: true }; })();
  _initSchema(db);
  H.prepare(SQL).run(...insVals);
  return { ok: true };
}

// Case-INSENSITIVE on site_code, matching reports-db.getSiteIdByModuleCode.
// A case-sensitive match here would let `?site=hgo` compose a full report and
// then resolve no recipient — skipped for "no confirmed recipient" when the
// address is on file and confirmed. Fails safe, but the reason lies.
function resolveFromRows(rows, siteCode, kind, { neverSendUnconfirmed = true } = {}) {
  // Guard the empty case explicitly: without it a blank siteCode folds to '' and
  // would MATCH a row with a blank/null site_code — resolving a recipient for a
  // site nobody named.
  const want = String(siteCode || '').toLowerCase();
  if (!want) return null;
  const row = (rows || []).find(r => String(r.site_code || '').toLowerCase() === want);
  if (!row) return null;
  const F = { fm: ['fm_email', 'fm_email_confirmed'], asset_manager: ['asset_manager_email', 'asset_manager_email_confirmed'] }[kind]
    || ['coordinator_email', 'coordinator_email_confirmed'];
  const email = row[F[0]];
  const confirmed = row[F[1]];
  if (!email || (neverSendUnconfirmed && !confirmed)) return null;
  const cc = String(row.cc_emails || '').split(',').map(s => s.trim()).filter(Boolean);
  return { to: email, cc };
}
function resolveRecipient(db, siteCode, kind, opts = {}) {
  const rows = listRecipients(db);
  if (typeof rows.then === 'function') throw new Error('resolveRecipient: pass an already-resolved row set');
  return resolveFromRows(rows, siteCode, kind, opts);
}

// Fully async — every edge (listRecipients, getSiteContacts, upsertRecipient)
// returns a PROMISE under postgres, which is what prod runs. Reading a field
// off an unawaited promise yields `undefined` → no patch → {ok:true, filled:0}
// with NO error: a silent zero, the worst possible failure mode for a
// "suggest" button. `await` all three; a missing reader THROWS rather than
// degrading to a no-op. Never overwrites a confirmed value.
async function suggestFromMeetings(db, siteCodes, meetingsReader, user) {
  if (!meetingsReader || typeof meetingsReader.getSiteContacts !== 'function') {
    throw new Error('suggestFromMeetings: meetingsReader.getSiteContacts is required');
  }
  const existing = await listRecipients(db);
  const byCode = Object.fromEntries(existing.map(r => [r.site_code, r]));
  let filled = 0;
  for (const code of siteCodes) {
    const c = (await meetingsReader.getSiteContacts(code)) || {};
    const cur = byCode[code] || {};
    const patch = {};
    if (c.coordinator_name && !cur.coordinator_email_confirmed && !cur.coordinator_name) patch.coordinator_name = c.coordinator_name;
    if (c.fm_name && !cur.fm_email_confirmed && !cur.fm_name) patch.fm_name = c.fm_name;
    if (Object.keys(patch).length) { await upsertRecipient(db, code, patch, user || 'system'); filled++; }
  }
  return { ok: true, filled };
}

module.exports = { COLS, _initSchema, listRecipients, upsertRecipient, resolveRecipient, resolveFromRows, suggestFromMeetings };
