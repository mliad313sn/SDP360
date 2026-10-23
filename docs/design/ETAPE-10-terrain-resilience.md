# Dossier de conception — Étape 10 — Application terrain hors ligne, résilience des données

Version 1 · 2026-10-23 · Auteur : agent IA · Relecteurs : comité produit, coordinateurs de site (pilote), administrateur
des serveurs (réplica), RSSI (écriture dans ServiceDesk Plus)
Référence : SDP-DASH-2.0-ETUDE v1.2, §6.3 étape 10, lacunes L16 (inspections et saisies impossibles sans réseau sur
site), L17 (une journée de données perdue au pire en cas de panne du serveur). Décision DEC-2026-007 (réplica à
l'étape 10, objectif 15 minutes).

> **Statut : livré, désarmé là où une décision manque.** L'application terrain fonctionne dès le déploiement pour
> les comptes qui reçoivent le rôle `field-tech`. L'écriture directe dans ServiceDesk Plus est **coupée** (les actions
> rapides attendent dans une file traitée à la main par le coordinateur). Le réplica PostgreSQL est **surveillé dès
> qu'il existe** ; le construire est un geste de l'administrateur des serveurs (`docs/ops/REPLICA-POSTGRESQL.md`).

## 1. Fiche → réalisé

| Demandé par l'étude | Réalisé | Où |
|---|---|---|
| Application installable sur téléphone (PWA), utilisable sans réseau | oui — `field.html` + manifeste + service worker limité à l'application terrain (jamais une réponse d'API en cache) | `public/field.html`, `field-app.js`, `sw.js`, `field.webmanifest` |
| Inspection complète hors ligne (grille des 17 catégories, constats, photos, actions correctives) | oui — la grille est téléchargée à la connexion, le brouillon vit dans le téléphone (IndexedDB) | `field-app.js`, `GET /api/field/bootstrap` |
| Photos compressées, envoi qui reprend après une coupure | oui — ≤ 300 Ko (150 Ko en mode faible débit), envoi par morceaux de 32 Ko, reprise au morceau manquant, vérification du type réel à l'assemblage | `services/field/uploads.js` |
| Dictée vocale des constats | oui — reconnaissance vocale du navigateur, en français (quand le téléphone la propose) | `field-app.js` |
| Synchronisation sans perte ni doublon | oui — file d'envoi locale ; chaque envoi a un identifiant fixe, un renvoi (réponse perdue) ne crée ni doublon ni faux conflit | `services/field/inspections.js`, `fd_inspection_saves` |
| Conflits visibles, jamais écrasés en silence | oui — si l'inspection a été modifiée ailleurs depuis, le téléphone le dit ; le technicien garde sa version (forcer) ou recharge celle du serveur | `PUT /api/field/inspections/:id` (409) |
| Saisie des trackers depuis le terrain | oui — les trackers publiés de l'année, limités aux unités que la personne peut écrire, mêmes droits que l'écran de bureau | `services/trackers/rights.js` |
| Actions rapides sur les tickets (ouvrir, clôturer, transférer) | oui — **en file d'attente** tant que l'écriture ServiceDesk Plus est coupée ; le coordinateur du site les exécute et les marque faites. Armée, l'application écrit directement et retombe sur la file en cas de refus | `services/field/quickActions.js`, `sdpWriter.js` |
| Mode faible débit | oui — photos plus petites, envoi différé au Wi-Fi au choix | `field-app.js` |
| Réplica PostgreSQL, objectif de perte ≤ 15 minutes | surveillance livrée (tâche `db.replica_lag`, toutes les 5 min, alerte au-delà de 15 min, réplica injoignable ou promu) ; construction = procédure d'exploitation | `services/replica.js`, `docs/ops/REPLICA-POSTGRESQL.md` |
| Pilote terrain mesuré | protocole + outil de mesure | `docs/ops/PILOTE-TERRAIN.md`, `tools/metrics/field-pilot.js` |

## 2. Ce qui protège les données

1. **Rien ne quitte le téléphone avant d'être confirmé.** Un envoi reste dans la file locale tant que le serveur
   n'a pas répondu « enregistré » ; une coupure au milieu reprend au morceau manquant.
2. **Pas de doublon.** L'inspection garde l'identifiant créé sur le téléphone ; chaque photo a un identifiant fixe.
   Rejouer un envoi produit le même résultat.
