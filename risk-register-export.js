/**
 * risk-register-export.js — Risk Register Occurrence Export
 *
 * Pure-additive feature per Risk_Register_Export_Spec.md (2026-05-28).
 * Reads from local SQLite (`request_records`), classifies tickets into
 * 5 risk domains, aggregates per Site × Domain, and writes an .xlsx
 * sheet matching the Risk Register's monthly layout.
 *
 * 2026-05-29 — switched from `exceljs` to `xlsx` (SheetJS CE) per a
 * security-first review. `xlsx` was already installed on prod for the
 * meetings-import module (~7 MB pure JS, 0 transitive deps to chase).
 * The exceljs install brought 80 new packages + 4 npm-audit findings
 * (3 moderate, 1 high) for no functional benefit — the data shape we
 * emit is identical, only the styling depth differs.
 *
 * Trade-off acknowledged: SheetJS CE writes data + column widths +
 * frozen pane + date format, but DROPS cell fill colors / fonts /
 * borders on write (Pro-only feature). The output is a functional
 * .xlsx with correct values; users wanting the colored header bands
 * can apply them once via Excel's "Format as Table" since the layout
 * is stable month-to-month.
 *
 * Constraints honoured from the original spec:
 *   - Purely additive — no existing functions/routes/variables modified
 *   - Read-only — only SELECT queries against request_records
 *   - Uses local DB (per 2026-05-27 audit: helpdesk page is DB-only)
 *   - Skips Inspection category (avoids double-counting audit findings)
 *   - First-match-wins classification (spec section 4)
 *   - Counts both 'Incident' AND 'Major Incident' request types
 *   - Filters to operational Impact scope (Enterprise / Single dept /
 *     Multiple dept) — excludes Individual per 2026-05-28 refinement
 */
'use strict';

const XLSX = require('xlsx');

// ─── Domain classification (spec §4) ──────────────────────────────────
// Order matters — first match wins. Inspection category is hard-blocked
// at the top of classify() to avoid double-counting audit findings as
// incidents.
const DOMAIN_RULES = [
  {
    domain: '1.Unavailability of Internet',
    matches: [
      { cat: 'Network & Internet Access', sub: 'Network issues' },
      { cat: 'Network',                   sub: 'WAN' },
    ],
  },
  {
    domain: '2.Unavailability of the mobile phone',
    matches: [
      { cat: 'Mobile & Communication Services', sub: '3G/4G Internet & GSM-SIM' },
    ],
  },
  {
    domain: '3.Unavailability of electrical power',
    matches: [
      // ⚠ Confirm exact subcategory name with the team — may need to be created in SDP
      { cat: 'IT Infrastructure', sub: 'Power & UPS' },
    ],
  },
  {
    domain: '4.Infrastructure unavailability (FW, files, data, mail, etc.)',
    matches: [
      { cat: 'IT Infrastructure',         sub: 'Servers' },
      { cat: 'IT Infrastructure',         sub: 'Data Centers' },
      { cat: 'IT Infrastructure',         sub: 'Network' },
      { cat: 'IT Infrastructure',         sub: 'Backup' },
      { cat: 'IT Infrastructure',         sub: 'Database' },
      { cat: 'IT Infrastructure',         sub: 'Cloud Services' },
      { cat: 'Enterprise Applications',   sub: 'System' },
      { cat: 'Enterprise Applications',   sub: 'Technical' },
      { cat: 'Email',                     sub: 'Issue with Email' },
      { cat: 'Network & Internet Access', sub: 'Network Configuration' },
      { cat: 'Network & Internet Access', sub: 'VPN (Remote Access Services)' },
    ],
  },
  {
    domain: '5.Radio system unavailability',
    matches: [
      // ⚠ Confirm exact subcategory name with the team — may need to be created in SDP
      { cat: 'Network & Internet Access', sub: 'Radio / Telecom' },
    ],
  },
];

