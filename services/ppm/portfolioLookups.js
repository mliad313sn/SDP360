'use strict';
// PORTFOLIO LOT 1 (spec §19) — the portfolio reference lists (project types, priorities, budget statuses, project
// statuses, decision values, delivery effort, risk exposure, schedule confidence), table ppm_lookup_values
// (migration 114). Read and written only while report_config ppm_intake_register_enabled = '1' (the routes answer 404
// otherwise). Pure rules first (validateValue, FIELD_DOMAIN), then a small store over a pgDb-shaped handle.
//
// Rules:
//   - a value is NEVER physically deleted: it is retired (active = 0) so a project carrying it keeps its label;
//   - `code` is the stored value and never changes; labels, colour, order, default and description are editable;
//   - LOCKED domains mirror codes the application reads (project status, decision Yes/No/TBC, schedule confidence):
//     relabel / recolour / reorder only — no new code, no retirement;
//   - colour = a brand token name (public/_tokens.css), never a raw colour value;
//   - proposed = 1 marks a value whose meaning is business policy that nobody approved yet (priority meaning, risk
//     levels, effort bands). Only a person changes that mark; nothing here claims an approval.

const DOMAINS = ['project_type', 'priority', 'budget_status', 'project_status', 'decision_required', 'delivery_effort', 'risk_exposure', 'schedule_confidence'];
const LOCKED = ['project_status', 'decision_required', 'schedule_confidence'];
const COLORS = ['slate', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'grey'];
/** Project column → the reference list its value comes from. */
const FIELD_DOMAIN = { project_type: 'project_type', priority: 'priority', budget_status: 'budget_status', decision_required: 'decision_required', delivery_effort: 'delivery_effort', risk_exposure: 'risk_exposure', schedule_confidence: 'schedule_confidence', status: 'project_status' };

const bad = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', status: 400, reason: reason || 'LOOKUP_INVALID', expose: true });
const clean = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

/**
 * The fields a create / update may carry, checked. `existing` = the stored row (update) or null (create).
 * Returns the normalised patch. Throws INVALID with a reason the page can show.
 */
function validateValue(domain, body, existing = null) {
  if (!DOMAINS.includes(domain)) throw bad('unknown reference list', 'LOOKUP_DOMAIN');
  const b = body || {};
  const out = {};
  if (!existing) {
    if (LOCKED.includes(domain)) throw bad('this list mirrors codes the application reads: rename or reorder its values, do not add new ones', 'LOOKUP_LOCKED');
    const code = clean(b.code, 40);
    if (!code || !/^[a-z0-9][a-z0-9_]{0,39}$/.test(code)) throw bad('the code is lower-case letters, digits and _ (40 characters at most); it never changes once created', 'LOOKUP_CODE');
    out.code = code;
  } else if (b.code !== undefined && String(b.code) !== String(existing.code)) throw bad('the code of a value never changes — retire it and create a new one', 'LOOKUP_CODE_IMMUTABLE');
  for (const k of ['label_en', 'label_fr']) {
    if (b[k] !== undefined || !existing) {
      const v = clean(b[k], 80);
      if (!v) throw bad('an English and a French label are required', 'LOOKUP_LABEL');
      out[k] = v;
    }
  }
  for (const k of ['description_en', 'description_fr']) if (b[k] !== undefined) out[k] = clean(b[k], 600);
  if (b.color !== undefined) {
    const c = b.color == null || b.color === '' ? null : String(b.color).trim();
    if (c != null && !COLORS.includes(c)) throw bad('colour is one of ' + COLORS.join(', '), 'LOOKUP_COLOR');
    out.color = c;
  }
  if (b.sort_order !== undefined) {
    const n = Number(b.sort_order);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw bad('order is a whole number from 0', 'LOOKUP_ORDER');
    out.sort_order = n;
  }
  if (b.is_default !== undefined) out.is_default = b.is_default === true || Number(b.is_default) === 1 ? 1 : 0;
  if (b.proposed !== undefined) out.proposed = b.proposed === true || Number(b.proposed) === 1 ? 1 : 0;
  return out;
}

const row = (r) => r && ({ ...r, id: Number(r.id), sort_order: Number(r.sort_order), is_default: Number(r.is_default) === 1, proposed: Number(r.proposed) === 1, active: Number(r.active) === 1, retired_by: r.retired_by == null ? null : Number(r.retired_by) });

