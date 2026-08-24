'use strict';
// WAN SLA / ISP chargeback — the 5-minute OPEN-OUTAGE poller (separate from the nightly
// ingester). Reads Meraki orgUplinkStatuses (CURRENT state), opens provisional wan_outages
// rows for currently-down WAN uplinks, closes recovered + stale-open rows, and fires the
// 15-minute ISP auto-notification. Config-gated (no meraki_api_key → skip) + best-effort
// (a failure writes what it can and never throws). ISP notification is ARMED-OFF by default
// (cfg.notify.enabled), mirroring hygiene_send_enabled / scoreboard_send_enabled. All deps
// injectable — no DB/network/clock in tests. Never passes a Promise-returning resolver into a
// pure step: the network→site map + network names are pre-resolved with awaited calls first.
const { parseSlaWanConfig, resolveCircuit } = require('../../services/slaWanConfig');

function _lc(x) { return String(x == null ? '' : x).trim().toLowerCase(); }
// Same product-suffix normalisation as sync-wan.js so the base-name seed maps the
// appliance network ("Sabodala Gold Operations - appliance") to its site.
function _normNet(x) { return _lc(x).replace(/\s*-\s*(appliance|switch|wireless|combined|cellular ?gateway|sensor|camera)\s*$/, ''); }
// An uplink is UP only when Meraki reports 'active' or 'ready'; everything else
// (connecting / not connected / failed) is treated as down.
function _isUp(status) { const s = _lc(status); return s === 'active' || s === 'ready'; }
function _minutesSince(nowIso, thenIso) {
  const t1 = Date.parse(nowIso), t0 = Date.parse(thenIso);
  return (Number.isFinite(t0) && Number.isFinite(t1)) ? (t1 - t0) / 60000 : NaN;
}
const _key = (site_id, sub_site, uplink) => `${site_id}|${sub_site || ''}|${uplink}`;

