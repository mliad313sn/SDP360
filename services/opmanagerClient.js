'use strict';
// V1b-B — read-only OpManager REST API client.
//
// E4 (remediation 2026-10-20):
//  - TLS certificate verification is ON by default (tlsInsecure = false). The on-prem
//    server's internal CA is supplied as `caBundle` (PEM, the SECRET config key
//    `opmanager_ca_bundle`) and passed as `ca:` to the https agent, so a self-signed or
//    private-CA certificate is VERIFIED rather than ignored. `tlsInsecure: true` remains an
//    explicit, loudly-warned opt-out.
//  - OpManager's REST API only accepts the key as the `apiKey` request parameter (no header
//    form is documented for /api/json/v2), so the key still travels in the query string —
//    but it NEVER reaches an error message, a log line or a thrown URL: every failure is
//    re-thrown with `redactUrl()` applied (the key value becomes `<key>`) and the axios
//    config/request objects (which carry the full URL) are dropped from the error.
// Transport `get` is injectable so tests never hit the network. Inert when unconfigured
// (no apiKey/baseUrl → []/null, no call) so the collector self-skips.
let _axios = null, _https = null;
function _defaultGet(allowHosts) {
  // M4 — the real transport validates the URL (https, no private address unless the host is on
  // outbound_allow_hosts — the normal case for an on-prem OpManager) and never follows redirects.
  return require('./safeUrl').safeGet(allowHosts);
}
function _agent({ tlsInsecure, caBundle }) {
  if (!_https) _https = require('https');
  const o = {};
  if (tlsInsecure) o.rejectUnauthorized = false;
  if (caBundle) o.ca = caBundle;
  return new _https.Agent(o);
}
function _clean(p) { const o = {}; for (const [k, v] of Object.entries(p || {})) if (v !== undefined && v !== null) o[k] = v; return o; }

/**
 * Remove the API key from any string that may carry it: `apiKey=<value>` query params
 * (URL-encoded or not) and the raw key value itself wherever it appears.
 * @param {string} s
 * @param {string} [key] the literal key value, when known
 */
function redactUrl(s, key) {
  if (s == null) return s;
  let out = String(s).replace(/([?&;]api[_-]?key=)[^&\s#'"]*/gi, '$1<key>');
  if (key) {
    const k = String(key);
    if (k) {
      out = out.split(k).join('<key>');
      try { const enc = encodeURIComponent(k); if (enc !== k) out = out.split(enc).join('<key>'); } catch (_) { /* ignore */ }
    }
  }
  return out;
}

/** Build a redacted Error from any transport failure (axios error, plain Error, string). */
function _redactError(e, key) {
  // M9 — after the key is masked, every URL shrinks to scheme+host (no path / query in a client-visible message).
  const msg = require('./safeUrl').redactMessage(redactUrl(e && e.message != null ? e.message : String(e), key), [key]);
  const err = new Error(msg);
  if (e && e.code) err.code = e.code;
  if (e && e.response && e.response.status != null) err.status = e.response.status;
  if (e && e.stack) err.stack = redactUrl(e.stack, key);
  // Deliberately NOT copied: e.config / e.request / e.response.config (they hold the full URL).
  return err;
}

// OpManager list responses are enveloped: { <arrayKey>: [...], records: N }. Return the
// first array-valued property (or the value itself if already an array), else [].
function _pluck(res) {
  if (Array.isArray(res)) return res;
  if (res && typeof res === 'object') {
    for (const v of Object.values(res)) if (Array.isArray(v)) return v;
  }
  return [];
}

/** Client options from the report_config blob (the single place that reads the 4 keys). */
function optionsFromConfig(cfg) {
  const c = cfg || {};
  return {
    apiKey: c.opmanager_api_key || '',
    baseUrl: c.opmanager_base_url || '',
    tlsInsecure: String(c.opmanager_tls_insecure) === '1',
    caBundle: c.opmanager_ca_bundle || '',
    allowHosts: require('./safeUrl').allowHostsFromConfig(c),
  };
}

function makeOpmanagerClient({ apiKey, baseUrl, tlsInsecure = false, caBundle = '', allowHosts, get } = {}) {
  const transport = get || _defaultGet(allowHosts);
  const configured = !!(apiKey && baseUrl);
  const httpsAgent = (tlsInsecure || caBundle) ? _agent({ tlsInsecure, caBundle }) : undefined;
  if (configured && tlsInsecure && !makeOpmanagerClient._warned) { makeOpmanagerClient._warned = true; console.warn('[OpManager] TLS certificate verification is OFF (opmanager_tls_insecure=1) — paste the internal CA bundle (opmanager_ca_bundle) and set it back to 0'); }

  async function _get(path, params) {
    if (!configured) return undefined;
    const opts = { params: _clean({ apiKey, ...params }) };
    if (httpsAgent) opts.httpsAgent = httpsAgent;
    let res;
    try { res = await transport(`${baseUrl}${path}`, opts); }
    catch (e) { throw _redactError(e, apiKey); }
    return res ? res.data : undefined;
  }

  return {
    configured,
    tlsInsecure: !!tlsInsecure,
    hasCaBundle: !!caBundle,
    listDevices: async ({ rows = 1000, page = 1, category } = {}) =>
      configured ? _pluck(await _get('/api/json/v2/device/listDevices', { rows, page, category })) : [],
    getDeviceCompleteDetails: async ({ name } = {}) =>
      configured ? ((await _get('/api/json/v2/device/getDeviceCompleteDetails', { name })) || null) : null,
  };
}

module.exports = { makeOpmanagerClient, optionsFromConfig, redactUrl, _pluck };
