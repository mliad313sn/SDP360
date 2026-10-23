'use strict';
// Step 10 — WRITE adapter to ServiceDesk Plus Cloud API v3 for the field quick actions. DISARMED by default: it acts
// only when `field_sdp_write_enabled` = 1 AND a refresh token carrying the WRITE scope (SDPOnDemand.requests.ALL, to
// be approved by the change board) is stored. The read client (services/sdpApiClient.js, Teams SLA alerts) is not
// touched. baseUrl is the configured `sdp_api_base_url` (it already ends with /api/v3). Transport injectable: tests
// never reach the network. Every call returns { ok, result | error }.

function makeSdpWriter({ enabled, baseUrl, accountsUrl = 'https://accounts.zoho.com', clientId, clientSecret, refreshToken, transport } = {}) {
  const configured = !!(baseUrl && clientId && clientSecret && refreshToken);
  const armed = !!enabled && configured;
  const T = transport || (() => { const ax = require('axios'); return { post: (u, b, o) => ax.post(u, b, { timeout: 30000, ...o }), put: (u, b, o) => ax.put(u, b, { timeout: 30000, ...o }) }; })();
  const base = String(baseUrl || '').replace(/\/+$/, '');
  let token = null, exp = 0;
  async function _token() {
    if (token && Date.now() < exp) return token;
    const q = new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' });
    const r = await T.post(`${accountsUrl}/oauth/v2/token`, q.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    token = r.data && r.data.access_token;
    if (!token) throw new Error('no access token');
    exp = Date.now() + (Number(r.data.expires_in) || 3600) * 1000 - 60000;
    return token;
  }
  const H = async () => ({ Authorization: 'Zoho-oauthtoken ' + await _token(), Accept: 'application/vnd.manageengine.sdp.v3+json', 'Content-Type': 'application/x-www-form-urlencoded' });
  const body = (o) => 'input_data=' + encodeURIComponent(JSON.stringify(o));

  async function perform(action) {
    if (!armed) return { ok: false, error: 'SDP write is not armed' };
    const p = action.payload || {};
    try {
      if (action.kind === 'sdp_ticket') {
        const req = { subject: p.subject, description: [p.description, p.justification].filter(Boolean).join('\n\n'), site: p.site ? { name: p.site } : undefined };
        const r = await T.post(`${base}/requests`, body({ request: req }), { headers: await H() });
        const id = r.data && r.data.request && (r.data.request.display_id || r.data.request.id);
        return { ok: true, result: 'ticket ' + (id || 'created') };
      }
      if (action.kind === 'sdp_close') {
        await T.put(`${base}/requests/${encodeURIComponent(p.ticket_id)}/close`, body({ request: { closure_info: { requester_ack_resolution: true, closure_comments: p.justification } } }), { headers: await H() });
        return { ok: true, result: 'ticket ' + p.ticket_id + ' closed' };
      }
      if (action.kind === 'sdp_transfer') {
        await T.put(`${base}/requests/${encodeURIComponent(p.ticket_id)}`, body({ request: { group: { name: p.target_group } } }), { headers: await H() });
        return { ok: true, result: 'ticket ' + p.ticket_id + ' transferred to ' + p.target_group };
      }
      return { ok: false, error: 'unknown action' };
    } catch (e) {
      return { ok: false, error: e && e.response ? `HTTP ${e.response.status}` : String(e.message || e).slice(0, 120) };
    }
  }
  return { enabled: armed, configured, perform };
}

module.exports = { makeSdpWriter };
