#!/usr/bin/env node
'use strict';
// Business-readiness pack — renders two documents and checks all six of docs/business-readiness/.
//
//   node tools/release/business-readiness-check.js --write   regenerate REGISTRE-DECISIONS-HUMAINES.md (from
//                                                            tools/release/business-readiness.source.js) and
//                                                            CHECKLIST-GO-LIVE.md (from the gate-dossier source and
//                                                            the RELEASE-GATES rows)
//   node tools/release/business-readiness-check.js --check   exit 1 on any problem below
//
// What the check refuses, in every document of the pack:
//   - a switch key between backticks that is not in FLAG-REGISTER.json / switch-lots.json (stale key);
//   - a lot id (Lnn) that is not in switch-lots.json, a keep group (K:x) that is not in it;
//   - a gate id (Gnn) that is neither a gate of the dossier source nor a label written in RELEASE-GATES.md;
//   - an `activate-switches.js --apply` line without --lots / --reason, and any --lots value naming an unknown lot
//     or a keep group the tool refuses whatever the flags;
//   - a real (not --dry-run) `--apply` of a lot with a four-eyes switch (P11 r5 N-15) without --second-operator=;
//   - a repository path between backticks that does not exist;
//   - a filled cell in a decision / name / date / signature column of a table that has a signature column;
//   - a document without the label "Préparé par IA — à valider par les responsables nommés";
//   - a generated file that differs from what its sources render to.
// It never writes a decision, a name, a date or a signature: those cells are rendered empty, on purpose.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = 'docs/business-readiness';
const AI_LABEL = 'Préparé par IA — à valider par les responsables nommés';
const DOCS = ['PLAN-PILOTE.md', 'RECETTE-UAT.md', 'GUIDE-UTILISATEUR-PAR-PROFIL.md', 'RUNBOOK-EXPLOITATION.md',
  'REGISTRE-DECISIONS-HUMAINES.md', 'CHECKLIST-GO-LIVE.md'].map((f) => `${OUT_DIR}/${f}`);
const GENERATED = { register: `${OUT_DIR}/REGISTRE-DECISIONS-HUMAINES.md`, checklist: `${OUT_DIR}/CHECKLIST-GO-LIVE.md` };
const SOURCE = 'tools/release/business-readiness.source.js';
const REFUSED_GROUPS = ['source_system_write', 'kill_switch', 'not_a_switch']; // tools/ops/activate-switches.js REFUSED_GROUPS

// Backtick tokens that look like snake_case but are not switches (tables, columns, config fields, json keys).
const NOT_SWITCH = new Set([
  'system_log', 'report_config', 'flag_decisions', 'config_changed', 'switch_rollback_file', 'restore_drill',
  'page_viewed', 'page_usage', 'sli_30d', 'sync_runs', 'sync_job_state', 'audit_chain_anchor', 'audit_chain_broken',
  'sdp_app', 'sdp_audit_owner', 'sdp_dashboard', 'sync_alert_recipients', 'backup_offsite_path', 'internal_error',
  'correlation_id', 'last_job_at', 'field_outbox', 'max_days_on_without_decision', 'live_by_default', 'armed_in_production',
  'external_precondition', 'committee_policy', 'irreversible_or_destructive', 'source_system_write', 'kill_switch',
  'not_a_switch', 'canary_site', 'rollback_trigger', 'success_metric', 'decision_deadline', 'insp_actions', 'md_actions',
  'md_issues', 'ppm_events', 'action_items', 'weekly_reports', 'value_states', 'access_denied', 'db_busy',
  'sync_alert_teams_url', 'pending_status', 'request_records', 'super_admin', 'audit.chain_verify', 'db.backup', 'db.restore_drill', 'user_roles', 'report_sent_log', 'governance_policies',
]);

const norm = (s) => String(s).replace(/\r\n/g, '\n');
const read = (root, rel) => norm(fs.readFileSync(path.join(root, rel), 'utf8'));
const freshRequire = (file) => { delete require.cache[require.resolve(file)]; return require(file); };

