'use strict';
// Network-boundary rules shared by server.js and its tests (E3, 2026-10-20).
// Pure: no I/O, no express. IIS on the same box is the ONLY entry point, so:
//   - the Node process listens on the loopback interface unless an operator
//     explicitly asks for another interface (BIND_HOST=0.0.0.0 stays possible);
//   - the CORS allow-list never carries a raw IP origin (the box is unreachable
//     at its IP once Node binds to 127.0.0.1, and a stale IP entry only invites
//     someone to re-expose the port to make it work again);
//   - the session cookie's Secure flag follows req.secure — which Express derives
//     from X-Forwarded-Proto ONLY for the trusted loopback proxy — never from a
//     header the client can set itself.

const DEFAULT_BIND_HOST = '127.0.0.1';

function resolveBindHost(env = process.env) {
  const v = String((env && env.BIND_HOST) || '').trim();
  return v || DEFAULT_BIND_HOST;
}

// Build the CORS allow-list. Extra origins come from CORS_EXTRA_ORIGINS (comma-separated).
// A literal-IP origin is dropped even when supplied through the env var — pass a hostname.
// eslint-disable-next-line security/detect-unsafe-regex -- reviewed (consolidation 2026-10-28): anchored, every quantifier bounded
const IP_ORIGIN_RE = /^https?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/i;
function corsAllowedOrigins(port, env = process.env) {
  const base = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    'https://itops-dashboard.edv-ops.com',
  ];
  const extra = String((env && env.CORS_EXTRA_ORIGINS) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return [...base, ...extra].filter(o => o === `http://127.0.0.1:${port}` || !IP_ORIGIN_RE.test(o));
}

// Secure flag of the report_token cookie. `req.secure` is trustworthy because
// `app.set('trust proxy', 'loopback')` makes Express honour X-Forwarded-Proto
// only from 127.0.0.1 (IIS); a client-sent header is ignored. The env override
// SESSION_COOKIE_SECURE=1 forces the flag on regardless.
function cookieSecure(req, forced = false) {
  return Boolean(forced) || Boolean(req && req.secure === true);
}

module.exports = { DEFAULT_BIND_HOST, resolveBindHost, corsAllowedOrigins, cookieSecure, IP_ORIGIN_RE };
