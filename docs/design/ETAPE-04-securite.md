# Dossier de conception — Étape 04 — Sécurité, SSO et MFA

Version 1 · 2026-10-19 · Auteur : agent IA · Relecteur : présidence du comité
Référence : SDP-DASH-2.0-ETUDE v1.2, §6.3 étape 4, lacune L9. Procédure : `docs/ops/INCIDENT-RESPONSE.md`.

> **Statut : partie code implémentée ; partie identité et gouvernance en attente des gestes du
> propriétaire.** Le SSO, la synchronisation des groupes et la désactivation automatique sont livrés
> **désarmés**. Rien ne change pour les utilisateurs au déploiement, sauf la connexion qui exige
> désormais `SDP_CONFIG_KEY` en mode production (§4).

## 1. Fiche → réalisé

| Demandé | Réalisé | Où |
|---|---|---|
| Clé de chiffrement obligatoire en production, dérivation scrypt, re-chiffrement | oui | `services/configSecrets.js` : boîtes **v2** (scrypt N=2¹⁵, sel par valeur), v1 toujours lisibles ; `tools/pg/encrypt-secrets.js --apply` ré-chiffre v1 → v2 ; `services/backendGuard.js` refuse le démarrage sans clé quand `REQUIRE_POSTGRES=1` ou `REQUIRE_CONFIG_KEY=1` |
| Clés API hors URL | oui | OpManager : clé dans l'en-tête `apiKey` (`services/opmanagerClient.js`, l'ancien passage dans l'URL n'existe plus qu'en option `opmanager_apikey_in_query`) ; `/api/health/views` n'accepte plus de jeton dans l'URL |
| TLS vérifié vers OpManager | oui | vérification par défaut (`opmanager_tls_insecure='0'`) ; `opmanager_ca_file` = PEM de l'autorité interne ; le mode non vérifié reste possible mais journalise un avertissement |
| Comparaison de clés en temps constant | oui | `services/safeCompare.js` : clé du tableau de bord, clé Meridian, nonce SSO |
| Remplacement de la bibliothèque Excel non maintenue | oui | SheetJS **0.20.3** (dernière version maintenue, distribuée hors npm, embarquée dans `vendor/`) — même API, aucun code modifié |
| CSP sans script inline sur toute nouvelle page + plan de retrait | oui | `services/cspPolicy.js` : politique stricte (`script-src` sans `unsafe-inline`, `script-src-attr 'none'`) sur les nouvelles pages ; cliquet `tests/csp-inline.test.js` + `tests/__golden__/inline-scripts.json` (569 éléments inline sur 32 pages, ne peut que baisser) ; plan au §3 |
| HSTS, cookies Secure/HttpOnly/SameSite | oui | HSTS existait ; cookie de session : HttpOnly + SameSite=Lax + **Secure automatique dès que la requête arrive en HTTPS** (`_sessionCookieOpts`) |
| Limiteur de débit persistant | oui | `services/authThrottle.js` + `db/postgres/reports/017_auth_throttle.sql` : 10 échecs / 15 min par compte, 30 par adresse, conservé en base (survit à un redémarrage) |
| npm audit, SCA et SAST en CI | oui | 11 vulnérabilités → **0** (axios, nodemailer 10, express patché, SheetJS, overrides `image-size` et `uuid`) ; CI : `npm audit --audit-level=high` et ESLint + `eslint-plugin-security` **bloquants** ; Dependabot hebdomadaire |
| Branches protégées, revue obligatoire | **non** — geste propriétaire | réglage GitHub (§5, DEC-6) |
| SSO Entra `available` puis `only` | code prêt depuis F2a | geste propriétaire (enregistrement d'application, DEC-4) |
| MFA déléguée à l'accès conditionnel Entra | — | politique Entra, hors code (DEC-3) |
| Synchronisation groupes Entra → rôles et sites | oui, désarmée | `services/ssoGroupSync.js` + carte *Admin ▸ Microsoft SSO* ; carte JSON validée côté serveur (une carte invalide est refusée) ; jamais `super_admin` par un groupe |
| Désactivation automatique au départ | oui, désarmée | job `entra.deprovision` (02:50), modes off / **preview** / on ; plafond 20 % par passage ; une erreur Graph ne désactive personne |
| Compte de secours journalisé | oui | `breakglass_login` = événement à risque ; testé (`tests/breakglass.smoke.test.js`) |
| Journal d'audit étendu, conservé 12 mois | oui | `services/apiAudit.js` : chaque écriture d'API et chaque refus 403 → System Logs (catégorie *api*), sans le corps de la requête ; job `audit.retention` (02:40) |
| Procédure de réponse à incident | oui | `docs/ops/INCIDENT-RESPONSE.md` |
| Tests d'autorisation par rôle sur chaque route | oui | `tests/route-authz.smoke.test.js` : les **328** routes d'API sont découvertes dans le routeur ; chacune refuse un appel anonyme (sauf 6 publiques nommées) ; les **116** routes protégées par rôle refusent un `viewer` |
| Test d'intrusion | **non** — prestation externe | périmètre au DEC-7 |

## 2. Ce qui change au déploiement

1. **Dépendances** : le paquet contient un `node_modules` complet construit sur le poste de développement (même Windows x64 et Node 24 que la production). `_apply_on_prod.cmd` arrête le serveur, met l'ancien dossier de côté (`node_modules.prev-…`), copie le nouveau, vérifie qu'il se charge, et **remet l'ancien** sinon. Aucun `npm` sur le serveur.
2. **`SDP_CONFIG_KEY`** : déjà posée en production (A-13). Si `REQUIRE_POSTGRES=1` est posé, le serveur **refuse désormais de démarrer** sans elle (message `CONFIG_KEY_REQUIRED`).
3. **Secrets v1 → v2** : après le redémarrage, `node tools\pg\encrypt-secrets.js` (simulation) puis `--apply` ré-chiffre les secrets existants en v2. Sans cela tout fonctionne (v1 reste lisible) ; `check-secrets.js` les signale « v1 — à ré-chiffrer ».
4. **OpManager REST** : non configuré en production (la donnée vient d'Analytics Plus), donc sans effet. S'il est activé un jour avec un certificat auto-signé, renseigner `opmanager_ca_file`.
5. **Sync health** : deux nouveaux jobs, `audit.retention` et `entra.deprovision` (inactif tant que désarmé).

## 3. Plan de retrait du script inline (pages existantes)

Le cliquet empêche toute hausse. Ordre proposé, du plus exposé au plus simple :

| Lot | Pages | Éléments | Remarque |
|---|---|---|---|
| A | 21 pages à 1-2 éléments (Réunions, Inspections, Site Actions, System Logs, login, exec-view…) | 32 | surtout le bloc de script de page : le déplacer dans un `.js` suffit |
| B | assets, analytics, wan, infra-health, it-review, help | 37 | |
| C | index, executive-report, inspection | 176 | gros blocs + gestionnaires `onclick` |
| D | executive, reports | 324 | `reports.html` (248) est l'interface d'administration : à faire en dernier, onglet par onglet |

Quand une page tombe à 0 : l'ajouter à `STRICT_PAGES` et retirer sa ligne du fichier de référence. Quand toutes y sont, retirer `'unsafe-inline'` de la politique globale.

## 4. Points d'arbitrage

| # | Question | Recommandation |
|---|---|---|
| DEC-1 | Correspondance groupes Entra ↔ rôles/sites : un groupe par site et par fonction (ex. « SDP-Editeurs-Hounde ») ? | oui, groupes dédiés au tableau de bord, « assignés à l'application » (évite le dépassement à 200 groupes) ; `super_admin` reste nominatif |
| DEC-2 | Durée de session | aujourd'hui 24 h (cookie et session) ; proposition : 12 h avec le SSO en `only` (l'utilisateur se reconnecte chaque jour, sans mot de passe) |
| DEC-3 | Politique MFA | accès conditionnel Entra : MFA obligatoire pour l'application, appareils conformes pour les rôles admin |
| DEC-4 | Calendrier de la fenêtre `available` | 2 semaines en `available` après la correspondance des e-mails, puis `only` ; compte de secours testé avant la bascule |
| DEC-5 | Rotation des secrets | annuelle pour le secret Entra (expiration à 12 mois) ; à chaque départ d'une personne qui les a manipulés ; procédure au §3 de l'incident |
| DEC-6 | Branches protégées et revue | `main` protégée : CI verte obligatoire, 1 approbation, pas de push direct — à activer dans GitHub ▸ Settings ▸ Branches (geste du propriétaire du dépôt) |
| DEC-7 | Périmètre du test d'intrusion | application web (authentification, autorisations, injection, CSP), API (les 328 routes), configuration IIS/TLS ; hors périmètre : Zoho, Meraki, Entra |
| DEC-8 | Blocage par compte | 10 échecs bloquent le compte 15 min, y compris le compte de secours (un attaquant peut le bloquer) — accepté, ou exempter le compte de secours ? recommandation : accepter, la fenêtre est courte |

## 5. Critères de réception

- Aucune vulnérabilité haute : **vérifié** (0 vulnérabilité, gate CI).
- 100 % des comptes en SSO avec MFA : **dépend de DEC-3/DEC-4** (gestes Entra).
- Compte de secours testé : **vérifié** par test automatisé ; exercice réel au trimestre (procédure §5).
- Aucun secret en clair dans une sauvegarde : **vérifié** si `SDP_CONFIG_KEY` est posée (garde au démarrage) et après `encrypt-secrets.js --apply` ; sauvegardes chiffrées (étape 2).
- Tests d'autorisation par rôle sur chaque route : **vérifié** (328 routes).
