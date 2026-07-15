// tests/report-template-coordinator.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { composeCoordinator } = require('../services/reportTemplates/coordinator');

const data = {
  site_code: 'HGO', site_name: 'Hounde',
  period: { year: 2026, month: 7, kind: 'weekly', label: 'July 2026' },
  score: { composite: 62, rag: 'amber', trend_pts: -8, dimensions: { reviews: 66, resolution_pct: 60, overdue: 70, inspections: 100, findings: 40, signoff_pct: 50 },
           two_moves: [{ text: 'Hold the 1 missing department PV(s) this month', gain_pts: 7 }, { text: 'Close 4 open issue(s) still standing', gain_pts: 8 }] },
  meetings: { pvs_held: 2, pvs_target: 3, open_issues: 4, high_open: 1, resolved: 6, new: 3, escalations: 1,
              departments: [{ department: 'hse', status: 'blocked' }], overdue_actions: [{ description: 'Fix X', owner: 'Jean', target_date: '2026-07-20' }] },
  inspection: { inspections_done: 1, findings_critical_major: 2, overall_risk: 'major', overdue_actions: [] },
  helpdesk: { created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1, top_categories: [{ category: 'Network', count: 12 }], recurring: [{ label: 'Network / WAN', count: 4 }] },
  technicians: [{ name: 'Amina', assigned: 20, resolved: 18, avg_resolution_h: 6, reopened: 1, current_load: 4, alerts: ['overloaded'] }],
  recommended: [{ kind: 'escalate', text: '1 HIGH issue(s) open — escalate to council if unresolved' }],
};

test('returns subject + htmlBody + fullHtml', () => {
  const r = composeCoordinator(data);
  assert.match(r.subject, /Hounde/);
  assert.match(r.subject, /July 2026/);
  assert.ok(r.htmlBody.length > 200);
  assert.ok(r.fullHtml.length >= r.htmlBody.length);
});

test('email body is Outlook-safe: no <script>, no external CSS link, table-based', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.ok(!/<script/i.test(htmlBody), 'no script tags');
  assert.ok(!/<link[^>]+stylesheet/i.test(htmlBody), 'no external stylesheet');
  assert.match(htmlBody, /<table/i);
});

test('surfaces the score, the RAG, and both moves', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /62/);
  assert.match(htmlBody, /amber/i);
  assert.match(htmlBody, /missing department PV/);
  assert.match(htmlBody, /Close 4 open issue/);
});

test('surfaces the recommended actions + the overdue action owner', () => {
  const { htmlBody } = composeCoordinator(data);
  assert.match(htmlBody, /escalate to council/);
  assert.match(htmlBody, /Jean/);
});

test('escapes HTML in free-text (no injection from ticket subjects)', () => {
  const evil = JSON.parse(JSON.stringify(data));
  evil.meetings.overdue_actions[0].description = '<img src=x onerror=alert(1)>';
  const { htmlBody } = composeCoordinator(evil);
  assert.ok(!/<img src=x/i.test(htmlBody), 'raw tag must not survive');
  assert.match(htmlBody, /&lt;img/);
});

test('empty/zero data still composes without throwing', () => {
  const r = composeCoordinator({ site_code: 'X', period: { label: 'Aug 2026' }, score: { composite: 0, rag: 'red', two_moves: [] },
    meetings: { departments: [], overdue_actions: [] }, inspection: { overdue_actions: [] }, helpdesk: { top_categories: [], recurring: [] },
    technicians: [], recommended: [] });
  assert.ok(r.subject && r.htmlBody);
});
