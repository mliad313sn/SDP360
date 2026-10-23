# Dossier de conception — Étape 07 — Builder de trackers et migration du tracker 2026

Version 1 · 2026-10-23 · Auteur : agent IA · Relecteurs : comité produit, propriétaire du tracker des activités
Référence : SDP-DASH-2.0-ETUDE v1.2, §6.3 étape 7, lacune L7 (chaque tracker est un développement).

> **Statut : livré, construit sur les options recommandées (§6).** La migration du tracker 2026 est **outillée et
> prouvée** (écart nul sur les données de production), mais la **bascule** et le **retrait des anciennes tables**
> restent des décisions : le tracker migré démarre en *fonctionnement parallèle* (recopie chaque nuit, saisie
> fermée), comme le demande l'étude.

## 1. Fiche → réalisé

| Demandé par l'étude | Réalisé | Où |
|---|---|---|
| Modèle de définition (période, unités, groupes, éléments, types de KPI, pondérations, cibles) validé | oui — définition JSON versionnée, validateur avec erreurs bloquantes et avertissements | `services/trackers/definition.js` |
| Builder avec validation en ligne, score à blanc, revue → publication versionnée | oui — chaque modification est vérifiée par le serveur ; publication, historique, retour à une version | `tracker-builder.html`, `routes/trackers.js` |
| Saisie par unité × période, verrouillage des mois clos, import xlsx | oui — grille mensuelle par unité, mois verrouillés par un responsable, import Excel avec contrôle à blanc | `trackers.html`, `services/trackers/exchange.js` |
| Éléments liés automatiquement aux sources (réunions, inspections, tickets) | oui — un élément peut être lié à une clé du dictionnaire ; valeur calculée chaque nuit par le même lecteur que les écrans | `services/trackers/sources.js`, tâche `trackers.sources` |
| Importeur du tracker 2026, fonctionnement en parallèle un mois, comparaison à ±0,1 pt | oui — import, recopie nocturne, comparaison des deux moteurs à chaque recopie (journal système) | `services/trackers/legacyImport.js`, `legacyCompare.js`, tâche `trackers.legacy_mirror`, `tools/trackers/compare-legacy.js` |
| Bascule, retrait des anciennes tables | **non — décision** (DEC-7.4) | §5 |
| PPTX et Excel lisent le même moteur de score | oui pour les trackers métier (export Excel + 2 diapositives) ; le deck historique du tracker des activités garde son moteur jumeau jusqu'à la bascule | `public/lib/trackerEngine.js` |
| Templates (dispatch terrain, déploiement matériel, maintenance de site, conformité réunions) | oui — 4 modèles | `services/trackers/templates.js` |

## 2. Un seul moteur

`public/lib/trackerEngine.js` (chargé par le serveur et par le navigateur) calcule les scores de l'écran de saisie,
du score à blanc, de l'export Excel et des diapositives. Il reproduit **formule par formule** le moteur du tracker
des activités (`public/activity-tracker/engine.js`) : six types (nombre, pourcentage, fait/pas fait, jalons,
montant, note), éléments communs (maximum sur toutes les unités), poids redistribués entre éléments actifs,
poids de groupe par défaut 0,25. Les couleurs viennent de `public/lib/kpiRag.js` (politique `tracker_activity`),
jamais d'un seuil écrit dans le moteur.

**Preuve de fidélité** (critère « sans écart ») :

| Données | Contrôles | Écart maximal | Couleurs différentes |
|---|---|---|---|
| Copie de production, tracker 2026, mois 1 à 10, 5 sites actifs × 31 activités | 3 085 | 0 point | 0 |
| 5 trackers aléatoires (tous les types, éléments communs, fenêtres décalées) | > 15 000 | 0 point | 0 |

Commande sur le serveur, à relancer avant la bascule : `node tools/trackers/compare-legacy.js --year=2026`.

## 3. Modèle

Une définition contient : identifiant, titre, année, **unités** (code, nom, site rattaché, active), **groupes**
(code, nom, poids 0-1), **éléments** (code, nom, groupe, type, poids, mois de début et de fin, commun, lien
éventuel à une clé du dictionnaire), **cibles** par unité et élément, **audience** (rôles qui consultent, toutes
les unités ou celles de ses sites), **saisie** (rôles qui saisissent, sur ses unités seulement ou non), politique
de couleurs. Aucune formule, aucun balisage. Les saisies sont stockées par tracker × année × unité × élément ×
mois (`trk_entries`, avec qui et quand), les mois clos dans `trk_locks` (migration `019_trackers.sql`).

## 4. Droits (option recommandée DEC-7.2)

| Action | Qui |
|---|---|
| Construire, enregistrer un brouillon, score à blanc | `tracker-author` (nouveau rôle de fonction) |
| Publier, revenir à une version, retirer, verrouiller un mois, saisir sur toutes les unités | `tracker-publisher` (nouveau rôle de fonction) |
| Saisir | les rôles de saisie de la définition, sur les unités de ses sites (par défaut) |
| Migrer le tracker des activités | `super_admin` |
| Modifier un tracker migré | `tracker-publisher` ou `super_admin` |

Toute saisie, tout import, tout verrouillage et toute publication est inscrit au journal système.

## 5. Plan de migration du tracker 2026 (DEC-7.4)

1. **Import** (super_admin, builder ▸ Nouveau tracker ▸ Migrer) : crée `it-activity-2026`, publié, en
   fonctionnement parallèle. Le tracker des activités reste l'outil de saisie.
2. **Un mois en parallèle** : chaque nuit, la tâche `trackers.legacy_mirror` recopie les saisies et compare les deux
   moteurs ; un écart fait échouer la tâche (visible dans Santé des synchronisations, alerte si activée).
3. **Bascule** (proposée : premier jour d'un cycle mensuel, après un mois sans écart) : dans le builder, décocher
   « Fonctionnement en parallèle » et publier. La saisie se fait alors dans le tracker métier ; la recopie s'arrête.
   Les coordinateurs reçoivent le rôle de saisie (`tracker-editor` est déjà dans la définition migrée).
4. **Retrait** des anciennes tables et de l'ancien écran : après un cycle de rapports complet produit depuis le
   nouveau tracker, et seulement si le comité le décide (le deck mensuel historique du tracker doit d'abord être
   reconstruit sur le moteur commun).

## 6. Points d'arbitrage

| # | Question | Recommandation appliquée |
|---|---|---|
| DEC-7.1 | Expérience du builder (maquettes) | builder livré en tableaux éditables + vérification en direct ; maquettes à faire relire par le designer avec celles de l'étape 6 |
| DEC-7.2 | Droits | §4 |
| DEC-7.3 | Versionnage et retour arrière | une version n'est jamais réécrite ; un retour republie l'ancienne comme nouvelle version ; les saisies ne sont pas versionnées (elles portent auteur et date) |
| DEC-7.4 | Plan de migration (dates, responsables, critères) | §5 ; dates et responsables à fixer par le comité |

## 7. Critères de réception

| Critère | Mesure | État |
|---|---|---|
| ≥ 3 trackers créés sans développeur | journal système, action `tracker_created` puis `tracker_published` | à mesurer après déploiement |
| Tracker 2026 migré sans écart | `tools/trackers/compare-legacy.js` + comparaison nocturne | 0 écart sur la copie de production |
| Aucune formule hors du moteur | un seul moteur pour écran, Excel et diapositives des trackers métier ; tests `trackers-engine.test.js` | oui, sauf le deck historique du tracker des activités jusqu'à la bascule |