// ---------------------------------------------------------------------------------------------------------- known
function loadKnown(root) {
  const reg = JSON.parse(read(root, 'docs/ops/FLAG-REGISTER.json'));
  const plan = JSON.parse(read(root, 'docs/ops/switch-lots.json'));
  const switches = new Set();
  for (const k of ['report_config', 'planned', 'governance_policies', 'environment', 'pseudo', 'dark', 'live']) {
    for (const row of reg[k] || []) if (row && row.key) switches.add(row.key);
  }
  for (const l of plan.lots) for (const s of l.switches) switches.add(s);
  for (const g of Object.values(plan.keep || {})) for (const s of g.switches || []) switches.add(s);
  for (const r of plan.retire || []) switches.add(r.key);
  for (const extra of [plan.dependencies_extra, plan.dependencies_soft]) {
    for (const [k, v] of Object.entries(extra || {})) { switches.add(k); for (const s of [].concat(v)) if (typeof s === 'string') switches.add(s); }
  }
  const { gates } = freshRequire(path.join(root, 'tools', 'release', 'gate-dossiers.source.js'));
  const gateIds = new Set(gates.map((g) => g.id));
  const gateLabels = new Set(read(root, 'docs/sdp360/completion/RELEASE-GATES.md').match(/\bG\d\d\b/g) || []);
  // P11 r5 N-15 — lots whose activation (from the register defaults, outbound excluded) has a four-eyes step
  const fourEyesLots = new Set();
  try {
    const A = freshRequire(path.join(root, 'tools', 'ops', 'activate-switches.js'));
    const cfg = Object.fromEntries((reg.report_config || []).map((r) => [r.key, r.default]));
    // every non-outbound switch of the lot, prerequisites aside (a lot refused from the defaults is applied later, after
    // the lots it depends on — its four-eyes switches still need the second operator then)
    for (const l of plan.lots) {
      if (l.switches.some((k) => !A.OUTBOUND[k] && A.needsFourEyes(cfg, k, k in A.ON_VALUE ? A.ON_VALUE[k] : '1'))) fourEyesLots.add(l.id);
    }
  } catch (_) { /* the tool is unreadable: the other checks still run */ }
  return { switches, lots: new Set(plan.lots.map((l) => l.id)), keep: new Set(Object.keys(plan.keep || {})), gateIds, gateLabels, fourEyesLots, root };
}

// ---------------------------------------------------------------------------------------------------------- scan
const FILE_EXT = /\.(?:html|js|md|json|csv|sql|cmd|ps1|xlsx|png|pem|txt)$/;
const isSwitchLike = (t) => !FILE_EXT.test(t) && /^[a-z][a-z0-9_.]*[a-z0-9]$/.test(t) && /[_.]/.test(t) && !/__|\.\.|_\.|\._/.test(t);
const isPathLike = (t) => t.includes('/') && !t.startsWith('/') && !/[\s<>*{}$]/.test(t) && !t.startsWith('http') && /\.[a-zA-Z0-9]+$/.test(t.split('#')[0]);
const cellsOf = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
const HUMAN_COL = /^(Décision|Decision|Nom|Name|Date|Signature|Visa|Résultat obtenu|Observed result)\b/i;

