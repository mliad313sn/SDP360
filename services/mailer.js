'use strict';
// Transport adapter. buildMailer(config, deps) → { send(msg) }.
// send() NEVER throws into the caller — always returns {ok, error?}.
// deps.makeSmtp lets tests inject a stub instead of a real nodemailer transport.

// Why this guard exists: nodemailer silently defaults an empty `host` to
// localhost, so a never-configured SMTP surfaced as
// `connect ECONNREFUSED 127.0.0.1:587` — an error that tells the admin nothing
// about the real cause. Fail fast and name it instead.
function smtpConfigError(config = {}) {
  if ((config.transport || 'smtp') !== 'smtp') return null;
  if (!String(config.smtp_host || '').trim()) {
    return 'SMTP host is not configured — set it in Admin → Email / SMTP, then Save.';
  }
  return null;
}

// The transport options, as a pure function so they can be asserted without
// opening a socket.
//   • port 587 → STARTTLS: `secure:false`, and the session upgrades to TLS.
//   • port 465 → implicit TLS: `secure:true` from the first byte.
// `requireTLS` is demanded whenever we authenticate over a non-implicit-TLS
// port, so credentials can never cross an unencrypted link if the server fails
// to offer STARTTLS. An anonymous relay (no auth) keeps the lenient behaviour —
// nothing secret is at risk there and forcing TLS would break existing setups.
function smtpOptions(config = {}) {
  const secure = String(config.smtp_secure) === '1';
  const hasAuth = !!config.smtp_user;
  const opts = {
    host: String(config.smtp_host || '').trim(),
    port: +(config.smtp_port || 587),
    secure,
    auth: hasAuth ? { user: config.smtp_user, pass: config.smtp_pass } : undefined,
  };
  if (!secure && hasAuth) opts.requireTLS = true;
  return opts;
}

function buildMailer(config = {}, deps = {}) {
  const transport = config.transport || 'smtp';

  // The missing-host guard only applies when WE build the nodemailer transport
  // from the config — that is the only path where an empty host silently
  // becomes localhost. An injected transport (tests, future adapters) ignores
  // host/port entirely, so guarding it there would reject a valid caller.
  function _configError() {
    return deps.makeSmtp ? null : smtpConfigError(config);
  }

  function _smtp() {
    if (deps.makeSmtp) return deps.makeSmtp();
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport(smtpOptions(config));
  }

  async function send({ to, cc, subject, html, attachments } = {}) {
    try {
      if (transport === 'graph') return { ok: false, error: 'graph transport not implemented (v1 uses smtp)' };
      const cfgErr = _configError();
      if (cfgErr) return { ok: false, error: cfgErr };
      const tx = _smtp();
      const info = await tx.sendMail({
        from: config.from, to, cc, replyTo: config.reply_to || undefined,
        subject, html, attachments: attachments || [],
      });
      return { ok: true, messageId: info && info.messageId };
    } catch (e) {
      console.warn('[mailer] send failed:', e.message);
      return { ok: false, error: e.message };
    }
  }

  async function verify() {
    try {
      if (transport === 'graph') return { ok: false, error: 'graph not implemented' };
      const cfgErr = _configError();
      if (cfgErr) return { ok: false, error: cfgErr };
      const tx = _smtp();
      if (tx.verify) await tx.verify();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  return { send, verify };
}

module.exports = { buildMailer, smtpOptions, smtpConfigError };
