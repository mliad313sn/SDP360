// Committee #39 — Site obligations page (read-only). Data: GET /api/obligations?site=<id>.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hdr() {
    const h = {}; const at = window.__authToken; let tok = null;
    if (typeof at === 'function') { try { tok = at(); } catch (_) {} } else if (typeof at === 'string' && at) tok = at;
    if (!tok) tok = localStorage.getItem('report_token'); if (tok) h['x-report-token'] = tok; return h;
  }
  async function api(url) { const r = await fetch(url, { headers: hdr() }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }
  let lang = 'en'; try { lang = localStorage.getItem('sdp_lang') || localStorage.getItem('policies_lang') || (navigator.language || '').slice(0, 2) || 'en'; } catch (_) {}
  const L = {
    en: { reg: 'Register', item: 'Obligation', owner: 'Owner', due: 'Due', status: 'Status', open: 'open', overdue: 'overdue', all: 'All', none: 'Nothing open.', notRead: 'not read (switched off)', partial: 'partial total — a register is switched off', covers: 'covers',
      names: { commitment: 'Commitment', handoff: 'Handoff', meetings_action: 'Meeting action', incubation_action: 'Incubation action', inspection_action: 'Inspection action', report_followup: 'Report follow-up', session_action: 'Governance session action' } },
    fr: { reg: 'Registre', item: 'Obligation', owner: 'Responsable', due: 'Échéance', status: 'Statut', open: 'ouvertes', overdue: 'en retard', all: 'Toutes', none: 'Rien d\'ouvert.', notRead: 'non lu (désactivé)', partial: 'total partiel — un registre est désactivé', covers: 'couvre',
      names: { commitment: 'Engagement', handoff: 'Demande inter-services', meetings_action: 'Action de réunion', incubation_action: 'Action d\'incubation', inspection_action: 'Action d\'inspection', report_followup: 'Suivi du rapport', session_action: 'Action de séance de gouvernance' } },
  };
  const T = () => L[lang === 'fr' ? 'fr' : 'en'];
  let data = null;
  function render() {
    const t = T();
    document.querySelectorAll('[data-col]').forEach((th) => { th.textContent = t[th.dataset.col]; });
    if (!data) return;
    const by = data.totals.by_register;
    // design review B6: red only when something is overdue; a total with a register switched off is partial
    const partial = Object.values(data.registers).some((v) => v == null);
    const late = (n) => (n > 0 ? ` · <span class="ob-late">${n} ${t.overdue}</span>` : ` · <span class="ob-muted">0 ${t.overdue}</span>`);
    $('obTiles').innerHTML = `<div class="ob-tile ob-total${partial ? ' ob-partial' : ''}"><b>${data.totals.open}</b>${t.open}${late(data.totals.overdue)}${partial ? `<div class="ob-muted">⚠ ${t.partial}</div>` : ''}</div>`
      + Object.keys(by).map((k) => `<div class="ob-tile"><b>${by[k].open}</b>${esc(t.names[k] || k)}${by[k].overdue ? late(by[k].overdue) : ''}</div>`).join('')
      + Object.entries(data.registers).filter(([, v]) => v == null).map(([k]) => `<div class="ob-tile ob-muted">${esc(k)}: ${t.notRead}</div>`).join('');
    $('obRows').innerHTML = data.items.map((x) => `<tr><td>${esc(t.names[x.register] || x.register)}</td>
      <td>${x.link ? `<a href="${esc(x.link)}">${esc(x.title)}</a>` : esc(x.title)}${x.ref ? ` <span class="ob-muted">${esc(x.ref)}</span>` : ''}${x.sources && x.sources.length ? `<div class="ob-muted">${t.covers}: ${x.sources.map((s) => esc(s.title)).join(' · ')}</div>` : ''}</td>
      <td>${esc(x.owner || '—')}</td><td${x.overdue ? ' class="ob-late"' : ''}>${esc(x.due_date || '—')}</td><td>${esc(x.status)}</td></tr>`).join('') || `<tr><td colspan="5" class="ob-muted">${t.none}</td></tr>`;
  }
  async function load() {
    try { $('obMsg').textContent = ''; data = await api('/api/obligations?site=' + encodeURIComponent($('obSite').value)); render(); }
    catch (e) { data = null; $('obRows').innerHTML = ''; $('obTiles').innerHTML = ''; $('obMsg').textContent = lang === 'fr' && window.ErrorText ? window.ErrorText.fr(e.message) : e.message; }
  }
  async function init() {
    let sites = [];
    try { sites = await api('/api/reports/sites'); } catch (_) { sites = []; }
    const u = window.__authUser || {}; const mine = [u.site_id, ...((u.site_ids) || [])].filter((x) => x != null).map(Number);
    const admin = typeof window.__userHasRole === 'function' && window.__userHasRole('admin');
    for (const s of (sites || []).filter((x) => admin || mine.includes(Number(x.id)))) $('obSite').add(new Option(s.name, s.id));
    const want = new URLSearchParams(location.search).get('site'); if (want) $('obSite').value = want;
    if ($('obSite').options.length) load(); else render();
  }
  $('obSite').addEventListener('change', load);
  $('obLang').addEventListener('change', () => { lang = $('obLang').value; document.body.classList.toggle('lang-fr', lang === 'fr'); try { localStorage.setItem('policies_lang', lang); localStorage.setItem('sdp_lang', lang); } catch (_) {} render(); });
  $('obLang').value = lang === 'fr' ? 'fr' : 'en'; document.body.classList.toggle('lang-fr', lang === 'fr');
  init();
})();
