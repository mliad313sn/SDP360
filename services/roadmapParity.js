'use strict';
// B-09 — Roadmap Manager → portfolio single source: the PARITY report.
//
// The personal Roadmap Manager (roadmap_objectives / roadmap_deliverables, public/itsm-roadmap.html) was
// migrated into the portfolio by POST /api/governance/roadmap-migration (programme `itsm-roadmap`, one
// objective `itsm-roadmap-<obj_key>` per roadmap objective, one project `<objective key>-deliverables`
// carrying the deliverables). Before the roadmap page is turned read-only (switch
// `roadmap_redirect_to_portfolio`, default '0') someone has to see, item by item, that the two agree.
// This module compares them. It is PURE (no DB): the loaders below take a `query(sql, params)` function,
// so the read-only CLI (tools/governance/roadmap-parity.js) and the route share one comparison.
//
// It never writes and never deletes: deleting the roadmap rows is a human/CAB step.

const PROGRAMME_KEY = 'itsm-roadmap';

// The value mappings below MIRROR the migration in routes/governance.js (roadmap-migration). They are
// repeated here instead of imported because that route builds them inline; if the migration changes,
// tests/roadmap-parity.test.js pins the strings the migration uses so the two cannot drift silently.
function objectiveStatus(s) { return /red|rouge|orange|amber/i.test(s || '') ? 'at_risk' : 'on_track'; }
function deliverableStatus(s) { return /exec|done|fait/i.test(s || '') ? 'done' : /cours|progress/i.test(s || '') ? 'in_progress' : 'todo'; }
function objectiveKey(objKey) { return `${PROGRAMME_KEY}-${objKey}`; }
function projectKey(objKey) { return `${objectiveKey(objKey)}-deliverables`; }

const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const dateOrNull = (v) => (v ? String(v).slice(0, 10) : null);

/**
 * Compare one user's roadmap with the portfolio.
 * @param {{objectives:object[], deliverables:object[]}} roadmap  raw roadmap_* rows of ONE user
 * @param {{programmes:object[], objectives:object[], projects:object[], deliverables:object[]}} portfolio
 * @returns {{verdict:'not_migrated'|'in_parity'|'drift', programme:object|null, objectives:object[], extra_objectives:string[], counts:object}}
 */
