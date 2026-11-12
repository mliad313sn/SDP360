'use strict';
// A-09a — the UI-policy channel: a pure mapping of report_config ui_* keys to the policy the browser reads
// (window.__uiPolicy). Every unknown or blank value falls back to today's behaviour.
const test = require('node:test');
const assert = require('node:assert');
const { uiPolicyFrom, UI_DEFAULTS, isAllowed, UI_KEYS } = require('../services/uiPolicy');
const { DEFAULTS } = require('../services/reportConfig');

const TODAY = { lang_default: '', i18n_pages: '0', role_landing: '0', nav_profile: 'full', deck_builder_roles: ['super_admin'], exec_nav: 'full', kpi_base_line: '0', kpi_sample_size: '0', kpi_definition_drawer: '0', small_multiples: '0', feedback: '0', data_quality_page: '0', url_filters: '0', nav_active_from_url: '0', home_blocks: '0', exec_charts_v2: '0', home_queue: '0', nav_carry_site: '0', workspace_profiles: '0', ux_events: '0' };

test('an empty config gives today\'s defaults', () => {
  assert.deepStrictEqual(uiPolicyFrom({}), TODAY);
  assert.deepStrictEqual(uiPolicyFrom(null), TODAY);
  assert.deepStrictEqual(uiPolicyFrom(undefined), TODAY);
});

test('unknown values fall back to the defaults', () => {
  const p = uiPolicyFrom({ ui_lang_default: 'de', ui_nav_profile: 'tiny', ui_i18n_pages: 'yes', ui_role_landing: '2', ui_deck_builder_roles: 'nobody, ,root', ui_exec_nav: 'tiny' });
  assert.deepStrictEqual(p, TODAY);
});

test('allowed values are passed through', () => {
  const p = uiPolicyFrom({ ui_lang_default: 'fr', ui_nav_profile: 'lean', ui_i18n_pages: '1', ui_role_landing: '1', ui_deck_builder_roles: 'super_admin, executive,report-author', ui_exec_nav: 'consolidated', kpi_base_line: '0', kpi_sample_size: '0', small_multiples: '0', feedback: '0', data_quality_page: '0', url_filters: '0', nav_active_from_url: '0', home_blocks: '0', exec_charts_v2: '0', home_queue: '0', nav_carry_site: '0', workspace_profiles: '0', ux_events: '0' });
  assert.deepStrictEqual(p, { lang_default: 'fr', i18n_pages: '1', role_landing: '1', nav_profile: 'lean', deck_builder_roles: ['super_admin', 'executive', 'report-author'], exec_nav: 'consolidated', kpi_base_line: '0', kpi_sample_size: '0', kpi_definition_drawer: '0', small_multiples: '0', feedback: '0', data_quality_page: '0', url_filters: '0', nav_active_from_url: '0', home_blocks: '0', exec_charts_v2: '0', home_queue: '0', nav_carry_site: '0', workspace_profiles: '0', ux_events: '0' });
});

test('every ui_* key is in reportConfig.DEFAULTS with today\'s value', () => {
  for (const k of UI_KEYS) {
    assert.ok(k in DEFAULTS, `${k} missing from reportConfig.DEFAULTS (setConfig would drop it)`);
    assert.strictEqual(DEFAULTS[k], UI_DEFAULTS[k], `${k} default`);
  }
  assert.deepStrictEqual(UI_KEYS.slice().sort(), ['ui_data_quality_page', 'ui_deck_builder_roles', 'ui_exec_charts_v2', 'ui_exec_nav', 'ui_feedback_enabled', 'ui_home_blocks', 'ui_home_queue', 'ui_i18n_pages', 'ui_kpi_base_line', 'ui_kpi_definition_drawer', 'ui_kpi_sample_size', 'ui_lang_default', 'ui_nav_active_from_url', 'ui_nav_carry_site', 'ui_nav_profile', 'ui_role_landing', 'ui_small_multiples', 'ui_url_filters']);
});

test('isAllowed validates a value against the allowed set', () => {
  assert.ok(isAllowed('ui_i18n_pages', '1'));
  assert.ok(isAllowed('ui_lang_default', ''));
  assert.ok(isAllowed('ui_deck_builder_roles', 'super_admin,executive'));
  assert.ok(isAllowed('ui_exec_nav', 'consolidated'));
  assert.ok(!isAllowed('ui_exec_nav', 'lean'));
  assert.ok(!isAllowed('ui_i18n_pages', 'on'));
  assert.ok(!isAllowed('ui_lang_default', 'de'));
  assert.ok(!isAllowed('ui_deck_builder_roles', 'root'));
  assert.ok(!isAllowed('smtp_host', 'x'), 'only ui_* keys');
});

test('the CLI is a dry run by default and refuses an invalid value', () => {
  const cli = require('../tools/reports/set-ui-policy');
  assert.deepStrictEqual(cli.parseArgs(['--key=ui_i18n_pages', '--value=1']), { key: 'ui_i18n_pages', value: '1', apply: false });
  assert.strictEqual(cli.parseArgs(['--key=ui_lang_default', '--value=fr', '--apply']).apply, true);
  assert.throws(() => cli.plan({ key: 'ui_i18n_pages', value: 'maybe' }, {}), /not allowed/);
  assert.throws(() => cli.plan({ key: 'smtp_host', value: 'x' }, {}), /not a UI policy key/);
  assert.deepStrictEqual(cli.plan({ key: 'ui_i18n_pages', value: '1' }, { ui_i18n_pages: '0' }), { key: 'ui_i18n_pages', current: '0', proposed: '1', changed: true });
});

test('main(): the dry run writes nothing, --apply writes through setConfig', async () => {
  const cli = require('../tools/reports/set-ui-policy');
  const writes = []; const lines = [];
  const deps = { getConfig: async () => ({ ui_i18n_pages: '0' }), setConfig: async (patch) => { writes.push(patch); }, log: (s) => lines.push(s) };
  const dry = await cli.main(['--key=ui_i18n_pages', '--value=1'], deps);
  assert.strictEqual(dry.applied, false);
  assert.deepStrictEqual(writes, []);
  assert.ok(lines.some((l) => /ui_i18n_pages: '0' -> '1'/.test(l)), lines.join('\n'));
  const done = await cli.main(['--key=ui_i18n_pages', '--value=1', '--apply'], deps);
  assert.strictEqual(done.applied, true);
  assert.deepStrictEqual(writes, [{ ui_i18n_pages: '1' }]);
});
