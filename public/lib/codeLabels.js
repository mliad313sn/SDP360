/* SDPLabels — EN/FR label of a code shown to a user (I18N-QUALITY, 2026-11-21): a status, a severity, a department,
 * a category… instead of the raw code (on_track, HIGH, business_incubation).
 *   SDPLabels.label(kind, code[, lang])  → label, or the code itself when unknown (never invents a meaning);
 *                                          null / undefined / '' → '—'
 *   SDPLabels.kinds()                    → the kind names
 *   kind 'status' searches every status-like vocabulary (issue / meeting / project / transfer / priority / severity /
 *   RAG / inspection finding) — what the translation layer (lib/i18nText.js) uses for a code in a status place.
 * The table between the markers is GENERATED from the lookup seeds (meetings-init.json, inspection-init.json,
 * lib/statusTransfer.js) by tools/i18n/build-code-labels.js — edit the seeds or its UI_CODES, then re-run it.
 * Language: explicit argument, else lib/format.js (the page body's language), else 'en'. UMD.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SDPLabels = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  /* <generated:code-labels> — tools/i18n/build-code-labels.js, do not edit by hand */
  const KINDS = {
    "meeting_issue_status": {"open":["Open","Ouvert"],"in_progress":["In progress","En cours"],"blocked":["Blocked","Bloqué"],"on_hold":["On hold","En attente"],"resolved":["Resolved","Résolu"],"cancelled":["Cancelled","Annulé"],"demand":["Demand / Initiative","Demande / Initiative"],"helpdesk_ticket":["Helpdesk ticket","Ticket Helpdesk"]},
    "severity": {"HIGH":["High","Haute"],"MEDIUM":["Medium","Moyenne"],"LOW":["Low","Basse"]},
    "meeting_status": {"draft":["Draft","Brouillon"],"submitted":["Submitted","Soumis"],"signed":["Signed","Signé"],"closed":["Closed","Clôturé"]},
    "department": {"mining":["Mining","Exploitation minière"],"maintenance":["Maintenance","Maintenance"],"mobile_maint":["Mobile Maintenance","Maintenance mobile"],"process":["Process","Process / Procédé"],"mill":["Mill / Plant","Usine / Plant"],"geology":["Geology","Géologie"],"survey_dept":["Survey","Topographie"],"hse":["HSE","HSE"],"security":["Security","Sécurité"],"engineering":["Engineering","Ingénierie"],"supply_chain":["Supply Chain","Supply Chain"],"finance":["Finance","Finance"],"hr":["HR","Ressources Humaines"],"exploration":["Exploration","Exploration"],"other_dept":["Other","Autre"]},
    "category": {"CN":["Connectivity & Network","Connectivité & Réseau"],"HW":["End-user hardware & devices","Matériel utilisateur"],"IN":["Server & infrastructure","Serveurs & infrastructure"],"OT":["OT / Industrial systems","Systèmes OT / industriels"],"AP":["Applications & business software","Applications métier"],"SC":["Cybersecurity","Cybersécurité"],"DR":["Data & reporting","Données & reporting"],"SD":["Service desk & support","Service desk & support"],"LV":["Licensing & vendors","Licences & fournisseurs"]},
    "intake_source": {"dept_meeting":["Department Meeting","Réunion départementale"],"survey":["IT Survey","Enquête IT"],"council":["Mine IT Council","Mine IT Council"],"business_incubation":["Business Incubation","Incubation métier"],"adhoc":["Ad-hoc","Ponctuel"]},
    "escalation_reason": {"cross_site":["Cross-site impact","Impact multi-sites"],"group_decision":["Group decision required","Décision Groupe requise"],"capex":["CapEx beyond site authority","CapEx hors autorité site"],"strategic":["Strategic / standardisation","Standardisation / stratégique"],"group_dep":["Stuck on Group dependency","Dépendance Groupe bloquante"],"vendor":["Vendor / licensing matter","Vendeur / licence"]},
    "council_theme": {"connectivity":["Connectivity","Connectivité"],"hardware_lifecycle":["Hardware lifecycle","Cycle de vie matériel"],"ot_it":["OT-IT convergence","Convergence OT-IT"],"licensing":["Licensing","Licences"],"cybersecurity":["Cybersecurity","Cybersécurité"],"other":["Other","Autre"]},
    "project_phase": {"scoping":["Scoping","Cadrage"],"design":["Design","Conception"],"build":["Build","Construction"],"deploy":["Deploy","Déploiement"],"closeout":["Closeout","Clôture"]},
    "it_involvement": {"lead":["Lead","Pilote"],"co_deliver":["Co-deliver","Co-livraison"],"support":["Support","Support"],"advisory":["Advisory","Conseil"],"none":["None / Inform only","Aucune / Information"]},
    "inspection_finding": {"ok":["OK","Conforme"],"minor":["Minor","Mineur"],"major":["Major","Majeur"],"critical":["Critical","Critique"],"opp":["Opportunity","Opportunité"],"na":["N/A","N/A"]},
    "inspection_type": {"Routine":["Routine","Routinière"],"Pre-Audit":["Pre-Audit","Pré-Audit"],"Post-Incident":["Post-Incident","Post-Incident"],"Commissioning":["Commissioning","Mise en service"],"Handover":["Handover","Passation"],"Ad-hoc":["Ad-hoc","Ponctuelle"]},
    "inspection_area": {"main_server_room":["Main Server Room","Salle Serveur Principale"],"secondary_server_room":["Secondary Server Room","Salle Secondaire"],"plant_idf":["Plant IDF","Local Technique Usine"],"workshop_idf":["Workshop IT Closet","Atelier — Local IT"],"warehouse_idf":["Warehouse IT Closet","Magasin — Local IT"],"office_idf":["Office IT","Local Bureau"],"plant_control_room":["Process Plant Control Room","Salle de contrôle usine"],"mine_dispatch":["Mine Operations Centre / Dispatch","Centre opérations mine / Dispatch"],"radio_dispatch":["Radio Dispatch Room","Salle dispatch radio"],"heavy_workshop":["Heavy Workshop","Atelier engins"],"weighbridge":["Weighbridge","Pont-bascule"],"comms_tower":["Communication Tower","Pylône de communication"],"tower_shelter":["Tower Equipment Shelter","Abri équipements pylône"],"vsat_terminal":["VSAT Terminal","Terminal VSAT"],"pit_repeater":["Pit Repeater Site","Site répéteur fosse"],"camp_telecom":["Camp Telecom Room","Local télécom camp"],"ug_portal":["Underground Portal / Decline","Portail / Descenderie"],"ug_it_closet":["Underground IT Closet","Local IT fond"],"ug_refuge":["Underground Refuge Chamber","Chambre refuge"],"ug_substation":["Underground Substation","Sous-station fond"],"ug_hoist":["Hoist / Headframe","Treuil / Chevalement"],"gate_security":["Gate / Security Post","Portail / Poste sécurité"],"cctv_control":["CCTV Control Room","Salle CCTV"],"mine_rescue":["Mine Rescue Station","Station mine rescue"],"clinic":["Clinic","Infirmerie"],"other":["Other","Autre"]},
    "inspection_category": {"env":["Environment","Environnement"],"pwr":["Power & UPS","Alimentation"],"fire":["Fire Safety","Sécurité incendie"],"net":["Network","Réseau"],"srv":["Servers & Hypervisor","Serveurs & Hyperviseur"],"sto":["Storage & Datastores","Stockage & Datastores"],"rack":["Racks & Cabling","Baies & câblage"],"sec":["Physical Security","Sécurité physique"],"doc":["Documentation","Documentation"],"bcp":["Backup & Recovery","Sauvegarde & PRA"],"op":["OT / Mining Ops","OT / Opérations minières"],"hse":["HSE & Hazards","HSE & Dangers"],"tower":["Comms Tower","Pylône comms"],"radio":["Radio Comms","Comms radio"],"cell":["Cellular & Sat","Cellulaire & Sat"],"ug":["Underground Comms","Comms souterrain"],"cctv":["CCTV & PA","CCTV & sono"]},
    "transfer_status": {"demand":["Demand / Initiative","Demande / Initiative"],"helpdesk_ticket":["Helpdesk ticket","Ticket Helpdesk"],"cancelled":["Cancelled","Annulé"]},
    "project_status": {"todo":["To do","À faire"],"planned":["Planned","Planifié"],"active":["Active","Actif"],"in_progress":["In progress","En cours"],"on_track":["On track","Dans les temps"],"at_risk":["At risk","À risque"],"late":["Late","En retard"],"blocked":["Blocked","Bloqué"],"on_hold":["On hold","En attente"],"done":["Done","Terminé"],"delivered":["Delivered","Livré"],"accepted":["Accepted","Accepté"],"rejected":["Rejected","Rejeté"],"cancelled":["Cancelled","Annulé"],"closed":["Closed","Clôturé"],"open":["Open","Ouvert"],"submitted":["Submitted","Soumis"],"triaged":["Triaged","Trié"],"scheduled":["Scheduled","Programmé"],"live":["Live","En service"],"draft":["Draft","Brouillon"],"proposal":["Proposal","Proposition"],"approval":["Approval","Approbation"],"closure":["Closure","Clôture"],"stopped":["Stopped","Arrêté"]},
    "priority": {"critical":["Critical","Critique"],"high":["High","Élevée"],"medium":["Medium","Moyenne"],"low":["Low","Faible"]},
    "rag": {"GREEN":["Green","Vert"],"AMBER":["Amber","Orange"],"RED":["Red","Rouge"],"NA":["Not measured","Non mesuré"]},
    "dept_status": {"on_track":["On track","Dans les temps"],"blocked":["Blocked","Bloqué"],"no_pv":["No PV this month","Aucun PV ce mois-ci"]},
    "asset_source": {"ad":["Active Directory","Active Directory"],"entra":["Microsoft Entra","Microsoft Entra"],"defender":["Microsoft Defender","Microsoft Defender"],"sdp":["ServiceDesk Plus","ServiceDesk Plus"]},
    "site_status": {"operational":["Operational","Opérationnel"],"degraded":["Degraded","Dégradé"],"major":["Major incident","Incident majeur"],"unknown":["Not measured","Non mesuré"]},
    "record_module": {"meetings":["Meetings","Réunions"],"inspection":["Inspections","Inspections"],"reports":["Weekly reports","Rapports hebdomadaires"],"tracker":["Activity tracker","Suivi d’activité"],"portfolio":["Portfolio","Portefeuille"],"governance":["Governance","Gouvernance"],"dashboards":["Dashboards","Tableaux de bord"],"users":["Users","Utilisateurs"]},
    "completion": {"done":["Done","Fait"],"partial":["Partial","Partiel"],"missing":["Missing","Manquant"]},
    "weekly_report_status": {"draft":["In progress","En cours"],"in_progress":["In progress","En cours"],"ready":["Complete but not submitted","Complet mais non soumis"],"submitted":["Submitted","Soumis"]},
    "service_status": {"active":["Active","Actif"],"in_progress":["In progress","En cours"],"planned":["Planned","Planifié"],"stopped":["Stopped","Arrêté"]},
  };
  /* </generated:code-labels> */
  const STATUS_KINDS = ['meeting_issue_status', 'transfer_status', 'meeting_status', 'project_status', 'priority', 'severity', 'rag', 'inspection_finding', 'service_status', 'dept_status'];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function lang(l) {
    if (l === 'fr' || l === 'en') return l;
    try { if (root && root.SDPFormat && root.SDPFormat.lang) return root.SDPFormat.lang(); } catch (_) { /* no format lib */ }
    return 'en';
  }
  // Exact code first across every candidate vocabulary (HIGH = severity, high = priority), then case-insensitive.
  function find(list, code) {
    for (const k of list) { const t = KINDS[k]; if (t && own(t, code)) return t[code]; }
    const lc = code.toLowerCase(), uc = code.toUpperCase();
    for (const k of list) { const t = KINDS[k]; if (!t) continue; if (own(t, lc)) return t[lc]; if (own(t, uc)) return t[uc]; }
    return null;
  }
  function label(kind, code, l) {
    if (code === null || code === undefined || String(code).trim() === '') return '—';
    const c = String(code).trim(), i = lang(l) === 'fr' ? 1 : 0;
    const hit = find(kind === 'status' ? STATUS_KINDS : [kind], c);
    return hit && hit[i] ? hit[i] : c;
  }
  function has(kind, code) { return code != null && !!find(kind === 'status' ? STATUS_KINDS : [kind], String(code).trim()); }
  return { label, has, kinds: () => Object.keys(KINDS), STATUS_KINDS };
});
