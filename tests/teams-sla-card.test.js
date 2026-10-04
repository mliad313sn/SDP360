'use strict';
// Teams SLA alerts — the card posted to a group's channel (Workflows webhook payload,
// Adaptive Card 1.4, French — the technicians read Teams in French).
const test = require('node:test');
const assert = require('node:assert');
const { buildGroupCard, ticketUrl } = require('../services/teamsCard');

const A = (o) => ({ kind: 'fr_soon', request_id: '91000000123', display_id: '4521', subject: 'VPN down', p: 'P1',
  group: 'Mana IT Agents', technician: 'Jean', site: 'MANA', minutes: 8, ...o });
const BASE = 'https://oneitsupport.endeavourmining.com/app/itdesk/api/v3';
const text = (card) => JSON.stringify(card.attachments[0].content.body);

test('ticketUrl derives the SDP UI link from the API base', () => {
  assert.equal(ticketUrl(BASE, '91000000123'), 'https://oneitsupport.endeavourmining.com/app/itdesk/ui/requests/91000000123/details');
});

test('the payload is a Workflows message carrying one Adaptive Card', () => {
  const c = buildGroupCard('Mana IT Agents', [A()], { apiBaseUrl: BASE });
  assert.equal(c.type, 'message');
  assert.equal(c.attachments.length, 1);
  assert.equal(c.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(c.attachments[0].content.type, 'AdaptiveCard');
  assert.equal(c.attachments[0].content.version, '1.4');
  assert.match(text(c), /Mana IT Agents/);
});

test('sections come in urgency order, each ticket with its link, priority and time', () => {
  const c = buildGroupCard('G', [
    A({ kind: 'res_soon', display_id: '1', minutes: 50 }),
    A({ kind: 'fr_breach', display_id: '2', minutes: -5 }),
    A({ kind: 'unassigned', display_id: '3', technician: '', minutes: -45 }),
  ], { apiBaseUrl: BASE });
  const t = text(c);
  const iBreach = t.indexOf('1re réponse dépassée'), iRes = t.indexOf('Résolution bientôt due'), iUn = t.indexOf('Non assigné');
  assert.ok(iBreach > -1 && iRes > iBreach && iUn > iRes, t);
  assert.match(t, /\[#2\]\(https:\/\/oneitsupport[^)]+\/ui\/requests\/91000000123\/details\)/);
  assert.match(t, /dépassé de 5 min/);
  assert.match(t, /reste 50 min/);
  assert.match(t, /sans technicien depuis 45 min/);
});

test('long lists are capped with a "+ N autres" line; brackets in subjects cannot break links', () => {
  const many = Array.from({ length: 20 }, (_, i) => A({ display_id: String(i), subject: 'Bug [urgent]' }));
  const t = text(buildGroupCard('G', many, { apiBaseUrl: BASE, maxTickets: 15 }));
  assert.match(t, /\+ 5 autres/);
  assert.ok(!t.includes('[urgent]'), 'brackets neutralised');
});

test('hours are shown as hours beyond 90 minutes', () => {
  assert.match(text(buildGroupCard('G', [A({ kind: 'res_soon', minutes: 185 })], { apiBaseUrl: BASE })), /reste 3 h 05/);
});

test('the ticket link is the SAME as the Helpdesk module (dashboard-shared sdpTicketUrl)', () => {
  const shared = require('fs').readFileSync(require('path').join(__dirname, '../public/lib/dashboard-shared.js'), 'utf8');
  const base = shared.match(/const SDP_TICKET_URL_BASE = '([^']+)'/)[1];
  assert.equal(ticketUrl(BASE, '91000000123'), base + '91000000123/details');
});
