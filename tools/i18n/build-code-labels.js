#!/usr/bin/env node
'use strict';
// I18N-QUALITY (2026-11-21) — builds public/lib/codeLabels.js from the shipped lookup seeds, so the EN/FR label
// of a code shown to a user comes from the SAME table the database is seeded from (never invented here).
//   node tools/i18n/build-code-labels.js          rewrite the generated block
//   node tools/i18n/build-code-labels.js --check  exit 1 if the file is out of date (CI / tests)
// Sources: meetings-init.json (name_en / name_fr), inspection-init.json (label_en / label_fr | name_en / name_fr),
// public/lib/statusTransfer.js (status labels). Codes with no seed (project / portfolio / RAG vocabularies) come
// from the UI table UI_CODES below — interface vocabulary translated against docs/i18n/GLOSSAIRE-FR.md.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'public', 'lib', 'codeLabels.js');
const BEGIN = '/* <generated:code-labels> — tools/i18n/build-code-labels.js, do not edit by hand */';
const END = '/* </generated:code-labels> */';

// Interface vocabularies with no lookup table. Glossary-aligned (proposition IA — à relire, D-2).
const UI_CODES = {
  project_status: {
    todo: ['To do', 'À faire'], planned: ['Planned', 'Planifié'], active: ['Active', 'Actif'], in_progress: ['In progress', 'En cours'],
    on_track: ['On track', 'Dans les temps'], at_risk: ['At risk', 'À risque'], late: ['Late', 'En retard'], blocked: ['Blocked', 'Bloqué'],
    on_hold: ['On hold', 'En attente'], done: ['Done', 'Terminé'], delivered: ['Delivered', 'Livré'], accepted: ['Accepted', 'Accepté'],
    rejected: ['Rejected', 'Rejeté'], cancelled: ['Cancelled', 'Annulé'], closed: ['Closed', 'Clôturé'], open: ['Open', 'Ouvert'],
    submitted: ['Submitted', 'Soumis'], triaged: ['Triaged', 'Trié'], scheduled: ['Scheduled', 'Programmé'], live: ['Live', 'En service'],
    draft: ['Draft', 'Brouillon'], proposal: ['Proposal', 'Proposition'], approval: ['Approval', 'Approbation'], closure: ['Closure', 'Clôture'],
    stopped: ['Stopped', 'Arrêté'],
  },
  priority: { critical: ['Critical', 'Critique'], high: ['High', 'Élevée'], medium: ['Medium', 'Moyenne'], low: ['Low', 'Faible'] },
  rag: { GREEN: ['Green', 'Vert'], AMBER: ['Amber', 'Orange'], RED: ['Red', 'Rouge'], NA: ['Not measured', 'Non mesuré'] },
  dept_status: { on_track: ['On track', 'Dans les temps'], blocked: ['Blocked', 'Bloqué'], no_pv: ['No PV this month', 'Aucun PV ce mois-ci'] },
  // VISUAL POLISH 3 — codes that were still printed raw on assets, reports (admin), the Exec View and the Scorecard
  asset_source: { ad: ['Active Directory', 'Active Directory'], entra: ['Microsoft Entra', 'Microsoft Entra'], defender: ['Microsoft Defender', 'Microsoft Defender'], sdp: ['ServiceDesk Plus', 'ServiceDesk Plus'] },
  site_status: { operational: ['Operational', 'Opérationnel'], degraded: ['Degraded', 'Dégradé'], major: ['Major incident', 'Incident majeur'], unknown: ['Not measured', 'Non mesuré'] },
  record_module: { meetings: ['Meetings', 'Réunions'], inspection: ['Inspections', 'Inspections'], reports: ['Weekly reports', 'Rapports hebdomadaires'], tracker: ['Activity tracker', 'Suivi d’activité'],
    portfolio: ['Portfolio', 'Portefeuille'], governance: ['Governance', 'Gouvernance'], dashboards: ['Dashboards', 'Tableaux de bord'], users: ['Users', 'Utilisateurs'] },
  completion: { done: ['Done', 'Fait'], partial: ['Partial', 'Partiel'], missing: ['Missing', 'Manquant'] },
  weekly_report_status: { draft: ['In progress', 'En cours'], in_progress: ['In progress', 'En cours'], ready: ['Complete but not submitted', 'Complet mais non soumis'], submitted: ['Submitted', 'Soumis'] },
  service_status: { active: ['Active', 'Actif'], in_progress: ['In progress', 'En cours'], planned: ['Planned', 'Planifié'], stopped: ['Stopped', 'Arrêté'] },
};

