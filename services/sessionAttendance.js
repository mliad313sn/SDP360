'use strict';
// E-G03 (audit G-03) — PURE: attendance of a governance session and its quorum state.
//   attendance: [{ participant, status: present|absent|excused, recorded_by, recorded_at }]  (null = not recorded)
//   quorum_min: governance policy `governance.quorum_min` — null = NOT DEFINED (the minutes then say
//   "quorum not defined", never "quorate"). Excused people do not count as present.
const STATUSES = ['present', 'absent', 'excused'];

/** Validate + normalise what the secretary posts; one line per participant (the last one wins). */
function normalize(list, { by = null, at = new Date().toISOString() } = {}) {
  if (!Array.isArray(list)) throw Object.assign(new Error('attendance must be a list'), { code: 'INVALID', status: 400 });
  const out = new Map();
  for (const x of list.slice(0, 100)) {
    const who = String((x && x.participant) || '').trim().slice(0, 120);
    if (!who) throw Object.assign(new Error('each attendance line names a participant'), { code: 'INVALID', status: 400 });
    if (!STATUSES.includes(x.status)) throw Object.assign(new Error(`attendance status must be one of ${STATUSES.join(', ')}`), { code: 'INVALID', status: 400 });
    out.set(who.toLowerCase(), { participant: who, status: x.status, recorded_by: by, recorded_at: at });
  }
  return [...out.values()];
}

/** { state: 'not_recorded' | 'not_defined' | 'quorate' | 'not_quorate', present, required } */
function quorum(attendance, quorumMin) {
  const present = Array.isArray(attendance) ? attendance.filter((a) => a.status === 'present').length : null;
  const required = quorumMin == null || quorumMin === '' || !Number.isFinite(Number(quorumMin)) ? null : Number(quorumMin);
  if (present == null) return { state: 'not_recorded', present: null, required };
  if (required == null) return { state: 'not_defined', present, required: null };
  return { state: present >= required ? 'quorate' : 'not_quorate', present, required };
}

const LABEL = { not_recorded: 'attendance not recorded', not_defined: 'quorum not defined', quorate: 'quorate', not_quorate: 'NOT quorate' };
function quorumText(q) { return q.required == null ? LABEL[q.state] : `${LABEL[q.state]} (${q.present == null ? '—' : q.present} present / ${q.required} required)`; }

module.exports = { STATUSES, normalize, quorum, quorumText };