// ─── Impact scope filter (2026-05-28 refinement, 2026-05-30 tuned) ───
// The Risk Register tracks OPERATIONAL risk — incidents that affect a
// department, multiple departments, or the entire enterprise. An
// individual user's "I can't access my mailbox" is NOT a risk register
// event, even if its category/sub-category would otherwise match a
// domain rule.
//
// 2026-05-30 tuning: the Impact field was only added to SDP recently.
// ~91% of historical tickets (228 of 251 May 2026 incidents) carry
// NULL impact — they predate the field's introduction. Strict
// VALID_IMPACTS filtering shows ZERO occurrences for historical
// months, which makes the report useless until backfill catches up.
//
// Rule shipped instead: treat NULL impact as in-scope (count it),
// because a NULL means "field not populated", not "individual scope".
// Continue to EXCLUDE explicit 'Individual' — that's the user's
// concern from 2026-05-28 (individual user-level issues aren't
// risk-register material). Diagnostics surface the null count so
// the operator can see how much of the data is impact-uncertain.
const EXCLUDED_IMPACTS = new Set([
  'Individual',
]);

// Pure function. Takes a record row with flat string fields:
//   { category, sub_category, request_type, site, impact }
// Returns the matched domain label, or null when unclassified.
// Reasons for null (in order of check):
//   1. Inspection category — audit records, not incidents
//   2. Impact in EXCLUDED_IMPACTS (currently just 'Individual')
//   3. No (category, sub-category) rule matched any of the 5 domains
function classifyIncident(rec) {
  const cat = String(rec.category     || '').trim();
  const sub = String(rec.sub_category || '').trim();
  // (1) Inspection tickets are audit records — exclude per spec §4 note.
  if (cat === 'Inspection') return null;
  // (2) Operational scope — exclude only explicit 'Individual'. NULL
  // and other values are kept (NULL means "field unpopulated" for
  // historical tickets, not "individual").
  const impact = String(rec.impact || '').trim();
  if (EXCLUDED_IMPACTS.has(impact)) return null;
  // (3) Match against the 5 domain rules — first match wins.
  for (const rule of DOMAIN_RULES) {
    for (const m of rule.matches) {
      if (m.cat === cat && (m.sub == null || m.sub === sub)) {
        return rule.domain;
      }
    }
  }
  return null;
}

// ─── Static metadata per domain (spec §5) ─────────────────────────────
// Source + Actions text is per-domain boilerplate. Effecacite columns
// stay blank (spec says "Leave empty (0)").
const DOMAINS = [
  { label: '1.Unavailability of Internet',
    source:  "Problème d'énergie,panne d'équipements",
    actions: 'Liaison satelitaire' },
  { label: '2.Unavailability of the mobile phone',
    source:  "Problème d'énergie,panne d'équipements",
    actions: "Utilisation de l'application WhatApps et MS Teams pour communiquer" },
  { label: '3.Unavailability of electrical power',
    source:  "Panne des équipements ou interruption venant du fournisseur,arrêt pour maintenance",
    actions: 'GE,Utilisation des Onduleurs et une maintenance régulière de ceux-ci' },
  { label: '4.Infrastructure unavailability (FW, files, data, mail, etc.)',
    source:  "Problème d'énergie,des mises à jour,crash de serveurs…",
    actions: 'Les users travaillent en local en attendant le rétablissement du Datacenter' },
  { label: '5.Radio system unavailability',
    source:  "Problème d'énergie,panne d'équipements",
    actions: 'Communication radio via le mode simplex' },
];

// Spec §5 "Sites to output" — the canonical Risk Register site list.
// These are the LABELS that appear in column B of the export. The
// actual SDP `site` column carries the full mine / office name; the
// SITE_ALIASES map below translates them to these short codes before
// aggregation. Sites in this list with no incidents render as zeros.
const SITES = [
  'IGO', 'SGO', 'MASSAWA', 'HGO', 'KGO',
  'MGO', 'EXPLO', 'OUAGA OFF1', 'EMSA', 'SML',
];

