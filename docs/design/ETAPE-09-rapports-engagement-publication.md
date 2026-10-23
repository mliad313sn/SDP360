# Dossier de conception — Étape 09 — Rapports rédigés, moteur d'engagement, publication externe

Version 1 · 2026-10-23 · Auteur : agent IA · Relecteurs : comité produit, RSSI (publication, clés), direction (souveraineté IA)
Référence : SDP-DASH-2.0-ETUDE v1.2, §6.3 étape 9, lacunes L13 (rapports rédigés à la main), L14 (personne n'est
prévenu d'une dérive), L15 (chiffres recopiés à la main vers SharePoint et Power BI). Remarque de relecture du
2026-10-23 (centre de notifications) : traitée ici.

> **Statut : livré, entièrement désarmé à l'installation.** Rien ne part vers l'extérieur, aucun e-mail, aucune
> intelligence artificielle tant qu'un super_admin ne l'a pas activé. Toutes les règles d'alerte proposées sont
> désactivées. La décision de souveraineté IA (§6, DEC-9.1) reste à la direction.

## 1. Fiche → réalisé

| Demandé par l'étude | Réalisé | Où |
|---|---|---|
| Modèles de rapport par audience composés de widgets | oui — mêmes blocs que les tableaux de bord + sections de commentaire ; audience, langue, ton | `services/reportgen/definition.js` |
| Sorties HTML, PDF, PPTX, CSV | oui | `services/reportgen/render.js`, `report-studio.html` |
| Analyse déterministe toujours disponible | oui — rédigée à partir des chiffres, sans réseau | `services/reportgen/analysis.js` |
| Couche IA nourrie uniquement par les chiffres canoniques, ton par audience, bilingue, fournisseur local par défaut, option cloud | oui — commutateur existant (`AI_PROVIDER` : off par défaut, local, cloud) ; consigne anti-invention ; **tout chiffre absent des données fait rejeter le texte** | `services/reportgen/ai.js` |
| Brouillon jusqu'à relecture humaine, journal des versions | oui — un auteur génère et corrige, un relecteur valide ; chaque étape est journalisée | `rp_runs`, `rp_run_events` |
| Rapports golden | oui — sorties figées testées (`tests/engagement-reports.test.js`) | |
| Règles d'alerte (métrique, périmètre, seuil, rémanence, canal, destinataires) | oui — indicateur, tickets anciens (30/45/60 j), incident majeur, santé des synchronisations ; persistance, délai de calme, retour à la normale | `services/engagement/` |
| Abonnements, centre de notifications, digest, commentaire depuis la notification, accusés de lecture | oui | `notifications.html` |
| Partage par lien signé expirable | oui — 7 jours par défaut, 30 au plus ; rapport validé seulement | `services/signedLink.js`, `/share/…` |
| API REST de métriques + OData documentée, clés par consommateur, quotas, journal | oui — `/api/v1/…`, `/odata` ; clé montrée une fois, empreinte seule conservée | `routes/publication.js` |
| Connecteurs SharePoint, Power BI, Teams, e-mail, webhook, Excel planifié | Power BI par le flux OData ; SharePoint par la **vue intégrée signée** ; Teams, webhook signé, e-mail du rapport validé, Excel par e-mail planifiés. Écriture directe dans une liste SharePoint : **non** (exige une application Entra, DEC-9.6) | `publication.html` |
| Vues embarquables signées (iframe SharePoint) | oui — intégrable uniquement depuis les origines autorisées (`EMBED_FRAME_ANCESTORS`, `https://*.sharepoint.com` par défaut) | `/embed/…` |
| Planification via le runner | oui — 4 tâches : `engagement.evaluate` (30 min), `engagement.digest`, `publication.snapshot`, `publication.run` (15 min) | `services/sync/jobs.js` |

## 2. Ce qui protège les chiffres

1. Toute valeur vient du dictionnaire des indicateurs, par le même calcul que les écrans.
2. L'analyse déterministe ne cite que les « faits » extraits des blocs du rapport.
3. Le texte de l'IA est rejeté dès qu'il contient un nombre absent de ces faits (le mois et l'année exceptés) :
   l'analyse déterministe est alors conservée, et le journal dit pourquoi.
4. Un rapport n'est lisible par son audience qu'une fois validé par un relecteur ; un rapport validé n'est plus modifié.

## 3. Mise en service (super_admin)

| Geste | Où |
|---|---|
| Ajouter le catalogue des 12 règles proposées, puis activer celles que le comité retient | Notifications et alertes ▸ Règles |
| Déclarer les canaux Teams / webhook (adresse chiffrée, jamais réaffichée) | Notifications et alertes ▸ Canaux |
| Activer l'e-mail des alertes et du résumé quotidien ; saisir l'adresse publique | Publication externe ▸ Réglages |
| Choisir les indicateurs publiés, recalculer la photographie | Publication externe |
| Créer une clé par consommateur (Power BI…) | Publication externe ▸ Consommateurs |
| Créer un lien de vue intégrée pour une page SharePoint | Publication externe ▸ Vue intégrée |
| Définir `SDP_LINK_KEY` (ou s'appuyer sur `SDP_CONFIG_KEY`) pour les liens signés | `.env` du serveur |
| Optionnel : `EMBED_FRAME_ANCESTORS` (origines autorisées à intégrer), `AI_PROVIDER=local` | `.env` du serveur |

Power BI : Obtenir des données ▸ Flux OData ▸ `https://<serveur>/odata`, authentification « De base » : identifiant
du consommateur + sa clé. Les valeurs sont recalculées chaque nuit (13 mois, groupe et chaque site).

## 4. Droits

| Action | Qui |
|---|---|
| Générer un rapport, corriger son commentaire, créer un modèle | `report-author` (rôle existant) |
| Valider un rapport, le partager, créer une vue intégrée | `report-reviewer` (nouveau rôle) |
| Définir, activer, tester les règles d'alerte ; voir les accusés de lecture | `alert-manager` (nouveau rôle) |
| Canaux, clés d'API, publications, réglages | `super_admin` |
| Recevoir, lire, commenter une alerte, s'abonner | toute personne connectée (selon les destinataires de la règle) |

## 5. Points d'arbitrage

| # | Question | Recommandation appliquée |
|---|---|---|
| DEC-9.1 | Souveraineté IA (local / cloud, données autorisées, budget matériel) | **désactivée par défaut** ; si activée : modèle local (`AI_PROVIDER=local`, Ollama) ; seuls les chiffres agrégés partent vers le modèle, jamais un texte de ticket |
| DEC-9.2 | Modèles de rapport | pack exécutif mensuel + revue mensuelle de site (modifiables) |
| DEC-9.3 | Règles de relecture | l'auteur ne valide pas son propre rapport ; un relecteur valide ; un rapport validé n'est jamais modifié (on en génère un nouveau) |
| DEC-9.4 | Catalogue initial de ≥ 10 règles | 12 règles proposées, toutes désactivées (§1) |
| DEC-9.5 | Politique anti-bruit | persistance (2 évaluations par défaut), délai de calme (24 h), une seule alerte par épisode, message de retour à la normale, résumé quotidien plutôt qu'un e-mail par alerte |
| DEC-9.6 | Connecteurs prioritaires et droits par consommateur | Power BI (OData) + SharePoint (vue intégrée) + Teams ; écriture dans SharePoint/Graph seulement après une application Entra dédiée |
| DEC-9.7 | Durée des liens | partage 7 jours (30 au plus) ; vue intégrée 180 jours (366 au plus) |

## 6. Critères de réception

| Critère | Mesure |
|---|---|
| Pack exécutif mensuel produit sans saisie manuelle, zéro divergence de chiffres | généré depuis le modèle système ; les chiffres viennent du dictionnaire ; garde anti-invention |
| Commentaire jugé utile par ≥ 80 % des relecteurs | à mesurer : le journal garde chaque correction humaine (action « commentaire modifié ») |
| ≥ 10 règles actives avec < 5 % de faux positifs | à mesurer après activation : alertes déclenchées vs commentaires « fausse alerte » |
| Au moins un tableau de bord SharePoint et un rapport Power BI alimentés automatiquement | vue intégrée + flux OData |
| Aucune donnée personnelle hors site | flux et cartes ne portent que des agrégats ; aucune clé ni adresse de canal en clair |
