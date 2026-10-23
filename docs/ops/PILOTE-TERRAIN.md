# Protocole — Pilote de l'application terrain (3 sites, 6 semaines)

Étape 10 de SDP-DASH-2.0. Le pilote décide de la généralisation de l'application terrain et de l'écriture directe
dans ServiceDesk Plus (DEC-10.1).

## 1. Préparation (semaine 0)

1. Choisir 3 sites (DEC-10.2) : un bien connecté, un moyen, un à faible débit.
2. Sur chaque site, 2 à 4 techniciens reçoivent le rôle `field-tech` (avec leur site) ; le coordinateur du site est
   `editor` de ce site.
3. Mettre l'application à disposition en HTTPS (DEC-10.3) ; chaque technicien l'installe et l'ouvre une fois avec réseau.
4. Mesure de départ (sans l'application) : durée de la saisie hebdomadaire des trackers et d'une inspection, sur une semaine.

## 2. Déroulé (semaines 1 à 6)

- Les inspections et les saisies de trackers du pilote se font dans l'application terrain.
- Les demandes de ticket créées sur le terrain passent par la file ; le coordinateur les traite chaque jour.
- **Une fois par semaine**, chaque technicien remplit la fiche ci-dessous (5 minutes).
- Semaine 3 : un test de coupure volontaire (mode avion au milieu d'un envoi de 10 photos, puis retour du réseau).

### Fiche hebdomadaire (une ligne par technicien et par semaine)

| Site | Semaine | Durée de la saisie hebdomadaire (min) | Inspections faites | Envois jamais confirmés (nombre) | Conflits rencontrés | Remarque |
|---|---|---|---|---|---|---|

## 3. Mesure (fin de semaine 6)

```
node tools/metrics/field-pilot.js --days=42 --nps=reponses-nps.csv
```
- L'outil lit les rapports de synchronisation envoyés par les téléphones (System Logs, action `field_sync`) et
  n'affiche que des nombres et des durées, jamais un nom.
- `reponses-nps.csv` : une note de 0 à 10 par ligne, question « Recommanderiez-vous l'application terrain à un
  collègue ? » (anonyme).

| Critère | Cible | Source |
|---|---|---|
| Inspection de 10 photos synchronisée à 1 Mbit/s | ≤ 2 min | outil, critère 1 |
| Zéro perte sur coupure | 0 envoi jamais confirmé | fiche + test de la semaine 3 |
| Saisie hebdomadaire | ≤ 20 min sur les 3 sites | fiche |
| NPS des techniciens | ≥ +30 | outil, critère 4 |

## 4. Décision

Compte rendu au comité : les 4 mesures, les remarques des techniciens, le volume de la file d'actions rapides (pour
DEC-10.1), et la recommandation (généraliser, corriger puis généraliser, ou arrêter).
