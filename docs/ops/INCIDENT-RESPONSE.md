# Procédure de réponse à incident de sécurité — SDP Dashboard

Version 1 · 2026-10-19 · Référence : SDP-DASH-2.0-ETUDE v1.2, étape 4.
Propriétaire : Service & Support Manager. Relecture : à chaque changement d'équipe ou au moins une fois par an.

## 1. Ce qui déclenche la procédure

| Signal | Où le voir |
|---|---|
| Connexion du compte de secours (`breakglass_login`) | System Logs, filtre « risque » |
| Rafale d'échecs ou de blocages de connexion (`login_failed`, `login_throttled`) | System Logs, catégorie *auth* |
| Refus d'accès en série (`api_denied`, statut 403) depuis un même compte ou une même adresse | System Logs, catégorie *api* |
| Désactivation automatique d'un compte (`user_deactivated`) inattendue | System Logs, catégorie *identity* |
| Démarrage refusé (`CONFIG_KEY_REQUIRED`, `SQLITE_IN_PRODUCTION`) | journal pm2 |
| Secret exposé (mot de passe SMTP, clé Meraki/OpManager, secret Entra, URL de webhook Teams, `SDP_CONFIG_KEY`) | signalement, revue de code, fuite d'une sauvegarde |
| Vulnérabilité haute ou critique sur une dépendance | CI (étape *Dependency audit*), PR Dependabot |

## 2. Les cinq premières actions (dans l'ordre)

1. **Qualifier** — noter l'heure, le signal, le compte et l'adresse concernés. Exporter la vue System Logs filtrée (bouton *Export*, CSV) : c'est la pièce de référence.
2. **Contenir** :
   - compte compromis → *Admin ▸ Users* : désactiver le compte ; *Admin ▸ Active Sessions* : forcer la déconnexion ;
   - avec le SSO en mode `only`, désactiver aussi l'identité dans Entra (elle ne pourra plus se reconnecter) ;
   - compte de secours utilisé sans raison connue → changer son mot de passe immédiatement et vérifier qui le détient.
3. **Révoquer les secrets touchés** (voir §3) — un secret exposé est un secret à remplacer, même si rien n'indique qu'il a servi.
4. **Préserver** — ne pas purger les journaux ; si besoin, prendre une sauvegarde chiffrée immédiate (*Sync health ▸ Encrypted PostgreSQL backup ▸ Run now*).
5. **Informer** — responsable sécurité du groupe dans l'heure pour un incident confirmé ; les propriétaires des systèmes tiers concernés (Zoho, Meraki, OpManager, Entra).

## 3. Rotation des secrets

| Secret | Où le changer | Remarque |
|---|---|---|
| Secret client Entra | portail Entra ▸ App registration ▸ *Certificates & secrets*, puis *Admin ▸ Microsoft SSO* | ne jamais supprimer l'ancien avant d'avoir enregistré le nouveau |
| Mot de passe SMTP | boîte d'envoi, puis *Admin ▸ Email* | test d'envoi après changement |
| Clé API Meraki | dashboard Meraki ▸ *My profile ▸ API access*, puis la carte Infra | |
| Clé API OpManager | OpManager ▸ *Settings ▸ REST API*, puis la configuration OpManager | |
| URL de webhook Teams | supprimer le flux Workflows, en recréer un, coller la nouvelle URL dans *Alertes SLA* | une URL de webhook permet de publier dans le canal |
| Jeton d'actualisation Zoho | `RENEW_ZOHO_TOKEN.html` | **ne jamais supprimer/recréer le Self Client ni régénérer son secret** : il est partagé avec SDP |
| `SDP_CONFIG_KEY` | `.env` du serveur | changer la clé rend les secrets illisibles : les ressaisir tous ensuite (ou `encrypt-secrets.js` avant le changement) ; les anciennes sauvegardes restent chiffrées avec l'ancienne clé |
| `SDP_BACKUP_KEY` | `.env` du serveur | conserver l'ancienne clé tant que des sauvegardes chiffrées avec elle sont dans la rétention (14 jours) |

## 4. Après l'incident

- Compte rendu sous 5 jours ouvrés : chronologie, cause, données touchées, actions, ce qui change.
- Si une règle de détection a manqué : ajouter l'événement à `_RISK_ACTIONS` (`reports-db.js`) ou un test d'autorisation (`tests/route-authz.smoke.test.js`).
- Les journaux (`system_log`) sont conservés 12 mois (job `audit.retention`) : exporter ceux de l'incident s'ils doivent être gardés plus longtemps.

## 5. Exercice

Une fois par trimestre, avec l'exercice de restauration (`docs/ops/RESTORE-DRILL.md`) : se connecter avec le compte de secours sur l'instance de test, vérifier l'événement `breakglass_login` dans System Logs, puis désactiver/réactiver un compte de test.
