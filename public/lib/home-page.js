// A-10 — Home ("My work") page. Data: GET /api/me/work (the user's own sites only).
// A block that is null was not measured (source unreadable / absent) and says so — never a zero.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let lang = 'en';
  try { lang = (window.__shell && window.__shell.shellLang && window.__shell.shellLang()) || 'en'; } catch (_) { lang = 'en'; }
  if (lang === 'fr') document.body.classList.add('lang-fr');
  const MONTHS = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] };
  const L = {
    en: { nm: '— not measured', actions: 'Open actions', open: 'open', overdue: 'overdue', oldest: 'oldest', days: 'days', none: 'nothing open',
      report: 'Weekly report', unsigned: 'PVs to sign', allSigned: 'all signed', insp: 'Last inspection', never: 'none recorded', ago: 'days ago', today: 'today',
      tracker: 'Activity tracker', empty: 'of {t} activities have nothing entered for {m}', full: 'all {t} activities filled for {m}', noAct: 'no activity due in {m}',
      loading: 'Loading…', more: '+ {n} more site(s) not shown', open_pv: 'Open',
      benefits: 'Benefit reviews due', mine: 'Benefits I own — review due', noBenefit: 'none due', missing: 'value missing', awaiting: 'awaiting verification',
      labels: { 'Not started': 'Not started', 'In progress': 'In progress', 'Complete but not submitted': 'Complete but not submitted', 'Submitted': 'Submitted' } },
    fr: { nm: '— non mesuré', actions: 'Actions ouvertes', open: 'ouvertes', overdue: 'en retard', oldest: 'la plus ancienne', days: 'jours', none: 'rien d\'ouvert',
      report: 'Rapport hebdomadaire', unsigned: 'PV à signer', allSigned: 'tous signés', insp: 'Dernière inspection', never: 'aucune enregistrée', ago: 'jours', today: 'aujourd\'hui',
      tracker: 'Suivi d\'activité', empty: 'activités sur {t} sans saisie pour {m}', full: 'les {t} activités sont saisies pour {m}', noAct: 'aucune activité prévue en {m}',
      loading: 'Chargement…', more: '+ {n} autre(s) site(s) non affiché(s)', open_pv: 'Ouvrir',
      benefits: 'Revues de bénéfices dues', mine: 'Mes bénéfices à revoir', noBenefit: 'aucune', missing: 'valeur manquante', awaiting: 'en attente de vérification',
      labels: { 'Not started': 'Pas commencé', 'In progress': 'En cours', 'Complete but not submitted': 'Complet mais non soumis', 'Submitted': 'Soumis' } },
  };
  const T = L[lang === 'fr' ? 'fr' : 'en'];
  const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const nm = `<span class="hm-nm">${esc(T.nm)}</span>`;
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
    return `<section class="hm-card" aria-labelledby="hm-s-${esc(s.site_id)}"><h2 id="hm-s-${esc(s.site_id)}">${esc(s.name || s.code)}${s.code ? ` <span class="hm-muted">${esc(s.code)}</span>` : ''}</h2>
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
      $('hmSites').innerHTML = mine + (j.sites || []).map(siteCard).join('');
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
    } catch (e) {
      $('hmSites').innerHTML = '';
      head(null);
      $('hmMsg').textContent = lang === 'fr' && window.ErrorText ? window.ErrorText.fr(e.message) : e.message;
    }
  }
  shortcuts();
  load();
})();
