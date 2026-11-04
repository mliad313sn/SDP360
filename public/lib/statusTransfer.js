/* Meetings issues & actions — "transfer" statuses (2026-10-16).
 *
 * Besides open / in_progress / … / resolved, an issue or an action can leave the register:
 *   demand          → turned into a Demand / Initiative (handled outside the PV)
 *   helpdesk_ticket → turned into a Helpdesk ticket (SDP ticket number REQUIRED)
 *   cancelled       → dropped
 * All three need a justification comment. They count like "cancelled": out of the open and
 * overdue lists, never as "resolved" in the programme score.
 *
 * UMD: the same rule runs in the browser (modal before the change) and on the server
 * (refusal when the comment / ticket number is missing).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StatusTransfer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TRANSFER = ['demand', 'helpdesk_ticket', 'cancelled'];
  // Every status that takes an item out of the open register (md_issues + md_actions).
  const DONE = ['resolved', 'cancelled', 'closed', 'demand', 'helpdesk_ticket'];
  const LABELS = {
    demand:          { fr: 'Demande / Initiative', en: 'Demand / Initiative' },
    helpdesk_ticket: { fr: 'Ticket Helpdesk',      en: 'Helpdesk ticket' },
    cancelled:       { fr: 'Annulé',               en: 'Cancelled' },
  };
  const NOTE_MAX = 2000;
  // Display labels for EVERY issue / action status (2026-10-16: the pages are in English — no
  // raw codes, no mixed languages). Codes outside the map (e.g. inspection 'In Progress') pass through.
  const STATUS_EN = {
    open: 'Open', in_progress: 'In progress', blocked: 'Blocked', on_hold: 'On hold',
    resolved: 'Resolved', closed: 'Closed', cancelled: 'Cancelled',
    demand: 'Demand / Initiative', helpdesk_ticket: 'Helpdesk ticket',
  };

  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const isTransfer = (s) => TRANSFER.includes(norm(s));
  const isDone = (s) => DONE.includes(norm(s));
  const needsTicket = (s) => norm(s) === 'helpdesk_ticket';

  // SDP ticket number: digits only ("#311587", "INC 311587" → "311587"); null when unusable.
  function normalizeTicket(raw) {
    const d = String(raw == null ? '' : raw).replace(/\D/g, '');
    return d.length >= 3 && d.length <= 18 ? d : null;
  }

  // null when the change may go through, else the reason (FR — shown to the user).
  function validate(status, note, ticket) {
    if (!isTransfer(status)) return null;
    if (!String(note || '').trim()) return 'A justification comment is required to set "' + LABELS[norm(status)].en + '".';
    if (needsTicket(status) && !normalizeTicket(ticket)) return 'The Helpdesk ticket number (SDP) is required.';
    return null;
  }

  function label(s, lang) {
    if (lang === 'fr') { const l = LABELS[norm(s)]; if (l) return l.fr; }
    return STATUS_EN[norm(s).replace(/\s+/g, '_')] || String(s || '');   // 'In Progress' (inspections) → 'In progress'
  }


  // A-05 (2026-11): ONE vocabulary for md_issues / md_actions. 'closed' was never a seeded
  // md_statuses code (the field app sent it until field-v3, and queued envelopes / stale pages
  // may still do so) — it means "resolved". Every other code passes through, trimmed and
  // lowercased. null/undefined stay as they are (no value is not a status).
  function normalizeMeetingStatus(s) {
    if (s == null) return s;
    const n = norm(s);
    return n === 'closed' ? 'resolved' : n;
  }

  // <option> list for a status <select> that ALWAYS keeps the stored code selected. A code
  // outside the list (e.g. a legacy 'closed') is prepended as "<label> (legacy)" instead of the
  // browser silently showing the first option — which the next unrelated edit would save.
  // list: [{code, name_en}] or plain codes. Empty current → opts.defaultCode (default 'open').
  function optionsHtml(list, current, escFn, opts) {
    opts = opts || {};
    const e = escFn || ((t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const items = (list || []).map((x) => (x && typeof x === 'object')
      ? { code: String(x.code), name: x.name_en || label(x.code) }
      : { code: String(x), name: label(x) });
    const raw = current == null ? '' : String(current);
    const cur = raw.trim() === '' ? (opts.defaultCode != null ? String(opts.defaultCode) : 'open') : raw;
    let sel = items.findIndex((it) => it.code === cur);
    if (sel < 0) sel = items.findIndex((it) => norm(it.code) === norm(cur));
    let html = '';
    if (sel < 0 && cur !== '') html += '<option value="' + e(cur) + '" selected>' + e(label(cur) + ' (legacy)') + '</option>';
    html += items.map((it, i) => '<option value="' + e(it.code) + '"' + (i === sel ? ' selected' : '') + '>' + e(it.name) + '</option>').join('');
    return html;
  }

  // Browser only: modal asking the justification (+ ticket number). Resolves to
  // { note, ticket } or null when the user cancels — the caller then reverts its select.
  function ask(status, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (typeof document === 'undefined') return resolve(null);
      const st = norm(status);
      const wantTicket = needsTicket(st);
      const ov = document.createElement('div');
      ov.setAttribute('role', 'dialog');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
      const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      ov.innerHTML =
        '<div style="background:#fff;border-radius:12px;max-width:520px;width:100%;padding:20px 22px;box-shadow:0 20px 50px rgba(0,0,0,.25);font:14px/1.45 var(--font-sans,system-ui,sans-serif);color:#1e293b">' +
        '<div style="font-weight:700;font-size:16px;margin-bottom:4px">Set status to "' + esc(LABELS[st].en) + '"</div>' +
        (opts.title ? '<div style="color:#64748b;font-size:12.5px;margin-bottom:12px">' + esc(opts.title) + '</div>' : '<div style="height:8px"></div>') +
        (wantTicket ? '<label style="display:block;font-weight:600;font-size:12.5px;margin-bottom:4px">Helpdesk ticket number (SDP) *</label>' +
          '<input data-k="ticket" inputmode="numeric" placeholder="e.g. 311587" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px" value="' + esc(opts.ticket || '') + '">' : '') +
        '<label style="display:block;font-weight:600;font-size:12.5px;margin-bottom:4px">Justification comment *</label>' +
        '<textarea data-k="note" rows="4" maxlength="' + NOTE_MAX + '" placeholder="Why this change?" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;resize:vertical"></textarea>' +
        '<div data-k="err" style="color:#b91c1c;font-size:12.5px;min-height:18px;margin-top:6px"></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">' +
        '<button type="button" data-k="cancel" style="padding:8px 14px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">Cancel</button>' +
        '<button type="button" data-k="ok" style="padding:8px 14px;border:0;background:#EF631A;color:#fff;font-weight:600;border-radius:8px;cursor:pointer">Confirm</button>' +
        '</div></div>';
      const q = (k) => ov.querySelector('[data-k="' + k + '"]');
      const done = (v) => { document.removeEventListener('keydown', onKey); ov.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(null); };
      q('cancel').onclick = () => done(null);
      ov.addEventListener('click', (e) => { if (e.target === ov) done(null); });
      q('ok').onclick = () => {
        const note = q('note').value.trim();
        const ticket = wantTicket ? normalizeTicket(q('ticket').value) : null;
        const err = validate(st, note, wantTicket ? (ticket || '') : null);
        if (err) { q('err').textContent = err; return; }
        done({ note: note.slice(0, NOTE_MAX), ticket });
      };
      document.addEventListener('keydown', onKey);
      document.body.appendChild(ov);
      (wantTicket ? q('ticket') : q('note')).focus();
    });
  }

  return { TRANSFER, DONE, LABELS, STATUS_EN, NOTE_MAX, isTransfer, isDone, needsTicket, normalizeTicket, validate, label, ask, normalizeMeetingStatus, optionsHtml };
});
