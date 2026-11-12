'use strict';
// E-V08 (audit V-08) — human-entered chart annotations (migration 075). Pure validation + a small store.
//   validate(body)  → { ok, value?, errors[] }  (label ≤ 120, date YYYY-MM-DD, a SOURCE is mandatory:
//                     ticket '#312004' · decision 'CAB-2026-11' · url http(s) without credentials)
//   canWrite(user, siteId, { isAdmin, siteIds })  — editor on one of their sites; admin tier anywhere,
//                     and only the admin tier may write a group-wide (site_id null) note
//   makeStore(db)   → list({ siteIds|null, metric, from, to }), get(id), create(value, actorId), remove(id, actorId)
// Nothing here generates or infers an annotation from data; there is no "cause" field. Rows are soft-deleted.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['ticket', 'decision', 'url'];
const METRIC = /^[a-z0-9_.-]{1,80}$/i;

function _url(s) {
  let u; try { u = new URL(s); } catch (_) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  return u.toString();
}

function validate(body) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = [];
  const label = String(b.label == null ? '' : b.label).replace(/\s+/g, ' ').trim();
  if (!label) errors.push('label is required');
  else if (label.length > 120) errors.push('label must be 120 characters or fewer');
  const at = String(b.at || '').trim();
  if (!DAY.test(at) || isNaN(Date.parse(at + 'T00:00:00Z'))) errors.push('at must be a date YYYY-MM-DD');
  const kind = String(b.source_kind || '').trim();
  let ref = String(b.source_ref == null ? '' : b.source_ref).trim();
  if (!KINDS.includes(kind)) errors.push('source_kind must be ticket, decision or url');
  else if (!ref) errors.push('a source is required (ticket reference, decision reference or link)');
  else if (kind === 'ticket') { if (!/^#?\d{1,12}$/.test(ref)) errors.push('ticket reference must be the ticket number, e.g. #312004'); else ref = '#' + ref.replace(/^#/, ''); }
  else if (kind === 'decision') { if (ref.length < 3 || ref.length > 80 || /[<>]/.test(ref)) errors.push('decision reference must be 3–80 characters, no < >'); }
  else { const u = ref.length <= 500 ? _url(ref) : null; if (!u) errors.push('link must be an http(s) URL without credentials'); else ref = u; }
  let metric = b.metric_key == null || b.metric_key === '' ? null : String(b.metric_key).trim();
  if (metric != null && !METRIC.test(metric)) errors.push('metric_key is not a metric key');
  let site = b.site_id == null || b.site_id === '' ? null : Number(b.site_id);
  if (site != null && (!Number.isInteger(site) || site <= 0)) { errors.push('site_id must be a site id'); site = null; }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], value: { metric_key: metric, site_id: site, at, label, source_kind: kind, source_ref: ref } };
}

function canWrite(user, siteId, { isAdmin, siteIds }) {
  if (isAdmin) return true;
  if (siteId == null) return false;
  return (siteIds || []).map(Number).includes(Number(siteId));
}

function makeStore(db, { now = () => new Date().toISOString() } = {}) {
  const P = (sql) => db.prepare(sql);
  const norm = (r) => (r ? { ...r, id: Number(r.id), site_id: r.site_id == null ? null : Number(r.site_id), author_id: Number(r.author_id) } : null);
  async function list({ siteIds = null, metric = null, from = null, to = null } = {}) {
    const where = ['deleted_at IS NULL']; const args = [];
    if (Array.isArray(siteIds)) {
      const ids = siteIds.map(Number).filter(Number.isInteger);
      where.push(ids.length ? `(site_id IS NULL OR site_id IN (${ids.map(() => '?').join(',')}))` : 'site_id IS NULL');
      args.push(...ids);
    }
    if (metric) { where.push('(metric_key IS NULL OR metric_key = ?)'); args.push(String(metric)); }
    if (from && DAY.test(from)) { where.push('at >= ?'); args.push(from); }
    if (to && DAY.test(to)) { where.push('at <= ?'); args.push(to); }
    const rows = await P(`SELECT id, metric_key, site_id, at, label, source_kind, source_ref, author_id, created_at FROM chart_annotations
      WHERE ${where.join(' AND ')} ORDER BY at, id LIMIT 500`).all(...args);
    return rows.map(norm);
  }
  async function get(id) { return norm(await P('SELECT * FROM chart_annotations WHERE id = ? AND deleted_at IS NULL').get(Number(id))); }
  async function create(v, actorId) {
    const r = await P(`INSERT INTO chart_annotations (metric_key, site_id, at, label, source_kind, source_ref, author_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(v.metric_key, v.site_id, v.at, v.label, v.source_kind, v.source_ref, Number(actorId), now());
    return get(r.id);
  }
  async function remove(id, actorId) {
    await P('UPDATE chart_annotations SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').run(now(), Number(actorId), Number(id));
  }
  return { list, get, create, remove };
}

module.exports = { validate, canWrite, makeStore, KINDS };