// ─── Site name normalisation (2026-05-30, made configurable 2026-05-30) ─
// SDP populates `site` with the human-readable mine / office name.
// We translate those to the Risk Register's short codes. Anything not
// in this map is silently dropped as `skipped_unknown_site` and shows
// up in diagnostics — that includes corporate offices not on the
// register (LONDON, Dakar, ASSAFO) and one-off labels.
//
// The mapping is stored in SQLite (rr_site_aliases table, see
// _initConfigSchema below) so super_admins can edit it through the
// admin UI without a code deploy. The DEFAULT_SITE_ALIASES below seed
// the table on first init AND act as a fallback if the table is empty
// or unreachable for any reason (resilience).
//
// Mapping rationale (cross-checked against tracker codes + inspection
// module's siteAliases in CLAUDE.md + Endeavour's site list):
//   HOUNDE      → HGO  (Houndé Gold Operation, Burkina)
//   MANA        → MGO  (Mana Gold Operation, Burkina)
//   ITY         → IGO  (Ity Gold Operation, Côte d'Ivoire)
//   KALANA      → KGO  (Kalana Gold Operation, Mali)
//   Sabodala    → SGO  (Sabodala Gold Operation, Senegal)
//   LAFIGUE     → SML  (Lafigué — operates under SML legal entity)
//   Ouagadougou → OUAGA OFF1  (Ouaga corporate office)
//   Massawa     → MASSAWA  (case-normalise)
//   Fetekro Exploration Office, Exploration CI → EXPLO
//
// Edge cases observed in May 2026 data (251 rows):
//   LONDON, Dakar, ABIDJAN, ASSAFO  — corporate/regional offices not
//     on the Risk Register; skipped silently.
//   "LAFIGUE - SML"  — one-off label, normalised to SML.
const DEFAULT_SITE_ALIASES = Object.freeze({
  // Mines (gold operations)
  'HOUNDE':           'HGO',
  'MANA':             'MGO',
  'ITY':              'IGO',
  'KALANA':           'KGO',
  'Sabodala':         'SGO',
  'LAFIGUE':          'SML',
  'LAFIGUE - SML':    'SML',
  // Massawa development project (case-normalise)
  'Massawa':          'MASSAWA',
  'MASSAWA':          'MASSAWA',
  // Offices on the register
  'Ouagadougou':      'OUAGA OFF1',
  // Exploration aggregate
  'Fetekro Exploration Office': 'EXPLO',
  'Exploration CI':   'EXPLO',
  // EMSA — Endeavour Mining S.A.; no canonical SDP label observed yet,
  // left mappable when the field starts appearing
});

