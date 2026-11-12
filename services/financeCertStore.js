'use strict';
// A1 — Finance certification store (migration 094). PostgreSQL only. Every act is written twice in ONE
// transaction: the certification row (current status) and an append-only, hash-chained event
// (finance_certification_events, verified nightly by services/auditChain.js). No row is ever deleted.
function makeFinanceCertStore(H) {
  const P = (sql) => H.prepare(sql);
  const tx = (fn) => (typeof H.runTransaction === 'function' ? H.runTransaction(fn) : fn());
  const now = () => new Date().toISOString();
  const who = (u) => (u ? String(u.full_name || u.username || u.id) : null);
  const row = (r) => r && ({ ...r, id: Number(r.id), certified_by: r.certified_by == null ? null : Number(r.certified_by), revoked_by: r.revoked_by == null ? null : Number(r.revoked_by) });
  const event = (c, ev, user, note) => P(`INSERT INTO finance_certification_events (certification_id, event, scope, scope_key, period, figures_hash, actor_id, actor_name, at, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(Number(c.id), ev, c.scope, c.scope_key, c.period, c.figures_hash, user && user.id != null ? Number(user.id) : null, who(user), now(), note || null);

  async function active(scope, scopeKey, period) {
    return row(await P(`SELECT * FROM finance_certifications WHERE scope=? AND scope_key=? AND period=? AND status='verified'`).get(scope, scopeKey, period));
  }
  /** The latest verified certification of a scope/key, any period (asset pages show "certified for <period>"). */
  async function latestActive(scope, scopeKey) {
    return row(await P(`SELECT * FROM finance_certifications WHERE scope=? AND scope_key=? AND status='verified' ORDER BY period DESC, id DESC LIMIT 1`).get(scope, scopeKey));
  }
  async function get(id) { return row(await P('SELECT * FROM finance_certifications WHERE id=?').get(Number(id))); }
  async function list({ scope, scope_key, period, status, limit = 500 } = {}) {
    const c = [], p = [];
    if (scope) { c.push('scope = ?'); p.push(scope); }
    if (scope_key) { c.push('scope_key = ?'); p.push(scope_key); }
    if (period) { c.push('period = ?'); p.push(period); }
    if (status) { c.push('status = ?'); p.push(status); }
    return (await P(`SELECT * FROM finance_certifications ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.max(1, Math.min(5000, Number(limit) || 500))}`).all(...p)).map(row);
  }
  async function events({ limit = 2000 } = {}) {
    return P(`SELECT id, certification_id, event, scope, scope_key, period, figures_hash, actor_id, actor_name, at, note FROM finance_certification_events ORDER BY id DESC LIMIT ${Math.max(1, Math.min(10000, Number(limit) || 2000))}`).all();
  }
  /** Certify (supersedes the current verified row of the same target, if any). */
  async function certify(t, { hash, summary, user }) {
    return tx(async () => {
      const prev = await active(t.scope, t.scope_key, t.period);
      if (prev) {
        await P(`UPDATE finance_certifications SET status='superseded' WHERE id=?`).run(prev.id);
        await event(prev, 'superseded', user, 're-certified');
      }
      const ins = await P(`INSERT INTO finance_certifications (scope, scope_key, period, figures_hash, figures_summary, evidence, evidence_link, source, status, certified_by, certified_by_name, certified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?) RETURNING id`).get(t.scope, t.scope_key, t.period, hash, summary == null ? null : JSON.stringify(summary),
        String(t.evidence).trim(), t.evidence_link ? String(t.evidence_link).trim() : null, String(t.source).trim(), Number(user.id), who(user), now());
      const c = await get(ins.id);
      await event(c, 'certified', user, String(t.source).trim());
      return c;
    });
  }
  async function revoke(id, { reason, user }) {
    return tx(async () => {
      const c = await get(id);
      if (!c) throw Object.assign(new Error('certification not found'), { code: 'NOT_FOUND', status: 404, expose: true });
      if (c.status !== 'verified') throw Object.assign(new Error('only a current certification can be revoked'), { code: 'CONFLICT', status: 409, expose: true });
      await P(`UPDATE finance_certifications SET status='revoked', revoked_by=?, revoked_by_name=?, revoked_at=?, revoke_reason=? WHERE id=?`).run(Number(user.id), who(user), now(), String(reason).trim(), c.id);
      const r = await get(c.id);
      await event(r, 'revoked', user, String(reason).trim());
      return r;
    });
  }
  return { active, latestActive, get, list, events, certify, revoke };
}

/** B8 — dated FX rates, display-currency preferences, import templates and batches (migration 095). */
function makeFxStore(H) {
  const P = (sql) => H.prepare(sql);
  const now = () => new Date().toISOString();
  const who = (u) => (u ? String(u.full_name || u.username || u.id) : null);
  const rate = (r) => r && ({ ...r, id: Number(r.id), rate: Number(r.rate), entered_by: r.entered_by == null ? null : Number(r.entered_by) });
  async function listRates({ includeRetired = true } = {}) {
    return (await P(`SELECT * FROM fx_rates ${includeRetired ? '' : 'WHERE retired_at IS NULL'} ORDER BY currency, effective_from DESC, id DESC`).all()).map(rate);
  }
  async function addRate(r, user) {
    const dup = await P('SELECT id FROM fx_rates WHERE currency=? AND effective_from=? AND retired_at IS NULL').get(r.currency, r.effective_from);
    if (dup) throw Object.assign(new Error(`a ${r.currency} rate already exists from ${r.effective_from} — retire it first (a rate is never edited)`), { code: 'CONFLICT', status: 409, expose: true });
    const ins = await P(`INSERT INTO fx_rates (currency, effective_from, rate, source, entered_by, entered_by_name, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .get(r.currency, r.effective_from, Number(r.rate), String(r.source).trim(), user && user.id != null ? Number(user.id) : null, who(user), now());
    return rate(await P('SELECT * FROM fx_rates WHERE id=?').get(ins.id));
  }
  async function retireRate(id, { reason, user }) {
    const r = await P('SELECT * FROM fx_rates WHERE id=?').get(Number(id));
    if (!r) throw Object.assign(new Error('rate not found'), { code: 'NOT_FOUND', status: 404, expose: true });
    if (r.retired_at) throw Object.assign(new Error('rate already retired'), { code: 'CONFLICT', status: 409, expose: true });
    await P('UPDATE fx_rates SET retired_at=?, retired_by=?, retire_reason=? WHERE id=?').run(now(), user && user.id != null ? Number(user.id) : null, String(reason).trim(), Number(id));
    return rate(await P('SELECT * FROM fx_rates WHERE id=?').get(Number(id)));
  }
  async function getPref(userId) { const r = await P('SELECT display_currency FROM user_finance_prefs WHERE user_id=?').get(Number(userId)); return r ? r.display_currency : null; }
  async function setPref(userId, cur) {
    await P(`INSERT INTO user_finance_prefs (user_id, display_currency, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET display_currency = EXCLUDED.display_currency, updated_at = EXCLUDED.updated_at`).run(Number(userId), cur || null, now());
    return getPref(userId);
  }
  const tpl = (r) => r && ({ id: Number(r.id), name: r.name, mapping: JSON.parse(r.mapping), updated_at: r.updated_at });
  async function listTemplates() { return (await P('SELECT * FROM actuals_import_templates ORDER BY name').all()).map(tpl); }
  async function getTemplate(name) { return tpl(await P('SELECT * FROM actuals_import_templates WHERE name=?').get(String(name))); }
  async function saveTemplate(name, mapping, user) {
    await P(`INSERT INTO actuals_import_templates (name, mapping, updated_by, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (name) DO UPDATE SET mapping = EXCLUDED.mapping, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`).run(String(name), JSON.stringify(mapping), user && user.id != null ? Number(user.id) : null, now());
    return getTemplate(name);
  }
  const batch = (r) => r && ({ ...r, id: Number(r.id), committed_by: r.committed_by == null ? null : Number(r.committed_by), report: JSON.parse(r.report) });
  async function batchByHash(sha) { return batch(await P('SELECT * FROM actuals_import_batches WHERE file_sha256=? ORDER BY id DESC LIMIT 1').get(sha)); }
  async function addBatch(b, user) {
    const ins = await P(`INSERT INTO actuals_import_batches (filename, file_sha256, template_name, rows_total, rows_written, reason, committed_by, committed_by_name, committed_at, report)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(b.filename || null, b.file_sha256, b.template_name || null, b.rows_total, b.rows_written, b.reason || null,
      user && user.id != null ? Number(user.id) : null, who(user), now(), JSON.stringify(b.report));
    return getBatch(ins.id);
  }
  async function getBatch(id) { return batch(await P('SELECT * FROM actuals_import_batches WHERE id=?').get(Number(id))); }
  async function listBatches() { return (await P('SELECT id, filename, file_sha256, template_name, rows_total, rows_written, reason, committed_by_name, committed_at FROM actuals_import_batches ORDER BY id DESC LIMIT 200').all()).map((r) => ({ ...r, id: Number(r.id) })); }
  return { listRates, addRate, retireRate, getPref, setPref, listTemplates, getTemplate, saveTemplate, batchByHash, addBatch, getBatch, listBatches };
}

module.exports = { makeFinanceCertStore, makeFxStore };
