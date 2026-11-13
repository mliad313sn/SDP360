// A-10 — Home ("My work") page. Data: GET /api/me/work (the user's own sites only).
// A block that is null was not measured (source unreadable / absent) and says so — never a zero.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let lang = 'en';
  try { lang = (window.__shell && window.__shell.shellLang && window.__shell.shellLang()) || 'en'; } catch (_) { lang = 'en'; }
  if (lang === 'fr') { document.body.classList.add('lang-fr'); document.documentElement.lang = 'fr'; }   // F-UX-01: French body, French voice
  const MONTHS = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] };
  const L = {
    en: { nm: '— not measured', actions: 'Open actions', open: 'open', overdue: 'overdue', oldest: 'oldest', days: 'days', none: 'nothing open',
      report: 'Weekly report', unsigned: 'PVs to sign', allSigned: 'all signed', insp: 'Last inspection', never: 'none recorded', ago: 'days ago', today: 'today',
      tracker: 'Activity tracker', empty: 'of {t} activities have nothing entered for {m}', full: 'all {t} activities filled for {m}', noAct: 'no activity due in {m}',
      loading: 'Loading…', more: '+ {n} more site(s) not shown', open_pv: 'Open',
      aw: 'Awaiting me', awEv: 'evidence', awNone: 'nothing is waiting for you', awLate: 'late', awSrc: { commitments: 'Commitments to verify', handoffs: 'Handoffs to accept', benefits: 'Benefits to verify', decisions: 'My decisions due within 7 days', pvs: 'PVs to sign' },
      benefits: 'Benefit reviews due', mine: 'Benefits I own — review due', noBenefit: 'none due', missing: 'value missing', awaiting: 'awaiting verification',
      labels: { 'Not started': 'Not started', 'In progress': 'In progress', 'Complete but not submitted': 'Complete but not submitted', 'Submitted': 'Submitted' } },
    fr: { nm: '— non mesuré', actions: 'Actions ouvertes', open: 'ouvertes', overdue: 'en retard', oldest: 'la plus ancienne', days: 'jours', none: 'rien d\'ouvert',
      report: 'Rapport hebdomadaire', unsigned: 'PV à signer', allSigned: 'tous signés', insp: 'Dernière inspection', never: 'aucune enregistrée', ago: 'jours', today: 'aujourd\'hui',
      tracker: 'Suivi d\'activité', empty: 'activités sur {t} sans saisie pour {m}', full: 'les {t} activités sont saisies pour {m}', noAct: 'aucune activité prévue en {m}',
      loading: 'Chargement…', more: '+ {n} autre(s) site(s) non affiché(s)', open_pv: 'Ouvrir',
      aw: 'En attente de moi', awEv: 'preuve', awNone: 'rien ne vous attend', awLate: 'en retard', awSrc: { commitments: 'Engagements à vérifier', handoffs: 'Passations à accepter', benefits: 'Bénéfices à vérifier', decisions: 'Mes décisions dues sous 7 jours', pvs: 'PV à signer' },
      benefits: 'Revues de bénéfices dues', mine: 'Mes bénéfices à revoir', noBenefit: 'aucune', missing: 'valeur manquante', awaiting: 'en attente de vérification',
      labels: { 'Not started': 'Pas commencé', 'In progress': 'En cours', 'Complete but not submitted': 'Complet mais non soumis', 'Submitted': 'Soumis' } },
  };
  const T = L[lang === 'fr' ? 'fr' : 'en'];
  const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);
  // F-UX-09 — report_config ui_home_blocks: '0' (today) = one render, a failed call blanks the page with a message ·
  // '1' = every block shows its own state (StateBadge), a failed call keeps the page and offers a retry, and each
  // site card can be reloaded on its own (focus stays on the card). null is still "not measured", never 0.
  const blocksOn = (() => { try { const p = window.__uiPolicy; return !!(p && p.home_blocks === '1' && window.StateBadge); } catch (_) { return false; } })();
  const SBT = { 'not measured': 'non mesuré', 'Could not load — try again': 'Chargement impossible — réessayez', 'error': 'erreur' };
  const stateHtml = (key, detail) => {
    const SB = window.StateBadge;
    let html = SB.badge(key, detail ? { detail } : undefined);
    if (lang !== 'fr') return html;
    for (const w of [SB.text(key), SB.aria(key)]) if (SBT[w]) html = html.split(w).join(SBT[w]);
    return html;
  };
  // R2-QUEUE (R3) — report_config ui_home_queue: '0' (today) = no queue · '1' = the progressive queue "S1" (lib/homeQueue.js)
  const queueOn = (() => { try { const p = window.__uiPolicy; return !!(p && p.home_queue === '1' && window.HomeQueue); } catch (_) { return false; } })();
  // R2-QUEUE — the person's workspace profile (R1/R2), read only while workspace_profiles_enabled = '1' reaches the
  // browser; null (switch off, 404, any error) = today's Home. Presentation only: it reorders and hides, never adds.
  const profileOn = (() => { try { const p = window.__uiPolicy; return !!(p && p.workspace_profiles === '1' && window.WorkspaceProfiles && window.WorkspaceProfiles.load); } catch (_) { return false; } })();
  let profile = null;
  const nm = blocksOn ? stateHtml('not-measured') : `<span class="hm-nm">${esc(T.nm)}</span>`;
  const row = (k, href, v) => `<li><span class="hm-k">${href ? `<a href="${esc(href)}">${esc(k)}</a>` : esc(k)}</span><span class="hm-v">${v}</span></li>`;

  function siteCard(s) {
    const code = encodeURIComponent(s.code || '');
    const a = s.actions;
    const actions = !a ? nm : (a.open === 0 ? esc(T.none)
      : `${a.open} ${esc(T.open)}${a.overdue ? ` · <span class="hm-late">${a.overdue} ${esc(T.overdue)}</span>` : ''}${a.oldest_days != null ? ` · ${esc(T.oldest)} ${a.oldest_days} ${esc(T.days)}` : ''}`);
    const w = s.weekly_report;
    const report = !w ? nm : `${esc(w.week_label || '')} — ${w.status === 'ready' ? `<span class="hm-late">${esc(T.labels[w.label] || w.label)}</span>` : esc(T.labels[w.label] || w.label)}`;
    const u = s.unsigned_pvs;
    const pvs = !u ? nm : (u.count === 0 ? esc(T.allSigned) : `<b>${u.count}</b><ul class="hm-pv">${u.items.map((m) => `<li><a href="meeting.html?id=${encodeURIComponent(m.id)}">${esc(m.reference || m.id)}</a> <span class="hm-muted">${esc(m.meeting_date || '')}</span></li>`).join('')}</ul>`);
    const i = s.last_inspection;
    const insp = !i ? nm : (!i.date ? esc(T.never) : `${esc(i.date)} · ${i.days_since === 0 ? esc(T.today) : `${i.days_since} ${esc(T.ago)}`}`);
    const t = s.tracker_empty;
    const mon = t ? MONTHS[lang === 'fr' ? 'fr' : 'en'][t.month - 1] : '';
    const trk = !t ? nm : (t.total_cells === 0 ? esc(fill(T.noAct, { m: mon }))
      : t.empty_cells === 0 ? esc(fill(T.full, { t: t.total_cells, m: mon }))
        : `<span class="hm-late">${t.empty_cells}</span> ${esc(fill(T.empty, { t: t.total_cells, m: mon }))}`);
    const bf = s.benefit_reviews;
    const ben = !bf ? nm : (bf.count === 0 ? esc(T.noBenefit) : `<b${bf.items.some((x) => x.overdue) ? ' class="hm-late"' : ''}>${bf.count}</b><ul class="hm-pv">${bf.items.map((x) => `<li><a href="project.html?id=${encodeURIComponent(x.project_id)}#benefits">${esc(x.project_key || x.project_id)}</a> <span class="hm-muted">${esc(x.due_date || '')} · ${esc(x.status === 'missing' ? T.missing : T.awaiting)}</span></li>`).join('')}</ul>`);
    const reload = blocksOn ? ` <button type="button" class="hm-retry" data-site="${esc(s.site_id)}">${esc(lang === 'fr' ? 'Recharger ce site' : 'Reload this site')}</button>` : '';
    return `<section class="hm-card" data-site-card="${esc(s.site_id)}" aria-labelledby="hm-s-${esc(s.site_id)}"><h2 id="hm-s-${esc(s.site_id)}">${esc(s.name || s.code)}${s.code ? ` <span class="hm-muted">${esc(s.code)}</span>` : ''}${reload}</h2>
      <ul class="hm-blocks">
        ${row(T.actions, s.code ? `site-actions.html?site=${code}` : 'site-actions.html', actions)}
        ${row(T.report, w && w.report_id ? `reports.html?report=${encodeURIComponent(w.report_id)}` : 'reports.html', report)}
        ${row(T.unsigned, s.code ? `meetings-unsigned.html?site=${code}` : 'meetings-unsigned.html', pvs)}
        ${row(T.insp, 'inspections.html', insp)}
        ${row(T.tracker, 'activity-tracker.html', trk)}
        ${row(T.benefits, 'portfolio.html', ben)}
      </ul></section>`;
  }

  function shortcuts() {
    if (profile && Array.isArray(profile.visible)) {
      const items = profile.visible.filter((d) => d.href !== 'home.html' && /^[a-z/-]+\.html(?:[?#][A-Za-z0-9_=&#-]*)?$/i.test(String(d.href)));
      $('hmShortcuts').innerHTML = items.map((d) => `<li><a href="${esc(d.href)}">${esc(d.label)}</a></li>`).join('');
      return;
    }
    let ws = null;
    try { ws = window.__shell && window.__shell.workspaceFor ? window.__shell.workspaceFor() : null; } catch (_) { ws = null; }
    const items = ((ws && ws.items) || []).filter((e) => e.href !== 'home.html');
    $('hmShortcuts').innerHTML = items.map((e) => `<li><a href="${esc(e.href)}"${e.target ? ` target="${esc(e.target)}" rel="noopener"` : ''}>${esc(e.label)}</a></li>`).join('');
  }

  // E-U03 — shared page head. Freshness = the time the server computed this inbox (generated_at); a failed
  // call reads "unknown" — never the browser clock.
  function head(j) {
    if (!window.PageHead) return;
    const n = j && Array.isArray(j.sites) ? j.sites.length : null;
    window.PageHead.mount($('pageHead'), {
      lang: lang === 'fr' ? 'fr' : 'en',
      question: { en: 'What does each of my sites need from me today?', fr: 'De quoi chacun de mes sites a-t-il besoin aujourd\'hui ?' },
      scope: n == null ? null : { en: 'Your sites only (' + n + ' shown)', fr: 'Vos sites uniquement (' + n + ' affichés)' },
      window: { en: 'Today' + (j && j.as_of ? ' (' + j.as_of + ')' : '') + ' — overdue = past its target date', fr: 'Aujourd\'hui' + (j && j.as_of ? ' (' + j.as_of + ')' : '') + ' — en retard = date cible dépassée' },
      sources: j && j.generated_at ? [{ label: { en: 'Inbox computed', fr: 'Boîte calculée' }, at: j.generated_at }] : [],
    });
  }

  async function load() {
    $('hmMsg').textContent = T.loading;
    try {
      const r = await fetch('/api/me/work', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      // E-P05 — present only while benefit_owner_link_enabled is on: the benefits this person owns (null = not measured)
      const ob = j.owned_benefits;
      const mine = ob === undefined ? '' : `<section class="hm-card" aria-labelledby="hm-mine"><h2 id="hm-mine">${esc(T.mine)}</h2><ul class="hm-blocks">${row(T.mine, 'portfolio.html', !ob ? nm : (ob.count === 0 ? esc(T.noBenefit) : `<b${ob.items.some((x) => x.overdue) ? ' class="hm-late"' : ''}>${ob.count}</b><ul class="hm-pv">${ob.items.map((x) => `<li><a href="project.html?id=${encodeURIComponent(x.project_id)}#benefits">${esc(x.project_key || x.project_id)}</a> <span class="hm-muted">${esc(x.due_date || '')} · ${esc(x.status === 'missing' ? T.missing : T.awaiting)}</span></li>`).join('')}</ul>`))}</ul></section>`;
      // F-PRODUCT-07 — present only while mywork_awaiting_me_enabled is on; a source that could not be read = "not measured"
      const aw = j.awaiting_me;
      const awSafe = (h) => (/^(?:[a-z-]+\.html(?:[?#].*)?|https:\/\/\S+)$/i.test(String(h || '')) ? String(h) : null);
      const awBlock = (k) => { const b = aw[k]; if (!b) return nm; if (b.count === 0) return esc(T.awNone);
        return `<b>${b.count}</b><ul class="hm-pv">${b.items.map((x) => `<li><a href="${esc(awSafe(x.link) || '#')}">${esc(x.ref || x.title || x.id)}</a> <span class="hm-muted">${esc(x.ref && x.title ? x.title : '')}${x.due_date ? ' · ' + esc(x.due_date) : ''}</span>${x.overdue ? ` <span class="hm-late">${esc(T.awLate)}</span>` : ''}${awSafe(x.evidence_link) && /^https:/i.test(x.evidence_link) ? ` · <a href="${esc(x.evidence_link)}" rel="noopener noreferrer" target="_blank">${esc(T.awEv)}</a>` : ''}</li>`).join('')}</ul>`; };
      const awaiting = aw === undefined || aw === null ? '' : `<section class="hm-card" aria-labelledby="hm-aw"><h2 id="hm-aw">${esc(T.aw)}${aw.total != null ? ` <span class="hm-muted">${aw.total}</span>` : ''}</h2><ul class="hm-blocks">${['commitments', 'handoffs', 'benefits', 'decisions', 'pvs'].map((k) => row(T.awSrc[k], null, awBlock(k))).join('')}</ul></section>`;
      $('hmSites').innerHTML = orderBlocks({ awaiting, owned: mine, sites: orderSites(j.sites || []).map(siteCard).join('') });
      mountQueue(j);
      placeQueue();
      // E-B07 — answers to MY feedback (only present while ui_feedback_enabled = '1'); every value escaped
      const fb = Array.isArray(j.feedback) ? j.feedback : [];
      const fbBox = document.getElementById('hmFeedback');
      if (fbBox) fbBox.remove();
      if (fb.length) {
        const sec = document.createElement('section');
        sec.id = 'hmFeedback'; sec.className = 'hm-feedback';
        const st = (s) => (lang === 'fr' ? ({ new: 'nouveau', triaged: 'trié', planned: 'prévu', declined: 'refusé', done: 'fait' })[s] || s : s);
        sec.innerHTML = `<h2>${esc(lang === 'fr' ? 'Réponses à vos retours' : 'Answers to your feedback')}</h2><ul>${fb.map((f) => `<li><b>${esc(st(f.status))}</b> — ${esc(String(f.body || '').slice(0, 140))}${f.response ? `<br><span class="hm-muted">${esc(f.response)}</span>` : ''}</li>`).join('')}</ul>`;
        $('hmSites').insertAdjacentElement('afterend', sec);
      }
      head(j);
      const msg = [];
      if (j.message) msg.push(lang === 'fr' ? "Vous n'êtes rattaché à aucun site — utilisez le registre des actions du site." : j.message);
      if (j.truncated) msg.push(fill(T.more, { n: j.truncated }));
      $('hmMsg').textContent = msg.join(' ');
      window.__markFirstUsable && window.__markFirstUsable('home');   // F-UX-05
    } catch (e) {
      window.__markFirstUsable && window.__markFirstUsable('home:error');   // F-UX-05 — an explicit state is usable too
      mountQueue(null);
      if (blocksOn) { failedHome(e); return; }
      $('hmSites').innerHTML = '';
      head(null);
      $('hmMsg').textContent = lang === 'fr' && window.ErrorText ? window.ErrorText.fr(e.message) : e.message;
    }
  }
  // P5 (A3) — the person's block order (workspace prefs, presentation only): awaiting / owned / sites inside the card
  // list, and the queue before or after them. No stored order = the page order of today.
  function blockOrder() { const b = profile && Array.isArray(profile.block_order) ? profile.block_order : null; return b && b.length ? b : null; }
  function orderBlocks(parts) {
    const o = blockOrder();
    const keys = (o || []).filter((k) => k !== 'queue').concat(['awaiting', 'owned', 'sites'].filter((k) => !(o || []).includes(k)));
    return keys.map((k) => parts[k] || '').join('');
  }
  function placeQueue() {
    const o = blockOrder(); if (!o) return;
    const qi = o.indexOf('queue'), si = Math.max(o.indexOf('sites'), o.indexOf('awaiting'), o.indexOf('owned'));
    const box = $('hmQueue'), sites = $('hmSites');
    try { if (qi > -1 && si > -1 && qi > si && box && sites && sites.insertAdjacentElement) sites.insertAdjacentElement('afterend', box); } catch (_) { /* order is best-effort */ }
  }
  // the default site of the profile comes first; every other site keeps its order (never adds a site)
  function orderSites(list) {
    const d = profile && profile.default_site_id;
    if (!d) return list;
    return list.slice().sort((a, b) => (Number(b.site_id) === Number(d)) - (Number(a.site_id) === Number(d)));
  }
  async function workJson() {
    const r = await fetch('/api/me/work', { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  // R2-QUEUE — one queue across sources; j = the /api/me/work answer (its own sites, ≤ 12) or null when it failed.
  let queue = null;
  function mountQueue(j) {
    const box = $('hmQueue');
    if (!queueOn || !box || (profile && profile.queue === false)) return;
    queue = window.HomeQueue.mount(box, {
      lang: lang === 'fr' ? 'fr' : 'en', sites: j ? orderSites(j.sites || []) : null, truncated: j ? j.truncated : 0,
      awaiting: j ? j.awaiting_me : null, asOf: j ? j.as_of : null, reloadWork: workJson, announce: false,
      // P5 (A3) — extra sources (absent = switched off), my snoozed lines, inline actions through the existing routes
      pending: j ? j.queue_extra : null, snoozed: (j && j.queue_snoozed) || {},
      delegate: !!(window.__uiPolicy && window.__uiPolicy.handoffs === '1'),
      postJson: async (method, url, body) => { const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, json: await r.json().catch(() => null) }; },
      commitmentsOff: !!(window.__uiPolicy && window.__uiPolicy.commitments === '0'),   // UAT-F: no 404 probe while the module is off
      fetchJson: async (url) => { const r = await fetch(url, { credentials: 'same-origin' }); return { status: r.status, json: r.ok ? await r.json().catch(() => null) : null }; },
    });
  }
  // F-UX-09 (switch on) — the whole inbox failed: keep the page, say so with the shared state, offer a retry.
  function failedHome(e) {
    head(null);
    const msg = lang === 'fr' && window.ErrorText ? window.ErrorText.fr(e.message) : e.message;
    $('hmSites').innerHTML = `<section class="hm-card hm-failed" aria-labelledby="hm-failed-h"><h2 id="hm-failed-h">${esc(lang === 'fr' ? 'Votre travail' : 'Your work')}</h2><p>${stateHtml('error', msg)}</p><button type="button" class="hm-retry" data-site="*">${esc(lang === 'fr' ? 'Réessayer' : 'Try again')}</button></section>`;
    $('hmMsg').textContent = msg;
  }
  // Reload ONE site card: the other cards stay as they are; on failure only that card says so.
  async function reloadSite(id, btn) {
    const card = document.querySelector(`[data-site-card="${String(id).replace(/[^0-9A-Za-z_-]/g, '')}"]`);
    if (!card) return;
    if (btn) btn.disabled = true;
    try {
      const r = await fetch('/api/me/work', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      const s = (j.sites || []).find((x) => String(x.site_id) === String(id));
      if (!s) throw new Error(lang === 'fr' ? 'site absent de la réponse' : 'site not in the answer');
      card.outerHTML = siteCard(s);
    } catch (e) {
      const box = card.querySelector('.hm-card-err');
      const html = stateHtml('error', e.message);
      if (box) box.innerHTML = html; else card.insertAdjacentHTML('beforeend', `<p class="hm-card-err">${html}</p>`);
      if (btn) btn.disabled = false;
    }
    const again = document.querySelector(`[data-site-card="${String(id).replace(/[^0-9A-Za-z_-]/g, '')}"] .hm-retry`);
    if (again && again.focus) again.focus();
  }
  if (blocksOn) {
    $('hmSites').addEventListener('click', (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest('.hm-retry') : null;
      if (!b) return;
      const id = b.getAttribute('data-site');
      if (id === '*') { load().then(() => { const f = document.querySelector('#hmSites .hm-card h2'); if (f && f.focus) { f.setAttribute('tabindex', '-1'); f.focus(); } }); return; }
      reloadSite(id, b);
    });
  }
  window.__homePage = { blocksOn, queueOn, siteCard, load, reloadSite, get queue() { return queue; }, get profile() { return profile; } };   // read by tests only
  if (profileOn) {
    window.WorkspaceProfiles.load(lang === 'fr' ? 'fr' : 'en').then((p) => {
      profile = p && Array.isArray(p.destinations) ? p : null;
      if (profile && profile.density === 'compact') document.body.classList.add('hm-compact');
    }, () => { profile = null; }).then(() => { shortcuts(); load(); });
  } else {
    shortcuts();
    load();
  }
})();
