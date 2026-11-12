'use strict';
// F-UX-07 — persona × task × screen matrix (E06 / E09 preparation). GENERATED from three sources, nothing invented:
//   • the vision pack §3.2 seven personas (names + primary question, copied here — PERSONAS below),
//   • the head workspaces (public/_shell.js WORKSPACES, read by running the shell in a sandbox),
//   • the journeys of docs/ops/PERSONA-JOURNEYS.md (persona, start page, action page, browser test) and the tasks of
//     docs/ops/USABILITY-TEST-PROTOCOL.md (T1-T12).
// The review.1 build's 11 presentation profiles are not in this repository: their column reads NEEDS-REVIEW.1-ARTIFACT.
// The persona → workspace mapping below is a PROPOSAL for decision D2 (product owner + UX lead), not a decision.
//   node tools/agent/persona-matrix.js            write docs/ux/PERSONA-TASK-MATRIX.md
//   node tools/agent/persona-matrix.js --check    exit 1 when the committed file is stale
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'ux', 'PERSONA-TASK-MATRIX.md');

// Vision pack v2.0 §3.2 (9 Nov 2026) — the seven personas, their primary question, and the head workspace ids that
// serve them today (PROPOSAL). [] = no workspace at head (a gap).
const PERSONAS = [
  { name: 'Executive / Group Management', question: 'Where are the critical exceptions, decisions, cross-site gaps and strategic risks?', workspaces: ['executive'] },
  { name: 'Site Management / Business Lead', question: 'What is the site posture, business impact and management action required?', workspaces: ['business'] },
  { name: 'Site IT Lead', question: 'What is failing, at risk, overdue or awaiting evidence at my site?', workspaces: ['site-it', 'technician'] },
  { name: 'Department Member', question: 'What is assigned to my department and what do I need to update or submit?', workspaces: [] },
  { name: 'Validator', question: 'What requires my decision, by when, with what evidence and conflict check?', workspaces: [] },
  { name: 'Administrator', question: 'What configuration, mapping, access, connector or quality issue requires control?', workspaces: ['super', 'admin'] },
  { name: 'Guest / Invited User', question: 'What approved and sanitized information may I see?', workspaces: [] },
];
// Which vision persona a journey's persona label belongs to (PERSONA-JOURNEYS.md wording → vision wording).
const JOURNEY_PERSONA = [
  [/^Executive|^Scorecard viewer/i, 'Executive / Group Management'],
  [/coordinator|Site editor|Field technician|Multi-site/i, 'Site IT Lead'],
  [/^Admin|^super_admin/i, 'Administrator'],
  [/PMO|Committee|Finance reader/i, 'Executive / Group Management'],
];

function loadShell() {
  const window = { EDV_ICONS: { html: () => '' } };
  const document = { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', '_shell.js'), 'utf8'), { window, document, console, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en' } });
  return window.__shell;
}

function hrefIndex(shell) {
  const m = new Map();
  for (const s of shell.NAV) {
    if (s.href && !s.children) m.set(s.id, s.href);
    for (const c of s.children || []) m.set(c.id, c.href);
  }
  return m;
}

