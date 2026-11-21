# Guide de démarrage par profil — une page par profil

> **Préparé par IA — à valider par les responsables nommés.** Version 1 · 2026-11-20. Construit à partir du menu
> livré (`public/_shell.js`, libellés français de l'enveloppe), des fiches de formation du pilote
> (`docs/ops/pilot/training/`) et de l'aide intégrée (`public/help.html`, chapitres à ancres stables depuis le 2026-11-21 — `help.html#site-actions`, `#inspections`…). Les **trois tâches** de chaque profil sont
> une **proposition IA** à confirmer par la cohorte (décision D-P09-4, registre HD-U03).

## Avant de lire

- **Page d'arrivée.** Avec les réglages livrés, la plupart des profils arrivent sur le **Helpdesk ▸ Tableau de
  bord**. Pendant le pilote, si les lots L01 (`ui_role_landing`) et L15 (`ui_role_landing_profiles`) sont activés,
  chacun arrive sur la page de son métier (indiquée « avec le profil pilote » ci-dessous).
- **Le menu.** Accueil · Vue du site · Helpdesk · Opérations (Gouvernance / Planifier et suivre / Rapporter et
  partager / Configurer) · Infrastructure · Rapports · Direction · Administration · Aide. Vous ne voyez que les
  entrées que votre rôle peut ouvrir. La **recherche** du menu, ouverte sans rien taper, liste les pages de votre
  **espace** : « IT du site », « Technicien », « Portefeuille et projets », « Direction », « IT Groupe » ou « Pour
  commencer ». Avec le lot L01 (`workspace_profiles_enabled`), le lien « Mon espace » règle l'ordre de vos pages et
  votre site par défaut.
- **Un « — » n'est pas un zéro.** Il veut dire « pas mesuré » ou « source non synchronisée ». Ne le recopiez pas en 0.
- **Langue.** Le menu suit votre langue ; certaines pages restent en anglais tant que la traduction des pages
  (`ui_i18n_pages`) n'est pas activée.
- **Aide.** Menu Aide (`help.html`), en français et en anglais. En cas d'erreur serveur, citez l'**identifiant de
  corrélation** affiché au support.

---

## 1. Coordinateur IT de site (`editor` + `report-author`, un site)

**Où j'arrive** : Helpdesk ▸ Tableau de bord (livré) · **Accueil — Mon travail** (avec le profil pilote).
Espace de travail : « IT du site ».

| Mes 3 tâches du jour | Où | Aide |
|---|---|---|
| Clôturer ou mettre à jour mes actions de site | Opérations ▸ Gouvernance ▸ Actions du site | #site-actions |
| Saisir une inspection (responsable + date cible obligatoires sur chaque action corrective) | Opérations ▸ Gouvernance ▸ Inspections | #inspections |
| Rédiger et signer le PV de réunion de département (le tampon de signature enregistre le PV) | Opérations ▸ Gouvernance ▸ Réunions et décisions | #meetings |

Chaque semaine : Rapports ▸ Rapports de site — remplir et **soumettre** la semaine précédente.
Je ne vois et ne modifie que mon (mes) site(s). Aide : #site-actions, #inspections, #meetings ; questions → le responsable du pilote.

## 2. Technicien terrain (`field-tech`, un site)

**Où j'arrive** : Helpdesk ▸ Tableau de bord (livré) · **Application terrain** (avec le profil pilote).
Espace de travail : « Technicien ».

| Mes 3 tâches du jour | Où | Aide |
|---|---|---|
| Saisir une inspection hors ligne sur le téléphone | Opérations ▸ Configurer ▸ Application terrain | #field |
| Consulter une inspection passée de mon site | Opérations ▸ Gouvernance ▸ Inspections | #inspections |
| Voir les actions affectées sur mon site | Opérations ▸ Gouvernance ▸ Actions du site | #site-actions |

Hors réseau, la saisie reste sur le téléphone et part seule au retour du réseau. Ne videz pas le navigateur tant
que l'application affiche des entrées « non envoyées ». Téléphone partagé : chacun se connecte avec son compte.
Aide : #field ; un envoi bloqué → coordinateur de site.

## 3. PMO / gestionnaire de portefeuille (`committee-member`)

**Où j'arrive** : Helpdesk ▸ Tableau de bord (livré) · **Portefeuille** (avec le profil pilote).
Espace de travail : « Portefeuille et projets ».

| Mes 3 tâches du jour | Où | Aide |
|---|---|---|
| Revoir le portefeuille avant le comité | Opérations ▸ Planifier et suivre ▸ Portefeuille | #portfolio |
| Conduire le comité depuis le cockpit | Opérations ▸ Rapporter et partager ▸ Cockpit de réunion | #portfolio |
| Produire le rapport mensuel du portefeuille | Opérations ▸ Rapporter et partager ▸ Studio de rapports | #report-studio |

Un chiffre non certifié est étiqueté « non certifié » : il ne vaut pas validation Finance. Aide : #portfolio, #report-studio.

## 4. Finance (`finance-viewer`)

**Où j'arrive** : Helpdesk ▸ Tableau de bord (livré) · **Parc informatique ▸ Finance** (avec le profil pilote).
Espace de travail : « Portefeuille et projets ».

| Mes 3 tâches du jour | Où | Aide |
|---|---|---|
| Lire la finance du parc (valeur comptable, prévision) | Infrastructure ▸ Parc informatique ▸ onglet Finance | #assets |
| Comparer budget et réalisé des projets | Opérations ▸ Planifier et suivre ▸ Portefeuille | #portfolio |
| Produire le rapport finance | Opérations ▸ Rapporter et partager ▸ Studio de rapports | #report-studio |

Les montants sont en USD au taux affiché ; la couverture (part du parc qui a une date et un coût) est écrite au-dessus
des prévisions. Les modules temps, EVM et budgets par période ne sont **pas** ouverts au pilote. Aide : #assets.

## 5. Comité — gouvernance, audit, indicateurs (`committee-member`, `audit-viewer`, `kpi-committee`)

**Où j'arrive** : Helpdesk ▸ Tableau de bord (livré) · **Cockpit de réunion** (audit, avec le profil pilote).

| Mes 3 tâches du jour | Où | Aide |
|---|---|---|
| Préparer l'ordre du jour de la réunion de gouvernance | Opérations ▸ Rapporter et partager ▸ Cockpit de réunion | #portfolio |
| Vérifier que les PV sont signés | Opérations ▸ Gouvernance ▸ Réunions et décisions | #meetings |
| Revoir les règles de gouvernance (et, pour le comité KPI, les politiques d'indicateurs) | Opérations ▸ Configurer ▸ Règles de gouvernance · Politiques KPI | #policies, #kpi |

L'auteur d'une politique d'indicateur ne peut pas l'adopter : il faut un second membre. Aide : #kpi, #policies.

## 6. Direction (`executive`)

**Où j'arrive** : Tableau de bord direction, `executive.html` (livré) · **Accueil direction** (avec le profil pilote).
Espace de travail : « Direction ».

| Mes 3 tâches du jour | Où | Aide |
|---|---|---|
| Lire l'accueil direction (indicateurs groupe, site le plus en retard) | Direction ▸ Accueil direction | #executive |
| Préparer la revue IT mensuelle | Direction ▸ Revue IT | #executive |
| Voir les projets en retard ou à risque | Opérations ▸ Planifier et suivre ▸ Portefeuille | #portfolio |

Une source jamais synchronisée n'est jamais affichée en vert. Le score de la revue IT dit sa fenêtre de calcul. Aide : #executive, #executive.

## 7. Administrateur d'exploitation (`admin`)

**Où j'arrive** : Helpdesk ▸ Tableau de bord. Espace de travail : « IT Groupe ».

| Mes 3 tâches du jour | Où | Aide |
|---|---|---|
| Trouver les sites dont le helpdesk décroche | Helpdesk ▸ Tableau de bord (Tous les sites) | #helpdesk, #sla |
| Relancer les actions de site en retard | Opérations ▸ Gouvernance ▸ Actions du site | #site-actions |
| Traiter la liste d'hygiène du parc | Infrastructure ▸ Parc informatique ▸ Hygiène | #assets |

Je vois tous les sites. Les réglages (SMTP, SSO, intégrations sensibles) sont réservés au super administrateur. Aide : #admin.

## 8. Super administrateur (`super_admin`)

**Où j'arrive** : Tableau de bord direction (livré, page hors menu) · **Accueil** (avec le profil pilote). Espace : « IT Groupe ».

| Mes 3 tâches du jour | Où | Aide |
|---|---|---|
| Vérifier la fraîcheur des intégrations (SDP, OpManager, Meraki) | Opérations ▸ Configurer ▸ Intégrations | #report-studio |
| Lire les événements de sécurité et de synchronisation du jour | Administration ▸ Journaux système (onglet Sync health) | #security |
| Voir la charge du helpdesk sur tous les sites | Helpdesk ▸ Tableau de bord | #helpdesk |

Toute activation d'interrupteur passe par `node tools/ops/activate-switches.js` avec un motif et un opérateur nommé
(`docs/business-readiness/RUNBOOK-EXPLOITATION.md` §5). Aide : #admin, #security, #admin-operations.

## 9. Où trouver de l'aide (tous profils)

| Besoin | Où |
|---|---|
| Comment faire une tâche | Menu Aide, section indiquée ci-dessus |
| La donnée semble fausse ou ancienne | Coordinateur de site, puis administrateur (bandeau de fraîcheur, Sync health) |
| Je ne trouve plus une page / un accès refusé | Responsable du pilote (ne pas partager de compte) |
| Erreur serveur | Noter l'identifiant de corrélation et le transmettre au support |
| Incident de sécurité (vous voyez les données d'un autre site) | Arrêter, prévenir immédiatement la Sécurité de l'information (`docs/ops/INCIDENT-RESPONSE.md`) |

Responsables à nommer (vide tant que non décidé) :

| Rôle d'aide | Personne | Nommé par | Décision | Nom | Date | Signature |
|---|---|---|---|---|---|---|
| Responsable du pilote (premier contact) | | Sponsor | | | | |
| Répondant aux retours utilisateurs (HD-O08) | | Product owner | | | | |
| Support niveau 1 pendant le pilote | | Responsable du pilote | | | | |