function computeParity(roadmap, portfolio) {
  const rm = roadmap || {}; const pf = portfolio || {};
  const prog = (pf.programmes || []).find((p) => p.key === PROGRAMME_KEY) || null;
  const pObjs = prog ? (pf.objectives || []).filter((o) => Number(o.programme_id) === Number(prog.id)) : [];
  const rObjs = [...(rm.objectives || [])].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  const counts = { roadmap_objectives: rObjs.length, roadmap_deliverables: (rm.deliverables || []).length, portfolio_objectives: pObjs.length, portfolio_deliverables: 0, objectives_missing: 0, objectives_with_diffs: 0, deliverables_missing: 0, deliverables_extra: 0, deliverables_status_diff: 0 };
  const objectives = rObjs.map((o) => {
    const key = objectiveKey(o.obj_key);
    const p = pObjs.find((x) => x.key === key) || null;
    const rDel = (rm.deliverables || []).filter((d) => d.obj_key === o.obj_key);
    const out = { obj_key: o.obj_key, key, name: o.title || o.obj_key, present: !!p, diffs: [], deliverables: { roadmap: rDel.length, portfolio: 0, missing: [], extra: [], status_diff: [] } };
    if (!p) { counts.objectives_missing++; out.deliverables.missing = rDel.map((d) => d.label || ''); counts.deliverables_missing += rDel.length; return out; }
    const cmp = [
      ['name', o.title || o.obj_key, p.name, (a, b) => norm(a) === norm(b)],
      ['weight', numOrNull(o.weight) == null ? 1 : Number(o.weight), numOrNull(p.weight), (a, b) => a === b],
      ['progress_pct', numOrNull(o.progress_pct), numOrNull(p.progress_pct), (a, b) => a === b],
      ['target_date', dateOrNull(o.target_date), dateOrNull(p.target_date), (a, b) => a === b],
      ['status', objectiveStatus(o.status), p.status || null, (a, b) => a === b],
    ];
    for (const [field, a, b, eq] of cmp) if (!eq(a, b)) out.diffs.push({ field, roadmap: a, portfolio: b });
    const prj = (pf.projects || []).find((x) => x.key === projectKey(o.obj_key) && Number(x.objective_id) === Number(p.id)) || null;
    const pDel = prj ? (pf.deliverables || []).filter((d) => Number(d.project_id) === Number(prj.id)) : [];
    out.deliverables.portfolio = pDel.length; counts.portfolio_deliverables += pDel.length;
    const left = [...pDel];
    for (const d of rDel) {
      const i = left.findIndex((x) => norm(x.name) === norm(d.label));
      if (i < 0) { out.deliverables.missing.push(d.label || ''); continue; }
      const m = left.splice(i, 1)[0];
      const want = deliverableStatus(d.status);
      if ((m.status || null) !== want) out.deliverables.status_diff.push({ name: d.label || '', roadmap: want, portfolio: m.status || null });
      const rd = dateOrNull(d.delivery_date); const pd = dateOrNull(m.due_date);
      if (rd !== pd) out.deliverables.status_diff.push({ name: d.label || '', field: 'due_date', roadmap: rd, portfolio: pd });
    }
    out.deliverables.extra = left.map((x) => x.name || '');
    counts.deliverables_missing += out.deliverables.missing.length;
    counts.deliverables_extra += out.deliverables.extra.length;
    counts.deliverables_status_diff += out.deliverables.status_diff.length;
    if (out.diffs.length || out.deliverables.missing.length || out.deliverables.extra.length || out.deliverables.status_diff.length) counts.objectives_with_diffs++;
    return out;
  });
  const known = new Set(rObjs.map((o) => objectiveKey(o.obj_key)));
  const extra_objectives = pObjs.filter((o) => !known.has(o.key)).map((o) => o.key);
  let verdict = 'in_parity';
  if (!prog) verdict = 'not_migrated';
  else if (counts.objectives_missing || counts.objectives_with_diffs || extra_objectives.length) verdict = 'drift';
  return { verdict, programme: prog ? { id: Number(prog.id), key: prog.key, name: prog.name } : null, objectives, extra_objectives, counts };
}

// Read-only loaders. `query(sql, params)` resolves to rows; SQL uses `?` placeholders (pgDb style).
async function loadRoadmapUsers(query) {
  return (await query('SELECT DISTINCT user_id FROM roadmap_objectives ORDER BY user_id', [])).map((r) => Number(r.user_id));
}
async function loadRoadmap(query, userId) {
  const objectives = await query('SELECT obj_key, title, weight, progress_pct, status, confidence, target_date, sort_order, updated_at FROM roadmap_objectives WHERE user_id = ? ORDER BY sort_order, obj_key', [Number(userId)]);
  const deliverables = await query('SELECT uid, obj_key, label, delivery_date, status, sort_order, updated_at FROM roadmap_deliverables WHERE user_id = ? ORDER BY obj_key, sort_order', [Number(userId)]);
  return { objectives, deliverables };
}
async function loadPortfolio(query) {
  const programmes = await query('SELECT id, key, name FROM portfolio_programmes WHERE key = ?', [PROGRAMME_KEY]);
  if (!programmes.length) return { programmes: [], objectives: [], projects: [], deliverables: [] };
  const pid = Number(programmes[0].id);
  const objectives = await query('SELECT id, programme_id, key, name, weight, progress_pct, status, confidence, target_date FROM portfolio_objectives WHERE programme_id = ?', [pid]);
  const projects = await query('SELECT p.id, p.objective_id, p.key, p.name FROM portfolio_projects p JOIN portfolio_objectives o ON o.id = p.objective_id WHERE o.programme_id = ?', [pid]);
  const deliverables = await query('SELECT d.id, d.project_id, d.name, d.due_date, d.status FROM portfolio_deliverables d JOIN portfolio_projects p ON p.id = d.project_id JOIN portfolio_objectives o ON o.id = p.objective_id WHERE o.programme_id = ?', [pid]);
  return { programmes, objectives, projects, deliverables };
}

