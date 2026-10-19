# Rapport hebdo — Actions : import, fusion, identité (plan pour 2026-10-06)

Demande (2026-10-05) : dans « Action Items & Follow-ups », on ne distingue ni les titres ni
l'identité des actions dans la fenêtre d'import, la fusion des doublons ne semble pas tenir,
et rien n'indique si deux lignes au même titre sont la même action ou deux actions différentes.
Constats vérifiés dans le code le 2026-10-05 ; rien n'est encore modifié.

## Rappel du modèle

- Chaque ligne `action_items` a un `uid` (une ligne = une semaine).
- Une action suivie sur plusieurs semaines = une **chaîne** : toutes ses copies partagent la
  même clé de groupe `lineage` (la copie d'origine a `lineage` NULL, sa clé est son `uid`).
- La liste « ouvertes du site » (`getSiteOpenReportActions`) garde, par groupe, **la ligne la
  plus récente** et ne la retient que si elle n'est pas terminée (`_dedupLineageNewestOpen`).

## Constat 1 — la fusion laisse des fantômes (DÉFAUT, prouvé)

`POST /api/reports/action/:uid/relineage` → `setActionLineage(uid, …)` ne modifie **qu'une
ligne** : la plus récente du groupe fusionné. Ses copies des semaines précédentes gardent
l'ancienne clé ; l'ancien groupe a donc un nouveau « plus récent » (une semaine antérieure,
encore ouverte dans l'historique) qui **réapparaît** dans la liste et dans la fenêtre.

Reproduit sur base jetable (`scratchpad/mergeprobe/probe.js`) :
avant = `W25 Protection foudre` + `W29 Protection des équipements…` ;
après fusion = `W24 Protection foudre` + `W29 …` → la fusion n'a rien regroupé.
Les 4 lignes « Protection des équipements contre la foudre » (W24/W25/W28/W29) de la capture
du 2026-10-05 sont très probablement ces fantômes. La route ne journalise rien → les fusions
passées ne sont pas reconstructibles ; **la réparation = refaire la fusion une fois corrigée**.

**Correctif** : fusionner un **groupe entier**, pas une ligne.
- `setActionLineage` → nouvelle fonction `relineageGroup(oldKey, newKey, task, site_id)` :
  `UPDATE action_items SET lineage=?, task=? WHERE (uid=? OR lineage=?) AND report_id IN
  (rapports du site)` (sqlite + pg, une transaction). La route reçoit la clé de groupe
  (`data-key`), plus seulement l'uid.
- Contrôle d'accès inchangé (`_authorizeActionWrite` sur la ligne visée) + vérifier que tout
  le groupe est sur le même site.
- Trace : `logAudit` `action_merged` {from_key, to_key, rows} — pour pouvoir défaire.
- Test RED d'abord : le scénario du probe → après fusion, une seule ligne ouverte.

## Constat 2 — fenêtre d'import : chiffres trompeurs, import à l'aveugle

`listAllWeeksWithActions` compte les lignes de CETTE semaine avec `status != 'closed'` :
- `cancelled` compte comme « pending » ;
- c'est l'état **figé de cette semaine-là** : une action fermée en W38 compte encore
  « 1 pending » en W28 → les badges W28…W37 de la capture surévaluent.
`_importFromWeek` importe **toutes** les lignes non fermées de la semaine choisie, sans aperçu,
et sans vérifier si leur groupe est déjà dans le rapport courant → doublons à l'import.

**Correctif** :
- Compter par groupe avec la même règle que le hub : une ligne compte si **son groupe** est
  encore ouvert (ligne la plus récente non terminée) et si le groupe n'est **pas déjà** dans le
  rapport courant ; exclure `cancelled`.
- Clic sur une semaine → **aperçu** : liste des actions avec case à cocher (cochées par
  défaut), titre, responsable, statut, « suivie depuis Wxx · N semaines », et grisées avec
  motif : « déjà dans ce rapport » / « fermée depuis en Wyy ». Bouton « Importer la sélection ».
- Conserver le report de lignée existant (`uid` neuf, `lineage` = groupe).

## Constat 3 — aucune identité visible

Ni la fenêtre d'import ni « Fusionner des doublons » ne montrent si deux titres identiques
sont le même groupe. Ajouter partout une **pastille de groupe** :
- code court stable dérivé de la clé (`#` + 4 caractères), même couleur pour un même groupe ;
- « suivie depuis Wxx (N semaines) » (`first_logged` existe déjà côté serveur) ;
- dans la fusion : regrouper visuellement les titres proches (déjà triés) et signaler
  « même groupe » vs « groupes différents » ; empêcher de cocher deux lignes du même groupe.
- Option : la même pastille dans le tableau du rapport (colonne discrète ou infobulle).

## Ordre proposé (TDD, une étape = un commit)

1. Fusion de groupe (constat 1) : test du scénario → `relineageGroup` sqlite+pg → route →
   fenêtre (envoie la clé) → audit.
2. Comptage juste des semaines (constat 2a) : tests sur `listAllWeeksWithActions`.
3. Aperçu d'import avec cases + motifs (constat 2b).
4. Pastille de groupe dans import + fusion (+ tableau) (constat 3).
5. Vérif navigateur sur instance locale (copie de données Mana si possible), suite complète,
   ZIP. Après déploiement : refaire les fusions de Mana pour faire disparaître les fantômes.
