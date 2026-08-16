'use strict';
// V1b-B discovery harness (DEV-ONLY, run by the operator with their key). Confirms the
// three facts V1b-B was built pluggable for, WITHOUT baking guesses into the code:
//   1. the real `category`/`type` strings (do they match opmClassify's rule table?),
//   2. probeName vs device-name prefix (which resolves a device to its SITE? — Dakar rides
//      the Sabodala probe, so name-prefix may be needed),
//   3. the `getDeviceCompleteDetails.availdata` shape + whether it hints at its time window.
// Key is read from ENV, never a CLI arg, never printed.
//   set OPMANAGER_API_KEY=...
//   set OPMANAGER_BASE_URL=https://abj-spm-000:8061
//   node tools/opmanager/discover.js
// Paste back the printed strings only.
const { makeOpmanagerClient } = require('../../services/opmanagerClient');
const { classifyKpiFamily } = require('../../services/opmClassify');

(async () => {
  const apiKey = process.env.OPMANAGER_API_KEY, baseUrl = process.env.OPMANAGER_BASE_URL;
  if (!apiKey || !baseUrl) { console.error('Set OPMANAGER_API_KEY and OPMANAGER_BASE_URL in the environment first.'); process.exit(2); }
  const client = makeOpmanagerClient({ apiKey, baseUrl, tlsInsecure: process.env.OPMANAGER_TLS_INSECURE !== '0' });

  const devices = (await client.listDevices({ rows: 5000, page: 1 })) || [];
  console.log(`\nlistDevices → ${devices.length} devices\n`);

  // 1. distinct category/type + how the classifier maps them (spot mis-classifications)
  const seen = new Map();
  for (const d of devices) {
    const key = `${d.category || '?'} | ${d.type || '?'}`;
    if (!seen.has(key)) seen.set(key, classifyKpiFamily(d.type, d.category).family);
  }
  console.log('=== distinct (category | type) → classified family ===');
  for (const [k, fam] of [...seen.entries()].sort()) console.log(`  ${fam.padEnd(9)}  ${k}`);

  // 2. probeName vs device-name prefix (site resolution strategy)
  console.log('\n=== sample: name  →  probeName  (does probe == site prefix?) ===');
  for (const d of devices.slice(0, 15)) {
    const name = d.name || d.deviceName || d.displayName || '';
    console.log(`  ${String(name).padEnd(24)}  probe=${d.probeName}`);
  }
  const probes = [...new Set(devices.map(d => d.probeName).filter(Boolean))].sort();
  console.log(`  distinct probes: ${probes.join(', ')}`);

  // 3. availdata shape + window hint on one non-firewall device
  const sample = devices.find(d => !/F\/?W/i.test(String(d.name || d.displayName || '')) && classifyKpiFamily(d.type, d.category).family !== 'excluded') || devices[0];
  if (sample) {
    const name = sample.name || sample.deviceName || sample.displayName;
    const det = await client.getDeviceCompleteDetails({ name });
    console.log(`\n=== getDeviceCompleteDetails("${name}") ===`);
    console.log('  availdata:', det && det.availdata ? JSON.stringify(det.availdata) : '(none)');
    const windowKeys = det ? Object.keys(det).filter(k => /avail|today|period|time/i.test(k)) : [];
    console.log('  window-hinting keys:', windowKeys.join(', ') || '(none — availdata window unclear, treat as recent)');
  }
  process.exit(0);
})().catch(e => { console.error('discovery failed:', e.message); process.exit(1); });
