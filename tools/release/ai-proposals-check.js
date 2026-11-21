#!/usr/bin/env node
'use strict';
// AI proposals — renders docs/business-readiness/PROPOSITIONS-IA.md from tools/release/ai-proposals.source.js and checks it.
//
//   node tools/release/ai-proposals-check.js --write   regenerate PROPOSITIONS-IA.md
//   node tools/release/ai-proposals-check.js --check   exit 1 on any problem below (default)
//
// What the check refuses:
//   - a proposal without an item in tools/release/business-readiness.source.js, an item without a proposal, a duplicate;
//   - a choix_propose that is neither one of the item's options (word for word) nor "Option recommandée : …";
//   - a valeurs_proposees key absent from services/reportConfig.js DEFAULTS, or a value its reader would refuse;
//   - any text claiming an approval, a signature or a validation (the proposals decide nothing);
//   - a generated file that differs from what the source renders to.
// It never touches REGISTRE-DECISIONS-HUMAINES.md: the human decision cells stay empty (business-readiness-check.js
// --check keeps refusing a filled one).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = 'docs/business-readiness/PROPOSITIONS-IA.md';
const SOURCE = 'tools/release/ai-proposals.source.js';
const ITEMS = 'tools/release/business-readiness.source.js';
const RECO_PREFIX = 'Option recommandée : ';
// Words that would turn a proposal into a (false) decision record.
const CLAIM = /approuv|\bsign[ée]e?s?\b|validé par|valid[ée]e? par|accepté par|accepte par/i;

const norm = (s) => String(s).replace(/\r\n/g, '\n');
const freshRequire = (file) => { delete require.cache[require.resolve(file)]; return require(file); };
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function load(root = ROOT) {
  const src = freshRequire(path.join(root, ITEMS));
  const { proposals } = freshRequire(path.join(root, SOURCE));
  return { src, proposals };
}

function textOf(p) {
  return [p.choix_propose, p.justification, p.verification_test_final, p.risque_si_accepte, p.acte_humain || ''].join(' ');
}

function validate(root = ROOT) {
  const { src, proposals } = load(root);
  const { DEFAULTS, canonicalValue } = freshRequire(path.join(root, 'services', 'reportConfig.js'));
  const out = [];
  const byId = new Map(src.items.map((i) => [i.id, i]));
  const seen = new Set();
  for (const p of proposals) {
    if (seen.has(p.id)) out.push(`${SOURCE}: duplicate proposal ${p.id}`);
    seen.add(p.id);
    const it = byId.get(p.id);
    if (!it) { out.push(`${SOURCE}: ${p.id} has no item in ${ITEMS}`); continue; }
    if (typeof p.choix_propose !== 'string' || !(it.options.includes(p.choix_propose) || (p.choix_propose.startsWith(RECO_PREFIX) && p.choix_propose.length > RECO_PREFIX.length + 10))) {
      out.push(`${SOURCE}: ${p.id} choix_propose "${p.choix_propose}" is neither an option of the item nor "${RECO_PREFIX}…"`);
    }
    for (const f of ['justification', 'verification_test_final', 'risque_si_accepte']) {
      if (typeof p[f] !== 'string' || p[f].trim().length < 5) out.push(`${SOURCE}: ${p.id} ${f} is empty`);
    }
    if (typeof p.reversible !== 'boolean') out.push(`${SOURCE}: ${p.id} reversible must be true or false`);
    for (const [k, v] of Object.entries(p.valeurs_proposees || {})) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) { out.push(`${SOURCE}: ${p.id} key ${k} is not in reportConfig DEFAULTS`); continue; }
      try { canonicalValue(k, v); } catch (e) { out.push(`${SOURCE}: ${p.id} ${k}=${JSON.stringify(v)} refused by its reader (${e.message})`); }
    }
    const m = textOf(p).match(CLAIM);
    if (m) out.push(`${SOURCE}: ${p.id} contains a decision claim ("${m[0]}") — a proposal decides nothing`);
  }
  for (const it of src.items) if (!seen.has(it.id)) out.push(`${SOURCE}: item ${it.id} has no proposal`);
  return out;
}

