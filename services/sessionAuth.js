'use strict';
// Fiche E5 (2026-10-20) — the httpOnly `report_token` cookie is the ONLY session credential a
// browser presents. The `x-report-token` header stays accepted for non-browser callers
// (tools/, scheduled jobs, smoke suites): a request with no cookie AND no Origin header —
// the same "browser context" rule fiche C1 applies to the dash key. Also holds the strict
// (nonce-only) script-src policy for the public / share pages.

function cookieValue(req, name) {
  const header = (req && req.headers && req.headers.cookie) || '';
  const m = header.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  if (!m) return null;
  try { return decodeURIComponent(m.slice(name.length + 1)) || null; } catch (_) { return null; }
}

function sessionToken(req) {
  const c = cookieValue(req, 'report_token');
  if (c) return c;
  if (!req || !req.headers || req.headers.origin) return null;   // browser without cookie → no session
  return req.headers['x-report-token'] || null;
}

// Pages served with script-src 'nonce-…' (no 'unsafe-inline'). Others are progressive work.
const STRICT_PAGES = ['/exec-view.html', '/login.html'];
function isStrictCspPath(p) { return STRICT_PAGES.includes(p) || String(p || '').startsWith('/share/'); }

function scriptSrc(nonce, strict) {
  return strict
    // security review: the strict pages (login, Exec View, share links) load nothing from a CDN —
    // no third-party origin is allowed to run script on the pages an anonymous visitor reaches
    ? `script-src 'self' 'nonce-${nonce}'`
    : "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net cdnjs.cloudflare.com";
}

// Give every <script> tag that has no nonce the per-request nonce.
function nonceScripts(html, nonce) {
  return String(html).replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
}

module.exports = { cookieValue, sessionToken, isStrictCspPath, scriptSrc, nonceScripts, STRICT_PAGES };
