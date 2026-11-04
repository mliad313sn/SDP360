'use strict';
// A-26 — READ-ONLY dry run of the locale-safe amount parser (asset_amount_parser).
//
//   node tools/assets/amount-parser-diff.js [--map=<candidate-currency-map.json>] [--limit=50]
//
// Lists every asset money field whose parsed value differs between the legacy parser
// (today) and the locale parser (PROPOSED), and — with --map — every asset site that
// has no currency under that candidate asset_site_currency map. Nothing is written;
// exit code 0. Finance reads the report before anyone flips the switch.
//
// .env FIRST: every *-db module picks its backend at require time.
const path = require('path');
if (require.main === module) require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const money = require('../../services/money');
const currency = require('../../services/currency');

const FIELDS = ['purchase_cost', 'current_book_value', 'total_cost_of_ownership', 'operational_cost'];
const _same = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-9);

// PURE core. rows: [{asset_id, site, purchase_cost, …}]; opts.map: a candidate
// currency map (object or JSON string). Returns {total, differing[], sites_without_currency[]}.
function diffAmounts(rows, opts = {}) {
  const differing = [];
  for (const r of rows || []) {
    for (const field of FIELDS) {
      const raw = r[field];
      const legacy = money.parseAmount(raw);
      const locale = money.parseAmountLocale(raw);
      if (!_same(legacy, locale)) differing.push({ asset_id: r.asset_id, site: r.site, field, raw, legacy, locale });
    }
  }
  const map = currency.parseCurrencyMap(opts.map || '');
  const missing = new Map();
  if (Object.keys(map).length) {
    for (const r of rows || []) {
      if (currency.resolveSiteCurrency(r.site, map) == null) {
        const k = r.site == null ? '' : String(r.site);
        missing.set(k, (missing.get(k) || 0) + 1);
      }
    }
  }
  const sites_without_currency = [...missing.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([site, assets]) => ({ site, assets }));
  return { total: (rows || []).length, differing, sites_without_currency };
}

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };

async function main() {
  const fs = require('fs');
  const mapFile = arg('map', '');
  const limit = Number(arg('limit', '50')) || 50;
  const map = mapFile ? fs.readFileSync(mapFile, 'utf8') : '';
  const adb = require('../../assets-db');
  if (typeof adb.initPgAssets === 'function') await adb.initPgAssets();
  const rows = await adb.getEnrichedAssets({});
  const r = diffAmounts(rows, { map });
  console.log(`[amount-parser-diff] assets read: ${r.total}`);
  console.log(`[amount-parser-diff] money fields that differ between legacy and locale: ${r.differing.length}`);
  for (const d of r.differing.slice(0, limit)) {
    console.log(`  ${d.asset_id}\t${d.site || '(no site)'}\t${d.field}\t${JSON.stringify(d.raw)}\tlegacy=${d.legacy}\tlocale=${d.locale}`);
  }
  if (r.differing.length > limit) console.log(`  … ${r.differing.length - limit} more (use --limit=N)`);
  if (mapFile) {
    console.log(`[amount-parser-diff] sites with no currency under ${mapFile}: ${r.sites_without_currency.length}`);
    for (const s of r.sites_without_currency) console.log(`  ${s.site || '(no site)'}\t${s.assets} asset(s)`);
  } else {
    console.log('[amount-parser-diff] no --map given: currency coverage not checked');
  }
  console.log('[amount-parser-diff] read-only — nothing was written');
}

if (require.main === module) {
  main().then(() => process.exit(0), (e) => { console.error('[amount-parser-diff] failed:', e.message); process.exit(1); });
}

module.exports = { diffAmounts, main };
