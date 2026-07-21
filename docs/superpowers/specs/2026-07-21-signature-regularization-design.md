# Régularisation d'une signature « papier » — design

**Date:** 2026-07-21
**Statut:** spec, révisé après revue — décision utilisateur requise avant plan
**Branche (prévue):** `feat/signature-regularization`

## Problème

Un coordonnateur : *« je l'ai imprimé c'était au moment où je n'arrivais pas à
sauvegarder les data sur la plateforme »* — 28 PV sur 30 non signés n'ont **aucune**
des deux signatures. C'est la signature d'une panne de capture (le bug `stampSignature`
local-seul, déjà corrigé en prod), pas de 28 oublis. Ces PV **ont été signés sur
papier** ; la plateforme ne les a jamais enregistrés.

`signoff` est l'une des **6 dimensions notées** du score programme
(`reviewDashboard.js:221-224`). Ces sites sont donc **pénalisés au score pour un bug de
notre logiciel**. La décision de l'utilisateur : le score doit refléter **ce qui a été
fait**, en gardant visible **ce qui a été saisi nativement vs régularisé sur papier**.

## Le point dur (vérifié)

Le score lit la **DATE** de signature, pas seulement sa présence
(`reviewDashboard.js:221`) :

```js
const signed = meets.filter(m => m.dept_head_signed_at && m.site_it_signed_at
  && String(m.dept_head_signed_at).slice(0,10) <= A            // A = as-of
  && String(m.site_it_signed_at).slice(0,10) <= A).length;
```

La borne as-of du score `signoff` est à **`reviewDashboard.js:221-223`** (fonction
`sbMeasure`, `:205-226`). **Donc une signature régularisée AUJOURD'HUI (juillet) avec
l'heure serveur ne compterait PAS pour un PV de mai** — elle tomberait hors fenêtre.
Pour « refléter ce qui a été fait », la régularisation doit porter la **date du papier**
(mai), pas celle du jour.

> **Correction (revue)** : `:519-522` n'est PAS la borne du score — c'est le funnel
> **E2 « diffusion sous 48h »** (`both48`), qui mesure `max(deptDate, itDate) −
> submitted_at <= 48h`, relatif à `submitted_at`, **sans borne as-of**. C'est un lecteur
> DISTINCT de `*_signed_at` que la v1 rev-1 avait ignoré — voir §« Interaction E2 » plus
> bas ; il faut le traiter, sinon une date papier antérieure au `submitted_at` produit
> une **latence négative → faux positif « signé sous 48h »**.

Or le serveur **écrase** toute date client par `new Date()` (`meetings-db.js:775, 993`)
— propriété anti-triche + immuabilité (COALESCE `:800-801, 1002-1003`) que j'ai bâtie
exprès. Une régularisation papier a donc besoin d'un **chemin distinct et contrôlé**,
jamais du chemin de stamp normal.

## Décisions

### D1 — La date du papier va dans `*_signed_at` ; la provenance dans de NOUVELLES colonnes

C'est le seul modèle qui fait compter la signature dans la bonne fenêtre. `*_signed_at`
reçoit la date papier (à minuit, `YYYY-MM-DD 00:00:00`). La provenance va à côté :

```sql
ALTER TABLE md_meetings ADD COLUMN dept_head_signed_source TEXT;   -- 'tool' | 'paper' | NULL
ALTER TABLE md_meetings ADD COLUMN dept_head_signed_recorded_at TEXT;  -- heure SYSTÈME de la régul
ALTER TABLE md_meetings ADD COLUMN dept_head_signed_recorded_by TEXT;  -- qui a régularisé
-- idem pour site_it_signed_source / _recorded_at / _recorded_by
```

- **`_signed_at`** = quand le papier a été signé (compte pour le score).
- **`_recorded_at`** = quand la régularisation a été saisie (heure serveur, non falsifiable).
- **`_source`** = `'tool'` pour un stamp natif, `'paper'` pour une régularisation. C'est
  le **« vs »** que l'utilisateur veut : les deux restent distinguables pour toujours.

Un stamp natif (chemin existant) écrit `_source='tool'`, `_signed_at` = heure serveur,
`_recorded_at`/`_recorded_by` NULL. **Rétrocompatible** : les lignes existantes ont
`_source` NULL → traitées comme `'tool'` à l'affichage (elles sont natives par
construction).

> **Piège provenance (revue)** : `saveMeeting` re-envoie la signature (désormais
> présente) comme truthy à CHAQUE save de header. Si `_source` était écrit
> inconditionnellement (`_source = 'tool'`), un save ultérieur d'un PV **régularisé
> papier** ferait basculer `_source` de `'paper'` → `'tool'`, détruisant la distinction
> même que la fonctionnalité existe pour préserver. Le write de `_source` sur le chemin
> `saveMeeting` DOIT être **COALESCE-gardé** (`_source = COALESCE(_source, 'tool')`),
> comme `_signed_at` l'est déjà — il ne s'écrit qu'au premier stamp.

