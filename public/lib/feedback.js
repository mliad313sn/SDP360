// E-B07 (audit B-07) — the in-app feedback dialog. Loaded on demand by public/_shell.js when the user clicks
// "Feedback" (button shown only while report_config ui_feedback_enabled = '1'). Built with createElement and
// textContent only: nothing the user types is ever parsed as HTML. No AI reads the text; nothing is sent
// anywhere but POST /api/feedback on this server.
(function () {
  'use strict';
  if (window.__feedback) return;
  const MAX = 2000;
  const lang = (() => { try { return (window.__shell && window.__shell.shellLang && window.__shell.shellLang()) || 'en'; } catch (_) { return 'en'; } })();
  const L = {
    en: { title: 'Feedback on this page', kind: 'Type', problem: 'Problem', idea: 'Idea', question: 'Question', text: 'Your message',
      anon: 'Send anonymously (only your role and site are kept)', send: 'Send', cancel: 'Cancel', sent: 'Thank you — your feedback was recorded.',
      empty: 'Please write a message.', fail: 'Could not send: ' },
    fr: { title: 'Retour sur cette page', kind: 'Type', problem: 'Problème', idea: 'Idée', question: 'Question', text: 'Votre message',
      anon: 'Envoyer anonymement (seuls votre rôle et votre site sont gardés)', send: 'Envoyer', cancel: 'Annuler', sent: 'Merci — votre retour est enregistré.',
      empty: 'Écrivez un message.', fail: "Envoi impossible : " },
  };
  const T = L[lang === 'fr' ? 'fr' : 'en'];
  const el = (tag, attrs, text) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  const pageId = () => (String(location.pathname || '').split('/').pop() || 'index.html').slice(0, 120);

  function open() {
    if (document.getElementById('fbDialog')) return;
    const wrap = el('div', { id: 'fbDialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fbTitle', class: 'fb-dialog' });
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999';
    const box = el('form', { class: 'fb-box' });
    box.style.cssText = 'background:var(--color-surface, white);color:var(--color-text, black);padding:16px;border-radius:8px;width:min(480px,92vw);display:flex;flex-direction:column;gap:8px';
    box.appendChild(el('h2', { id: 'fbTitle' }, T.title));
    const pg = el('p', { class: 'fb-page' }, pageId());
    pg.style.cssText = 'margin:0;color:var(--color-text-muted)';
    box.appendChild(pg);
    const kl = el('label', {}, T.kind + ' ');
    const sel = el('select', { name: 'kind' });
    for (const k of ['problem', 'idea', 'question']) sel.appendChild(el('option', { value: k }, T[k]));
    kl.appendChild(sel); box.appendChild(kl);
    const tl = el('label', {}, T.text);
    const ta = el('textarea', { name: 'text', maxlength: String(MAX), rows: '6' });
    ta.style.width = '100%';
    tl.appendChild(ta); box.appendChild(tl);
    const al = el('label', {});
    const cb = el('input', { type: 'checkbox', name: 'anonymous' });
    al.appendChild(cb); al.appendChild(document.createTextNode(' ' + T.anon)); box.appendChild(al);
    const msg = el('p', { 'aria-live': 'polite', class: 'fb-msg' });
    box.appendChild(msg);
    const row = el('div', {});
    const send = el('button', { type: 'submit' }, T.send);
    const cancel = el('button', { type: 'button' }, T.cancel);
    row.appendChild(send); row.appendChild(cancel); box.appendChild(row);
    wrap.appendChild(box);
    const close = () => wrap.remove();
    cancel.addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
    box.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) { msg.textContent = T.empty; return; }
      send.disabled = true;
      try {
        const r = await fetch('/api/feedback', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: sel.value, text: text.slice(0, MAX), page: pageId(), anonymous: cb.checked }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        msg.textContent = T.sent;
        setTimeout(close, 1500);
      } catch (err) { msg.textContent = T.fail + err.message; send.disabled = false; }
    });
    document.body.appendChild(wrap);
    ta.focus();
  }
  window.__feedback = { open };
})();
