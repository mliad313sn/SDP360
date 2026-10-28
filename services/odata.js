'use strict';
// Step 9 — PURE OData v4 (minimal, read-only) shaping for the metrics feed Power BI consumes:
// service document, $metadata (CSDL XML), entity set with $filter (eq/and on a few fields), $top,
// $skip, $orderby, $select. The data itself comes from the caller (registry readings).

const NS = 'Sdp360.Metrics';
const ENTITIES = {
  Metrics: { key: 'Key', props: { Key: 'Edm.String', Name: 'Edm.String', Module: 'Edm.String', Unit: 'Edm.String', WindowKind: 'Edm.String', HigherIsBetter: 'Edm.Boolean', Formula: 'Edm.String' } },
  Values: { key: 'Id', props: { Id: 'Edm.String', Metric: 'Edm.String', SiteId: 'Edm.Int32', Site: 'Edm.String', Window: 'Edm.String', Value: 'Edm.Double', Unit: 'Edm.String', Rag: 'Edm.String', AsOf: 'Edm.DateTimeOffset', Freshness: 'Edm.String', Authoritative: 'Edm.Boolean' } },
  Sites: { key: 'Id', props: { Id: 'Edm.Int32', Name: 'Edm.String', Country: 'Edm.String', Active: 'Edm.Boolean' } },
};

function serviceDocument(base) { return { '@odata.context': `${base}/$metadata`, value: Object.keys(ENTITIES).map(n => ({ name: n, kind: 'EntitySet', url: n })) }; }

function metadataXml() {
  const types = Object.entries(ENTITIES).map(([n, e]) => `<EntityType Name="${n.replace(/s$/, '')}"><Key><PropertyRef Name="${e.key}"/></Key>${Object.entries(e.props).map(([p, t]) => `<Property Name="${p}" Type="${t}"${p === e.key ? ' Nullable="false"' : ''}/>`).join('')}</EntityType>`).join('');
  const sets = Object.keys(ENTITIES).map(n => `<EntitySet Name="${n}" EntityType="${NS}.${n.replace(/s$/, '')}"/>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?><edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices><Schema Namespace="${NS}" xmlns="http://docs.oasis-open.org/odata/ns/edm">${types}<EntityContainer Name="Container">${sets}</EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;
}

// Fiche M7 — every property named in $filter / $orderby / $select is checked against the entity's
// declared props. A free property name would otherwise read the row's prototype (`__proto__`,
// `constructor`) or sort by an attribute that does not exist; both are 400, never a silent match.
const FORBIDDEN_PROPS = new Set(['__proto__', 'constructor', 'prototype']);
const invalid = (msg) => Object.assign(new Error(msg), { code: 'INVALID' });
function assertProp(set, prop, where) {
  const name = String(prop || '').trim();
  if (!name || FORBIDDEN_PROPS.has(name) || !set || !Object.prototype.hasOwnProperty.call(ENTITIES[set] ? ENTITIES[set].props : {}, name)) throw invalid(`unknown property in ${where}: ${name.slice(0, 40)}`);
  return name;
}

/** Parse `$filter`: supports `Prop eq 'x'`, `Prop eq 1`, `Prop ne …`, `Prop gt|ge|lt|le n`, joined by `and`. Returns predicate.
 *  With `set` given, every property must belong to ENTITIES[set].props (400 otherwise). */
function parseFilter(expr, set = null) {
  if (!expr) return () => true;
  const parts = String(expr).split(/\s+and\s+/i).map(p => p.trim()).filter(Boolean);
  const tests = parts.map(p => {
    const m = p.match(/^(\w+)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/i); if (!m) throw invalid(`unsupported $filter: ${p.slice(0, 60)}`);
    const [, rawProp, op, rawv] = m; const prop = set ? assertProp(set, rawProp, '$filter') : rawProp; if (FORBIDDEN_PROPS.has(prop)) throw invalid('unknown property in $filter');
    const v = /^'.*'$/.test(rawv) ? rawv.slice(1, -1).replace(/''/g, "'") : rawv === 'true' ? true : rawv === 'false' ? false : rawv === 'null' ? null : Number(rawv);
    return (row) => { const x = Object.prototype.hasOwnProperty.call(row, prop) ? row[prop] : undefined; switch (op.toLowerCase()) { case 'eq': return x == v; case 'ne': return x != v; default: if (x == null || v == null) return false; } switch (op.toLowerCase()) { case 'gt': return x > v; case 'ge': return x >= v; case 'lt': return x < v; case 'le': return x <= v; default: return false; } };
  });
  return (row) => tests.every(t => t(row));
}

/** Apply the query options to rows → OData response body. */
function collection(base, set, rows, q = {}) {
  if (!ENTITIES[set]) throw Object.assign(new Error('unknown entity set'), { code: 'NOT_FOUND' });
  let out = rows.filter(parseFilter(q.$filter, set));
  if (q.$orderby) { const [rawProp, dir] = String(q.$orderby).trim().split(/\s+/); const prop = assertProp(set, rawProp, '$orderby'); if (dir && !/^(asc|desc)$/i.test(dir)) throw invalid('unsupported $orderby direction'); out = out.slice().sort((a, b) => (a[prop] > b[prop] ? 1 : a[prop] < b[prop] ? -1 : 0) * (String(dir).toLowerCase() === 'desc' ? -1 : 1)); }
  const total = out.length;
  const skip = Math.max(0, Number(q.$skip) || 0); const top = Math.min(5000, Math.max(1, Number(q.$top) || 5000));
  out = out.slice(skip, skip + top);
  if (q.$select) { const keep = String(q.$select).split(',').map(s => assertProp(set, s, '$select')); out = out.map(r => Object.fromEntries(keep.filter(k => k in r).map(k => [k, r[k]]))); }
  const body = { '@odata.context': `${base}/$metadata#${set}`, value: out };
  if (String(q.$count) === 'true') body['@odata.count'] = total;
  return body;
}

module.exports = { ENTITIES, NS, FORBIDDEN_PROPS, serviceDocument, metadataXml, parseFilter, assertProp, collection };