### Migration : ALTER GARDÉ (meetings-db n'a AUCUN ALTER aujourd'hui)

`meetings-db.js` ne fait que `CREATE TABLE IF NOT EXISTS` — **zéro `ALTER`**. Un
`ALTER TABLE ADD COLUMN` nu jetterait `duplicate column name` au **2e boot** (sqlite n'a
pas `ADD COLUMN IF NOT EXISTS`). Les 6 colonnes s'ajoutent donc via un ALTER **conditionnel** :

- **sqlite** : gardé par le helper existant `getColumns(table)` (`PRAGMA table_info`,
  `meetings-db.js:2073`) — `if (!getColumns('md_meetings').includes(col)) ALTER …`, dans
  `_initSchema` juste après le `CREATE TABLE IF NOT EXISTS md_meetings`.
- **pg** : `ALTER TABLE md_meetings ADD COLUMN IF NOT EXISTS …` dans `initPgMeetings`.

C'est le motif backend-branché documenté pour le module Assets — meetings ne l'avait pas
encore parce qu'il n'avait jamais migré une table existante.

### D2 — Immuabilité préservée : on ne régularise QUE ce qui est encore NULL

La régularisation ne s'applique qu'à une signature `*_signed_at IS NULL`. Un COALESCE
identique protège une signature déjà posée (native OU papier). On ne peut donc jamais
réécrire une signature existante — on ne fait que **combler un trou**. C'est exactement
le sens de « régulariser » : ce qui n'a pas été capturé.

### D3 — Chemin serveur séparé, RBAC + audit

Nouvelle route `POST /api/meetings/:id/regularize-signature`, jamais le chemin `save`.
Corps : `{ which: 'dept_head'|'site_it', paper_date: 'YYYY-MM-DD' }`.

- **RBAC** : `_userMeetingsSite` (`server.js:6937`) — admin+ non borné ; un éditeur
  site-scopé ne régularise que **son** site. Même règle que les édits inline du Issues
  Log.
- **Validation serveur** : `which ∈ {'dept_head','site_it'}` (sinon 400) ; `paper_date`
  est une **date calendaire réelle** (pas seulement `^\d{4}-\d{2}-\d{2}$`, qui accepte
  `2026-13-45` — reparser et comparer) ; **`meeting_date <= paper_date <= today`**
  (avant la réunion = non-sens, on ne signe pas un PV qui n'a pas eu lieu ; futur = on ne
  signe pas en avance) → 400 hors bornes ; la signature ciblée est encore NULL (déjà
  posée → **409**, jamais un écrasement silencieux).
- **Audit** : chaque régularisation écrit une ligne dans une **NOUVELLE table
  `md_meeting_updates`** — il n'existe AUCUN audit au niveau header aujourd'hui (seuls
  `md_issue_updates` et `md_action_updates` existent, tous deux FK vers une issue/action,
  incapables de porter un événement meeting-level). La table (créée sur les DEUX backends,
  motif de `md_issue_updates`) porte : `meeting_id`, `which`, `paper_date` déclarée, qui,
  `recorded_at` (heure système). La valeur probante du registre repose là-dessus.

