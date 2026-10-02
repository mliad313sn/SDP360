# Audit RBAC & périmètre de site — plan de correction (2026-10-02)

Déclencheur : le tracker refusait d'enregistrer pour 8 sites sur 11 (`403 no site assigned`,
corrigé en `6804ebe`). Même famille de défauts recherchée dans tous les modules :

- **Résolution de site** (nom → code module) — inventaire fait : seul le tracker était faux.
  Inspections/Réunions normalisent déjà ; Site Awareness avait contourné le défaut localement.
  Lacune connue, hors périmètre : ASSAFO (Tanda) n'a pas de code Inspection/Réunions.
- **Garde d'écriture ≠ garde de lecture** (un rôle peut écrire ce qu'il ne peut pas charger).
- **Interface ≠ serveur** (bouton affiché qui 403, ou faux succès).
- **Champ utilisateur absent** lu par le navigateur.
- **Écritures sans aucun contrôle de rôle ni de site.**

Règle de référence (décidée lors de l'audit F5 du 2026-09-05) : une écriture exige le rôle
`editor`, le **site de l'objet** = site du compte sauf `admin`+, et **un compte sans site
n'est pas global**. Chaque lot est en TDD (test rouge d'abord), un commit par correction.

## Lot 1 — Trous de privilège (serveur) — PRIORITÉ 1

| # | Constat | Correction |
|---|---|---|
| A12 | `POST /api/reports/monthly/:site_id/:y/:m/edits` et `POST /api/reports/objectives/:site_id/:y` : aucune vérification de rôle ni de site — un `viewer` réécrit le rapport mensuel ou les objectifs de n'importe quel site | Même règle que `_reportWriteDenial` appliquée au `site_id` de l'URL : `editor`, site du compte sauf admin+, refus du compte sans site |
| A16 | `POST /api/assets/reconcile/decision` : aucune vérification de rôle | `requireRole('editor')` (le commentaire de la route dit déjà « acte d'éditeur ») |
| A8 | `_userMeetingsSite` / `_userInspectionSite` rendent `null` (= **global**) pour un non-admin **sans site** | Refus (403) d'écriture pour un non-admin sans site, comme le rapport hebdo et le tracker |
| B2 | `_listUsersPg` (prod) n'expose pas `email`/`has_entra` et `_updateUserPg` ignore `email` : la fiche utilisateur s'affiche sans e-mail et une saisie d'e-mail est **perdue** — bloque le mapping SSO | Parité avec la version sqlite |

## Lot 2 — Tracker (pré-requis de la rétrogradation G-12)

| # | Constat | Correction |
|---|---|---|
| A1 | `GET /api/tracker/load` = `requireAdmin`, alors que l'enregistrement accepte `tracker-editor` | Lecture ouverte à `admin`+ **ou** `tracker-admin`/`tracker-editor` |
| B1 | Le sélecteur de site n'est jamais verrouillé (`__authUser.site_name` n'existe pas) ; les saisies sur un autre site sont **ignorées en silence** par le serveur | `/api/tracker/load` renvoie le périmètre de l'utilisateur (`scope`, calculé par `siteToCode`) ; l'interface verrouille le site sur ce code |
| A2 | Bouton Export PPTX affiché selon `executive`/`tracker-admin`, serveur = `admin` | Aligner l'interface et le serveur (admin+ ou tracker-admin) |

## Lot 3 — Interface ≠ serveur (faux succès et boutons morts)

| # | Constat | Correction |
|---|---|---|
| A3 | Inspection : bouton Supprimer visible pour tous ; sur 403 le navigateur **efface la copie locale et annonce « supprimé »** alors que l'inspection existe toujours | Ne rien effacer si le serveur refuse ; bouton réservé à admin+ |
| A4 | Inspections : PPTX consolidé visible pour tous, serveur = executive+ | Masquer sous executive+ |
| A6 | PV : Supprimer visible pour tous, serveur = executive+ | Masquer sous executive+ |
| A15 | Assets : Export Excel de l'inventaire visible pour tous, serveur = admin+ | Masquer sous admin+ |
| A19 | Deck Builder : lien de navigation pour `report-author`/`executive`, page réservée `super_admin` | Aligner le lien de navigation sur la page |
| A11 | Journal d'audit du rapport : 403 lu comme « aucune entrée » | Message explicite d'accès refusé |
| Stale roles | `__authUser` vient du `localStorage` posé à la connexion et n'est jamais rafraîchi : après un changement de rôle, l'interface garde les anciens droits jusqu'à 24 h | `auth.js` rafraîchit l'utilisateur depuis `/api/reports/auth/me` |

## Lot 4 — DÉCIDÉ (2026-10-02) : « tout ouvrir aux coordinateurs, verrouillé à leur site »

Règle unique : chaque action est ouverte au rôle `editor`, **limitée au site du compte** ;
`admin`+ reste sans restriction ; un compte sans site (ou dont le site n'a pas de code dans le
module) n'écrit rien et ne lit que le sien. Les montants des actifs (G-11) restent admin+.

- **4a Rapports — lecture verrouillée** : liste et rapport (`role !== 'admin'` exact → hiérarchie),
  toutes les routes par rapport ou par `site_id` (PPTX, mensuel, annuel, objectifs, reconductions,
  incidents, infra-auto…), `site-data`/`site-actions` par code, journal d'audit (ouvert à
  l'éditeur sur son site, et site vérifié aussi pour `audit-viewer`). Routes de flotte (all-sites,
  weekly-summary, helpdesk-live, technicians) : refusées hors admin. Boutons `reports.html` sur
  la hiérarchie.
- **4b Inspections** : d'abord fermer l'écrasement inter-sites (la ligne existante doit être du
  site de l'éditeur) ; puis rouvrir/modifier une inspection soumise, supprimer, PPTX unitaire,
  PPTX consolidé et Excel — sur son site (filtre forcé côté serveur).
- **4c Réunions** : import PV/incubation ouvert à l'éditeur avec le site forcé (lignes d'autres
  sites refusées) ; édition des PV clos et de leurs problèmes ; suppression de PV ; Excel
  filtré sur le site.
- **4d Pages** : SLA WAN (résumé, incidents, exports filtrés sur le site) ; Analytics (tickets
  et changements forcés sur le site ; CAB et enquête n'ont pas de dimension site → à arbitrer).

## Lot 4 (historique) — liste initiale des décisions

Ce que les coordinateurs perdraient en passant de `admin` à `editor` (+ rôles de fonction),
à trancher avant G-12 : édition/réouverture/suppression/export d'inspections soumises (A5),
import PV et export Excel des réunions, édition de PV clos (A7), lecture des rapports des
autres sites (A9, A13 — certaines routes de lecture ne sont pas cloisonnées par site du tout),
journal d'audit (A11), onglets Finance/Investment des actifs (voulu, G-11), page Analytics
(A18), onglet SLA WAN (A17). Plus les comparaisons exactes sur `users.role` qui traitent un
`executive`/`super_admin` comme « non admin » (A9, A20, `reports.html`, `index.html`).

## Vérification

Chaque correction : test rouge → code → test vert → suites voisines + `await-precedence`.
Avant livraison : suite complète, puis un ZIP par lot ; contrôle navigateur en prod avec un
compte coordinateur (Houndé) pour le lot 2.
