'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sync = require('../assets-sync');

function deps(log, over = {}) {
  return {
    snapshotEffort: async () => { log.push('effort'); },
    recordAssetSightings: async () => { log.push('sightings'); return { inserted: 1 }; },
    sendNewAssetAlerts: async () => { log.push('alerts'); },
    ...over,
  };
}
const OK = [{ name: 'assets', rows: 10 }, { name: 'asset_memory', rows: 5 }];

test('assetsViewFailed looks at the assets view only', () => {
  assert.strictEqual(sync.assetsViewFailed(OK), false);
  assert.strictEqual(sync.assetsViewFailed([{ name: 'assets', error: 'timeout' }]), true);
  assert.strictEqual(sync.assetsViewFailed([{ name: 'asset_memory', error: 'x' }, { name: 'assets', rows: 1 }]), false);
  assert.strictEqual(sync.assetsViewFailed(null), true, 'no summary = cannot trust the table');
});

test('cron order: effort → sightings → alerts', async () => {
  const log = [];
  await sync.afterAssetsSync(OK, { sendAlerts: true, deps: deps(log) });
  assert.deepStrictEqual(log, ['effort', 'sightings', 'alerts']);
});

test('manual trigger: sightings but no alert', async () => {
  const log = [];
  await sync.afterAssetsSync(OK, { sendAlerts: false, deps: deps(log) });
  assert.deepStrictEqual(log, ['effort', 'sightings']);
});

test('failed assets view → effort still runs, sightings + alerts skipped', async () => {
  const log = [];
  const r = await sync.afterAssetsSync([{ name: 'assets', error: 'boom' }], { sendAlerts: true, deps: deps(log) });
  assert.deepStrictEqual(log, ['effort']);
  assert.strictEqual(r.sightings, 'skipped: assets view failed');
});

test('an effort failure never blocks sightings; a sightings failure never throws', async () => {
  const log = [];
  await sync.afterAssetsSync(OK, { sendAlerts: true, deps: deps(log, {
    snapshotEffort: async () => { throw new Error('effort down'); },
    recordAssetSightings: async () => { log.push('sightings'); throw new Error('db down'); },
  }) });
  assert.deepStrictEqual(log, ['sightings'], 'alerts are not sent after a sightings failure');
});
