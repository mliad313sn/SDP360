'use strict';
// PORTFOLIO LOT 1 (spec §5–§18, §31.10) — the project intake fields: which columns exist (migration 117), how a write
// is checked (pure: no I/O, the active reference-list codes are passed in), the explicit value-state convention, the
// warnings a write returns, and the field guidance catalogue (spec §4, EN + FR) the project page shows.
// Used by services/governanceStore.js only while report_config ppm_intake_register_enabled = '1'.
//
// VALUE STATES (ADR-PORTFOLIO-LOT1 §3) — five distinct readings, never collapsed:
//   blank        the field is NULL and value_states has no entry        → unknown, shown "—"
//   zero         a numeric field holds 0                               → a measured value (never "missing")
//   tbc          value_states[field] = 'tbc'                          → someone said "to be confirmed"
//   na           value_states[field] = 'na'                           → not applicable to this project
//   none_known   value_states[field] = 'none_known' (dependencies, risks only) → "we looked, there is none"
// A state is only stored while the field value is NULL: sending a value clears the field's state; sending a state for
// a field that holds (or receives) a value is refused (VALUE_STATE_CONFLICT). Fields whose reference list already
// carries a TBC code (budget_status, decision_required) use that code, not the 'tbc' state.

const LIST_FIELDS = ['project_type', 'priority', 'schedule_confidence', 'budget_status', 'decision_required', 'delivery_effort', 'risk_exposure'];
const TEXT_FIELDS = { expected_value: 4000, delivery_lead: 120, budget_reference: 120, required_skills: 1000, workload_notes: 4000 };
/** Columns of portfolio_projects added by migration 117 (project_ref is generated, never written by a client). */
const INTAKE_COLS = ['project_ref', 'project_type', 'tags', 'priority', 'business_need', 'expected_value', 'delivery_lead', 'indicative_quarter', 'schedule_confidence',
  'budget_status', 'budget_approval_date', 'budget_reference', 'decision_required', 'delivery_effort', 'risk_exposure', 'avg_fte', 'peak_fte', 'required_skills', 'workload_notes', 'value_states'];
/** Columns a client may write (everything but the generated id). */
const WRITABLE = INTAKE_COLS.filter((c) => c !== 'project_ref');
/** Finance metadata of the budget: read with the money rule (stripped like budget / spent). */
const MONEY_ADJACENT = ['budget_status', 'budget_approval_date', 'budget_reference'];
const NEED_PARTS = ['current_situation', 'impact', 'problem', 'required_outcome'];
const STATES = ['tbc', 'na', 'none_known'];
// fields that may carry a state: the intake fields without their own TBC code + existing project fields the intake shows
const STATE_FIELDS = ['project_type', 'priority', 'business_need', 'expected_value', 'delivery_lead', 'indicative_quarter', 'schedule_confidence', 'budget_approval_date', 'budget_reference',
  'delivery_effort', 'risk_exposure', 'avg_fte', 'peak_fte', 'required_skills', 'workload_notes', 'tags', 'budget', 'sponsor', 'owner', 'start_date', 'end_date', 'dependencies', 'risks'];
const NONE_KNOWN_ONLY = ['dependencies', 'risks'];
const MAX_FTE = 1000;

const invalid = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', reason });
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const parse = (v, d) => { if (v == null) return d; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (_) { return d; } };
const BADJSON = Symbol('bad-json');   // a body string that is not JSON: refused, never read as "cleared"
const sameName = (a, b) => !blank(a) && !blank(b) && String(a).trim().toLowerCase().replace(/\s+/g, ' ') === String(b).trim().toLowerCase().replace(/\s+/g, ' ');

/** Calendar day check (YYYY-MM-DD that exists). */
function isDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Map the spec's names onto the existing columns (ADR §2): business_sponsor = sponsor, it_owner = owner. The existing
 * fields keep their rules (owner frozen after proposal, sponsor after approval). A real column sent too wins.
 */
