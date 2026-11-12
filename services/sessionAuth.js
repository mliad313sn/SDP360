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
// F-ARCH-06 — report_config.csp_strict_pages: extra pages enforced without a deploy (a page whose inline
// scripts and handlers were extracted). Default '' = today. The list can only ADD strict pages: it never
// removes a built-in one and never touches the allowed origins. Entries are local `/name.html` paths.
let _extraStrict = [];
let _extraAt = 0, _extraBusy = false;
const STRICT_TTL_MS = 30000;
function parseStrictPages(csv) {
  const out = [];
  for (const raw of String(csv == null ? '' : csv).split(',')) {
    let p = raw.trim(); if (!p) continue;
    if (!p.startsWith('/')) p = '/' + p;
    const seg = p.slice(1).split('/');
    if (!p.endsWith('.html') || p.length > 200 || !seg.every((x, i) => (i === seg.length - 1 ? /^[A-Za-z0-9_-]+\.html$/ : /^[A-Za-z0-9_-]+$/).test(x))) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}
function setStrictPages(csv) { _extraStrict = parseStrictPages(csv); _extraAt = Date.now(); return _extraStrict; }
function invalidateStrictPages() { _extraAt = 0; }
/** Called on each request: when the cached list is older than the TTL, reload it in the background. load() → the setting (Promise). */
function touchStrictPages(load, now = Date.now()) {
  if (_extraBusy || now - _extraAt < STRICT_TTL_MS) return;
  _extraBusy = true;
  Promise.resolve().then(load).then((v) => setStrictPages(v), () => { _extraAt = Date.now(); /* unreadable: keep the last list */ }).finally(() => { _extraBusy = false; });
}
function isStrictCspPath(p) { return STRICT_PAGES.includes(p) || _extraStrict.includes(p) || String(p || '').startsWith('/share/'); }

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
    "style-src 'self' 'unsafe-inline'",   // many inline styles throughout; C-29: no font host
    "font-src 'self' data:",                // C-29: fonts are same-origin (public/vendor/fonts)
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

module.exports = { cookieValue, sessionToken, isStrictCspPath, parseStrictPages, setStrictPages, invalidateStrictPages, touchStrictPages, scriptSrc, nonceScripts, STRICT_PAGES,
  cspDirectives, reportOnlyScriptSrc, reportOnlyPolicy, CSP_REPORT_PATH };
