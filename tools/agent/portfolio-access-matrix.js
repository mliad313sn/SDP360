'use strict';
// F-ARCH-04 — portfolio access parity matrix. ONE definition of the personas, the fixture projects and the
// surfaces, used twice:
//   - here, to write docs/ops/PORTFOLIO-ACCESS-MATRIX.md (the EXPECTED visible set per persona, computed from
//     the pure rule services/portfolioAccess.canReadProject — nothing is run against a database);
//   - by tests/portfolio-access-parity.smoke.test.js, which builds the same fixture over HTTP and asserts that
//     every surface shows exactly that set (the OBSERVED side).
//
//   node tools/agent/portfolio-access-matrix.js            writes the document
//   node tools/agent/portfolio-access-matrix.js --check    exits 1 when the committed file is out of date
//
// The two switches (portfolio_site_scope_reads, portfolio_editor_plan_writes) default to '0'. This tool and
// its test never arm them outside a throwaway test database.

const fs = require('fs');
const path = require('path');
const PA = require('../../services/portfolioAccess');
const OUT = path.join(__dirname, '..', '..', 'docs', 'ops', 'PORTFOLIO-ACCESS-MATRIX.md');

// Symbolic site ids: A = 1, B = 2 (the test maps them to two real sites).
const SITE = Object.freeze({ A: 1, B: 2 });

/** roles = the dashboard roles of the test account; sites = [primary, ...extra] by symbol. */
const PERSONAS = Object.freeze([
  { key: 'committee', label: 'Committee member (no site)', roles: ['viewer', 'committee-member'], sites: [], committee: true, money: true },
  { key: 'edA', label: 'Editor, site A', roles: ['editor'], sites: ['A'], editor: true },
  { key: 'edB', label: 'Editor, site B', roles: ['editor'], sites: ['B'], editor: true },
  { key: 'multi', label: 'Editor, site A + extra site B', roles: ['editor'], sites: ['A', 'B'], editor: true },
  { key: 'viewA', label: 'Viewer, site A', roles: ['viewer'], sites: ['A'] },
  { key: 'finA', label: 'Viewer + finance-viewer, site A', roles: ['viewer', 'finance-viewer'], sites: ['A'], money: true },
  { key: 'owner', label: 'Viewer without site, named as owner of project B (free text)', roles: ['viewer'], sites: [], ownerOf: 'B' },
  { key: 'nosite', label: 'Viewer without site', roles: ['viewer'], sites: [] },
]);

/** site = primary site symbol or null (group-level); extra = extra site symbols; owner = persona key or null. */
const PROJECTS = Object.freeze([
  { key: 'A', label: 'Project of site A', site: 'A', extra: [], owner: null },
  { key: 'B', label: 'Project of site B, owner field = the "owner" persona', site: 'B', extra: [], owner: 'owner' },
  { key: 'AB', label: 'Project of site A with extra site B', site: 'A', extra: ['B'], owner: null },
  { key: 'G', label: 'Group-level project (no site)', site: null, extra: [], owner: null },
]);

/** rule: 'equal' = shows exactly the visible set · 'subset' = never shows a hidden project · 'gate' = 200 for visible, 404 for hidden. */
const SURFACES = Object.freeze([
  { key: 'list', path: 'GET /api/governance/portfolio', rule: 'equal', note: 'projects and every child list (tasks, milestones, deliverables, risks, benefits, plans, gantt, project_sites)' },
  { key: 'summary', path: 'GET /api/governance/portfolio (summary)', rule: 'equal', note: 'programme counts recomputed on the visible set' },
  { key: 'detail', path: 'GET /api/governance/portfolio/project/:id', rule: 'gate', note: '404 (not 403) for a hidden project' },
  { key: 'baselines', path: 'GET /api/governance/portfolio/project/:id/baselines', rule: 'gate', note: '404 for a hidden project' },
  { key: 'history', path: 'GET /api/governance/portfolio/project/:id/history', rule: 'gate', note: 'money readers only (others 403 on every project, by role)' },
  { key: 'exceptions', path: 'GET /api/governance/portfolio/exceptions', rule: 'equal', note: 'every fixture project carries one overdue task' },
  { key: 'deck', path: 'GET /api/governance/portfolio/deck.pptx', rule: 'equal', note: 'slide text searched for each project marker' },
  { key: 'workbook', path: 'GET /api/governance/portfolio/workbook.xlsx', rule: 'equal', note: 'every sheet searched for each project marker' },
  { key: 'report', path: 'GET /api/governance/portfolio/report.html', rule: 'equal', note: 'schedule alerts and open risks name the project' },
  { key: 'mywork', path: 'GET /api/me/work (benefit reviews)', rule: 'subset', note: 'site cards only: a group-level or owner-by-text project is not listed there' },
]);

function userOf(p) {
  const ids = p.sites.map((s) => SITE[s]);
  return { username: 'persona_' + p.key, full_name: 'Persona ' + p.key, site_id: ids[0] || null, site_ids: ids };
}
function projectOf(x, id) {
  const owner = x.owner ? userOf(PERSONAS.find((p) => p.key === x.owner)).username : 'nobody';
  return { id, site_id: x.site ? SITE[x.site] : null, owner, extra: x.extra.map((s) => SITE[s]) };
}