function parseJourneys() {
  const s = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'PERSONA-JOURNEYS.md'), 'utf8');
  const out = [];
  for (const l of s.split(/\r?\n/)) {
    const c = l.split('|').map((x) => x.trim());
    if (c.length < 8 || !/^`public\//.test(c[4])) continue;
    out.push({ persona: c[1], role: c[2], journey: c[3], start: c[4].replace(/`/g, ''), action: c[5].replace(/`/g, ''), test: c[6] });
  }
  return out;
}

function parseTasks() {
  const s = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'USABILITY-TEST-PROTOCOL.md'), 'utf8');
  const out = []; let roleCol = -1;
  for (const l of s.split(/\r?\n/)) {
    const c = l.split('|').map((x) => x.trim());
    if (c[1] === '#') { roleCol = c.indexOf('Role'); continue; }   // a table header: does it carry a Role column?
    const m = /^(T\d+)/.exec(c[1] || '');
    if (!m || out.some((t) => t.id === m[1])) continue;
    out.push({ id: m[1], task: c[2], persona: roleCol > 0 ? c[roleCol] : '' });
  }
  return out;
}

function visionPersonaOf(label) { for (const [re, p] of JOURNEY_PERSONA) if (re.test(label)) return p; return null; }
const page = (p) => String(p || '').replace(/^public\//, '').replace(/\.html$/, '');

function build() {
  const shell = loadShell();
  const hrefs = hrefIndex(shell);
  const journeys = parseJourneys();
  const tasks = parseTasks();
  const L = ['# Persona × task × screen matrix (F-UX-07)', '',
    '**Generated** by `node tools/agent/persona-matrix.js` — do not edit by hand (`--check` fails when stale).',
    'Sources: vision pack v2.0 §3.2 (seven personas), `public/_shell.js` WORKSPACES (head), `docs/ops/PERSONA-JOURNEYS.md`,',
    '`docs/ops/USABILITY-TEST-PROTOCOL.md`. The persona → workspace column is a **proposal** for decision D2; the review.1 build\'s',
    '11 presentation profiles are **NEEDS-REVIEW.1-ARTIFACT** (not in this repository). Nothing here is a usability result.', '',
    '## 1. Vision personas and the head workspaces', '',
    '| Vision persona | Primary question (vision §3.2) | Head workspace (proposal) | Workspace pages | review.1 profile | Journeys mapped |', '|---|---|---|---|---|---|'];
  for (const p of PERSONAS) {
    const ws = p.workspaces.map((id) => shell.WORKSPACES.find((w) => w.id === id)).filter(Boolean);
    const pages = [...new Set(ws.flatMap((w) => w.items))].map((id) => (hrefs.get(id) ? `\`${hrefs.get(id)}\`` : `\`${id}\` (not a menu entry)`)).join(', ');
    const n = journeys.filter((j) => visionPersonaOf(j.persona) === p.name).length;
    L.push(`| ${p.name} | ${p.question} | ${ws.length ? ws.map((w) => `${w.label} (\`${w.id}\`)`).join(', ') : '**none at head — gap**'} | ${pages || '—'} | NEEDS-REVIEW.1-ARTIFACT | ${n} |`);
  }
  L.push('', '## 2. Journeys (persona → start → expected first click → test)', '',
    'Expected first click = the action page when it differs from the start page (a **candidate**, decision D4 confirms it in',
    '`docs/ops/pilot/FIRST-CLICK-SHEET.csv`); "in-page control" = the task is done on the start page.', '',
    '| Vision persona | Journey persona | Journey | Start page | Candidate first click | Browser test |', '|---|---|---|---|---|---|');
  for (const j of journeys) {
    L.push(`| ${visionPersonaOf(j.persona) || '—'} | ${j.persona} | ${j.journey.replace(/\|/g, '/')} | \`${j.start}\` | ${j.action !== j.start ? `\`${j.action}\`` : 'in-page control'} | ${j.test} |`);
  }
  L.push('', '## 3. Usability tasks (protocol)', '', '| Task | Wording | Persona |', '|---|---|---|');
  for (const t of tasks) L.push(`| ${t.id} | ${t.task.replace(/\|/g, '/')} | ${t.persona || 'see protocol'} |`);
  const gaps = PERSONAS.filter((p) => !p.workspaces.length).map((p) => p.name);
  L.push('', '## 4. Gaps for decision (not decided here)', '', ...gaps.map((g) => `- **${g}**: no workspace, no inbox and no journey at head.`), '');
  return { md: L.join('\n'), shell, journeys, tasks, hrefs };
}

module.exports = { build, PERSONAS, parseJourneys, parseTasks, visionPersonaOf, OUT, page };

if (require.main === module) {
  const { md } = build();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== md) { console.error('docs/ux/PERSONA-TASK-MATRIX.md is stale — node tools/agent/persona-matrix.js'); process.exit(1); }
  } else { fs.writeFileSync(OUT, md); console.log('written docs/ux/PERSONA-TASK-MATRIX.md'); }
}
