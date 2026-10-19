'use strict';
// Business Incubation entered by hand in meeting.html (2026-10-03): the extras blob
// (roles, session end/duration, business description, information flow, services) is
// normalised server-side before it is stored. Service status is a CLOSED list
// (user decision): active · in_progress · planned · stopped — free text from the Word
// template / older imports ("Actif", "En cours"…) is mapped onto it, anything else → ''.
const test = require('node:test');
const assert = require('node:assert');
const { SERVICE_STATUSES, normalizeServiceStatus, normalizeIncubation } = require('../services/incubationForm');

test('the closed list of service statuses', () => {
  assert.deepEqual(SERVICE_STATUSES, ['active', 'in_progress', 'planned', 'stopped']);
});

test('normalizeServiceStatus maps EN/FR labels onto the closed list', () => {
  for (const [v, want] of [['active', 'active'], ['Actif', 'active'], ['ACTIVE', 'active'],
    ['En cours', 'in_progress'], ['in progress', 'in_progress'], ['in_progress', 'in_progress'],
    ['Prévu', 'planned'], ['planifié', 'planned'], ['Planned', 'planned'],
    ['Arrêté', 'stopped'], ['inactif', 'stopped'], ['Stopped', 'stopped']]) {
    assert.equal(normalizeServiceStatus(v), want, v);
  }
  assert.equal(normalizeServiceStatus('whatever'), '');
  assert.equal(normalizeServiceStatus(null), '');
});

test('normalizeIncubation trims, drops empty rows, normalises statuses', () => {
  const out = normalizeIncubation({
    roles: { incubator: '  Jean  ', incubator_title: 'Géologue', incubation_manager: 'Ghislain', it_manager: 'Eric', junk: 'x' },
    session_end: '2026-08-22', duration: ' 2 jours ', business_description: '  La géologie…  ',
    flow: [{ incoming: 'Forage', activity: 'Analyse', outgoing: 'Modèles' }, { incoming: ' ', activity: '', outgoing: '' }],
    services: [{ service: 'Data Mobile', beneficiary: 'Tous', status: 'Actif' }, { service: '', beneficiary: 'x', status: 'active' }],
    evil: '<script>',
  });
  assert.deepEqual(out, {
    roles: { incubator: 'Jean', incubator_title: 'Géologue', incubation_manager: 'Ghislain', it_manager: 'Eric' },
    session_end: '2026-08-22', duration: '2 jours', business_description: 'La géologie…',
    flow: [{ incoming: 'Forage', activity: 'Analyse', outgoing: 'Modèles' }],
    services: [{ service: 'Data Mobile', beneficiary: 'Tous', status: 'active' }],
  });
});

test('normalizeIncubation tolerates nothing and rejects a non-ISO end date', () => {
  assert.deepEqual(normalizeIncubation(null), {
    roles: { incubator: '', incubator_title: '', incubation_manager: '', it_manager: '' },
    session_end: null, duration: '', business_description: '', flow: [], services: [],
  });
  assert.equal(normalizeIncubation({ session_end: '22/08/2026' }).session_end, null);
});

test('normalizeIncubation caps runaway sizes', () => {
  const big = 'x'.repeat(20000);
  const out = normalizeIncubation({ business_description: big, flow: Array.from({ length: 200 }, () => ({ activity: 'a' })) });
  assert.ok(out.business_description.length <= 8000);
  assert.ok(out.flow.length <= 50);
});
