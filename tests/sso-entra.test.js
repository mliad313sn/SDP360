'use strict';

// Exercises the Entra OIDC engine end-to-end WITHOUT a live tenant: we mint our
// own RSA keypair, publish its public JWK, sign a fake id_token, and stub the
// token + JWKS HTTP calls. Proves signature verification + every claim check +
// tamper/replay rejection using only Node built-ins.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const sso = require('../services/ssoEntra');

const CFG = {
  tenantId: 'tenant-abc',
  clientId: 'client-xyz',
  clientSecret: 'secret',
  redirectUri: 'https://itops-dashboard.edv-ops.com/api/auth/sso/callback',
};
const KID = 'test-key-1';

// One keypair for the whole file.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUB_JWK = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256', kty: 'RSA' };

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function makeIdToken(claimOverrides = {}, { kid = KID, tamper = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const payload = {
    iss: `https://login.microsoftonline.com/${CFG.tenantId}/v2.0`,
    aud: CFG.clientId,
    exp: now + 3600, iat: now, nbf: now,
    tid: CFG.tenantId,
    oid: '00000000-1111-2222-3333-444444444444',
    email: 'Azize.Samandoulgou@edv-ops.com',
    name: 'Azize SAMANDOULGOU',
    nonce: 'NONCE123',
    ...claimOverrides,
  };
  const signingInput = b64url(header) + '.' + b64url(payload);
  let sig = crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
  if (tamper) sig = sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA');
  return signingInput + '.' + sig;
}
// Stub HTTP: token endpoint returns our id_token; JWKS returns our public JWK.
function httpFor(idToken) {
  return {
    postForm: async () => ({ id_token: idToken, access_token: 'x', token_type: 'Bearer' }),
    getJson:  async () => ({ keys: [PUB_JWK] }),
  };
}

beforeEach(() => sso._resetJwksCache());

test('beginLogin: builds an authorize URL with PKCE S256 + state + nonce', () => {
  const r = sso.beginLogin(CFG);
  assert.match(r.url, /login\.microsoftonline\.com\/tenant-abc\/oauth2\/v2\.0\/authorize/);
  assert.match(r.url, /code_challenge_method=S256/);
  assert.match(r.url, /client_id=client-xyz/);
  assert.ok(r.state && r.nonce && r.codeVerifier, 'returns state/nonce/codeVerifier');
  // code_challenge must be the SHA256(verifier) b64url — verify the PKCE binding.
  const expected = crypto.createHash('sha256').update(r.codeVerifier).digest('base64url');
  assert.ok(r.url.includes('code_challenge=' + expected), 'code_challenge matches verifier');
});

test('completeLogin: valid token → normalized claims (email lowercased)', async () => {
  const claims = await sso.completeLogin({
    code: 'auth-code', codeVerifier: 'v', expectedNonce: 'NONCE123', cfg: CFG, http: httpFor(makeIdToken()),
  });
  assert.equal(claims.oid, '00000000-1111-2222-3333-444444444444');
  assert.equal(claims.email, 'azize.samandoulgou@edv-ops.com'); // lowercased
  assert.equal(claims.name, 'Azize SAMANDOULGOU');
});

test('rejects a tampered signature', async () => {
  await assert.rejects(
    sso.completeLogin({ code: 'c', codeVerifier: 'v', expectedNonce: 'NONCE123', cfg: CFG, http: httpFor(makeIdToken({}, { tamper: true })) }),
    e => e.code === 'bad_signature');
});

test('rejects wrong audience', async () => {
  await assert.rejects(
    sso.completeLogin({ code: 'c', codeVerifier: 'v', expectedNonce: 'NONCE123', cfg: CFG, http: httpFor(makeIdToken({ aud: 'someone-else' })) }),
    e => e.code === 'bad_aud');
});

test('rejects wrong issuer', async () => {
  await assert.rejects(
    sso.completeLogin({ code: 'c', codeVerifier: 'v', expectedNonce: 'NONCE123', cfg: CFG, http: httpFor(makeIdToken({ iss: 'https://evil/v2.0' })) }),
    e => e.code === 'bad_iss');
});

test('rejects an expired token', async () => {
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(
    sso.completeLogin({ code: 'c', codeVerifier: 'v', expectedNonce: 'NONCE123', cfg: CFG, http: httpFor(makeIdToken({ exp: now - 120 })) }),
    e => e.code === 'expired');
});

test('rejects a nonce mismatch (replay guard)', async () => {
  await assert.rejects(
    sso.completeLogin({ code: 'c', codeVerifier: 'v', expectedNonce: 'DIFFERENT', cfg: CFG, http: httpFor(makeIdToken()) }),
    e => e.code === 'bad_nonce');
});

test('rejects an unknown signing kid even after JWKS refresh', async () => {
  await assert.rejects(
    sso.completeLogin({ code: 'c', codeVerifier: 'v', expectedNonce: 'NONCE123', cfg: CFG, http: httpFor(makeIdToken({}, { kid: 'unknown-kid' })) }),
    e => e.code === 'no_jwks_key');
});

test('missing config is rejected up front', () => {
  assert.throws(() => sso.beginLogin({ clientId: 'x' }), e => e.code === 'missing_config');
});

test('token response without id_token is rejected', async () => {
  const http = { postForm: async () => ({ access_token: 'x' }), getJson: async () => ({ keys: [PUB_JWK] }) };
  await assert.rejects(
    sso.completeLogin({ code: 'c', codeVerifier: 'v', expectedNonce: 'NONCE123', cfg: CFG, http }),
    e => e.code === 'no_id_token');
});
