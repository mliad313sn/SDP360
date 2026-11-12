'use strict';
// F-PRODUCT-05 — readers behind the department crosswalk (migration 082). READ-ONLY: no label is renamed,
// no pair is written from here (a pair is approved by people, see docs/ops/pilot/PILOT-PROFILE.md).
// `reports` / `meetings` = services/pgDb-shaped handles ({ prepare(sql).all() }).
// A source that cannot be read is reported in `not_measured` — never counted as 0.

const SOURCES = [
  { source: 'commitments', db: 'reports', sql: `SELECT department AS department, COUNT(*) AS n FROM commitments GROUP BY department` },
  { source: 'handoffs_from', db: 'reports', sql: `SELECT from_department AS department, COUNT(*) AS n FROM handoffs GROUP BY from_department` },
  { source: 'handoffs_to', db: 'reports', sql: `SELECT to_department AS department, COUNT(*) AS n FROM handoffs GROUP BY to_department` },
  { source: 'report_actions', db: 'reports', sql: `SELECT department AS department, COUNT(*) AS n FROM action_items GROUP BY department` },
  { source: 'pv_issues', db: 'meetings', sql: `SELECT m.department AS department, COUNT(*) AS n FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id GROUP BY m.department` },
];

function makeDepartmentCrosswalkStore({ reports, meetings = null } = {}) {
  if (!reports) throw new Error('departmentCrosswalkStore needs the reports db handle');
  const handle = (name) => (name === 'meetings' ? meetings : reports);

  async function listCrosswalk() {
    return (await reports.prepare(`SELECT id, md_code, action_department_name, status, note FROM department_crosswalk ORDER BY (status = 'unmapped'), md_code NULLS LAST, action_department_name`).all())
      .map((r) => ({ ...r, id: Number(r.id) }));
  }
  /** { code: English name } of the meeting departments; {} when the meetings store is not readable. */
  async function mdNames() {
    if (!meetings) return {};
    try { return Object.fromEntries((await meetings.prepare(`SELECT code, name_en FROM md_departments`).all()).map((r) => [r.code, r.name_en])); } catch (_) { return {}; }
  }
  async function actionNames() {
    try { return (await reports.prepare(`SELECT name FROM action_departments WHERE active = 1 ORDER BY sort_order, name`).all()).map((r) => r.name); } catch (_) { return null; }
  }
  /** Every department value stored in the four registers, with its count. */
  async function collectValues() {
    const values = []; const notMeasured = [];
    for (const s of SOURCES) {
      const h = handle(s.db);
      if (!h) { notMeasured.push({ source: s.source, reason: `${s.db} store not available` }); continue; }
      try { for (const r of await h.prepare(s.sql).all()) values.push({ source: s.source, department: r.department == null ? null : String(r.department), n: Number(r.n) }); }
      catch (_) { notMeasured.push({ source: s.source, reason: 'not readable' }); }
    }
    return { values, not_measured: notMeasured };
  }
  return { listCrosswalk, mdNames, actionNames, collectValues, SOURCES: SOURCES.map((s) => s.source) };
}

module.exports = { makeDepartmentCrosswalkStore };
