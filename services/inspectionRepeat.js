'use strict';
// E-I06 (audit I-06, catalogue R06) — repeat findings. Pure: no DB, no clock.
//
// A repeat finding = the same site × item_code rated minor / major / critical in at least TWO of that site's last N
// submitted (or closed) inspections. N comes from report_config `insp_repeat_window` (empty / invalid = feature off —
// no window invented). Status vocabulary unchanged: ok · minor · major · critical · opp · na.

const BAD = new Set(['minor', 'major', 'critical']);
const RANK = { minor: 1, major: 2, critical: 3 };

/** report_config value → N (2..50), or null = off. */
function parseWindow(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 2 ? Math.min(n, 50) : null;
}

/**
 * @param rows  one row per finding: { site_code, inspection_id, inspection_date, item_code, item_text_en, status }
 * @param n     parsed window (null = off)
 * @returns { enabled, n, sites: { [site]: { inspections: [ids], repeats: [{ item_code, item_text, hits, of, worst, inspections:[…] }] } } }
 */
function computeRepeatFindings(rows, n) {
  if (n == null) return { enabled: false, n: null, sites: {} };
  const bySite = new Map();
  for (const r of rows || []) {
    if (!r || !r.site_code || !r.inspection_id) continue;
    let s = bySite.get(r.site_code); if (!s) { s = new Map(); bySite.set(r.site_code, s); }
    let i = s.get(r.inspection_id); if (!i) { i = { id: r.inspection_id, date: String(r.inspection_date || ''), findings: [] }; s.set(r.inspection_id, i); }
    i.findings.push(r);
  }
  const sites = {};
  for (const [site, insp] of bySite) {
    const last = [...insp.values()].sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id))).slice(0, n);
    const items = new Map();
    for (const i of last) {
      const seen = new Set();
      for (const f of i.findings) {
        const st = String(f.status || '').toLowerCase();
        if (!BAD.has(st) || !f.item_code || seen.has(f.item_code)) continue;
        seen.add(f.item_code);
        let it = items.get(f.item_code); if (!it) { it = { item_code: f.item_code, item_text: f.item_text_en || null, hits: 0, worst: st, inspections: [] }; items.set(f.item_code, it); }
        it.hits++; it.inspections.push({ id: i.id, date: i.date || null, status: st });
        if (RANK[st] > RANK[it.worst]) it.worst = st;
      }
    }
    const repeats = [...items.values()].filter((x) => x.hits >= 2).map((x) => ({ ...x, of: last.length }))
      .sort((a, b) => (b.hits - a.hits) || (RANK[b.worst] - RANK[a.worst]) || a.item_code.localeCompare(b.item_code));
    sites[site] = { inspections: last.map((i) => i.id), repeats };
  }
  return { enabled: true, n, sites };
}

/** Does this action need an independent verification once closed (switch on)? Critical / High only. */
const needsVerification = (a) => /^(critical|high)$/i.test(String((a && a.priority) || ''));
/** Display state with the switch on: 'awaiting_verification' | 'verified' | null. */
function verificationState(a) {
  if (!a || !needsVerification(a) || String(a.status) !== 'Closed') return null;
  return a.verified_at ? 'verified' : 'awaiting_verification';
}

module.exports = { parseWindow, computeRepeatFindings, needsVerification, verificationState };
