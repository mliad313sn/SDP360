'use strict';
// Step 9 — a minimal OData v4 feed for Power BI ("OData feed" connector): service document, $metadata, and two
// entity sets — Metrics (the dictionary keys published) and MetricValues (the nightly snapshot). Supported query
// options: $filter with `eq` on MetricKey / Scope / Month, `ge` / `le` on Month, joined by `and`; $top, $skip;
// server-driven paging (@odata.nextLink). Anything else answers an OData error, never a guess.

const PAGE = 5000;

function metadata() {
  return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="Sdp" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="Metric">
        <Key><PropertyRef Name="Key"/></Key>
        <Property Name="Key" Type="Edm.String" Nullable="false"/>
        <Property Name="Label" Type="Edm.String"/>
        <Property Name="Unit" Type="Edm.String"/>
        <Property Name="Domain" Type="Edm.String"/>
        <Property Name="Direction" Type="Edm.String"/>
      </EntityType>
      <EntityType Name="MetricValue">
        <Key><PropertyRef Name="MetricKey"/><PropertyRef Name="Scope"/><PropertyRef Name="Month"/></Key>
        <Property Name="MetricKey" Type="Edm.String" Nullable="false"/>
        <Property Name="Scope" Type="Edm.String" Nullable="false"/>
        <Property Name="Month" Type="Edm.String" Nullable="false"/>
        <Property Name="MonthStart" Type="Edm.Date"/>
        <Property Name="Value" Type="Edm.Double"/>
        <Property Name="Unit" Type="Edm.String"/>
        <Property Name="Rag" Type="Edm.String"/>
        <Property Name="ComputedAt" Type="Edm.DateTimeOffset"/>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Metrics" EntityType="Sdp.Metric"/>
        <EntitySet Name="MetricValues" EntityType="Sdp.MetricValue"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;
}

/** Parse a $filter into { key, scope, from, to }; throws on anything unsupported. */
function parseFilter(f) {
  const out = {};
  if (!f) return out;
  const parts = String(f).split(/\s+and\s+/i);
  for (const p of parts) {
    const m = p.trim().match(/^(MetricKey|Scope|Month)\s+(eq|ge|le)\s+'([^']{1,80})'$/);
    if (!m) throw new Error(`unsupported $filter clause: ${p.trim().slice(0, 80)}`);
    const [, field, op, v] = m;
    if (field === 'MetricKey' && op === 'eq') out.key = v;
    else if (field === 'Scope' && op === 'eq') out.scope = v.toUpperCase();
    else if (field === 'Month' && /^\d{4}-\d{2}$/.test(v)) { if (op === 'eq') { out.from = v; out.to = v; } else if (op === 'ge') out.from = v; else out.to = v; }
    else throw new Error(`unsupported $filter clause: ${p.trim().slice(0, 80)}`);
  }
  return out;
}

const valueRow = (r) => ({ MetricKey: r.metric_key, Scope: r.scope, Month: r.month, MonthStart: r.month + '-01', Value: r.value == null ? null : Number(r.value),
  Unit: r.unit || null, Rag: r.rag || null, ComputedAt: r.computed_at });

module.exports = { metadata, parseFilter, valueRow, PAGE };
