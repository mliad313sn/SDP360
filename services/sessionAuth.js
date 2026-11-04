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
    // B-01: front-end libraries are same-origin (public/vendor/) — no CDN origin on any production page
    : "script-src 'self' 'unsafe-inline'";
}

// The directives every page shares; only script-src varies (strict / normal / report-only).
function cspDirectives(scriptSrcDirective) {
  return [
    "default-src 'self'",
    scriptSrcDirective,
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com",   // many inline styles throughout
    "font-src 'self' fonts.gstatic.com data:",
    "img-src 'self' data:",
    // inspection.html ships its PWA manifest as an inline `data:` URL (Add-to-Home-Screen on phones).
    "manifest-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ];
}

// A-28a — the policy the enforcing one should become: nonce-only script-src (no 'unsafe-inline'),
// sent as Content-Security-Policy-Report-Only when SDP_CSP_REPORT_ONLY=1. B-01 made every library
// same-origin, so no CDN origin is listed. Violations go to POST /api/security/csp-report.
const CSP_REPORT_PATH = '/api/security/csp-report';
function reportOnlyScriptSrc(nonce) { return `script-src 'self' 'nonce-${nonce}'`; }
function reportOnlyPolicy(nonce) {
  return [...cspDirectives(reportOnlyScriptSrc(nonce)), `report-uri ${CSP_REPORT_PATH}`, 'report-to csp-endpoint'].join('; ');
}

// Give every <script> tag that has no nonce the per-request nonce.
function nonceScripts(html, nonce) {
  return String(html).replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
}

module.exports = { cookieValue, sessionToken, isStrictCspPath, scriptSrc, nonceScripts, STRICT_PAGES,
  cspDirectives, reportOnlyScriptSrc, reportOnlyPolicy, CSP_REPORT_PATH };
