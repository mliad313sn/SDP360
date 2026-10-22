# ADR-004 — Les routes vivent dans `routes/*.js`, dépendances injectées

Statut : accepté (étape 5 de SDP-DASH-2.0, lots 5.1 à 5.4, 2026-10-21/22).

## Contexte

`server.js` faisait 9 203 lignes : chaque route, chaque aide et l'amorçage dans un seul fichier, impossible à
relire et source de conflits. L'étude fixait < 3 000 lignes.

## Décision

1. Une route d'API va dans un module `routes/<domaine>.js` : `module.exports = function xRoutes(deps) {…; return router; }`,
   monté par `app.use(require('./routes/x')({...}))` **à l'emplacement exact** où vivait le bloc (l'ordre
   d'enregistrement est la priorité des routes Express).
2. Les dépendances de `server.js` arrivent par `deps`. Une valeur déclarée **plus bas** que le montage (`let rdb`,
   `let meetingsDb`) n'est pas injectable (zone morte) : le module la `require` lui-même, ou reçoit une fonction
   déclarée (hissée) qui la lit au moment de la requête.
3. Une variable réassignée (`let`) est lue par un accesseur injecté, jamais copiée.
4. Une aide utilisée à la fois par le module et par le reste : `services/<nom>.js`, ou `router.helpers` si elle
   dépend de l'état du module.
5. Le cliquet `tests/server-size.test.js` refuse toute hausse de `server.js` et vérifie que chaque `routes/*.js`
   est monté ; on l'abaisse après chaque extraction.

## Conséquences

- `server.js` : 2 665 lignes (lot 5.4). Il garde la configuration, les middlewares, le cache des tickets, les
  pages HTML et l'amorçage.
- Les gardes statiques (`await-precedence`, « aucun `cron.schedule` hors du registre ») balaient aussi `routes/`.
- Méthode et pièges détaillés : `docs/design/ETAPE-05-installateur-modularisation.md` §2.