async function main(deps = {}) {
  const log = deps.log || console.log;
  const rdb = deps.rdb || require('../../reports-db');
  const getConfig = deps.getConfig || (() => require('../../services/reportConfig').getConfig(rdb.db));
  const now = deps.now || new Date().toISOString();

  try {
    const config = await getConfig();                        // Promise on pg — MUST await
    if (!config || !config.meraki_api_key) { log('[wan-poll] not configured (meraki_api_key) — skipping'); return { skipped: true }; }
    const cfg = parseSlaWanConfig(config.sla_wan_config);

    const client = deps.client || require('../../services/merakiClient').makeMerakiClient({
      apiKey: config.meraki_api_key, orgId: config.meraki_org_id, baseUrl: config.meraki_base_url });
    const mailer = deps.mailer || require('../../services/mailer').buildMailer(config);

    // Pre-resolve network name → [{site_id, sub_site}] targets (a network can fan to the
    // main site plus per-sub-site rows) and network id → name, with awaited calls.
    const map = (await rdb.listSiteMerakiMap()) || [];
    const netToTargets = new Map();
    const _push = (net, t) => { const k = _normNet(net); if (!k) return; const a = netToTargets.get(k) || []; a.push(t); netToTargets.set(k, a); };
    for (const m of map) if (m.network) _push(m.network, { site_id: m.site_id, sub_site: '' });
    const subs = (typeof rdb.listWanSubsiteNetworks === 'function' ? await rdb.listWanSubsiteNetworks() : []) || [];
    for (const s of subs) _push(s.network, { site_id: s.site_id, sub_site: s.sub_site });

    let networkNameById = deps.networkNameById;
    if (!networkNameById) {
      const nets = (await client.orgNetworks()) || [];
      const byId = {}; for (const n of nets) byId[n.id] = n.name;
      networkNameById = (id) => byId[id] || null;
    }

    // Build the set of currently-DOWN (site_id, sub_site, uplink) from current uplink state.
    const statuses = (await client.orgUplinkStatuses({})) || [];
    // A (site,sub_site,uplink) is DOWN only if NO appliance reports it up — warm-spare /
    // dual-MX aware: a network can carry a master + a warm spare whose uplinks read
    // 'not connected', and the site's uplink is up whenever the ACTIVE MX reports it up.
    // (SGO BACKUP etc. that live in a SEPARATE, unmapped network are excluded upstream.)
    const upKeys = new Set();
    const downCand = new Map();   // key → {site_id, sub_site, uplink, network_id, device_serial}
    for (const dev of statuses) {
      const netName = networkNameById(dev.networkId);
      const targets = netName != null ? (netToTargets.get(_normNet(netName)) || []) : [];
      if (!targets.length) continue;                          // unmapped network → never guess
      for (const up of (dev.uplinks || [])) {
        if (!/^wan\d$/.test(String(up.interface || ''))) continue;   // wan1/wan2/… only
        for (const t of targets) {
          const k = _key(t.site_id, t.sub_site, up.interface);
          if (_isUp(up.status)) upKeys.add(k);
          else if (!downCand.has(k)) downCand.set(k, { site_id: t.site_id, sub_site: t.sub_site, uplink: up.interface, network_id: dev.networkId, device_serial: dev.serial });
        }
      }
    }
    const downNow = new Map();
    for (const [k, v] of downCand) if (!upKeys.has(k)) downNow.set(k, v);

    // ── ISP alert scaffolding (best-effort) — recipients + a send helper the loops call. ──
    const wanAlert = require('../../services/wanAlert');
    const reportDir = require('../../services/reportDirectory');
    const downKeys = new Set(downNow.keys());
    const nameById = {}, codeById = {}; let dirRows = [];
    try {
      for (const s of ((await rdb.listSites({ includeInactive: true })) || [])) nameById[s.id] = s.name;
      for (const c of ((typeof rdb.listSiteModuleCodes === 'function' ? await rdb.listSiteModuleCodes('meetings') : []) || [])) codeById[c.site_id] = c.code;
      dirRows = (await reportDir.listRecipients(rdb.db)) || [];
    } catch (_) { /* alerting recipients are best-effort */ }
    const _sdEmail = String((cfg.notify && cfg.notify.servicedesk_email) || '').trim();
    const _coordEmail = (site_id) => {
      try { const r = reportDir.resolveFromRows(dirRows, codeById[site_id], 'coordinator'); return r && r.to; }
      catch (_) { return null; }
    };
    // Send a 'down' | 'recovery' alert for one outage. Returns true iff an email was sent. NEVER
    // emails an ISP for a site/power outage (both uplinks of the device down) — user-confirmed rule.
    async function _sendAlert(kind, r) {
      if (wanAlert.isSiteOutage(r.site_id, r.sub_site, downKeys)) return false;
      const circuit = resolveCircuit(cfg, { site_id: r.site_id, sub_site: r.sub_site, uplink: r.uplink });
      const coord = (cfg.notify && cfg.notify.cc_coordinator !== false) ? _coordEmail(r.site_id) : null;
      // A RECOVERY email skips the service desk by default so it never opens a 2nd ticket
      // (recovery_cc_servicedesk to include it). The DOWN email always cc's the service desk.
      const sd = (kind === 'recovery' && !(cfg.notify && cfg.notify.recovery_cc_servicedesk)) ? '' : _sdEmail;
      const rcpt = wanAlert.alertRecipients(circuit, coord, sd);
      if (!rcpt) return false;
      const base = { site_id: r.site_id, sub_site: r.sub_site, siteName: nameById[r.site_id],
        uplink: r.uplink, isp: circuit.isp, circuit_id: circuit.circuit_id, detectedStart: r.detected_start };
      const mail = kind === 'recovery'
        ? wanAlert.buildRecoveryEmail({ ...base, restoredEnd: now })
        : wanAlert.buildDownEmail({ ...base, nowIso: now });
      await mailer.send({ to: rcpt.to, cc: rcpt.cc, subject: mail.subject, html: mail.html });
      return true;
    }

    const open = (await rdb.listOpenWanOutages()) || [];
    const openByKey = new Map();
    for (const r of open) openByKey.set(_key(r.site_id, r.sub_site, r.uplink), r);

    const staleHours = (cfg.ingest && cfg.ingest.stale_open_hours) || 24;
    let closed = 0, staleClosed = 0, opened = 0, notified = 0, recovered = 0;

    // Recovery + stale-open guard — BEFORE opening new rows, so the one-open-row invariant
    // can never permanently block a fresh outage.
    // (B) Close ONLY on an EXPLICIT 'up' reading (upKeys). NEVER close on mere absence: when the
    // MX loses power it drops out of the status response entirely, and closing then would fake a
    // recovery and end the outage early. An unseen uplink (offline) is kept open; the stale-open
    // guard still bounds it so it can't stay open forever.
    for (const r of open) {
      const k = _key(r.site_id, r.sub_site, r.uplink);
      if (upKeys.has(k)) {
        // Recovery email — ONLY if a DOWN alert was actually sent for this outage (notified_at).
        if (cfg.notify && cfg.notify.enabled && cfg.notify.recovery_enabled !== false && r.notified_at != null) {
          try { if (await _sendAlert('recovery', r)) recovered++; } catch (_) { /* recovery mail best-effort */ }
        }
        await rdb.closeWanOutage({ site_id: r.site_id, sub_site: r.sub_site, uplink: r.uplink, detected_start: r.detected_start, restored_end: now });
        openByKey.delete(k); closed++;
      } else {
        // still down, OR not seen this poll (MX offline) → keep the outage open
        const ageH = _minutesSince(now, r.detected_start) / 60;
        if (Number.isFinite(ageH) && ageH >= staleHours) {
          await rdb.upsertWanOutage({ ...r, restored_end: now, source: 'stale_open' });
          openByKey.delete(k); staleClosed++;
        }
      }
    }

    // Open new provisional rows for currently-down targets with no open row (invariant).
    for (const d of downNow.values()) {
      const k = _key(d.site_id, d.sub_site, d.uplink);
      if (openByKey.has(k)) continue;
      const circuit = resolveCircuit(cfg, { site_id: d.site_id, sub_site: d.sub_site, uplink: d.uplink }) || {};
      await rdb.upsertWanOutage({
        site_id: d.site_id, sub_site: d.sub_site, uplink: d.uplink, detected_start: now,
        restored_end: null, notified_at: null, source: 'meraki_status',
        isp: circuit.isp || null, circuit_id: circuit.circuit_id || null,
        network_id: d.network_id, device_serial: d.device_serial,
      });
      opened++;
    }

    // ISP auto-notification — ARMED-OFF by default. Send NOTHING unless cfg.notify.enabled.
    // DOWN email: single-uplink ISP outage, open ≥ trigger_minutes, not yet notified (both-down
    // site outages are skipped inside _sendAlert). The exact down time comes from the (ingester-
    // refined) detected_start; coordinator + service desk are cc'd. Stamp notified_at → send once.
    if (cfg.notify && cfg.notify.enabled) {
      const trigMin = cfg.notify.trigger_minutes || 15;
      const openNow = (await rdb.listOpenWanOutages()) || [];   // re-read: excludes just-closed, ages just-opened at 0
      for (const r of openNow) {
        if (r.restored_end != null) continue;                   // NEVER send if restored
        if (r.notified_at != null) continue;                    // send once
        const ageMin = _minutesSince(now, r.detected_start);
        if (!Number.isFinite(ageMin) || ageMin < trigMin) continue;   // not yet at the gate
        try {
          if (await _sendAlert('down', r)) {
            await rdb.upsertWanOutage({ ...r, notified_at: now });
            notified++;
          }
        } catch (_) { /* down mail best-effort */ }
      }
    }

    // Heartbeat: stamp the last successful poll so WAN Health knows monitoring is live
    // (a mapped circuit with no outages then reads 100%, not '—'). Best-effort.
    try {
      const setConfig = deps.setConfig || ((kv) => require('../../services/reportConfig').setConfig(rdb.db, kv));
      const hb = { wan_poll_last_run: now };
      // Stamp when monitoring BEGAN (once, never overwritten) — availability is only meaningful
      // over the time actually collected, so the denominator is clamped to this.
      if (!config.wan_poll_first_run) hb.wan_poll_first_run = now;
      await setConfig(hb);
    } catch (e) { /* heartbeat is non-blocking */ }

    log(`[wan-poll] down=${downNow.size} opened=${opened} closed=${closed} stale=${staleClosed} notified=${notified} recovered=${recovered} (${now})`);
    return { ok: true, down: downNow.size, opened, closed, stale_closed: staleClosed, notified, recovered };
  } catch (e) {
    console.warn('[wan-poll] failed (non-blocking):', e.message);
    return { ok: false, error: e.message };
  }
}

if (require.main === module) { main().then(r => process.exit(r && r.ok !== false ? 0 : 1)).catch(() => process.exit(1)); }
module.exports = { main, _normNet, _isUp };