function makeLookupStore(db, { now = () => new Date().toISOString() } = {}) {
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (typeof db.runTransaction === 'function' ? db.runTransaction(fn) : fn());
  const who = (u) => (u ? String(u.username || u.full_name || '') || null : null);

  async function list({ includeRetired = false } = {}) {
    return (await P(`SELECT * FROM ppm_lookup_values${includeRetired ? '' : ' WHERE active = 1'} ORDER BY domain, sort_order, code`).all()).map(row);
  }
  /** { domain: [values] } — active only unless includeRetired. */
  async function byDomain(opts = {}) {
    const out = Object.fromEntries(DOMAINS.map((d) => [d, []]));
    for (const v of await list(opts)) if (out[v.domain]) out[v.domain].push(v);
    return out;
  }
  /** { domain: Set(active codes) } — what a project write may newly set. */
  async function activeCodes() {
    const out = Object.fromEntries(DOMAINS.map((d) => [d, new Set()]));
    for (const v of await list()) if (out[v.domain]) out[v.domain].add(v.code);
    return out;
  }
  async function get(domain, code) { return row(await P('SELECT * FROM ppm_lookup_values WHERE domain=? AND code=?').get(String(domain), String(code))); }
  /** Live projects carrying the value (the admin sees why a value cannot be removed — it is retired instead). */
  async function referencedCount(domain, code) {
    const col = Object.keys(FIELD_DOMAIN).find((f) => FIELD_DOMAIN[f] === domain);
    if (!col) return 0;
    const r = await P(`SELECT COUNT(*) AS n FROM portfolio_projects WHERE deleted_at IS NULL AND ${col} = ?`).get(String(code));
    return Number((r && r.n) || 0);
  }
  async function _clearOtherDefaults(domain, code) { await P('UPDATE ppm_lookup_values SET is_default = 0 WHERE domain = ? AND code <> ? AND is_default = 1').run(domain, code); }
  /** Create (no `existing`) or update one value. Returns the stored row. */
  async function save(domain, body, { user } = {}) {
    const code = body && body.code != null ? String(body.code).trim() : '';
    const existing = code ? await get(domain, code) : null;
    const patch = validateValue(domain, body, existing);
    return tx(async () => {
      if (patch.is_default === 1) await _clearOtherDefaults(domain, existing ? existing.code : patch.code);
      if (existing) {
        if (patch.is_default === 1 && !existing.active) throw bad('a retired value cannot be the default — restore it first', 'LOOKUP_RETIRED_DEFAULT');
        const keys = Object.keys(patch);
        if (keys.length) await P(`UPDATE ppm_lookup_values SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=?, updated_by=? WHERE id=?`).run(...keys.map((k) => patch[k]), now(), who(user), existing.id);
        return get(domain, existing.code);
      }
      const cols = ['domain', ...Object.keys(patch), 'updated_at', 'updated_by'];
      await P(`INSERT INTO ppm_lookup_values (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(domain, ...Object.values(patch), now(), who(user));
      return get(domain, patch.code);
    });
  }
  /** Soft retire: hidden from new choices, kept for every project that already carries it. */
  async function retire(domain, code, { user } = {}) {
    if (!DOMAINS.includes(domain)) throw bad('unknown reference list', 'LOOKUP_DOMAIN');
    if (LOCKED.includes(domain)) throw bad('this list mirrors codes the application reads: its values cannot be retired', 'LOOKUP_LOCKED');
    const v = await get(domain, code);
    if (!v) throw Object.assign(new Error('value not found'), { code: 'NOT_FOUND', status: 404, expose: true });
    if (v.active) await P('UPDATE ppm_lookup_values SET active = 0, is_default = 0, retired_at = ?, retired_by = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(now(), user && user.id != null ? Number(user.id) : null, now(), who(user), v.id);
    return { value: await get(domain, code), referenced_by: await referencedCount(domain, code) };
  }
  async function restore(domain, code, { user } = {}) {
    if (!DOMAINS.includes(domain)) throw bad('unknown reference list', 'LOOKUP_DOMAIN');
    const v = await get(domain, code);
    if (!v) throw Object.assign(new Error('value not found'), { code: 'NOT_FOUND', status: 404, expose: true });
    if (!v.active) await P('UPDATE ppm_lookup_values SET active = 1, retired_at = NULL, retired_by = NULL, updated_at = ?, updated_by = ? WHERE id = ?').run(now(), who(user), v.id);
    return get(domain, code);
  }
  /** New display order: `codes` lists the values of the domain in their new order (others keep theirs, after). */
  async function reorder(domain, codes, { user } = {}) {
    if (!DOMAINS.includes(domain)) throw bad('unknown reference list', 'LOOKUP_DOMAIN');
    if (!Array.isArray(codes) || !codes.length || codes.length > 200) throw bad('codes is the list of values in their new order', 'LOOKUP_ORDER');
    const known = new Set((await P('SELECT code FROM ppm_lookup_values WHERE domain = ?').all(domain)).map((r) => r.code));
    const uniq = [...new Set(codes.map(String))];
    if (uniq.length !== codes.length || uniq.some((c) => !known.has(c))) throw bad('every code must exist in this list, once', 'LOOKUP_ORDER');
    return tx(async () => {
      for (const [i, c] of uniq.entries()) await P('UPDATE ppm_lookup_values SET sort_order = ?, updated_at = ?, updated_by = ? WHERE domain = ? AND code = ?').run((i + 1) * 10, now(), who(user), domain, c);
      return (await byDomain({ includeRetired: true }))[domain];
    });
  }
  return { list, byDomain, activeCodes, get, referencedCount, save, retire, restore, reorder };
}

module.exports = { DOMAINS, LOCKED, COLORS, FIELD_DOMAIN, validateValue, makeLookupStore };