// ─── SQLite schema for the editable config ───────────────────────────
// Lazy: created on first call. Safe to call repeatedly (idempotent).
// We store the table in the same reports.db that holds request_records
// because the Risk Register is a derived view of that data — keeps
// related state in one DB. Alternative would be a separate
// risk-register.db; rejected to keep operational complexity low.
// Resolve the active DB handle (Chunk 4B-RR — mirrors services/groupPresets.js _h). Under
// REPORTS_BACKEND=postgres use reports-db's pg pool (lazy require — reports-db requires THIS module
// lazily in _seedConfigPg, so no load-time cycle); otherwise use the injected sqlite `db`.
function _h(db) {
  const rdb = require('./reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: db, isPg: false };
}

async function _initConfigSchema(db) {
  if (_h(db).isPg) return;   // pg: schema via 002_config.sql, seed via reports-db _seedConfigPg
  db.exec(`
    CREATE TABLE IF NOT EXISTS rr_site_aliases (
      sdp_label  TEXT PRIMARY KEY,
      code       TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT
    );
  `);
  // Seed if empty. Idempotent — re-running on a populated table is a
  // no-op (sqlite ignores inserts that violate the PK).
  const { c } = db.prepare('SELECT COUNT(*) c FROM rr_site_aliases').get();
  if (c === 0) {
    const ins = db.prepare(
      'INSERT INTO rr_site_aliases (sdp_label, code, updated_by) VALUES (?, ?, ?)'
    );
    const seed = db.transaction(() => {
      for (const [label, code] of Object.entries(DEFAULT_SITE_ALIASES)) {
        ins.run(label, code, '_system');
      }
    });
    seed();
    console.log(`[risk-register] seeded rr_site_aliases with ${Object.keys(DEFAULT_SITE_ALIASES).length} default mappings`);
  }
}

// Read the live alias map from the DB. Falls back to the baked-in
// defaults when the table is unreachable for any reason — better to
// produce an export with the old mapping than to fail entirely.
async function getSiteAliases(db) {
  try {
    await _initConfigSchema(db);
    const { H } = _h(db);
    const rows = await H.prepare('SELECT sdp_label, code FROM rr_site_aliases').all();
    if (rows.length === 0) return { ...DEFAULT_SITE_ALIASES };
    const out = {};
    for (const r of rows) out[r.sdp_label] = r.code;
    return out;
  } catch (e) {
    console.warn('[risk-register] alias lookup failed, using defaults:', e.message);
    return { ...DEFAULT_SITE_ALIASES };
  }
}

// Resolve any SDP `site` string to the Risk Register's short code, or
// return null if the site isn't on the register. The trim() + lowercase
// fallback is a defensive net for whitespace / capitalisation drift
// from SDP without committing to an exact-match-only policy.
// `aliases` is the live map (from getSiteAliases) or the default map.
function resolveSite(raw, aliases) {
  if (!raw) return null;
  const map = aliases || DEFAULT_SITE_ALIASES;
  const s = String(raw).trim();
  if (map[s]) return map[s];
  // Try case-insensitive fallback so future renames like "Houndé" or
  // "houndé" don't silently drop tickets.
  const lower = s.toLowerCase();
  for (const k of Object.keys(map)) {
    if (k.toLowerCase() === lower) return map[k];
  }
  return null;
}

// ─── Excel generator (SheetJS CE — pure JS, no native bindings) ──────
// Returns a Buffer ready to res.send(). Sheet layout matches the
// Risk Register's monthly Occurrence sheet column-for-column.
function generateRiskRegisterExcel(month, occurrences) {
  // Compute last day of selected month — used for column A on every row.
  // SheetJS represents dates as Date objects with cellDates: true.
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0);  // day 0 of next month = last of current

  // Build the worksheet as an array-of-arrays (header + data rows).
  // SheetJS's aoa_to_sheet is the most predictable way to construct a
  // sheet — every cell address (A1, A2, ...) maps to a row index +
  // column index deterministically.
  const headers = [
    'Dates', 'Site', 'Liste des risques Majeurs', 'Source',
    'Actions(préventives & correctives)',
    'Effecacite actuelle(%)', 'Effecacite Cible(%)',
    'Commentaires', 'Occurrence',
  ];
  const aoa = [headers];

  for (const site of SITES) {
    const siteCounts = occurrences[site] || {};
    for (const domain of DOMAINS) {
      const count = siteCounts[domain.label] || 0;
      aoa.push([
        lastDay,        // A: Dates           (real Date object)
        site,           // B: Site
        domain.label,   // C: Risk label
        domain.source,  // D: Source
        domain.actions, // E: Actions
        0,              // F: Efficacy now (spec: "Leave empty (0)")
        0,              // G: Efficacy target (spec: "Leave empty (0)")
        '',             // H: Comments (spec: "Leave empty")
        count,          // I: Occurrence
      ]);
    }
  }

  // cellDates:true tells SheetJS to write Date objects as Excel dates
  // (numeric serial + dateNF format string) rather than as ISO strings.
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });

  // ── Column widths (`!cols`) — supported in CE ─────────────────────
  // wch = width in CHARACTERS (Excel's typical "width" unit). Values
  // match the spec's ExcelJS widths roughly 1:1.
  ws['!cols'] = [
    { wch: 14 }, // A — Dates
    { wch: 14 }, // B — Site
    { wch: 45 }, // C — Risk label
    { wch: 38 }, // D — Source
    { wch: 50 }, // E — Actions
    { wch: 18 }, // F — Efficacy now
    { wch: 18 }, // G — Efficacy target
    { wch: 25 }, // H — Comments
    { wch: 14 }, // I — Occurrence
  ];

  // ── Row heights — set the header row taller for the wrapped labels ─
  ws['!rows'] = [{ hpt: 30 }]; // header row 1 only; everything else default

  // ── Frozen header row (`!freeze`) — supported in CE ───────────────
  // SheetJS uses `!views` (an array, one per worksheet view). ySplit=1
  // freezes the first row; topLeftCell='A2' is what's visible after the
  // freeze. State 'frozen' means panes are split AND frozen.
  ws['!views'] = [{
    state: 'frozen',
    ySplit: 1,
    topLeftCell: 'A2',
    activePane: 'bottomLeft',
  }];

  // ── Date number format on column A ────────────────────────────────
  // SheetJS stores per-cell number format on the `z` property. We walk
  // every cell in column A (skipping the header) and set the format.
  // This works in CE and renders correctly in Excel + LibreOffice.
  const totalDataRows = SITES.length * DOMAINS.length;
  for (let r = 2; r <= totalDataRows + 1; r++) {
    const addr = `A${r}`;
    if (ws[addr]) ws[addr].z = 'yyyy-mm-dd';
  }

  // ── Build the workbook ────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title:    `Risk Register Occurrence ${month}`,
    Subject:  'Monthly per-site incident occurrences by risk domain',
    Author:   'Endeavour Mining IT Dashboard',
    Company:  'Endeavour Mining',
    Category: 'Operational Risk',
  };
  XLSX.utils.book_append_sheet(wb, ws, `Occurrence_${month}`);

  // ── Serialize to Buffer ───────────────────────────────────────────
  // type:'buffer' returns a Node Buffer ready for res.send(). bookType
  // 'xlsx' selects the Office Open XML format (current Excel default).
  // compression:true uses DEFLATE on the inner XML — smaller file size,
  // identical visual output.
  return XLSX.write(wb, {
    type:        'buffer',
    bookType:    'xlsx',
    cellDates:   true,
    compression: true,
  });
}

