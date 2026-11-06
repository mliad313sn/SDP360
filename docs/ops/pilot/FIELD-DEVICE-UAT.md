# Recette terrain sur vrais téléphones — kit de préparation (E-F04)

Version 1 · 2026-11-06 · Audit expert du 5 nov. 2026 : F-01 (recette sur téléphone réel), F-02 (stockage plein, partie humaine).

> **Ce document n'enregistre rien et n'accepte rien.** Il prépare une séance de recette. Aucun résultat, nom,
> date ni signature n'y est pré-rempli. La recette n'existe que lorsqu'un responsable IT de site a rempli la
> feuille `FIELD-DEVICE-SHEET.csv` et signé le PV ci-dessous. Les essais automatiques (`tests/e2e/f1-field-network.spec.js`,
> E-F02) simulent le réseau dans Chromium : ils **ne remplacent pas** cette séance.

## 1. Téléphones à recruter (au moins 2 profils)

| Profil | Appareil | Navigateur | Réseau |
|---|---|---|---|
| D1 | Android milieu de gamme (pas un modèle haut de gamme : le cas courant sur site) | Chrome à jour | le réseau RÉEL du site (Wi-Fi + 4G) |
| D2 | iPhone (iOS récent) | Safari | le réseau RÉEL du site |

Noter pour chaque appareil, dans la feuille : modèle, version du système, espace libre au début de la séance.
Utiliser un compte `field-tech` de test **du site** (pas un compte admin) et un second compte du même site pour U1/S4.

## 2. Scénarios

Avant chaque scénario : ouvrir l'application terrain (`/field/index.html`), vérifier que le badge de la file
est à **0** et noter l'heure. Après : relever le badge, la liste « file d'attente » et le résultat côté serveur (§4).

### Réseau

| Id | Scénario | Déroulé |
|---|---|---|
| N1 | Wi-Fi du site | Saisir 1 inspection avec 1 photo, mettre en file, Synchroniser. |
| N2 | 4G faible (1-2 barres) | Même saisie ; noter les barres de signal. Synchroniser ; attendre 5 min maximum. |
| N3 | VSAT / forte latence | Même saisie depuis un point du site raccordé par VSAT ; noter la durée de la synchro. |
| N4 | Portail captif | Se connecter à un Wi-Fi invité SANS accepter la page de connexion ; mettre en file ; Synchroniser. Puis accepter la page et Synchroniser. |
| N5 | Mode avion pendant la synchro | Mettre en file 3 saisies dont 1 avec photo ; lancer Synchroniser puis activer le mode avion pendant l'envoi ; désactiver ; Synchroniser. |

### Stockage

