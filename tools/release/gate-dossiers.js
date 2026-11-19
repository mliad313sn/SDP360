#!/usr/bin/env node
'use strict';
// P10 — one decision dossier per human release gate (docs/sdp360/completion/RELEASE-GATES.md), French and English,
// generated from ONE source (tools/release/gate-dossiers.source.js) so that a new SHA regenerates all of them.
//
//   node tools/release/gate-dossiers.js [--sha=<target sha>]   regenerate the dossiers, the index and the manifest
//   node tools/release/gate-dossiers.js --check                exit 1 when a dossier is stale (see checkStale)
//
// What "stale" means — the dossier cites evidence older than the tree it claims to describe:
//   - a cited file changed since the manifest recorded its content hash;
//   - a parallel lot delivered evidence the dossier still calls "awaited" (its glob now matches a new file);
//   - the source, or the RELEASE-GATES rows, changed;
//   - the committed Markdown is not what the source + manifest render to (hand edit).
// The renderer is pure (source + manifest -> text): git dates are captured into the manifest at generation time,
// so the check is reproducible on a shallow CI clone.
//
// The generator NEVER writes a decision, a name, a date of approval or a threshold. Every decision cell stays empty.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const GATES_MD = 'docs/sdp360/completion/RELEASE-GATES.md';
const SOURCE = 'tools/release/gate-dossiers.source.js';
const OUT_DIR = 'docs/agent-execution/gate-dossiers';
const MANIFEST = `${OUT_DIR}/manifest.json`;

const norm = (s) => s.replace(/\r\n/g, '\n');
const sha256 = (s) => crypto.createHash('sha256').update(norm(s)).digest('hex').slice(0, 16);
const readRel = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
}

// RELEASE-GATES.md table rows -> [{ gate, scope, approver, decision, name, date, evidence, sha, conditions }]
function parseGateRows(md) {
  const rows = [];
  for (const line of norm(md).split('\n')) {
    if (!line.startsWith('| ') || /^\|\s*Gate\s*\|/.test(line) || /^\|---/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 9) continue;
    const [gate, scope, approver, decision, name, date, evidence, sha, conditions] = cells;
    rows.push({ gate, scope, approver, decision, name, date, evidence, sha, conditions });
  }
  return rows;
}

function loadSource(root) {
  const file = path.join(root, SOURCE);
  delete require.cache[require.resolve(file)];
  return require(file);
}

