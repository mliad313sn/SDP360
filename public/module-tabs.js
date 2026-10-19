/* module-tabs.js — shared intra-module tab strip.
   Mirrors _shell.js: renders into <div id="__moduletabs" data-module data-current>,
   uses window.EDV_ICONS for brand icons and window.__userHasRole for gating.
   Include AFTER brand/icons.js. Degrades to nothing if the mount is absent or the
   module is unknown. Structure is proven by tests/module-tabs.test.js. */
(function () {
  'use strict';
  const ICONS = (typeof window !== 'undefined' && window.EDV_ICONS) || { html: () => '' };
  const has = (r) => (window.__userHasRole || (() => false))(r);
  const gated = (it) => !it.roles || it.roles.includes('any') || it.roles.some(has);

  // Single source of truth for every module's sub-navigation. Add a module here,
  // NEVER re-inline a per-page <nav> again.
  const MODULES = {
    meetings: [
      { id:'list',       label:'Meetings',   icon:'file-text',    href:'meetings.html',          badgeId:'mdTabCount' },
      { id:'dashboard',  label:'Dashboard',  icon:'bar-chart-3',  href:'meetings-insights.html' },
      { id:'issues',     label:'Issues',     icon:'alert-circle', href:'meetings-issues.html' },
      { id:'actions',    label:'Actions',    icon:'check',        href:'meetings-actions.html' },
      { id:'unsigned',   label:'Unsigned',   icon:'edit',         href:'meetings-unsigned.html' },
      { id:'council',    label:'Council',    icon:'shield',       href:'meetings-council.html' },
      { id:'compliance', label:'Compliance', icon:'shield-check', href:'meetings-compliance.html' },
      { id:'setup',      label:'Setup',      icon:'sliders',      href:'meetings-setup.html', roles:['admin'] },
    ],
    inspections: [
      { id:'list',    label:'Inspections', icon:'clipboard-check', href:'inspections.html' },
      { id:'new',     label:'New',         icon:'plus',            href:'inspection.html' },
      { id:'actions', label:'Actions',     icon:'check',           href:'inspection-actions.html' },
    ],
    // Site Actions is a single-page cross-cutting HUB (no sibling pages). It
    // anchors the "Actions family" so it is not an orphan. This strip lives ONLY
    // on site-actions.html; the two source registers keep their own module strip.
    site_actions: [
      { id:'site',       label:'Site Actions',       icon:'check',           href:'site-actions.html' },
      { id:'meetings',   label:'Meetings Actions',   icon:'users',           href:'meetings-actions.html' },
      { id:'inspection', label:'Inspection Actions', icon:'clipboard-check', href:'inspection-actions.html' },
    ],
  };

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function render(mount) {
    if (!mount) return;
    const mod = mount.dataset.module || '';
    const cur = mount.dataset.current || '';
    const tabs = (MODULES[mod] || []).filter(gated);
    if (!tabs.length) { mount.innerHTML = ''; return; }
    const items = tabs.map(t => {
      const isActive = t.id === cur;
      const active = isActive ? ' aria-current="page"' : '';
      const badge = t.badgeId ? ` <span class="mt-tab__count" id="${esc(t.badgeId)}">—</span>` : '';
      return `<a class="mt-tab${isActive ? ' mt-tab--active' : ''}" href="${esc(t.href)}"${active}>`
           + `<span class="mt-tab__icon">${ICONS.html(t.icon)}</span>`
           + `<span class="mt-tab__label">${esc(t.label)}</span>${badge}</a>`;
    }).join('');
    mount.innerHTML = `<nav class="mt-tabs" aria-label="${esc(mod)} sections">${items}</nav>`;
  }

  window.__moduleTabs = { render: () => render(document.getElementById('__moduletabs')), MODULES };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.__moduleTabs.render);
  else window.__moduleTabs.render();
})();
