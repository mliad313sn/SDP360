/* PMO UX (2026-11) — ONE label map for every PPM code a user may see (status, stage, kind, action, field,
 * gate refusal codes, RAID responses, report kinds…). Display only: the code posted to the API never changes.
 *   label(group, code[, lang])   → "On track" / "En bonne voie"; an unknown code is humanised (underscores → spaces,
 *                                 first letter upper-case) so a new server code never shows as raw snake_case.
 *   pill(group, code, esc[, lang, cls]) → <span class="pill CODE">Label</span> (the CSS class stays the code)
 *   options(group, codes, sel, esc[, lang]) → <option value="code">Label</option>… (value = code, text = label)
 *   lang()                       → 'en' (the page dictionary translates the English label; pass 'fr' to ask for French)
 * Status / priority codes known to lib/codeLabels.js (SDPLabels) are read from it; this map adds the PPM-only codes.
 * Pure (no network); the DOM is read only by lang(). Unknown stays "—" — never a made-up status.
 */
(function (root) {
  'use strict';
  var L = {
    status: {
      on_track: ['On track', 'En bonne voie'], at_risk: ['At risk', 'À risque'], off_track: ['Off track', 'Hors trajectoire'],
      planned: ['Planned', 'Planifié'], active: ['Active', 'Actif'], done: ['Done', 'Terminé'], open: ['Open', 'Ouvert'], closed: ['Closed', 'Clos'],
      todo: ['To do', 'À faire'], in_progress: ['In progress', 'En cours'], blocked: ['Blocked', 'Bloqué'], cancelled: ['Cancelled', 'Annulé'],
      late: ['Late', 'En retard'], on_hold: ['On hold', 'En pause'], delivered: ['Delivered', 'Livré'], accepted: ['Accepted', 'Accepté'],
      rejected: ['Rejected', 'Rejeté'], submitted: ['Submitted', 'Soumis'], triaged: ['Triaged', 'Trié'], scheduled: ['Scheduled', 'Planifié'],
      live: ['Live', 'En ligne'], expired: ['Expired', 'Expiré'], revoked: ['Revoked', 'Révoqué'], draft: ['Draft', 'Brouillon'],
      approved: ['Approved', 'Approuvé'], proposed: ['Proposed', 'Proposé'], assessed: ['Assessed', 'Évalué'], applied: ['Applied', 'Appliqué'],
      withdrawn: ['Withdrawn', 'Retiré'], complete: ['Complete', 'Complet'], pending: ['Pending', 'En attente'], verified: ['Verified', 'Vérifié'],
      GREEN: ['On track', 'En bonne voie'], AMBER: ['Watch', 'À surveiller'], RED: ['Off track', 'Hors trajectoire'], NA: ['Not measured', 'Non mesuré'],
      green: ['On track', 'En bonne voie'], amber: ['Watch', 'À surveiller'], red: ['Off track', 'Hors trajectoire'],
    },
    stage: {
      idea: ['Idea', 'Idée'], assessment: ['Assessment', 'Évaluation'], proposal: ['Proposal', 'Proposition'], approval: ['Approval', 'Approbation'],
      in_progress: ['In delivery', 'En réalisation'], on_hold: ['On hold', 'En pause'], handover: ['Handover', 'Transfert'],
      benefits_review: ['Benefits review', 'Revue des bénéfices'], closure: ['Closure', 'Clôture'], closed: ['Closed', 'Clos'],
      deferred: ['Deferred', 'Reporté'], rejected: ['Rejected', 'Rejeté'], cancelled: ['Cancelled', 'Annulé'],
    },
    kind: {
      programme: ['Programme', 'Programme'], objective: ['Objective', 'Objectif'], project: ['Project', 'Projet'], milestone: ['Milestone', 'Jalon'],
      deliverable: ['Deliverable', 'Livrable'], risk: ['Risk', 'Risque'], task: ['Task', 'Tâche'], issue: ['Issue', 'Problème'],
      assumption: ['Assumption', 'Hypothèse'], dependency: ['Dependency', 'Dépendance'], benefit: ['Benefit', 'Bénéfice'],
      group_monthly: ['Group monthly review', 'Revue mensuelle groupe'], site_weekly: ['Site weekly review', 'Revue hebdomadaire site'],
      site_monthly: ['Site monthly review', 'Revue mensuelle site'], committee: ['Committee', 'Comité'], exec: ['Executive', 'Direction'], site: ['Site', 'Site'],
      artifact: ['Document', 'Document'], check: ['Check', 'Vérification'],
    },
    severity: { high: ['High', 'Élevée'], medium: ['Medium', 'Moyenne'], low: ['Low', 'Faible'] },
    response: { avoid: ['Avoid', 'Éviter'], mitigate: ['Mitigate', 'Atténuer'], transfer: ['Transfer', 'Transférer'], accept: ['Accept', 'Accepter'], exploit: ['Exploit', 'Exploiter'], escalate: ['Escalate', 'Escalader'] },
    action: {
      create: ['Created', 'Créé'], created: ['Created', 'Créé'], update: ['Updated', 'Modifié'], updated: ['Updated', 'Modifié'], delete: ['Deleted', 'Supprimé'], deleted: ['Deleted', 'Supprimé'],
      stage: ['Stage changed', 'Phase changée'], stage_move: ['Stage changed', 'Phase changée'], budget: ['Budget entry', 'Saisie budgétaire'], reassign: ['Task reassigned', 'Tâche réaffectée'],
      baseline: ['Baseline captured', 'Référence figée'], rebaseline: ['Re-baselined', 'Référence révisée'], verify: ['Verified', 'Vérifié'], realised: ['Realised value recorded', 'Valeur réalisée saisie'],
      signoff: ['Sign-off', 'Validation'],
      budget_period_edit: ['Budget period edit', 'Saisie d’une période budgétaire'], finance_edit: ['Finance edit', 'Modification financière'], field_edit: ['Field edit', 'Modification d’un champ'],
      task_reassigned: ['Task reassigned', 'Tâche réaffectée'], benefit_verified: ['Benefit verified', 'Bénéfice vérifié'], benefit_unverified: ['Benefit verification cleared', 'Vérification du bénéfice retirée'],
      benefit_realised: ['Benefit realised value', 'Valeur réalisée du bénéfice'], baseline_captured: ['Baseline captured', 'Référence figée'], raci_edit: ['RACI edit', 'Modification du RACI'],
      intake_edit: ['Intake edit', 'Modification de la demande'], gate_checklist_defined: ['Gate checklist defined', 'Liste de contrôle du jalon définie'], template_saved: ['Template saved', 'Modèle enregistré'],
      business_case_change: ['Business case change', 'Changement du dossier de justification'], sensitive_edit: ['Sensitivity edit', 'Modification de la sensibilité'], to_project: ['Converted to a project', 'Converti en projet'], approve: ['Approved', 'Approuvé'], reject: ['Rejected', 'Rejeté'],
      // VISUAL POLISH 3 — the less common ledger actions (they were shown through humanise(): readable, English only)
      calendar_created: ['Calendar created', 'Calendrier créé'], calendar_edit: ['Calendar edited', 'Calendrier modifié'], calendar_exception_added: ['Calendar exception added', 'Exception de calendrier ajoutée'],
      calendar_exception_removed: ['Calendar exception removed', 'Exception de calendrier retirée'], change_request_proposed: ['Change request proposed', 'Demande de changement proposée'], change_request_simulated: ['Change request simulated', 'Demande de changement simulée'],
      completion_proposed: ['Completion proposed', 'Achèvement proposé'], confirmed: ['Confirmed', 'Confirmé'], created_from_template: ['Created from a template', 'Créé à partir d’un modèle'],
      external_source_removed: ['External source removed', 'Source externe retirée'], external_source_set: ['External source set', 'Source externe définie'], external_sync: ['Synchronised from the external source', 'Synchronisé depuis la source externe'],
      from_meeting: ['Created from a meeting', 'Créé depuis une réunion'], gate_evidence_added: ['Gate evidence added', 'Preuve du jalon de décision ajoutée'], gate_evidence_withdrawn: ['Gate evidence withdrawn', 'Preuve du jalon de décision retirée'],
      info_request: ['Information requested', 'Information demandée'], info_response: ['Information provided', 'Information fournie'], project_role_set: ['Project role set', 'Rôle projet défini'],
      published: ['Published', 'Publié'], rag_changed: ['Status colour changed', 'Couleur de statut changée'], record: ['Recorded', 'Enregistré'],
      requested: ['Requested', 'Demandé'], resource_created: ['Resource created', 'Ressource créée'], resource_edit: ['Resource edited', 'Ressource modifiée'],
      resource_rate: ['Resource rate changed', 'Taux de la ressource modifié'], restored: ['Restored', 'Restauré'], review_assign: ['Review assigned', 'Revue attribuée'],
      review_return: ['Returned by the reviewer', 'Renvoyé par le relecteur'], roadmap_migrated: ['Roadmap migrated', 'Feuille de route migrée'], roadmap_rollback: ['Roadmap migration rolled back', 'Migration de la feuille de route annulée'],
      role_edit: ['Role edited', 'Rôle modifié'], sites_edit: ['Sites edited', 'Sites modifiés'], status: ['Status changed', 'Statut changé'],
      task_evm_edit: ['Task earned-value edit', 'Modification de la valeur acquise de la tâche'], team_member_added: ['Team member added', 'Membre de l’équipe ajouté'], team_member_edit: ['Team member edited', 'Membre de l’équipe modifié'],
      team_member_removed: ['Team member removed', 'Membre de l’équipe retiré'], template_approved: ['Template approved', 'Modèle approuvé'], time_entry_added: ['Time entry added', 'Saisie de temps ajoutée'],
      time_entry_removed: ['Time entry removed', 'Saisie de temps retirée'], triage: ['Triaged', 'Trié'],
    },
    field: {
      stage: ['Stage', 'Phase'], status: ['Status', 'Statut'], owner: ['Owner', 'Responsable'], sponsor: ['Sponsor', 'Sponsor'], budget: ['Budget', 'Budget'], spent: ['Spent', 'Dépensé'],
      start_date: ['Start', 'Début'], end_date: ['End', 'Fin'], baseline_end: ['Baseline end', 'Fin de référence'], progress_pct: ['Progress', 'Avancement'], charter: ['Charter', 'Charte'],
      name: ['Name', 'Nom'], due_date: ['Due', 'Échéance'], amount: ['Amount', 'Montant'], currency: ['Currency', 'Devise'],
    },
    gate: {
      GATE_CHARTER: ['A charter (objective, scope, benefits — 20 characters or more) is needed first.', 'Une charte (objectif, périmètre, bénéfices — 20 caractères ou plus) est nécessaire.'],
      GATE_SPONSOR: ['A sponsor is needed first.', 'Un sponsor est nécessaire.'],
      GATE_BASELINE: ['Start, end and baseline end dates are needed (the baseline is frozen at approval).', 'Les dates de début, de fin et de fin de référence sont nécessaires (la référence est figée à l’approbation).'],
      GATE_SOD: ['The project owner cannot decide on their own project — another committee member must.', 'Le responsable du projet ne peut pas décider de son propre projet — un autre membre du comité doit le faire.'],
      GATE_SOD_SPONSOR: ['The sponsor cannot decide on the project they sponsor.', 'Le sponsor ne peut pas décider du projet qu’il parraine.'],
      GATE_OPEN_TASKS: ['Some tasks are still open.', 'Des tâches sont encore ouvertes.'],
      GATE_OPEN_RISKS: ['High risks are still open.', 'Des risques élevés sont encore ouverts.'],
      GATE_REASON: ['A written reason (10 characters or more) is needed.', 'Une raison écrite (10 caractères ou plus) est nécessaire.'],
      GATE_OWNER: ['An IT owner is needed before the project is planned.', 'Un responsable IT est nécessaire avant de planifier le projet.'],
      GATE_CHECKLIST: ['The gate checklist is not complete.', 'La liste de contrôle du jalon de décision n’est pas complète.'],
      GATE_SIGNOFF: ['The gate still needs its sign-offs.', 'Le jalon de décision attend encore ses validations.'],
      GATE_REJECTED: ['A gate approver rejected this move.', 'Un approbateur a refusé ce passage.'],
      GATE_DATA_QUALITY: ['The data-quality check blocks this move.', 'Le contrôle de qualité des données bloque ce passage.'],
    },
    doctype: {
      business_case: ['Business case', 'Dossier de justification'], vendor_quotation: ['Vendor quotation', 'Devis fournisseur'], design: ['Design', 'Conception'],
      architecture: ['Architecture', 'Architecture'], scope_of_work: ['Scope of work', 'Cahier des charges'], budget_approval: ['Budget approval', 'Approbation budgétaire'],
      purchase_request: ['Purchase request', 'Demande d’achat'], risk_assessment: ['Risk assessment', 'Évaluation des risques'],
      cybersecurity_assessment: ['Cybersecurity assessment', 'Évaluation cybersécurité'], commissioning: ['Commissioning', 'Mise en service'], handover: ['Handover', 'Transfert'],
    },
    depcat: {
      procurement: ['Procurement', 'Achats'], network_infrastructure: ['Network infrastructure', 'Infrastructure réseau'], civil_works: ['Civil works', 'Génie civil'],
      electrical_works: ['Electrical works', 'Travaux électriques'], power: ['Power', 'Énergie'], connectivity: ['Connectivity', 'Connectivité'],
      architecture_approval: ['Architecture approval', 'Validation d’architecture'], cybersecurity_assessment: ['Cybersecurity assessment', 'Évaluation cybersécurité'],
      contract_approval: ['Contract approval', 'Validation du contrat'], vendor_mobilization: ['Vendor mobilisation', 'Mobilisation du fournisseur'],
      hse_approval: ['HSE approval', 'Validation HSE'], other: ['Other', 'Autre'],
    },
    depstatus: { met: ['Met', 'Satisfaite'] },
    role: {
      'committee-member': ['Committee member', 'Membre du comité'], executive: ['Executive', 'Direction'], admin: ['Administrator', 'Administrateur'],
      super_admin: ['Super administrator', 'Super administrateur'], editor: ['Editor', 'Éditeur'], viewer: ['Viewer', 'Lecteur'], finance: ['Finance', 'Finance'],
      'portfolio-manager': ['Portfolio manager', 'Gestionnaire de portefeuille'], 'project-manager': ['Project manager', 'Chef de projet'],
    },
    capacity: { GREEN: ['Within capacity', 'Dans la capacité'], AMBER: ['Near capacity', 'Proche de la capacité'], RED: ['Over capacity', 'Au-delà de la capacité'], NA: ['Not measured', 'Non mesuré'] },
    band: { small: ['Small', 'Petit'], medium: ['Medium', 'Moyen'], large: ['Large', 'Grand'], very_large: ['Very large', 'Très grand'] },
    rag: { GREEN: ['On baseline', 'Dans la référence'], AMBER: ['Slipping', 'En glissement'], RED: ['Late', 'En retard'], NA: ['Not measured', 'Non mesuré'] },
  };
  function humanise(code) {
    var s = String(code).replace(/_/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;   // an unknown code: readable, never invented
  }
  // The page is authored in English: label() answers English unless a language is asked for. French on screen comes
  // from the page dictionary (lib/i18nText.js swaps the English label; every label of this map has an entry in
  // lib/i18n/project.fr.js / portfolio.fr.js — tests/ppm-ux-labels.test.js), so EN ⇄ FR toggles both ways.
  function lang() { return 'en'; }
  // Codes the shared table (lib/codeLabels.js, window.SDPLabels) already covers are read from it — one wording for
  // the whole application; this map only adds the PPM codes it does not know (stage, kind, gate, action, field…).
  var SHARED = { status: 'project_status', severity: 'priority', priority: 'priority' };
  function shared() {
    if (root.SDPLabels) return root.SDPLabels;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') { try { return require('./codeLabels.js'); } catch (_) { return null; } }
    return null;
  }
  function label(group, code, lg) {
    if (code == null || code === '') return '—';
    var l = lg === 'fr' ? 'fr' : 'en', c = String(code), S = SHARED[group] && shared();
    if (S) { var h = S.label(SHARED[group], c, l); if (h && h !== c) return h; }
    if (S && group === 'category') { var h2 = S.label('status', c, l); if (h2 && h2 !== c) return h2; }
    var g = L[group] || {}, hit = g[c] || g[c.toLowerCase()];
    if (!hit) for (var k in L) if (L[k][c]) { hit = L[k][c]; break; }
    return hit ? hit[l === 'fr' ? 1 : 0] : humanise(c);
  }
  function pill(group, code, esc, lg, cls) {
    if (code == null || code === '') return '<span class="pill NA">—</span>';
    return '<span class="pill ' + esc(cls || code) + '" data-code="' + esc(code) + '">' + esc(label(group, code, lg)) + '</span>';
  }
  function options(group, codes, sel, esc, lg) {
    return codes.map(function (c) { return '<option value="' + esc(c) + '"' + (String(c) === String(sel) ? ' selected' : '') + '>' + esc(label(group, c, lg)) + '</option>'; }).join('');
  }
  var api = { MAP: L, label: label, pill: pill, options: options, lang: lang, humanise: humanise };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PpmLabels = api;
})(typeof window !== 'undefined' ? window : globalThis);
