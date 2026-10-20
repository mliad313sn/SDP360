---
title: "SDP Dashboard 2.0 — Plan de remédiation complet"
subtitle: "Un prompt exécutable par constat (C1–F6 + lacunes V4), avec explication, bénéfice et critère d'acceptation"
author: "Product Owner — suite du rapport du comité d'évaluation du 20 octobre 2026"
date: "20 octobre 2026 — version 1.0"
lang: fr
---

> **Comment utiliser ce document.** Chaque fiche porte l'identifiant du constat du rapport du comité (`2026-10-20-RAPPORT-COMITE-EVALUATION.md`), un **prompt** à donner tel quel à l'agent de développement dans le dépôt `SDP360`, une **explication** (pourquoi c'est un problème), le **bénéfice** attendu et un **critère d'acceptation** vérifiable. Les prompts sont autonomes : ils nomment les fichiers, les lignes approximatives, les tests à écrire et les contraintes du dépôt. Ils s'exécutent dans l'ordre des vagues ; à l'intérieur d'une vague, les fiches sans dépendance déclarée peuvent être parallélisées.

# 0. Règles communes à tous les prompts

Préambule à placer en tête de chaque prompt (ou une fois par session de travail) :

```
Dépôt SDP360, branche claude/sdp-dashboard-analysis-55b1oy. Contraintes :
- Pas de régression : la suite complète doit rester à 0 échec avec
  DASH_USER=admin DASH_PASS=TestPassword1234! TZ=UTC
  PG_ADMIN_URL=postgres://postgres@localhost:5433/postgres PG_TESTS_REQUIRED=1 npm test
- server.js reste sous le budget du test de taille (≤ 8260 lignes) ; extraire dans routes/ ou services/
  plutôt que d'ajouter du code inline.
- Double backend : toute requête SQL nouvelle existe en sqlite ET en PostgreSQL (migration
  db/postgres/<zone>/NNN_*.sql + ALTER idempotent côté sqlite) ; toujours (await f()).method().
- Toute règle d'accès passe par rdb.userHasRole(user, 'admin') et services/userSites.js, jamais
  user.role === 'x' ni user.site_id === y.
- Toute clé de configuration nouvelle est ajoutée à reportConfig.DEFAULTS ; tout secret rejoint la liste
  de redaction GET, le filtre blank-keep et la porte super_admin.
- Libellés utilisateur en anglais ET en français (data-lng / data-lng-block) ; aide help.html mise à jour
  dans les deux langues.
- Chaque fiche se termine par : tests ajoutés, CHANGELOG, commit avec le pied de page
  « Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com> » et
  « Claude-Session: https://claude.ai/code/session_01WyKJzoJkxxdA63EkAxcCMC », push sur la branche.
  Aucune pull request.
```

# 1. Vague 1 — Fermer et trancher (semaines 1–2)

## C1 — Clé d'API injectée sans session, routes gardées par la clé seule

**Prompt**

```
Dans server.js, sendHtmlPage (~ligne 1307) injecte window.__ak='<DASH_API_KEY>' dès que injectApiKey est vrai,
sans vérifier la session (le commentaire ~1060 dit que la redirection serveur a été retirée). Corrige :
1. Dans sendHtmlPage, n'injecter la clé que si requireReportSession réussit sur la requête (lire le cookie
   report_token / l'en-tête x-report-token, valider via rdb.validateSession). Sans session valide : servir
   la page SANS la clé et laisser auth.js rediriger vers login.html.
2. Fais basculer sur requireReportSession les routes qui n'acceptent que la clé : GET /api/health/views
   (~628), /api/orgs (~3748), /api/workspaces (~3783), GET /api/risk-register-export (~3961). Pour
   /api/health/views, crée plutôt un GET /ready non authentifié qui ne renvoie que {ok, db, last_job}
   sans aucune donnée métier (voir M14).
3. Dans la porte globale /api/ (~1068-1089), la clé x-dash-key ne doit plus suffire seule pour une
   requête de navigateur : exiger la session dès qu'un cookie report_token OU un en-tête Origin est
   présent ; la clé seule reste tolérée uniquement pour les appels serveur-à-serveur documentés
   (tools/, tâches planifiées) et jamais en paramètre d'URL (voir M7).
4. Écris tests/api-key-injection.smoke.test.js : (a) GET /index.html sans session ne contient pas
   __ak ; (b) avec session il le contient ; (c) GET /api/orgs avec la clé seule → 401 ; (d) /ready
   répond 200 sans authentification et sans champ métier.
5. Mets à jour docs/ops/AUTHZ-MATRIX.md (npm run authz:matrix ou le test qui le génère) et
   docs/sdp360/design/ETAPE-04-securite.md.
```

**Explication.** Toute personne atteignant l'URL d'une page injectée lit la clé dans le source HTML, puis interroge les routes qui n'exigent que cette clé : contournement complet de l'authentification et du périmètre par site.

**Bénéfice.** Ferme la seule faille critique du rapport ; aucune donnée n'est servie sans session nominative.

**Acceptation.** Le smoke test passe ; `grep -n "__ak" server.js` ne montre plus d'injection inconditionnelle ; matrice d'autorisation régénérée sans route « clé seule ».

## C2 — Clé de secours faible

**Prompt**

```
server.js:43-46 dérive une clé par défaut quand DASHBOARD_API_KEY est absent. Remplace par : en
NODE_ENV=production, refuser le démarrage avec un message explicite si la variable manque ou fait moins
de 32 caractères ; hors production, générer une clé aléatoire crypto.randomBytes(32) par démarrage et
l'écrire en log masqué (8 premiers caractères). Ajoute le contrôle dans tools/installer (étape de
configuration .env) et dans docs/ops/INSTALLATION.md. Test : tests/boot-config.test.js lance server.js en
sous-processus avec NODE_ENV=production sans clé et attend un code de sortie non nul.
```

**Explication.** Une installation incomplète est exploitable par défaut avec une clé devinable.

**Bénéfice.** Un oubli d'installation devient une erreur visible, pas une porte ouverte.

**Acceptation.** Le test de démarrage échoue sans clé en production ; l'installateur refuse de poursuivre sans clé.

## E1 — Signature des paquets jamais exécutée, manifeste non signé

**Prompt**

```
.github/workflows/release.yml : l'étape de signature utilise `if: ${{ env.PFX != '' }}` alors que PFX
n'est défini que dans l'env de cette même étape → toujours ignorée (SIGNING.txt dit « signed: NO »), et
le mot de passe est écrit dans GITHUB_ENV. Corrige :
1. Condition au niveau job : `if: ${{ secrets.SIGNING_CERT_PFX_BASE64 != '' }}` via un env de job, ou test
   dans le script ; mot de passe transmis par `env:` à l'étape signtool uniquement, jamais dans GITHUB_ENV
   ni dans une ligne de commande journalisée.
2. Signer manifest.json : ajoute dans services/updatePackage.js une signature Ed25519 (crypto.sign) du
   manifeste avec une clé privée fournie en secret CI (SIGNING_MANIFEST_KEY) ; la clé publique est
   embarquée dans le Manager (tools/installer/Manage-SDP.ps1 ou le module JS appelé) et vérifiée avant
   toute application de paquet ; un paquet non signé est refusé sauf drapeau explicite
   --allow-unsigned journalisé.
3. Épingle les actions par SHA et ajoute `permissions: contents: read` par défaut, `write` seulement sur
   l'étape de publication.
4. Tests : tests/update-package-signature.test.js (manifeste signé accepté, altéré refusé, non signé
   refusé). Documente dans docs/ops/INSTALLATION.md et docs/ops/EXPLOITATION.md.
```

**Explication.** Un paquet de mise à jour est aujourd'hui accepté sur simple hachage livré à côté de lui : un attaquant qui remplace le zip remplace aussi le hachage.

**Bénéfice.** Chaîne de mise à jour authentifiée de bout en bout ; conformité aux attentes d'un audit de chaîne d'approvisionnement.

**Acceptation.** Le prochain run de release produit `SIGNING.txt: signed: YES` ; le Manager refuse un paquet altéré en test.

## E2 — Liaison SSO par e-mail modifiable

**Prompt**

```
reports-db.js findUserByEntra (~1897-1902 sqlite, ~1956-1961 pg) apparie sur lower(email) quand l'oid est
inconnu ; services/ssoEntra.js:148 construit l'e-mail depuis email || preferred_username || upn ;
server.js ~5966 linkUserEntra ré-écrit entra_oid même sur un compte déjà lié. Corrige :
1. Apparier d'abord par entra_oid ; le repli e-mail n'est autorisé que si users.entra_oid IS NULL, que le
   compte n'est ni le break-glass (sso_breakglass_user) ni super_admin, et uniquement sur les claims
   `email` (vérifié) ou `upn`, jamais preferred_username.
2. linkUserEntra ne doit jamais écraser un entra_oid existant différent : lever une erreur journalisée
   (logEvent 'sso_link_conflict', risque) et refuser la connexion avec un message neutre.
3. Ancre correctement la regex de locataire (/^(common|organizations|consumers)$/) (F4) et gère les
   jetons avec _claim_names (dépassement de groupes) : journaliser 'sso_groups_overage' et ne provisionner
   aucun rôle plutôt que de rien dire (F5). Journaliser l'error_description Entra tronquée et redigée.
4. Tests dans tests/sso-db.test.js et tests/sso-entra.test.js : oid connu → match ; oid inconnu + e-mail
   d'un compte déjà lié → refus ; preferred_username seul → aucun match ; break-glass jamais lié.
```

**Explication.** Un attaquant disposant d'un compte Entra dont l'e-mail ou le `preferred_username` coïncide avec un compte local pourrait se faire lier à ce compte, y compris administrateur.

**Bénéfice.** La liaison SSO devient déterministe et non usurpable ; les comptes sensibles sont hors de portée du repli.

**Acceptation.** Les quatre tests passent ; aucune mise à jour d'`entra_oid` sur un compte déjà lié n'est possible.

## E3 — Serveur sur 0.0.0.0, CORS IP, x-forwarded-proto client

**Prompt**

```
server.js:101 BIND_HOST par défaut 0.0.0.0 ; ~940 l'origine http://10.225.99.173:<port> est dans corsAllowed ;
5868 et 5991 posent le drapeau secure du cookie d'après x-forwarded-proto. Corrige : BIND_HOST=127.0.0.1
par défaut (documenté : IIS est le seul point d'entrée), retirer l'origine IP de la liste, utiliser
req.secure (trust proxy 'loopback' est déjà réglé) pour le cookie, ajouter dans tools/installer une règle
pare-feu Windows qui n'ouvre 3456 qu'à 127.0.0.1. Mets à jour docs/ops/INSTALLATION.md et
EXPLOITATION.md. Test : tests/boot-config.test.js vérifie la valeur par défaut de BIND_HOST et l'absence
d'origine IP dans corsAllowed.
```

**Explication.** Node est atteignable en HTTP clair sans IIS, donc sans TLS ni en-têtes de sécurité ; un client peut forcer un cookie non sécurisé.

**Bénéfice.** Un seul point d'entrée TLS ; surface réseau réduite à la boucle locale.

**Acceptation.** `netstat` sur l'instance TEST ne montre 3456 que sur 127.0.0.1.

## E4 — TLS OpManager désactivé, clé dans l'URL

**Prompt**

```
services/reportConfig.js:86 opmanager_tls_insecure vaut '1' par défaut ; services/opmanagerClient.js:13/28/36
met rejectUnauthorized:false et la clé en paramètre de requête. Corrige : défaut '0' ; champ
opmanager_ca_bundle (PEM, secret) passé en `ca:` à l'agent https ; clé envoyée en en-tête si l'API le
permet, sinon redigée (remplacée par <key>) dans toute erreur et tout log (helper redactUrl) ;
tools/opmanager/discover.js affiche un avertissement rouge si tls_insecure='1'. Tests :
tests/opmanager-client.test.js (clé jamais dans e.message ; CA pris en compte).
```

**Explication.** Interception possible du trafic vers OpManager et fuite de la clé dans les journaux de proxy.

**Bénéfice.** Intégration chiffrée et vérifiée ; la clé ne circule plus en clair dans les journaux.

**Acceptation.** Test passe ; la carte admin affiche l'état TLS.

## E5 — Jeton de session en localStorage, CSP 'unsafe-inline'

**Prompt**

```
1. Session : le serveur pose déjà un cookie httpOnly report_token ; fais de ce cookie la source unique.
   Dans public/auth.js, cesse de stocker le jeton en localStorage (garder seulement le profil non
   sensible report_user) ; les appels fetch s'appuient sur credentials:'same-origin'. Supprime les
   lectures de window.__authToken page par page (grep) ; garde x-report-token uniquement pour les CLI.
2. CSP : ajoute un nonce par requête dans sendHtmlPage (helper existant pour CSP nonce dans
   inspection.html) et remplace 'unsafe-inline' sur script-src par 'nonce-…' pour les pages publiques
   et de partage d'abord (exec-view.html, routes/engagement.js report_run.html, login.html), puis
   progressivement sur les autres pages ; les scripts inline existants reçoivent l'attribut nonce via
   injection au chargement (_htmlCache).
3. Tests : tests/csp-headers.smoke.test.js (pages publiques sans 'unsafe-inline' sur script-src) ;
   tests/auth-cookie.smoke.test.js (login ne renvoie plus le jeton dans le JSON, le cookie suffit).
```

**Explication.** Avec le jeton lisible par JavaScript et des scripts inline autorisés, une seule XSS vole la session.

**Bénéfice.** Vol de session impossible par XSS ; réduction du rayon d'action de toute injection HTML.

**Acceptation.** Les smoke tests passent ; connexion, SSO et toutes les pages fonctionnent avec le cookie seul.

## E6 — Comptes non journalisés

**Prompt**

```
server.js:6105-6160 (POST /api/reports/users, PUT /users/:id, DELETE /users/:id) et
tools/pg/demote-coordinators.js n'émettent aucun logEvent. Ajoute logEvent('identity', action, …) pour
user_created, user_updated (avec diff avant/après des champs roles, site_id, extra_site_ids, active,
email ; jamais le mot de passe), user_deleted, password_reset, user_role_changed, avec actor, target,
ip ; marque user_deleted, user_role_changed, password_reset comme risque (_isRiskAction déjà prêt).
demote-coordinators.js écrit une ligne par compte modifié. Tests : étendre tests/system-log.test.js
pour couvrir les trois routes via le serveur local.
```

**Explication.** Les événements d'identité, les plus sensibles, sont invisibles dans le journal de sécurité.

**Bénéfice.** Traçabilité complète des comptes pour l'audit et les enquêtes d'incident.

**Acceptation.** Chaque route d'administration des comptes produit une ligne `system_log` avec avant/après.

## E9 — Un seul score de site, un seul registre (décisions D1, D2)

**Prompt**

```
Après décision du comité (D1 : score de référence = scoreboard opérationnel 4 dimensions ; D2 : seuil
tracker 90 %) :
1. Dans services/metricRegistry.js, déclare une métrique site_score_reference pointant sur
   services/siteScoreboard.js, avec politique RAG 75/55 et propriétaire ; marque sbDims et composite
   « model:author, display-only » dans le registre.
2. Remplace les 38 seuils littéraux de public/executive.html (et ceux de index.html, analytics.html) par
   des lectures de GET /api/metrics/registry (cache 5 min côté page) via public/lib/kpiRag.js ; même chose
   pour les seuils d'alerte dans services/alertRules.js (SLA < 80 → politique du registre).
3. Dans reports.html, site-report.html, les e-mails coordinateur et les decks PPTX, afficher le score de
   référence avec un lien « Comment ce score est calculé » (modal listant les 4 dimensions et leurs
   valeurs) ; les deux autres scores restent sur it-review.html avec l'étiquette « modèle de l'auteur ».
4. Déploie le lot gelé tracker (437a80f + b681083) et retire l'entrée de tools/deploy/frozen-lots.json.
5. Tests : tests/registry-consumers.test.js vérifie qu'aucun fichier de public/ ne contient de seuil RAG
   littéral hors public/lib/kpiRag.js (liste blanche explicite) ; goldens PPTX régénérés une fois avec
   GOLDEN_UPDATE=1 et justifiés dans le commit.
```

**Explication.** Trois à quatre scores et sept politiques RAG pour un même site rendent le chiffre incontestable… parce qu'il est incompréhensible.

**Bénéfice.** Une décision par site sur un chiffre unique, expliqué ; fin des contestations « pourquoi suis-je rouge ».

**Acceptation.** Une seule tuile « score de site » sur toutes les surfaces ; test des consommateurs du registre vert.

## E11 — Restauration jamais répétée, sauvegardes locales et non chiffrées

**Prompt**

```
1. services/backup.js : chiffre le dump (AES-256-GCM avec SDP_BACKUP_KEY, distinct de SDP_CONFIG_KEY,
   ou GPG si disponible) et compresse en .sql.gz ; vérifie l'intégrité par pg_restore --list (ou
   recherche du trailer « PostgreSQL database dump complete ») et pas seulement la taille ; copie vers
   backup_offsite_path (UNC/S3-compatible) si configuré ; aligne la planification (03:00 dans
   services/sync/jobs.js) avec docs/ops/EXPLOITATION.md:34.
2. Écris tools/pg/restore-drill.js : restaure le dernier dump dans un schéma jetable (recette G-02 de
   CLAUDE.md), compte les lignes des 10 tables principales, compare avec la base vivante, écrit un rapport
   daté dans docs/ops/restore-drills/<date>.md et une ligne system_log 'restore_drill'.
3. Planifie le drill mensuellement (jobs.js, 1er du mois 04:00) et ajoute la carte admin « Dernier exercice
   de restauration » (date, résultat).
4. Tests : tests/backup-encrypt.test.js (round-trip), tests/restore-drill.test.js (sur sqlite + pg).
```

**Explication.** Une sauvegarde non restaurée n'est qu'une hypothèse ; stockée sur le même hôte et en clair, elle ne survit ni à la perte du serveur ni à une fuite.

**Bénéfice.** RPO/RTO démontrés, sauvegarde exploitable hors site, preuve mensuelle pour l'audit.

**Acceptation.** Un rapport de drill daté existe ; la documentation et le code annoncent le même format et la même heure.

## M4 — SSRF via webhooks et URL de base

**Prompt**

```
Crée services/safeUrl.js : validateOutboundUrl(url, {allowHosts}) exige https, résout le DNS et refuse
loopback, RFC1918, link-local, métadonnées cloud, et renvoie l'URL normalisée ; maxRedirects:0 sur
l'appel axios. Applique-le à engagement_teams_url, engagement_webhook_url, publish_webhook_url
(services/engagementJobs.js:49-50, 96, 121), teams_sla_channels, opmanager_base_url, meraki_base_url,
sdp_api_base_url à la sauvegarde (400 explicite) ET avant chaque envoi. Liste blanche par défaut :
*.webhook.office.com, *.logic.azure.com, hôtes configurés en interne. Journalise tout changement d'URL
(config_saved, voir M3). Tests : tests/safe-url.test.js (10 cas) + un smoke sur PUT settings.
```

**Explication.** Un administrateur de configuration (ou un attaquant ayant son compte) peut faire poster le serveur vers n'importe quel hôte interne, clé OpManager comprise.

**Bénéfice.** Les intégrations sortantes ne peuvent plus servir de pivot ni d'exfiltration.

**Acceptation.** Une URL privée est refusée à la sauvegarde et à l'envoi.

## M7 — Clé d'API en paramètre d'URL, base OData depuis Host

**Prompt**

```
routes/extApi.js:29 accepte ?api_key= ; :54 construit @odata.context depuis l'en-tête Host ; $orderby/$filter
acceptent des propriétés hors ENTITIES (__proto__). Corrige : en-tête X-Api-Key ou Authorization: Bearer
uniquement (retrait de la query, 400 avec message de migration pendant une version) ; base OData =
reportConfig.public_base_url ; propriétés validées contre ENTITIES[entity].fields (400 sinon) ; limiteur
par clé (ex. 60 req/min, express-rate-limit déjà présent) en plus du quota journalier. Mets à jour
docs/sdp360/design/ETAPE-09-rapports-engagement-publication.md et le guide Power BI. Tests dans
tests/ext-api.smoke.test.js.
```

**Explication.** Les clés en URL finissent dans les journaux et historiques ; l'en-tête Host est contrôlable ; les propriétés libres ouvrent des lectures de prototype.

**Bénéfice.** API conforme à l'objectif écrit « clés hors des URL », sans fuite ni injection de lien.

**Acceptation.** Le smoke test refuse `?api_key=` et une propriété inconnue.

## M9 — Fuite des messages d'erreur internes

**Prompt**

```
server.js renvoie e.message au client en ~268 endroits (ex. 642, 1194) ; idem routes/extApi.js odataErr.
Crée services/httpError.js : fail(res, e, status) qui journalise e avec un id de corrélation (UUID),
renvoie {error:'internal_error', correlation_id} pour les 5xx et ne laisse passer e.message que pour les
erreurs typées (e.code in ['FORBIDDEN','VALIDATION','NOT_FOUND', …]). Remplace mécaniquement
res.status(500).json({ error: e.message }) par fail(res, e) (script de réécriture + revue) ; ajoute un
gestionnaire d'erreurs Express final. Les clients sdpApiClient/merakiClient/opmanagerClient redigent URL et
jetons dans leurs messages. Test : tests/http-error.test.js + grep de non-régression dans
tests/no-message-leak.test.js.
```

**Explication.** Les messages internes révèlent chemins, requêtes SQL et hôtes.

**Bénéfice.** Support plus simple (un identifiant à citer) et moins d'information offerte à un attaquant.

**Acceptation.** `grep -c "e.message" server.js` tombe sous 20, tous sur des erreurs typées.

# 2. Vague 2 — Rencontrer les utilisateurs (semaines 3–8)

## E7 — Aucune validation utilisateur

**Prompt**

```
1. Exécute le script docs/sdp360/design/ETAPE-06-test-utilisabilite.md avec 5 coordinateurs : prépare un
   kit (instance TEST avec données anonymisées via tools/pg/anonymise-snapshot.js à écrire, comptes de
   test, grille SUS en français, feuille de chronométrage du rapport hebdo). Les résultats sont consignés
   dans docs/sdp360/review/usability/<date>-session-<n>.md et agrégés dans
   docs/sdp360/review/usability/SYNTHESE.md (SUS, temps, verbatims, top 10 irritants).
2. Exécute docs/sdp360/design/ETAPE-10-script-pilote.md sur deux sites ; même consignation.
3. Remplis doc 08 §10.1 (acceptation métier par étape) et §10.2 (décisions, avec D1–D8) à partir des
   comptes-rendus du comité ; crée les décisions correspondantes dans le registre (routes/governance.js)
   via un script d'import tools/governance/import-decisions.js.
4. Ajoute un tableau de bord d'adoption : events *_viewed généralisés (services/viewLog.js) à chaque
   page, route GET /api/reports/adoption?window=30d (ouvertures par page × rôle × site), carte admin et
   tuile dans l'espace direction. Tests : tests/adoption.smoke.test.js.
```

**Explication.** Rien n'a encore été observé avec un vrai utilisateur ; les scores de ce rapport sont des jugements d'experts.

**Bénéfice.** Remplace les suppositions par des mesures (SUS, minutes, irritants) et donne au comité une base pour trancher.

**Acceptation.** Synthèse SUS et pilote publiées ; §10.1/§10.2 remplis ; tuile d'adoption visible.

## E8 — Modules 6 à 10 en anglais seulement

**Prompt**

```
Francise public/dashboards.html, public/trackers*.html, public/governance* (cockpit.html, portfolio.html,
rfi.html), public/report-studio*.html, public/field/* avec le mécanisme data-lng / data-lng-block et un
helper T(key) commun extrait de meetings-import.html dans public/lib/i18n.js (dictionnaire JSON par page,
bascule persistée en localStorage, défaut = langue du profil utilisateur : nouveau champ users.lang
'fr'|'en', réglé par l'utilisateur et par défaut 'fr' pour les sites, 'en' pour les comptes sans site).
Couvre libellés, messages d'erreur serveur (renvoyer un code + paramètres, traduction côté page), e-mails
(gabarits FR/EN) et le manifeste PWA. Test : tests/i18n-coverage.test.js échoue si une page de la liste
contient un texte visible hors balise data-lng (heuristique sur les nœuds texte > 3 caractères).
```

**Explication.** Les utilisateurs quotidiens sont francophones ; le technicien de terrain note la langue 1/5.

**Bénéfice.** Condition d'adoption de base ; moins d'erreurs de saisie ; cohérence avec les modules historiques bilingues.

**Acceptation.** Test de couverture vert ; une session de test d'utilisabilité menée entièrement en français.

## E10 — Données personnelles publiques, absence de registre GDPR (décisions D4, D5)

**Prompt**

```
1. services/execSummary.js et public/exec-view.html : retirer sujets bruts de tickets, textes RCA/CA et
   tout champ libre ; ne publier que des agrégats et des libellés de catégorie ; le résumé IA de MI ne sort
   qu'après passage par un filtre PII (voir M19) et uniquement si exec_view_mi_summary_public='1'.
2. Corrige docs/sdp360/06-COMPARATIF-EXECUTIF.md:166 (« PII retirées à l'ingestion » est faux) par une
   description exacte : demandeur, technicien, sujet stockés ; e-mail/IP/MAC retirés par stripPiiColumns.
3. Rédige docs/compliance/REGISTRE-DES-TRAITEMENTS.md (par table : finalité, base légale, catégories,
   durée, destinataires, transferts) et docs/compliance/AIPD-IA-CLOUD.md (flux, risques, mesures ; conclusion
   : IA cloud interdite tant que D5 n'est pas signée ; AI_PROVIDER=local ou off par défaut, vérifié au
   démarrage avec un refus explicite si cloud sans ai_cloud_dpia_signed='1').
4. Rétention : jobs.js nouveau job data.retention (request_records au-delà de retention_months_tickets,
   share_views, api_calls, field_outbox, uploads) avec purge journalisée ; valeurs par défaut dans
   reportConfig.DEFAULTS, carte admin.
5. Tests : tests/exec-view-pii.test.js (aucun champ libre dans /api/exec/summary),
   tests/data-retention.test.js.
```

**Explication.** Des données nominatives sont publiées sans authentification et la documentation de direction affirme le contraire ; aucune base légale documentée.

**Bénéfice.** Conformité UK GDPR démontrable ; page publique qui ne peut plus embarrasser l'entreprise.

**Acceptation.** `/api/exec/summary` ne contient aucun texte libre ; registre et AIPD en place ; démarrage refusé en IA cloud sans AIPD signée.

## M5 — Application terrain : refus destructifs, cache partagé, clôture sans retour

**Prompt**

```
public/field/app.js : sur 400/403/409, ne plus appeler obDel ; passer l'entrée en état 'rejected' avec
le message serveur, la garder visible dans une section « À corriger » avec actions Modifier / Renvoyer /
Supprimer (confirmation). public/field/sw.js:22 : ne mettre en cache que les GET d'une liste blanche
(bootstrap, lookups), nommer le cache avec l'id utilisateur, vider tous les caches et IndexedDB à la
déconnexion et sur toute réponse 401, respecter Cache-Control: no-store. Clôture d'action : toast avec
Annuler 8 s (patron du hub Site Actions) avant envoi. Ajoute la vue « Mes actions » (filtre owner =
utilisateur, données déjà dans le bootstrap) et la recherche d'actif par QR/Service Tag (GET
/api/assets/lookup?tag=, lecture seule, sans montant). Tests : tests/field-pwa-static.test.js (plus de
obDel sur refus ; liste blanche du SW), tests/field-routes.smoke.test.js (lookup actif).
```

**Explication.** Un refus efface le travail du technicien ; un téléphone partagé sert les données du précédent utilisateur ; une clôture par erreur est irréversible.

**Bénéfice.** Confiance du terrain (rien n'est perdu), confidentialité sur appareil partagé, pilote viable.

**Acceptation.** Scénario du script pilote « refus pour site étranger » conserve la saisie ; déconnexion vide les caches.

## M6 — Téléversement terrain non borné

**Prompt**

```
routes/field.js : vérifier que owner_id (l'inspection cible) appartient à un site de l'utilisateur
(inspectionDb.getInspectionHeader + userSites.inScope) avant tout chunk ; quota par utilisateur et par
jour (field_upload_quota_mb, défaut 200) et par inspection (field_photo_max_kb × 60) ; limite de corps
des routes de chunk à 2 Mo ; purge des téléversements orphelins > 48 h déjà présente dans field.purge —
y ajouter le journal. Tests : smoke 403 sur inspection d'un autre site ; 413 au-delà du quota.
```

**Explication.** Un technicien peut aujourd'hui attacher des photos à l'inspection d'un autre site et remplir le disque.

**Bénéfice.** Périmètre par site respecté jusqu'aux fichiers ; protection du serveur contre la saturation.

**Acceptation.** Les deux smoke tests passent.

## M13 — Doublons fonctionnels et menu surchargé (décision D6)

**Prompt**

```
1. public/_shell.js : regrouper les 13 enfants d'Operations en quatre blocs (Reporting · Trackers ·
   Réunions & actions · Terrain), une seule entrée « Trackers » (le constructeur ; l'ancien
   activity-tracker.html devient une redirection après migration confirmée par
   tools/tracker/migrate-2026.js --verify), icônes distinctes vérifiées par tests/module-tabs.test.js.
2. Espace direction : conserver dashboards.html (composeur) comme surface unique ; executive.html,
   exec-view.html et it-review.html deviennent des tableaux de bord composés (ou des liens « vue
   historique » retirés du menu principal) ; documente le plan de retrait dans
   docs/sdp360/design/ETAPE-06-design-direction.md.
3. Reporting : le studio génère aussi les decks PPTX hebdo/mensuels via un gabarit unique
   (services/reportTemplates/), les generate*Pptx legacy restant derrière un drapeau pendant une version.
4. Mets à jour help.html (EN/FR) et le document 08 §10.2.
```

**Explication.** Trois surfaces direction, deux trackers, trois chaînes de reporting : les utilisateurs ne savent pas où aller, et chaque doublon double le coût des corrections.

**Bénéfice.** Navigation lisible, maintenance divisée, un seul endroit où ajouter une fonctionnalité.

**Acceptation.** Menu Operations ≤ 5 blocs ; une seule entrée Trackers ; plan de retrait daté.

## M16 — Ergonomie du rapport hebdomadaire et du PV

**Prompt**

```
public/reports.html : autosauvegarde visible (bandeau « Enregistré 14:02 » / « Non enregistré » avec
raison), validation au fil de l'eau par champ (règles existantes de validateActionItems appelées au
blur), confirmation de suppression avec annulation 8 s, remplacement des prompt()/confirm() natifs par la
modale de marque (patron deleteModal d'inspection.html), chronomètre de session opt-in qui alimente la
métrique report_edit_minutes (tuile adoption). public/meeting.html : autosauvegarde 1,5 s comme le
rapport (en respectant le verrou PV clos). Actions : une saisie unique — depuis le rapport hebdo, bouton
« Créer aussi dans Réunions/Inspections » qui pose source/origin_id au lieu de retaper ; le hub Site
Actions montre la provenance. Tests : tests/reports-autosave.smoke.test.js,
tests/meeting-autosave.smoke.test.js.
```

**Explication.** 269 contrôles sur 5 onglets, sauvegardes silencieuses, triple saisie : c'est là que se perd le temps des coordinateurs.

**Bénéfice.** Objectif « 20 minutes » atteignable et enfin mesuré ; moins de données perdues.

**Acceptation.** Temps médian de rédaction mesuré ≤ 20 min sur les sessions de test ; zéro `confirm(` natif dans `public/`.

## M17 — Design : couleurs hors palette, contraste, RAG par la couleur seule

**Prompt**

```
public/_tokens.css : ajouter les jetons --rag-green/--rag-amber/--rag-red (et leurs variantes texte et
fond conformes WCAG AA, contraste ≥ 4,5:1) et une échelle typographique (--fs-1…--fs-6) ; remplacer les
hex RAG en dur de public/brand/components.css, public/field/styles.css (#E87722 → var(--edv-orange)),
public/activity-tracker/styles.css par ces jetons. Toute pastille RAG porte un symbole ou un texte en plus
de la couleur (✓ ▲ ✕ ou libellé) — composant .edv-rag partagé. Relie design-system/ aux pages via un
test tests/design-tokens.test.js qui refuse tout hex de la famille RAG hors _tokens.css. Vérifie les
contrastes avec un script tools/design/contrast-check.js.
```

**Explication.** Couleurs divergentes entre modules, contraste insuffisant sur ambre et vert, information portée par la couleur seule (daltonisme, impression noir et blanc).

**Bénéfice.** Lisibilité, accessibilité AA, cohérence de marque, et un seul endroit pour changer une couleur.

**Acceptation.** Test des jetons vert ; rapport de contraste sans échec.

# 3. Vague 3 — Gouverner et consolider (semaines 9–12)

## M1 — Séparation des tâches (décision D7)

**Prompt**

```
routes/reportStudio.js:91-97 et services/reportStore.setStatus : refuser reviewed si reviewed_by ===
created_by (403 'SOD_VIOLATION'), sauf drapeau report_studio_allow_self_review='1' réservé aux
instances à un seul utilisateur et journalisé. server.js:7140-7170 : la remise en brouillon d'un rapport
soumis exige un utilisateur différent de celui qui a soumis OU le palier admin ; reassign-week interdit
quand status='submitted' (400). Le HTML d'un run publié n'est plus re-rendu (updateHtml seulement en
draft). Tests : tests/sod.smoke.test.js (4 cas).
```

**Explication.** Une seule personne peut rédiger, relire et publier ; un chiffre « validé » peut être modifié par son auteur.

**Bénéfice.** Contrôle à deux personnes sur ce qui sort vers la direction ; exigence de base d'un audit.

**Acceptation.** Les quatre cas passent ; le document de conception de l'étape 9 décrit la règle.

## M2 — Chiffres gelés et hachés, fraîcheur réelle

**Prompt**

```
1. À la soumission d'un rapport hebdo (server.js ~7154) et à la publication d'un run du studio, calculer
   figures_json (tous les KPI affichés, pas seulement le parc) et figures_sha256 ; nouvelle table
   report_figures_snapshot (sqlite + migration pg 021). Les surfaces de lecture (site-report, e-mail,
   PPTX) lisent le snapshot quand il existe ; une recalculation qui diffère affiche « recalculé le … :
   écart » et journalise figures_drift.
2. Fraîcheur : chaque métrique du registre porte source_job ; GET /api/metrics/… renvoie as_of = dernier
   succès du job (services/sync/jobs.js last_success_at) et non l'heure de la requête ; les tuiles
   affichent « données au … » ; stale si > seuil.
3. Réconciliation Zoho automatique hebdomadaire : tools/pg/reconcile-zoho.js compare 6 agrégats
   (inbound, closed, SLA…) entre request_records et un export Analytics, écrit le résultat dans
   system_log 'reconciliation' et dans docs/ops/reconciliations/<date>.md. Tests : snapshot round-trip,
   drift détecté, as_of = last_success_at.
```

**Explication.** Un rapport soumis peut changer après coup sans trace ; la date affichée n'est pas celle des données.

**Bénéfice.** Un chiffre publié devient opposable ; la direction sait de quand datent les données.

**Acceptation.** Hachage présent sur tout rapport soumis ; `as_of` reflète le job ; un rapport de réconciliation daté.

## M3 — Journal infalsifiable avec avant/après, configuration journalisée

**Prompt**

```
reports-db.js logEvent (~8277-8297) : ajouter les colonnes before_json/after_json et prev_hash/row_hash
(chaîne SHA-256 par ligne, migration pg 022, ALTER sqlite) ; une écriture échouée n'est plus avalée en
silence : compteur en mémoire + alerte dans /ready et logEvent de secours sur fichier. Émettre
config_saved (clé, avant, après — secrets masqués) dans PUT /api/reports/config et toutes les routes
settings ; metric_changed dans metricRegistry (table metric_registry_history). Journaliser les exports de
journaux (F6). tools/pg/verify-log-chain.js vérifie la chaîne. Rétention définie pour audit_log,
share_views, api_calls (F6). Tests : chaîne valide / rompue ; config_saved émis.
```

**Explication.** Sans avant/après ni chaîne, le journal ne permet ni de reconstruire une modification ni de prouver qu'il n'a pas été altéré.

**Bénéfice.** Journal exploitable en enquête et opposable en audit.

**Acceptation.** Script de vérification vert ; chaque modification de configuration laisse une ligne.

## M8 — Liens de partage

**Prompt**

```
routes/engagement.js:84-100 : Referrer-Policy: no-referrer et CSP stricte à nonce sur les vues partagées
(après E5) ; site_id obligatoire pour un partage de tableau de bord sauf confirmation explicite « tout le
groupe » journalisée ; TTL par défaut 14 jours ; embed_frame_ancestors validé comme liste d'origines ;
vérifier et tester l'échappement HTML du rendu de rapport (services/reportRenderer) avec une charge XSS
dans un sujet de ticket et un commentaire IA. Tests dans tests/engagement-share.smoke.test.js.
```

**Explication.** Un lien administrateur expose tous les sites ; le jeton fuit par `Referer` ; l'échappement n'est pas prouvé.

**Bénéfice.** Partage externe sûr par construction.

**Acceptation.** Charge XSS neutralisée dans le test ; partage sans `site_id` refusé par défaut.

## M10 — Hygiène cryptographique

**Prompt**

```
services/configSecrets.js : sel scrypt aléatoire par installation (stocké dans report_config
config_key_salt, généré au premier démarrage) ; AAD = nom de la clé de configuration (v3) ; les boîtes v1
(sha256 non salé) et v2 sont acceptées en lecture jusqu'à une date de fin (CONFIG_KEY_V1_SUNSET) après
laquelle le démarrage refuse tant que tools/pg/reencrypt-secrets.js n'a pas tout migré ;
SDP_ALLOW_PLAINTEXT_SECRETS ignoré en production avec alerte. Documente l'option DPAPI/Credential Manager
dans docs/ops/INSTALLATION.md. Tests : tests/config-secrets.test.js (AAD empêche l'échange de boîtes
entre clés ; v1 refusée après sunset).
```

**Explication.** Sel fixe, ancienne dérivation acceptée indéfiniment, boîtes interchangeables entre champs.

**Bénéfice.** Secrets robustes même en cas de fuite partielle de la base.

**Acceptation.** Tests verts ; tous les secrets de prod ré-encryptés en v3.

## M11 — Rendu PDF sans bac à sable

**Prompt**

```
services/reportRender.js:31-35 : retirer --no-sandbox (ou l'isoler dans un compte de service dédié sur
Windows, documenté) ; fs.mkdtemp pour les fichiers temporaires ; passer le HTML par stdin ou un fichier
à permissions restreintes ; --disable-javascript quand le gabarit ne l'exige pas ; délai et limite de
taille. Test : tests/report-render.test.js (répertoire temporaire unique, nettoyage).
```

**Explication.** Chromium sans bac à sable sur un HTML influençable par des données externes est une élévation de privilège potentielle.

**Bénéfice.** Génération de PDF sans risque d'exécution de code sur le serveur.

**Acceptation.** Aucun `--no-sandbox` dans le code ; PDF des rapports toujours produits.

## M12 — Architecture : fichiers « dieu », DDL en double, identité des sites

**Prompt (à exécuter en plusieurs commits)**

```
1. Extraire server.js route par route vers routes/<module>.js (patron routes/inspection.js : factory
   (deps) => router, handlers byte-identiques, test de fumée par module) dans cet ordre : reports/users,
   reports/config, meetings, tracker, assets, risk-register, admin. Objectif de vague : server.js < 5000
   lignes ; abaisser le budget du test de taille à chaque extraction.
2. reports-db.js : découper en services/db/<zone>.js (auth, reports, helpdesk, sites, system-log) en
   gardant l'API d'export via un index ; le test await-precedence doit continuer à découvrir les
   dispatchers.
3. DDL unique : générer le schéma sqlite des tests à partir des migrations pg (traducteur minimal dans
   db/sqlite-from-pg.js : types, IDENTITY → INTEGER PRIMARY KEY, IF NOT EXISTS) et supprimer les CREATE
   TABLE inline des *-db.js une zone à la fois, avec un test de parité de colonnes.
4. Identité des sites : une seule source services/siteIdentity.js alimentée par site_module_codes et
   sites.aliases_json ; scoreboardAliases, _codeFromName, rr_site_aliases, SITE_MAP tracker/inspection
   deviennent des lectures de cette source ; test de non-régression sur les 11 noms réels de prod.
5. CLAUDE.md : réduire à index + état courant + pièges ; déplacer le journal chronologique vers
   docs/history/CLAUDE-LOG.md (F3). Retirer --test-force-exit des suites qui n'en ont plus besoin (F3).
```

**Explication.** Deux fichiers de 8 000 lignes, deux sources de schéma et quatre cartes d'identité des sites multiplient les régressions « sqlite vert, PostgreSQL rouge ».

**Bénéfice.** Coût de chaque correction divisé ; onboarding d'un second développeur possible.

**Acceptation.** `server.js` < 5 000 lignes ; test de parité DDL vert ; une seule fonction de résolution de site.

## M14 — Exploitation

**Prompt**

```
1. Une seule procédure de déploiement : docs/ops/EXPLOITATION.md (Manager 2.0) fait foi ; le modèle
   ZIP/marqueur de CLAUDE.md est archivé dans docs/history ; tools/deploy/frozen-lots.json vidé après D2.
2. GET /ready (non authentifié, voir C1) : base joignable, dernier job de synchro < 2 h, espace disque
   > 10 %, taille du tas ; GET /api/health (session) détaillé par job.
3. Alertes émises par une tâche planifiée externe (tools/ops/healthcheck.js lancé par le Manager toutes
   les 5 min, e-mail/Teams si /ready ≠ 200) au lieu du processus surveillé.
4. Rotation des journaux (pm2-logrotate ou fichier dans ecosystem.config.js créé ici, avec
   --max-old-space-size et NODE_ENV) ; métriques basiques (/metrics Prometheus : requêtes, latence,
   jobs) ; profil mémoire _rawCache : cesser le préchargement et ajouter un test de non-croissance.
5. Les envois planifiés par schtasks passent dans le registre jobs.js (supprimer la dépendance au Task
   Scheduler pour les rapports). Tests : ready/health smoke ; ecosystem.config.js lu par le Manager.
```

**Explication.** Deux documentations contradictoires, une santé superficielle et des alertes émises par le processus qui peut tomber.

**Bénéfice.** Exploitation prévisible par quelqu'un d'autre que l'auteur ; détection des pannes avant les utilisateurs.

**Acceptation.** `/ready` répond ; une alerte externe part quand le serveur est arrêté sur l'instance TEST.

## M15 — Chaîne d'approvisionnement

**Prompt**

```
package.json : épingler les versions exactes (npm pkg set … --save-exact), remplacer le tarball CDN xlsx
par une copie vendorisée vendor/xlsx-0.20.3.tgz avec hachage documenté et surveillance manuelle des
avis SheetJS ; .github : actions épinglées par SHA, permissions minimales par job, workflow CI limité
aux branches main et claude/* ; ajouter dependabot.yml (npm + actions), gitleaks en CI, génération d'un
SBOM CycloneDX attaché à chaque release, script npm run audit:ci. Tests : tests/ci-config.test.js
vérifie l'épinglage.
```

**Explication.** Dépendances flottantes, une bibliothèque hors radar des audits, actions non épinglées, pas de SBOM.

**Bénéfice.** Builds reproductibles et vérifiables ; alertes de vulnérabilité automatiques.

**Acceptation.** `npm ci` reproductible ; SBOM dans la release ; Dependabot actif.

## M18 — Gouvernance des données et registre des risques

**Prompt**

```
services/metricRegistry.js : colonnes version, owner, changed_at, changelog_json (migration pg 023) ;
PUT sur une métrique crée une version et une ligne metric_changed ; page registre affiche
propriétaire et historique ; services/kpiRag.js aggregate([]) renvoie null (« non mesuré ») et les
consommateurs affichent « — ». risk-register-export.js : versionner le classifieur (RISK_CLASSIFIER_VERSION
dans la feuille), lister les identifiants SDP des tickets par cellule (déjà dans Tickets_<mois>) et
ajouter une feuille « Méthode » ; stocker un snapshot de chaque export (risk_register_exports). Tests :
registre versionné ; aggregate([]) === null ; export reproductible.
```

**Explication.** Un registre sans propriétaire ni historique ne peut pas arbitrer ; un zéro affiché pour « rien mesuré » est faux.

**Bénéfice.** Chaque KPI a un responsable et une histoire ; les exports de risque sont retraçables.

**Acceptation.** Tests verts ; chaque métrique affiche un propriétaire.

## M19 — Minimisation des données envoyées à l'IA

**Prompt**

```
services/aiCommentary.js:16-64 : ajouter un filtre PII appliqué à tous les champs texte (regex e-mails,
téléphones, noms de l'annuaire users/listPeople, matricules), remplacement par des jetons stables P1,
P2… avec dé-anonymisation par table et non par regex ; interdire les URL dans la sortie ; échapper la
sortie IA avant insertion HTML (helper esc existant) ; journaliser la taille et le hachage de chaque
prompt envoyé (jamais le contenu). Tests : tests/ai-commentary.test.js (nom de personne jamais dans le
prompt ; lien dans la sortie neutralisé).
```

**Explication.** Les textes libres partent tels quels vers un fournisseur externe et la sortie est rendue sans échappement prouvé.

**Bénéfice.** Usage de l'IA compatible avec l'AIPD ; pas de XSS par commentaire généré.

**Acceptation.** Tests verts ; AIPD mise à jour avec le filtre.

## M20 — Suppressions logiques

**Prompt**

```
Ajouter deleted_at (+ deleted_by) sur weekly_reports, governance cadences/sessions/decisions/actions,
report_runs, dashboards, trackers (migration pg 024 + ALTER sqlite) ; les routes DELETE posent
deleted_at au lieu de DELETE ; toutes les lectures filtrent deleted_at IS NULL ; corbeille admin avec
restauration 30 jours puis purge par le job data.retention ; les cascades de 018_governance.sql
deviennent des mises à jour deleted_at. Tests : suppression → invisible, restaurable, purgée après 30 j.
```

**Explication.** Supprimer une cadence efface sessions, actions et comptes-rendus sans recours.

**Bénéfice.** Erreurs réversibles ; preuve conservée pour l'audit.

**Acceptation.** Aucun `DELETE FROM` sur ces tables hors du job de purge.

## F1 — Exemption du préfixe `/reports/`

**Prompt**

```
Dans la porte globale /api/, retirer l'exemption du préfixe /reports/ ; chaque route sous /api/reports
doit passer explicitement par requireReportSession (vérifier avec tests/authz-route-matrix.test.js que
toutes les routes ont au moins un garde ; faire échouer le test sinon).
```

**Bénéfice.** Une route oubliée est fermée par défaut au lieu d'ouverte par défaut.

## F2 — SMTP sans TLS obligatoire

**Prompt**

```
services/mailer.js:43 : requireTLS:true dès que smtp_host n'est pas un hôte local, auth ou non ;
tls.minVersion 'TLSv1.2' ; option smtp_allow_plaintext='1' explicite pour un relais interne, journalisée.
Test dans tests/mailer.test.js.
```

**Bénéfice.** Aucun courriel de rapport ne circule en clair par défaut.

## F3 — `--test-force-exit` et CLAUDE.md

Couvert par M12 points 5. **Bénéfice.** Fuites de ressources visibles en test ; mémoire du projet lisible.

## F4 / F5 — Regex de locataire SSO, dépassement de groupes

Couverts par E2 point 3. **Bénéfice.** Comportement SSO explicite dans les cas limites.

## F6 — Exports non journalisés, rétention des journaux

Couvert par M3. **Bénéfice.** Un export de journal est lui-même une trace.

# 4. Vague 4 — Lacunes fonctionnelles (après le pilote)

Ces fiches ne sont lancées qu'après V2, sur décision du comité, une à la fois.

## V4-1 — File de tickets et SLA dans l'application terrain

**Prompt**

```
Ajouter au bootstrap terrain (routes/field.js) les tickets ouverts assignés à l'utilisateur ou à son
groupe (lecture request_records par tech_group des sites de l'utilisateur, champs : id, sujet, priorité,
échéance SLA, statut) ; vue « Mes tickets » triée par échéance avec pastille RAG ; action « Prendre /
Résoudre » envoyée par sdpApiClient (write derrière sdp_api_write_enabled, idempotent via outbox) ;
création de ticket activable par site. Tests : smoke bootstrap ; outbox idempotent sur action ticket.
```

**Bénéfice.** L'application terrain devient l'outil quotidien du technicien, pas seulement celui des inspections.

## V4-2 — Espace département et participation de l'encadrement

**Prompt**

```
Rôle department-head (lecture de ses PV, création/suivi d'escalade, commentaire) ; signature du PV par
lien nominatif (jeton à usage unique envoyé par e-mail au chef de département, horodatage serveur, hachage
du contenu signé stocké dans md_meetings) ; page meetings-department.html FR/EN ; Engagement #4 calculé
depuis les envois de comptes-rendus (minutes_sent). Tests : signature nominative ; E4 non nul.
```

**Bénéfice.** La « signature » a une valeur probante ; l'encadrement participe au lieu de subir.

## V4-3 — Pilotage Group IT : budget, fournisseurs, risques, capacité

**Prompt**

```
Trois trackers configurables (étape 7) livrés comme gabarits : budget réalisé/prévu par site et
catégorie, registre fournisseurs/contrats (échéances, SLA contractuels, reliés aux circuits WAN SLA),
registre des risques IT/SMSI (ISO 27005 : actif, menace, impact, probabilité, propriétaire, plan) ; un
tableau de bord direction composé qui les réunit avec le score de site ; export du registre des risques
en annexe du Risk Register mensuel. Tests : gabarits importables, dashboard rendu.
```

**Bénéfice.** Group IT décide sur budget, contrats et risques dans le même outil que les opérations.

## V4-4 — Page statut employé

**Prompt**

```
status.html public (FR/EN) : état des services par site (dérivé des MI actifs et des changements
planifiés), calendrier des maintenances (change_records à venir), contacts IT par site, tableau des SLA
par priorité (CLAUDE.md « SLA Targets by Site »), lien « Suivre mon ticket » vers SDP ; aucun texte libre.
Test : aucun champ libre dans /api/status.
```

**Bénéfice.** Transparence pour tous les employés sans exposer de données personnelles.

## V4-5 — Équité entre sites et décisions reliées aux résultats

**Prompt**

```
Normaliser les dimensions volumétriques du score de référence par la taille du parc (assets) et
l'effectif IT (sites.headcount nouveau champ) ; afficher le percentile plutôt que le rang brut sous 20
actifs ; dans le registre des décisions, champ success_metric (métrique du registre + cible + échéance)
et tuile « décisions tenues / en retard » dans le cockpit.
```

**Bénéfice.** Classement acceptable par les petits sites ; chaque décision est suivie jusqu'à son effet.

## V4-6 — Gestion des problèmes et base de connaissance

**Prompt**

```
Module problems : fiche problème reliée à n incidents SDP (par id), cause racine, erreur connue,
contournement ; alimentation automatique depuis les MI (RCA/CA) ; base de connaissance interne
(markdown, recherche) reliée aux catégories ; indicateurs dans le registre (problèmes ouverts, MI
récurrents). Tests : liaison incident-problème ; recherche.
```

**Bénéfice.** Fin des incidents répétés non capitalisés ; alignement ITIL au-delà du miroir des changements.

# 5. Tableau récapitulatif

| ID | Vague | Fiche | Effort indicatif | Dépendances |
|---|---|---|---|---|
| C1 | V1 | Clé d'API et routes clé seule | 1,5 j | — |
| C2 | V1 | Clé de secours | 0,5 j | — |
| E1 | V1 | Signature des paquets | 2 j | — |
| E2 | V1 | Liaison SSO (+F4, F5) | 1,5 j | — |
| E3 | V1 | Bind, CORS, cookie secure | 0,5 j | — |
| E4 | V1 | TLS OpManager | 1 j | — |
| E5 | V1 | Cookie httpOnly, CSP nonce | 3 j | C1 |
| E6 | V1 | Journal des comptes | 1 j | — |
| E9 | V1 | Score unique, registre | 4 j | D1, D2 |
| E11 | V1 | Sauvegardes, drill | 2 j | — |
| M4 | V1 | Anti-SSRF | 1 j | — |
| M7 | V1 | API externe | 1 j | — |
| M9 | V1 | Erreurs centralisées | 2 j | — |
| E7 | V2 | Tests utilisateurs, pilote, adoption | 10 j (dont terrain) | E8, M5 |
| E8 | V2 | Francisation | 6 j | — |
| E10 | V2 | PII, registre GDPR, rétention | 4 j | D4, D5 |
| M5 | V2 | App terrain | 3 j | — |
| M6 | V2 | Quota téléversement | 1 j | — |
| M13 | V2 | Doublons, menu | 4 j | D6 |
| M16 | V2 | Ergonomie rapport/PV | 4 j | — |
| M17 | V2 | Design tokens, contraste | 2 j | — |
| M1 | V3 | Séparation des tâches | 1 j | D7 |
| M2 | V3 | Chiffres gelés, fraîcheur, réconciliation | 4 j | E9 |
| M3 | V3 | Journal chaîné (+F6) | 3 j | E6 |
| M8 | V3 | Partage | 1,5 j | E5 |
| M10 | V3 | Crypto | 1,5 j | — |
| M11 | V3 | PDF sandbox | 0,5 j | — |
| M12 | V3 | Découpage, DDL, identité des sites (+F3) | 10 j | — |
| M14 | V3 | Exploitation | 4 j | C1 |
| M15 | V3 | Chaîne d'approvisionnement | 1,5 j | E1 |
| M18 | V3 | Registre versionné, risque | 2 j | E9 |
| M19 | V3 | IA minimisation | 1,5 j | E10 |
| M20 | V3 | Suppressions logiques | 2 j | — |
| F1, F2 | V3 | Garde /reports, SMTP | 0,5 j | — |
| V4-1…6 | V4 | Lacunes fonctionnelles | 3 à 6 j chacune | pilote |

Total indicatif V1–V3 : **~85 jours-personne** sur 12 semaines, compatible avec un développeur assisté par agent à plein temps et un second contributeur sur V2 (francisation, tests utilisateurs).

# 6. Ordre d'exécution recommandé et critères de passage

- **V1** : C1 → C2 → E3 → E6 → M9 → E2 → E4 → M4 → M7 → E1 → E5 → E11 → E9 (E9 dès que D1/D2 sont signées). Passage : test de pénétration gris sans critique ni élevé ; un seul score sur toutes les surfaces.
- **V2** : E8 → M5 → M6 → M17 → M16 → M13 → E10, puis E7 (tests utilisateurs et pilote sur la version francisée). Passage : SUS ≥ 70 ; rapport hebdo ≤ 20 min médian ; `/api/exec/summary` sans texte libre.
- **V3** : M1 → M2 → M3 → M8 → M10 → M11 → M19 → M20 → M18 → M15 → M14 → M12 (en continu). Passage : audit blanc sans constat majeur ; `server.js` < 5 000 lignes ; dossier GDPR complet.
- **V4** : une fiche à la fois, chacune validée par le comité avec sa métrique de succès.

# 7. Bénéfices cumulés attendus (rappel)

| Après | Bénéfice mesurable |
|---|---|
| V1 | 0 critique / 0 élevé au test de pénétration ; un score de site unique ; restauration démontrée |
| V2 | SUS ≥ 70 ; 1 à 2 jours par mois et par site rendus aux coordinateurs ; terrain utilisable en français sans perte de saisie ; conformité GDPR documentée |
| V3 | Audit interne sans constat majeur ; chiffres publiés opposables ; coût de correction divisé par le découpage ; exploitation transférable |
| V4 | Outil quotidien des techniciens ; participation de l'encadrement ; pilotage budget/fournisseurs/risques au niveau groupe |
