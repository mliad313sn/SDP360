'use strict';
// V1b-B — read-only OpManager REST API client. apiKey travels as a query param (OpManager
// convention), the self-signed cert on the on-prem server is tolerated via an insecure
// https agent (tls_insecure). Transport `get` is injectable so tests never hit the network.
// Inert when unconfigured (no apiKey/baseUrl → []/null, no call) so the collector self-skips.
let _axios = null, _https = null;
function _defaultGet() {
  if (!_axios) _axios = require('axios');
  return (url, opts) => _axios.get(url, opts);
}
function _insecureAgent() {
  if (!_https) _https = require('https');
  return new _https.Agent({ rejectUnauthorized: false });
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

function makeOpmanagerClient({ apiKey, baseUrl, tlsInsecure = true, get } = {}) {
  const transport = get || _defaultGet();
  const configured = !!(apiKey && baseUrl);
  const httpsAgent = tlsInsecure ? _insecureAgent() : undefined;
  if (configured && tlsInsecure && !makeOpmanagerClient._warned) { makeOpmanagerClient._warned = true; console.warn('[OpManager] TLS certificate verification is OFF (opmanager_tls_insecure=1) — install the internal CA and set it to 0 (Step 4, DEC pending)'); }

  async function _get(path, params) {
    if (!configured) return undefined;
    const opts = { params: _clean({ apiKey, ...params }) };
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

module.exports = { makeOpmanagerClient, _pluck };