// Minimal glob: "dir/prefix*suffix" in one directory (no recursion) — enough for "docs/agent-execution/P02-*.md".
function resolveGlob(root, glob) {
  const dir = path.posix.dirname(glob);
  const base = path.posix.basename(glob);
  const re = new RegExp('^' + base.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  let names = [];
  try { names = fs.readdirSync(path.join(root, dir)); } catch { return []; }
  return names.filter((n) => re.test(n)).sort().map((n) => `${dir}/${n}`);
}

function allCitedPaths(source) {
  const set = new Set();
  for (const g of source.gates) for (const e of g.evidence) set.add(e.path);
  return [...set].sort();
}

// The facts the dossiers depend on, read from the tree. withGit=false gives the reproducible subset (no dates).
function collect(root, { withGit = true } = {}) {
  const source = loadSource(root);
  const gatesMd = readRel(root, GATES_MD);
  const evidence = {};
  const missing = [];
  const awaited = {};
  for (const g of source.gates) for (const a of g.awaited || []) awaited[a.glob] = resolveGlob(root, a.glob);
  const paths = new Set(allCitedPaths(source));
  for (const list of Object.values(awaited)) for (const p of list) paths.add(p);
  for (const p of [...paths].sort()) {
    if (!fs.existsSync(path.join(root, p))) { missing.push(p); continue; }
    const rec = { sha256: sha256(readRel(root, p)) };
    if (withGit) {
      const log = git(root, ['log', '-1', '--format=%h %cs', '--', p]);
      rec.commit = log ? log.split(' ')[0] : 'uncommitted';
      rec.date = log ? log.split(' ')[1] : 'uncommitted';
    }
    evidence[p] = rec;
  }
  return {
    source,
    rows: parseGateRows(gatesMd),
    gatesHash: sha256(gatesMd),
    sourceHash: sha256(readRel(root, SOURCE)),
    evidence,
    awaited,
    missing,
  };
}

function validate(source, rows) {
  const errors = [];
  const ids = new Set();
  for (const g of source.gates) {
    if (ids.has(g.id)) errors.push(`duplicate gate id ${g.id}`);
    ids.add(g.id);
    if (!rows.some((r) => r.gate === g.row)) errors.push(`${g.id}: row not found in ${GATES_MD}: "${g.row}"`);
    for (const d of g.depends || []) if (!source.gates.some((x) => x.id === d)) errors.push(`${g.id}: unknown dependency ${d}`);
    for (const k of ['question', 'notEvidenced', 'options', 'risks', 'supply']) {
      for (const lang of ['en', 'fr']) if (!g[k] || !g[k][lang] || (Array.isArray(g[k][lang]) && !g[k][lang].length)) errors.push(`${g.id}: ${k}.${lang} empty`);
    }
    for (const lang of ['en', 'fr']) if (!g.options[lang].some((o) => /^(Not now|Pas maintenant)/.test(o))) errors.push(`${g.id}: options.${lang} lacks the "not now" option`);
    if (!source.blocks[g.blocks]) errors.push(`${g.id}: unknown blocks class ${g.blocks}`);
  }
  for (const r of rows) if (!source.gates.some((g) => g.row === r.gate)) errors.push(`release-gates row without a dossier: "${r.gate}"`);
  return errors;
}

// Topological order (Kahn), stable by id.
function dependencyOrder(gates) {
  const left = new Map(gates.map((g) => [g.id, new Set(g.depends || [])]));
  const out = [];
  while (left.size) {
    const ready = [...left].filter(([, d]) => [...d].every((x) => !left.has(x))).map(([id]) => id).sort();
    if (!ready.length) throw new Error('dependency cycle among gates: ' + [...left.keys()].join(', '));
    for (const id of ready) { out.push(id); left.delete(id); }
  }
  return out;
}

// Gates a two-site pilot cannot start without, plus everything they depend on.
function pilotPath(gates) {
  const byId = new Map(gates.map((g) => [g.id, g]));
  const need = new Set();
  const visit = (id) => { if (need.has(id)) return; need.add(id); for (const d of byId.get(id).depends || []) visit(d); };
  for (const g of gates) if (g.blocks === 'pilot') visit(g.id);
  return dependencyOrder(gates).filter((id) => need.has(id));
}

const T = {
  en: {
    title: 'Decision dossier', gate: 'Release gate', approver: 'Approver role', scope: 'Scope (RELEASE-GATES)',
    target: 'Target SHA', generated: 'Generated', blocks: 'What this gate blocks', depends: 'Decide after',
    none: 'none', cell: 'Decision cell in RELEASE-GATES.md',
    cellEmpty: 'empty — this gate is **NO-GO** until the approver fills it. This dossier fills nothing.',
    cellFilled: 'filled by a person (shown as recorded, not checked here)',
    s1: '1. Question to decide', s2: '2. Evidence at the target SHA', s3: '3. Not evidenced, and why',
    s4: '4. Options and consequences', s5: '5. Residual risks if approved today', s6: '6. What the approver must supply',
    evHead: '| Evidence | What it shows | Regenerate / re-run | Last changed (commit, date) | Content hash |',
    awHead: '| From lot | Expected evidence | Status |', awaitedT: 'Evidence awaited from parallel lots',
    present: 'delivered', absent: 'awaited — not in the tree at the target SHA',
    footer: 'Generated by `node tools/release/gate-dossiers.js` from `tools/release/gate-dossiers.source.js`. Prepared by an AI agent: an AI panel is not an independent review. `tests/gate-dossiers.test.js` fails when any cited evidence changed after this dossier was generated.',
    other: 'Version française', idx: 'Gate dossiers — index and critical path',
  },
  fr: {
    title: 'Dossier de décision', gate: 'Porte de mise en production', approver: 'Rôle approbateur', scope: 'Périmètre (RELEASE-GATES)',
    target: 'SHA cible', generated: 'Généré', blocks: 'Ce que cette porte bloque', depends: 'À décider après',
    none: 'aucune', cell: 'Case de décision dans RELEASE-GATES.md',
    cellEmpty: 'vide — cette porte est **NO-GO** tant que l\'approbateur ne l\'a pas remplie. Ce dossier ne remplit rien.',
    cellFilled: 'remplie par une personne (reprise telle quelle, non vérifiée ici)',
    s1: '1. La question à trancher', s2: '2. Preuves au SHA cible', s3: '3. Ce qui n\'est pas prouvé, et pourquoi',
    s4: '4. Options et conséquences', s5: '5. Risques résiduels en cas d\'accord aujourd\'hui', s6: '6. Ce que l\'approbateur doit fournir',
    evHead: '| Preuve | Ce qu\'elle montre | Régénérer / rejouer | Dernière modification (commit, date) | Empreinte |',
    awHead: '| Lot | Preuve attendue | Statut |', awaitedT: 'Preuves attendues des lots parallèles',
    present: 'livrée', absent: 'attendue — absente de l\'arbre au SHA cible',
    footer: 'Généré par `node tools/release/gate-dossiers.js` à partir de `tools/release/gate-dossiers.source.js`. Préparé par un agent IA : un panel IA n\'est pas une revue indépendante. `tests/gate-dossiers.test.js` échoue si une preuve citée a changé après la génération de ce dossier.',
    other: 'English version', idx: 'Dossiers des portes — index et chemin critique',
  },
};

const esc = (s) => String(s).replace(/\|/g, '\\|');
const bullets = (list) => list.map((x) => `- ${x}`).join('\n');
const fileName = (g) => `${g.id}-${g.slug}.md`;

function renderDossier(source, manifest, g, lang) {
  const t = T[lang];
  const row = manifest.rows.find((r) => r.gate === g.row) || {};
  const other = lang === 'en' ? 'fr' : 'en';
  const deps = (g.depends || []).map((d) => { const x = source.gates.find((y) => y.id === d); return `[${d}](${fileName(x)}) ${x.short[lang]}`; });
  const out = [];
  out.push(`# ${t.title} ${g.id} — ${g.short[lang]}`, '');
  out.push(`[${t.other}](../${other}/${fileName(g)})`, '');
  out.push(`| | |`, `|---|---|`);
  out.push(`| ${t.gate} | ${esc(g.row)} |`);
  out.push(`| ${t.approver} | ${esc(g.approver[lang])} |`);
  out.push(`| ${t.scope} | ${esc(row.scope || '')} |`);
  out.push(`| ${t.cell} | ${row.decision ? t.cellFilled : t.cellEmpty} |`);
  out.push(`| ${t.blocks} | ${esc(source.blocks[g.blocks][lang])} |`);
  out.push(`| ${t.depends} | ${deps.length ? deps.join(' · ') : t.none} |`);
  out.push(`| ${t.target} | \`${manifest.target_sha}\` |`);
  out.push(`| ${t.generated} | ${manifest.generated} |`, '');
  out.push(`## ${t.s1}`, '', g.question[lang], '');
  out.push(`## ${t.s2}`, '', t.evHead, '|---|---|---|---|---|');
  for (const e of g.evidence) {
    const m = manifest.evidence[e.path] || {};
    out.push(`| \`${e.path}\` | ${esc(e.what[lang])} | \`${esc(e.cmd)}\` | ${m.commit || '?'}, ${m.date || '?'} | \`${m.sha256 || '?'}\` |`);
  }
  if ((g.awaited || []).length) {
    out.push('', `**${t.awaitedT}**`, '', t.awHead, '|---|---|---|');
    for (const a of g.awaited) {
      const got = manifest.awaited[a.glob] || [];
      const status = got.length
        ? `${t.present}: ${got.map((p) => `\`${p}\` (${(manifest.evidence[p] || {}).commit || '?'}, \`${(manifest.evidence[p] || {}).sha256 || '?'}\`)`).join(', ')}`
        : `${t.absent} (\`${a.glob}\`)`;
      out.push(`| ${a.lot} | ${esc(a.what[lang])} | ${status} |`);
    }
  }
  out.push('', `## ${t.s3}`, '', bullets(g.notEvidenced[lang]), '');
  out.push(`## ${t.s4}`, '', bullets(g.options[lang]), '');
  out.push(`## ${t.s5}`, '', bullets(g.risks[lang]), '');
  out.push(`## ${t.s6}`, '', bullets(g.supply[lang]), '');
  out.push('---', '', `_${t.footer}_`, '');
  return out.join('\n');
}

