'use strict';
// Transport adapter. buildMailer(config, deps) → { send(msg) }.
// send() NEVER throws into the caller — always returns {ok, error?}.
// deps.makeSmtp lets tests inject a stub instead of a real nodemailer transport.

function buildMailer(config = {}, deps = {}) {
  const transport = config.transport || 'smtp';

  function _smtp() {
    if (deps.makeSmtp) return deps.makeSmtp();
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
      host: config.smtp_host, port: +(config.smtp_port || 587),
      secure: String(config.smtp_secure) === '1',
      auth: config.smtp_user ? { user: config.smtp_user, pass: config.smtp_pass } : undefined,
    });
  }

  async function send({ to, cc, subject, html, attachments } = {}) {
    try {
      if (transport === 'graph') return { ok: false, error: 'graph transport not implemented (v1 uses smtp)' };
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
      const tx = _smtp();
      if (tx.verify) await tx.verify();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  return { send, verify };
}

module.exports = { buildMailer };