function aliases(body) {
  const b = { ...(body || {}) };
  if (b.business_sponsor !== undefined && b.sponsor === undefined) b.sponsor = b.business_sponsor;
  if (b.it_owner !== undefined && b.owner === undefined) b.owner = b.it_owner;
  delete b.business_sponsor; delete b.it_owner; delete b.project_ref;
  return b;
}

/**
 * Check and normalise the intake part of a project write.
 *   body        the request body (after aliases)
 *   before      the stored row (update) or null (create)
 *   codes       { domain: Set(active codes) } from the reference lists
 * Returns the column patch (only the fields the body carries; value_states merged with the stored map).
 * A list value is checked only when it CHANGES: a stored value whose code was retired since stays as it is.
 */
function normaliseIntake(body, before, codes) {
  const b = body || {}; const out = {};
  const changed = (k, v) => !before || String(before[k] ?? '') !== String(v ?? '');
  for (const f of LIST_FIELDS) {
    if (b[f] === undefined) continue;
    const v = blank(b[f]) ? null : String(b[f]).trim();
    if (v != null && changed(f, v) && !(codes && codes[f] && codes[f].has(v))) throw invalid(`${f} must be one of the active values of its reference list`, 'LOOKUP_VALUE');
    out[f] = v;
  }
  for (const [f, max] of Object.entries(TEXT_FIELDS)) if (b[f] !== undefined) out[f] = blank(b[f]) ? null : String(b[f]).trim().slice(0, max);
  if (b.tags !== undefined) {
    let t = b.tags; if (typeof t === 'string') t = t.split(',');
    if (t != null && !Array.isArray(t)) throw invalid('tags is a list of short words', 'TAGS_INVALID');
    const list = [...new Set((t || []).map((x) => String(x == null ? '' : x).trim().slice(0, 40)).filter(Boolean))];
    if (list.length > 20) throw invalid('20 tags at most', 'TAGS_INVALID');
    out.tags = list.length ? JSON.stringify(list) : null;
  }
  if (b.business_need !== undefined) {
    const n = blank(b.business_need) ? null : parse(b.business_need, BADJSON);
    if (n === BADJSON || n != null && (typeof n !== 'object' || Array.isArray(n))) throw invalid('business_need has four parts: current_situation, impact, problem, required_outcome', 'BUSINESS_NEED_INVALID');
    const o = {}; for (const k of NEED_PARTS) if (n && !blank(n[k])) o[k] = String(n[k]).trim().slice(0, 2000);
    out.business_need = Object.keys(o).length ? JSON.stringify(o) : null;
  }
  if (b.indicative_quarter !== undefined) {
    const q = blank(b.indicative_quarter) ? null : String(b.indicative_quarter).trim().toUpperCase();
    if (q != null && !/^(19[7-9]\d|2[01]\d\d|2200)-Q[1-4]$/.test(q)) throw invalid('indicative quarter is written YYYY-Qn, e.g. 2027-Q2 (exact dates go in the planned dates)', 'QUARTER_INVALID');
    out.indicative_quarter = q;
  }
  if (b.budget_approval_date !== undefined) {
    const d = blank(b.budget_approval_date) ? null : String(b.budget_approval_date).trim().slice(0, 10);
    if (d != null && !isDay(d)) throw invalid('budget approval date must be a real date YYYY-MM-DD', 'DATE_INVALID');
    out.budget_approval_date = d;
  }
  for (const f of ['avg_fte', 'peak_fte']) {
    if (b[f] === undefined) continue;
    const n = blank(b[f]) ? null : Number(b[f]);
    if (n != null && !(Number.isFinite(n) && n >= 0 && n <= MAX_FTE)) throw invalid('FTE is a number from 0 (e.g. 0.5); leave it empty when unknown', 'FTE_INVALID');
    out[f] = n == null ? null : Math.round(n * 100) / 100;
  }
  const avg = out.avg_fte !== undefined ? out.avg_fte : before ? (before.avg_fte == null ? null : Number(before.avg_fte)) : null;
  const peak = out.peak_fte !== undefined ? out.peak_fte : before ? (before.peak_fte == null ? null : Number(before.peak_fte)) : null;
  if (avg != null && peak != null && peak < avg) throw invalid('peak FTE cannot be lower than average FTE', 'FTE_PEAK_BELOW_AVERAGE');
  // value states: merge the sent map onto the stored one; a sent value clears its field's state
  const stored = before ? parse(before.value_states, {}) || {} : {};
  const states = { ...stored };
  if (b.value_states !== undefined) {
    const sent = blank(b.value_states) ? null : parse(b.value_states, BADJSON);
    if (sent === BADJSON || sent != null && (typeof sent !== 'object' || Array.isArray(sent))) throw invalid('value_states is a map {field: tbc | na | none_known}', 'VALUE_STATE_INVALID');
    for (const [f, s] of Object.entries(sent || {})) {
      if (!STATE_FIELDS.includes(f)) throw invalid(`${f} cannot carry a value state`, 'VALUE_STATE_FIELD');
      if (s == null || s === '') { delete states[f]; continue; }
      if (!STATES.includes(s)) throw invalid('a value state is tbc | na | none_known', 'VALUE_STATE_INVALID');
      if (NONE_KNOWN_ONLY.includes(f) !== (s === 'none_known')) throw invalid(NONE_KNOWN_ONLY.includes(f) ? `${f} takes the state none_known only` : 'none_known is for dependencies and risks only', 'VALUE_STATE_INVALID');
      states[f] = s;
    }
  }
  const valueOf = (f) => (b[f] !== undefined ? (out[f] !== undefined ? out[f] : b[f]) : before ? before[f] : null);
  for (const f of Object.keys(states)) {
    if (NONE_KNOWN_ONLY.includes(f)) continue;
    if (!blank(valueOf(f))) {
      const sentState = b.value_states !== undefined && (parse(b.value_states, {}) || {})[f];
      if (sentState) throw invalid(`${f} has a value: a value state is only for an empty field`, 'VALUE_STATE_CONFLICT');
      delete states[f];   // the value now answers the question
    }
  }
  if (b.value_states !== undefined || JSON.stringify(states) !== JSON.stringify(stored)) out.value_states = Object.keys(states).length ? JSON.stringify(states) : null;
  return out;
}

