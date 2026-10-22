# ADR-005 — Le JSX est compilé à l'avance, jamais dans le navigateur

Statut : accepté (étape 5 de SDP-DASH-2.0, lots 5.1 et 5.2, 2026-10-21/22).

## Contexte

Le tracker et l'aperçu du tableau de bord chargeaient Babel (≈ 3 Mo) et compilaient le JSX à chaque visite, ce qui
imposait `unsafe-eval` dans la politique de sécurité de ces pages.

## Décision

1. `tools/build/build-frontend.js` (esbuild, `transformSync`, sans bundling) compile chaque `.jsx` listé en `.js`
   à côté de la source ; `npm run build`, `--check` en CI.
2. Les `.js` générés sont **commités** : la production n'a pas d'étape de build, le paquet les copie.
3. Une page charge le `.js`, jamais le `.jsx` ; React en build **production** avec SRI.
4. `tests/frontend-build.test.js` : fichiers à jour, aucune page avec Babel (liste d'exceptions vide), aucune
   référence `.jsx`.

## Conséquences

- Plus aucune page n'autorise `unsafe-eval`.
- Modifier un `.jsx` sans `npm run build` fait échouer la CI.
