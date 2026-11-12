'use strict';
// A0 — diff two authorisation matrices (docs/ops/authz-matrix.json, schema sdp360.authz-matrix/1) and print every
// added, removed and changed rule. Used per release: compare the matrix of the last released tag with the new one.
//
//   node tools/agent/authz-diff.js <old.json> <new.json>            → human-readable report, exit 0
//   node tools/agent/authz-diff.js <old.json> <new.json> --json     → JSON report
//   node tools/agent/authz-diff.js <old.json> <new.json> --fail-on-change   → exit 1 when anything changed
//   git show v2.3.0:docs/ops/authz-matrix.json > /tmp/old.json && node tools/agent/authz-diff.js /tmp/old.json docs/ops/authz-matrix.json
//
// PURE core (diffMatrix) is exported for tests/authz-matrix-json.test.js.

// The fields of a route row that make up its authorisation rule (what a reviewer must sign off).
const RULE_FIELDS = ['gate', 'guards', 'capabilities', 'allowed_roles', 'inline_roles', 'site_scope', 'site_scoped', 'money_bearing', 'business_allowed'];

const _j = (v) => JSON.stringify(v === undefined ? null : v);

function _index(m) {
  const out = new Map();
  for (const r of (m && m.routes) || []) out.set(r.key, r);
  return out;
}

/** {added:[{key,row}], removed:[{key,row}], changed:[{key, fields:[{field, before, after, gained?, lost?}]}], capabilities:{added,removed,changed}} */
function diffMatrix(oldM, newM) {
  const a = _index(oldM), b = _index(newM);
  const added = [], removed = [], changed = [];
  for (const [k, row] of b) if (!a.has(k)) added.push({ key: k, row });
  for (const [k, row] of a) if (!b.has(k)) removed.push({ key: k, row });
  for (const [k, nb] of b) {
    const ob = a.get(k);
    if (!ob) continue;
    const fields = [];
    for (const f of RULE_FIELDS) {
      if (_j(ob[f]) === _j(nb[f])) continue;
      const d = { field: f, before: ob[f], after: nb[f] };
      if (Array.isArray(ob[f]) && Array.isArray(nb[f]) && ob[f].every((x) => typeof x === 'string') && nb[f].every((x) => typeof x === 'string')) {
        d.gained = nb[f].filter((x) => !ob[f].includes(x));
        d.lost = ob[f].filter((x) => !nb[f].includes(x));
      }
      fields.push(d);
    }
    if (fields.length) changed.push({ key: k, fields });
  }
  const ca = new Map(((oldM && oldM.capabilities) || []).map((c) => [c.id, c]));
  const cb = new Map(((newM && newM.capabilities) || []).map((c) => [c.id, c]));
  const capabilities = {
    added: [...cb.keys()].filter((id) => !ca.has(id)),
    removed: [...ca.keys()].filter((id) => !cb.has(id)),
    changed: [...cb.keys()].filter((id) => ca.has(id) && _j(ca.get(id)) !== _j(cb.get(id))),
  };
  return { added, removed, changed, capabilities, total: added.length + removed.length + changed.length + capabilities.added.length + capabilities.removed.length + capabilities.changed.length };
}

/** Rule changes that WIDEN access (a role gained, a guard or scope removed, a route made public) — the ones to review first. */
function widenings(diff) {
  const out = [];
  for (const a of diff.added) out.push(`${a.key}: new route (gate ${a.row.gate}, roles ${(a.row.allowed_roles || []).length})`);
  for (const c of diff.changed) for (const f of c.fields) {
    if (f.field === 'allowed_roles' && f.gained && f.gained.length) out.push(`${c.key}: roles gained ${f.gained.join(', ')}`);
    if (f.field === 'site_scope' && f.lost && f.lost.length) out.push(`${c.key}: site-scope helper removed ${f.lost.join(', ')}`);
    if (f.field === 'site_scoped' && f.before === true && f.after === false) out.push(`${c.key}: no longer site-scoped`);
    if (f.field === 'money_bearing' && f.before === true && f.after === false) out.push(`${c.key}: no longer marked amount-bearing`);
    if (f.field === 'gate' && f.after === 'public') out.push(`${c.key}: became public`);
    if (f.field === 'guards' && (f.after || []).length < (f.before || []).length) out.push(`${c.key}: guard removed`);
    if (f.field === 'business_allowed' && f.after === true) out.push(`${c.key}: opened to business-only accounts`);
  }
  return out;
}

function format(diff) {
  const L = [];
  L.push(`authz matrix diff — ${diff.added.length} added · ${diff.removed.length} removed · ${diff.changed.length} changed route(s)` +
    ` · capabilities +${diff.capabilities.added.length} -${diff.capabilities.removed.length} ~${diff.capabilities.changed.length}`);
  const w = widenings(diff);
  if (w.length) { L.push('', 'ACCESS WIDENED (review first):'); for (const x of w) L.push('  ! ' + x); }
  if (diff.added.length) { L.push('', 'ADDED:'); for (const a of diff.added) L.push(`  + ${a.key}  gate=${a.row.gate}  guards=${(a.row.guards || []).map((g) => g.name).join(' + ') || '-'}`); }
  if (diff.removed.length) { L.push('', 'REMOVED:'); for (const r of diff.removed) L.push(`  - ${r.key}`); }
  if (diff.changed.length) {
    L.push('', 'CHANGED:');
    for (const c of diff.changed) {
      L.push(`  ~ ${c.key}`);
      for (const f of c.fields) {
        if (f.gained || f.lost) L.push(`      ${f.field}: ${f.gained.length ? '+' + f.gained.join(' +') : ''}${f.gained.length && f.lost.length ? ' ' : ''}${f.lost.length ? '-' + f.lost.join(' -') : ''}`);
        else L.push(`      ${f.field}: ${_j(f.before)} → ${_j(f.after)}`);
      }
    }
  }
  for (const k of ['added', 'removed', 'changed']) if (diff.capabilities[k].length) L.push(`capabilities ${k}: ${diff.capabilities[k].join(', ')}`);
  return L.join('\n') + '\n';
}

if (require.main === module) {
  const fs = require('fs');
  const [oldP, newP] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!oldP || !newP) { process.stderr.write('usage: node tools/agent/authz-diff.js <old.json> <new.json> [--json] [--fail-on-change]\n'); process.exit(2); }
  const d = diffMatrix(JSON.parse(fs.readFileSync(oldP, 'utf8')), JSON.parse(fs.readFileSync(newP, 'utf8')));
  process.stdout.write(process.argv.includes('--json') ? JSON.stringify(d, null, 1) + '\n' : format(d),
    () => process.exit(process.argv.includes('--fail-on-change') && d.total ? 1 : 0));
}

module.exports = { RULE_FIELDS, diffMatrix, widenings, format };