function renderIndex(source, manifest) {
  const order = dependencyOrder(source.gates);
  const pilot = pilotPath(source.gates);
  const byId = new Map(source.gates.map((g) => [g.id, g]));
  const out = [];
  out.push('# Gate dossiers — index and critical path / Dossiers des portes — index et chemin critique', '');
  out.push(`Target SHA / SHA cible: \`${manifest.target_sha}\` · Generated / Généré: ${manifest.generated} · Source: \`${SOURCE}\``, '');
  out.push('**No decision cell is filled by these dossiers. Every gate below is NO-GO until its approver fills its row in `docs/sdp360/completion/RELEASE-GATES.md`.**');
  out.push('**Aucune case de décision n\'est remplie par ces dossiers. Chaque porte ci-dessous est NO-GO tant que son approbateur n\'a pas rempli sa ligne.**', '');
  out.push('## Critical path to a two-site pilot GO/NO-GO / Chemin critique vers la décision de pilote sur deux sites', '');
  out.push(pilot.map((id) => `\`${id}\` ${byId.get(id).short.en}`).join(' → '), '');
  out.push(pilot.map((id) => `\`${id}\` ${byId.get(id).short.fr}`).join(' → '), '');
  out.push('## All gates in dependency order / Toutes les portes dans l\'ordre des dépendances', '');
  out.push('| # | Gate | Porte | Blocks / Bloque | Decide after / Après | Evidence (cited / awaited) | EN | FR |', '|---|---|---|---|---|---|---|---|');
  order.forEach((id, i) => {
    const g = byId.get(id);
    const aw = (g.awaited || []).filter((a) => !(manifest.awaited[a.glob] || []).length).length;
    out.push(`| ${i + 1} | ${esc(g.short.en)} | ${esc(g.short.fr)} | ${esc(source.blocks[g.blocks].en)} / ${esc(source.blocks[g.blocks].fr)} | ${(g.depends || []).join(', ') || '—'} | ${g.evidence.length} / ${aw} | [EN](en/${fileName(g)}) | [FR](fr/${fileName(g)}) |`);
  });
  out.push('', '## Blocking classes / Classes de blocage', '');
  for (const [k, v] of Object.entries(source.blocks)) out.push(`- \`${k}\` — ${v.en} / ${v.fr} (${source.gates.filter((g) => g.blocks === k).map((g) => g.id).join(', ')})`);
  out.push('', '## Regenerate / Régénérer', '');
  out.push('```', 'node tools/release/gate-dossiers.js --sha=<merge sha>', 'node tools/release/gate-dossiers.js --check', 'node --test tests/gate-dossiers.test.js', '```', '');
  out.push(`_${T.en.footer}_`, '');
  return out.join('\n');
}

