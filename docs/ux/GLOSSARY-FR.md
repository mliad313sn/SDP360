# Glossaire EN → FR (SDP360 — interface)

**Statut : PROPOSÉ — à valider par un coordinateur francophone (décision P13, D-2).** Ce glossaire fixe UNE
traduction par terme ITSM pour que les pages traduites (`public/lib/i18n/*.fr.js`, actives seulement quand
`ui_i18n_pages = '1'`) disent la même chose partout. `tests/i18n-shell-charts.test.js` le lit : toute entrée de
dictionnaire dont la clé est exactement un terme ci-dessous doit utiliser la traduction de la 2ᵉ colonne (la
partie entre parenthèses est une note, ignorée). Pour changer un terme, modifier cette ligne ET les dictionnaires.

Règles : les **valeurs de données** (noms de sites, de groupes, de techniciens, codes de statut envoyés à l'API,
clés de métriques, chiffres) ne sont jamais traduites ; les **sigles** usuels restent tels quels (SLA, CAB, CSAT,
NPS, MTTR, RCA, PIR, KPI, RAG) ; l'anglais reste la langue par défaut quand le commutateur est éteint.

| English | Français | Note |
|---|---|---|
| Ticket | Ticket | anglicisme usuel en support IT |
| Tickets | Tickets | |
| Request | Demande | |
| Requests | Demandes | |
| Incident | Incident | |
| Major Incidents | Incidents majeurs | |
| Service Requests | Demandes de service | |
| Change | Changement | |
| Changes | Changements | |
| Change Management | Gestion des changements | |
| Emergency | Urgence | type de changement |
| Approval | Approbation | |
| Approved | Approuvé | |
| Approver | Approbateur | |
| Pending | En attente | |
| Backlog | Backlog | (anglicisme gardé) |
| Ageing | Ancienneté | |
| On Hold | En attente (suspendu) | statut ServiceDesk Plus |
| Resolution | Résolution | |
| Resolution Time | Délai de résolution | |
| First Reply | Première réponse | |
| Closure Rate | Taux de clôture | |
| Reopen Rate | Taux de réouverture | |
| Success Rate | Taux de réussite | |
| Response Rate | Taux de réponse | |
| Escalated | Escaladé | |
| Technician | Technicien | |
| Category | Catégorie | |
| Priority | Priorité | |
| Impact | Impact | |
| Mode | Canal | mode de soumission (portail / e-mail) |
| Trend | Tendance | |
| Survey | Enquête | |
| Owner | Responsable | |
| Overdue | En retard | |
| Dashboards | Tableaux de bord | |
| Scorecard | Tableau de performance | |
| Period | Période | |
| Weekly | Hebdomadaire | |
| Monthly | Mensuel | |
| Score | Score | |
| Assets | Actifs | |
| Data table | Tableau des données | |
| Lessons Learned | Retours d'expérience | |
| Corrective Action | Action corrective | |
