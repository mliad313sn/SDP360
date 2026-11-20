'use strict';
// PORTFOLIO LOT 2 (spec §4, §4.3, §20) — the field catalogue the data-quality engine and the submission checklist read.
// It EXTENDS the Lot 1 guidance (services/ppm/intakeFields.GUIDE) — the intake entries are reused as they are, never
// copied — with the entries for the existing project fields the intake tab does not edit (name, planned dates, budget
// amount, status, dependencies, risks). Each entry says which data-quality checks it feeds and whether the PROPOSED
// required set (services/ppm/dataQuality.CHECKS) counts it. PURE: no I/O.
const IF = require('./intakeFields');
const DQ = require('./dataQuality');

const g = (key, section, level, en, fr) => ({ key, section, level, en, fr, managed_elsewhere: true });
// existing project fields (edited on the portfolio / project pages, not on the intake tab)
const EXTRA = [
  g('name', 'identity', 'required',
    { label: 'Project name', description: 'A short name that says what the project delivers.', why: 'It is how everyone finds and talks about the project.', example: 'Hounde WAN redundancy', mistake: 'A code or a vendor name only ("Project X", "Cisco").' },
    { label: 'Nom du projet', description: 'Un nom court qui dit ce que le projet livre.', why: 'C’est ainsi que chacun retrouve le projet et en parle.', example: 'Redondance WAN Hounde', mistake: 'Un code ou un nom de fournisseur seul (« Projet X », « Cisco »).' }),
  g('start_date', 'schedule', 'required',
    { label: 'Planned start', description: 'The planned start date, a real date (YYYY-MM-DD).', why: 'Places the project on the roadmap and in the capacity load.', example: '2027-03-01', mistake: 'A quarter or "TBC" — those go in the indicative quarter and schedule confidence.' },
    { label: 'Début prévu', description: 'La date de début prévue, une vraie date (AAAA-MM-JJ).', why: 'Place le projet sur la feuille de route et dans la charge.', example: '2027-03-01', mistake: 'Un trimestre ou « à confirmer » — ils vont dans le trimestre indicatif et la confiance.' }),
  g('end_date', 'schedule', 'required',
    { label: 'Planned end', description: 'The planned end date, not before the start.', why: 'A start after the end is an invalid schedule and blocks approval when enforcement is on.', example: '2027-09-30', mistake: 'An end date before the start date.' },
    { label: 'Fin prévue', description: 'La date de fin prévue, pas avant le début.', why: 'Un début après la fin est un planning invalide qui bloque l’approbation quand le contrôle est actif.', example: '2027-09-30', mistake: 'Une date de fin antérieure au début.' }),
  g('budget', 'budget', 'required',
    { label: 'Budget estimate', description: 'The estimated amount in its currency (shown to the money readers only).', why: 'Separates funded work from wishes.', example: '180 000 USD', mistake: 'Leaving 0 when the amount is simply unknown — leave it empty or mark it TBC.' },
    { label: 'Estimation budgétaire', description: 'Le montant estimé dans sa devise (visible des lecteurs autorisés aux montants seulement).', why: 'Sépare le travail financé des souhaits.', example: '180 000 USD', mistake: 'Laisser 0 quand le montant est simplement inconnu — le laisser vide ou le marquer « à confirmer ».' }),
  g('status', 'identity', 'required',
    { label: 'Project status', description: 'Where the project stands today.', why: 'Drives every list and dashboard of the portfolio.', example: 'Planned', mistake: 'Keeping "Planned" on a project already under way.' },
    { label: 'Statut du projet', description: 'Où en est le projet aujourd’hui.', why: 'Alimente toutes les listes et tableaux de bord du portefeuille.', example: 'Planifié', mistake: 'Garder « Planifié » sur un projet déjà commencé.' }),
  g('dependencies', 'resources', 'required',
    { label: 'Dependencies', description: 'Projects this one depends on — or "none known" when you checked and there is none.', why: 'A hidden dependency is the usual cause of a slipped date.', example: 'Depends on PRJ-2027-004 (core switch replacement)', mistake: 'Leaving it empty when nobody looked.' },
    { label: 'Dépendances', description: 'Les projets dont celui-ci dépend — ou « aucune connue » après vérification.', why: 'Une dépendance cachée est la cause habituelle d’un glissement.', example: 'Dépend de PRJ-2027-004 (remplacement du cœur de réseau)', mistake: 'Laisser vide alors que personne n’a vérifié.' }),
  g('risks', 'resources', 'required',
    { label: 'Key risks', description: 'At least one risk in the risk register — or "none known" when you checked.', why: 'The committee approves a project knowing its risks.', example: 'Vendor lead time over 16 weeks — mitigation: order in Q1', mistake: 'No risk at all on a large project.' },
    { label: 'Risques clés', description: 'Au moins un risque au registre — ou « aucun connu » après vérification.', why: 'Le comité approuve un projet en connaissant ses risques.', example: 'Délai fournisseur de plus de 16 semaines — atténuation : commande au T1', mistake: 'Aucun risque sur un grand projet.' }),
];
// spec name → check field (dataQuality uses column names)
const FIELD_OF = { business_sponsor: 'sponsor', it_owner: 'owner', avg_fte: 'resource_demand', peak_fte: 'resource_demand' };

/** The whole catalogue: Lot 1 entries + the extra ones, each with its data-quality checks. */
function catalogue() {
  const byField = {};
  for (const c of DQ.CHECKS) (byField[c.field] = byField[c.field] || []).push(c);
  for (const c of DQ.CHECKS) if (c.field === 'schedule') { (byField.start_date = byField.start_date || []).push(c); (byField.end_date = byField.end_date || []).push(c); }
  return IF.GUIDE.concat(EXTRA).map((f) => {
    const checks = byField[FIELD_OF[f.key] || f.key] || [];
    return { ...f, dq_checks: checks.map((c) => c.key), dq_required: checks.some((c) => c.kind === 'field'), dq_blocking: checks.some((c) => c.blocking) };
  });
}

/** What the page needs to render the checks and the checklist (all PROPOSED). */
function dqGuide() {
  return { proposed: true, fields: catalogue(), checks: DQ.CHECKS, checklist: DQ.CHECKLIST, policy: DQ.policy() };
}

module.exports = { EXTRA, catalogue, dqGuide };
