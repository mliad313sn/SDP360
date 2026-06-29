'use strict';
// Regression: the requests sync must capture udf_json (incl. "UDF:Services
// affected", used by the Risk Register) for EVERY incident — not only Major
// Incidents. Pure-function test on the extracted buildUdfRows helper.
const test = require('node:test');
const assert = require('node:assert');
const { buildUdfRows } = require('../zoho-sync');

test('buildUdfRows captures Services affected for a REGULAR incident (not just MIs)', () => {
  const rows = [
    { 'Request ID': '1', 'Request Type': 'Incident',       'UDF:Services affected': 'Internet,Radio' },
    { 'Request ID': '2', 'Request Type': 'Major Incident', 'UDF:Root Cause Analysis :': 'switch froze' },
    { 'Request ID': '3', 'Request Type': 'Incident' },                 // no UDF at all
    { 'Request ID': '4', 'Request Type': 'Incident',       'UDF:Services affected': '   ' }, // blank → dropped
  ];
  const out = buildUdfRows(rows);
  const byId = Object.fromEntries(out.map(r => [r.request_id, r.udf_json]));

  assert.ok(byId['1'] && byId['1'].includes('Services affected'), 'regular incident Services-affected captured');
  assert.ok(byId['1'].includes('Internet,Radio'), 'value preserved');
  assert.ok(byId['2'] && byId['2'].includes('Root Cause'), 'MI UDF still captured');
  assert.equal(byId['3'], undefined, 'no-UDF row excluded');
  assert.equal(byId['4'], undefined, 'blank-UDF row excluded');
});

test('buildUdfRows: empty / non-array → []', () => {
  assert.deepEqual(buildUdfRows([]), []);
  assert.deepEqual(buildUdfRows(null), []);
  assert.deepEqual(buildUdfRows(undefined), []);
});

test('buildUdfRows: falls back to Request Display ID when Request ID missing', () => {
  const out = buildUdfRows([{ 'Request Display ID': '312038', 'UDF:Services affected': 'Radio' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].request_id, '312038');
});
