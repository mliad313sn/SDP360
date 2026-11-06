'use strict';
// E-I03 (audit I-03, catalogue R15) — post-incident (PIR) review record for a major incident.
//
// One record per major incident (request_id): the decisions taken, a before/after window, the count of incidents of
// the SAME category × sub-category on the SAME site (its Zoho resolver groups) before and after the incident, the
// commitments that carry the follow-up, the author, and a sign-off.
//   • the after-count is NULL while the after-window has not elapsed (never 0 — "not measured yet");
//   • sign-off is a recorded human act by a person who is NOT the author (SoD, like SELF_REVIEW in portfolioBenefits);
//     it is never automatic, and it freezes the record (counts included);
//   • RCA / CA / PIR / LL are shown from the existing SDP UDF readers — this record never rewrites them;
//   • nothing is sent anywhere.
// PG table: db/postgres/reports/074_pir_reviews.sql. `db` = services/pgDb-shaped { prepare } (async get/all/run).

const { typed } = require('./httpError');

const str = (v, max = 4000) => (v == null || String(v).trim() === '' ? null : String(v).slice(0, max));
const ids = (v) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50) : []);
const P_ = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
const DAY = 86400000;
const toDay = (d) => new Date(d).toISOString().slice(0, 10);

/** Window days: 7..365, default 90. */
function windowDays(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 7) return 90;
  return Math.min(n, 365);
}

/**
 * Pure — before / after windows around the incident day.
 *   before = [day − w, day − 1]   (always elapsed)
 *   after  = [day + 1, day + w]   (NULL bounds → not measurable while day + w is after `today`)
 */
