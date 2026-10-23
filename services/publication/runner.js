'use strict';
// Step 9 — SCHEDULED PUBLICATIONS: push figures and approved reports to the places people already read — a Teams
// channel (card), a webhook (signed JSON), an e-mail (the latest APPROVED report), an Excel workbook by e-mail. The
// job publication.run checks every 15 minutes which publication is due. Nothing is pushed until a super_admin enables
// it; a failure is recorded on the publication, never thrown.
//
// schedule = { freq: 'daily'|'weekly'|'monthly', hour: 0-23, weekday: 1-7 (weekly), day: 1-28 (monthly) }, UTC.

const sql = require('../sqlStore');
const handle = () => sql.handle('021_engagement_reports_publication.sql');
const { now, newId, parse } = sql;
const KINDS = ['teams', 'webhook', 'email', 'excel'];

function validate(b, { channelIds, servedMetrics, templateIds } = {}) {
  const errors = [];
  const p = { title: String(b.title || '').trim().slice(0, 120), kind: KINDS.includes(b.kind) ? b.kind : null };
  if (!p.title || /[<>]/.test(p.title)) errors.push('title: empty or HTML');
  if (!p.kind) errors.push('kind: one of ' + KINDS.join(', '));
  const s = b.schedule || {};
  p.schedule = { freq: ['daily', 'weekly', 'monthly'].includes(s.freq) ? s.freq : 'monthly', hour: Math.max(0, Math.min(23, Math.round(Number(s.hour)) || 7)),
    weekday: Math.max(1, Math.min(7, Math.round(Number(s.weekday)) || 1)), day: Math.max(1, Math.min(28, Math.round(Number(s.day)) || 2)) };
  p.channel_id = b.channel_id ? String(b.channel_id) : null;
  if ((p.kind === 'teams' || p.kind === 'webhook') && (!p.channel_id || (channelIds && !channelIds.has(p.channel_id)))) errors.push('channel_id: a configured channel');
  p.recipients = String(b.recipients || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 50);
  if ((p.kind === 'email' || p.kind === 'excel') && !p.recipients.length) errors.push('recipients: at least one e-mail address');
  if (p.recipients.some(x => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x))) errors.push('recipients: invalid address');
  const w = b.what || {};
  p.what = { metrics: (Array.isArray(w.metrics) ? w.metrics : []).map(String).slice(0, 12), scope: String(w.scope || 'GROUP').toUpperCase(), template_id: w.template_id ? String(w.template_id) : null };
  if (servedMetrics) for (const k of p.what.metrics) if (!servedMetrics.has(k)) errors.push(`what.metrics: ${k} is not a served key`);
  if (p.kind === 'email' && !p.what.template_id) errors.push('what.template_id: the report template whose latest approved report is sent');
  if (p.what.template_id && templateIds && !templateIds.has(p.what.template_id)) errors.push('what.template_id: unknown template');
  if ((p.kind === 'teams' || p.kind === 'webhook' || p.kind === 'excel') && !p.what.metrics.length) errors.push('what.metrics: at least one indicator');
  p.enabled = !!b.enabled;
  return { ok: !errors.length, errors, publication: p };
}

