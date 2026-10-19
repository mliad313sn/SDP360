// tests/mailer-smtp-config.test.js — the SMTP transport options + the
// missing-host guard.
//
// Why this exists: with `smtp_host` empty, nodemailer silently defaults to
// localhost, so "Test connection" reported `connect ECONNREFUSED 127.0.0.1:587`
// — an error that says nothing about the real cause (nothing configured).
// And on port 587 (STARTTLS) the transport carried no `requireTLS`, so a server
// that doesn't offer STARTTLS would have received the credentials in cleartext.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildMailer, smtpOptions, smtpConfigError } = require('../services/mailer');

const O365 = {
  smtp_host: 'smtp.office365.com', smtp_port: '587', smtp_secure: '0',
  smtp_user: 'manapop@endeavourmining.com', smtp_pass: 'secret',
  // A COMPLETE config carries a From — an empty one is a configuration error,
  // not a default (see the SOBO test below).
  from: 'IT Reports <manapop@endeavourmining.com>',
};

test('smtpConfigError names the missing host instead of letting it fall back to localhost', () => {
  assert.match(smtpConfigError({}), /host/i);
  assert.match(smtpConfigError({ smtp_host: '   ' }), /host/i);
  assert.strictEqual(smtpConfigError(O365), null);
});

test('verify() fails fast with the real reason when the host is empty', async () => {
  const r = await buildMailer({ smtp_host: '' }).verify();
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /host/i);
  assert.ok(!/ECONNREFUSED|127\.0\.0\.1/.test(r.error), 'must not surface a localhost connection error');
});

test('send() fails fast with the real reason when the host is empty', async () => {
  const r = await buildMailer({ smtp_host: '' }).send({ to: 'a@b.c', subject: 's', html: 'h' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /host/i);
});

test('port 587 + authenticated → secure:false and requireTLS demanded (STARTTLS, Office 365)', () => {
  const o = smtpOptions(O365);
  assert.strictEqual(o.host, 'smtp.office365.com');
  assert.strictEqual(o.port, 587);
  assert.strictEqual(o.secure, false, '587 is STARTTLS, not implicit TLS');
  assert.strictEqual(o.requireTLS, true, 'credentials must never cross an unencrypted link');
  assert.deepStrictEqual(o.auth, { user: O365.smtp_user, pass: 'secret' });
});

test('port 465 → implicit TLS (secure:true), requireTLS not forced', () => {
  const o = smtpOptions({ ...O365, smtp_port: '465', smtp_secure: '1' });
  assert.strictEqual(o.secure, true);
  assert.strictEqual(o.port, 465);
  assert.ok(!o.requireTLS, 'implicit TLS is already encrypted end-to-end');
});

test('anonymous relay (no user) keeps the lenient behaviour — no forced STARTTLS', () => {
  const o = smtpOptions({ smtp_host: 'relay.internal', smtp_port: '25', smtp_secure: '0', smtp_user: '' });
  assert.strictEqual(o.auth, undefined);
  assert.ok(!o.requireTLS, 'no credentials at risk, so do not break an existing plaintext relay');
});

test('host is trimmed and the port defaults to 587', () => {
  const o = smtpOptions({ smtp_host: '  smtp.office365.com  ' });
  assert.strictEqual(o.host, 'smtp.office365.com');
  assert.strictEqual(o.port, 587);
});

// An empty `from` reaches Office 365 as a Send-On-Behalf-Of / SendAs rights
// rejection whose message embeds server names, SIDs and hex diagnostics — tens
// of KB that say nothing about the actual cause. Same class as the empty-host
// localhost fallback: fail fast, name the field.
test('smtpConfigError names an empty From — O365 answers it with a SOBO rights dump', () => {
  const noFrom = { smtp_host: 'smtp.office365.com', smtp_user: 'x@y.com', from: '' };
  assert.match(smtpConfigError(noFrom), /from/i);
  assert.strictEqual(smtpConfigError({ ...noFrom, from: 'IT <it@y.com>' }), null);
});

test('send() fails fast when From is empty, without contacting SMTP', async () => {
  const r = await buildMailer({ smtp_host: 'smtp.office365.com', smtp_user: 'x@y.com', from: '   ' })
    .send({ to: 'a@b.c', subject: 's', html: 'h' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /from/i);
  assert.ok(!/SOBO|PA4PR01MB/i.test(r.error), 'must not surface an O365 diagnostic blob');
});
