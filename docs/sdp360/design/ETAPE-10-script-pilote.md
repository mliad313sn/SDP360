# Script du pilote terrain — Étape 10 — Application mobile hors-ligne

Version 1 · 2026-10-19 · Auteur : agent IA · À jouer par : le responsable produit + un coordinateur par site pilote · Durée : 2 semaines par site, puis clinique de 60 min.

## 1. Sites et appareils (arbitrages 1 et 2, défauts)
- **Sites pilotes** : deux sites aux réseaux contrastés — un site minier avec coupures fréquentes (proposé : Houndé) et un bureau bien connecté (proposé : Ouagadougou). Le comité peut en changer : seuls les codes de site dans les comptes changent.
- **Appareils** : les téléphones Android des techniciens déjà inscrits (Chrome ≥ 120) ; aucune flotte à acheter. iOS Safari ≥ 16.4 fonctionne en mode « Ajouter à l'écran d'accueil ». Aucun MDM requis.
- **Comptes** : rôle `field-tech` ajouté aux techniciens (Admin ▸ Users ▸ carte *field-tech*), site principal renseigné ; les éditeurs de site l'ont déjà.

## 2. Préparation (J-2)
1. Déployer l'étape 10 (ZIP, pm2 stop → start) ; vérifier `GET /api/field/bootstrap` avec un compte `field-tech`.
2. Publier le tableau de bord `field-site` (il est semé publié) et au moins un tracker avec les codes des sites pilotes comme unités.
3. Laisser `sdp_api_write_enabled = 0` pendant la première semaine : le bouton « Queue ticket » est désactivé et explique pourquoi.
4. Imprimer ce script ; préparer un carnet de bord (tableau §5).

## 3. Scénario de la première séance (45 min, avec le technicien)
| # | Geste | Résultat attendu |
|---|---|---|
| 1 | Ouvrir `https://itops-dashboard…/field/index.html`, se connecter, « Ajouter à l'écran d'accueil » | icône IT Field, écran Home avec le site, « Data as of … » |
| 2 | Passer le téléphone en **mode avion** | pastille « Offline » rouge ; l'app reste utilisable |
| 3 | Inspect : choisir une zone, cocher 3 items (ok/major), prendre une photo, « Queue inspection » | « Queued — it will sync when online », compteur de file = 1, photo < 300 KB |
| 4 | Tracker : saisir une valeur du mois courant, « Queue entries » | compteur = 2 |
| 5 | Actions : fermer une action avec « Close » ; essayer « → Ticket » sans justification | la fermeture est en file ; le transfert sans justification est refusé localement |
| 6 | Couper le mode avion | les 3 éléments passent « Synced » dans l'ordre ; le compteur revient à 0 |
| 7 | Sur le bureau : ouvrir l'inspection, le tracker, l'action | l'inspection est là avec sa photo ; la cellule du tracker a la valeur ; l'action est fermée avec l'auteur et l'heure |
| 8 | Re-saisir volontairement la même cellule du tracker pour un **mois clos** | « Refused … blocked » : la valeur stockée est conservée, le téléphone n'insiste pas |

## 4. Pendant les deux semaines
- Le technicien utilise l'app pour **toutes** ses inspections rapides et saisies tracker ; le formulaire de bureau reste disponible.
- Chaque matin le coordinateur lit `GET /api/field/outbox` (ou Admin ▸ System Logs, catégorie `field`) : taux `applied` / `rejected` / `failed`. Un `failed` est un défaut à remonter.
- Le responsable produit note les retours (mots du technicien, pas les siens).

## 5. Clinique de fin de pilote (60 min)
Mesures à lire **dans l'outil** (jamais estimées) :

| Indicateur | Source | Cible |
|---|---|---|
| Enveloppes appliquées / reçues | `field_outbox` (statuts) | ≥ 95 % `applied`, 0 `received` orphelin |
| Inspections créées depuis le terrain | `insp_inspections.created_by` ∈ pilotes | ≥ 1 par technicien et par semaine |
| Taille médiane des photos | `insp_photos.size_bytes` | ≤ 300 KB (cap) ; médiane attendue 150–250 KB |
| Délai saisie → serveur | `field_outbox.client_ts` vs `applied_at` | médiane < 1 h sur site minier (dépend des coupures) |
| Tâches `field.purge` | `/api/sync/health` | vertes |
| Satisfaction technicien | 3 questions (utile ? simple ? je continue ?) sur 5 | ≥ 4 sur chacune |

Décision du comité à l'issue : généraliser (ajout du rôle aux autres sites), étendre (ouverture `sdp_api_write_enabled` via CAB, arbitrage 5), ou corriger d'abord (liste des `rejected`/`failed` et verbatims).

## 6. Ce que le pilote ne teste pas (volontairement)
- La création de tickets SDP (désactivée) — à ouvrir par CAB après le pilote.
- Les signatures et les photos multiples par item (capture rapide = une photo par envoi ; le formulaire complet reste le formulaire de bureau).
- Les notifications poussées (pas de Web Push : les alertes passent par Teams/e-mail, étape 9).