// ─── Data loader (read-only SQLite query) ─────────────────────────────
// Reads from the local `request_records` table populated by the hourly
// Zoho sync. Filters to incidents/major incidents created in the
// selected month, then classifies + aggregates.
// `db` is the better-sqlite3 instance owned by reports-db.js (passed in
// to keep this module decoupled — no module-level singleton).
async function loadOccurrencesFromDB(db, month) {
  // Read the live alias map once per export (cheap — small table) so
  // admin edits take effect immediately, no module reload required.
  const aliases = await getSiteAliases(db);

  // Compute YYYY-MM-01 (inclusive) → next month YYYY-MM-01 (exclusive)
  const [year, mon] = month.split('-').map(Number);
  const startISO    = `${month}-01T00:00:00`;
  const endDate     = new Date(year, mon, 1);    // first day of NEXT month
  const endY        = endDate.getFullYear();
  const endM        = String(endDate.getMonth() + 1).padStart(2, '0');
  const endISO      = `${endY}-${endM}-01T00:00:00`;

  // SELECT only the columns we need. Indexed on created_time so this
  // is fast even with 50k+ rows. The Impact filter happens in JS rather
  // than SQL because:
  //   1. Historical rows have NULL impact (column added 2026-05-28 —
  //      backfilled by next full sync) and we want to count them in
  //      diagnostics, not silently drop them at the SQL layer.
  //   2. Future-proofing — if Zoho introduces a new Impact label, the
  //      classifier's VALID_IMPACTS set is the only thing to update.
  const { H } = _h(db);
  const rows = await H.prepare(`
    SELECT site, category, sub_category, request_type, impact
    FROM request_records
    WHERE created_time >= ?
      AND created_time <  ?
      AND request_type LIKE '%Incident%'
      AND COALESCE(category, '') != 'Inspection'
  `).all(startISO, endISO);

  // Aggregate: occurrences[site][domain] = count
  const occurrences = {};
  let skippedNoSite        = 0;
  let skippedUnknownSite   = 0;
  let skippedNoDomain      = 0;
  let skippedNonOperational = 0;  // Impact = Individual (explicit)
  let nullImpactCount       = 0;  // Counts rows with NULL impact that
                                  // we INCLUDE (NULL is treated as
                                  // in-scope per 2026-05-30 tuning).
  let classifiedCount      = 0;
  // Track which raw site labels weren't on the register so the
  // diagnostics can surface them (helps spot label drift in SDP).
  const unknownSiteSamples = {};

  for (const r of rows) {
    const rawSite = (r.site || '').trim();
    if (!rawSite) { skippedNoSite++; continue; }

    // Translate SDP's free-form site label to the Risk Register's
    // short code via the live alias map. resolveSite returns null for
    // sites NOT on the register (e.g. corporate offices in LONDON,
    // Dakar). Admins manage the map via /risk-register-admin.html.
    const site = resolveSite(rawSite, aliases);
    if (!site) {
      skippedUnknownSite++;
      unknownSiteSamples[rawSite] = (unknownSiteSamples[rawSite] || 0) + 1;
      continue;
    }

    // Track NULL-impact rows so the operator can see how much of the
    // count is "field unpopulated" vs "explicitly in-scope".
    const impact = String(r.impact || '').trim();
    if (!impact) nullImpactCount++;

    const domain = classifyIncident(r);
    if (!domain) {
      // classifyIncident returns null for:
      //   - explicit 'Individual' impact (counted as non-operational)
      //   - no domain rule matched (counted as no-domain)
      if (impact === 'Individual') skippedNonOperational++;
      else                         skippedNoDomain++;
      continue;
    }

    if (!occurrences[site]) occurrences[site] = {};
    occurrences[site][domain] = (occurrences[site][domain] || 0) + 1;
    classifiedCount++;
  }

  // Compact the unknown-site samples to the top 5 by frequency so
  // diagnostics stay readable; the rest are still summed in
  // skipped_unknown_site.
  const unknownSites = Object.entries(unknownSiteSamples)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, n]) => `${label} (${n})`);

  return {
    occurrences,
    diagnostics: {
      total_incident_rows:        rows.length,
      classified:                 classifiedCount,
      skipped_no_site:            skippedNoSite,
      skipped_unknown_site:       skippedUnknownSite,
      skipped_unknown_site_top:   unknownSites,    // ['LONDON (22)', ...]
      skipped_non_operational:    skippedNonOperational,  // explicit 'Individual'
      skipped_no_domain:          skippedNoDomain,
      classified_with_null_impact: nullImpactCount,
                                    // Subset of `classified` whose
                                    // Impact field was blank/NULL —
                                    // operator sees how much of the
                                    // count is "field unpopulated".
    },
  };
}

