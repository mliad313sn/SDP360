'use strict';
// E-D06 — SYNTHETIC reference organisation (no real person, ticket or site data). Deterministic: the same seed
// always writes the same file. 5 countries, several sites per country, 2 site currencies (XOF + GBP), a London
// site on Europe/London (BST edge ticket), every status vocabulary, and a PARTIAL last month (stops on the 10th).
//
//   node tests/fixtures/reference-org/generate.js     rewrites tests/fixtures/reference-org/reference-org.json
//
// It exercises the SHAPE of the review-data / site-window readers (tests/reference-org-shape.test.js) — not their
// fidelity: the ten "no prod-snapshot" skips stay until the data owner approves an anonymised extract.
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'reference-org.json');

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

function build(seed = 20261105) {
  const r = rng(seed); const pick = (a) => a[Math.floor(r() * a.length)];
  const SITES = [
    { name: 'Ref Sabodala', country: 'SN', currency: 'XOF', tz: 'Africa/Dakar', code: 'RSG' },
    { name: 'Ref Massawa', country: 'SN', currency: 'XOF', tz: 'Africa/Dakar', code: 'RMS' },
    { name: 'Ref Hounde', country: 'BF', currency: 'XOF', tz: 'Africa/Ouagadougou', code: 'RHG' },
    { name: 'Ref Ouaga Office', country: 'BF', currency: 'XOF', tz: 'Africa/Ouagadougou', code: 'ROU' },
    { name: 'Ref Ity', country: 'CI', currency: 'XOF', tz: 'Africa/Abidjan', code: 'RIT' },
    { name: 'Ref Lafigue', country: 'CI', currency: 'XOF', tz: 'Africa/Abidjan', code: 'RLF' },
    { name: 'Ref Kalana', country: 'ML', currency: 'XOF', tz: 'Africa/Bamako', code: 'RKL' },
    { name: 'Ref London Office', country: 'GB', currency: 'GBP', tz: 'Europe/London', code: 'RLN' },
  ].map((s) => ({ ...s, zoho_group: s.name + ' IT Agents' }));
  const DEPTS = ['Maintenance', 'Mining', 'Processing', 'HSE', 'Finance'];
  const ISSUE_ST = ['open', 'in_progress', 'blocked', 'on_hold', 'resolved', 'cancelled', 'demand', 'helpdesk_ticket'];
  const ACT_ST = ['open', 'in_progress', 'closed', 'cancelled'];
  const SEV = ['HIGH', 'MEDIUM', 'LOW'];
  const CAT = ['CN', 'HW', 'IN', 'AP', 'SC'];
  const FIND = ['ok', 'minor', 'major', 'critical', 'opp', 'na'];
  const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09'];   // 2026-09 is partial (≤ the 10th)
  const day = (m, max) => `${m}-${String(1 + Math.floor(r() * (m === '2026-09' ? 10 : max))).padStart(2, '0')}`;
  const meetings = []; const issues = []; const actions = []; const projects = []; const inspections = []; const findings = []; const inspActions = []; const tickets = []; const changes = [];
  let ticket = 1;
  for (const s of SITES) {
    for (const m of MONTHS) {
      const nPv = s.code === 'RLN' ? 1 : 2 + Math.floor(r() * 2);
      for (let k = 0; k < nPv; k++) {
        const ref = `${s.code}_${DEPTS[k]}_PV_${m}`;
        const date = day(m, 28);
        meetings.push({ reference: ref, site_code: s.code, department: DEPTS[k], meeting_date: date, status: pick(['draft', 'submitted', 'signed', 'closed']), intake_source: k === 2 ? 'business_incubation' : 'department_meeting' });
        const ni = 1 + Math.floor(r() * 3);
        for (let i = 0; i < ni; i++) {
          const st = pick(ISSUE_ST);
          issues.push({ meeting: ref, title: `Synthetic issue ${s.code}-${m}-${k}-${i}`, category: pick(CAT), severity: pick(SEV), status: st, target_date: day(m, 28), closed_at: ['resolved', 'cancelled'].includes(st) ? day(m, 28) : null, champion: `Synthetic Person ${1 + Math.floor(r() * 20)}` });
        }
        actions.push({ meeting: ref, description: `Synthetic action ${s.code}-${m}-${k}`, status: pick(ACT_ST), target_date: day(m, 28) });
        if (k === 0) projects.push({ meeting: ref, project_name: `Synthetic project ${s.code}-${m}`, phase: pick(['idea', 'design', 'build', 'run']), target_end: day(m, 28) });
      }
      const iid = `REF-${s.code}-${m}`;
      inspections.push({ id: iid, site_code: s.code, inspection_date: day(m, 28), status: pick(['draft', 'submitted', 'closed']) });
      for (let f = 0; f < 4; f++) findings.push({ inspection_id: iid, category: pick(['net', 'srv', 'sto', 'rack']), item_index: f, status: pick(FIND) });
      inspActions.push({ inspection_id: iid, ord: 0, description: `Synthetic corrective action ${iid}`, priority: pick(['Critical', 'High', 'Medium', 'Low']), status: pick(['Open', 'Closed', 'Cancelled']) });
      const nt = 3 + Math.floor(r() * 4);
      for (let t = 0; t < nt; t++) {
        const created = `${day(m, 28)}T${String(6 + Math.floor(r() * 12)).padStart(2, '0')}:00:00.000Z`;
        const closed = r() < 0.7;
        tickets.push({ request_id: String(900000000000 + ticket), display_id: String(70000 + ticket), subject: `Synthetic ticket ${ticket}`, tech_group: s.zoho_group, site: s.name, request_status: closed ? 'Closed' : pick(['Open', 'On Hold']), pending_status: closed ? 0 : 1, overdue_status: r() < 0.2 ? 1 : 0, request_type: r() < 0.1 ? 'Major Incident' : 'Incident', created_time: created, resolved_time: closed ? created.replace(/T\d\d/, 'T20') : null });
        ticket++;
      }
      changes.push({ change_id: `CHG-${s.code}-${m}`, display_id: `CH-${s.code}-${m}`, subject: `Synthetic change ${s.code} ${m}`, status: pick(['Completed', 'Closed', 'Cancelled', 'Implementation']), group_name: s.zoho_group, created_time: `${day(m, 28)}T09:00:00.000Z`, udf_json: JSON.stringify({ 'UDF:Change Implementation Outcome': pick(['Successful', 'Failed', 'Partially successful', '']) }) });
    }
  }
  // London BST edge: 23:30 UTC on 31 Aug = 00:30 on 1 Sep local time
  tickets.push({ request_id: String(900000000000 + ticket), display_id: String(70000 + ticket), subject: 'Synthetic BST-edge ticket', tech_group: 'Ref London Office IT Agents', site: 'Ref London Office', request_status: 'Open', pending_status: 1, overdue_status: 0, request_type: 'Incident', created_time: '2026-08-31T23:30:00.000Z', resolved_time: null });
  return { note: 'SYNTHETIC — generated by tests/fixtures/reference-org/generate.js; no real person, ticket or site data', seed,
    currency_map: { 'Ref London Office': 'GBP', '*': 'XOF' }, partial_month: { month: '2026-09', through: '2026-09-10' },
    sites: SITES, meetings, issues, actions, projects, inspections, findings, inspActions, tickets, changes };
}

if (require.main === module) { fs.writeFileSync(OUT, JSON.stringify(build(), null, 1) + '\n'); console.log('wrote', path.relative(process.cwd(), OUT)); }
module.exports = { build, OUT };