function renderAll(source, manifest) {
  const files = { [`${OUT_DIR}/INDEX.md`]: renderIndex(source, manifest) };
  for (const g of source.gates) for (const lang of ['en', 'fr']) files[`${OUT_DIR}/${lang}/${fileName(g)}`] = renderDossier(source, manifest, g, lang);
  return files;
}

function buildManifest(c, targetSha, generated) {
  return {
    note: 'Generated by tools/release/gate-dossiers.js. Do not edit by hand.',
    target_sha: targetSha,
    generated,
    source_sha256: c.sourceHash,
    release_gates_sha256: c.gatesHash,
    rows: c.rows.map((r) => ({ gate: r.gate, scope: r.scope, decision: r.decision })),
    evidence: c.evidence,
    awaited: c.awaited,
  };
}

// Returns a list of reasons the committed dossiers are stale (empty = fresh).
function checkStale(root = ROOT) {
  const reasons = [];
  let manifest;
  try { manifest = JSON.parse(readRel(root, MANIFEST)); } catch { return [`${MANIFEST} missing or unreadable — run the generator`]; }
  const c = collect(root, { withGit: false });
  for (const e of validate(c.source, c.rows)) reasons.push(e);
  for (const p of c.missing) reasons.push(`cited evidence missing from the tree: ${p}`);
  if (c.sourceHash !== manifest.source_sha256) reasons.push('the source changed after the dossiers were generated');
  if (c.gatesHash !== manifest.release_gates_sha256) reasons.push(`${GATES_MD} changed after the dossiers were generated`);
  for (const [p, rec] of Object.entries(c.evidence)) {
    const m = manifest.evidence[p];
    if (!m) reasons.push(`evidence not recorded in the manifest: ${p}`);
    else if (m.sha256 !== rec.sha256) reasons.push(`cited evidence changed after the dossier was generated (dossier cites an older version): ${p}`);
  }
  for (const [glob, list] of Object.entries(c.awaited)) {
    const before = (manifest.awaited || {})[glob] || [];
    if (JSON.stringify(before) !== JSON.stringify(list)) reasons.push(`awaited evidence changed (${glob}): recorded [${before.join(', ')}], now [${list.join(', ')}]`);
  }
  const files = renderAll(c.source, manifest);
  for (const [rel, text] of Object.entries(files)) {
    let cur = null;
    try { cur = norm(readRel(root, rel)); } catch { /* missing */ }
    if (cur !== text) reasons.push(`dossier differs from what the source renders to: ${rel}`);
  }
  for (const lang of ['en', 'fr']) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, OUT_DIR, lang)); } catch { /* none */ }
    for (const n of names) if (!files[`${OUT_DIR}/${lang}/${n}`]) reasons.push(`orphan dossier: ${OUT_DIR}/${lang}/${n}`);
  }
  return reasons;
}