/**
 * Warnings (never a refusal — PROPOSED rules): roles held by the same person, and a zero budget not marked
 * "not budgeted" (0 stays a measured value; spec §20 calls it missing, ADR §4 keeps it and flags it).
 */
function intakeWarnings(row) {
  const r = row || {}; const w = [];
  const s = r.sponsor, o = r.owner, d = r.delivery_lead;
  if (sameName(s, o) && sameName(o, d)) w.push({ code: 'ROLES_SAME_PERSON', message: 'the business sponsor, the IT owner and the delivery lead are the same person — the three roles are meant to be held by different people (proposed rule, not enforced)' });
  else if (sameName(s, o) || sameName(s, d) || sameName(o, d)) w.push({ code: 'ROLES_OVERLAP', message: 'two of the three roles (business sponsor, IT owner, delivery lead) are held by the same person (proposed rule, not enforced)' });
  if (r.budget != null && r.budget !== '' && Number(r.budget) === 0 && r.budget_status !== 'not_budgeted') w.push({ code: 'BUDGET_ZERO', message: 'the budget is 0 while its status is not "not budgeted" — check it (a zero is kept as a measured value, never as unknown)' });
  return w;
}

/** The read shape of the intake fields (JSON parsed, numbers as numbers, the calculated calendar duration). */
function readIntake(r) {
  const out = {};
  for (const c of INTAKE_COLS) out[c] = r[c] === undefined ? null : r[c];
  out.tags = parse(r.tags, null);
  out.business_need = parse(r.business_need, null);
  // P11 R4-2 — "a state is only stored while the field value is NULL": a value written while the register was off
  // (lot rollback) leaves its stale state in the column until the next intake write; the value answers, so the read
  // ignores the state (dependencies / risks are lists elsewhere, never a column here: their state is kept).
  const vs = parse(r.value_states, null);
  out.value_states = {};
  if (vs && typeof vs === 'object' && !Array.isArray(vs)) for (const [f, st] of Object.entries(vs)) if (NONE_KNOWN_ONLY.includes(f) || blank(r[f])) out.value_states[f] = st;
  out.avg_fte = r.avg_fte == null ? null : Number(r.avg_fte);
  out.peak_fte = r.peak_fte == null ? null : Number(r.peak_fte);
  // spec §10: duration = planned end − planned start + 1 (calendar days); null until both dates are valid
  out.planned_duration_days = isDay(r.start_date) && isDay(r.end_date) && r.end_date >= r.start_date
    ? Math.round((Date.parse(r.end_date + 'T00:00:00Z') - Date.parse(r.start_date + 'T00:00:00Z')) / 86400000) + 1 : null;
  return out;
}