// ─── Top-level entry: month → Excel buffer ────────────────────────────
// Note: no longer async — SheetJS XLSX.write is synchronous. The
// server handler can still await this (await on a non-promise resolves
// immediately) so the calling code in server.js needs no change.
async function buildRiskRegisterExport(db, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Invalid month format "${month}" — expected YYYY-MM`);
  }
  const { occurrences, diagnostics } = await loadOccurrencesFromDB(db, month);
  console.log(`[risk-register] month=${month} rows=${diagnostics.total_incident_rows} classified=${diagnostics.classified} (null_impact=${diagnostics.classified_with_null_impact}) skipped_individual=${diagnostics.skipped_non_operational} skipped_unknown_site=${diagnostics.skipped_unknown_site} skipped_no_domain=${diagnostics.skipped_no_domain} top_unknown=${diagnostics.skipped_unknown_site_top.join(', ')}`);
  const buf = generateRiskRegisterExcel(month, occurrences);
  return { buffer: buf, diagnostics };
}

// ─── Admin-side CRUD on the alias map ─────────────────────────────────
// Thin wrappers used by /api/risk-register-config/* — they all share
// _initConfigSchema so calling them before the table exists is safe.

async function listAliases(db) {
  await _initConfigSchema(db);
  const { H } = _h(db);
  return await H.prepare(
    'SELECT sdp_label, code, updated_at, updated_by FROM rr_site_aliases ORDER BY code, sdp_label'
  ).all();
}

// Insert or update a single mapping. Trims whitespace defensively so
// admins typing "  HOUNDE " don't end up with a label that nothing
// matches at lookup time.
async function upsertAlias(db, sdp_label, code, updated_by) {
  await _initConfigSchema(db);
  const label = String(sdp_label || '').trim();
  const c     = String(code      || '').trim();
  if (!label) throw new Error('sdp_label is required');
  if (!c)     throw new Error('code is required');
  if (!SITES.includes(c)) {
    throw new Error(`code must be one of: ${SITES.join(', ')}`);
  }
  const { H } = _h(db);
  await H.prepare(`
    INSERT INTO rr_site_aliases (sdp_label, code, updated_by, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(sdp_label) DO UPDATE SET
      code       = excluded.code,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `).run(label, c, updated_by || 'unknown');
  return { sdp_label: label, code: c };
}

async function deleteAlias(db, sdp_label) {
  await _initConfigSchema(db);
  const { H } = _h(db);
  const r = await H.prepare('DELETE FROM rr_site_aliases WHERE sdp_label = ?').run(sdp_label);
  return { deleted: r.changes };
}

// Inspect which SDP labels appear in incidents for a given month
// without a matching alias. Powers the "Unmapped sites this month"
// panel in the admin UI — gives one-click visibility into drift.
async function listUnmappedSites(db, month) {
  await _initConfigSchema(db);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Invalid month format "${month}" — expected YYYY-MM`);
  }
  const aliases = await getSiteAliases(db);
  const [year, mon] = month.split('-').map(Number);
  const startISO    = `${month}-01T00:00:00`;
  const endDate     = new Date(year, mon, 1);
  const endISO      = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-01T00:00:00`;
  const { H } = _h(db);
  const rows = await H.prepare(`
    SELECT site, COUNT(*) c
    FROM request_records
    WHERE created_time >= ?
      AND created_time <  ?
      AND request_type LIKE '%Incident%'
      AND COALESCE(category, '') != 'Inspection'
      AND COALESCE(site, '') != ''
    GROUP BY site
    ORDER BY c DESC
  `).all(startISO, endISO);
  return rows
    .filter(r => !resolveSite(r.site, aliases))
    .map(r => ({ sdp_label: r.site, ticket_count: r.c }));
}

module.exports = {
  buildRiskRegisterExport,
  // Admin-side CRUD (used by /api/risk-register-config/*)
  listAliases,
  upsertAlias,
  deleteAlias,
  listUnmappedSites,
  // Constants exposed for the UI (so the page can populate the code
  // dropdown without a second round-trip).
  SITES,
  // Exposed for unit-test ergonomics
  classifyIncident,
  loadOccurrencesFromDB,
  resolveSite,
  getSiteAliases,
  DOMAIN_RULES,
  DOMAINS,
  DEFAULT_SITE_ALIASES,
  EXCLUDED_IMPACTS,
};
