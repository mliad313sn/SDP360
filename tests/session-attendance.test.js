'use strict';
// E-G03 — attendance, quorum (null = not defined, never "quorate"), scheduled DRAFT agenda (nothing sent).
const test = require('node:test');
const assert = require('node:assert');
const SA = require('../services/sessionAttendance');
const AD = require('../services/agendaDrafts');
const { renderMinutes } = require('../services/minutesRenderer');
const GP = require('../services/governancePolicy');

test('quorum: not recorded / not defined / below / at-or-above; excused is not present', () => {
  const att = [{ participant: 'a', status: 'present' }, { participant: 'b', status: 'present' }, { participant: 'c', status: 'excused' }];
  assert.equal(SA.quorum(null, 3).state, 'not_recorded');
  assert.deepEqual(SA.quorum(att, null), { state: 'not_defined', present: 2, required: null });
  assert.equal(SA.quorum(att, 3).state, 'not_quorate');
  assert.equal(SA.quorum(att, 2).state, 'quorate');
  assert.equal(SA.quorumText(SA.quorum(att, null)), 'quorum not defined');
});

test('normalize: one line per participant, bad status / no name refused', () => {
  const n = SA.normalize([{ participant: 'Ann', status: 'absent' }, { participant: 'ann', status: 'present' }], { by: 7, at: 'T' });
  assert.deepEqual(n, [{ participant: 'ann', status: 'present', recorded_by: 7, recorded_at: 'T' }]);
  assert.throws(() => SA.normalize([{ participant: 'x', status: 'maybe' }]), (e) => e.status === 400);
  assert.throws(() => SA.normalize([{ status: 'present' }]), (e) => e.status === 400);
  assert.throws(() => SA.normalize('x'), (e) => e.status === 400);
});

test('minutes print attendance and the quorum state; never "quorate" when undefined', () => {
  const s = { id: 1, scheduled_at: '2026-11-02T09:00Z', agenda: { items: [] }, items: [], attendance: [{ participant: 'Ann', status: 'present' }] };
  const html = renderMinutes({ session: s, quorum: SA.quorum(s.attendance, null) });
  assert.match(html, /Ann — present/); assert.match(html, /quorum not defined/); assert.ok(!/>quorate/.test(html));
  assert.match(renderMinutes({ session: { ...s, attendance: null } }), /Attendance not recorded/);
});

test('governance.quorum_min: default null (not defined), nullable, protected', () => {
  const p = GP.PARAMS.find((x) => x.key === 'governance.quorum_min');
  assert.equal(p.default, null); assert.equal(GP.coerce(p, ''), null); assert.equal(GP.coerce(p, '4'), 4); assert.equal(p.protected, true);
  assert.equal(GP.relaxes(p, 4, null), true, 'removing a quorum is a relaxation');
});

test('dueThisWeek: ISO weekday today or later in the current week; inactive / no weekday skipped', () => {
  const wed = new Date('2026-11-04T06:00:00Z');   // Wednesday
  const d = AD.dueThisWeek([{ id: 1, weekday: 2, active: true }, { id: 2, weekday: 3, time_local: '14:30', active: true }, { id: 3, weekday: 5, active: true },
    { id: 4, weekday: 5, active: false }, { id: 5, weekday: null, active: true }], wed);
  assert.deepEqual(d.map((x) => [x.cadence.id, x.scheduled_at]), [[2, '2026-11-04T14:30:00Z'], [3, '2026-11-06T09:00:00Z']]);
});

test('agenda draft job: skipped while agenda_cron_enabled = 0; on = a DRAFT stored per due cadence, no session, nothing sent', async () => {
  assert.equal(require('../services/reportConfig').DEFAULTS.agenda_cron_enabled, '0');
  assert.deepEqual(await AD.run({ cfg: { agenda_cron_enabled: '0' } }), { skipped: true, reason: 'agenda_cron_enabled is 0' });
  const saved = [];
  const store = { listCadences: async () => [{ id: 9, key: 'k', weekday: 5, active: true }], saveDraftAgenda: async (id, ag, at) => saved.push({ id, ag, at }) };
  const r = await AD.run({ cfg: { agenda_cron_enabled: '1' }, store, compile: async () => ({ items: [{ kind: 'kpis' }] }), now: new Date('2026-11-02T05:10:00Z') });
  assert.deepEqual(r, { rows: 1, due: 1, errors: [] });
  assert.equal(saved[0].ag.status, 'draft'); assert.equal(saved[0].at, '2026-11-06T09:00:00Z');
  assert.equal(Object.keys(store).includes('createSession'), false);
  assert.deepEqual(await AD.run({ cfg: { agenda_cron_enabled: '1' }, store, compile: null }).then((x) => x.reason), 'cockpit not mounted');
});