function windows(occurredDay, w, today) {
  const t = Date.parse(String(occurredDay).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  const beforeFrom = toDay(t - w * DAY), beforeTo = toDay(t - DAY);
  const afterFrom = toDay(t + DAY), afterTo = toDay(t + w * DAY);
  return { before: { from: beforeFrom, to: beforeTo }, after: { from: afterFrom, to: afterTo }, afterElapsed: afterTo < String(today).slice(0, 10) };
}

/** Pure — count rows (created_time) falling in the windows; after = null while not elapsed. Excludes the incident itself. */
function countWindows(rows, { occurredDay, windowDays: w, today, requestId = null }) {
  const win = windows(occurredDay, w, today);
  if (!win) return { before: null, after: null, windows: null };
  let before = 0, after = 0;
  for (const r of rows || []) {
    if (requestId != null && String(r.request_id) === String(requestId)) continue;
    const d = r.created_time ? String(r.created_time).slice(0, 10) : null;
    if (!d) continue;
    if (d >= win.before.from && d <= win.before.to) before++;
    if (d >= win.after.from && d <= win.after.to) after++;
  }
  return { before, after: win.afterElapsed ? after : null, windows: win };
}

/** PG reader — the major incident's context: site (by Zoho group), category, sub-category, day. */
async function incidentContext(H, requestId) {
  const r = await H.prepare(`SELECT request_id, display_id, subject, request_type, template, category, sub_category, created_time, tech_group, udf_json
    FROM request_records WHERE request_id = ?`).get(String(requestId));
  if (!r) return null;
  const isMI = /major/i.test(String(r.request_type || '')) || /major incident/i.test(String(r.template || ''));
  let site = null;
  const grp = String(r.tech_group || '').trim();
  if (grp) {
    for (const s of (await H.prepare('SELECT id, zoho_group FROM sites').all())) {
      if (String(s.zoho_group || '').split(',').map((g) => g.trim()).filter(Boolean).includes(grp)) { site = Number(s.id); break; }
    }
  }
  return { request_id: String(r.request_id), display_id: r.display_id, subject: r.subject, is_major: isMI, site_id: site,
    category: r.category || null, sub_category: r.sub_category || null, occurred_on: r.created_time ? String(r.created_time).slice(0, 10) : null, udf_json: r.udf_json };
}

/** PG reader — incidents of the site's groups with the same category × sub-category (window filtered in JS). */
async function sameKindIncidents(H, siteId, category, subCategory, from, to) {
  const s = await H.prepare('SELECT zoho_group FROM sites WHERE id=?').get(siteId);
  const groups = String((s && s.zoho_group) || '').split(',').map((g) => g.trim()).filter(Boolean);
  if (!groups.length) return null;
  const ph = groups.map(() => '?').join(',');
  return H.prepare(`SELECT request_id, created_time FROM request_records
    WHERE tech_group IN (${ph}) AND request_type ILIKE '%incident%' AND COALESCE(category,'') = ? AND COALESCE(sub_category,'') = ?
      AND substr(created_time,1,10) BETWEEN ? AND ?`).all(...groups, category || '', subCategory || '', from, to);
}

function makePirStore(db, { now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('pirReview needs a db handle');
  const P = (sql) => db.prepare(sql);
  const row = (r) => r && ({ ...r, id: Number(r.id), site_id: r.site_id == null ? null : Number(r.site_id), window_days: Number(r.window_days),
    version: Number(r.version), author_id: r.author_id == null ? null : Number(r.author_id), signed_off_by: r.signed_off_by == null ? null : Number(r.signed_off_by),
    before_count: r.before_count == null ? null : Number(r.before_count), after_count: r.after_count == null ? null : Number(r.after_count),
    commitment_ids: P_(r.commitment_ids), signed: !!r.signed_off_at });
  const get = async (id) => row(await P('SELECT * FROM pir_reviews WHERE id=?').get(Number(id)));
  const getByRequest = async (rid) => row(await P('SELECT * FROM pir_reviews WHERE request_id=?').get(String(rid)));
  async function list({ siteIds = null } = {}) {
    if (siteIds && !siteIds.length) return [];
    const rows = siteIds ? await P(`SELECT * FROM pir_reviews WHERE site_id IN (${siteIds.map(() => '?').join(',')}) ORDER BY id DESC`).all(...siteIds.map(Number))
      : await P('SELECT * FROM pir_reviews ORDER BY id DESC').all();
    return rows.map(row);
  }
  /** Create (idempotent per major incident: a second call returns the existing record). */
  async function create(ctx, d, user) {
    if (!ctx || !ctx.request_id) throw typed('VALIDATION', 'major incident required', 400);
    const ex = await getByRequest(ctx.request_id); if (ex) return { review: ex, created: false };
    const t = now();
    try {
      await P(`INSERT INTO pir_reviews (request_id, site_id, category, sub_category, occurred_on, decisions, window_days, commitment_ids, author_id, author, created_at, updated_at, version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(ctx.request_id, ctx.site_id, ctx.category, ctx.sub_category, ctx.occurred_on,
        str((d || {}).decisions), windowDays((d || {}).window_days), JSON.stringify(ids((d || {}).commitment_ids)), user && user.id != null ? Number(user.id) : null,
        user ? String(user.username || user.full_name || user.id) : null, t, t);
    } catch (e) { if (e && e.code === '23505') return { review: await getByRequest(ctx.request_id), created: false }; throw e; }
    return { review: await getByRequest(ctx.request_id), created: true };
  }
  async function update(id, d, { expectedVersion } = {}) {
    const r = await get(id); if (!r) throw typed('NOT_FOUND', 'review not found', 404);
    if (r.signed) throw typed('VALIDATION', 'a signed-off review is read-only', 400);
    if (expectedVersion == null || Number(expectedVersion) !== r.version) throw typed('CONFLICT', `stale version (current ${r.version})`, 409);
    const sets = {}; d = d || {};
    if ('decisions' in d) sets.decisions = str(d.decisions);
    if ('window_days' in d) sets.window_days = windowDays(d.window_days);
    if ('commitment_ids' in d) sets.commitment_ids = JSON.stringify(ids(d.commitment_ids));
    const keys = Object.keys(sets); if (!keys.length) throw typed('VALIDATION', 'nothing to update', 400);
    const res = await P(`UPDATE pir_reviews SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=?, version=version+1 WHERE id=? AND version=?`)
      .run(...keys.map((k) => sets[k]), now(), r.id, r.version);
    if (!res || Number(res.changes) !== 1) throw typed('CONFLICT', 'the review changed meanwhile — reload', 409);
    return get(r.id);
  }
  /** Sign-off by a person who is NOT the author. Freezes the counts measured at that moment. */
  async function signOff(id, user, { note, counts, expectedVersion } = {}) {
    const r = await get(id); if (!r) throw typed('NOT_FOUND', 'review not found', 404);
    if (r.signed) throw typed('VALIDATION', 'already signed off', 400);
    if (!user || user.id == null) throw typed('FORBIDDEN', 'a signed-in person is required', 403);
    if (r.author_id != null && Number(user.id) === r.author_id) { const e = typed('FORBIDDEN', 'the author cannot sign off their own review (SELF_REVIEW)', 403); e.reason = 'SELF_REVIEW'; throw e; }
    if (!str(r.decisions)) throw typed('VALIDATION', 'record the decisions before the sign-off', 400);
    if (expectedVersion == null || Number(expectedVersion) !== r.version) throw typed('CONFLICT', `stale version (current ${r.version})`, 409);
    const c = counts || {}; const t = now();
    const res = await P(`UPDATE pir_reviews SET signed_off_by=?, signed_off_name=?, signed_off_at=?, signoff_note=?, before_count=?, after_count=?, counted_at=?, updated_at=?, version=version+1
      WHERE id=? AND version=? AND signed_off_at IS NULL`).run(Number(user.id), String(user.username || user.full_name || user.id), t, str(note, 1000),
      c.before == null ? null : Number(c.before), c.after == null ? null : Number(c.after), t, t, r.id, r.version);
    if (!res || Number(res.changes) !== 1) throw typed('CONFLICT', 'the review changed meanwhile — reload', 409);
    return get(r.id);
  }
  return { get, getByRequest, list, create, update, signOff };
}

module.exports = { makePirStore, windows, countWindows, windowDays, incidentContext, sameKindIncidents };
