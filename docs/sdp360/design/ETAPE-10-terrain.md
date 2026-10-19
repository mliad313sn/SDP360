# Dossier de conception — Étape 10 — Application terrain hors-ligne (PWA), file d'attente idempotente, photos fragmentées, actions rapides

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : comité (à réceptionner) · Statut : **implémenté (volet agent) — volet humain (sites pilotes, rôle `field-tech` sur les comptes, ouverture de l'écriture SDP par CAB, réplica PostgreSQL, exercice de restauration) en attente**. Script du pilote : `ETAPE-10-script-pilote.md`. Réplica et restauration : `docs/ops/REPLICA-RESTORE.md`.

## 1. Objectif et périmètre
Donner aux techniciens de site une **application installable sur téléphone** (`public/field/`, PWA sans cadre, sans framework) qui fonctionne **sans réseau** : capture rapide d'inspection avec photo, saisie des trackers du mois, fermeture / transfert d'actions avec justification, signalement au helpdesk, et un tableau de bord « Mon site — terrain » daté. Chaque écriture est une **enveloppe** `{uuid, kind, payload}` mise en file (IndexedDB) et rejouée quand le réseau revient ; le serveur l'applique **exactement une fois** (`field_outbox`, idempotence par `uuid`) à travers **les mêmes écrivains** que les pages de bureau (`saveInspection`, `trackerStore.saveEntries`, `addActionUpdate`) : mêmes règles RBAC, même verrou des mois clos, mêmes statuts de transfert. Les photos sont compressées sur l'appareil (≤ 300 Ko) et transmises **par fragments de 64 Ko** rejouables.

**Hors périmètre agent** : le choix des sites et appareils pilotes, l'attribution du rôle `field-tech`, l'ouverture de l'écriture vers SDP (`sdp_api_write_enabled`), l'installation du réplica PostgreSQL et l'exercice de restauration trimestriel, les notifications poussées (Web Push), le formulaire d'inspection complet sur mobile (173 items, signatures) qui reste celui du bureau.

## 2. Existant touché
- **Nouveau** : `services/fieldOutbox.js` (pur : validation d'enveloppe, hachage stable, plan/assemblage des fragments, validateurs de charge, `dataAsOf`), `services/fieldStore.js` + `db/postgres/reports/020_field.sql` (ledger `field_outbox`, `field_uploads`, `field_chunks`), `routes/field.js` (7 routes, toutes `requireReportSession` + garde terrain), `public/field/{index.html, app.js, styles.css, sw.js, manifest.webmanifest, icon.svg}`, `docs/ops/REPLICA-RESTORE.md`, ce dossier et le script du pilote, aide §27 EN/FR, tests (§7).
- **Modifié** : `services/sdpApiClient.js` (`writeEnabled` + `createRequest`, refusé `WRITE_DISABLED` sinon), `services/reportConfig.js` (`sdp_api_write_enabled='0'`, `field_photo_max_kb='300'`), `reports-db.js` (`field-tech` dans `FEATURE_ROLES_KNOWN`), `services/sync/jobs.js` (tâche optionnelle `field.purge` 03:00), `public/_shell.js` (Operations ▸ Field app, rôles éditeur / `field-tech`), `public/reports.html` (carte de rôle `field-tech`), `server.js` (création du store, montage, `initAtBoot`, injection paresseuse pour la tâche — budget respecté : **8 259 lignes**), `tests/a11y-static.test.js`.
- **Inchangé, volontairement** : les écrivains des modules et leurs tables ; `public/inspection.html` (le formulaire complet) ; le résolveur des tableaux de bord (le tableau terrain lit `/api/dashboards/field-site/data`).

## 3. Modèle de données
`field_outbox` (`uuid` PK, utilisateur, `kind` inspection|tracker|action|ticket, `payload_hash` sha256 canonique, statut `received`→`applied`|`rejected`|`failed`, `result` JSON, `client_ts`, `device`, horodatages) — la ligne est écrite **avant** l'écriture métier et terminée **après** : une coupure entre les deux laisse `received`, que le PUT identique suivant complète au lieu d'appliquer deux fois. `field_uploads` (propriétaire = identifiant d'inspection, nom, MIME, taille, fragments reçus JSON, `ref` du magasin de blobs, statut open|done) + `field_chunks` (`upload_id` FK CASCADE, `idx`, base64) vidée à la complétion (le magasin `blobStore` tient alors les octets, `<data>/blobs/inspection/<id>/`). Journal `system_log` catégorie `field` : `field_<kind>_<statut>`.

## 4. API
En-tête de `routes/field.js`. Garde terrain = palier `editor` **ou** rôle `field-tech` (un `viewer` → 403). Portée de site via `services/userSites` (codes inspection pour inspection/actions, codes tracker pour les unités). `PUT /api/field/outbox/:uuid` : 400 enveloppe invalide ; même uuid + même hachage → `{duplicate:true, status, result}` sans réappliquer ; même uuid + autre charge → **409** ; uuid d'un autre utilisateur → 403 ; charge refusée (400/403/`REJECTED`) → statut `rejected` **terminal** (le téléphone supprime l'élément) ; erreur serveur → `failed` + 500 (le téléphone réessaie). Tickets : `sdp_api_write_enabled='0'` → `rejected` avec motif — jamais une boucle de réessai. Téléversements : cap `field_photo_max_kb` (≤ 300), MIME jpeg/png/webp, fragment ≤ `chunk_bytes`, indice hors plage 400, `complete` 400 tant qu'un fragment manque (liste `missing`), idempotent une fois `done`.

## 5. Écrans
Une page, cinq onglets (barre basse, cibles ≥ 44 px) : **Home** (site, « Data as of », Sync, mode bas débit, file d'attente), **Inspect** (zone, catégorie, items ok/minor/major/critical/na, photo, observations), **Tracker** (tracker publié, unité autorisée, période non close, items), **Actions** (actions ouvertes du site : Close / → Ticket / → Demand / Cancel avec fenêtre de justification + n° de ticket ; signalement helpdesk), **Dashboard** (`field-site`, un chiffre non mesuré = « — », date la plus récente des widgets). Passe `a11y-static` (langue, viewport, lien d'évitement, `main`, contrôles étiquetés, région `role="status"`, aucun gestionnaire en ligne) et la CSP (`script-src 'self'`, pas de script en ligne). Maquettes designer : à produire (arbitrage 1 de l'étape 6).

## 6. Règles métier
- **Conflits** : dernier écrit gagne pour inspections et actions ; tracker = dernier écrit **sauf mois clos** (gardé tel que stocké, compté `blocked`, jamais perdu en silence). Un même uuid ne s'applique qu'une fois ; une charge différente sous le même uuid est une erreur du client (409), jamais une fusion.
- **Photos** : compression sur l'appareil (côté ≤ 1 280 px, JPEG, qualité décroissante jusqu'à ≤ cap) ; sur le chemin terrain les `data:` URL en ligne sont **refusées** (400) — seuls les téléversements complétés sont référencés ; une photo n'est jamais renvoyée entière : seuls les fragments manquants le sont.
- **Null ≠ 0** : « Data as of » = date la plus récente des widgets, jamais `now()` ; un tableau sans donnée datée affiche « — (not measured) ».
- **Secrets** : le jeton de session reste dans `localStorage` du téléphone (comme les pages) ; aucun secret SDP ne transite vers le client (`features.ticket` est un booléen).

## 7. Tests
`field-outbox` (5), `field-store` (2), `pg-field-store` (1, migration 020, cascade), `field-pwa-static` (2 : manifeste, précache = fichiers présents, SW ne touche pas aux écritures, pas de script/gestionnaire en ligne, nav + carte de rôle câblées), `field-routes.smoke` (4 : gardes et portée du bootstrap ; PUT idempotent / 409 / 403 / mois clos bloqué / unité étrangère rejetée ; téléversement cap → fragments → complétion → blob → inspection appliquée avec sa photo, data URL refusée, autre site 403 ; action : transfert sans justification 400, autre site 403, fermeture appliquée ; ticket désactivé → `rejected` terminal et rejeu = `duplicate`). Gardes transverses relancées : `a11y-static` (+ `field/index.html`), `authz-route-matrix`, `server-size-budget`, `sync-jobs-registry`, CSP.

## 8. Migration et mise en service
1. Déployer ; la migration `020` crée les trois tables ; `field.purge` apparaît dans `/api/sync/health` (optionnelle).
2. Donner `field-tech` aux techniciens pilotes (ou s'appuyer sur `editor`) ; vérifier le site principal de chaque compte.
3. Faire installer `/field/index.html` (Ajouter à l'écran d'accueil) ; jouer le script du pilote.
4. Après le pilote et un CAB : `sdp_api_write_enabled='1'` (client OAuth Zoho avec portée `SDPOnDemand.requests.CREATE`) — le bouton ticket s'active sans redéploiement.
5. Mettre en place le réplica et jouer l'exercice de restauration (`docs/ops/REPLICA-RESTORE.md`).

## 9. Sécurité
Toutes les routes `/api/field/*` sont dans la matrice d'autorisation (session + garde terrain) ; un téléversement n'est lisible que par son auteur ; les identifiants d'enveloppe sont des UUID v4 générés sur l'appareil, la propriété est vérifiée au rejeu ; la portée de site est recalculée serveur à chaque enveloppe (jamais `user.site_id ===`). Le service worker ne met en cache que des GET et des fichiers de l'app ; une réponse servie depuis le cache porte `x-field-cache: stale`. Corps JSON bornés (2 Mo enveloppe, 200 Ko fragment).

## 10. Exploitation
`SELECT status, count(*) FROM field_outbox WHERE received_at > now() - interval '7 days' GROUP BY 1` : un `received` ancien = coupure entre ledger et écriture (le rejeu du téléphone le complétera) ; `failed` récurrents = défaut serveur à lire dans `result`. `field.purge` nettoie le ledger (> 90 j) et les téléversements abandonnés (> 48 h). Bump `CACHE_VERSION` dans `sw.js` à chaque livraison de l'app terrain.

## 11. Risques
- Un téléphone jamais reconnecté garde sa file : rien n'est perdu mais rien n'arrive ; le compteur de file le montre, le coordinateur relance.
- Safari iOS limite le stockage hors-ligne (éviction après 7 jours sans usage) : le pilote mesure ; les enveloppes sont petites (photos ≤ 300 Ko).
- Pas de Web Push : l'alerte reste Teams/e-mail (étape 9).
- Compteur de la suite complète non déterministe sous `--test-force-exit` (constaté étape 9) : lire « 0 fail », pas le total.

## 12. Points d'arbitrage (défauts appliqués, à confirmer)
1. **Sites pilotes** : un site minier (Houndé) + un bureau (Ouagadougou), deux semaines chacun — proposé.
2. **Appareils** : téléphones Android existants des techniciens, PWA sans MDM ; iOS en « écran d'accueil » — proposé.
3. **Politique de conflit** : dernier écrit gagne + verrou des mois clos sur les trackers — **appliqué**.
4. **Taille** : photo ≤ 300 Ko après compression (clé `field_photo_max_kb`, plafond dur 300), fragments 64 Ko, ≤ 64 fragments, enveloppe ≤ 2 Mo — **appliqué**.
5. **Écriture vers SDP** : création de tickets **désactivée** par défaut, à ouvrir par décision CAB (`sdp_api_write_enabled`) ; portée du client OAuth à élargir à `requests.CREATE` — **appliqué (désactivé)**.
6. **Réplica** : réplication en flux PostgreSQL vers une seconde machine du même site, promotion manuelle ; RPO 15 min / RTO 2 h — proposé (`docs/ops/REPLICA-RESTORE.md`).
