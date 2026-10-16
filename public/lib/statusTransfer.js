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
    if (!String(note || '').trim()) return 'Un commentaire est obligatoire pour passer en « ' + LABELS[norm(status)].fr + ' ».';
    if (needsTicket(status) && !normalizeTicket(ticket)) return 'Le numéro du ticket Helpdesk (SDP) est obligatoire.';
    return null;
  }

  function label(s, lang) {
    const l = LABELS[norm(s)];
    return l ? (l[lang === 'en' ? 'en' : 'fr']) : String(s || '');
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
        '<div style="font-weight:700;font-size:16px;margin-bottom:4px">Passer en « ' + esc(LABELS[st].fr) + ' »</div>' +
        (opts.title ? '<div style="color:#64748b;font-size:12.5px;margin-bottom:12px">' + esc(opts.title) + '</div>' : '<div style="height:8px"></div>') +
        (wantTicket ? '<label style="display:block;font-weight:600;font-size:12.5px;margin-bottom:4px">N° du ticket Helpdesk (SDP) *</label>' +
          '<input data-k="ticket" inputmode="numeric" placeholder="ex. 311587" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px" value="' + esc(opts.ticket || '') + '">' : '') +
        '<label style="display:block;font-weight:600;font-size:12.5px;margin-bottom:4px">Commentaire / justification *</label>' +
        '<textarea data-k="note" rows="4" maxlength="' + NOTE_MAX + '" placeholder="Pourquoi ce changement ?" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;resize:vertical"></textarea>' +
        '<div data-k="err" style="color:#b91c1c;font-size:12.5px;min-height:18px;margin-top:6px"></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">' +
        '<button type="button" data-k="cancel" style="padding:8px 14px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">Annuler</button>' +
        '<button type="button" data-k="ok" style="padding:8px 14px;border:0;background:#EF631A;color:#fff;font-weight:600;border-radius:8px;cursor:pointer">Confirmer</button>' +
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

  return { TRANSFER, DONE, LABELS, NOTE_MAX, isTransfer, isDone, needsTicket, normalizeTicket, validate, label, ask };
});
