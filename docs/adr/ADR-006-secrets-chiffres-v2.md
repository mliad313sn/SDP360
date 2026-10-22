# ADR-006 — Les secrets de configuration sont chiffrés (v2, scrypt)

Statut : accepté (étape 4 de SDP-DASH-2.0). Détail : `docs/design/ETAPE-04-securite.md`.

## Décision

1. Les secrets de `report_config` (SMTP, SSO, Meraki, OpManager, Meridian, SDP/Analytics, webhooks Teams) sont
   stockés chiffrés AES-256-GCM, clé dérivée de `SDP_CONFIG_KEY` par scrypt (format v2 ; le v1 est relu puis
   ré-chiffré par `tools/pg/encrypt-secrets.js --apply`).
2. Avec `REQUIRE_POSTGRES=1`, le serveur refuse de démarrer sans `SDP_CONFIG_KEY`.
3. Un secret n'est jamais renvoyé au navigateur (GET masqué), un champ vide à l'enregistrement conserve la valeur,
   et les écritures sont réservées au super_admin.
4. Comparaison de clés par `services/safeCompare.js`, jamais `===` ; aucune clé ni jeton dans une URL.

## Conséquences

- Restaurer un dump sur une autre machine exige la même `SDP_CONFIG_KEY` (sinon les secrets sont lus vides, avec un log).
- Tout nouveau secret rejoint les trois listes (masquage, conservation, contrôle super_admin).
