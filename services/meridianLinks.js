'use strict';
// F1 — Thin, best-effort read-back of Meridian project links for a site (contract C3).
// Config-gated, injectable httpGet (default axios), and NEVER throws — degrades to {}
// so the Site Actions hub is never blocked by a Meridian outage. Returns a map keyed
// by the SDP stable action id (ext_id) → the link row.
const DEFAULT_TIMEOUT = 4000;
function _axiosGet() { return require('axios').get; }

async function getLinksForSite(site, { httpGet, config, timeout = DEFAULT_TIMEOUT } = {}) {
  const base = config && config.meridian_base_url;
  const key = config && config.meridian_out_key;
  if (!base || !key || !site) return {};   // inert until configured + a site is given
  const get = httpGet || _axiosGet();
  try {
    const url = `${String(base).replace(/\/$/, '')}/v1/links?site=${encodeURIComponent(site)}`;
    const r = await get(url, { headers: { 'X-API-Key': key }, timeout });
    const links = (r && r.data && r.data.links) || [];
    const map = {};
    for (const l of links) if (l && l.ext_id) map[l.ext_id] = l;
    return map;
  } catch (e) {
    console.warn('[meridian-links] read-back failed (best-effort, no badge):', e.message);
    return {};
  }
}

module.exports = { getLinksForSite };
