/* Inline dialog that replaces window.prompt() for reasons, receivers and notes (committee review
 * 2026-10-28, field P1-5): some embedded browsers (Teams webview, Android in-app browsers) suppress
 * prompt() — the action then silently did nothing — and on a tablet it cannot show the minimum length.
 *
 *   ReasonDialog.ask({ title, label, min, lang, value, multiline, placeholder }) → Promise<string|null>
 *   ReasonDialog.form({ title, fields:[{ name, label, type:'text'|'select'|'number', options:[{value,label}], min, value }], lang }) → Promise<object|null>
 *
 * Built with createElement + textContent only (no innerHTML from data); Escape / Cancel resolve null.
 */
(function (root) {
  'use strict';
  const T = { en: { ok: 'Confirm', cancel: 'Cancel', min: (n) => `${n} characters minimum`, count: (n) => `${n} character${n === 1 ? '' : 's'}` },
    fr: { ok: 'Valider', cancel: 'Annuler', min: (n) => `${n} caractères minimum`, count: (n) => `${n} caractère${n > 1 ? 's' : ''}` } };
  const el = (tag, props, kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); for (const k of kids || []) if (k) e.appendChild(k); return e; };
  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const css = '.rd-back{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}'
      + '.rd-box{background:#fff;color:#1F2A33;border-radius:12px;max-width:520px;width:100%;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:14px/1.4 var(--font-sans,sans-serif)}'
      + '.rd-box h2{font-size:16px;margin:0 0 10px}.rd-box label{display:block;font-size:13px;margin:8px 0 4px}'
      + '.rd-box textarea,.rd-box input,.rd-box select{width:100%;box-sizing:border-box;padding:8px;border:1px solid #9AA4B2;border-radius:6px;font:inherit}'
      + '.rd-meta{display:flex;justify-content:space-between;font-size:12px;color:#5B6573;margin-top:4px}.rd-bad{color:#A0002C}'
      + '.rd-act{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.rd-act button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid #9AA4B2;background:#fff;cursor:pointer;min-height:40px}'
      + '.rd-act button.rd-ok{background:#1F2A33;color:#fff;border-color:#1F2A33}.rd-act button[disabled]{opacity:.5;cursor:not-allowed}';
    const s = document.createElement('style');
    const n = document.querySelector('script[nonce]'); if (n && n.nonce) s.nonce = n.nonce;
    s.textContent = css; document.head.appendChild(s);
  }
  function shell(title, lang, body, valid, collect) {
    style();
    const t = T[lang === 'fr' ? 'fr' : 'en'];
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const ok = el('button', { type: 'button', className: 'rd-ok', textContent: t.ok });
      const cancel = el('button', { type: 'button', textContent: t.cancel });
      const h = el('h2', { textContent: title, id: 'rd-title-' + Date.now() });
      const box = el('div', { className: 'rd-box' }, [h, body, el('div', { className: 'rd-act' }, [cancel, ok])]);
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', h.id);
      const back = el('div', { className: 'rd-back' }, [box]);
      const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); try { prev && prev.focus && prev.focus(); } catch (_) {} resolve(v); };
      const refresh = () => { ok.disabled = !valid(); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !ok.disabled) { e.preventDefault(); done(collect()); } };
      ok.addEventListener('click', () => { if (!ok.disabled) done(collect()); });
      cancel.addEventListener('click', () => done(null));
      back.addEventListener('click', (e) => { if (e.target === back) done(null); });
      body.addEventListener('input', refresh); body.addEventListener('change', refresh);
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(back); refresh();
      const first = box.querySelector('textarea,input,select'); if (first) first.focus();
    });
  }
  function ask(o) {
    o = o || {}; const lang = o.lang === 'fr' ? 'fr' : 'en'; const t = T[lang]; const min = Math.max(0, Number(o.min) || 0);
    const id = 'rd-in-' + Date.now();
    const input = o.multiline === false ? el('input', { id, type: 'text', value: o.value || '', placeholder: o.placeholder || '' }) : el('textarea', { id, rows: 3, value: o.value || '', placeholder: o.placeholder || '' });
    const count = el('span'); const need = el('span', { textContent: min ? t.min(min) : '' });
    const upd = () => { const n = input.value.trim().length; count.textContent = t.count(n); need.className = n < min ? 'rd-bad' : ''; };
    input.addEventListener('input', upd); upd();
    const body = el('div', {}, [el('label', { htmlFor: id, textContent: o.label || '' }), input, el('div', { className: 'rd-meta' }, [need, count])]);
    return shell(o.title || '', lang, body, () => input.value.trim().length >= Math.max(min, 1), () => input.value.trim());
  }
  function form(o) {
    o = o || {}; const lang = o.lang === 'fr' ? 'fr' : 'en'; const inputs = {};
    const body = el('div', {});
    (o.fields || []).forEach((f, i) => {
      const id = 'rd-f-' + i + '-' + Date.now();
      let input;
      if (f.type === 'select') { input = el('select', { id }); for (const opt of f.options || []) input.appendChild(el('option', { value: String(opt.value), textContent: opt.label })); if (f.value != null) input.value = String(f.value); }
      else input = el(f.multiline ? 'textarea' : 'input', { id, type: f.type === 'number' ? 'number' : 'text', value: f.value == null ? '' : String(f.value) });
      inputs[f.name] = { input, f };
      body.appendChild(el('label', { htmlFor: id, textContent: f.label + (f.min ? ` (${T[lang].min(f.min)})` : '') })); body.appendChild(input);
    });
    const valid = () => Object.values(inputs).every(({ input, f }) => f.optional || String(input.value).trim().length >= Math.max(1, Number(f.min) || 0));
    const collect = () => Object.fromEntries(Object.entries(inputs).map(([k, { input }]) => [k, String(input.value).trim()]));
    return shell(o.title || '', lang, body, valid, collect);
  }
  root.ReasonDialog = { ask, form };
})(window);
