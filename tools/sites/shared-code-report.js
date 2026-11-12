'use strict';
// E-D01 (expert audit 2026-11-05, audit D-01 prep / X-DATA-01) — READ-ONLY split report for module codes that
// two or more ACTIVE sites share (Assafo + Tanda → tracker TND, AM-01). Once the data owner gives the code to
// one site, the other site's history stays under the wrong scope; this report tells the owner, for every stored
// row under a shared code, who wrote it and whether that writer's site(s) make the row attributable to one site.
//
//   node tools/sites/shared-code-report.js              prints the markdown report (stdout)
//   node tools/sites/shared-code-report.js --out=FILE   writes it to FILE instead
//
// Nothing is written to the database and nothing is re-attributed: the split itself is a data-owner decision
// (human gate 9). Run it on the operator's box; production data never leaves it. Writers are named by account
// id only (no user names in the file) — the owner looks the id up in Admin ▸ Users.
//
// Writer per table:   tracker_entries.updated_by (engine trackers; falls back to the last `tracker_entries_saved`
//   system_log actor of that tracker) · md_meetings.created_by · insp_inspections.created_by ·
//   tracker_inputs_v2 (legacy activity tracker): no writer recorded → always UNKNOWN.
const path = require('path');
const { sharedAmong } = require('../../services/siteCodeShared');

const MODULES = ['tracker', 'meetings', 'inspection'];

/** The code functions the save routes use (same as routes/policies.js effectiveMaps), sites rows in. */
function defaultCodeOf() {
  return {
    tracker: (s) => require('../../tracker-db').siteToCode(s),
    inspection: (s) => require('../../inspection-db').siteNameToCode(s && s.name),
    meetings: (s) => require('../../inspection-db').siteNameToCode(s && s.name),
  };
}

const ph = (n) => Array.from({ length: n }, () => '?').join(',');

/**
 * Read every input of the report through `q(sql, params) → rows` (`?` placeholders). Pure reads only.
 * `codeOf` = { tracker, meetings, inspection } site-row → code.
 */
async function collect(q, { codeOf = defaultCodeOf() } = {}) {
  const sites = (await q('SELECT id, name, zoho_group, active FROM sites WHERE COALESCE(active,1) = 1 ORDER BY id', [])) || [];
  const users = (await q('SELECT id, site_id FROM users', [])) || [];
  let extra = []; try { extra = (await q('SELECT user_id, site_id FROM user_sites', [])) || []; } catch (_) { extra = []; }
  const shared = {}; const rows = {};
  for (const mod of MODULES) {
    const all = [...new Set(sites.map((s) => { try { return codeOf[mod](s); } catch (_) { return null; } }).filter(Boolean).map(String))];
    shared[mod] = sharedAmong(sites, all, codeOf[mod]);
    rows[mod] = [];
    const codes = shared[mod].map((x) => x.code); if (!codes.length) continue;
    const safe = async (sql, p) => { try { return (await q(sql, p)) || []; } catch (_) { return null; } };
    if (mod === 'tracker') {
      const legacy = await safe(`SELECT i.site AS code, i.year, i.activity_id, a.name AS activity, COUNT(*) AS n
                                   FROM tracker_inputs_v2 i LEFT JOIN tracker_activities a ON a.id = i.activity_id
                                  WHERE i.site IN (${ph(codes.length)}) GROUP BY i.site, i.year, i.activity_id, a.name ORDER BY i.site, i.year, i.activity_id`, codes);
      for (const r of legacy || []) rows.tracker.push({ code: r.code, table: 'tracker_inputs_v2', label: `${r.year} · ${r.activity || 'activity #' + r.activity_id}`, n: Number(r.n), writer_id: null, writer_note: 'no writer recorded on this table' });
      const eng = await safe(`SELECT unit_code AS code, key, item_code, updated_by, COUNT(*) AS n, MAX(updated_at) AS last_at
                                FROM tracker_entries WHERE unit_code IN (${ph(codes.length)})
                               GROUP BY unit_code, key, item_code, updated_by ORDER BY unit_code, key, item_code`, codes);
      for (const r of eng || []) {
        let w = r.updated_by == null ? null : Number(r.updated_by); let note = null;
        if (w == null) {
          const last = await safe("SELECT actor_id FROM system_log WHERE action = 'tracker_entries_saved' AND target = ? ORDER BY id DESC LIMIT 1", [r.key]);
          if (last && last[0] && last[0].actor_id != null) { w = Number(last[0].actor_id); note = 'last tracker_entries_saved actor (row has no writer)'; }
        }
        rows.tracker.push({ code: r.code, table: 'tracker_entries', label: `${r.key} · ${r.item_code}`, n: Number(r.n), writer_id: w, writer_note: note });
      }
    } else {
      const t = mod === 'meetings' ? { table: 'md_meetings', date: 'meeting_date', label: 'department' } : { table: 'insp_inspections', date: 'inspection_date', label: 'inspection_type' };
      const got = await safe(`SELECT site_code AS code, ${t.label} AS label, substr(CAST(${t.date} AS TEXT),1,7) AS month, created_by, COUNT(*) AS n
                                FROM ${t.table} WHERE site_code IN (${ph(codes.length)})
                               GROUP BY site_code, ${t.label}, substr(CAST(${t.date} AS TEXT),1,7), created_by ORDER BY site_code, month`, codes);
      for (const r of got || []) rows[mod].push({ code: r.code, table: t.table, label: `${r.month || '—'} · ${r.label || '—'}`, n: Number(r.n), writer_id: r.created_by == null ? null : Number(r.created_by), writer_note: null });
    }
  }
  return { sites, users, extra, shared, rows };
}