3. **Pas d'écrasement silencieux.** Le téléphone envoie la date de la version qu'il a reçue ; si quelqu'un a modifié
   l'inspection depuis dans le formulaire complet, le serveur répond « conflit » et le technicien choisit.
4. **Pas de photo d'autrui.** Une inspection n'accepte que les photos envoyées par la même personne, et ne garde que
   les références de photos qui lui appartiennent déjà.
5. **Même périmètre qu'au bureau.** Un technicien n'écrit que sur son site, comme dans le module Inspections.
6. **Photos purgées** si elles sont abandonnées (non rattachées) depuis 7 jours — tâche `field.uploads_purge`.

## 3. Mise en service

| Geste | Qui | Où |
|---|---|---|
| Donner le rôle `field-tech` aux techniciens du pilote, avec leur site | super_admin | Admin ▸ Utilisateurs |
| Installer l'application sur le téléphone : ouvrir `http://<serveur>:3456/field.html`, se connecter, « Ajouter à l'écran d'accueil » | technicien | téléphone |
| Ouvrir l'application une fois **avec réseau** avant de partir sur le terrain (téléchargement de la grille et des trackers) | technicien | téléphone |
| Traiter la file des actions rapides | coordinateur (editor du site) | `field.html` ▸ Demandes du site |
| (Option, DEC-10.1) Armer l'écriture ServiceDesk Plus : `field_sdp_write_enabled = 1` + jeton d'écriture | super_admin | Admin ▸ Paramètres |
| Construire le réplica, renseigner `PG_REPLICA_URL` | administrateur des serveurs | `docs/ops/REPLICA-POSTGRESQL.md` |

> Le service worker d'un navigateur exige HTTPS, sauf sur `localhost`. **Sur `http://10.x.x.x:3456`, l'installation
> hors ligne ne fonctionne pas** : il faut l'adresse HTTPS du tableau de bord (proxy IIS existant) — voir DEC-10.3.

## 4. Droits

| Rôle | Peut |
|---|---|
| `field-tech` (nouveau) | utiliser l'application terrain sur son site : inspections, photos, trackers dont il est saisisseur, actions rapides |
| `editor` du site | idem + traiter la file des actions rapides du site |
| admin et au-dessus | tous les sites |
| `viewer` seul | rien (403) |

## 5. Points d'arbitrage

| Code | Question | Recommandation | Par défaut livré |
|---|---|---|---|
| DEC-10.1 | L'application écrit-elle directement dans ServiceDesk Plus ? | oui après le pilote, avec un compte de service dédié limité à la création / clôture / transfert | coupé, file manuelle |
| DEC-10.2 | Quels 3 sites pour le pilote ? | un site bien connecté, un site moyen, un site à faible débit | — |
| DEC-10.3 | Adresse HTTPS de l'application terrain | réutiliser le nom HTTPS du proxy IIS existant | HTTP (installation hors ligne impossible) |
| DEC-10.4 | Réplica : second serveur ou seconde instance sur un autre disque ? | second serveur (sinon une panne matérielle emporte les deux) | surveillance prête, aucun réplica |

## 6. Critères de réception (mesurés par le pilote)

| Critère | Cible | Mesure |
|---|---|---|
| Inspection de 10 photos synchronisée à 1 Mbit/s | ≤ 2 min | `node tools/metrics/field-pilot.js` (critère 1) |
| Perte de données sur coupure réseau | zéro | fiche du pilote + outil (critère 2) |
| Saisie hebdomadaire sur 3 sites | ≤ 20 min | fiche du pilote |
| Satisfaction des techniciens (NPS) | ≥ +30 | `--nps=reponses.csv` |
| Perte maximale en cas de panne du serveur | ≤ 15 min | exercice trimestriel, `docs/ops/REPLICA-POSTGRESQL.md` §6 |

## 7. Tests

`tests/field.test.js` (envois repris, inspection hors ligne, conflits, photos forgées, file des actions rapides,
écriture SDP simulée, réplica, mesures du pilote, périmètre du service worker), `tests/field-routes.smoke.test.js`
(droits, chaîne complète photo → inspection, file, page stricte et installable), `tests/pg-field.test.js` (PostgreSQL).
