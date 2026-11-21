# Glossaire EN → FR (SDP360 — interface)

**Statut : PROPOSÉ — proposition IA, à relire par un francophone (décision D-2, porte 17).** Ce glossaire fixe UNE
traduction par terme pour que les pages traduites (`public/lib/i18n/*.fr.js`, actives seulement quand
`ui_i18n_pages = '1'`) disent la même chose partout. Il remplace `docs/ux/GLOSSARY-FR.md` (I18N-QUALITY, 2026-11-21 :
même tableau, termes de gouvernance / portefeuille ajoutés). `tests/i18n-shell-charts.test.js` le lit : toute entrée de
dictionnaire dont la clé est exactement un terme ci-dessous doit utiliser la traduction de la 2ᵉ colonne (la
partie entre parenthèses est une note, ignorée). `tests/i18n-quality.test.js` contrôle en plus les variantes
interdites (verbe à la place d’un statut, « Conseil », « sévérité », « Insights »…). Pour changer un terme, modifier
cette ligne ET les dictionnaires.

Colonne **« À éviter »** (E-U05, PROPOSITION) : uniquement des variantes **réellement trouvées** dans le code
(texte français en ligne `data-lng="fr"` / `data-lng-block="fr"` des pages, ou dictionnaires). `tests/i18n-inline-glossary.test.js`
liste chaque occurrence en ligne (fichier:ligne) et échoue sur toute **nouvelle** occurrence ; les occurrences connues
attendent la validation d'un coordinateur francophone (porte 17) avant toute correction.

Règles : les **valeurs de données** (noms de sites, de groupes, de techniciens, codes de statut envoyés à l'API,
clés de métriques, chiffres) ne sont jamais traduites ; les **sigles** usuels restent tels quels (SLA, CAB, CSAT,
NPS, MTTR, RCA, PIR, KPI, RAG) ; l'anglais reste la langue par défaut quand le commutateur est éteint.