/** Pure: attach an attribution to every row group. Nothing is decided — "unknown" when the writer is not one site. */
function buildReport({ sites, users, extra = [], shared, rows }) {
  const siteById = new Map((sites || []).map((s) => [Number(s.id), s]));
  const siteByName = new Map((sites || []).map((s) => [s.name, s]));
  const userSites = new Map();
  for (const u of users || []) userSites.set(Number(u.id), new Set(u.site_id == null ? [] : [Number(u.site_id)]));
  for (const e of extra || []) { const k = Number(e.user_id); if (!userSites.has(k)) continue; userSites.get(k).add(Number(e.site_id)); }
  const out = [];
  for (const mod of MODULES) for (const sh of (shared && shared[mod]) || []) {
    const sharing = sh.sites.map((n) => siteByName.get(n)).filter(Boolean);
    const ids = new Set(sharing.map((s) => Number(s.id)));
    const groups = ((rows && rows[mod]) || []).filter((r) => String(r.code) === String(sh.code)).map((r) => {
      let attributed = null; let reason;
      if (r.writer_id == null) reason = r.writer_note || 'no writer recorded';
      else if (!userSites.has(r.writer_id)) reason = 'writer account not found';
      else {
        const ws = [...userSites.get(r.writer_id)];
        const inter = ws.filter((x) => ids.has(x));
        if (inter.length === 1) { attributed = siteById.get(inter[0]).name; reason = r.writer_note || 'writer belongs to this site only'; }
        else if (inter.length > 1) reason = 'writer belongs to several of the sharing sites';
        else reason = ws.length ? 'writer belongs to none of the sharing sites' : 'writer has no site (central account)';
      }
      return { table: r.table, label: r.label, rows: r.n, writer_id: r.writer_id, writer_sites: r.writer_id != null && userSites.has(r.writer_id) ? [...userSites.get(r.writer_id)].map((x) => (siteById.get(x) || { name: '#' + x }).name) : [], attributed, reason };
    });
    const tally = {}; let unknown = 0;
    for (const g of groups) { if (g.attributed) tally[g.attributed] = (tally[g.attributed] || 0) + g.rows; else unknown += g.rows; }
    out.push({ module: mod, code: sh.code, sites: sh.sites, groups, attributed_rows: tally, unknown_rows: unknown });
  }
  return { codes: out };
}

const cell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
function toMarkdown(report, { at = new Date().toISOString() } = {}) {
  const L = ['# Shared site codes — split report (read-only)', '',
    `Generated ${at}. Nothing was written and nothing was re-attributed. Which site owns a shared code, and how its`,
    'history is split, is a data-owner decision (human gate 9). Writers are account ids (Admin ▸ Users).', ''];
  if (!report.codes.length) { L.push('No module code is shared by two active sites.'); return L.join('\n') + '\n'; }
  for (const c of report.codes) {
    L.push(`## ${c.module} code \`${c.code}\` — shared by ${c.sites.join(', ')}`, '');
    const parts = Object.entries(c.attributed_rows).map(([s, n]) => `${n} attributable to ${s}`);
    L.push(`Rows: ${parts.length ? parts.join(' · ') + ' · ' : ''}${c.unknown_rows} unknown.`, '');
    if (!c.groups.length) { L.push('No stored row under this code.', ''); continue; }
    L.push('| Table | Rows of | Count | Writer (account id) | Writer site(s) | Attribution | Why |', '|---|---|---|---|---|---|---|');
    for (const g of c.groups) L.push(`| ${cell(g.table)} | ${cell(g.label)} | ${g.rows} | ${g.writer_id == null ? '—' : '#' + g.writer_id} | ${cell(g.writer_sites.join(', ') || '—')} | ${g.attributed ? 'site ' + cell(g.attributed) : 'unknown'} | ${cell(g.reason)} |`);
    L.push('');
  }
  return L.join('\n') + '\n';
}

async function main() {
  require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '..', '.env') });
  if (!process.env.PG_URL) { console.error('PG_URL is not set (.env) — nothing to read.'); process.exitCode = 1; return; }
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.PG_URL }); await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const q = async (sql, params) => { let i = 0; return (await c.query(sql.replace(/\?/g, () => '$' + (++i)), params)).rows; };
    const md = toMarkdown(buildReport(await collect(q)));
    await c.query('ROLLBACK');
    const out = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);
    if (out) { require('fs').writeFileSync(out, md); console.log('written', out); } else process.stdout.write(md);
  } finally { await c.end(); }
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { collect, buildReport, toMarkdown, MODULES };
