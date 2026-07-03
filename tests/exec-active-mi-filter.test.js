'use strict';

// getActiveMajorIncidentsForSite must return ONLY genuinely-open major
// incidents. Regression: the query trusted pending_status=1, but the ~16
// always-re-upserted Major-Incident rows carry a STALE pending_status — a
// closed MI keeps pending_status=1 while its (fresh) request_status reads
// "Closed". That leaked closed / year-old incidents onto the public Exec View
// as "active". Fix: also exclude request_status Closed/Resolved/Cancelled
// (COALESCE so NULL/blank status stays active, matching the pg fixture).

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-active-mi-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const rdb = require('../reports-db');

const G = 'Hounde IT Agents';
let n = 0;
function addMI(o) {
  rdb.db.prepare(
    `INSERT INTO request_records
       (request_id, display_id, subject, request_status, pending_status,
        overdue_status, request_type, template, tech_group, site, created_time)
     VALUES (@request_id, @display_id, @subject, @request_status, @pending_status,
             @overdue_status, @request_type, @template, @tech_group, @site, @created_time)`
  ).run({
    request_id: 'MI-' + (++n),
    display_id: '#INC-' + n,
    subject: o.subject || ('Incident ' + n),
    request_status: o.request_status === undefined ? 'Open' : o.request_status,
    pending_status: o.pending_status === undefined ? 1 : o.pending_status,
    overdue_status: o.overdue_status || 0,
    request_type: o.request_type || 'Major Incident',
    template: o.template || null,
    tech_group: G,
    site: o.site || 'Hounde',
    created_time: o.created_time || '2026-06-01T00:00:00',
  });
}

before(() => {
  addMI({ subject: 'OPEN one',      request_status: 'Open',      pending_status: 1 });
  addMI({ subject: 'NULLSTATUS',    request_status: null,        pending_status: 1 }); // pg fixture keeps this active
  addMI({ subject: 'CLOSED stale',  request_status: 'Closed',    pending_status: 1 }); // the bug — must be dropped
  addMI({ subject: 'RESOLVED',      request_status: 'Resolved',  pending_status: 1 });
  addMI({ subject: 'CANCELLED',     request_status: 'Cancelled', pending_status: 1 });
  addMI({ subject: 'not major',     request_status: 'Open',      pending_status: 1, request_type: 'Incident' });
  // #311587 shape: Request Type "Incident" but Template "Major Incident Report"
  // → must be detected as an active major incident via the template signal.
  addMI({ subject: 'TEMPLATE MI',   request_status: 'Open',      pending_status: 1,
          request_type: 'Incident', template: 'Major Incident Report' });
});

test('active MI filter: keeps Open + NULL status + template-flagged, drops terminal + non-major', () => {
  const rows = rdb.getActiveMajorIncidentsForSite([G]);
  const subjects = rows.map(r => r.subject).sort();
  assert.deepEqual(subjects, ['NULLSTATUS', 'OPEN one', 'TEMPLATE MI']);
});

test('active MI filter: the stale-Closed incident never leaks through', () => {
  const rows = rdb.getActiveMajorIncidentsForSite([G]);
  assert.ok(!rows.some(r => /closed|resolved|cancel/i.test(r.status || '')),
    'no terminal-status incident in the active set');
});