function scanText(text, known, file) {
  const out = [];
  const md = norm(text);
  if (!md.includes(AI_LABEL)) out.push(`${file}: missing the label "${AI_LABEL}"`);
  // backtick tokens
  for (const m of md.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim();
    if (isPathLike(t)) {
      const rel = t.split('#')[0];
      if (!fs.existsSync(path.join(known.root, rel))) out.push(`${file}: path does not exist: ${rel}`);
      continue;
    }
    if (/\s/.test(t) || !isSwitchLike(t) || NOT_SWITCH.has(t)) continue;
    if (!known.switches.has(t)) out.push(`${file}: unknown switch key \`${t}\` (stale or misspelt)`);
  }
  // lots, keep groups, gates (a repository path between backticks is not a reference: its file name may carry G24)
  const prose = md.replace(/`([^`\n]+)`/g, (all, t) => (isPathLike(t.trim()) ? '``' : all));
  for (const m of prose.matchAll(/\bL(\d\d)\b/g)) if (!known.lots.has(`L${m[1]}`)) out.push(`${file}: unknown lot L${m[1]}`);
  for (const m of prose.matchAll(/\bK:([a-z_]+)/g)) if (!known.keep.has(m[1])) out.push(`${file}: unknown keep group K:${m[1]}`);
  for (const m of prose.matchAll(/\bG(\d\d)\b/g)) {
    const g = `G${m[1]}`;
    if (!known.gateIds.has(g) && !known.gateLabels.has(g)) out.push(`${file}: unknown gate ${g}`);
  }
  // activate-switches commands
  for (const line of md.split('\n')) {
    if (!line.includes('activate-switches.js')) continue;
    if (line.includes('--apply')) {
      if (!line.includes('--lots=')) out.push(`${file}: --apply without --lots: ${line.trim()}`);
      if (!line.includes('--reason=')) out.push(`${file}: --apply without --reason: ${line.trim()}`);
    }
    const lm = line.match(/--lots=([A-Za-z0-9:_,]+)/);
    if (lm) {
      for (const id of lm[1].split(',')) {
        if (id === 'all') { if (line.includes('--apply')) out.push(`${file}: --apply --lots=all is not used in this pack`); continue; }
        if (id.startsWith('K:')) { if (REFUSED_GROUPS.includes(id.slice(2))) out.push(`${file}: keep group ${id} is refused by the tool`); continue; }
        if (!known.lots.has(id)) out.push(`${file}: --lots names unknown lot ${id}`);
        else if (line.includes('--apply') && !line.includes('--dry-run') && !line.includes('--second-operator=') && known.fourEyesLots && known.fourEyesLots.has(id)) {
          out.push(`${file}: --apply of ${id} (a four-eyes switch) without --second-operator=: ${line.trim()}`);
        }
      }
    }
  }
  // human cells in signature tables
  const lines = md.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].startsWith('|') || !/^\|\s*:?-{3}/.test(lines[i + 1])) continue;
    const head = cellsOf(lines[i]).map((c) => c.replace(/[*_`]/g, '').trim());
    if (!head.some((h) => /^(Signature|Visa)\b/i.test(h))) continue;
    const cols = head.map((h, j) => (HUMAN_COL.test(h) ? j : -1)).filter((j) => j >= 0);
    for (let k = i + 2; k < lines.length && lines[k].startsWith('|'); k++) {
      const cells = cellsOf(lines[k]);
      for (const j of cols) if (cells[j]) out.push(`${file}:${k + 1}: human cell "${head[j]}" is filled ("${cells[j]}") — only the decider fills it, in the committee's copy`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------- render
const esc = (s) => String(s).replace(/\|/g, '\\|');

function countByDecider(src) {
  const c = {};
  for (const d of src.DECIDEURS) c[d] = 0;
  for (const it of src.items) c[it.decideur] = (c[it.decideur] || 0) + 1;
  return c;
}

function renderRegister(src) {
  const counts = countByDecider(src);
  const L = [];
  L.push('# Registre des décisions humaines en attente — SDP360');
  L.push('');
  L.push(`> **${AI_LABEL}.** Document généré par \`node tools/release/business-readiness-check.js --write\` à partir de`);
  L.push(`> \`${SOURCE}\` — ne pas éditer à la main. Chaque « Recommandation IA » est une recommandation d'un agent IA,`);
  L.push('> **pas une décision**. Les colonnes Décision, Nom, Date et Signature sont **vides par construction** : elles se');
  L.push('> remplissent dans la copie tenue par le comité de mise en production (et, pour une porte, dans');
  L.push('> `docs/sdp360/completion/RELEASE-GATES.md`). Aucune décision, approbation ou signature n\'a été prise par l\'IA.');
  L.push('');
  L.push(`Total : **${src.items.length} décisions en attente**. Sources consolidées : dossiers des portes (\`docs/agent-execution/gate-dossiers/\`), ADR au statut PROPOSED (\`docs/ai-decisions/\`), journal de décisions 2027, rapport P11 (tours 1 à 4), profil pilote, revue d'adoption, plan de lots d'interrupteurs.`);
  L.push('');
  L.push('## Décomptes par décideur');
  L.push('');
  L.push('| Décideur (rôle) | Décisions en attente |');
  L.push('|---|---|');
  for (const d of src.DECIDEURS) if (counts[d]) L.push(`| ${d} | ${counts[d]} |`);
  L.push(`| **Total** | **${src.items.length}** |`);
  L.push('');
  L.push('Légende de la colonne « Bloque » : `Lnn` = lot d\'interrupteurs (`docs/ops/switch-lots.json`), `Gnn` = porte de mise en production (`docs/agent-execution/gate-dossiers/INDEX.md`), `K:` suivi d\'un nom = groupe gardé éteint par le plan de lots.');
  for (const d of src.DECIDEURS) {
    const rows = src.items.filter((i) => i.decideur === d);
    if (!rows.length) continue;
    L.push('');
    L.push(`## ${d} (${rows.length})`);
    L.push('');
    L.push('| Id | À trancher | Options | Recommandation IA | Bloque | Source | Décision | Nom | Date | Signature |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      L.push(`| ${r.id} | ${esc(r.sujet)} | ${esc(r.options.join(' · '))} | ${esc(r.reco)} | ${esc(r.bloque.join(', '))} | ${r.sources.map((s) => `\`${s}\``).join('<br>')} | | | | |`);
    }
  }
  L.push('');
  return L.join('\n');
}

const BLOCKS_FR = { pilot: 'pilote', 'pilot-if': 'pilote si la fonction est au périmètre', general: 'déploiement général', market: 'diffusion externe' };

function renderChecklist(gates, rows) {
  const byRow = new Map(rows.map((r) => [r.gate, r]));
  const filled = (r) => r && [r.decision, r.name, r.date].some((c) => c);
  const order = ['pilot', 'pilot-if', 'general', 'market'];
  const sorted = [...gates].sort((a, b) => order.indexOf(a.blocks) - order.indexOf(b.blocks) || a.id.localeCompare(b.id));
  const L = [];
  L.push('# Check-list de mise en service (go-live) — les 21 portes');
  L.push('');
  L.push(`> **${AI_LABEL}.** Généré par \`node tools/release/business-readiness-check.js --write\` à partir de`);
  L.push('> `tools/release/gate-dossiers.source.js` et de `docs/sdp360/completion/RELEASE-GATES.md`. Ce document ne remplit');
  L.push('> **aucune** case de décision : une porte est **NO-GO** tant que son approbateur n\'a pas rempli sa ligne dans');
  L.push('> RELEASE-GATES.md. Les preuves citées existent dans le dépôt ; ce qu\'elles ne prouvent pas est dans le dossier');
  L.push('> de chaque porte (section 3).');
  L.push('');
  L.push(`État au moment de la génération : **${rows.filter(filled).length} ligne(s) sur ${rows.length} renseignée(s)** dans RELEASE-GATES.md.`);
  L.push('');
  L.push('## Vue d\'ensemble');
  L.push('');
  L.push('| Porte | Objet | Approbateur (rôle) | Bloque | Preuves disponibles | Ce que seuls des humains fournissent | État RELEASE-GATES | Dossier |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const g of sorted) {
    const r = byRow.get(g.row);
    const state = filled(r) ? 'renseignée — lire RELEASE-GATES.md' : 'vide → NO-GO';
    L.push(`| ${g.id} | ${esc(g.short.fr)} | ${esc(g.approver.fr)} | ${BLOCKS_FR[g.blocks]} | ${g.evidence.length} | ${g.supply.fr.length} | ${state} | \`docs/agent-execution/gate-dossiers/fr/${g.id}-${g.slug}.md\` |`);
  }
  for (const g of sorted) {
    L.push('');
    L.push(`## ${g.id} — ${g.short.fr}`);
    L.push('');
    L.push(`- Ligne RELEASE-GATES : « ${g.row} »`);
    L.push(`- Approbateur : ${g.approver.fr} · bloque : ${BLOCKS_FR[g.blocks]}${g.depends.length ? ` · à décider après : ${g.depends.join(', ')}` : ''}`);
    L.push('');
    L.push('**Preuves déjà disponibles (dépôt)**');
    L.push('');
    for (const e of g.evidence) L.push(`- \`${e.path}\` — ${e.what.fr}`);
    L.push('');
    L.push('**Ce que seuls des humains peuvent fournir**');
    L.push('');
    L.push('| Élément attendu | Décision | Nom | Date | Signature |');
    L.push('|---|---|---|---|---|');
    for (const s of g.supply.fr) L.push(`| ${esc(s)} | | | | |`);
  }
  L.push('');
  return L.join('\n');
}

function renderGenerated(root) {
  const src = freshRequire(path.join(root, SOURCE));
  const { gates } = freshRequire(path.join(root, 'tools', 'release', 'gate-dossiers.source.js'));
  const gd = require('./gate-dossiers.js');
  const rows = gd.parseGateRows(read(root, 'docs/sdp360/completion/RELEASE-GATES.md'));
  return { [GENERATED.register]: renderRegister(src), [GENERATED.checklist]: renderChecklist(gates, rows) };
}

function staleGenerated(root) {
  const out = [];
  for (const [rel, text] of Object.entries(renderGenerated(root))) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p) || norm(fs.readFileSync(p, 'utf8')) !== text) out.push(`${rel} is stale — run node tools/release/business-readiness-check.js --write`);
  }
  return out;
}