// ── Field guidance (spec §4). level: required | recommended | automatic — PROPOSED: which fields are required is a
// PMO decision (Lot 2 enforces nothing until it is taken). Texts are guidance, not policy.
const g = (key, section, level, en, fr) => ({ key, section, level, en, fr });
const GUIDE = [
  g('project_ref', 'identity', 'automatic',
    { label: 'Project ID', description: 'Permanent identifier PRJ-YEAR-NUMBER given by the system when the project is created.', why: 'Every report, decision and dependency points to the project by this id, whatever the sorting or later deletions.', example: 'PRJ-2027-025', mistake: 'Reusing a row number or a spreadsheet position as an id.' },
    { label: 'Identifiant projet', description: 'Identifiant permanent PRJ-ANNÉE-NUMÉRO attribué par le système à la création.', why: 'Rapports, décisions et dépendances désignent le projet par cet identifiant, quel que soit le tri ou les suppressions.', example: 'PRJ-2027-025', mistake: 'Réutiliser un numéro de ligne ou une position de tableur comme identifiant.' }),
  g('project_type', 'identity', 'required',
    { label: 'Project type', description: 'The one dominant category of the project.', why: 'Groups the portfolio for capacity and investment views.', example: 'Network / Telecom', mistake: 'Choosing "Other" when a precise type fits; picking several types (use tags for secondary ones).' },
    { label: 'Type de projet', description: 'La catégorie dominante du projet, une seule.', why: 'Regroupe le portefeuille pour les vues capacité et investissement.', example: 'Réseau / Télécom', mistake: 'Choisir « Autre » alors qu’un type précis convient ; cocher plusieurs types (les étiquettes servent aux types secondaires).' }),
  g('tags', 'identity', 'recommended',
    { label: 'Tags', description: 'Optional secondary categories, comma separated.', why: 'Finds cross-cutting projects (e.g. cybersecurity work inside an infrastructure project).', example: 'cybersecurity, OT', mistake: 'Repeating the project type as a tag.' },
    { label: 'Étiquettes', description: 'Catégories secondaires facultatives, séparées par des virgules.', why: 'Retrouve les projets transverses (par ex. un volet cyber dans un projet d’infrastructure).', example: 'cybersécurité, OT', mistake: 'Répéter le type de projet en étiquette.' }),
  g('affected_sites', 'identity', 'recommended',
    { label: 'Affected sites', description: 'Other sites touched by the project; the primary site owns it.', why: 'Shows the load each site carries, including projects led elsewhere.', example: 'Primary: Group / Multi-site — affected: Hounde, Mana', mistake: 'Creating one project per site for a single cross-site initiative.' },
    { label: 'Sites concernés', description: 'Autres sites touchés par le projet ; le site principal en est propriétaire.', why: 'Montre la charge de chaque site, y compris pour les projets pilotés ailleurs.', example: 'Principal : Groupe / Multi-sites — concernés : Hounde, Mana', mistake: 'Créer un projet par site pour une seule initiative multi-sites.' }),
  g('priority', 'identity', 'required',
    { label: 'Priority', description: 'Critical, High, Medium or Low — the meanings are proposed, not approved.', why: 'Orders the portfolio when capacity is short.', example: 'Critical — unsupported core switch at the processing plant', mistake: 'Marking everything Critical.' },
    { label: 'Priorité', description: 'Critique, Haute, Moyenne ou Basse — les définitions sont proposées, non approuvées.', why: 'Ordonne le portefeuille quand la capacité manque.', example: 'Critique — commutateur cœur non supporté à l’usine', mistake: 'Tout marquer Critique.' }),
  g('business_need', 'business_case', 'required',
    { label: 'Business need / problem', description: 'Why the project must exist: current situation, business impact, problem, required outcome.', why: 'Lets the committee judge the need without a meeting.', example: 'Current: single WAN link at the mine. Impact: production reporting stops during outages. Problem: no redundancy. Outcome: automatic failover.', mistake: 'Describing the solution ("buy a firewall") instead of the problem.' },
    { label: 'Besoin / problème métier', description: 'Pourquoi le projet doit exister : situation actuelle, impact métier, problème, résultat attendu.', why: 'Permet au comité de juger le besoin sans réunion.', example: 'Actuel : un seul lien WAN à la mine. Impact : le reporting production s’arrête pendant les coupures. Problème : pas de redondance. Résultat : bascule automatique.', mistake: 'Décrire la solution (« acheter un pare-feu ») au lieu du problème.' }),
  g('expected_value', 'business_case', 'required',
    { label: 'Expected business value', description: 'What will be better, and how it can be measured — separate from the problem.', why: 'The value is what the benefits review checks later.', example: 'Fewer than 2 hours of reporting downtime per quarter (today 14 hours).', mistake: 'Vague text: "Improve IT", "Modernize infrastructure".' },
    { label: 'Valeur métier attendue', description: 'Ce qui sera meilleur, et comment le mesurer — distinct du problème.', why: 'C’est cette valeur que la revue des bénéfices vérifie ensuite.', example: 'Moins de 2 heures d’arrêt du reporting par trimestre (14 heures aujourd’hui).', mistake: 'Un texte vague : « Améliorer l’IT », « Moderniser l’infrastructure ».' }),
  g('business_sponsor', 'ownership', 'required',
    { label: 'Business sponsor', description: 'The business leader accountable for the need and its value.', why: 'Someone outside IT confirms the project is worth doing.', example: 'Processing Manager', mistake: 'Naming an IT person as sponsor.' },
    { label: 'Sponsor métier', description: 'Le responsable métier qui porte le besoin et sa valeur.', why: 'Quelqu’un hors de l’IT confirme que le projet en vaut la peine.', example: 'Responsable usine', mistake: 'Désigner une personne de l’IT comme sponsor.' }),
  g('it_owner', 'ownership', 'required',
    { label: 'IT owner', description: 'The IT person accountable for assessment, planning, governance and reporting.', why: 'One accountable name for the project in IT.', example: 'Site IT Manager, Hounde', mistake: 'Naming a team instead of a person.' },
    { label: 'Responsable IT', description: 'La personne IT responsable de l’évaluation, du planning, de la gouvernance et du reporting.', why: 'Un nom responsable unique côté IT.', example: 'Responsable IT du site, Hounde', mistake: 'Indiquer une équipe au lieu d’une personne.' }),
  g('delivery_lead', 'ownership', 'recommended',
    { label: 'Delivery lead', description: 'The person or team that delivers the work.', why: 'Separates who decides from who delivers.', example: 'Network team — vendor project manager', mistake: 'Repeating the IT owner when someone else delivers.' },
    { label: 'Responsable de la réalisation', description: 'La personne ou l’équipe qui réalise le travail.', why: 'Sépare qui décide de qui réalise.', example: 'Équipe réseau — chef de projet fournisseur', mistake: 'Répéter le responsable IT alors qu’un autre réalise.' }),
  g('indicative_quarter', 'schedule', 'recommended',
    { label: 'Indicative quarter', description: 'When the project should start if exact dates are not known yet (YYYY-Qn).', why: 'Keeps quarters and "TBC" out of the date fields.', example: '2027-Q2', mistake: 'Typing a quarter in the planned start date.' },
    { label: 'Trimestre indicatif', description: 'Quand le projet devrait démarrer si les dates exactes ne sont pas connues (AAAA-Tn saisi YYYY-Qn).', why: 'Garde les trimestres et « à confirmer » hors des champs de date.', example: '2027-Q2', mistake: 'Saisir un trimestre dans la date de début prévue.' }),
  g('schedule_confidence', 'schedule', 'recommended',
    { label: 'Schedule confidence', description: 'How sure the planned dates or quarter are: low, medium, high.', why: 'A low-confidence date is read as indicative, not as a commitment.', example: 'Low — depends on vendor lead time', mistake: 'High confidence on dates nobody has checked.' },
    { label: 'Confiance dans le planning', description: 'Le degré de certitude des dates ou du trimestre : faible, moyenne, élevée.', why: 'Une date à faible confiance se lit comme indicative, pas comme un engagement.', example: 'Faible — dépend du délai fournisseur', mistake: 'Confiance élevée sur des dates que personne n’a vérifiées.' }),
  g('budget_status', 'budget', 'required',
    { label: 'Budget status', description: 'Approved, Requested, Not budgeted or TBC.', why: 'Separates money that exists from money that is hoped for.', example: 'Requested', mistake: 'Leaving a zero budget with status Approved.' },
    { label: 'Statut du budget', description: 'Approuvé, Demandé, Non budgété ou À confirmer.', why: 'Sépare l’argent disponible de l’argent espéré.', example: 'Demandé', mistake: 'Laisser un budget à zéro avec le statut Approuvé.' }),
  g('budget_approval_date', 'budget', 'recommended',
    { label: 'Budget approval date', description: 'The date the budget was approved, when it was.', why: 'Shows how fresh the approval is.', example: '2027-01-15', mistake: 'A date while the status is still Requested.' },
    { label: 'Date d’approbation du budget', description: 'La date d’approbation du budget, s’il l’est.', why: 'Montre l’ancienneté de l’approbation.', example: '2027-01-15', mistake: 'Une date alors que le statut est encore Demandé.' }),
  g('budget_reference', 'budget', 'recommended',
    { label: 'Budget reference', description: 'The finance reference of the budget line (CAPEX request, PO, cost centre).', why: 'Finance can trace the money back to the project.', example: 'CAPEX-2027-HGO-014', mistake: 'Putting an amount here (the amount has its own field).' },
    { label: 'Référence budgétaire', description: 'La référence finance de la ligne budgétaire (demande CAPEX, bon de commande, centre de coût).', why: 'La finance peut rattacher l’argent au projet.', example: 'CAPEX-2027-HGO-014', mistake: 'Mettre un montant ici (le montant a son propre champ).' }),
  g('decision_required', 'business_case', 'required',
    { label: 'Management decision required', description: 'Yes, No or TBC — does the project wait for a management decision?', why: 'Feeds the decision agenda of the committee.', example: 'Yes — choice between two vendors', mistake: 'Answering No while the project is blocked by a pending choice.' },
    { label: 'Décision de la direction requise', description: 'Oui, Non ou À confirmer — le projet attend-il une décision de la direction ?', why: 'Alimente l’ordre du jour des décisions du comité.', example: 'Oui — choix entre deux fournisseurs', mistake: 'Répondre Non alors que le projet est bloqué par un choix en attente.' }),
  g('delivery_effort', 'resources', 'required',
    { label: 'Delivery effort', description: 'Small, Medium, Large or Very Large — the bands are proposed, not approved.', why: 'Sizes the load on the delivery teams.', example: 'Large — three sites, two vendors, a shutdown window', mistake: 'Confusing effort with budget.' },
    { label: 'Effort de réalisation', description: 'Petit, Moyen, Grand ou Très grand — les tranches sont proposées, non approuvées.', why: 'Dimensionne la charge des équipes de réalisation.', example: 'Grand — trois sites, deux fournisseurs, une fenêtre d’arrêt', mistake: 'Confondre l’effort et le budget.' }),
  g('avg_fte', 'resources', 'recommended',
    { label: 'Average FTE', description: 'Average full-time equivalents over the project (a number).', why: 'Lets capacity be added up across projects.', example: '0.5', mistake: 'Writing "medium" or a skill here — categories have their own field.' },
    { label: 'ETP moyen', description: 'Équivalents temps plein moyens sur la durée du projet (un nombre).', why: 'Permet d’additionner la capacité entre projets.', example: '0,5', mistake: 'Écrire « moyen » ou une compétence ici — les catégories ont leur propre champ.' }),
  g('peak_fte', 'resources', 'recommended',
    { label: 'Peak FTE', description: 'Highest full-time equivalents at the busiest period (a number, not below the average).', why: 'Reveals clashes the average hides.', example: '1.2', mistake: 'A peak lower than the average.' },
    { label: 'ETP de pointe', description: 'Équivalents temps plein au pic d’activité (un nombre, pas inférieur à la moyenne).', why: 'Révèle les conflits que la moyenne cache.', example: '1,2', mistake: 'Un pic inférieur à la moyenne.' }),
  g('required_skills', 'resources', 'recommended',
    { label: 'Required skills', description: 'The skills the project needs.', why: 'Shows scarce specialists early.', example: 'Network engineer, infrastructure engineer, project manager', mistake: 'Naming people instead of skills.' },
    { label: 'Compétences requises', description: 'Les compétences dont le projet a besoin.', why: 'Fait apparaître tôt les spécialistes rares.', example: 'Ingénieur réseau, ingénieur infrastructure, chef de projet', mistake: 'Citer des personnes au lieu de compétences.' }),
  g('workload_notes', 'resources', 'recommended',
    { label: 'Workload and risk notes', description: 'Scarce specialists, vendor dependence, peak period, clashes, site access, commissioning windows.', why: 'Context the numbers cannot carry.', example: 'Needs the only OT engineer during the March shutdown.', mistake: 'Repeating the risk register.' },
    { label: 'Notes de charge et de risque', description: 'Spécialistes rares, dépendance fournisseur, période de pointe, conflits, accès au site, fenêtres de mise en service.', why: 'Le contexte que les chiffres ne portent pas.', example: 'A besoin du seul ingénieur OT pendant l’arrêt de mars.', mistake: 'Répéter le registre des risques.' }),
  g('risk_exposure', 'resources', 'recommended',
    { label: 'Risk exposure', description: 'Overall exposure declared for the project — the levels are proposed, not approved, and do not change the risk register scoring.', why: 'A quick read of the exposure before the detailed risks.', example: 'High', mistake: 'Leaving it Low while the risk register shows high risks.' },
    { label: 'Exposition au risque', description: 'Exposition globale déclarée pour le projet — niveaux proposés, non approuvés, sans effet sur la cotation du registre des risques.', why: 'Une lecture rapide avant le détail des risques.', example: 'Élevée', mistake: 'La laisser Faible alors que le registre montre des risques élevés.' }),
];
const SECTIONS = ['identity', 'business_case', 'ownership', 'schedule', 'budget', 'resources'];

module.exports = { INTAKE_COLS, WRITABLE, MONEY_ADJACENT, LIST_FIELDS, NEED_PARTS, STATES, STATE_FIELDS, NONE_KNOWN_ONLY, SECTIONS, GUIDE, aliases, normaliseIntake, intakeWarnings, readIntake, isDay };
