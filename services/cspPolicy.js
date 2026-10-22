'use strict';
// Step 4 (SDP-DASH-2.0) — Content-Security-Policy without inline script.
// The global CSP still allows 'unsafe-inline' scripts because ~60 legacy pages carry inline
// <script> blocks and onclick="" attributes. Two rules move away from it:
//   1. every NEW page is written without inline script and served with the STRICT policy below
//      (listed in STRICT_PAGES — tests/csp-inline.test.js fails if a new page is not);
//   2. the legacy count is a RATCHET (tests/__golden__/inline-scripts.json): it may only go down.
//      The removal plan, page by page, is in docs/design/ETAPE-04-securite.md.
const STRICT_PAGES = new Set(['/kpi-dictionary.html', '/dashboard.html', '/direction.html', '/dashboard-composer.html']);

function strictHeader(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''} cdn.jsdelivr.net cdnjs.cloudflare.com`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com cdn.jsdelivr.net cdnjs.cloudflare.com",
    "font-src 'self' fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Inline-script inventory of one HTML text (blocks without src, on*= attributes, javascript: URLs). */
function inventory(html) {
  const s = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  const blocks = (s.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*>/gi) || [])
    .filter(t => !/type\s*=\s*["'](text\/html|application\/(ld\+)?json|text\/template)["']/i.test(t)).length;
  const handlers = (s.match(/<[a-z][^>]*\son[a-z]+\s*=\s*["']/gi) || []).length;
  const jsUrls = (s.match(/href\s*=\s*["']\s*javascript:/gi) || []).length;
  return { blocks, handlers, jsUrls, total: blocks + handlers + jsUrls };
}

module.exports = { STRICT_PAGES, strictHeader, inventory };