| Id | Scénario | Déroulé |
|---|---|---|
| S1 | Téléphone presque plein | Remplir le téléphone (vidéos) jusqu'à ~200 Mo libres ; mettre en file des saisies avec photos jusqu'au message « NON enregistré ». Libérer de l'espace ; remettre en file. |
| S2 | 20 photos d'affilée | Hors ligne, 20 inspections avec 1 photo chacune ; repasser en ligne ; Synchroniser. |
| S3 | Redémarrage de l'application | Hors ligne, mettre en file 2 saisies ; fermer l'application (forcer l'arrêt du navigateur) ; rouvrir ; vérifier le badge ; Synchroniser. |
| S4 | Déconnexion d'un téléphone partagé | Personne A met en file 1 saisie hors ligne puis se déconnecte ; personne B se connecte. |

### Utilisateur

| Id | Scénario | Déroulé |
|---|---|---|
| U1 | Changement d'utilisateur | A met en file (hors ligne) ; B se connecte et Synchronise ; puis A se reconnecte et Synchronise. |

## 3. Contrôles attendus (états G19 de la file)

L'application montre l'état de chaque saisie. Libellés français affichés :

| État | Libellé affiché | Attendu |
|---|---|---|
| pending | en attente | normal avant envoi |
| failed | nouvel essai prévu | réseau coupé, portail captif (N4), erreur serveur passagère — repart seul à la synchro suivante |
| rejected | refusé | le serveur a refusé avec une raison lisible — rien n'est écrit |
| conflict | conflit | même saisie, contenu différent — reste visible, seule la personne l'abandonne |
| applied_before | déjà appliqué (version précédente) | — |
| other_user | autre utilisateur | S4 / U1 : la saisie de A n'est PAS envoyée sous B, son contenu n'est pas affiché |
| unknown_author | auteur inconnu — à vérifier | — |
| unknown_outcome | résultat inconnu — vérifiez ServiceDesk Plus | ticket dont l'issue est inconnue — jamais renvoyé automatiquement |
| needs_review | bloqué sur le serveur — prévenez l'IT Groupe | saisie « en cours » côté serveur depuis plus de 15 min |

Pour chaque scénario, vérifier :

1. **Aucune perte** : chaque saisie mise en file est soit appliquée, soit visible sur le téléphone avec un état.
2. **Aucun doublon** : une saisie appliquée ne l'est qu'une fois (1 inspection, photos en nombre exact).
3. **Message compréhensible** : la personne sait quoi faire (attendre, se reconnecter, libérer de l'espace).
4. S1 : la saisie refusée faute d'espace reste dans le formulaire ; les saisies antérieures et le badge sont intacts.
5. S4 / U1 : rien n'est envoyé sous le mauvais compte.

## 4. Lire le résultat côté serveur

- **Liste des saisies non résolues** : `GET /api/field/admin/outbox` (palier admin, E-F01) — uuid, type,
  identifiant utilisateur, statut, âge, erreur ; **jamais le contenu**. Filtres `?status=applying&older_than_min=15`.
  En ligne de commande : `node tools/field/outbox-admin.js` (lecture seule par défaut).
- **Journal** : Admin ▸ System Logs, catégorie `field` (`field_inspection_applied`, `field_*_rejected`, …).
- **Inspection** : ouvrir l'inspection sur la page Inspections et compter les photos.

Résultat par ligne de la feuille (`result`) : `ok` (rien perdu, rien en double) · `lost` (une saisie a disparu
sans état) · `duplicate` (appliquée deux fois) · `blocked` (bloquée sans issue pour la personne) · `not_run`.
Toute ligne `lost` ou `duplicate` est un défaut bloquant à remonter à l'IT Groupe avec l'heure et l'uuid.

## 5. PV de recette terrain (vierge)

> À compléter par le responsable IT de site. Rien n'est pré-rempli. Ce document n'a de valeur qu'une fois signé.

| Champ | Valeur |
|---|---|
| Site | |
| Date(s) de la séance | |
| Téléphones testés (profil, modèle, système) | |
| Lignes `ok` / `lost` / `duplicate` / `blocked` / `not_run` | |
| Défauts remontés (uuid, heure) | |
| Décision (accepté / accepté avec réserves / refusé) | |
| Réserves | |
| Responsable IT de site — nom | |
| Responsable IT de site — signature | |
| Observateur — nom | |
| Observateur — signature | |

---

## English summary

Preparation kit only — it records nothing and accepts nothing. It names the phones to recruit (≥ 2: a mid-range
Android with Chrome, an iPhone with Safari, both on the site's real network), the network scenarios (site Wi-Fi,
weak 4G, VSAT / latency, captive portal, airplane mode during a sync), the storage scenarios (near-full phone,
20 photos, app restart, logout of a shared phone) and the user switch; the checks per scenario mapped to the G19
outbox states; how to read the server side (`/api/field/admin/outbox` from E-F01, System Logs, the inspection
page); and a **blank** acceptance record to be completed and signed by the site IT lead. One line per device ×
scenario goes in `FIELD-DEVICE-SHEET.csv` (`result` = `ok|lost|duplicate|blocked|not_run`, left empty here).
The automated journey `tests/e2e/f1-field-network.spec.js` simulates the network in Chromium; it does not replace
this session.
