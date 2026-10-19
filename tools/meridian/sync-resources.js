'use strict';
// F1 — SDP → Meridian resource sync (contract C1). Reads SDP sites (meetings module
// codes) + people (dashboard user directory), builds the C1 payload, and POSTs it to
// Meridian's ingest API with X-API-Key. Idempotent (Meridian upserts), config-gated
// (self-skips when unconfigured), non-blocking (a Meridian outage never touches SDP).
// Scheduled nightly + runnable on demand. Deps are injectable for tests.
const { buildResourcePayload } = require('../../services/meridianResources');
function _axiosPost() { return require('axios').post; }

async function main(deps = {}) {
  const log = deps.log || console.log;
  const getConfig = deps.getConfig || (async () => require('../../services/reportConfig').getConfig(require('../../reports-db').db));
  const cfg = await getConfig();
  const base = cfg && cfg.meridian_base_url;
  const key = cfg && cfg.meridian_out_key;
  if (!base || !key) { log('[meridian-sync] not configured (meridian_base_url / meridian_out_key) — skipping'); return { skipped: true }; }

  const readSites = deps.readSites || (async () => require('../../reports-db').listSiteModuleCodes('meetings'));
  const readPeople = deps.readPeople || (async () => require('../../inspection-db').listPeople({}));
  const post = deps.httpPost || _axiosPost();

  const [sites, people] = [await readSites(), await readPeople()];
  const payload = buildResourcePayload({ sites, people });
  const { _skipped_unknown_site, ...body } = payload;   // internal counter, not sent
  try {
    const url = `${String(base).replace(/\/$/, '')}/v1/resources/sync`;
    const r = await post(url, body, { headers: { 'X-API-Key': key }, timeout: 20000 });
    log(`[meridian-sync] pushed sites=${body.sites.length} people=${body.people.length} (skipped_unknown_site=${_skipped_unknown_site}) → ${JSON.stringify((r && r.data) || {})}`);
    return { ok: true, sites: body.sites.length, people: body.people.length };
  } catch (e) {
    console.warn('[meridian-sync] push failed (non-blocking):', e.message);
    return { ok: false, error: e.message };
  }
}

if (require.main === module) { main().then(r => process.exit(r && r.ok !== false ? 0 : 1)).catch(() => process.exit(1)); }
module.exports = { main, buildResourcePayload };
