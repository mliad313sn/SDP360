'use strict';
// V1a — Pure OPManager availability aggregation. Consumes per-device × day rows
// (from the Analytics daily view) and rolls them up to (site_id, kpi_family, period).
// No DB, no Date.now — `asOf`/date logic injected. Store raw, coerce here (mirrors
// the Assets module). Availability % = Σuptime / Σ(uptime+downtime+dependent+
// unmonitored); maintenance + on-hold excluded. A device-day counts toward the
// average ONLY if it carries a real measurement (some uptime, downtime, or
// dependent-downtime). A device-day that is 100% unmonitored — the device was never
// actually measured, no up/down/dep — is EXCLUDED entirely so its "unmonitored" time
// can't drag the site mean down (a well-identified device with no reading is not the
// same as 0%). Within a measured device, unmonitored gaps still count as unavailable.
// Fallback = mean(uptime%) when durations are unparseable. Absence → null (never 0).
// `status_color` uses the existing green|orange|red|none vocabulary.
const { weekOf } = require('./siteReportDeps');

function parsePercent(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[%,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// "0 days 22 hrs 59 mins 34 secs" → seconds. Tolerant: null on no match.
function parseDuration(s) {
  if (s == null) return null;
  const m = String(s).match(/(\d+)\s*days?\D+(\d+)\s*hrs?\D+(\d+)\s*mins?\D+(\d+)\s*secs?/i);
  if (!m) return null;
  return (+m[1]) * 86400 + (+m[2]) * 3600 + (+m[3]) * 60 + (+m[4]);
}

// Any date string ("May 28, 2026 12:00:00 AM" or ISO) → 'YYYY-MM-DD' using the
// LOCAL calendar parts (the string was written as local midnight) to avoid a
// tz round-trip shifting the day.
function toDateStr(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthBoundsOf(dateStr) {
  const [y, m] = dateStr.split('-');
  const last = new Date(Number(y), Number(m), 0).getDate();
  return { period_start: `${y}-${m}-01`, period_end: `${y}-${m}-${String(last).padStart(2, '0')}` };
}

function statusColor(value, target) {
  // Thresholds: RAG policy 'opm_availability' (public/lib/kpiRag.js) - the target-2 variant (ETAPE-03 DEC-3).
  const k = require('../public/lib/kpiRag').classify('opm_availability', value, target);
  return k == null ? 'none' : k === 'amber' ? 'orange' : k;
}

// dailyRows: [{ probe, type, category, day, uptime_pct, uptime_dur, downtime_dur,
//               dependent_dur, unmonitored_dur, device_key?, device_name? }]
// deps: { probeToSite (sync!), classify, targets, periodType:'week'|'month', asOf,
//         isMonitor? } — isMonitor(row) marks an OpManager monitoring server (remote
//         probe / central). Monitors are EXCLUDED from the business family pools, and
//         their own downtime flags the affected site's period as a blind spot.
function aggregate(dailyRows, { probeToSite, classify, targets, periodType, isMonitor = () => false }) {
  const groups = new Map();
  const mon = new Map();   // `${site_id}|${period_start}` → { up, tot } for the site's monitor(s)
  for (const r of (dailyRows || [])) {
    const site_id = probeToSite(r.probe);
    const dayStr = toDateStr(r.day);
    // The monitoring server itself is not a business device: keep it out of every
    // family pool, but record its own uptime so we can flag blind-spot periods.
    if (isMonitor(r)) {
      if (site_id != null && dayStr) {
        const mb = periodType === 'week' ? weekOf(dayStr) : monthBoundsOf(dayStr);
        const mk = `${site_id}|${mb.period_start}`;
        let mm = mon.get(mk); if (!mm) { mm = { up: 0, tot: 0 }; mon.set(mk, mm); }
        const mu = parseDuration(r.uptime_dur) || 0, md = parseDuration(r.downtime_dur) || 0, mp = parseDuration(r.dependent_dur) || 0;
        mm.up += mu; mm.tot += (mu + md + mp);
      }
      continue;
    }
    const fam = classify(r.type, r.category).family;
    if (fam === 'excluded') continue;
    if (site_id == null) continue;                 // unmapped probe → out of KPI (coverage keeps it)
    if (!dayStr) continue;
    const b = periodType === 'week' ? weekOf(dayStr) : monthBoundsOf(dayStr);
    const key = `${site_id}|${fam}|${b.period_start}`;
    let g = groups.get(key);
    if (!g) {
      g = { site_id, kpi_family: fam, period_start: b.period_start, period_end: b.period_end,
            up: 0, down: 0, dep: 0, unmon: 0, pcts: [], devices: new Set(), inc: new Set(), maxDay: dayStr };
      groups.set(key, g);
    }
    const up = parseDuration(r.uptime_dur), down = parseDuration(r.downtime_dur),
          dep = parseDuration(r.dependent_dur), unmon = parseDuration(r.unmonitored_dur);
    const pct = parsePercent(r.uptime_pct);
    const dev = r.device_key || r.device_name || r.probe;
    g.devices.add(dev);                            // every classified device → coverage
    const hasDuration = (up != null || down != null || dep != null || unmon != null);
    if (hasDuration) {
      // A duration breakdown exists. Count it toward the average ONLY if the device was
      // actually measured — some uptime, downtime, or dependent-downtime. A
      // parseable-but-purely-unmonitored day (only `unmonitored`, zero up/down/dep) is
      // a device that was never really measured → EXCLUDE it entirely so its
      // unmonitored time can't drag the mean down. A partially-measured device keeps
      // its unmonitored gap as unavailable (unchanged).
      if ((up || 0) + (down || 0) + (dep || 0) > 0) {
        if (up != null) g.up += up;
        if (down != null) g.down += down;
        if (dep != null) g.dep += dep;
        if (unmon != null) g.unmon += unmon;
        g.inc.add(dev);
      }
      // else: purely unmonitored → dropped (kept only in g.devices for coverage).
    } else if (pct != null) {
      // No parseable duration at all, but an explicit uptime% reading — the genuine
      // AVG-fallback case (measured device, unparseable duration strings). Keep it.
      g.pcts.push(pct);
      g.inc.add(dev);
    }
    if (dayStr > g.maxDay) g.maxDay = dayStr;
  }
  const out = [];
  for (const g of groups.values()) {
    const denom = g.up + g.down + g.dep + g.unmon;
    let value = denom > 0
      ? (100 * g.up / denom)
      : (g.pcts.length ? g.pcts.reduce((a, b) => a + b, 0) / g.pcts.length : null);
    if (value != null) value = Math.round(value * 100) / 100;
    const target = (targets && targets[g.kpi_family] != null) ? targets[g.kpi_family] : null;
    // Blind-spot: if the site's own monitoring server had downtime this period, the
    // device availability can't be fully trusted → label it (basis='monitoring_gap').
    const mm = mon.get(`${g.site_id}|${g.period_start}`);
    const monitoring_ok = (!mm || mm.tot === 0) ? true : (mm.up / mm.tot >= 0.99);
    out.push({
      site_id: g.site_id, period_type: periodType, period_start: g.period_start, period_end: g.period_end,
      kpi_family: g.kpi_family, metric_name: 'availability', metric_value: value, target_value: target,
      status_color: statusColor(value, target), trend: null,
      device_count: g.devices.size, included_device_count: g.inc.size, data_through: g.maxDay,
      basis: monitoring_ok ? null : 'monitoring_gap', monitoring_ok,
      raw_json: JSON.stringify({ up_sec: g.up, down_sec: g.down, dep_sec: g.dep, unmon_sec: g.unmon }),
    });
  }
  return out;
}

module.exports = { parsePercent, parseDuration, toDateStr, monthBoundsOf, statusColor, aggregate };
