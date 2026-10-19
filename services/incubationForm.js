'use strict';
// Business Incubation extras — PURE normaliser for the blob stored in
// md_meetings.incubation_json (2026-10-03: the session can now be entered by hand in
// meeting.html, not only through the xlsx import). Mirrors the Incubation Follow-up
// Report: §1 roles + session end/duration, §2 business description, §3 information
// flow, §4 services provided. §5 (challenges) are the meeting's ordinary issues.
// Service status is a CLOSED list (user decision 2026-10-03).

const SERVICE_STATUSES = ['active', 'in_progress', 'planned', 'stopped'];

const _fold = (v) => String(v == null ? '' : v).trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_-]+/g, ' ');

function normalizeServiceStatus(v) {
  const s = _fold(v);
  if (!s) return '';
  if (/^(active|actif|active?s?)$/.test(s)) return 'active';
  if (/^(in progress|en cours|ongoing)$/.test(s)) return 'in_progress';
  if (/^(planned|prevu|planifie|a venir|todo)$/.test(s)) return 'planned';
  if (/^(stopped|arrete|inactif|inactive|stoppe|termine)$/.test(s)) return 'stopped';
  return '';
}

const _str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const MAX_ROWS = 50;

function normalizeIncubation(inc) {
  const i = inc && typeof inc === 'object' ? inc : {};
  const r = i.roles && typeof i.roles === 'object' ? i.roles : {};
  const end = _str(i.session_end, 10);
  const flow = (Array.isArray(i.flow) ? i.flow : [])
    .map(f => ({ incoming: _str(f && f.incoming, 2000), activity: _str(f && f.activity, 2000), outgoing: _str(f && f.outgoing, 2000) }))
    .filter(f => f.incoming || f.activity || f.outgoing)
    .slice(0, MAX_ROWS);
  const services = (Array.isArray(i.services) ? i.services : [])
    .map(x => ({ service: _str(x && x.service), beneficiary: _str(x && x.beneficiary), status: normalizeServiceStatus(x && x.status) }))
    .filter(x => x.service)
    .slice(0, MAX_ROWS);
  return {
    roles: {
      incubator: _str(r.incubator, 200), incubator_title: _str(r.incubator_title, 200),
      incubation_manager: _str(r.incubation_manager, 200), it_manager: _str(r.it_manager, 200),
    },
    session_end: /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null,
    duration: _str(i.duration, 100),
    business_description: _str(i.business_description, 8000),
    flow, services,
  };
}

module.exports = { SERVICE_STATUSES, normalizeServiceStatus, normalizeIncubation };