function pairs(rows, en, fr, code) {
  const out = {};
  for (const r of rows || []) out[r[code || 'code']] = [r[en], r[fr]];
  return out;
}
function build() {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'meetings-init.json'), 'utf8'));
  const i = JSON.parse(fs.readFileSync(path.join(ROOT, 'inspection-init.json'), 'utf8'));
  const ST = require(path.join(ROOT, 'public', 'lib', 'statusTransfer.js'));
  const kinds = {
    meeting_issue_status: pairs(m.statuses, 'name_en', 'name_fr'),
    severity: pairs(m.severities, 'name_en', 'name_fr'),
    meeting_status: pairs(m.meeting_statuses, 'name_en', 'name_fr'),
    department: pairs(m.departments, 'name_en', 'name_fr'),
    category: pairs(m.categories, 'name_en', 'name_fr'),
    intake_source: pairs(m.intake_sources, 'name_en', 'name_fr'),
    escalation_reason: pairs(m.escalation_reasons, 'name_en', 'name_fr'),
    council_theme: pairs(m.council_themes, 'name_en', 'name_fr'),
    project_phase: pairs(m.project_phases, 'name_en', 'name_fr'),
    it_involvement: pairs(m.it_involvement_levels, 'name_en', 'name_fr'),
    inspection_finding: pairs(i.statuses, 'label_en', 'label_fr'),
    inspection_type: pairs(i.types, 'label_en', 'label_fr'),
    inspection_area: pairs(i.areas, 'name_en', 'name_fr'),
    inspection_category: pairs(i.categories, 'name_en', 'name_fr', 'id'),
    transfer_status: Object.fromEntries(['demand', 'helpdesk_ticket', 'cancelled'].map((c) => [c, [ST.label(c, 'en'), ST.label(c, 'fr')]])),
  };
  for (const [k, v] of Object.entries(UI_CODES)) kinds[k] = v;
  return kinds;
}
function render(kinds) {
  const lines = Object.keys(kinds).map((k) => '    ' + JSON.stringify(k) + ': ' + JSON.stringify(kinds[k]) + ',');
  return BEGIN + '\n  const KINDS = {\n' + lines.join('\n') + '\n  };\n  ' + END;
}
// Lookup DISPLAY names (name_en → name_fr) for the page layer: public/lib/i18n/common.fr.js → I18N_FR_LOOKUPS, merged by
// boot.js after the common words. Single words are left out unless listed (« Survey » is a department here and a
// customer survey elsewhere, « Support », « Lead », « Other »… are too ambiguous for an exact-text swap): those
// become 'Word@status' keys, used by lib/i18nText.js only inside an <option> or a status place.
const COMMON = path.join(ROOT, 'public', 'lib', 'i18n', 'common.fr.js');
const LBEGIN = '/* <generated:lookup-labels> — tools/i18n/build-code-labels.js, do not edit by hand */';
const LEND = '/* </generated:lookup-labels> */';
const SINGLE_OK = new Set(['Mining', 'Geology', 'Engineering', 'Cybersecurity', 'Connectivity', 'Licensing', 'Scoping', 'Closeout', 'Co-deliver', 'Advisory']);
function lookupPairs() {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'meetings-init.json'), 'utf8'));
  const out = {};
  for (const k of ['departments', 'categories', 'intake_sources', 'escalation_reasons', 'council_themes', 'project_phases', 'it_involvement_levels']) {
    for (const r of m[k] || []) {
      const en = String(r.name_en || '').trim(), fr = String(r.name_fr || '').trim();
      if (!en || !fr || en === fr) continue;
      // an ambiguous single word is only swapped where it is a picked value (an <option>, a status pill): 'Survey@status'
      out[!/\s/.test(en) && !SINGLE_OK.has(en) ? en + '@status' : en] = fr;
    }
  }
  return out;
}
function renderLookups(pairs) {
  return LBEGIN + '\n  root.I18N_FR_LOOKUPS = ' + JSON.stringify(pairs, null, 4).replace(/\n}$/, '\n  }').replace(/\n {4}/g, '\n    ') + ';\n  ' + LEND;
}
function regen(file, begin, end, body) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(begin), b = src.indexOf(end);
  if (a < 0 || b < a) throw new Error('generated markers not found in ' + file);
  return { src, next: src.slice(0, a) + body + src.slice(b + end.length) };
}
function main() {
  const L = regen(COMMON, LBEGIN, LEND, renderLookups(lookupPairs()));
  if (process.argv.includes('--check') && L.next !== L.src) { console.error('public/lib/i18n/common.fr.js lookup block is out of date — run node tools/i18n/build-code-labels.js'); process.exit(1); }
  if (!process.argv.includes('--check') && L.next !== L.src) fs.writeFileSync(COMMON, L.next);
  const src = fs.readFileSync(OUT, 'utf8');
  const a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < a) throw new Error('generated markers not found in ' + OUT);
  const next = src.slice(0, a) + render(build()) + src.slice(b + END.length);
  if (process.argv.includes('--check')) {
    if (next !== src) { console.error('public/lib/codeLabels.js is out of date — run node tools/i18n/build-code-labels.js'); process.exit(1); }
    console.log('codeLabels.js up to date'); return;
  }
  if (next !== src) fs.writeFileSync(OUT, next);
  console.log('codeLabels.js written (' + Object.keys(build()).length + ' kinds)');
}
if (require.main === module) main();
module.exports = { build, render, UI_CODES, lookupPairs };
