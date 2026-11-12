'use strict';
// E-K04 (audit K-07, K-08) — deterministic description of a change between two windows. PURE, no I/O, no AI.
//
//   explainCount({ parts })  additive count metric: the delta and each part's (site's) contribution to it, sorted by
//                            size, with the count on both sides. Σ contributions = delta, over the parts measured on
//                            BOTH sides; a part missing a side is listed as UNKNOWN and left out of the sum.
//   explainRatio({ a, b })   a ratio (%) is NOT explained: only its numerator and denominator changes are stated,
//                            each null (UNKNOWN) when the reader does not return it.
//   dataNote(x)              one short sentence citing the figures, ending "measured change — no cause asserted",
//                            labelled as data-generated (kind 'data_note') — never an editorial field.
// null = UNKNOWN everywhere: never 0, never a colour.

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const NO_CAUSE = 'measured change — no cause asserted';

/** parts: [{ key, label, a, b }] — counts of one part in window a and window b. */
function explainCount({ metric = null, a = null, b = null, parts = [] } = {}) {
  const rows = (parts || []).map((p) => ({ key: p.key, label: p.label == null ? String(p.key) : String(p.label), a: num(p.a), b: num(p.b) }));
  const known = rows.filter((p) => p.a != null && p.b != null);
  const unknown = rows.filter((p) => !(p.a != null && p.b != null)).map((p) => ({ key: p.key, label: p.label, a: p.a, b: p.b, state: 'UNKNOWN' }));
  if (!known.length) return { metric, kind: 'count', a, b, state: 'UNKNOWN', total_a: null, total_b: null, delta: null, contributions: [], unknown_parts: unknown };
  const totalA = known.reduce((s, p) => s + p.a, 0), totalB = known.reduce((s, p) => s + p.b, 0), delta = totalB - totalA;
  const contributions = known.map((p) => ({ key: p.key, label: p.label, a: p.a, b: p.b, delta: p.b - p.a, share_pct: delta === 0 ? null : r1(100 * (p.b - p.a) / delta) }))
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || String(x.label).localeCompare(String(y.label)));
  return { metric, kind: 'count', a, b, state: unknown.length ? 'PARTIAL' : 'OK', total_a: totalA, total_b: totalB, delta, contributions, unknown_parts: unknown };
}

/** a / b = { value, num, den } of a ratio in each window. */
function explainRatio({ metric = null, a = null, b = null, sideA = {}, sideB = {} } = {}) {
  const A = { value: num(sideA.value), num: num(sideA.num), den: num(sideA.den) }, B = { value: num(sideB.value), num: num(sideB.num), den: num(sideB.den) };
  const d = (x, y) => (x == null || y == null ? null : r1(y - x));
  const state = A.value == null || B.value == null ? 'UNKNOWN' : 'OK';
  return { metric, kind: 'ratio', a, b, state, value_a: A.value, value_b: B.value, delta_pts: d(A.value, B.value),
    numerator: { a: A.num, b: B.num, delta: d(A.num, B.num) }, denominator: { a: A.den, b: B.den, delta: d(A.den, B.den) },
    note: 'a ratio is decomposed into its numerator and denominator changes, never explained' };
}

const fmt = (v) => (v == null ? 'unknown' : Number(v).toLocaleString('en-GB', { maximumFractionDigits: 1 }));
const signed = (v) => (v == null ? 'unknown' : (v > 0 ? '+' : '') + fmt(v));

/** One sentence citing the figures. { kind:'data_note', generated:'data', text }. */
function dataNote(x, name) {
  const n = name || (x && x.metric) || 'figure';
  let text;
  if (!x || x.state === 'UNKNOWN') text = `${n}: not measured on both windows${x && x.a && x.b ? ` (${x.a} → ${x.b})` : ''} — ${NO_CAUSE}.`;
  else if (x.kind === 'count') {
    const top = x.contributions.find((c) => c.delta !== 0);
    text = `${n}: ${fmt(x.total_a)} → ${fmt(x.total_b)} (${signed(x.delta)}) between ${x.a} and ${x.b}` +
      (top && x.contributions.length > 1 ? `; largest contribution ${top.label} ${signed(top.delta)}` : '') +
      (x.unknown_parts.length ? `; ${x.unknown_parts.length} part(s) not measured on both windows, left out` : '') + ` — ${NO_CAUSE}.`;
  } else {
    text = `${n}: ${fmt(x.value_a)} → ${fmt(x.value_b)} (${signed(x.delta_pts)} pts) between ${x.a} and ${x.b}; numerator ${signed(x.numerator.delta)}, denominator ${signed(x.denominator.delta)} — ${NO_CAUSE}.`;
  }
  return { kind: 'data_note', generated: 'data', text };
}

module.exports = { explainCount, explainRatio, dataNote, NO_CAUSE };