/** Parity for every user who has a roadmap (or just `userId`). */
async function buildReport(query, { userId = null, now = new Date() } = {}) {
  const users = userId != null ? [Number(userId)] : await loadRoadmapUsers(query);
  const portfolio = await loadPortfolio(query);
  const reports = [];
  for (const u of users) reports.push({ user_id: u, ...computeParity(await loadRoadmap(query, u), portfolio) });
  return { as_of: now.toISOString(), programme_key: PROGRAMME_KEY, users: reports };
}

const VERDICT_TEXT = { not_migrated: 'NOT MIGRATED — the portfolio has no `itsm-roadmap` programme', in_parity: 'IN PARITY', drift: 'DRIFT — see the differences below' };
const cell = (v) => (v == null || v === '' ? '—' : String(v).replace(/\|/g, '/'));

function renderMarkdown(report) {
  const L = [];
  L.push('# Roadmap Manager → portfolio parity report', '');
  L.push(`As of ${report.as_of}. Read-only: nothing was changed. Programme key \`${report.programme_key}\`.`, '');
  L.push('Deleting the Roadmap Manager rows is NOT done by this tool: it is a CAB decision after at least one parity cycle.', '');
  if (!report.users.length) { L.push('No user has a Roadmap Manager roadmap. Nothing to compare.', ''); return L.join('\n'); }
  for (const u of report.users) {
    L.push(`## User #${u.user_id} — ${VERDICT_TEXT[u.verdict] || u.verdict}`, '');
    const c = u.counts;
    L.push(`Objectives: roadmap ${c.roadmap_objectives}, portfolio ${c.portfolio_objectives}, missing ${c.objectives_missing}, with differences ${c.objectives_with_diffs}. `
      + `Deliverables: roadmap ${c.roadmap_deliverables}, portfolio ${c.portfolio_deliverables}, missing ${c.deliverables_missing}, extra in portfolio ${c.deliverables_extra}, status/date differences ${c.deliverables_status_diff}.`, '');
    if (u.verdict === 'not_migrated') { L.push('Run the migration dry run first (Portfolio ▸ Roadmap migration, super_admin).', ''); continue; }
    L.push('| Objective | In portfolio | Field differences | Deliverables (roadmap / portfolio) | Missing | Extra | Status/date differences |', '|---|---|---|---|---|---|---|');
    for (const o of u.objectives) {
      const diffs = o.diffs.map((d) => `${d.field}: ${cell(d.roadmap)} → ${cell(d.portfolio)}`).join('; ');
      const sd = o.deliverables.status_diff.map((d) => `${cell(d.name)} (${d.field || 'status'}: ${cell(d.roadmap)} → ${cell(d.portfolio)})`).join('; ');
      L.push(`| ${cell(o.name)} (\`${o.obj_key}\`) | ${o.present ? 'yes' : '**no**'} | ${cell(diffs)} | ${o.deliverables.roadmap} / ${o.deliverables.portfolio} | ${cell(o.deliverables.missing.join('; '))} | ${cell(o.deliverables.extra.join('; '))} | ${cell(sd)} |`);
    }
    if (u.extra_objectives.length) L.push('', `Objectives in the portfolio programme that the roadmap does not have: ${u.extra_objectives.map((k) => '`' + k + '`').join(', ')}.`);
    L.push('');
  }
  return L.join('\n');
}

module.exports = { PROGRAMME_KEY, objectiveStatus, deliverableStatus, objectiveKey, projectKey, computeParity, loadRoadmapUsers, loadRoadmap, loadPortfolio, buildReport, renderMarkdown };