`_recorded_at` = heure serveur (jamais l'horloge client), comme `_signed_at` natif l'est.

### D4 — UI : action « Régulariser (signé sur papier) » + badge distinct

Sur `meeting.html`, à côté de chaque bouton de stamp, quand la signature est absente
ET que l'utilisateur peut éditer ce site : un lien **« Signé sur papier le… »** ouvrant
un petit sélecteur de date → POST → recharge. Une signature papier affiche un **badge
distinct** (« ✍ papier · régularisé par X le … ») vs le stamp natif (« signé le … »).
Le « vs » est visible à l'écran, pas seulement en base.

**Les DEUX signatures sont requises pour bouger le score** (`signoff` exige
`dept_head` ET `site_it`). Régulariser une seule ne déplace le score de rien — l'UI doit
le rendre évident (les deux actions côte à côte, un PV à moitié régularisé reste marqué
« non signé »), sinon ça se lit comme un bug.

**Worklist par site (dans la v1).** 28 PV × 2 signatures = jusqu'à 56 dates réelles
distinctes ; un « bulk » à une seule date n'aurait aucun sens. Mais forcer le
coordonnateur à chasser les PV un par un à travers 3+ sites invite les oublis. La v1
inclut donc, sur la page Issues/Compliance existante ou une petite vue dédiée, une
**liste des PV non signés de SON site** avec un sélecteur de date inline par signature —
toujours une date à la fois, mais sans chasse. Un import en masse des PV papier
historiques reste un sujet séparé si le volume l'exige.

### D5 — L'inspection imprimée de mai : re-saisie, PAS de code

Le second point du coordonnateur (l'inspection de mai qu'il a imprimée) ne nécessite
**aucun code** : `inspection.html` accepte déjà une date d'inspection rétrospective. Il
suffit de re-saisir l'inspection dans l'outil avec sa vraie date de mai — elle comptera
alors dans la fenêtre glissante de 3 mois (déjà corrigée aujourd'hui). C'est une tâche
de saisie, à lui communiquer, hors de cette spec.

## Ce qui compte pour le score

Après régularisation, `getSiteScoreInputs` (`meetings-db.js:2629`, cœur pur
`_computeMeetingsScoreInputs:2611`) et `reviewDashboard.js:221` lisent `*_signed_at` =
date papier → le PV compte comme signé **dans le mois du papier**. Ces deux-là ne
changent pas : elles lisent déjà la colonne, qui porte maintenant la bonne date. La
provenance (`_source`) n'entre PAS dans le score — un PV signé est signé, quel que soit
le canal. C'est cohérent avec « refléter ce qui a été fait ».

## Interaction E2 — le funnel « diffusion sous 48h » DOIT être ajusté (revue)

`reviewDashboard.js:515-538` (`dhSigned`/`itSigned`/`both48`/`medLatH`) lit AUSSI
`*_signed_at`, mais **relatif à `submitted_at`**, pas à l'as-of. Une signature papier
datée mai avec un `submitted_at` posé en juillet (quand le PV a enfin été sauvegardé)
donne une latence **négative** :

- `medLatH` filtre déjà `h >= 0` (`:527`) → il ignore le cas, OK.
- **`both48` n'a AUCUN plancher** (`:519-522`) → une latence négative est `<= 48h` →
  **faux positif « signé sous 48h »**, et gonfle les compteurs `dhSigned`/`itSigned` du
  funnel.

Décision : la régularisation papier n'est **PAS un événement de diffusion**. Le funnel E2
mesure la discipline de diffusion IN-TOOL ; y compter un comblement rétroactif serait
malhonnête. Donc **le funnel exclut les signatures `_source='paper'`** (les 4 lecteurs
`:517-537` filtrent `m.*_signed_source !== 'paper'`), et par sécurité `both48` gagne le
plancher `>= 0` que `medLatH` a déjà. **Ceci CHANGE `reviewDashboard.js`** — contrairement
à ce que rev-1 affirmait ; c'est explicitement dans la portée. Le score `signoff`, lui,
ne change pas (il n'a jamais regardé `submitted_at`).

## Portée / non-buts

- On ne touche **pas** le chemin de stamp natif au-delà d'écrire `_source='tool'`.
- On ne régularise **jamais** une signature déjà posée (comblement de trou uniquement).
- Pas de régularisation en masse dans cette v1 — une signature à la fois, tracée. (Un
  import en masse des PV papier historiques est un sujet séparé si le volume l'exige.)
- L'inspection de mai = re-saisie manuelle, hors code.

## Risques

| Risque | Mitigation |
|---|---|
| Une régul écrase une signature native | COALESCE + garde `IS NULL` → 409 ; jamais d'écrasement |
| Antidatage abusif | `paper_date` non futur + audit qui/quand/valeur ; provenance `'paper'` visible |
| `_source` NULL sur les lignes existantes casse l'affichage | NULL → traité `'tool'` (natif par construction) |
| Le pg fork diverge du sqlite | ALTER + route forkés sur les deux backends, testés |
| La date papier est absurde (avant la réunion / dans le futur) | Bornée `meeting_date <= paper_date <= today` (400 sinon) ; le score borne sur la date de signature, pas la date de réunion |
| Une date papier < submitted_at gonfle le funnel E2 « 48h » | Le funnel exclut `_source='paper'` + plancher `both48 >= 0` — voir §Interaction E2 |
| ALTER nu → duplicate column au 2e boot (sqlite) | ALTER conditionnel gardé par `getColumns` (sqlite) / `IF NOT EXISTS` (pg) |
| Un save ultérieur écrase `_source='paper'` → `'tool'` | `_source = COALESCE(_source, 'tool')` sur le chemin saveMeeting |

## Critères de fin

- Une signature absente se régularise avec sa date papier ; le PV compte au score
  **dans le mois du papier**, pas celui de la régul.
- `'tool'` vs `'paper'` reste distinguable en base ET à l'écran.
- Une signature déjà posée ne peut jamais être réécrite (409).
- `paper_date` futur refusé ; RBAC site-scopé appliqué ; audit écrit.
- Fork pg + sqlite ; suites meetings + review vertes ; await-precedence 5/5.
