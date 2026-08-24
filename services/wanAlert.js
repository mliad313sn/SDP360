'use strict';
// WAN ISP outage alerting — PURE logic (no I/O). The poller wires these into the 5-min loop:
// a DOWN email when a single-uplink ISP outage crosses the trigger, and a RECOVERY email when it
// closes. THE RULE (user-confirmed): never alert an ISP for a SITE outage — if BOTH uplinks of a
// device are down at once it's a power/box fault, not the operator, so no ISP email goes out.

// Currently-down keys are `${site_id}|${sub_site}|${uplink}`. A device = (site_id, sub_site);
// ≥2 of its uplinks down at once = a site/power outage.
function isSiteOutage(site_id, sub_site, downKeys) {
  let n = 0;
  for (const k of downKeys || []) {
    const parts = String(k).split('|');
    if (Number(parts[0]) === Number(site_id) && (parts[1] || '') === (sub_site || '')) n += 1;
  }
  return n >= 2;
}

// { to: ISP, cc: coordinator + service desk } — deduped, cc never repeats the to. null if no ISP contact.
function alertRecipients(circuit, coordinatorEmail, servicedeskEmail) {
  const to = circuit && String(circuit.isp_notify_email || '').trim();
  if (!to) return null;
  const cc = [coordinatorEmail, servicedeskEmail]
    .map((x) => String(x == null ? '' : x).trim())
    .filter(Boolean);
  const seen = new Set([to.toLowerCase()]);
  const ccUniq = [];
  for (const a of cc) { const l = a.toLowerCase(); if (!seen.has(l)) { seen.add(l); ccUniq.push(a); } }
  return { to, cc: ccUniq.join(', ') };
}

function _pad(n) { return String(n).padStart(2, '0'); }
// Human duration between two ISO instants: "2h 05m", "15m", "—" if either is unparseable.
function humanDuration(fromIso, toIso) {
  const a = Date.parse(fromIso), b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '—';
  const mins = Math.floor((b - a) / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${_pad(m)}m` : `${m}m`;
}

function _where(o) { return o.sub_site ? `${o.siteName || ('site ' + o.site_id)} / ${o.sub_site}` : (o.siteName || ('site ' + o.site_id)); }
function _row(label, val) { return `<tr><td style="padding:2px 10px 2px 0;color:#667">${label}</td><td style="padding:2px 0"><b>${val == null || val === '' ? '—' : val}</b></td></tr>`; }

// DOWN email. o = { site_id, sub_site, siteName, uplink, isp, circuit_id, detectedStart, nowIso }
function buildDownEmail(o) {
  const where = _where(o);
  const subject = `[WAN OUTAGE] ${o.isp || 'ISP'} ${o.circuit_id || ''} — ${where} ${o.uplink} down`.replace(/\s+/g, ' ').trim();
  const html =
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>⚠️ <b>Coupure d'un lien WAN</b> — merci de traiter.</p>` +
    `<table style="border-collapse:collapse">` +
    _row('Site', where) + _row('Opérateur (ISP)', o.isp) + _row('Circuit', o.circuit_id) +
    _row('Lien', o.uplink) + _row('Coupé depuis', o.detectedStart) +
    _row('Durée à présent', humanDuration(o.detectedStart, o.nowIso)) +
    `</table>` +
    `<p style="color:#889;font-size:12px">Détection automatique (Meraki). Un email de rétablissement suivra à la reprise du lien.</p>` +
    `</div>`;
  return { subject, html };
}

// RECOVERY email. o = { …same…, restoredEnd }
function buildRecoveryEmail(o) {
  const where = _where(o);
  const subject = `[WAN RESTORED] ${o.isp || 'ISP'} ${o.circuit_id || ''} — ${where} ${o.uplink} rétabli`.replace(/\s+/g, ' ').trim();
  const html =
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>✅ <b>Lien WAN rétabli.</b></p>` +
    `<table style="border-collapse:collapse">` +
    _row('Site', where) + _row('Opérateur (ISP)', o.isp) + _row('Circuit', o.circuit_id) +
    _row('Lien', o.uplink) + _row('Coupé de', o.detectedStart) + _row('Rétabli à', o.restoredEnd) +
    _row('Durée totale', humanDuration(o.detectedStart, o.restoredEnd)) +
    `</table></div>`;
  return { subject, html };
}

module.exports = { isSiteOutage, alertRecipients, humanDuration, buildDownEmail, buildRecoveryEmail };
