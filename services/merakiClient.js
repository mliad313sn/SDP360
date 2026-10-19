'use strict';
// V1b-A — read-only Meraki Dashboard API client. Header-authenticated
// (X-Cisco-Meraki-API-Key), org-scoped. The transport `get(url, opts)` is injectable
// (defaults to axios) so tests never hit the network. Inert when unconfigured
// (no apiKey/orgId → returns [], makes no call) so the collector self-skips cleanly.
//
// Endpoints used (all GET, all documented Meraki API v1):
//   /organizations/{org}/appliance/uplink/statuses         — current per-uplink state (MX)
//   /organizations/{org}/devices/uplinksLossAndLatency     — discover monitored dest ip
//   /devices/{serial}/lossAndLatencyHistory                — per-uplink loss/latency ≤31d
//   /networks/{network}/events                             — event log (PAGINATED object, not array)
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
    try {
      const res = await transport(`${baseUrl}${path}`, { headers, params: _clean(params) });
      return res && res.data !== undefined ? res.data : [];
    } catch (e) {
      // Surface WHICH path failed + the HTTP status, so a 404 tells you org-id vs
      // endpoint at a glance instead of a bare "status code 404".
      const status = e && e.response && e.response.status;
      throw new Error(`Meraki GET ${path}${status ? ` → HTTP ${status}` : ` → ${e.message}`}`);
    }
  }

  return {
    configured,
    orgNetworks: () => _get(`/organizations/${orgId}/networks`, { perPage: 1000 }),
    // Devices with their name/notes/tags — the appliance `notes` carries the ISP+bandwidth
    // per uplink (e.g. "WAN 1 (ORANGE): 200Mbps"). Filter to appliances via productTypes.
    orgDevices: ({ productTypes } = {}) => _get(`/organizations/${orgId}/devices`, { perPage: 1000, productTypes }),
    // The configured destinations the MX pings per network → { destinations:[{ip,default,...}] }.
    networkConnectivityDestinations: ({ networkId } = {}) =>
      _get(`/networks/${networkId}/appliance/connectivityMonitoringDestinations`, {}),
    orgUplinkStatuses: ({ networkIds, serials } = {}) =>
      _get(`/organizations/${orgId}/appliance/uplink/statuses`, { networkIds, serials, perPage: 1000 }),
    orgUplinksLossLatency: ({ serials } = {}) =>
      _get(`/organizations/${orgId}/devices/uplinksLossAndLatency`, { serials }),
    deviceLossLatencyHistory: ({ serial, uplink, ip, t0, t1, timespan, resolution } = {}) =>
      _get(`/devices/${serial}/lossAndLatencyHistory`, { uplink, ip, t0, t1, timespan, resolution }),
    // Event log. UNLIKE every other method here, this endpoint returns a PAGINATED OBJECT
    // { events:[...], pageStartAt, pageEndAt } — NOT a bare array. Return it as-is; the caller
    // (fetchAllNetworkEvents) walks the pages. Backward paging via endingBefore/startingAfter.
    networkEvents: ({ networkId, productType = 'appliance', startingAfter, endingBefore, perPage = 1000 } = {}) =>
      _get(`/networks/${networkId}/events`, { productType, startingAfter, endingBefore, perPage }),
  };
}

// Cursor helper: page backward through /networks/{id}/events accumulating .events.
// Backward paging → each page carries pageStartAt (the earliest event boundary); feed it back
// as endingBefore to fetch the next-older page. Stop when: a page result is falsy or lacks
// .events (an unconfigured client returns [] → treated as no events), a page yields 0 events,
// or pageStartAt stops moving. Capped at maxPages as a runaway backstop. Never throws on empty.
// NOTE: exact Meraki backward-paging semantics (endingBefore vs pageStartAt) are confirmed at
// integration time; this loops on the pageStartAt cursor as the documented backward boundary.
async function fetchAllNetworkEvents(client, { networkId, productType = 'appliance', since } = {}, maxPages = 200) {
  const out = [];
  let cursor = undefined; // first call: no endingBefore → newest page
  let lastCursor = null;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await client.networkEvents({ networkId, productType, endingBefore: cursor });
    // Empty guard: unconfigured client returns [] (array, no .events); a bad page is falsy.
    if (!page || !Array.isArray(page.events)) break;
    if (page.events.length === 0) break;
    out.push(...page.events);
    const next = page.pageStartAt;
    // Stop if the boundary is absent or hasn't advanced (would loop forever on the same page).
    if (!next || next === lastCursor) break;
    if (since && next <= since) break; // reached the requested lower bound
    lastCursor = next;
    cursor = next;
  }
  return out;
}

module.exports = { makeMerakiClient, fetchAllNetworkEvents };
