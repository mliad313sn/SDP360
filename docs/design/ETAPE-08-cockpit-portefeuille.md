# Dossier de conception — Étape 08 — Cockpit de réunion et portefeuille roadmap / projets

Version 1 · 2026-10-23 · Auteur : agent IA · Relecteurs : comité produit, animateurs des réunions, Service & Support Manager
Référence : SDP-DASH-2.0-ETUDE v1.2, §6.3 étape 8, lacunes L12 (pas de pilotage par programme) et L18 (réunions
préparées à la main, décisions non tracées).

> **Statut : livré, construit sur les options recommandées (§6).** Les critères de réception demandent un usage réel
> (trois cadences tenues un mois, comité qui utilise le registre) : ils se mesurent après déploiement, sur l'écran
> Gouvernance.

## 1. Fiche → réalisé

| Demandé par l'étude | Réalisé | Où |
|---|---|---|
| Cadences de réunion (type, site, jour, participants, préparateur) | oui — définitions versionnées, 6 types avec ordre du jour type | `services/cockpit/definition.js`, `cockpit.html` ▸ Cadences |
| Agenda généré (KPI, actions en retard, incidents majeurs, décisions en attente, demandes) | oui — sections chiffrées par le moteur des tableaux de bord (mêmes chiffres que partout), suivi des actions, demandes, jalons du portefeuille | `services/cockpit/agenda.js` |
| Mode séance plein écran, horodatage par point, saisie en direct des décisions et des actions rattachées à leur source | oui — ordre du jour figé à l'ouverture ; chaque point est horodaté ; une action est rattachée à un incident, un indicateur, un problème, une demande, un projet ou une décision | `cockpit-session.html` |
| Procès-verbal automatique (HTML, PDF, e-mail) | oui — rédigé à la clôture ; PDF par le navigateur du serveur ; envoi aux participants **sur demande** de l'animateur | `services/cockpit/minutes.js` |
| Suivi inter-réunions | oui — registre des actions ; la section « Suivi » de la réunion suivante reprend les actions ouvertes | `cockpit.html` ▸ Actions |
| Portefeuille programmes → objectifs → projets → jalons → livrables (responsables, statut, confiance, dates, budget, risques) | oui — un arbre, niveaux contrôlés, date initiale conservée pour mesurer le glissement | `services/portfolio/store.js`, `portfolio.html` |
| Preuves automatiques par métrique | oui — un élément porte une clé du dictionnaire, une cible et un périmètre ; la valeur est lue chaque fois (cache 10 min) | `services/portfolio/analysis.js` |
| Gantt avec dépendances et alertes de glissement | oui — retard, glissement > 14 jours, dépendance en conflit, enfant au-delà de son parent, dépassement de budget | `portfolio.html` |
| Risques projet reliés aux incidents | oui — un élément liste ses incidents (numéros) | champ « Incidents liés » |
| Rapport mensuel « état du portefeuille » | oui | `/api/portfolio/report?month=` |
| Registre des demandes et décisions (formulaire, tri, score) | oui — dépôt par tous, tri et score par le comité, décision tracée | `rfi.html` |
| Tableau de bord de gouvernance | oui — % jalons à l'heure, glissement moyen, délai demande → décision, couverture des preuves, réunions tenues, adoption par rôle | `governance.html` |
| Migration du Roadmap Manager | **copie à la demande**, répétable (DEC-8.4) ; le Roadmap Manager continue de fonctionner | `services/portfolio/roadmapImport.js` |

## 2. Une réunion, du début à la fin

1. **Cadence** (animateur) : type, site ou groupe, rythme, participants (nom ; adresse ; rôle), préparateur, ordre
   du jour type modifiable, puis publication.
2. **Planification** : une réunion est créée pour une date ; tant qu'elle n'est pas ouverte, rien n'est calculé.
3. **Ouverture** : l'ordre du jour est généré avec les chiffres du moment et **figé** dans la réunion.
4. **Séance** : l'animateur passe d'un point à l'autre (chaque passage horodate), prend des notes, note décisions et
   actions. Ouvrir un point clôt le précédent.
5. **Clôture** : le procès-verbal est rédigé (chiffres affichés, temps passé par point, notes, décisions, actions).
6. **Diffusion** : lecture, PDF, envoi par e-mail aux participants qui ont une adresse (geste explicite).
7. **Suivi** : les actions ouvertes reviennent dans la section « Suivi » de la réunion suivante ; leur responsable ou
   l'animateur les ferme.

## 3. Données

Une seule migration, `db/postgres/reports/020_cockpit_portfolio.sql` (cadences versionnées, réunions, points,
décisions, actions, demandes, nœuds du portefeuille). Sur SQLite, le même script est exécuté tel quel.

## 4. Droits (option recommandée DEC-8.6)

| Action | Qui |
|---|---|
| Créer et publier une cadence, animer une réunion, envoyer le procès-verbal | `meeting-chair` (nouveau rôle) |
| Lire les réunions et les procès-verbaux | l'audience de la cadence (par défaut : toute personne connectée) |
| Fermer une action | son responsable, un animateur, le niveau administrateur |
| Déposer une demande au comité | toute personne connectée |
| Trier, noter, trancher une demande | `committee-member` (nouveau rôle) |
| Tenir le portefeuille | `portfolio-manager` (nouveau rôle) ; tout le monde le lit |
| Copier la Roadmap ITSM | `super_admin` |

## 5. Corrections faites en passant

- La barre de navigation commune débordait (défilement horizontal de toutes les pages) entre 640 et 1 240 px pour un
  compte qui voit le menu Admin ; elle se compacte désormais, et ses libellés masqués restent lus par les lecteurs
  d'écran (ils étaient retirés sous 640 px).

## 6. Points d'arbitrage

| # | Question | Recommandation appliquée |
|---|---|---|
| DEC-8.1 | Types de réunions et ordres du jour types | 6 types (§1) ; ordres du jour dans `services/cockpit/definition.js`, modifiables par cadence |
| DEC-8.2 | Rattachement des actions | une action est rattachée à sa source (incident, indicateur, problème, demande, projet, décision) par un type + une référence |
| DEC-8.3 | Modèle de portefeuille | programmes → objectifs → projets → jalons → livrables ; preuve par indicateur sur tout élément |
| DEC-8.4 | Migration du Roadmap Manager | copie répétable à la demande ; bascule complète (retrait du Roadmap Manager) à décider par son auteur |
| DEC-8.5 | Score des demandes | valeur × urgence ÷ effort, sur des échelles de 1 à 5 |
| DEC-8.6 | Qui crée une décision | l'animateur pendant la réunion ; le comité sur une demande (§4) |
| DEC-8.7 | Envoi du procès-verbal | jamais automatique : l'animateur clique sur « Envoyer » ; serveur de messagerie déjà configuré dans Admin ▸ Rapports |

## 7. Critères de réception

| Critère | Mesure (écran Gouvernance) |
|---|---|
| Trois cadences réelles tenues un mois avec procès-verbal automatique | « Réunions tenues » et « avec procès-verbal envoyé », par cadence |
| Portefeuille saisi avec preuves automatiques sur ≥ 50 % des objectifs | « Objectifs portant une preuve automatique » |
| Registre des demandes utilisé par le comité | demandes tranchées et délai moyen demande → décision |