/** Visible project keys per persona key, from the pure rule. scopeOn false = today (everything). */
function expected(scopeOn) {
  const out = {};
  for (const p of PERSONAS) {
    out[p.key] = PROJECTS.filter((x, i) => {
      const pr = projectOf(x, i + 1);
      return PA.canReadProject(userOf(p), pr, { scopeOn: !!scopeOn, isCommittee: !!p.committee, isAdmin: false, extraSites: pr.extra });
    }).map((x) => x.key);
  }
  return out;
}
/** Project keys whose plan the persona may edit. writesOn false = today (committee only). */
function expectedEditable(writesOn) {
  const out = {};
  for (const p of PERSONAS) {
    out[p.key] = PROJECTS.filter((x, i) => {
      const pr = projectOf(x, i + 1);
      return PA.canEditPlan(userOf(p), pr, { writesOn: !!writesOn, isCommittee: !!p.committee, isEditor: !!p.editor, extraSites: pr.extra });
    }).map((x) => x.key);
  }
  return out;
}

function render() {
  const off = expected(false), on = expected(true), wOff = expectedEditable(false), wOn = expectedEditable(true);
  const L = [];
  const cell = (a) => (a.length ? a.join(', ') : '—');
  L.push('# Portfolio access matrix (generated)', '',
    'Generated by `node tools/agent/portfolio-access-matrix.js` — do not edit by hand (`--check` fails when this file is out of date).', '',
    'Scope: who reads which portfolio project, on every surface, in both states of `portfolio_site_scope_reads`, and whose plan an',
    'account may edit in both states of `portfolio_editor_plan_writes`. Both switches default to `0` (today). The **expected** side below',
    'is computed from the pure rule `services/portfolioAccess.js`. The **observed** side is `tests/portfolio-access-parity.smoke.test.js`:',
    'it builds this fixture over HTTP and fails when any surface shows a different set. This document is test evidence. It is not an',
    'approval to arm either switch — that decision belongs to the IAM owner and the PMO.', '',
    '## Personas', '', '| Persona | Roles | Sites | Reads amounts |', '|---|---|---|---|');
  for (const p of PERSONAS) L.push(`| \`${p.key}\` — ${p.label} | ${p.roles.join(', ')} | ${p.sites.join(' + ') || 'none'} | ${p.money ? 'yes' : 'no'} |`);
  L.push('', '## Fixture projects', '', '| Project | Primary site | Extra sites | Owner field |', '|---|---|---|---|');
  for (const x of PROJECTS) L.push(`| \`${x.key}\` — ${x.label} | ${x.site || 'none'} | ${x.extra.join(', ') || '—'} | ${x.owner ? 'persona `' + x.owner + '`' : 'someone else'} |`);
  L.push('', '## Expected visible projects', '', '| Persona | Read switch `0` (today) | Read switch `1` |', '|---|---|---|');
  for (const p of PERSONAS) L.push(`| \`${p.key}\` | ${cell(off[p.key])} | ${cell(on[p.key])} |`);
  L.push('', '## Expected editable plans (tasks, milestones, risks, deliverables, benefits)', '', '| Persona | Write switch `0` (today) | Write switch `1` |', '|---|---|---|');
  for (const p of PERSONAS) L.push(`| \`${p.key}\` | ${cell(wOff[p.key])} | ${cell(wOn[p.key])} |`);
  L.push('', '## Surfaces checked against the expected set', '', '| Surface | Rule | Note |', '|---|---|---|');
  const RULE = { equal: 'shows exactly the visible set', subset: 'never shows a hidden project', gate: '200 when visible, 404 when hidden' };
  for (const s of SURFACES) L.push(`| \`${s.path}\` | ${RULE[s.rule]} | ${s.note} |`);
  L.push('', '## Also asserted by the test', '',
    '- A hidden project answers 404, never 403, on detail, baselines and history (its existence is not disclosed).',
    '- No marker text of a hidden project (name, task, risk, milestone, deliverable, benefit) appears in any response body or export.',
    '- Amounts (budget, spent, money benefit values) are absent on every surface for a persona that does not read amounts.',
    '- Revocation in an open session: removing the extra site of `multi`, or the finance role of `finA`, changes the next request',
    '  on the list, the detail, the exports and the history — no new login.',
    '', '## Open decisions (people)', '',
    '- A group-level project (no site) is readable by every signed-in account when the read switch is on (`G` in every row above).',
    '- The owner field is free text: an account whose username, full name or e-mail equals it reads the project (`owner` reads `B`).',
    '- Arming either switch.', '');
  return L.join('\n');
}

if (require.main === module) {
  const text = render();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== text) { console.error('docs/ops/PORTFOLIO-ACCESS-MATRIX.md is out of date — run node tools/agent/portfolio-access-matrix.js'); process.exit(1); }
    console.log('portfolio access matrix: up to date');
  } else { fs.writeFileSync(OUT, text); console.log('wrote ' + path.relative(process.cwd(), OUT)); }
}

module.exports = { SITE, PERSONAS, PROJECTS, SURFACES, userOf, expected, expectedEditable, render, OUT };
