'use strict';
// Recipients directory for the reporting suite. report_recipients keyed by
// site_code. suggestFromMeetings() PRE-FILLS blank fields from meetings data
// but NEVER overwrites a confirmed value. resolveRecipient() enforces the
// "no confirmed email → no send" safety rule.

const COLS = ['site_name', 'coordinator_name', 'coordinator_email', 'coordinator_email_confirmed',
  'fm_name', 'fm_email', 'fm_email_confirmed', 'cc_emails', 'active'];

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

function resolveFromRows(rows, siteCode, kind, { neverSendUnconfirmed = true } = {}) {
  const row = (rows || []).find(r => r.site_code === siteCode);
  if (!row) return null;
  const email = kind === 'fm' ? row.fm_email : row.coordinator_email;
  const confirmed = kind === 'fm' ? row.fm_email_confirmed : row.coordinator_email_confirmed;
  if (!email || (neverSendUnconfirmed && !confirmed)) return null;
  const cc = String(row.cc_emails || '').split(',').map(s => s.trim()).filter(Boolean);
  return { to: email, cc };
}
function resolveRecipient(db, siteCode, kind, opts = {}) {
  const rows = listRecipients(db);
  if (typeof rows.then === 'function') throw new Error('resolveRecipient: pass an already-resolved row set');
  return resolveFromRows(rows, siteCode, kind, opts);
}

function suggestFromMeetings(db, siteCodes, meetingsReader, user) {
  const existing = listRecipients(db);
  if (typeof existing.then === 'function') throw new Error('suggestFromMeetings: sqlite-only in Foundation');
  const byCode = Object.fromEntries(existing.map(r => [r.site_code, r]));
  let filled = 0;
  for (const code of siteCodes) {
    const c = (meetingsReader.getSiteContacts && meetingsReader.getSiteContacts(code)) || {};
    const cur = byCode[code] || {};
    const patch = {};
    if (c.coordinator_name && !cur.coordinator_email_confirmed && !cur.coordinator_name) patch.coordinator_name = c.coordinator_name;
    if (c.fm_name && !cur.fm_email_confirmed && !cur.fm_name) patch.fm_name = c.fm_name;
    if (Object.keys(patch).length) { upsertRecipient(db, code, patch, user || 'system'); filled++; }
  }
  return { ok: true, filled };
}

module.exports = { COLS, _initSchema, listRecipients, upsertRecipient, resolveRecipient, resolveFromRows, suggestFromMeetings };