function row(r) {
  if (!r) return null;
  const what = parse(r.what_json, {});
  return { id: r.id, title: r.title, kind: r.kind, channel_id: r.channel_id, recipients: String(r.recipients || '').split(',').filter(Boolean), what: what.what || what, schedule: what.schedule || { freq: 'monthly', hour: 7, day: 2 },
    enabled: Number(r.enabled) === 1, last_run_at: r.last_run_at, last_status: r.last_status, created_by: r.created_by, created_at: r.created_at };
}
async function list() { const { H } = handle(); return (await H.prepare(`SELECT * FROM pb_publications ORDER BY title`).all()).map(row); }
async function get(id) { const { H } = handle(); return row(await H.prepare(`SELECT * FROM pb_publications WHERE id = ?`).get(id)); }
async function save(id, p, by) {
  const { H } = handle();
  const what = JSON.stringify({ what: p.what, schedule: p.schedule });
  if (id) {
    await H.prepare(`UPDATE pb_publications SET title = ?, kind = ?, channel_id = ?, recipients = ?, what_json = ?, cron = ?, enabled = ? WHERE id = ?`)
      .run(p.title, p.kind, p.channel_id, p.recipients.join(','), what, JSON.stringify(p.schedule), p.enabled ? 1 : 0, id);
    return get(id);
  }
  const nid = newId('PUB');
  await H.prepare(`INSERT INTO pb_publications (id, title, kind, channel_id, recipients, what_json, cron, enabled, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(nid, p.title, p.kind, p.channel_id, p.recipients.join(','), what, JSON.stringify(p.schedule), p.enabled ? 1 : 0, by || null, now());
  return get(nid);
}
async function remove(id) { const { H } = handle(); await H.prepare(`DELETE FROM pb_publications WHERE id = ?`).run(id); }
async function mark(id, status) { const { H } = handle(); await H.prepare(`UPDATE pb_publications SET last_run_at = ?, last_status = ? WHERE id = ?`).run(now(), String(status).slice(0, 300), id); }

/** The last scheduled instant at or before `nowDate` (UTC). */
function lastSlot(s, nowDate) {
  const d = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate(), s.hour));
  if (s.freq === 'daily') { if (d > nowDate) d.setUTCDate(d.getUTCDate() - 1); return d; }
  if (s.freq === 'weekly') {
    const wd = ((d.getUTCDay() + 6) % 7) + 1;
    d.setUTCDate(d.getUTCDate() - ((wd - s.weekday + 7) % 7));
    if (d > nowDate) d.setUTCDate(d.getUTCDate() - 7);
    return d;
  }
  const m = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), s.day, s.hour));
  if (m > nowDate) m.setUTCMonth(m.getUTCMonth() - 1);
  return m;
}
function isDue(p, nowDate = new Date()) {
  if (!p.enabled) return false;
  const slot = lastSlot(p.schedule, nowDate);
  return !p.last_run_at || Date.parse(p.last_run_at) < slot.getTime();
}

/**
 * Execute one publication. deps = { snapshotRead, metricsLabel(key), mailer, post(channelId, payload), latestApprovedHtml(templateId), baseUrl }
 */
async function execute(p, deps, nowDate = new Date()) {
  const month = nowDate.toISOString().slice(0, 7);
  const prevMonth = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const figures = [];
  for (const key of p.what.metrics || []) {
    const rows = await deps.snapshotRead({ key, scope: p.what.scope, from: prevMonth, to: month });
    const cur = rows.find(r => r.month === month) || rows.find(r => r.month === prevMonth);
    figures.push({ key, label: deps.metricsLabel(key), month: cur ? cur.month : null, value: cur && cur.value != null ? Number(cur.value) : null, unit: cur ? cur.unit : null, rag: cur ? cur.rag : null });
  }
  let r;
  if (p.kind === 'teams') {
    const text = figures.map(f => `• ${f.label} : ${f.value == null ? 'non mesuré' : (Math.round(f.value * 10) / 10) + (f.unit === '%' ? ' %' : '')}${f.rag === 'red' ? ' (hors objectif)' : f.rag === 'amber' ? ' (à surveiller)' : ''}`).join('\n\n');
    r = await deps.post(p.channel_id, require('../engagement/engine').teamsCard(p.title + (p.what.scope !== 'GROUP' ? ' — ' + p.what.scope : ''), text, deps.baseUrl ? deps.baseUrl + '/dashboard.html' : null));
  } else if (p.kind === 'webhook') {
    r = await deps.post(p.channel_id, { publication: p.id, title: p.title, scope: p.what.scope, generated_at: nowDate.toISOString(), figures });
  } else if (p.kind === 'email') {
    if (!deps.mailer) return { ok: false, error: 'e-mail is not configured' };
    const html = await deps.latestApprovedHtml(p.what.template_id);
    if (!html) return { ok: false, error: 'no approved report for this template yet' };
    r = await deps.mailer.send({ to: p.recipients.join(', '), subject: p.title, html });
  } else if (p.kind === 'excel') {
    if (!deps.mailer) return { ok: false, error: 'e-mail is not configured' };
    const XLSX = require('xlsx');
    const all = [];
    for (const key of p.what.metrics) for (const x of await deps.snapshotRead({ key, scope: p.what.scope })) all.push({ Indicateur: deps.metricsLabel(key), Clé: key, Périmètre: x.scope, Mois: x.month, Valeur: x.value == null ? null : Number(x.value), Unité: x.unit, État: x.rag });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(all), 'Indicateurs');
    r = await deps.mailer.send({ to: p.recipients.join(', '), subject: p.title, html: `<p>${all.length} valeur(s) en pièce jointe.</p>`,
      attachments: [{ filename: `indicateurs-${month}.xlsx`, content: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) }] });
  }
  return r && r.ok ? { ok: true } : { ok: false, error: (r && r.error) || 'not sent' };
}

/** Every due publication (the scheduled job). */
async function runDue(deps, nowDate = new Date()) {
  const out = [];
  for (const p of await list()) {
    if (!isDue(p, nowDate)) continue;
    const r = await execute(p, deps, nowDate);
    await mark(p.id, r.ok ? 'ok' : 'failed: ' + r.error);
    out.push({ id: p.id, ok: r.ok, error: r.error });
  }
  if (out.some(x => !x.ok)) return { error: `${out.filter(x => !x.ok).length} publication(s) failed`, publications: out };
  return { published: out.length };
}

module.exports = { validate, list, get, save, remove, mark, lastSlot, isDue, execute, runDue, KINDS };
