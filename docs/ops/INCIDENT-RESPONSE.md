# Procédure de réponse à incident de sécurité — SDP-Dashboard 2.0

Version 1 · 2026-10-19 · Propriétaire : Service & Support Manager · Relecture : comité produit (étape 4)

## 1. Périmètre et déclencheurs
Un incident de sécurité est tout événement qui compromet, ou pourrait compromettre, la confidentialité, l'intégrité ou la disponibilité du dashboard ou de ses données : compte compromis, usage du compte de secours (*break-glass*), fuite d'une sauvegarde, vulnérabilité exploitée, comportement anormal des synchronisations (suppression massive bloquée par le garde de troncature, volume inhabituel), alerte CodeQL / audit des dépendances de sévérité haute ou critique.

Signaux à surveiller : System Logs ▸ événements à risque (`login_failed` en série, `breakglass_login`, `session_killed`, `user_role_changed`, `report_deleted`) ; System Logs ▸ Sync health (job en erreur ou périmé) ; la CI (job *Dependency audit*, workflow *CodeQL*).

## 2. Rôles
| Rôle | Qui | Responsabilité |
|---|---|---|
| Responsable de l'incident | Service & Support Manager (suppléant : coordinateur central) | Qualifie, décide, communique |
| Opérateur plateforme | Administrateur du serveur | Isolement, journaux, restauration |
| Référent identité | Administrateur M365 / Entra | Révocation des sessions Entra, politiques d'accès conditionnel |
| Comité produit | — | Informé sous 24 h, revue post-incident |

## 3. Procédure en six étapes
1. **Détecter et qualifier (≤ 1 h)** — ouvrir System Logs, filtrer sur les événements à risque ; noter l'heure, les comptes et les adresses IP ; classer : *faible* (tentatives bloquées), *moyen* (compte unique compromis), *élevé* (compte admin, fuite de données ou de sauvegarde).
2. **Contenir (≤ 2 h)** — Admin ▸ Sessions actives ▸ *Force logout* du compte ; désactiver le compte (Admin ▸ Users) ; en mode SSO, révoquer les sessions dans Entra ; si une clé d'API ou un secret est suspecté : le régénérer à la source (Zoho, Meraki, OpManager, webhook Teams) puis le ressaisir dans Admin (les secrets sont chiffrés à l'écriture).
3. **Préserver les preuves** — exporter System Logs (`/api/reports/system-log/export.csv`) sur la fenêtre concernée ; conserver le journal pm2 (`pm2 logs --nostream --lines 2000`) ; ne pas purger (`audit.retention` garde 12 mois, 24 pour les événements à risque).
4. **Éradiquer** — appliquer le correctif (dépendance, configuration, code) via la CI ; si une sauvegarde a fui : rotation de **toutes** les clés listées dans `_SECRET_BLANK_KEEP` puis `node tools/pg/reencrypt-secrets.js --apply` avec `SDP_CONFIG_KEY_OLD` pour changer la clé de chiffrement.
5. **Restaurer** — si des données ont été altérées : point de restauration (`_sdp_admin.cmd` ▸ restauration, sauvegarde `pre-restore` automatique), puis relance des synchronisations (le garde de troncature protège la réconciliation).
6. **Clôturer et apprendre (≤ 5 jours ouvrés)** — fiche d'incident (chronologie, cause, impact, actions), décision `DEC-` du comité si une règle change, mise à jour de ce document.

## 4. Communication
| Gravité | Qui informer | Délai |
|---|---|---|
| Faible | Responsable de l'incident (journal) | Hebdomadaire |
| Moyen | Direction IT + comité | 24 h |
| Élevé | Direction + RSSI groupe + comité | Immédiat, puis point quotidien |

## 5. Exercices
Un exercice par semestre : (a) usage du compte de secours et vérification de sa trace, (b) restauration d'une sauvegarde sur l'instance TEST avec la clé de chiffrement, (c) rotation de clé avec `reencrypt-secrets`. Résultats consignés dans le registre des décisions du comité.
