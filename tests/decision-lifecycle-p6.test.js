'use strict';
// A5 (P6) — pure rules: motive on every transition (decision_motive_required), proposer ≠ confirmer, decision cycle time,
// two-person soft delete, break-glass time-box. No database.
const { test } = require('node:test');
const assert = require('node:assert');
const DL = require('../services/decisionLifecycle');
const DC = require('../services/decisionCycle');
const SD = require('../services/softDelete');
const BG = require('../services/breakglassGuard');

test('motive switch off = today: free mode needs no reason; enforced mode keeps its three reasoned transitions', () => {
  assert.equal(DL.resolve('open', 'done', { enforced: false }).ok, true);
  assert.equal(DL.resolve('open', 'in_progress', { actor: 'committee', enforced: true }).ok, true);
});

test('motive switch on: EVERY change needs a reason, in both modes; a no-op does not', () => {
  for (const enforced of [false, true]) {
    const r = DL.resolve('open', 'in_progress', { actor: 'committee', enforced, motive: true });
    assert.equal(r.code, 'REASON_REQUIRED', `enforced=${enforced}`); assert.equal(r.status, 400);
    assert.match(r.error, /reason is required/);   // the cockpit asks once and retries on this wording
    assert.equal(DL.resolve('open', 'in_progress', { actor: 'committee', enforced, motive: true, reason: 'kick-off done' }).ok, true);
    assert.equal(DL.resolve('open', 'open', { actor: 'committee', enforced, motive: true }).ok, true, 'no change, no motive');
  }
  assert.equal(DL.resolve('in_progress', 'done', { actor: 'site', enforced: true, motive: true, reason: 'cable laid' }).to, 'awaiting_confirmation');
  assert.ok(DL.allowed('open', 'committee', { enforced: true, motive: true }).every((t) => t.reason === true));
});

test('SoD: the proposer of a completion cannot confirm it; anyone else (or unknown proposer) is not refused here', () => {
  const r = DL.selfConfirmRefusal({ from: 'awaiting_confirmation', to: 'done', proposerId: 7, actorId: 7 });
  assert.equal(r.status, 403); assert.equal(r.code, 'SELF_CONFIRM');
  assert.equal(DL.selfConfirmRefusal({ from: 'awaiting_confirmation', to: 'done', proposerId: 7, actorId: 8 }), null);
  assert.equal(DL.selfConfirmRefusal({ from: 'awaiting_confirmation', to: 'done', proposerId: null, actorId: 8 }), null);
  assert.equal(DL.selfConfirmRefusal({ from: 'awaiting_confirmation', to: 'in_progress', proposerId: 7, actorId: 7 }), null, 'the proposer may withdraw');
  assert.equal(DL.selfConfirmRefusal({ from: 'in_progress', to: 'done', proposerId: 7, actorId: 7 }), null);
});

test('decision cycle: mean / median days over adopted decisions in the window; none adopted = UNKNOWN (null), never 0', () => {
  assert.deepEqual(DC.cycle([]).value, null);
  assert.equal(DC.cycle([{ id: 1, created_at: '2026-10-01T00:00:00Z', adopted_at: null }]).state, 'UNKNOWN');
  const rows = [
    { id: 1, ref: 'DEC-1', created_at: '2026-10-01T00:00:00Z', adopted_at: '2026-10-03T00:00:00Z', adopted_source: 'ppm_events' },   // 2 d
    { id: 2, ref: 'DEC-2', created_at: new Date('2026-10-01T00:00:00Z'), adopted_at: '2026-10-11T12:00:00Z', adopted_source: 'closed_at' }, // 10.5 d
    { id: 3, ref: 'DEC-3', created_at: '2026-10-01T00:00:00Z', adopted_at: '2026-09-01T00:00:00Z' },   // before creation → unreadable, never 0
    { id: 4, ref: 'DEC-4', created_at: '2026-01-01T00:00:00Z', adopted_at: '2026-02-01T00:00:00Z' },   // outside the window
  ];
  const c = DC.cycle(rows, { from: '2026-09-15', to: '2026-10-31' });
  assert.equal(c.n, 2); assert.equal(c.value, 6.3); assert.equal(c.median, 6.3); assert.equal(c.unreadable, 1);
  assert.deepEqual(c.decisions.map((d) => d.source), ['ppm_events', 'closed_at']);
});

test('two-person soft delete: reason ≥ 10 → request; requester refused; another person confirms; stale request = new request', () => {
  assert.equal(SD.twoPersonEnabled({ soft_delete_enabled: '0', soft_delete_two_person: '1' }), false, 'only with soft delete on');
  assert.equal(SD.twoPersonEnabled({ soft_delete_enabled: '1', soft_delete_two_person: '1' }), true);
  assert.equal(SD.twoPersonStep({ reason: 'short' }).code, 'REASON_REQUIRED');
  assert.equal(SD.twoPersonStep({ reason: 'duplicate of P-12 programme' }).step, 'request');
  const last = { action: 'requested', actor_id: 5, note: 'duplicate of P-12 programme', at: new Date().toISOString() };
  assert.equal(SD.twoPersonStep({ last, userId: 5 }).code, 'SECOND_PERSON_REQUIRED');
  const ok = SD.twoPersonStep({ last, userId: 6 });
  assert.equal(ok.step, 'confirm'); assert.equal(ok.requested_by, 5); assert.equal(ok.reason, 'duplicate of P-12 programme');
  const stale = { ...last, at: new Date(Date.now() - 8 * 86400000).toISOString() };
  assert.equal(SD.twoPersonStep({ last: stale, userId: 6, reason: 'x' }).code, 'REASON_REQUIRED', 'an expired request is not confirmable');
  assert.equal(SD.twoPersonStep({ last: { ...last, action: 'confirmed' }, userId: 6, reason: 'deleted again later' }).step, 'request');
});

test('break-glass time-box: only a break-glass USE with the switch on; reason ≥ 10; minutes clamped', () => {
  const sso = { mode: 'available', breakglassUser: 'bg' };
  assert.deepEqual(BG.decide({ cfg: {}, sso, username: 'bg' }), { applies: false }, 'switch off = today');
  assert.deepEqual(BG.decide({ cfg: { breakglass_timebox_enabled: '1' }, sso: { mode: 'off', breakglassUser: 'bg' }, username: 'bg' }), { applies: false }, 'SSO off: an ordinary admin');
  assert.deepEqual(BG.decide({ cfg: { breakglass_timebox_enabled: '1' }, sso, username: 'someone' }), { applies: false });
  assert.equal(BG.decide({ cfg: { breakglass_timebox_enabled: '1' }, sso, username: 'bg', reason: 'Entra' }).refuse.code, 'REASON_REQUIRED');
  const d = BG.decide({ cfg: { breakglass_timebox_enabled: '1', breakglass_session_minutes: '30' }, sso, username: 'bg', reason: 'Entra outage since 08:00' });
  assert.equal(d.applies, true); assert.equal(d.minutes, 30);
  assert.equal(BG.minutesFrom({ breakglass_session_minutes: '1' }), 5); assert.equal(BG.minutesFrom({ breakglass_session_minutes: '99999' }), 1440);
  assert.equal(BG.minutesFrom({}), 60);
});