function check(root = ROOT) {
  const known = loadKnown(root);
  const out = [];
  for (const rel of DOCS) {
    if (!fs.existsSync(path.join(root, rel))) { out.push(`${rel} is missing`); continue; }
    out.push(...scanText(read(root, rel), known, rel));
  }
  // the source itself must name only real lots / gates / keep groups / switches / paths
  const src = freshRequire(path.join(root, SOURCE));
  for (const it of src.items) {
    for (const b of it.bloque) {
      if (/^L\d\d$/.test(b) && !known.lots.has(b)) out.push(`${SOURCE} ${it.id}: unknown lot ${b}`);
      else if (/^G\d\d$/.test(b) && !known.gateIds.has(b)) out.push(`${SOURCE} ${it.id}: unknown gate ${b}`);
      else if (b.startsWith('K:') && !known.keep.has(b.slice(2))) out.push(`${SOURCE} ${it.id}: unknown keep group ${b}`);
      else if (!/^(L\d\d|G\d\d|K:.+)$/.test(b)) out.push(`${SOURCE} ${it.id}: unrecognised "bloque" entry ${b}`);
    }
    for (const s of it.sources) if (!fs.existsSync(path.join(root, s))) out.push(`${SOURCE} ${it.id}: source does not exist: ${s}`);
  }
  out.push(...staleGenerated(root));
  return out;
}

module.exports = { ROOT, DOCS, AI_LABEL, GENERATED, loadKnown, scanText, check, staleGenerated, renderRegister, renderChecklist, countByDecider };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--write')) {
    for (const [rel, text] of Object.entries(renderGenerated(ROOT))) { fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), text); }
    process.stdout.write('business-readiness: register and checklist written\n');
  }
  if (args.includes('--check') || !args.includes('--write')) {
    const problems = check(ROOT);
    if (problems.length) { process.stderr.write(problems.join('\n') + '\n'); process.exit(1); }
    process.stdout.write(`business-readiness: ${DOCS.length} documents OK\n`);
  }
}
