'use strict';
// M4 (remediation 2026-10-21) — outbound URL guard against SSRF.
//
// Every URL the server POSTs to or FETCHes from on behalf of an administrator (Teams webhooks,
// engagement/publish webhooks, OpManager / Meraki / SDP base URLs) goes through
// `validateOutboundUrl()` twice: at SAVE time (admin route → explicit 400) and right BEFORE
// the send (default axios transports → the call is refused with a logged error that the
// scheduled job already treats as a counted skip).
//
// Rules: https only · no credentials in the URL · the host must not resolve to a loopback,
// RFC1918, link-local, cloud-metadata, IPv6 loopback / ULA / link-local address (IPv4-mapped
// forms included) · an unresolvable host is refused (the server could not reach it anyway).
// A host on the allow list (`*.webhook.office.com`, `*.logic.azure.com`, `*.powerautomate.com`
// + the admin's `outbound_allow_hosts`) is accepted after the https check WITHOUT the DNS gate:
// that is how an on-prem OpManager on a private address stays reachable — explicitly listed.
//
// Pure except for DNS, which is injectable (`lookup`) so tests never touch the resolver.

const dns = require('dns');
const net = require('net');

const DEFAULT_ALLOW_HOSTS = ['*.webhook.office.com', '*.logic.azure.com', '*.powerautomate.com'];
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data', 'ip6-localhost', 'ip6-loopback']);
const UNSAFE = 'UNSAFE_URL';

function _err(msg) { const e = new Error(msg); e.code = UNSAFE; return e; }

