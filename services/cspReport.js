'use strict';
// A-28a — Content-Security-Policy-Report-Only support. Pure helpers: the switch, and the reduction of a
// browser violation report to the three fields we keep (directive, blocked origin, document path).
// Nothing from the body is ever echoed; URLs lose their path/query (blocked) or query/fragment (document),
// and long opaque path segments (share tokens) are cut to 8 characters.

const TYPES = ['application/csp-report', 'application/reports+json'];
const MAX_ITEMS = 20;   // reports per request body that are looked at

/** SDP_CSP_REPORT_ONLY=1 → on. Unset (default) = today: no report-only header, no endpoint. */
function enabled(env = process.env) { return String(env.SDP_CSP_REPORT_ONLY || '').trim() === '1'; }

function _directive(v) {
  const d = String(v || '').trim().split(/\s+/)[0].toLowerCase();
  return /^[a-z-]{1,40}$/.test(d) ? d : 'unknown';
}
function _blocked(v) {
  const s = String(v || '').trim();
  if (/^https?:\/\//i.test(s)) { try { return new URL(s).origin; } catch (_) { return 'invalid-url'; } }
  const scheme = /^([a-z][a-z0-9+.-]{0,20}):/i.exec(s);
  if (scheme) return scheme[1].toLowerCase();              // data:, blob:, javascript: …
  return /^[a-z-]{1,32}$/i.test(s) ? s.toLowerCase() : (s ? 'other' : 'unknown');   // inline, eval, self…
}
function _document(v) {
  let p = '';
  try { p = new URL(String(v || ''), 'http://x').pathname; } catch (_) { p = ''; }
  if (!p.startsWith('/')) return 'unknown';
  return p.replace(/[A-Za-z0-9_-]{24,}/g, (m) => m.slice(0, 8) + '…').slice(0, 200);
}

/** Body of either format → [{directive, blocked, document, disposition}] (at most MAX_ITEMS). */
function normalise(body) {
  const list = Array.isArray(body) ? body : [body];
  const out = [];
  for (const it of list.slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== 'object') continue;
    if (it['csp-report'] && typeof it['csp-report'] === 'object') {
      const r = it['csp-report'];
      out.push({ directive: _directive(r['effective-directive'] || r['violated-directive']), blocked: _blocked(r['blocked-uri']),
        document: _document(r['document-uri']), disposition: r.disposition === 'enforce' ? 'enforce' : 'report' });
    } else if (it.type === 'csp-violation' && it.body && typeof it.body === 'object') {
      const b = it.body;
      out.push({ directive: _directive(b.effectiveDirective), blocked: _blocked(b.blockedURL),
        document: _document(b.documentURL || it.url), disposition: b.disposition === 'enforce' ? 'enforce' : 'report' });
    }
  }
  return out;
}

module.exports = { TYPES, MAX_ITEMS, enabled, normalise };
