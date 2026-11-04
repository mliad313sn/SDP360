'use strict';
// Standalone runs must read the app's .env BEFORE any *-db module loads (tests/reports-cli-dotenv.test.js).
if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
// A-09a — change ONE UI-policy switch in report_config (ui_lang_default, ui_i18n_pages, ui_role_landing,
// ui_nav_profile, ui_deck_builder_roles). DRY RUN by default: prints current -> proposed and writes nothing.
//   node tools/reports/set-ui-policy.js --key=ui_i18n_pages --value=1            (dry run)
//   node tools/reports/set-ui-policy.js --key=ui_i18n_pages --value=1 --apply    (writes through setConfig)
// Rollback: the same command with the previous value (printed by the dry run) and --apply.
// Browsers pick the change up on their next page load (public/auth.js refreshes the cached policy).

const { UI_KEYS, isAllowed } = require('../../services/uiPolicy');

function parseArgs(argv) {
  const out = { key: '', value: '', apply: false };
  for (const a of argv || []) {
    if (a === '--apply') out.apply = true;
    else if (a.startsWith('--key=')) out.key = a.slice(6).trim();
    else if (a.startsWith('--value=')) out.value = a.slice(8).trim();
  }
  return out;
}

// Pure: validate and describe the change.
function plan(args, cfg) {
  if (!UI_KEYS.includes(args.key)) throw new Error(`"${args.key}" is not a UI policy key (${UI_KEYS.join(', ')})`);
  if (!isAllowed(args.key, args.value)) throw new Error(`value "${args.value}" is not allowed for ${args.key}`);
  const current = cfg && cfg[args.key] != null ? String(cfg[args.key]) : '';
  return { key: args.key, current, proposed: args.value, changed: current !== args.value };
}

async function main(argv, deps) {
  const args = parseArgs(argv);
  let d = deps;
  if (!d) {
    const rdb = require('../../reports-db');
    await rdb.initPgReports();
    const reportConfig = require('../../services/reportConfig');
    d = {
      getConfig: () => reportConfig.getConfig(rdb.db),
      setConfig: (patch) => reportConfig.setConfig(rdb.db, patch, 'cli:set-ui-policy'),
      log: (s) => console.log(s),
    };
  }
  const p = plan(args, await d.getConfig());
  d.log(`${p.key}: '${p.current}' -> '${p.proposed}'${p.changed ? '' : ' (no change)'}`);
  if (!args.apply) { d.log('DRY RUN — nothing written. Re-run with --apply to write it.'); return { ...p, applied: false }; }
  if (p.changed) await d.setConfig({ [p.key]: p.proposed });
  d.log(p.changed ? 'Applied.' : 'Nothing to apply.');
  return { ...p, applied: p.changed };
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0)).catch((e) => { console.error('[set-ui-policy]', e.message); process.exit(1); });
}

module.exports = { parseArgs, plan, main };
