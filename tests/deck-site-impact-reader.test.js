'use strict';
// _bucketSiteImpact — maps request_records rows (by tech_group) to per-site
// helpdesk counts with the SLA doctrine (closed=pending_status 0, missed=
// overdue_status 1, on_time=closed&not-overdue, incidents=request_type~Incident).
const test = require('node:test');
const assert = require('node:assert');
const { _bucketSiteImpact } = require('../reports-db');

const SITES = [
  { id: 1, name: 'Sabodala', zoho_group: 'SGO IT Agents, SGO Extra' },
  { id: 2, name: 'Ity', zoho_group: 'ITY IT Agents' },
];
const ROWS = [
  { tech_group: 'SGO IT Agents', pending_status: 0, overdue_status: 1, request_type: 'Incident' },        // closed, overdue→missed, incident
  { tech_group: 'SGO Extra',     pending_status: 0, overdue_status: 0, request_type: 'Service Request' },  // closed, on time
  { tech_group: 'ITY IT Agents', pending_status: 1, overdue_status: null, request_type: 'Major Incident' }, // open, incident
  { tech_group: 'Unknown Group', pending_status: 0, overdue_status: 0, request_type: 'Incident' },         // no site → ignored
];

test('_bucketSiteImpact aggregates per site with the SLA doctrine', () => {
  const out = _bucketSiteImpact(SITES, ROWS);
  const sgo = out.find((s) => s.name === 'Sabodala');
  assert.equal(sgo.tickets, 2);
  assert.equal(sgo.closed, 2);
  assert.equal(sgo.on_time, 1);     // one of the two closed was overdue
  assert.equal(sgo.missed, 1);      // overdue_status===1
  assert.equal(sgo.incidents, 1);   // 'Incident' (the 'Service Request' isn't)
  const ity = out.find((s) => s.name === 'Ity');
  assert.equal(ity.tickets, 1);
  assert.equal(ity.closed, 0);      // pending_status 1 = open
  assert.equal(ity.incidents, 1);   // 'Major Incident' matches /incident/i
});

test('rows whose tech_group maps to no site are dropped; zero-ticket sites omitted', () => {
  const out = _bucketSiteImpact(SITES, [{ tech_group: 'Unknown Group', pending_status: 0, overdue_status: 0, request_type: 'x' }]);
  assert.deepEqual(out, []);   // nothing matched → no site has tickets
});
