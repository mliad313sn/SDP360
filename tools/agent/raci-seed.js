'use strict';
// E-B05 (audit B-05 prep, X-A-03) — ownership / RACI TEMPLATE generated from the code base. Nothing is decided here:
// every R / A / C / I, data-steward and decision-SLA cell is EMPTY for a person to fill in.
//
//   node tools/agent/raci-seed.js            writes docs/ops/pilot/RACI-TEMPLATE.md
//   node tools/agent/raci-seed.js --check    exits 1 when the committed file is out of date
//
// Sources (read only): docs/ops/FLAG-REGISTER.md (generated from the code — every switch whose owner is
// "to be named", grouped by area), docs/sdp360/completion/CONNECTOR-REGISTER.csv (connectors), and the
// domain list below (the product areas of the platform).

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'ops', 'pilot', 'RACI-TEMPLATE.md');
const FLAGS = path.join(ROOT, 'docs', 'ops', 'FLAG-REGISTER.md');
const CONNECTORS = path.join(ROOT, 'docs', 'sdp360', 'completion', 'CONNECTOR-REGISTER.csv');
const UNNAMED = 'to be named';

const DOMAINS = [
  ['helpdesk-kpis', 'Helpdesk KPIs (SLA, closure, first reply)', 'request_records · metric registry · docs/kpi/FORMULA-REFERENCE.md'],
  ['assets-finance', 'Assets, finance and licences', 'assets · software · depreciation config'],
  ['meetings', 'Meetings, PV and council escalations', 'md_meetings · md_issues · md_actions'],
  ['inspections', 'IT inspections and corrective actions', 'insp_inspections · insp_actions'],
  ['field', 'Field app (outbox, offline entries)', 'field_outbox · system_log field_*'],
  ['ppm', 'Portfolio / PPM and benefits', 'portfolio tables · roadmap'],
  ['governance', 'Governance: KPI committee, commitments, policies', 'kpi_policies · commitments · governance policies'],
  ['access', 'Access: roles, grants, SSO, recertification', 'users · user_roles · access grants'],
  ['reporting', 'Reports and scheduled deliveries', 'weekly_reports · report_sent_log · schedules'],
];

/** Rows of every Markdown table whose header names an Owner column → [{section, key, owner}]. */
function readFlagOwners(text) {
  const out = []; let section = '', ownerIdx = -1;
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (/^## /.test(line)) { section = line.replace(/^##\s*/, '').replace(/\s*\(\d+\).*$/, '').replace(/^\d+\.\s*/, ''); ownerIdx = -1; continue; }
    if (!/^\|/.test(line)) continue;
    const c = line.split(/(?<!\\)\|/).slice(1, -1).map((x) => x.trim());
    if (c.includes('Owner')) { ownerIdx = c.indexOf('Owner'); continue; }
    if (ownerIdx < 0 || !/^`[^`]+`$/.test(c[0] || '')) continue;
    out.push({ section, key: c[0].replace(/`/g, ''), owner: c[ownerIdx] || '' });
  }
  return out;
}
const areaOf = (key) => String(key).split(/[_.]/)[0].toLowerCase();

/** Minimal CSV (quoted fields with commas) → array of objects. */
function readCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  const s = String(text).replace(/\r\n/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"' && s[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : r[i]])));
}

const EMPTY6 = ' | | | | | | |';
function build({ flagsText = fs.readFileSync(FLAGS, 'utf8'), connectorsText = fs.readFileSync(CONNECTORS, 'utf8') } = {}) {
  const unnamed = readFlagOwners(flagsText).filter((r) => r.owner.toLowerCase() === UNNAMED);
  const byArea = new Map();
  for (const r of unnamed) { const a = `${r.section} · ${areaOf(r.key)}`; if (!byArea.has(a)) byArea.set(a, []); byArea.get(a).push(r.key); }
  const areas = [...byArea.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  const conns = readCsv(connectorsText);
  const L = [];
  L.push('# Ownership / RACI template — to be filled in by people (TEMPLATE, nothing decided)');
  L.push('');
  L.push('**Generated** by `node tools/agent/raci-seed.js` from the code base — do not edit by hand; `--check` fails when');
  L.push('this file is out of date. Fill the copy kept by the product committee, not this file. **Every R / A / C / I,');
  L.push('data-steward and decision-SLA cell below is deliberately empty**: no name, no decision and no date is written by');
  L.push('the delivery team or an agent. R = responsible, A = accountable (one per row), C = consulted, I = informed.');
  L.push('');
  L.push(`Sources: the product domains (below), ${conns.length} connectors from \`docs/sdp360/completion/CONNECTOR-REGISTER.csv\`, and`);
  L.push(`**${unnamed.length} switches whose owner is "${UNNAMED}"** in \`docs/ops/FLAG-REGISTER.md\`, grouped into ${areas.length} areas.`);
  L.push('');
  L.push('## 1. Product domains');
  L.push('');
  L.push('| Domain | Scope | Data | R | A | C | I | Data steward | Decision SLA |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const [id, scope, data] of DOMAINS) L.push(`| \`${id}\` | ${scope} | ${data}` + EMPTY6);
  L.push('');
  L.push('## 2. Connectors (CONNECTOR-REGISTER)');
  L.push('');
  L.push('| Id | Connector | Status | Owner role (register) | R | A | C | I | Data steward | Decision SLA |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const c of conns) L.push(`| ${c.id} | ${String(c.connector).replace(/\|/g, '/')} | ${c.status} | ${c.owner_role || '—'}` + EMPTY6);
  L.push('');
  L.push(`## 3. Switches with no owner yet — ${unnamed.length}, by area`);
  L.push('');
  L.push('| Area | Switches | Count | R | A | C | I | Data steward | Decision SLA |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const [a, keys] of areas) L.push(`| ${a} | ${keys.sort().map((k) => '`' + k + '`').join(' ')} | ${keys.length}` + EMPTY6);
  L.push('');
  L.push('## 4. Monthly product committee — agenda skeleton');
  L.push('');
  L.push('| # | Item | Input | Decision recorded where |');
  L.push('|---|---|---|---|');
  L.push('| 1 | Open ownership gaps (rows above with an empty A) | this template | committee minutes |');
  L.push('| 2 | Switch requests (default → pilot value) | `docs/ops/pilot/PILOT-PROFILE.md`, `docs/ops/FLAG-REGISTER.md` | committee minutes + Admin ▸ Config journal |');
  L.push('| 3 | KPI definitions and divergences | `docs/kpi/FORMULA-REFERENCE.md` §6 | KPI committee PV (`committee_ref`) |');
  L.push('| 4 | Value table and pilot measures | `node tools/pilot/pilot-metrics.js --value` | committee minutes |');
  L.push('| 5 | Release gates still empty | `docs/sdp360/completion/RELEASE-GATES.md` | the gate row (name, date, version) |');
  L.push('| 6 | Decisions past their decision SLA | the Decision SLA column above | committee minutes |');
  L.push('');
  return L.join('\n');
}

module.exports = { build, readFlagOwners, readCsv, areaOf, OUT, DOMAINS, UNNAMED };

if (require.main === module) {
  const txt = build();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== txt) { process.stderr.write('RACI-TEMPLATE.md is out of date — run: node tools/agent/raci-seed.js\n'); process.exitCode = 1; }
    else process.stdout.write('RACI-TEMPLATE.md is up to date\n');
  } else { fs.writeFileSync(OUT, txt); process.stdout.write(`wrote ${path.relative(ROOT, OUT)}\n`); }
}
