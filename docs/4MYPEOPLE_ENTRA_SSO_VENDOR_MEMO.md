# 4MyPeople — Enabling Microsoft Entra SSO (vendor memo)
*Memo to the 4MyPeople vendor — 2026-08-10. Bilingual: English first, Français ensuite.*

---

## English

### Context
Endeavour Mining is federating three IT platforms under **one Microsoft Entra
identity provider** for single sign-on: the **SDP Ops Dashboard**, the **Meridian
PMO**, and **4MyPeople**. One Entra app registration, one redirect URI per app.
We are asking you to **enable Entra SSO on 4MyPeople**.

### What already exists on your side (good news)
Your codebase already contains the identity-resolution half, written and unit-tested:

- `src/services/SsoService.js` → `resolveIdentity(provider, profile)`:
  - accepts `provider = 'entra'` and a `profile = { sub | oid | id, email }`;
  - resolves to a local `admins` or `employees` account by **linked external id
    first, then active-email match** (and links the external id on first match);
  - **denies unknown identities — no JIT auto-provisioning**;
  - `isEnabled()` gates on `SSO_ENABLED`.
- `tests/unit/ssoService.test.js` covers it.

This is the security-sensitive part, and it is done. **The only missing piece is
the OIDC transport** — the comment in your own file says so:
> "The OIDC/SAML transport (redirect, token validation) is wired separately and gated by `SSO_ENABLED`."

### What we are asking you to build
The **OIDC Authorization-Code + PKCE transport**, gated by `SSO_ENABLED`, that
calls your existing `resolveIdentity('entra', …)`:

1. **`GET /api/auth/sso/login`** — build the Entra authorize URL (auth-code flow,
   PKCE), with `scope = openid profile email User.Read`, a `state` and `nonce`
   you persist for the round-trip, then 302 to Entra.
2. **`GET /api/auth/sso/callback`** — receive `code`, exchange it at the Entra
   token endpoint, **validate the `id_token`** (RS256 signature via the tenant
   JWKS; verify `iss`, `aud`, `nonce`, `exp`), extract the profile
   `{ oid: id_token.oid, email: id_token.email }`, then:
   - `const principal = await SsoService.resolveIdentity('entra', { oid, email })`
   - if `principal === null` → **deny** (show a friendly "not provisioned" error;
     do **not** create an account);
   - else mint your normal 4MyPeople session for that `principal` (same session
     you issue after a password login) and redirect into the app.
