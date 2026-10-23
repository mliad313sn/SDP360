'use strict';
// Step 9 — SIGNED, EXPIRING links: a share link of an approved report, or an embeddable view (SharePoint iframe).
// token = base64url(payload) "." base64url(HMAC-SHA256(payload)); payload = { k: kind, id, exp (epoch seconds) }.
// The signing key is SDP_LINK_KEY, or derived from SDP_CONFIG_KEY; with neither, sharing is switched off (never a
// key made up at boot: links would silently die at the next restart). Comparison in constant time.

const crypto = require('crypto');
const { safeEqual } = require('./safeCompare');

const MAX_DAYS = { share: 30, embed: 366 };
const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function key(env = process.env) {
  if (env.SDP_LINK_KEY && env.SDP_LINK_KEY.length >= 16) return Buffer.from(env.SDP_LINK_KEY);
  if (env.SDP_CONFIG_KEY && env.SDP_CONFIG_KEY.length >= 16) return crypto.createHash('sha256').update('sdp-link:' + env.SDP_CONFIG_KEY).digest();
  return null;
}
function available(env) { return !!key(env); }

function sign({ kind, id, days }, env, nowMs = Date.now()) {
  const k = key(env);
  if (!k) throw Object.assign(new Error('Sharing is off: set SDP_LINK_KEY (or SDP_CONFIG_KEY) on the server.'), { status: 503 });
  if (!MAX_DAYS[kind]) throw new Error('unknown link kind');
  const d = Math.max(1, Math.min(MAX_DAYS[kind], Math.round(Number(days) || 7)));
  const payload = b64(JSON.stringify({ k: kind, id: String(id), exp: Math.floor(nowMs / 1000) + d * 86400 }));
  return { token: payload + '.' + b64(crypto.createHmac('sha256', k).update(payload).digest()), expires_at: new Date(nowMs + d * 86400000).toISOString(), days: d };
}

/** Returns { kind, id, exp } or null (bad signature, expired, wrong kind, sharing off). */
function verify(token, kind, env, nowMs = Date.now()) {
  const k = key(env);
  if (!k || typeof token !== 'string' || token.length > 600) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = b64(crypto.createHmac('sha256', k).update(payload).digest());
  if (!safeEqual(expect, sig)) return null;
  let p; try { p = JSON.parse(unb64(payload).toString('utf8')); } catch (_) { return null; }
  if (!p || p.k !== kind || !p.id || !(p.exp * 1000 > nowMs)) return null;
  return { kind: p.k, id: p.id, exp: p.exp };
}

module.exports = { sign, verify, available, MAX_DAYS };
