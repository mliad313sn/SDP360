'use strict';

// WAN SLA — pure service-hours calendar helpers.
//
// All timestamps are UTC and treated as local (every site is GMT+0 — a hard
// V1 constraint). No DB, no network, no I/O.
//
// A "calendar" is keyed by lowercase weekday (`mon`..`sun`); each value is an
// array of `[HH:MM, HH:MM]` window pairs. A day can carry two windows (the
// lunch split). An empty array = closed that day.

const DOW_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// 'HH:MM' → minutes-of-day.
function hmToMinutes(hm) {
  const [h, m] = String(hm).split(':');
  return Number(h) * 60 + Number(m);
}

// UTC midnight (ms) of the day containing `ms`.
function utcMidnight(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY_MS = 24 * 3600 * 1000;

// Sum of in-window seconds intersecting [fromMs, toMs). Shared core.
function _serviceSeconds(cal, fromMs, toMs) {
  if (!cal || !(toMs > fromMs)) return 0;
  let total = 0;
  // Step day-by-day from the UTC midnight of the fromMs day until we pass toMs.
  // Iterating in UTC makes DST irrelevant.
  for (let dayStart = utcMidnight(fromMs); dayStart < toMs; dayStart += DAY_MS) {
    const key = DOW_KEY[new Date(dayStart).getUTCDay()];
    const windows = cal[key];
    if (!windows || windows.length === 0) continue;
    for (const [startHM, endHM] of windows) {
      const winStart = dayStart + hmToMinutes(startHM) * 60 * 1000;
      const winEnd = dayStart + hmToMinutes(endHM) * 60 * 1000;
      const isectStart = Math.max(winStart, fromMs);
      const isectEnd = Math.min(winEnd, toMs);
      if (isectEnd > isectStart) total += (isectEnd - isectStart) / 1000;
    }
  }
  return Math.round(total);
}

// Total service-hour seconds between two instants.
function serviceSecondsBetween(cal, fromMs, toMs) {
  return _serviceSeconds(cal, fromMs, toMs);
}

// In-window seconds of an outage [startMs, endMs].
function clipToService(cal, [startMs, endMs]) {
  if (!(endMs > startMs)) return 0;
  return _serviceSeconds(cal, startMs, endMs);
}

// Round to 2 decimals.
function round2(x) {
  return Math.round(x * 100) / 100;
}

// ms of a timestamp that may be an ISO string or a number already in ms.
function _toMs(v) {
  return typeof v === 'number' ? v : Date.parse(v);
}

// Sum of counted (in-service-hours) downtime for one circuit's outages, under a
// given clock mode. Pure. Reads the STORED `attribution` flag — never computes it.
//   clockMode 'notification' → count from notified_at ?? (detected_start + trigger)
//   clockMode 'detection'    → count from detected_start (objective upper bound)
// The month intersection is applied on BOTH branches (open outages close at
// min(nowMs, monthEnd)). The min_outage floor uses the DETECTED span.
function _clockedDowntime(outages, cal, clockMode, ctx) {
  const { triggerMinutes, monthStart, monthEnd, nowMs, minOutageMinutes } = ctx;
  const openEnd = Math.min(nowMs, monthEnd);
  let counted = 0;
  for (const o of outages) {
    if (!o || o.attribution !== 'isp') continue;               // 'site'/'maintenance' excluded
    const detStart = _toMs(o.detected_start);
    const restoredMs = o.restored_end ? _toMs(o.restored_end) : openEnd;
    const durationMin = (restoredMs - detStart) / 60000;
    if (!(durationMin >= minOutageMinutes)) continue;          // min-outage floor (detected span)

    const chosenStart = clockMode === 'notification'
      ? (o.notified_at != null ? _toMs(o.notified_at) : detStart + triggerMinutes * 60000)
      : detStart;
    const chosenEnd = o.restored_end ? _toMs(o.restored_end) : openEnd;

    const start = Math.max(chosenStart, monthStart);           // intersect the month, both branches
    const end = Math.min(chosenEnd, monthEnd);
    if (end <= start) continue;
    counted += clipToService(cal, [start, end]);
  }
  return counted;
}

// A field is per-circuit-overridable: the circuit value wins, the tier is the default —
// so two ISPs on the same tier can carry different realities (parametrable per circuit).
function _pick(circuit, tier, key) { return (circuit && circuit[key] != null) ? circuit[key] : tier[key]; }

// Pure monthly SLA / chargeback for ONE circuit. No I/O — nowMs/monthStart/
// monthEnd/maintenance are injected. Returns the binding contract figure
// (per `clockStart`) plus the objective (`detection`) upper bound.
function computeCircuitSla({
  outages = [],
  circuit,
  tier,
  maintenance = [],        // eslint-disable-line no-unused-vars -- attribution is pre-stored (V1)
  monthStart,
  monthEnd,
  clockStart = 'notification',
  triggerMinutes = 15,
  nowMs,
}) {
  const cal = (circuit && circuit.hours) || tier.hours_default;
  const target = _pick(circuit, tier, 'availability_target_pct');
  const minOutageMinutes = _pick(circuit, tier, 'min_outage_minutes');

  // Completed month → full service hours; in-progress → elapsed (no elapsed-fraction artifact).
  const denomEnd = Math.min(monthEnd, nowMs);
  const service_seconds = serviceSecondsBetween(cal, monthStart, denomEnd);
  const allowed_s = (1 - target / 100) * service_seconds;

  const ctx = { triggerMinutes, monthStart, monthEnd, nowMs, minOutageMinutes };
  const counted = _clockedDowntime(outages, cal, clockStart, ctx);
  const countedObjective = _clockedDowntime(outages, cal, 'detection', ctx);

  const availability_pct = service_seconds <= 0
    ? null
    : round2(100 * (1 - counted / service_seconds));
  const availability_pct_objective = service_seconds <= 0
    ? null
    : round2(100 * (1 - countedObjective / service_seconds));
  const met = availability_pct != null && availability_pct >= target;

  const schedule = (circuit && circuit.credit_schedule) || tier.credit_schedule || [];
  const bands = schedule.slice().sort((a, b) => b.min - a.min);   // min DESC (unsorted-schedule guard)
  const creditCap = _pick(circuit, tier, 'credit_cap_pct');
  const model = _pick(circuit, tier, 'credit_model') || 'tiered';
  let credit_pct;
  if (availability_pct == null) {
    credit_pct = 0;
  } else if (model === 'prorata') {
    credit_pct = Math.min(
      creditCap,
      round2(100 * Math.max(0, (counted - allowed_s) / service_seconds)),
    );
  } else {
    const band = bands.find((b) => availability_pct >= b.min);
    credit_pct = Math.min(band ? band.credit : 0, creditCap);   // cap % first…
  }
  const credit_due = credit_pct > 0;
  const gap_pp = availability_pct == null ? null : round2(target - availability_pct);
  const gap_hours = round2((counted - allowed_s) / 3600);
  const amount = (circuit && circuit.mrc_amount > 0)
    ? Math.round(circuit.mrc_amount * credit_pct / 100)   // …then compute + round
    : null;

  return {
    availability_pct,
    availability_pct_objective,
    met,
    credit_pct,
    credit_due,
    gap_pp,
    gap_hours,
    counted_downtime_s: counted,
    service_seconds,
    allowed_s,
    amount,
    currency: circuit ? circuit.currency : null,
  };
}

// Count 'isp' outages whose TOTAL-interruption duration (wall-clock, unclipped —
// every event-log outage is Niveau-1 total interruption) exceeds the tier's
// resolution (relève) SLA for crit1. Still-open outages don't breach.
function resolutionBreaches(outages = [], tier, circuit) {
  // relève (repair-time) SLA is per-circuit-overridable: the circuit's
  // response.resolution_h.crit1 wins, the tier is the default.
  const c = circuit && circuit.response && circuit.response.resolution_h;
  const limit = (c && c.crit1 != null) ? c.crit1 : tier.response.resolution_h.crit1;
  let n = 0;
  for (const o of outages) {
    if (!o || o.attribution !== 'isp' || !o.restored_end) continue;
    const hours = (_toMs(o.restored_end) - _toMs(o.detected_start)) / 3600000;
    if (hours > limit) n += 1;
  }
  return n;
}

// Direction ('up' | 'down') from a Meraki event `type` — tolerates both
// underscore styles (`wan1_down`, `wan_1_up`). Anything else → null (skipped).
function _eventDirection(type) {
  const m = /_(up|down)$/.exec(String(type || ''));
  return m ? m[1] : null;
}

// Pair a Meraki appliance event log (up/down) into outage intervals. Pure.
// For each (site_id, sub_site, uplink) the events are sorted by time, then each
// `down` is paired with the NEXT `up` after it (restored_end = that up's time).
// A trailing `down` with no following `up` → restored_end null (still open).
// An `up` with no open `down` is ignored. Tolerates out-of-order input.
function pairEvents(events = []) {
  const groups = new Map();
  for (const ev of events) {
    if (!ev) continue;
    const dir = _eventDirection(ev.type);
    if (!dir) continue;
    const key = `${ev.site_id} ${ev.sub_site} ${ev.uplink}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ev, dir, ms: _toMs(ev.occurredAt) });
  }
  const outages = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.ms - b.ms);
    let open = null;   // the currently-open `down` event, or null
    for (const { ev, dir } of list) {
      if (dir === 'down') {
        if (open == null) open = ev;   // first down wins until an up closes it
      } else if (open != null) {       // up closes the open down
        outages.push({
          site_id: open.site_id,
          sub_site: open.sub_site,
          uplink: open.uplink,
          detected_start: open.occurredAt,
          restored_end: ev.occurredAt,
        });
        open = null;
      }
      // else: orphan up → ignored
    }
    if (open != null) {
      outages.push({
        site_id: open.site_id,
        sub_site: open.sub_site,
        uplink: open.uplink,
        detected_start: open.occurredAt,
        restored_end: null,   // still open
      });
    }
  }
  return outages;
}

// Intersection of two [start,end] ms spans, in minutes (0 if disjoint/touching).
// An open span (end === Infinity) overlaps anything after its start.
function _intersectMinutes(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return e > s ? (e - s) / 60000 : 0;
}

// Assign attribution to each outage. Pure — returns a NEW array, inputs untouched.
//   'site'        — overlaps (≥ overlapMinutes) a DIFFERENT uplink outage at the
//                   same (site_id, sub_site). Open outages (restored_end null)
//                   are treated as running forever from their start.
//   'maintenance' — the outage window intersects a maintenance entry for its
//                   site_id (and uplink, if the entry specifies one).
//   'isp'         — everything else (attributable to the ISP circuit).
function attributeOutages(outages = [], { overlapMinutes = 0, maintenance = [] } = {}) {
  const spans = outages.map((o) => ({
    start: _toMs(o.detected_start),
    end: o.restored_end != null ? _toMs(o.restored_end) : Infinity,
  }));
  return outages.map((o, i) => {
    const a = spans[i];

    // 1. cross-uplink simultaneity at the same site/sub_site.
    let otherUplink = null;
    for (let j = 0; j < outages.length; j += 1) {
      if (j === i) continue;
      const b = outages[j];
      if (b.site_id !== o.site_id || b.sub_site !== o.sub_site) continue;
      if (b.uplink === o.uplink) continue;
      const inter = _intersectMinutes(a.start, a.end, spans[j].start, spans[j].end);
      if (inter > 0 && inter >= overlapMinutes) { otherUplink = b.uplink; break; }
    }

    let attribution;
    let attribution_reason;
    if (otherUplink != null) {
      attribution = 'site';
      attribution_reason = `${o.uplink}+${otherUplink} simultaneous (site/power)`;
    } else if (_intersectsMaintenance(o, a, maintenance)) {
      attribution = 'maintenance';
      attribution_reason = 'maintenance window';
    } else {
      attribution = 'isp';
      attribution_reason = 'attributable to ISP circuit';
    }
    return { ...o, attribution, attribution_reason };
  });
}

// True if outage span `a` intersects a maintenance entry matching the outage's
// site_id (and uplink, when the entry pins one).
function _intersectsMaintenance(o, a, maintenance) {
  for (const m of maintenance || []) {
    if (!m || m.site_id !== o.site_id) continue;
    if (m.uplink && m.uplink !== o.uplink) continue;
    const ms = _toMs(m.from);
    const me = _toMs(m.to);
    if (a.end > ms && me > a.start) return true;
  }
  return false;
}

// Plain 24/7 availability over a window from the poller's outage log — the FAITHFUL
// availability for WAN Health / the report (Meraki's uplink status, event-based), as
// opposed to the disqualified loss-derived snapshot. Counts EVERY outage (any attribution:
// this is raw uplink availability, not the ISP-chargeback figure). Each outage is clamped to
// [fromMs,toMs]; an open outage (restored_end null) runs to toMs. null if the window is empty.
function availability24x7(outages, fromMs, toMs) {
  const win = toMs - fromMs;
  if (!(win > 0)) return null;
  let down = 0;
  for (const o of (outages || [])) {
    if (!o) continue;
    const s = _toMs(o.detected_start);
    if (s == null) continue;
    const e = o.restored_end == null ? toMs : _toMs(o.restored_end);
    const cs = Math.max(s, fromMs), ce = Math.min(e == null ? toMs : e, toMs);
    if (ce > cs) down += (ce - cs);
  }
  return round2(100 * (1 - down / win));
}

module.exports = {
  serviceSecondsBetween,
  clipToService,
  computeCircuitSla,
  availability24x7,
  resolutionBreaches,
  pairEvents,
  attributeOutages,
  hmToMinutes,
  utcMidnight,
};
