'use strict';
// F-PRODUCT-05 (committee 12 Nov 2026, finding N9) — department crosswalk: PURE.
//
// Two department vocabularies live side by side: md_departments.code (meetings / PV issues, 15 codes) and
// action_departments.name (report actions, handoffs, 10 names); commitments.department is free text. This module
// reads the crosswalk (migration 082) and answers three questions without touching a stored label:
//   • proposeExactPairs(md, action)  which pairs are the SAME label on both sides (the only pairs ever proposed)
//   • rollup(items, index)           counts per crosswalked department; anything else goes to "unmapped", listed
//                                    value by value and NEVER merged with a look-alike (Process / Mill / Processing)
//   • check(values, index)           the values found in data that the crosswalk does not map
// No DB, no clock. A missing department (null / blank) is "not set" — it is not "unmapped" and not 0.

const UNMAPPED = 'unmapped';
const NOT_SET = 'not_set';

/** Comparison key of a label: case, accents, punctuation and underscores folded. Nothing is stemmed or shortened. */
function norm(v) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-/]+/g, ' ').replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Pairs whose label is identical on both sides (after norm): the action name equals the meeting code or its English name.
 * "Processing" ≠ "Process", "Human Resource" ≠ "HR": those are left for people.
 * @param {{code:string,name_en?:string}[]} md   @param {{name:string}[]|string[]} action
 */
function proposeExactPairs(md, action) {
  const names = (action || []).map((a) => (typeof a === 'string' ? a : a && a.name)).filter(Boolean);
  const out = [];
  for (const d of md || []) {
    if (!d || !d.code) continue;
    const keys = new Set([norm(d.code), norm(d.name_en)].filter(Boolean));
    const hit = names.filter((n) => keys.has(norm(n)));
    if (hit.length === 1) out.push({ md_code: d.code, action_department_name: hit[0], status: 'proposed' });
  }
  return out;
}

/**
 * Index of the crosswalk rows. Only a row carrying BOTH sides maps anything; a one-sided row is a known,
 * unmapped value. opts.approvedOnly = true ignores 'proposed' pairs.
 * @param {{md_code:?string,action_department_name:?string,status:string}[]} rows
 * @param {{mdNames?:Object<string,string>,approvedOnly?:boolean}} [opts] mdNames = { code: English name }
 */
function makeIndex(rows, { mdNames = {}, approvedOnly = false } = {}) {
  const byKey = new Map(); const groups = new Map(); const known = new Set();
  for (const r of rows || []) {
    if (!r) continue;
    const paired = r.md_code && r.action_department_name && r.status !== UNMAPPED && (!approvedOnly || r.status === 'approved');
    const labels = [r.md_code, r.md_code ? mdNames[r.md_code] : null, r.action_department_name].filter(Boolean);
    for (const l of labels) known.add(norm(l));
    if (!paired) continue;
    groups.set(r.md_code, { key: r.md_code, label: mdNames[r.md_code] || r.action_department_name, status: r.status });
    for (const l of labels) byKey.set(norm(l), r.md_code);
  }
  return { byKey, groups, known };
}

/** Where a stored label lands: a crosswalked department, "unmapped" (value kept), or "not set". */
function resolve(index, label) {
  const k = norm(label);
  if (!k) return { key: NOT_SET, mapped: false, raw: null };
  const hit = index.byKey.get(k);
  if (hit) return { key: hit, mapped: true, raw: String(label) };
  return { key: UNMAPPED, mapped: false, raw: String(label).trim(), known: index.known.has(k) };
}

const _n = (v) => (Number.isFinite(Number(v)) && v != null ? Number(v) : 1);

/**
 * @param {{source:string,department:?string,n?:number}[]} items  one row per record, or per (source, value) with n
 * @returns {{groups:Array,unmapped:{total:number,values:Array},not_set:{total:number,by_source:Object},total:number}}
 */
function rollup(items, index) {
  const groups = new Map(); const un = new Map(); const notSet = { total: 0, by_source: {} }; let total = 0;
  const bump = (o, src, n) => { o.total += n; o.by_source[src] = (o.by_source[src] || 0) + n; };
  for (const it of items || []) {
    if (!it) continue;
    const n = _n(it.n); const src = String(it.source || 'unknown'); total += n;
    const r = resolve(index, it.department);
    if (r.key === NOT_SET) { bump(notSet, src, n); continue; }
    if (r.mapped) {
      if (!groups.has(r.key)) groups.set(r.key, { ...index.groups.get(r.key), total: 0, by_source: {} });
      bump(groups.get(r.key), src, n); continue;
    }
    // unmapped: one line per distinct stored value — two different labels are never added together
    if (!un.has(r.raw)) un.set(r.raw, { value: r.raw, known: !!r.known, total: 0, by_source: {} });
    bump(un.get(r.raw), src, n);
  }
  const values = [...un.values()].sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));
  return {
    groups: [...groups.values()].sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key))),
    unmapped: { key: UNMAPPED, total: values.reduce((s, v) => s + v.total, 0), values },
    not_set: notSet, total,
  };
}

/** Values found in data that the crosswalk does not map (for the --check tool). `known` = listed, but alone. */
function check(values, index) {
  const r = rollup(values, index);
  return { total: r.total, mapped: r.groups.reduce((s, g) => s + g.total, 0), not_set: r.not_set.total, unmapped_total: r.unmapped.total, unmapped: r.unmapped.values };
}

module.exports = { UNMAPPED, NOT_SET, norm, proposeExactPairs, makeIndex, resolve, rollup, check };
