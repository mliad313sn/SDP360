'use strict';
// V1b-A — read-only Meraki Dashboard API client. Header-authenticated
// (X-Cisco-Meraki-API-Key), org-scoped. The transport `get(url, opts)` is injectable
// (defaults to axios) so tests never hit the network. Inert when unconfigured
// (no apiKey/orgId → returns [], makes no call) so the collector self-skips cleanly.
//
// Endpoints used (all GET, all documented):
//   /organizations/{org}/uplinks/statuses                  — current per-uplink state
//   /organizations/{org}/devices/uplinksLossAndLatency     — discover monitored dest ip
//   /devices/{serial}/lossAndLatencyHistory                — per-uplink loss/latency ≤31d
let _axios = null;
function _defaultGet() {
  if (!_axios) _axios = require('axios');
  return (url, opts) => _axios.get(url, opts);
}
function _clean(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function makeMerakiClient({ apiKey, orgId, baseUrl = 'https://api.meraki.com/api/v1', get } = {}) {
  const transport = get || _defaultGet();
  const configured = !!(apiKey && orgId);
  const headers = { 'X-Cisco-Meraki-API-Key': apiKey, Accept: 'application/json' };

  async function _get(path, params) {
    if (!configured) return [];
    const res = await transport(`${baseUrl}${path}`, { headers, params: _clean(params) });
    return res && res.data !== undefined ? res.data : [];
  }

  return {
    configured,
    orgNetworks: () => _get(`/organizations/${orgId}/networks`, { perPage: 1000 }),
    // The configured destinations the MX pings per network → { destinations:[{ip,default,...}] }.
    networkConnectivityDestinations: ({ networkId } = {}) =>
      _get(`/networks/${networkId}/appliance/connectivityMonitoringDestinations`, {}),
    orgUplinkStatuses: ({ networkIds, serials } = {}) =>
      _get(`/organizations/${orgId}/uplinks/statuses`, { networkIds, serials, perPage: 1000 }),
    orgUplinksLossLatency: ({ serials } = {}) =>
      _get(`/organizations/${orgId}/devices/uplinksLossAndLatency`, { serials }),
    deviceLossLatencyHistory: ({ serial, uplink, ip, t0, t1, timespan, resolution } = {}) =>
      _get(`/devices/${serial}/lossAndLatencyHistory`, { uplink, ip, t0, t1, timespan, resolution }),
  };
}

module.exports = { makeMerakiClient };
