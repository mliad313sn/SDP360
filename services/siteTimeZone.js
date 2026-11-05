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

module.exports = { COUNTRY_TZ, isValidTz, siteTimeZone };