/** 'a.example, *.b.example' → ['a.example', '*.b.example'] (lowercased, trimmed, de-duplicated). */
function parseAllowHosts(s) {
  const out = [];
  for (const raw of String(s || '').split(/[,;\s]+/)) {
    const h = raw.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/** Default allow list + the comma-separated `outbound_allow_hosts` config key. */
function allowHostsFromConfig(cfg) {
  return [...DEFAULT_ALLOW_HOSTS, ...parseAllowHosts(cfg && cfg.outbound_allow_hosts)];
}

/** Exact match, or `*.suffix` wildcard (one or more labels before the suffix). */
function hostAllowed(host, allowHosts) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  for (const a of allowHosts || []) {
    const p = String(a || '').toLowerCase().replace(/\.$/, '');
    if (!p) continue;
    if (p.startsWith('*.')) { const suf = p.slice(1); if (h.endsWith(suf) && h.length > suf.length) return true; }
    else if (p === h) return true;
  }
  return false;
}

function _v4Parts(ip) { const p = ip.split('.').map(Number); return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null; }

function _isPrivateV4(ip) {
  const p = _v4Parts(ip);
  if (!p) return true;                                   // unparsable → treat as unsafe
  const [a, b] = p;
  if (a === 0) return true;                              // 0.0.0.0/8 ("this host")
  if (a === 10) return true;                             // 10/8
  if (a === 127) return true;                            // loopback
  if (a === 169 && b === 254) return true;               // link-local + cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16/12
  if (a === 192 && b === 168) return true;               // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;     // 100.64/10 (carrier NAT — never a public service)
  if (a >= 224) return true;                             // multicast + reserved + broadcast
  return false;
}

/** Expand an IPv6 textual address to 8 hextets (numbers). Returns null when unparsable. */
function _v6Hextets(ip) {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%'); if (zone >= 0) s = s.slice(0, zone);
  // IPv4-mapped / embedded tail: convert the dotted quad to two hextets
  const dot = s.lastIndexOf(':');
  if (s.includes('.')) {
    const v4 = _v4Parts(s.slice(dot + 1)); if (!v4) return null;
    s = s.slice(0, dot + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const parts = [...head, ...Array(fill).fill('0'), ...tail].map(h => parseInt(h, 16));
  return parts.length === 8 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? parts : null;
}

function _isPrivateV6(ip) {
  const h = _v6Hextets(ip);
  if (!h) return true;
  const allZeroHead = h.slice(0, 5).every(n => n === 0);
  if (allZeroHead && h[5] === 0xffff) {                  // ::ffff:a.b.c.d (IPv4-mapped)
    return _isPrivateV4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff].join('.'));
  }
  if (allZeroHead && h[5] === 0 && h[6] === 0 && (h[7] === 0 || h[7] === 1)) return true;   // :: and ::1
  if ((h[0] & 0xfe00) === 0xfc00) return true;           // fc00::/7 unique-local (covers fd00:ec2::254)
  if ((h[0] & 0xffc0) === 0xfe80) return true;           // fe80::/10 link-local
  if ((h[0] & 0xff00) === 0xff00) return true;           // ff00::/8 multicast
  if (h[0] === 0x2002) return _isPrivateV4([h[1] >> 8, h[1] & 0xff, h[2] >> 8, h[2] & 0xff].join('.'));   // 6to4 embeds an IPv4
  if (h[0] === 0x2001 && h[1] === 0) return true;        // Teredo — tunnelled, never a corporate endpoint
  return false;
}

/** true when the literal IP must never be an outbound target. */
function isPrivateAddress(ip) {
  const s = String(ip || '').trim().replace(/^\[|\]$/g, '');
  const fam = net.isIP(s);
  if (fam === 4) return _isPrivateV4(s);
  if (fam === 6) return _isPrivateV6(s);
  return true;
}

// Resolver results are cached for a minute so a 5-minute poller does not hammer DNS; a
// failed lookup is never cached.
const _cache = new Map();
const CACHE_MS = 60 * 1000;
async function _resolveAll(host, lookup) {
  const now = Date.now();
  const hit = _cache.get(host);
  if (hit && hit.until > now && lookup === undefined) return hit.addrs;
  const fn = lookup || ((h) => dns.promises.lookup(h, { all: true, verbatim: true }));
  const res = await fn(host);
  const addrs = (Array.isArray(res) ? res : [res]).map(r => (r && typeof r === 'object') ? r.address : r).filter(Boolean);
  if (lookup === undefined) { if (_cache.size > 200) _cache.clear(); _cache.set(host, { addrs, until: now + CACHE_MS }); }
  return addrs;
}

/** scheme + host only — what may appear in a log line (a webhook URL is a secret). */
function redactUrl(url) {
  try { const u = new URL(String(url)); return `${u.protocol}//${u.host}`; }
  catch (_) { return '<invalid url>'; }
}

/**
 * M9 — redact a free-text message before it leaves the process: every URL is reduced to
 * scheme + host, `key=value` pairs for well-known secret names and bearer tokens are masked,
 * and each literal secret passed in `secrets` (raw or URL-encoded) becomes <redacted>.
 * @param {any} s
 * @param {Array<string>} [secrets]
 */
const _SECRET_PAIR = /\b(api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|id[_-]?token|token|password|passwd|secret|authorization)\s*[=:]\s*[^\s&,;"'<>]+/gi;
function redactMessage(s, secrets) {
  let out = String(s == null ? '' : s);
  out = out.replace(/https?:\/\/[^\s"'<>)\]]+/gi, (m) => redactUrl(m));
  out = out.replace(_SECRET_PAIR, (m, k) => `${k}=<redacted>`);
  out = out.replace(/\b(Zoho-oauthtoken|Bearer)\s+[^\s"']+/gi, '$1 <redacted>');
  for (const k of Array.isArray(secrets) ? secrets : []) {
    const v = k == null ? '' : String(k);
    if (v.length < 4) continue;
    out = out.split(v).join('<redacted>');
    try { const enc = encodeURIComponent(v); if (enc !== v) out = out.split(enc).join('<redacted>'); } catch (_) { /* ignore */ }
  }
  return out;
}

/**
 * Validate an outbound URL. Resolves to the normalised URL string, or throws an Error with
 * `code: 'UNSAFE_URL'` and a message an administrator can act on.
 * @param {string} url
 * @param {{allowHosts?: string[], lookup?: (host:string)=>Promise<any>}} [opts]
 */
async function validateOutboundUrl(url, opts = {}) {
  const allowHosts = Array.isArray(opts.allowHosts) ? opts.allowHosts : DEFAULT_ALLOW_HOSTS;
  const raw = String(url == null ? '' : url).trim();
  if (!raw) throw _err('URL is empty.');
  let u;
  try { u = new URL(raw); } catch (_) { throw _err('URL is not valid (expected https://host/path).'); }
  if (u.protocol !== 'https:') throw _err('Only https:// URLs are allowed for outbound calls.');
  if (u.username || u.password) throw _err('Credentials are not allowed inside the URL.');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw _err('URL has no host.');
  if (hostAllowed(host, allowHosts)) return u.toString();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw _err(`Host "${host}" points at a local or cloud-metadata address and is refused. Add it to outbound_allow_hosts only if it is a trusted internal service.`);
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw _err(`Address ${host} is a private, loopback, link-local or metadata address and is refused. Add it to outbound_allow_hosts only if it is a trusted internal service.`);
    return u.toString();
  }
  let addrs;
  try { addrs = await _resolveAll(host, opts.lookup); }
  catch (e) { throw _err(`Host "${host}" could not be resolved (${(e && e.code) || 'DNS error'}).`); }
  if (!addrs.length) throw _err(`Host "${host}" could not be resolved (no address).`);
  const bad = addrs.find(isPrivateAddress);
  if (bad) throw _err(`Host "${host}" resolves to ${bad}, a private, loopback, link-local or metadata address, and is refused. Add it to outbound_allow_hosts only if it is a trusted internal service.`);
  return u.toString();
}

/** Options every outbound axios call should carry: no redirect may escape the validated host. */
function axiosSafeOptions() { return { maxRedirects: 0 }; }

let _axios = null;
function _ax() { if (!_axios) _axios = require('axios'); return _axios; }
function _logRefusal(url, e) { console.error(`[safe-url] outbound call to ${redactUrl(url)} refused: ${e.message}`); }

/** axios.get wrapper: validate → get with maxRedirects:0. Unsafe → logged + thrown (code UNSAFE_URL). */
function safeGet(allowHosts) {
  return async (url, opts) => {
    let safe; try { safe = await validateOutboundUrl(url, { allowHosts }); } catch (e) { _logRefusal(url, e); throw e; }
    return _ax().get(safe, { ...axiosSafeOptions(), ...(opts || {}) });
  };
}
/** axios.post wrapper with the same guard; `base` = default axios options (timeout, headers). */
function safePost(allowHosts, base) {
  return async (url, body, opts) => {
    let safe; try { safe = await validateOutboundUrl(url, { allowHosts }); } catch (e) { _logRefusal(url, e); throw e; }
    const o = { ...axiosSafeOptions(), ...(base || {}), ...(opts || {}) };
    if (base && base.headers && opts && opts.headers) o.headers = { ...base.headers, ...opts.headers };
    return _ax().post(safe, body, o);
  };
}

module.exports = {
  UNSAFE, DEFAULT_ALLOW_HOSTS, parseAllowHosts, allowHostsFromConfig, hostAllowed, isPrivateAddress,
  validateOutboundUrl, axiosSafeOptions, redactUrl, redactMessage, safeGet, safePost, _resetCache: () => _cache.clear(),
};