function render(root = ROOT) {
  const { src, proposals } = load(root);
  const byId = new Map(src.items.map((i) => [i.id, i]));
  const rows = proposals.map((p) => ({ p, it: byId.get(p.id) })).filter((r) => r.it);
  const L = [];
  L.push('# Propositions IA pour les décisions humaines en attente — SDP360');
  L.push('');
  L.push('> **PROPOSITIONS IA — non approuvées. Chaque ligne attend la validation du propriétaire lors de son test final.');
  L.push('> Aucune case de décision humaine n\'est remplie.**');
  L.push('>');
  L.push(`> Document généré par \`node tools/release/ai-proposals-check.js --write\` à partir de \`${SOURCE}\` — ne pas`);
  L.push('> éditer à la main. Le propriétaire a délégué l\'analyse à un agent IA ; les règles du dépôt');
  L.push('> (`.claude/rules/SDP360_BOUNDARIES.md`) interdisent malgré tout d\'inventer une approbation, une signature, une mise');
  L.push('> en production ou une acceptation terrain. Les cases Décision, Nom, Date et Signature de');
  L.push('> `docs/business-readiness/REGISTRE-DECISIONS-HUMAINES.md` restent **vides**. Les valeurs de configuration proposées ne');
  L.push('> s\'appliquent qu\'à une base de TEST, par `node tools/release/final-test-profile.js` (simulation par défaut).');
  L.push('');
  L.push(`Total : **${rows.length} propositions** pour ${src.items.length} décisions en attente.`);
  L.push('');
  L.push('## Synthèse par décideur');
  L.push('');
  L.push('| Décideur (rôle) | Propositions | Réversibles | Avec valeurs de test | Acte humain physique requis |');
  L.push('|---|---|---|---|---|');
  let tot = [0, 0, 0, 0];
  for (const d of src.DECIDEURS) {
    const r = rows.filter((x) => x.it.decideur === d);
    if (!r.length) continue;
    const c = [r.length, r.filter((x) => x.p.reversible).length, r.filter((x) => x.p.valeurs_proposees).length, r.filter((x) => x.p.acte_humain).length];
    tot = tot.map((t, i) => t + c[i]);
    L.push(`| ${d} | ${c.join(' | ')} |`);
  }
  L.push(`| **Total** | **${tot.join('** | **')}** |`);
  L.push('');
  L.push('## Actes humains ou d\'autorité requis quelle que soit la délégation');
  L.push('');
  L.push('Ces propositions ne suffisent pas : une personne ou une instance doit encore agir physiquement (réunion, test, clé,');
  L.push('consentement, avis, exercice). L\'IA ne peut ni le faire ni le déclarer fait.');
  L.push('');
  L.push('| Id | Décideur | Acte requis |');
  L.push('|---|---|---|');
  for (const { p, it } of rows) if (p.acte_humain) L.push(`| ${p.id} | ${esc(it.decideur)} | ${esc(p.acte_humain)} |`);
  for (const d of src.DECIDEURS) {
    const r = rows.filter((x) => x.it.decideur === d);
    if (!r.length) continue;
    L.push('');
    L.push(`## ${d} (${r.length})`);
    for (const { p, it } of r) {
      L.push('');
      L.push(`### ${p.id} — ${it.sujet}`);
      L.push('');
      L.push(`- **Choix proposé :** ${p.choix_propose}`);
      L.push(`- **Justification :** ${p.justification}`);
      L.push(`- **À vérifier au test final :** ${p.verification_test_final}`);
      L.push(`- **Réversible :** ${p.reversible ? 'oui' : 'non'}`);
      if (p.valeurs_proposees) L.push(`- **Valeurs proposées (base de TEST seulement) :** ${Object.entries(p.valeurs_proposees).map(([k, v]) => `\`${k}\` = \`${v}\``).join(', ')}`);
      L.push(`- **Risque si accepté :** ${p.risque_si_accepte}`);
      if (p.acte_humain) L.push(`- **Acte humain encore requis :** ${p.acte_humain}`);
    }
  }
  L.push('');
  return L.join('\n');
}

function stale(root = ROOT) {
  const p = path.join(root, OUT);
  if (!fs.existsSync(p) || norm(fs.readFileSync(p, 'utf8')) !== render(root)) return [`${OUT} is stale — run node tools/release/ai-proposals-check.js --write`];
  return [];
}

function check(root = ROOT) { return [...validate(root), ...stale(root)]; }

module.exports = { ROOT, OUT, SOURCE, RECO_PREFIX, CLAIM, load, validate, render, stale, check };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--write')) {
    const problems = validate(ROOT);
    if (problems.length) { process.stderr.write(problems.join('\n') + '\n'); process.exit(1); }
    fs.writeFileSync(path.join(ROOT, OUT), render(ROOT));
    process.stdout.write(`ai-proposals: ${OUT} written\n`);
  }
  if (args.includes('--check') || !args.includes('--write')) {
    const problems = check(ROOT);
    if (problems.length) { process.stderr.write(problems.join('\n') + '\n'); process.exit(1); }
    process.stdout.write('ai-proposals: OK\n');
  }
}
