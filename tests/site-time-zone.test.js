'use strict';
// D-07 (AMDEC AM-08) — pure resolver for a site's calendar time zone (services/siteTimeZone.js).
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../services/siteTimeZone');

test('switch off (default 0) → always UTC (null), whatever the site carries', () => {
  assert.equal(T.siteTimeZone({ country: 'GB', time_zone: 'Europe/London' }, '0'), null);
  assert.equal(T.siteTimeZone({ country: 'GB' }, undefined), null);
});

test('switch on → column first, else the country, else UTC; an invalid zone is UTC', () => {
  assert.equal(T.siteTimeZone({ country: 'GB' }, '1'), 'Europe/London');
  assert.equal(T.siteTimeZone({ country: 'sn' }, '1'), 'Africa/Dakar');
  assert.equal(T.siteTimeZone({ country: 'GB', time_zone: 'UTC' }, '1'), 'UTC');
  assert.equal(T.siteTimeZone({ country: 'ZZ' }, '1'), null);
  assert.equal(T.siteTimeZone({ time_zone: "Europe/London'; DROP TABLE x;--" }, '1'), null);
  assert.equal(T.siteTimeZone(null, '1'), null);
  assert.ok(T.isValidTz('Africa/Abidjan')); assert.ok(!T.isValidTz('Not/AZone'));
});

test('every country of the multinational world has a valid zone', () => {
  for (const tz of Object.values(T.COUNTRY_TZ)) assert.ok(T.isValidTz(tz), tz);
});
