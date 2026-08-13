'use strict';
// V1a — Pure OPManager availability aggregation. Consumes per-device × day rows
// (from the Analytics daily view) and rolls them up to (site_id, kpi_family, period).
// No DB, no Date.now — `asOf`/date logic injected. Store raw, coerce here (mirrors
// the Assets module). Availability % = Σuptime / Σ(uptime+downtime+dependent+
// unmonitored); maintenance + on-hold excluded; `unmonitored` counts as unavailable
// (confirmed). Fallback = mean(uptime%) when durations are unparseable. Absence → null
// (never 0). `status_color` uses the existing green|orange|red|none vocabulary.
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
  if (value == null || target == null) return 'none';
  if (value >= target) return 'green';
  if (value >= target - 2) return 'orange';
  return 'red';
}

// dailyRows: [{ probe, type, category, day, uptime_pct, uptime_dur, downtime_dur,
//               dependent_dur, unmonitored_dur, device_key?, device_name? }]
// deps: { probeToSite (sync!), classify, targets, periodType:'week'|'month', asOf }
function aggregate(dailyRows, { probeToSite, classify, targets, periodType }) {
  const groups = new Map();
  for (const r of (dailyRows || [])) {
    const fam = classify(r.type, r.category).family;
    if (fam === 'excluded') continue;
    const site_id = probeToSite(r.probe);
    if (site_id == null) continue;                 // unmapped probe → out of KPI (coverage keeps it)
    const dayStr = toDateStr(r.day);
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
    if (up != null) g.up += up;
    if (down != null) g.down += down;
    if (dep != null) g.dep += dep;
    if (unmon != null) g.unmon += unmon;
    const pct = parsePercent(r.uptime_pct);
    if (pct != null) g.pcts.push(pct);
    const dev = r.device_key || r.device_name || r.probe;
    g.devices.add(dev);
    if (up != null || pct != null) g.inc.add(dev);
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
    out.push({
      site_id: g.site_id, period_type: periodType, period_start: g.period_start, period_end: g.period_end,
      kpi_family: g.kpi_family, metric_name: 'availability', metric_value: value, target_value: target,
      status_color: statusColor(value, target), trend: null,
      device_count: g.devices.size, included_device_count: g.inc.size, data_through: g.maxDay,
      raw_json: JSON.stringify({ up_sec: g.up, down_sec: g.down, dep_sec: g.dep, unmon_sec: g.unmon }),
    });
  }
  return out;
}

module.exports = { parsePercent, parseDuration, toDateStr, monthBoundsOf, statusColor, aggregate };
