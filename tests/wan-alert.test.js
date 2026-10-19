'use strict';
// Pure WAN ISP-alert logic: the site-vs-ISP rule, recipient assembly (cc = coordinator + service
// desk, never repeating the ISP), duration formatting, and the two email bodies.
const { test } = require('node:test');
const assert = require('node:assert');
const { isSiteOutage, alertRecipients, humanDuration, buildDownEmail, buildRecoveryEmail } = require('../services/wanAlert');

test('isSiteOutage: BOTH uplinks of a device down = site/power (true); single uplink = ISP (false)', () => {
  const both = new Set(['7||wan1', '7||wan2']);
  assert.equal(isSiteOutage(7, '', both), true);
  const one = new Set(['7||wan1', '9||wan2']);   // 7 has only wan1 down; 9 is a different device
  assert.equal(isSiteOutage(7, '', one), false);
  // sub-sites are distinct devices
  const sub = new Set(['7|TANDA|wan1', '7|MASSAWA|wan1']);
  assert.equal(isSiteOutage(7, 'TANDA', sub), false, 'two different sub-sites are not one device');
});

test('alertRecipients: to=ISP, cc=coordinator+servicedesk, deduped, cc never repeats to; null when no ISP', () => {
  const r = alertRecipients({ isp_notify_email: 'noc@isp.com' }, 'coord@edv.com', 'oneitsupport@endeavourmining.com');
  assert.equal(r.to, 'noc@isp.com');
  assert.equal(r.cc, 'coord@edv.com, oneitsupport@endeavourmining.com');
  // no ISP contact → no alert
  assert.equal(alertRecipients({ isp_notify_email: '' }, 'c@e.com', 's@e.com'), null);
  // cc that equals the ISP is dropped; blanks dropped
  const r2 = alertRecipients({ isp_notify_email: 'noc@isp.com' }, 'NOC@isp.com', '');
  assert.equal(r2.cc, '', 'coordinator equal to the ISP (case-insensitive) is not duplicated into cc');
});

test('humanDuration', () => {
  assert.equal(humanDuration('2026-08-19T18:10:00Z', '2026-08-19T18:25:00Z'), '15m');
  assert.equal(humanDuration('2026-08-19T18:10:00Z', '2026-08-19T20:15:00Z'), '2h 05m');
  assert.equal(humanDuration('bad', '2026-08-19T20:15:00Z'), '—');
});

test('buildDownEmail: subject + html carry site, ISP, uplink, down-since', () => {
  const { subject, html } = buildDownEmail({
    site_id: 7, sub_site: '', siteName: 'Mana', uplink: 'wan1', isp: 'Orange', circuit_id: 'C-1',
    detectedStart: '2026-08-19T18:10:00Z', nowIso: '2026-08-19T18:40:00Z' });
  assert.match(subject, /WAN OUTAGE.*Orange.*Mana.*wan1 down/);
  assert.match(html, /Mana/); assert.match(html, /Orange/); assert.match(html, /wan1/);
  assert.match(html, /30m/, 'duration-so-far rendered');
});

test('buildRecoveryEmail: subject says rétabli, html carries total duration', () => {
  const { subject, html } = buildRecoveryEmail({
    site_id: 7, sub_site: 'TANDA', siteName: 'Exploration', uplink: 'wan2', isp: 'Free', circuit_id: 'C-9',
    detectedStart: '2026-08-19T18:10:00Z', restoredEnd: '2026-08-19T20:15:00Z' });
  assert.match(subject, /WAN RESTORED.*Exploration \/ TANDA wan2 rétabli/);
  assert.match(html, /2h 05m/);
});
