'use strict';
// V1b-B — read-only OpManager REST API client. Transport `get` is injectable so tests never hit
// the network.
// Step 4 (SDP-DASH-2.0): the apiKey travels in the `apiKey` REQUEST HEADER (OpManager accepts it
// there) — never in the URL, where it lands in proxy and access logs. `keyInQuery` is a legacy
// escape hatch (config opmanager_apikey_in_query='1'). TLS is VERIFIED by default: point
// `caFile` (config opmanager_ca_file) at the internal CA's PEM for a self-signed server;
// `tlsInsecure` (opmanager_tls_insecure='1') still exists but logs a warning on every client.
// Inert when unconfigured (no apiKey/baseUrl → []/null, no call) so the collector self-skips.
let _axios = null, _https = null;
function _defaultGet() {
  if (!_axios) _axios = require('axios');
  return (url, opts) => _axios.get(url, opts);
}
function _agent({ tlsInsecure, caFile }) {
  if (!_https) _https = require('https');
  if (tlsInsecure) return new _https.Agent({ rejectUnauthorized: false });
  if (caFile) return new _https.Agent({ ca: require('fs').readFileSync(caFile) });
  return undefined;                                   // Node's default verification
}
function _clean(p) { const o = {}; for (const [k, v] of Object.entries(p || {})) if (v !== undefined && v !== null) o[k] = v; return o; }

// OpManager list responses are enveloped: { <arrayKey>: [...], records: N }. Return the
// first array-valued property (or the value itself if already an array), else [].
function _pluck(res) {
  if (Array.isArray(res)) return res;
  if (res && typeof res === 'object') {
    for (const v of Object.values(res)) if (Array.isArray(v)) return v;
  }
  return [];
}

function makeOpmanagerClient({ apiKey, baseUrl, tlsInsecure = false, caFile = '', keyInQuery = false, get, warn = console.warn } = {}) {
  const transport = get || _defaultGet();
  const configured = !!(apiKey && baseUrl);
  if (configured && tlsInsecure) warn('[opmanager] TLS verification DISABLED (opmanager_tls_insecure=1) — set opmanager_ca_file to the internal CA instead');
  const httpsAgent = configured ? _agent({ tlsInsecure, caFile }) : undefined;

  async function _get(path, params) {
    if (!configured) return undefined;
    const opts = keyInQuery
      ? { params: _clean({ apiKey, ...params }) }
      : { params: _clean(params), headers: { apiKey } };
    if (httpsAgent) opts.httpsAgent = httpsAgent;
    const res = await transport(`${baseUrl}${path}`, opts);
    return res ? res.data : undefined;
  }

  return {
    configured,
    listDevices: async ({ rows = 1000, page = 1, category } = {}) =>
      configured ? _pluck(await _get('/api/json/v2/device/listDevices', { rows, page, category })) : [],
    getDeviceCompleteDetails: async ({ name } = {}) =>
      configured ? ((await _get('/api/json/v2/device/getDeviceCompleteDetails', { name })) || null) : null,
  };
}

/** Client options from report_config (one place for the three callers). */
function optionsFromConfig(cfg = {}) {
  return { apiKey: cfg.opmanager_api_key, baseUrl: cfg.opmanager_base_url,
    tlsInsecure: cfg.opmanager_tls_insecure === '1', caFile: cfg.opmanager_ca_file || '',
    keyInQuery: cfg.opmanager_apikey_in_query === '1' };
}

module.exports = { makeOpmanagerClient, optionsFromConfig, _pluck };
