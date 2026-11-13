// D2 (P10) — Value scoreboard page. Data: GET /api/value-scoreboard (+ /rollouts, POST /snapshot for super_admin).
// Every value escaped; a metric with no source shows "unknown" with its reason — never 0. EN / FR from the shell.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let lang = 'en';
  try { lang = (window.__shell && window.__shell.shellLang && window.__shell.shellLang()) || 'en'; } catch (_) { lang = 'en'; }
  if (lang === 'fr') document.documentElement.lang = 'fr';
  const T = {
    en: { title: 'Value scoreboard', intro: 'Read-only figures from the platform\'s own builders. A metric with no source is shown as unknown with its reason — never 0. Nothing here is a target or a verdict.',
      metrics: 'Metrics', rollouts: 'Before / after a switch flip', rollIntro: 'Take a snapshot before turning a switch on, and again after; each change in the configuration journal is compared with the nearest snapshots.',
      metric: 'Metric', value: 'Value', n: 'Base (n)', how: 'Definition · source', unknown: 'unknown', perimeter: 'Site rows limited to your sites.', fleet: 'Every site.', asof: 'As of',
      bySite: 'By site', snap: 'Take a snapshot now', snapped: 'Snapshot stored', key: 'Switch', change: 'Change', when: 'When', state: 'State', none: 'No configuration change recorded.', site: 'Site', loadErr: 'Could not load' },
    fr: { title: 'Tableau de valeur', intro: 'Chiffres en lecture seule, issus des calculs existants de la plateforme. Une mesure sans source est affichée « inconnue » avec sa raison — jamais 0. Rien ici n\'est un objectif ni un verdict.',
      metrics: 'Mesures', rollouts: 'Avant / après l\'activation d\'un interrupteur', rollIntro: 'Prenez un instantané avant d\'activer un interrupteur, puis après ; chaque changement du journal de configuration est comparé aux instantanés les plus proches.',
      metric: 'Mesure', value: 'Valeur', n: 'Base (n)', how: 'Définition · source', unknown: 'inconnue', perimeter: 'Lignes par site limitées à vos sites.', fleet: 'Tous les sites.', asof: 'Au',
      bySite: 'Par site', snap: 'Prendre un instantané', snapped: 'Instantané enregistré', key: 'Interrupteur', change: 'Changement', when: 'Date', state: 'État', none: 'Aucun changement de configuration enregistré.', site: 'Site', loadErr: 'Chargement impossible' },
  }[lang === 'fr' ? 'fr' : 'en'];
  $('vsTitle').textContent = T.title; $('vsIntro').textContent = T.intro; $('vsMetricsH').textContent = T.metrics; $('vsRollH').textContent = T.rollouts; $('vsRollIntro').textContent = T.rollIntro;
  async function api(method, path, body) {
    const r = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  const fmt = (m) => (m.value == null ? `<span class="vs-unk" title="${esc(m.missing)}">${esc(T.unknown)}</span><div class="vs-muted">${esc(m.missing)}</div>` : `<span class="vs-val">${esc(m.value)}${m.unit === '%' ? ' %' : (m.unit ? ' ' + esc(m.unit) : '')}</span>`);
  const sub = (m) => {
    if (!m.by_site || !m.by_site.length) return '';
    const cols = Object.keys(m.by_site[0]).filter((k) => k !== 'site_id' && k !== 'site_name');
    return `<details><summary>${esc(T.bySite)} (${m.by_site.length})</summary><table><thead><tr><th scope="col">${esc(T.site)}</th>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${
      m.by_site.map((s) => `<tr><td>${esc(s.site_name || s.site_id)}</td>${cols.map((c) => `<td>${s[c] == null ? '—' : esc(s[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
  };
  async function load() {
    try {
      const j = await api('GET', '/api/value-scoreboard');
      $('vsMeta').textContent = `${T.asof} ${j.as_of} · ${j.perimeter && j.perimeter.all ? T.fleet : T.perimeter}`;
      $('vsMetrics').innerHTML = `<table><thead><tr><th scope="col">${esc(T.metric)}</th><th scope="col">${esc(T.value)}</th><th scope="col">${esc(T.n)}</th><th scope="col">${esc(T.how)}</th></tr></thead><tbody>${
        j.metrics.map((m) => `<tr><td>${esc(m.label)}${sub(m)}</td><td>${fmt(m)}${m.extra ? `<div class="vs-muted">${esc(JSON.stringify(m.extra))}</div>` : ''}</td><td>${m.n == null ? '—' : esc(m.n)}</td><td class="vs-muted">${esc(m.definition)} · ${esc(m.source)}</td></tr>`).join('')}</tbody></table>`;
    } catch (e) { $('vsMeta').textContent = T.loadErr + ': ' + e.message; }
    try {
      const r = await api('GET', '/api/value-scoreboard/rollouts?days=30');
      $('vsRoll').innerHTML = r.rollouts.length ? `<table><thead><tr><th scope="col">${esc(T.key)}</th><th scope="col">${esc(T.change)}</th><th scope="col">${esc(T.when)}</th><th scope="col">${esc(T.state)}</th></tr></thead><tbody>${
        r.rollouts.map((x) => `<tr><td>${esc(x.key)}</td><td>${esc(x.from)} → ${esc(x.to)}</td><td>${esc(String(x.ts || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(x.state)}${x.deltas.length ? '<br>' + x.deltas.map((d) => `${esc(d.metric)}: ${d.before == null ? '—' : esc(d.before)} → ${d.after == null ? '—' : esc(d.after)}`).join('<br>') : ''}</td></tr>`).join('')}</tbody></table>` : `<p class="vs-muted">${esc(T.none)}</p>`;
    } catch (e) { $('vsRoll').textContent = T.loadErr + ': ' + e.message; }
  }
  try {
    if (window.__userHasRole && window.__userHasRole('super_admin')) {
      $('vsSnap').innerHTML = `<p><button type="button" class="vs-btn" id="vsSnapBtn">${esc(T.snap)}</button> <span class="vs-muted" id="vsSnapMsg" aria-live="polite"></span></p>`;
      $('vsSnapBtn').addEventListener('click', async () => {
        try { const s = await api('POST', '/api/value-scoreboard/snapshot', {}); $('vsSnapMsg').textContent = `${T.snapped} #${s.id}`; load(); } catch (e) { $('vsSnapMsg').textContent = e.message; }
      });
    }
  } catch (_) { /* no role helper */ }
  load();
})();
