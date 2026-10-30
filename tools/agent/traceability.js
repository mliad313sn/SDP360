#!/usr/bin/env node
'use strict';
// G21 — traceability matrix: goal → evidence file → every test file, code file and decision it cites, with an
// existence check. A cited test that does not exist is a broken claim; the matrix makes it visible (and the
// companion test fails on it). "Field / deployed / accepted" columns are copied from the tracker, never inferred.
//   node tools/agent/traceability.js            write docs/agent-execution/TRACEABILITY.md
//   node tools/agent/traceability.js --check    exit 1 when a cited file is missing or the document is stale
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'docs', 'agent-execution');
const OUT = path.join(DIR, 'TRACEABILITY.md');

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function cited(text) {
  const files = new Set();
  for (const m of text.matchAll(/`([A-Za-z0-9_./-]+\.(?:js|mjs|sql|html|css|ps1|cmd|md|json|csv|yml))`/g)) files.add(m[1]);
  for (const m of text.matchAll(/\b(tests\/[A-Za-z0-9_.-]+\.test\.js)\b/g)) files.add(m[1]);
  return [...files].filter((f) => f.includes('/') || /^(server|reports-db|meetings-db|inspection-db|tracker-db)\.js$/.test(f));
}

function build() {
  const rows = parseCsv(fs.readFileSync(path.join(DIR, 'GOAL_TRACKER.csv'), 'utf8'));
  const h = rows[0]; const col = (r, k) => r[h.indexOf(k)] || '';
  const goals = rows.slice(1).filter((r) => /^G\d\d$/.test(r[0])).map((r) => {
    const ev = path.join(DIR, `${r[0]}.md`);
    const text = fs.existsSync(ev) ? fs.readFileSync(ev, 'utf8') : '';
    const refs = cited(text + ' ' + col(r, 'evidence'));
    const missing = refs.filter((f) => !fs.existsSync(path.join(ROOT, f)) && !fs.existsSync(path.join(ROOT, 'public', f)));
    return { id: r[0], wave: col(r, 'wave'), title: col(r, 'title'), status: col(r, 'implementation_status'), tested: col(r, 'tested'),
      field: col(r, 'field_validated'), deployed: col(r, 'deployed'), accepted: col(r, 'business_accepted'), authority: col(r, 'human_authority'),
      evidence: fs.existsSync(ev) ? `docs/agent-execution/${r[0]}.md` : null,
      tests: refs.filter((f) => f.startsWith('tests/')), code: refs.filter((f) => !f.startsWith('tests/') && !f.startsWith('docs/')), docs: refs.filter((f) => f.startsWith('docs/')), missing };
  });
  return goals;
}

function markdown(goals) {
  const L = ['# Traceability matrix (generated)', '', '`node tools/agent/traceability.js` writes this file from `GOAL_TRACKER.csv` and each `Gxx.md`; `--check` fails when a cited file is missing or the file is stale.',
    'Field, deployed and accepted are copied from the tracker — code never sets them.', '',
    '| Goal | Wave | Status | Tested | Field | Deployed | Accepted | Evidence | Tests cited | Code cited | Missing |', '|---|---|---|---|---|---|---|---|---:|---:|---|'];
  for (const g of goals) L.push(`| ${g.id} ${g.title} | ${g.wave} | ${g.status} | ${g.tested} | ${g.field} | ${g.deployed} | ${g.accepted} | ${g.evidence ? '`' + g.evidence + '`' : '—'} | ${g.tests.length} | ${g.code.length} | ${g.missing.length ? g.missing.map((m) => '`' + m + '`').join(', ') : '—'} |`);
  L.push('', '## Tests per goal', '');
  for (const g of goals) if (g.tests.length) L.push(`- **${g.id}**: ${g.tests.map((t) => '`' + t + '`').join(', ')}`);
  return L.join('\n') + '\n';
}

function main() {
  const goals = build(); const md = markdown(goals);
  const missing = goals.flatMap((g) => g.missing.map((m) => `${g.id}: ${m}`));
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (missing.length) { console.error('cited but missing:\n' + missing.join('\n')); process.exit(1); }
    if (cur !== md) { console.error('TRACEABILITY.md is out of date — run node tools/agent/traceability.js'); process.exit(1); }
    console.log(`traceability ok: ${goals.length} goals`); return;
  }
  fs.writeFileSync(OUT, md);
  console.log(`${goals.length} goals, ${missing.length} missing citation(s)` + (missing.length ? ':\n' + missing.join('\n') : ''));
}
if (require.main === module) main();
module.exports = { build, markdown, cited, parseCsv };
