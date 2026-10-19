# Alertes SLA dans Teams — guide de mise en service

Le code est en place et **désarmé** : rien ne part tant que les trois étapes ci-dessous ne sont pas faites.
Tout se règle dans **Admin ▸ 🔔 Alertes SLA Teams** (`reports.html#admin/teams-sla`, super_admin).

Design : `docs/superpowers/specs/2026-10-03-teams-sla-alerts-design.md`.

---

## Étape 1 — Accès API ServiceDesk Plus Cloud (une seule fois)

Le dashboard lit les tickets ouverts directement dans SDP (toutes les 5 min) : Zoho Analytics, synchronisé
toutes les heures, est trop lent pour un SLA de 1re réponse de 15-30 min.

1. Ouvrir **https://api-console.zoho.com** avec un compte administrateur SDP (même centre de données que
   SDP — `.com` si l'URL de connexion est `accounts.zoho.com`).
2. **Add Client ▸ Self Client ▸ Create**. Noter le **Client ID** et le **Client Secret** (onglet *Client Secret*).
3. Onglet **Generate Code** :
   - Scope : `SDPOnDemand.requests.READ`
   - Time duration : 10 minutes · Description : `IT OPS dashboard — alertes SLA Teams`
   - **Create** → copier le code (valable 10 min).
4. Échanger le code contre un refresh token, depuis n'importe quel poste (PowerShell) :

   ```powershell
   Invoke-RestMethod -Method Post "https://accounts.zoho.com/oauth/v2/token?grant_type=authorization_code&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>&code=<CODE>"
   ```

   La réponse contient `refresh_token` : c'est lui qu'on garde (il n'expire pas tant qu'il sert).
5. Dans la carte admin, section **1 · Accès API** : coller Client ID, Client secret, Refresh token.
   Laisser l'URL de l'API (`https://oneitsupport.endeavourmining.com/app/itdesk/api/v3`) et le serveur
   OAuth (`https://accounts.zoho.com`) sauf si votre instance diffère. **Enregistrer**.
6. Cliquer **Aperçu (sans envoi)** : la carte doit afficher « N ticket(s) ouvert(s) lus ».
   - `HTTP 401` / `invalid_client` → Client ID / secret / refresh token incorrects, ou mauvais centre de données.
   - `HTTP 400` mentionnant le filtre → remplacer `Open_System` par le nom du filtre « tickets ouverts » de
     votre instance (liste des vues dans SDP ▸ Demandes).
   - « 0 ticket » alors qu'il y en a → même cause : le filtre.

Les secrets ne sont jamais réaffichés. Ils sont chiffrés au repos (`SDP_CONFIG_KEY`, comme le mot de passe SMTP).

## Étape 2 — Un webhook par canal Teams de groupe

Pour chaque groupe SDP (ex. `Hounde IT Agents`) dont le canal doit recevoir les alertes :

1. Dans Teams, sur le canal : **⋯ ▸ Workflows** (ou l'app *Workflows*).
2. Modèle **« Publier dans un canal lorsqu'une requête webhook est reçue »** (*Post to a channel when a
   webhook request is received*).
3. Choisir l'équipe et le canal ▸ **Ajouter le flux** ▸ copier l'**URL** affichée.
   Cette URL est un secret : qui la possède peut publier dans le canal.
4. Dans la carte admin, section **2 · Canaux** : **+ Ajouter un groupe**, nom **exact** du groupe SDP
   (la liste proposée vient des tickets des 90 derniers jours) et l'URL. **Enregistrer**, puis **Tester** :
   une carte « TEST » doit apparaître dans le canal.

Un groupe nommé `*` sert de canal par défaut pour les groupes non listés (ex. un canal « Service Desk »).

> Les anciens « connecteurs entrants » (Incoming Webhook / Office 365 connectors) sont retirés par
> Microsoft : utiliser **Workflows**.

## Étape 3 — Armer

1. Relire les **règles** (section 3). Défauts :
   - 1re réponse bientôt due : P1 10 min, P2 20 min, P3 60 min, P4 240 min avant l'échéance ;
   - résolution bientôt due : 75 % du délai consommé ;
   - dépassements annoncés s'ils datent de moins de 60 min ;
   - non assigné depuis 30 min (tickets de moins de 24 h).
2. **Aperçu (sans envoi)** pour voir exactement ce qui partirait, et vers quel groupe.
3. Cocher **Armer les alertes** ▸ **Enregistrer**. Le passage tourne ensuite toutes les 5 minutes.
   **Lancer un passage maintenant** pour ne pas attendre.

Chaque ticket ne déclenche qu'**une** alerte par type. Un webhook en échec n'est pas compté comme envoyé :
le passage suivant réessaie.

---

## Filet immédiat, sans code (approche A) — escalade native de SDP

En attendant l'étape 1, ou en complément pour les P1, SDP sait lui-même prévenir **avant** l'échéance :

1. Récupérer l'adresse e-mail du canal : dans Teams, **⋯ du canal ▸ Obtenir l'adresse e-mail**
   (dans *Paramètres avancés*, autoriser « tout le monde » ou au moins le domaine qui envoie les e-mails SDP).
2. SDP ▸ **Admin ▸ Gestion des services ▸ SLA** ▸ ouvrir le SLA (ex. *Critical SLA for Incident*) :
   - **Escalade de première réponse** : activer, « Escalader **avant** l'échéance de 10 min » à l'adresse du canal ;
   - **Escalade de résolution** : activer, niveau 1 « avant l'échéance de 30 min ».
3. Répéter pour *High SLA for Incidents*, puis les autres si souhaité.

Limite : un e-mail brut par ticket, sans regroupement — c'est pourquoi l'approche du dashboard reste la cible.
