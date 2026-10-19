# Dossier de conception — Étape 04 — Sécurité, SSO et MFA

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : comité (à réceptionner) · Statut : **implémenté (volet agent) — volet humain (Entra, politiques, pentest) en attente**

## 1. Objectif et périmètre
Sûr par défaut : secrets chiffrés avec une clé obligatoire en production, comparaison en temps constant des clés partagées, cookies et en-têtes durcis, limiteur de connexion persistant, dépendances sans vulnérabilité haute, SAST + SCA en CI, matrice d'autorisation par route générée et vérifiée, provisionnement rôle/site depuis les groupes Entra, trace du compte de secours, rétention d'audit 12 mois, procédure d'incident. **Volet humain** (non réalisable par l'agent) : enregistrement d'application Entra et claim `groups`, politique d'accès conditionnel (MFA), passage `available` → `only`, désactivation automatique au départ (API Graph : job `sso.deprovision` à construire une fois l'autorisation Graph `User.Read.All` accordée), test d'intrusion.

## 2. Existant touché
`services/configSecrets.js` (boîtes `enc:v2:` scrypt, lecture `v1` conservée, `planReencryption`, `assertProductionKey`), `tools/pg/reencrypt-secrets.js` (nouveau), `server.js` (`_safeEqual` pour `x-dash-key`, refus de démarrage sans clé en production, cookie `Secure` automatique derrière `x-forwarded-proto: https`, `maxAge` = durée de session, limiteur de connexion persistant, trace `breakglass_login`, provisionnement SSO), `services/rateLimit.js` + `reports-db.rateLimitBump` + `017_rate_limit_hits.sql`, `services/ssoProvisioning.js` + `ssoSettings.groupMap` + claim `groups` dans `ssoEntra`, `reports-db.sessionHours` / `purgeSystemLog`, job `audit.retention`, `services/opmanagerClient.js` (avertissement TLS), `.github/workflows/ci.yml` (`npm audit --audit-level=high`) + `codeql.yml`, dépendances (`axios`, `express`/`qs`/`body-parser`/`proxy-addr`, `form-data`, `nodemailer` 10, `node-cron` 4, SheetJS 0.20.3 depuis le CDN de l'éditeur — l'édition npm 0.18 n'est plus maintenue), `public/help.html` §21, `DOTENV.example`.

## 3. Modèle de données
`rate_limit_hits (scope, key, window_start, count)`. `report_config.sso_group_map` (JSON). Aucune autre table.

## 4. API / CLI
`node tools/pg/reencrypt-secrets.js [--apply]` (+ `SDP_CONFIG_KEY_OLD` pour une rotation). Variables : `NODE_ENV`, `SDP_ALLOW_PLAINTEXT_SECRETS`, `SESSION_HOURS`, `SSO_GROUP_MAP`, `AUDIT_RETENTION_MONTHS`.

## 5. Écrans
Aide §21. La saisie de `sso_group_map` passe par la carte Microsoft SSO (clé générique `PUT /api/reports/config`, super_admin) — champ dédié à ajouter avec l'étape 7 (espace d'administration).

## 6. Règles métier
- Un secret n'apparaît jamais dans un journal, une URL ou une réponse (`_SECRET_BLANK_KEEP`, écriture seule). L'API OpManager impose sa clé en paramètre de requête (convention éditeur) : la clé n'est jamais journalisée côté dashboard ; la vérification TLS reste désactivable (`opmanager_tls_insecure`) avec avertissement au démarrage — **à passer à 0 dès l'installation du CA interne** (arbitrage 5).
- Une table de groupes ne peut ni accorder `super_admin` ni vider les rôles d'un compte ; sans correspondance, le compte garde ce que l'administrateur a réglé.
- Chaque route `/api` est gardée, publique par déclaration motivée, ou derrière le garde global ; `tests/authz-route-matrix.test.js` régénère `docs/ops/AUTHZ-MATRIX.md` et échoue sur toute route non gardée.
- Pages nouvelles sans gestionnaire d'événement en ligne (`tests/csp-no-inline-handlers-new-pages.test.js`) ; les 37 pages héritées sont inventoriées — plan de retrait : une page par étape à partir de l'étape 6 (espace design), `unsafe-inline` retiré de la CSP globale quand l'inventaire est vide.

## 7. Tests
`config-secrets` (+3), `sso-provisioning` (3), `rate-limit` (2), `authz-route-matrix` (1, 327 routes), `csp-no-inline-handlers-new-pages` (2), `sync-jobs-registry` (12 jobs). `npm audit --omit=dev` : 0 vulnérabilité.

## 8. Migration
Déploiement : `NODE_ENV=production` dans `.env` **après** avoir vérifié `SDP_CONFIG_KEY` (déjà posée en prod le 2026-09-24) ; `node tools/pg/reencrypt-secrets.js --apply` convertit les boîtes v1 en v2 (les v1 restent lisibles entre-temps) ; `SESSION_HOURS=8` si l'arbitrage 2 est confirmé.

## 9. Sécurité
Ce dossier. Reste : pentest (arbitrage 6), chiffrement des sauvegardes au repos (clé de chiffrement de volume côté serveur — hors application).

## 10. Exploitation
`docs/ops/INCIDENT-RESPONSE.md`. Exercices semestriels (compte de secours, restauration avec clé, rotation).

## 11. Risques
`NODE_ENV=production` posé sans clé → le serveur refuse de démarrer (volontaire ; message explicite, code de sortie 78). Une table de groupes erronée rétrograde des comptes → la trace `user_role_changed via entra_group_map` nomme chaque changement ; retour arrière = corriger la table, les comptes se réalignent à la connexion suivante.

## 12. Points d'arbitrage (défauts appliqués, à confirmer)
1. **Table groupes ↔ rôles/sites** : un groupe Entra par site (`SDP-<SITE>-Editors` → `editor` + `tracker-editor` + site) + `SDP-Admins` → `admin` — à renseigner par le référent identité.
2. **Durée de session** : 24 h aujourd'hui ; **8 h recommandé** (`SESSION_HOURS=8`).
3. **MFA** : déléguée à l'accès conditionnel Entra sur l'application (toujours, tous les comptes) — **recommandé**.
4. **Fenêtre `available`** : 3 semaines après la cartographie des e-mails, puis `only`.
5. **Rotation des secrets** : annuelle + sur incident ; TLS OpManager vérifié dès le CA interne installé.
6. **Pentest** : périmètre = application + IIS + PostgreSQL, boîte grise, après l'étape 5 (installateur).