| English | Français | Note | À éviter (PROPOSITION) |
|---|---|---|---|
| Ticket | Ticket | anglicisme usuel en support IT | |
| Tickets | Tickets | | |
| Request | Demande | | |
| Requests | Demandes | | |
| Incident | Incident | | |
| Major Incidents | Incidents majeurs | | |
| Service Requests | Demandes de service | | |
| Change | Changement | | |
| Changes | Changements | | |
| Change Management | Gestion des changements | | |
| Emergency | Urgence | type de changement | |
| Approval | Approbation | | |
| Approved | Approuvé | | |
| Approver | Approbateur | | |
| Pending | En attente | | |
| Backlog | Backlog | (anglicisme gardé) | |
| Ageing | Ancienneté | | |
| On Hold | En attente (suspendu) | statut ServiceDesk Plus | |
| Resolution | Résolution | | |
| Resolution Time | Délai de résolution | | |
| First Reply | Première réponse | | 1re réponse (abréviation, dictionnaires) |
| Closed | Clôturé | statut d'un ticket / d'un problème | Fermés |
| Closure Rate | Taux de clôture | | |
| Reopen Rate | Taux de réouverture | | |
| Success Rate | Taux de réussite | | |
| Response Rate | Taux de réponse | | |
| Escalated | Escaladé | | remontée (au sens « escaladée ») |
| Technician | Technicien | | |
| Category | Catégorie | | |
| Priority | Priorité | | |
| Impact | Impact | | |
| Mode | Canal | mode de soumission (portail / e-mail) | |
| Trend | Tendance | | |
| Survey | Enquête | | |
| Owner | Responsable | | |
| Overdue | En retard | | |
| Dashboards | Tableaux de bord | | |
| Scorecard | Tableau de performance | | |
| Period | Période | | |
| Weekly | Hebdomadaire | | |
| Monthly | Mensuel | | |
| Score | Score | | |
| Assets | Actifs | | |
| Data table | Tableau des données | | |
| Lessons Learned | Retours d'expérience | | |
| Corrective Action | Action corrective | | |
| Action | Action | engagement à réaliser (réunion, inspection, rapport) ; une action est « ouverte » (féminin) |  |
| Actions | Actions |  |  |
| Issue | Problème | point soulevé en réunion ; un problème est « ouvert » (masculin) — pas le « problème » ITIL |  |
| Issues | Problèmes |  |  |
| Inspection | Inspection | visite d’inspection IT d’un site |  |
| Finding | Constat | résultat d’un point de contrôle d’inspection |  |
| Meeting | Réunion |  |  |
| Meetings | Réunions |  |  |
| Meeting report | Compte rendu de réunion (PV) | PV = procès-verbal signé ; « PV » reste tel quel dans les libellés courts |  |
| Council | Council | nom court de l’instance « Mine IT Council » (nom propre du Groupe, gardé tel quel comme dans les données de référence) ; jamais « Conseil » |  |
| Council theme | Thème du Council |  |  |
| Committee | Comité | comité de pilotage / de portefeuille |  |
| Severity | Gravité | HIGH / MEDIUM / LOW d’un problème = Haute / Moyenne / Basse ; jamais « sévérité » |  |
| Champion | Champion | responsable désigné d’une action (Engagement n° 3) — terme du guide opérationnel |  |
| Due date | Échéance |  |  |
| Department | Département |  |  |
| Escalation | Escalade |  |  |
| Sign-off | Validation | signature d’un PV ou d’un jalon |  |
| Draft | Brouillon |  |  |
| In progress | En cours |  |  |
| On track | Dans les temps | statut d’avancement |  |
| At risk | À risque |  |  |
| Dashboard | Tableau de bord |  |  |
| Portfolio | Portefeuille | portefeuille de projets |  |
| Programme | Programme |  |  |
| Project | Projet |  |  |
| Milestone | Jalon |  |  |
| Deliverable | Livrable |  |  |
| Risk | Risque |  |  |
| Residual risk | Risque résiduel | risque restant après les mesures |  |
| Dual approval | Double validation | deux personnes distinctes approuvent (« four-eyes ») |  |
| Gate | Jalon de décision | passage de phase d’un projet |  |
| Decision | Décision |  |  |
| Coverage | Couverture |  |  |
| Baseline | Référence | planning de référence d’un projet |  |
| Report follow-up | Suivi du rapport | action du rapport hebdomadaire |  |
| Business Incubation | Incubation métier |  |  |
| Site Actions | Actions du site |  |  |
| Insights | Analyses | préfixe de rubrique ; jamais « Insights » en français |  |
| Handoffs | Demandes inter-services |  |  |
| Week | Semaine | abrégé « S45 » en français (« W45 » en anglais) — public/lib/format.js |  |

## Statuts qui s’accordent (hors tableau : l’accord dépend de l’objet)

- Open → « Ouvert » (statut) — un problème « ouvert », une action « ouverte » ; le **verbe** « Open » d’un bouton reste « Ouvrir ».
  Le dictionnaire distingue les deux par contexte : clé `Open@status` (option de liste, pastille de statut).
- Submitted → « Soumis / soumise » ; Signed → « Signé » ; Blocked → « Bloqué / bloquée » ; Cancelled → « Annulé / annulée » ;
  Resolved → « Résolu » ; Closed → « Clôturé / clôturée » — accorder avec l’objet (inspection, tâche…) ; au pluriel dans les filtres.
- Department Meeting → « Réunion de département » dans les textes ; « Réunion départementale » est le libellé de la donnée
  de référence (origine `dept_meeting`), les deux sont admis.
- Evidence → « Preuve » (au pluriel « Preuves » en titre de colonne).

## Règles de forme (formats)

- Nombres : séparateur de milliers = espace fine insécable (« 1 629 »), virgule décimale (« 73,5 »).
- Pourcentages : espace fine insécable avant « % » (« 73,5 % »).
- Dates : « 15 janv. 2026 » ; heure : « 15 janv. 2026 à 07:20 UTC ».
- Durées : « 45 min », « 3,5 h », « 1 j 22 h ».
- Semaine : « S45 » (anglais « W45 »).
- Accord : « 1 action ouverte », « 2 actions ouvertes » ; en français 0 et 1 sont au singulier.
- Ponctuation : espace insécable avant « : ; ? ! » et à l’intérieur des guillemets « ».
- Valeur inconnue : « — » (jamais 0).
Tout ceci est produit par `public/lib/format.js` (SDPFormat) ; les libellés de codes par `public/lib/codeLabels.js` (SDPLabels).
