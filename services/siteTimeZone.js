'use strict';
// D-07 (AMDEC AM-08) — which time zone a site's calendar uses. Pure. Behind report_config site_local_calendar
// ('0' = UTC everywhere, today). The column sites.time_zone wins; else the country's zone; else null (= UTC).
const COUNTRY_TZ = { SN: 'Africa/Dakar', BF: 'Africa/Ouagadougou', CI: 'Africa/Abidjan', ML: 'Africa/Bamako', GB: 'Europe/London' };

function isValidTz(tz) {
  if (!tz || typeof tz !== 'string' || tz.length > 64 || !/^[A-Za-z0-9_/+-]+$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (_) { return false; }
}

// site = { time_zone, country }; enabled = the switch value. Returns an IANA name or null (UTC).
function siteTimeZone(site, enabled) {
  if (String(enabled) !== '1' || !site) return null;
  const own = site.time_zone && String(site.time_zone).trim();
  if (own) return isValidTz(own) ? own : null;
  const byCountry = COUNTRY_TZ[String(site.country || '').trim().toUpperCase()];
  return byCountry || null;
}

// E-D03: SQL fragment for "the local calendar date of a TEXT ISO timestamp column". tz null → the UTC
// expression the reader used before (callers keep their own UTC SQL untouched); tz set → AT TIME ZONE ? with
// the zone bound as a parameter (never interpolated — it is validated by isValidTz anyway).
function localDateSql(col, tz, fmt) {
  if (!tz) return null;
  return fmt ? `to_char(${col}::timestamptz AT TIME ZONE ?, '${fmt}')` : `(${col}::timestamptz AT TIME ZONE ?)::date`;
}

// E-D03: read the switch + the site's zone in one place for every site-window reader (best effort: a read
// failure means UTC, the default behaviour).
async function readerTz(H, siteId, siteRow) {
  const lc = await H.prepare("SELECT value FROM report_config WHERE key='site_local_calendar'").get().catch(() => null);
  if (!lc || String(lc.value) !== '1') return null;
  const row = siteRow && ('country' in siteRow || 'time_zone' in siteRow) ? siteRow
    : await H.prepare('SELECT country, time_zone FROM sites WHERE id=?').get(siteId).catch(() => null);
  return siteTimeZone(row, '1');
}

module.exports = { COUNTRY_TZ, isValidTz, siteTimeZone, localDateSql, readerTz };
