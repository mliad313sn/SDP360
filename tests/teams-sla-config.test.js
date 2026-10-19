'use strict';
// Teams SLA alerts — the config keys exist (else setConfig silently drops them) and the
// three secret-shaped ones are blank-kept + encrypted at rest like smtp_pass.
const test = require('node:test');
const assert = require('node:assert');
const rc = require('../services/reportConfig');

test('the teams/sdp keys are known, disarmed by default, with the right API base', () => {
  for (const k of ['teams_sla_enabled', 'teams_sla_rules', 'teams_sla_channels', 'teams_sla_last_run',
    'sdp_api_base_url', 'sdp_api_accounts_url', 'sdp_api_client_id', 'sdp_api_client_secret', 'sdp_api_refresh_token', 'sdp_api_open_filter']) {
    assert.ok(rc.KEYS.includes(k), k);
  }
  assert.equal(rc.DEFAULTS.teams_sla_enabled, '0');
  assert.equal(rc.DEFAULTS.sdp_api_base_url, 'https://oneitsupport.endeavourmining.com/app/itdesk/api/v3');
  assert.equal(rc.DEFAULTS.sdp_api_accounts_url, 'https://accounts.zoho.com');
  assert.equal(rc.DEFAULTS.sdp_api_open_filter, 'Open_System');
});

test('client secret, refresh token and the channel webhooks are secrets (blank = keep, encrypted at rest)', () => {
  for (const k of ['sdp_api_client_secret', 'sdp_api_refresh_token', 'teams_sla_channels']) assert.ok(rc._SECRET_BLANK_KEEP.has(k), k);
});