3. Mount these routes **only when `SSO_ENABLED` is true** (so it's an off switch),
   and keep password login working alongside (hybrid) until cutover.

### Configuration you will receive (put in 4MyPeople `.env`)
```
SSO_ENABLED=true
ENTRA_TENANT_ID=<Directory (tenant) ID>
ENTRA_CLIENT_ID=<Application (client) ID>
ENTRA_CLIENT_SECRET=<client secret VALUE>
ENTRA_REDIRECT_URI=https://itops-dashboard.edv-ops.com/4mypeople/api/auth/sso/callback
```
*(Redirect URI is a placeholder path — tell us the exact path your transport uses and we'll register it in Entra. Registering it later does not require recreating the app.)*

### Prerequisite to confirm
`resolveIdentity` reads/writes `auth_provider` and `external_id` on the `admins`
and `employees` tables. Please confirm those columns exist (or add them) so the
first email-match can link the Entra `oid`.

### Reference implementation (optional, to save you time)
The SDP Dashboard already implements this exact transport with **zero new
dependencies** (axios + Node `crypto` for RS256/JWKS): `services/ssoEntra.js`
(OIDC auth-code + PKCE, JWKS RS256 verification) mounted at `/api/auth/sso/login`
and `/api/auth/sso/callback`. We are happy to share it as a working pattern — the
only 4MyPeople-specific line is the `resolveIdentity` call + your session mint.

### Security posture to preserve (non-negotiable)
- **Single tenant** (org accounts only).
- **Deny unknowns** — no JIT provisioning (your `resolveIdentity` already does this).
- Validate the `id_token` signature + `iss`/`aud`/`nonce`/`exp`.
- Keep one **break-glass** password admin for emergencies.

### Coordination
We prefer **you finish your own scaffold** (it's your code, designed for Entra) so
that a future 4MyPeople update never conflicts with a wiring we would have added.
If timing is tight, we can port the SDP transport into your app instead — but only
with your agreement, given the update-overwrite risk.

---

## Français

### Contexte
Endeavour Mining fédère trois plateformes IT sous **un seul fournisseur d'identité
Microsoft Entra** pour le single sign-on : le **SDP Ops Dashboard**, le **PMO
Meridian** et **4MyPeople**. Une seule app registration Entra, une Redirect URI
par application. Nous vous demandons **d'activer le SSO Entra sur 4MyPeople**.

### Ce qui existe déjà chez vous (bonne nouvelle)
Votre code contient déjà la moitié « résolution d'identité », écrite et testée :

- `src/services/SsoService.js` → `resolveIdentity(provider, profile)` :
  - accepte `provider = 'entra'` et un `profile = { sub | oid | id, email }` ;
  - résout vers un compte local `admins` ou `employees` par **id externe lié
    d'abord, puis correspondance e-mail actif** (et lie l'id externe à la 1ʳᵉ
    correspondance) ;
  - **refuse les identités inconnues — pas d'auto-provisioning (JIT)** ;
  - `isEnabled()` dépend de `SSO_ENABLED`.
- `tests/unit/ssoService.test.js` le couvre.

C'est la partie sensible côté sécurité, et elle est **faite**. **Il ne manque que
le transport OIDC** — votre propre commentaire le dit :
> « The OIDC/SAML transport (redirect, token validation) is wired separately and gated by `SSO_ENABLED`. »

### Ce que nous vous demandons de construire
Le **transport OIDC Authorization-Code + PKCE**, activé par `SSO_ENABLED`, qui
appelle votre `resolveIdentity('entra', …)` existant :

1. **`GET /api/auth/sso/login`** — construit l'URL d'autorisation Entra (auth-code,
   PKCE), `scope = openid profile email User.Read`, un `state` et un `nonce`
   persistés pour l'aller-retour, puis redirige (302) vers Entra.
2. **`GET /api/auth/sso/callback`** — reçoit le `code`, l'échange au token endpoint
   Entra, **valide l'`id_token`** (signature RS256 via le JWKS du tenant ; vérifie
   `iss`, `aud`, `nonce`, `exp`), extrait `{ oid, email }`, puis :
   - `const principal = await SsoService.resolveIdentity('entra', { oid, email })`
   - si `principal === null` → **refus** (message « compte non provisionné » ; ne
     créez **pas** de compte) ;
   - sinon, émettez votre session 4MyPeople habituelle pour ce `principal` (la même
     qu'après un login mot de passe) et redirigez dans l'application.
3. Ne montez ces routes **que si `SSO_ENABLED` est vrai** (interrupteur off), et
   gardez le login mot de passe en parallèle (hybride) jusqu'à la bascule.

### Configuration que vous recevrez (dans le `.env` 4MyPeople)
```
SSO_ENABLED=true
ENTRA_TENANT_ID=<Directory (tenant) ID>
ENTRA_CLIENT_ID=<Application (client) ID>
ENTRA_CLIENT_SECRET=<VALEUR du client secret>
ENTRA_REDIRECT_URI=https://itops-dashboard.edv-ops.com/4mypeople/api/auth/sso/callback
```
*(La Redirect URI est un chemin indicatif — dites-nous le chemin exact de votre
transport et nous l'enregistrerons dans Entra. L'ajouter plus tard ne nécessite
pas de recréer l'app.)*

### Prérequis à confirmer
`resolveIdentity` lit/écrit `auth_provider` et `external_id` sur les tables
`admins` et `employees`. Merci de confirmer que ces colonnes existent (ou de les
ajouter) pour que la 1ʳᵉ correspondance e-mail puisse lier l'`oid` Entra.

### Implémentation de référence (optionnel, pour gagner du temps)
Le SDP Dashboard implémente déjà ce transport exact **sans nouvelle dépendance**
(axios + `crypto` Node pour RS256/JWKS) : `services/ssoEntra.js` (OIDC auth-code +
PKCE, vérification RS256/JWKS) monté sur `/api/auth/sso/login` et
`/api/auth/sso/callback`. Nous pouvons le partager comme patron fonctionnel — la
seule ligne spécifique à 4MyPeople est l'appel `resolveIdentity` + votre émission
de session.

### Posture de sécurité à préserver (non négociable)
- **Tenant unique** (comptes de l'organisation uniquement).
- **Refus des inconnus** — pas de provisioning JIT (votre `resolveIdentity` le fait déjà).
- Valider la signature de l'`id_token` + `iss`/`aud`/`nonce`/`exp`.
- Garder un compte admin **break-glass** (mot de passe) pour les urgences.

### Coordination
Nous préférons que **vous finissiez votre propre scaffold** (c'est votre code,
prévu pour Entra) afin qu'une future mise à jour 4MyPeople n'entre jamais en
conflit avec un câblage que nous aurions ajouté. Si le calendrier est serré, nous
pouvons porter le transport SDP dans votre app — mais uniquement avec votre accord,
compte tenu du risque d'écrasement à la mise à jour.