function generate(root = ROOT, { sha } = {}) {
  const c = collect(root, { withGit: true });
  const errors = validate(c.source, c.rows).concat(c.missing.map((p) => `cited evidence missing: ${p}`));
  if (errors.length) throw new Error('gate dossiers: ' + errors.join('\n'));
  const targetSha = sha || git(root, ['rev-parse', '--short', 'HEAD']) || 'UNKNOWN';
  const generated = new Date().toISOString().slice(0, 10);
  const manifest = buildManifest(c, targetSha, generated);
  const files = renderAll(c.source, manifest);
  for (const lang of ['en', 'fr']) {
    const dir = path.join(root, OUT_DIR, lang);
    fs.mkdirSync(dir, { recursive: true });
    for (const n of fs.readdirSync(dir)) if (!files[`${OUT_DIR}/${lang}/${n}`]) fs.unlinkSync(path.join(dir, n));
  }
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), text);
  fs.writeFileSync(path.join(root, MANIFEST), JSON.stringify(manifest, null, 1) + '\n');
  return { count: Object.keys(files).length - 1, targetSha };
}

module.exports = { parseGateRows, resolveGlob, collect, validate, dependencyOrder, pilotPath, renderAll, renderDossier, checkStale, generate, sha256, OUT_DIR, MANIFEST, GATES_MD, SOURCE };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const reasons = checkStale(ROOT);
    if (reasons.length) { console.error('Gate dossiers are STALE — run node tools/release/gate-dossiers.js --sha=<sha>:\n- ' + reasons.join('\n- ')); process.exit(1); }
    console.log('Gate dossiers are fresh.');
  } else {
    const shaArg = args.find((a) => a.startsWith('--sha='));
    const r = generate(ROOT, { sha: shaArg ? shaArg.slice(6) : undefined });
    console.log(`Wrote ${r.count} dossiers + INDEX.md + manifest.json for target ${r.targetSha}.`);
  }
}
