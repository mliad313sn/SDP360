/* ═══════════════════════════════════════════════════════════════════
 * Endeavour IT — Unified Shell renderer
 * ───────────────────────────────────────────────────────────────────
 * Renders the canonical top header across every authenticated page.
 * Single source of truth for primary nav, role-based visibility, and
 * smart section landing.
 *
 *   <link rel="stylesheet" href="_shell.css">
 *   <script src="auth.js" data-require="any"></script>
 *   <script src="_shell.js"></script>
 *
 *   <body>
 *     <div id="__shell"
 *          data-section="performance"
 *          data-current="tracker"
 *          data-version="v1.10.8"></div>
 *     ...page content...
 *   </body>
 *
 * Auto-renders on DOMContentLoaded. data-section identifies the
 * top-level section; data-current optionally identifies the sub-page
 * (used to highlight the right item in the Performance dropdown).
 *
 * Public API on window.__shell:
 *   .render()           — re-render (e.g. after dynamic role change)
 *   .NAV                — read the canonical nav definition
 *   .landingFor(id)     — first accessible page within a section
 *   .defaultLanding()   — best home page for the current user
 *   .hasAnyRole(roles)  — same role check the shell uses internally
 * ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ── NAV DEFINITION ──────────────────────────────────────────────
  // ── BRAND ICONS — defer to the shared library at public/brand/icons.js ──
  // Pages must include <script src="brand/icons.js"></script> BEFORE this file.
  // If that script is missing for any reason, fall back to a tiny inline stub
  // (just the 9 nav icons we strictly need) so the shell still renders.
  const ICONS = (typeof window !== 'undefined' && window.EDV_ICONS) || {
    html: () => '',
    get:  () => '',
  };
  const ICON_LIB = {
    lightbulb:        ICONS.html('lightbulb'),
    'file-text':      ICONS.html('file-text'),
    'alert-circle':   ICONS.html('alert-circle'),
    calendar:         ICONS.html('calendar'),
    headset:          ICONS.html('headset'),
    'file-text':      ICONS.html('file-text'),
    'trending-up':    ICONS.html('trending-up'),
    gauge:            ICONS.html('gauge'),
    'line-chart':     ICONS.html('line-chart'),
    target:           ICONS.html('target'),
    presentation:     ICONS.html('presentation'),
    sliders:          ICONS.html('sliders'),
    'book-open':      ICONS.html('book-open'),
    'clipboard-check': ICONS.html('clipboard-check'),
    // ICON_LIB is a hand-curated SUBSET of icons.js, not a mirror of it — a key
    // present there is still undefined here until it is listed, and NAV then
    // renders an EMPTY icon span with no error. Add the key when you use it.
    'bar-chart-3':    ICONS.html('bar-chart-3'),
    'hard-drive':     ICONS.html('hard-drive'),
    'shield-check':   ICONS.html('shield-check'),
    wallet:           ICONS.html('wallet'),
    building:         ICONS.html('building'),
    activity:         ICONS.html('activity'),
    // Distinct icons so the Insights dropdown items don't collide visually:
    // Inspections keeps clipboard-check; Meetings → users (a council of people);
    // Site Actions → check (a register of actions to close). All three were
    // clipboard-check before, which made them indistinguishable at a glance.
    users:            ICONS.html('users'),
    check:            ICONS.html('check'),
    zap:              ICONS.html('zap'),
    search:           ICONS.html('search'),
  };

  // Canonical nav. Each item declares the role(s) that grant access.
  // 'any' = any logged-in user. Non-'any' values pass through to
  // window.__userHasRole. Children are shown in a dropdown for items
  // that have them; the parent button still navigates (smart landing
  // routes to the first accessible child).
  const NAV = [
    {
      // ── Site Overview — the read-only business site view (GM/FM). Promoted to
      // a TOP-LEVEL, directly-visible entry (flat link, no dropdown) because its
      // audience is business users, who should reach it in one click rather than
      // hunt inside a Reports menu. Role-gated to business + executive
      // (super_admin passes via hierarchy); IT-only roles (admin/editor/viewer)
      // never see it. A business-only user is auto-redirected here and this is
      // their SOLE visible entry — so it never competes with the IT menus.
      // (id stays 'site-awareness' — internal, matches the page + routes.)
      id:    'site-awareness',
      label: 'Site Overview',
      icon:  ICON_LIB.building,
      href:  'site-awareness.html',
      roles: ['site-business', 'group-business', 'executive'],
      title: 'Read-only business overview of your site'
    },
    {
      // ── Helpdesk — the live service-desk dashboard + its deep analytics.
      // Analytics was rehomed here from the old Insights bucket: it IS
      // helpdesk analysis, so it belongs beside the dashboard, not floating
      // among unrelated modules. Pages set data-section="helpdesk".
      // For a plain viewer, Analytics is gated → single visible child →
      // renderNavItem collapses this to a flat "Helpdesk" link (unchanged UX).
      id:       'helpdesk',
      label:    'Helpdesk',
      icon:     ICON_LIB.headset,
      href:     'index.html',
      roles:    ['any'],
      title:    'Service desk — dashboard and analytics',
      children: [
        { id: 'dashboard', label: 'Dashboard', icon: ICON_LIB.headset,       href: 'index.html',     roles: ['any'] },
        { id: 'analytics', label: 'Analytics', icon: ICON_LIB['line-chart'], href: 'analytics.html', roles: ['admin', 'scorecard-viewer'] }
      ]
    },
    {
      // ── Operations — the site-governance cadence: what field IT teams run
      // and track. Inspections (assurance), Meetings (5-Engagements
      // governance), Site Actions (follow-up register), Activity Tracker
      // (strategic roadmap input). Pages set data-section="operations".
      id:       'operations',
      label:    'Operations',
      icon:     ICON_LIB['clipboard-check'],
      roles:    ['any'],
      title:    'Site governance — inspections, meetings, actions, roadmap',
      children: [
        { id: 'inspections', group: 'Governance',  label: 'Inspections',        icon: ICON_LIB['clipboard-check'], href: 'inspections.html',      roles: ['any'] },
        { id: 'meetings', group: 'Governance',     label: 'Meetings Decisions', icon: ICON_LIB.users,              href: 'meetings.html',         roles: ['any'] },
        { id: 'site-actions', group: 'Governance', label: 'Site Actions',       icon: ICON_LIB.check,              href: 'site-actions.html',     roles: ['any'] },
        { id: 'tracker', group: 'Plan & track',      label: 'Activity Tracker',   icon: ICON_LIB.target,             href: 'activity-tracker.html', roles: ['any'] },
        { id: 'trackers', group: 'Plan & track',     label: 'Trackers',           icon: ICON_LIB.activity,            href: 'trackers.html',         roles: ['any'] },
        { id: 'dashboards', group: 'Report & share',   label: 'Dashboards',         icon: ICON_LIB.gauge,              href: 'dashboards.html',       roles: ['any'] },
        { id: 'cockpit', group: 'Report & share',      label: 'Meeting Cockpit',    icon: ICON_LIB.calendar,           href: 'cockpit.html',          roles: ['any'] },
        { id: 'portfolio', group: 'Plan & track',    label: 'Portfolio',          icon: ICON_LIB['trending-up'],     href: 'portfolio.html',        roles: ['any'] },
        { id: 'rfi', group: 'Plan & track',          label: 'RFI register',       icon: ICON_LIB.lightbulb,          href: 'rfi.html',              roles: ['any'] },
        { id: 'report-studio', group: 'Report & share', label: 'Report studio',     icon: ICON_LIB['file-text'],       href: 'report-studio.html',    roles: ['any'] },
        { id: 'notifications', group: 'Report & share', label: 'Notifications',     icon: ICON_LIB['alert-circle'],    href: 'notifications.html',    roles: ['any'] },
        { id: 'handoffs', group: 'Governance',     label: 'Handoffs',           icon: ICON_LIB.users,              href: 'handoffs.html',         roles: ['any'] },
        { id: 'obligations', group: 'Governance',  label: 'Site obligations',   icon: ICON_LIB['clipboard-check'], href: 'obligations.html',      roles: ['any'] },
        { id: 'policies', group: 'Configure',     label: 'Governance policies', icon: ICON_LIB['clipboard-check'], href: 'policies.html',        roles: ['admin', 'committee-member'] },
        { id: 'integrations', group: 'Configure', label: 'Integrations',       icon: ICON_LIB.zap,                href: 'integrations.html',     roles: ['admin'] },
        { id: 'field', group: 'Configure',        label: 'Field app',          icon: ICON_LIB['clipboard-check'], href: 'field/index.html',      roles: ['editor', 'field-tech'] }
      ]
    },
    {
      // ── Infrastructure — the technical estate we manage: the asset register
      // (CMDB / hygiene / finance / licences) and the WAN (health + ISP SLA).
      // Pages set data-section="infrastructure".
      id:       'infrastructure',
      label:    'Infrastructure',
      icon:     ICON_LIB['hard-drive'],
      roles:    ['any'],
      title:    'Assets and network estate',
      children: [
        { id: 'assets',       label: 'Assets',                icon: ICON_LIB['hard-drive'],  href: 'assets.html',       roles: ['any'] },
        { id: 'wan',          label: 'WAN',                   icon: ICON_LIB['bar-chart-3'], href: 'wan.html',          roles: ['any'] },
        // Infrastructure Health — cumulated per-site × family availability (WAN/LAN/WLAN/Servers)
        // + trend + governance, from the archived snapshots. Complements OpManager (no live device
        // status). WAN detail stays on wan.html.
        { id: 'infra-health', label: 'Infrastructure Health', icon: ICON_LIB.activity,       href: 'infra-health.html', roles: ['any'] }
      ]
    },
    {
      // ── Reports — restitution surfaces: the authored site reports and the
      // executive deck builder. (Ma Vue Site is now a promoted top-level entry,
      // not buried here.) Parent smart-lands on Site Reports (broadest audience);
      // renderNavItem collapses to a flat link for a viewer who sees only one.
      id:       'reports',
      label:    'Reports',
      icon:     ICON_LIB['file-text'],
      href:     'reports.html',
      roles:    ['any'],
      title:    'Site reports and executive deck builder',
      children: [
        { id: 'site-reports',    label: 'Site Reports', icon: ICON_LIB['file-text'], href: 'reports.html',          roles: ['any'] },
        { id: 'reports-builder', label: 'Deck Builder', icon: ICON_LIB.presentation, href: 'executive-report.html', roles: ['super_admin'] }  // = the page's data-require (RBAC audit 2026-10-02, A19)
      ]
    },
    {
      // ── Executive — the two cross-cutting pilotage dashboards: IT Review
      // (fleet governance rollup from meetings + inspections) and the
      // Executive Scorecard (KPI / action plan / tech / changes / CSAT).
      // Pages set data-section="executive".
      id:       'executive',
      label:    'Executive',
      icon:     ICON_LIB.gauge,
      // Executive / management only. IT Review is a FLEET-WIDE governance rollup
      // (all sites' meetings + inspections), so — like the Scorecard — it is scoped
      // to executive + scorecard-viewer. A site admin/editor no longer sees this
      // group at all (parent gate false + both children gated → sectionVisible false).
      roles:    ['executive', 'scorecard-viewer'],
      title:    'Executive dashboards — IT Review and Scorecard',
      children: [
        { id: 'exec-home', label: 'Executive Home',      icon: ICON_LIB.gauge,          href: 'dashboards.html?key=exec-home', roles: ['executive', 'scorecard-viewer'] },
        { id: 'it-review', label: 'IT Review',           icon: ICON_LIB['bar-chart-3'], href: 'it-review.html', roles: ['executive', 'scorecard-viewer'] },
        { id: 'scorecard', label: 'Executive Scorecard', icon: ICON_LIB.gauge,          href: 'executive.html', roles: ['executive', 'scorecard-viewer'] }
      ]
    },
    {
      // Admin (Settings + System Logs) is super_admin ONLY — the whole admin
      // console + its routes are super_admin-gated server-side. A plain admin /
      // executive no longer sees this entry at all.
      id:       'admin',
      label:    'Admin',
      icon:     ICON_LIB.sliders,
      href:     'reports.html#admin',
      roles:    ['super_admin'],
      title:    'User management & system settings',
      children: [
        { id: 'admin-settings', label: 'Settings',    icon: ICON_LIB.sliders,          href: 'reports.html#admin', roles: ['super_admin'] },
        { id: 'system-logs',    label: 'System Logs',  icon: ICON_LIB['shield-check'],  href: 'system-logs.html',   roles: ['super_admin'] }
      ]
    },
    {
      id:     'help',
      label:  'Help',
      icon:   ICON_LIB['book-open'],
      href:   'help.html',
      target: '_blank',
      roles:  ['any'],
      title:  'User manual'
    }
  ];

  // ── ROLE GATE ───────────────────────────────────────────────────
  function hasAnyRole(roles) {
    if (!Array.isArray(roles)) return false;
    // 'any' grants every logged-in user EXCEPT a business-only account (GM/FM): those see only
    // "Ma Vue Site" (which lists explicit business roles), never the IT-internal 'any' items.
    if (roles.includes('any')) return !window.__isBusinessOnly;
    const check = window.__userHasRole || (() => false);
    return roles.some(r => check(r));
  }
  function visibleItems(items) {
    return (items || []).filter(it => hasAnyRole(it.roles));
  }
  // A top-level section stays visible if its own roles grant OR it has ≥1 visible child — so a
  // business-only user still reaches "Ma Vue Site" under Insights even though the parent is roles:'any'.
  function sectionVisible(item) {
    if (hasAnyRole(item.roles)) return true;
    return !!(item.children && visibleItems(item.children).length);
  }

  // ── SMART LANDING ───────────────────────────────────────────────
  function landingFor(sectionId) {
    const sec = NAV.find(n => n.id === sectionId);
    if (!sec) return 'index.html';
    if (sec.children && sec.children.length) {
      const visible = visibleItems(sec.children);
      if (visible.length) return visible[0].href;
    }
    return sec.href || 'index.html';
  }

  // Best home page for the current user. Used by login.html for the
  // post-login redirect (and by the brand mark for "go home").
  function defaultLanding() {
    if (window.__isBusinessOnly) return 'site-awareness.html';   // GM/FM land on their site view
    const has = window.__userHasRole || (() => false);
    if (has('executive') || has('super_admin')) return 'executive.html';
    if (has('admin'))                            return 'index.html';
    if (has('tracker-editor'))                   return 'activity-tracker.html';
    return 'index.html';
  }

  // ── RENDER HELPERS ──────────────────────────────────────────────
  function groupChildren(items) {
    const out = [];
    for (const c of items) {
      const name = c.group || '';
      let g = out.find(x => x.name === name);
      if (!g) { g = { name, items: [] }; out.push(g); }
      g.items.push(c);
    }
    return out;
  }

  // ── G17 — role workspaces: the first things each persona needs, in task order. Only entries the user can
  // open are listed (same role check as the menu). A starting point, never a permission.
  const WORKSPACES = [
    { id: 'business',   label: 'Site business view',   when: () => !!window.__isBusinessOnly, items: ['site-awareness'] },
    // the hierarchical role decides first (a super_admin runs the platform → Group IT, an admin who also sits on
    // the committee is still Group IT); feature roles (committee, finance) only decide for users without one
    { id: 'super',      label: 'Group IT',             roles: ['super_admin'], items: ['dashboard', 'site-actions', 'cockpit', 'dashboards', 'report-studio', 'integrations', 'system-logs'] },
    { id: 'executive',  label: 'Executive',            roles: ['executive', 'scorecard-viewer'], items: ['exec-home', 'it-review', 'scorecard', 'portfolio', 'cockpit'] },
    { id: 'admin',      label: 'Group IT',             roles: ['admin'], items: ['dashboard', 'site-actions', 'cockpit', 'dashboards', 'report-studio', 'integrations'] },
    { id: 'pmo',        label: 'Portfolio & projects', roles: ['committee-member', 'finance-viewer'], items: ['portfolio', 'rfi', 'cockpit', 'report-studio'] },
    { id: 'site-it',    label: 'Site IT',              roles: ['editor'], items: ['site-actions', 'inspections', 'meetings', 'site-reports', 'tracker', 'obligations'] },
    { id: 'technician', label: 'Technician',           roles: ['field-tech'], items: ['field', 'inspections', 'site-actions'] },
    { id: 'reader',     label: 'Start here',           roles: ['any'], items: ['dashboard', 'site-actions', 'dashboards', 'notifications'] },
  ];
  function allEntries() {
    const out = [];
    for (const sec of NAV) {
      if (sec.href && !sec.children && hasAnyRole(sec.roles)) out.push({ id: sec.id, label: sec.label, href: sec.href, section: sec.label, group: '', target: sec.target });
      for (const c of visibleItems(sec.children || [])) out.push({ id: c.id, label: c.label, href: c.href, section: sec.label, group: c.group || '', target: c.target });
    }
    return out;
  }
  function workspaceFor() {
    const ws = WORKSPACES.find(w => (w.when ? w.when() : hasAnyRole(w.roles)));
    if (!ws) return null;
    const byId = new Map(allEntries().map(e => [e.id, e]));
    const items = ws.items.map(id => byId.get(id)).filter(Boolean);
    return items.length ? { id: ws.id, label: ws.label, items } : null;
  }
  const fold = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function searchEntries(q) {
    const t = fold(q).trim();
    if (!t) return [];
    return allEntries().filter(e => fold(e.label + ' ' + e.section + ' ' + e.group).includes(t)).slice(0, 12);
  }
  function breadcrumbFor(ctx) {
    const sec = NAV.find(n => n.id === ctx.section);
    if (!sec) return null;
    const child = (sec.children || []).find(c => c.id === ctx.current);
    if (!child) return null;
    return [{ label: sec.label }].concat(child.group ? [{ label: child.group }] : [], [{ label: child.label }]);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function renderNavItem(item, ctx) {
    const isActive = ctx.section === item.id;
    const visKids  = item.children ? visibleItems(item.children) : [];
    const hasKids  = visKids.length > 0;
    const href     = item.href || (hasKids ? landingFor(item.id) : '#');
    const target   = item.target ? ` target="${item.target}"` : '';
    // the label doubles as tooltip / accessible name: on narrow screens only the icon is shown
    const titleA   = ` title="${escapeHtml(item.title || item.label)}" aria-label="${escapeHtml(item.label)}"`;
    const activeC  = isActive ? ' is-active' : '';

    // If a dropdown parent has only ONE visible child for this user
    // (typical case: a viewer sees only "Site Reports" under Reports,
    // not Deck Builder), render the parent as a flat link straight to
    // that child. Removes the redundant single-item dropdown and the
    // caret affordance that does nothing useful.
    if (hasKids && visKids.length === 1) {
      const onlyChild = visKids[0];
      const childT    = onlyChild.target ? ` target="${onlyChild.target}"` : '';
      return `<a href="${escapeHtml(onlyChild.href)}"${childT} class="shell-nav-item-link${activeC}"${titleA}>
        <span class="shell-nav-icon">${item.icon || ''}</span>
        <span class="shell-nav-label">${escapeHtml(item.label)}</span>
      </a>`;
    }

    if (hasKids) {
      // Dropdown wrapper. The parent label is itself a clickable link
      // (smart landing) — the dropdown reveals on hover for power users.
      const link = c => {
        const ca = ctx.current === c.id ? ' is-active' : '';
        const ct = c.target ? ` target="${c.target}"` : '';
        const cur = ctx.current === c.id ? ' aria-current="page"' : '';
        return `<a href="${escapeHtml(c.href)}"${ct}${cur} class="${ca.trim()}" title="${escapeHtml(c.label)}">
          <span class="shell-nav-icon">${c.icon || ''}</span>
          <span>${escapeHtml(c.label)}</span>
        </a>`;
      };
      // G17 — a long menu is grouped by task (Governance / Plan & track / Report & share / Configure) instead of
      // one flat list of 16 entries. Order of groups = order of first appearance; links and URLs are unchanged.
      const groups = groupChildren(visKids);
      const kids = groups.length > 1
        ? groups.map(g => `<div class="shell-dd-group" role="group" aria-label="${escapeHtml(g.name)}"><div class="shell-dd-heading" aria-hidden="true">${escapeHtml(g.name)}</div>${g.items.map(link).join('')}</div>`).join('')
        : visKids.map(link).join('');

      return `<div class="shell-nav-item${activeC}"${titleA}>
        <a href="${escapeHtml(href)}"${target} style="display:contents;color:inherit;text-decoration:none">
          <span class="shell-nav-icon">${item.icon || ''}</span>
          <span class="shell-nav-label">${escapeHtml(item.label)}</span>
        </a><span class="shell-nav-caret" role="button" tabindex="0" aria-expanded="false" aria-label="Toggle ${escapeHtml(item.label)} menu" title="Click to pin menu open">▾</span>
        <div class="shell-dropdown">${kids}</div>
      </div>`;
    }

    return `<a href="${escapeHtml(href)}"${target} class="shell-nav-item-link${activeC}"${titleA}>
      <span class="shell-nav-icon">${item.icon || ''}</span>
      <span class="shell-nav-label">${escapeHtml(item.label)}</span>
    </a>`;
  }

  function renderUserPill(user) {
    if (!user) return '';
    const name = user.full_name || user.username || '—';
    const role = user.role || '—';
    return `<div class="shell-user-pill" title="Click to log out" onclick="window.__logout && window.__logout()">
      <span class="shell-user-initial" aria-hidden="true">${escapeHtml(String(name || '?').trim().charAt(0).toUpperCase())}</span>
      <span class="shell-user-name">${escapeHtml(name)}</span>
      <span class="shell-user-role">${escapeHtml(role)}</span>
    </div>`;
  }

  // ── MAIN RENDER ─────────────────────────────────────────────────
  function render(mount) {
    if (!mount) return;
    const ctx = {
      section: mount.dataset.section || '',
      current: mount.dataset.current || ''
    };
    const version = mount.dataset.version || '';
    const user    = window.__authUser || null;

    const navHtml = NAV.filter(sectionVisible).map(it => renderNavItem(it, ctx)).join('');

    const html = `
      <div class="shell-header" role="navigation" aria-label="Primary">
        <a href="${defaultLanding()}" class="shell-brand" title="Endeavour IT — go home">
          <div class="shell-logo" role="img" aria-label="Endeavour Mining"></div>
          <div class="shell-brand-text">Endeavour Mining<small>IT Dashboard</small></div>
        </a>
        <nav class="shell-nav">${navHtml}</nav>
        <div class="shell-actions">
          <button type="button" class="shell-search-btn" aria-haspopup="dialog" aria-expanded="false" aria-controls="shell-search" title="Find a page (Ctrl+K)">${ICON_LIB.search || ''}<span class="shell-search-label">Find</span><kbd>Ctrl K</kbd></button>
          ${renderUserPill(user)}
          ${version ? `<span class="shell-version">${escapeHtml(version)}</span>` : ''}
        </div>
      </div>
    `;

    // Render INSIDE the mount node so re-renders work — pages with their
    // own auth flow (e.g. reports.html) can call window.__shell.render()
    // again after login to refresh the user pill. The mount keeps its
    // data-section / data-current attributes for context.
    const crumbs = mount.dataset.breadcrumb === 'off' ? null : breadcrumbFor(ctx);
    const crumbHtml = crumbs ? `<nav class="shell-breadcrumb" aria-label="Breadcrumb"><ol>${crumbs.map((c, i) => `<li>${c.href && i < crumbs.length - 1 ? `<a href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a>` : `<span${i === crumbs.length - 1 ? ' aria-current="page"' : ''}>${escapeHtml(c.label)}</span>`}</li>`).join('')}</ol></nav>` : '';
    const searchHtml = `<div class="shell-search" id="shell-search" role="dialog" aria-label="Find a page" hidden>
        <label class="shell-search-field"><span class="shell-sr">Find a page</span><input type="search" id="shell-search-q" placeholder="Find a page — e.g. inspections, portfolio" autocomplete="off" aria-controls="shell-search-list"></label>
        <p class="shell-search-status" id="shell-search-status" aria-live="polite"></p>
        <ul id="shell-search-list" class="shell-search-list" aria-label="Pages"></ul>
      </div>`;

    mount.innerHTML = html.trim() + crumbHtml + searchHtml;
  }

  // ── G17 — quick find: "/" or Ctrl+K opens it, typing filters the pages this user can open, Enter goes to the
  // first match, Escape closes. With an empty query it lists the user's workspace.
  function searchList(q) {
    const list = document.getElementById('shell-search-list');
    if (!list) return [];
    let items = searchEntries(q), heading = '';
    if (!String(q || '').trim()) { const ws = workspaceFor(); items = ws ? ws.items : []; heading = ws ? ws.label : ''; }
    const st = document.getElementById('shell-search-status');
    if (st) st.textContent = String(q || '').trim() ? (items.length ? `${items.length} page${items.length > 1 ? 's' : ''} found` : 'No page matches') : (heading ? `Suggested for you: ${items.length} page${items.length > 1 ? 's' : ''}` : '');
    list.innerHTML = (heading ? `<li class="shell-search-head">${escapeHtml(heading)}</li>` : '') +
      (items.length ? items.map(e => `<li><a href="${escapeHtml(e.href)}"${e.target ? ` target="${e.target}"` : ''}>${escapeHtml(e.label)} <small>${escapeHtml(e.section)}${e.group ? ' · ' + escapeHtml(e.group) : ''}</small></a></li>`).join('')
        : `<li class="shell-search-empty">No page matches “${escapeHtml(q)}”.</li>`);
    return items;
  }
  let searchOpener = null;
  function openSearch() {
    const box = document.getElementById('shell-search'); const q = document.getElementById('shell-search-q');
    if (!box || !q) return;
    searchOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.querySelector('.shell-search-btn');
    box.hidden = false; q.value = ''; searchList(''); q.focus();
    const b = document.querySelector('.shell-search-btn'); if (b) b.setAttribute('aria-expanded', 'true');
  }
  function closeSearch(refocus) {
    const box = document.getElementById('shell-search'); if (!box || box.hidden) return;
    box.hidden = true; const b = document.querySelector('.shell-search-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
    if (refocus && searchOpener && document.contains(searchOpener)) searchOpener.focus();
    searchOpener = null;
  }
  function closeMenus(except) {
    document.querySelectorAll('.shell-dropdown.is-open').forEach(d => {
      if (d === except) return;
      d.classList.remove('is-open');
      const c = d.parentNode && d.parentNode.querySelector('.shell-nav-caret'); if (c) c.setAttribute('aria-expanded', 'false');
    });
  }
  function toggleMenu(caret, open) {
    const item = caret.closest('.shell-nav-item');
    const dropdown = item && item.querySelector('.shell-dropdown');
    if (!dropdown) return null;
    closeMenus(dropdown);
    item.classList.remove('is-suppressed');
    const next = open == null ? !dropdown.classList.contains('is-open') : open;
    dropdown.classList.toggle('is-open', next);
    caret.setAttribute('aria-expanded', String(next));
    return { dropdown, open: next };
  }

  // ── PUBLIC API ──────────────────────────────────────────────────
  window.__shell = {
    render: () => {
      const mount = document.getElementById('__shell');
      if (mount) render(mount);
    },
    NAV,
    WORKSPACES,
    workspaceFor,
    searchEntries,
    breadcrumbFor,
    groupChildren,
    landingFor,
    defaultLanding,
    hasAnyRole
  };

  // Auto-render on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.__shell.render);
  } else {
    window.__shell.render();
  }

  // ── Click-to-toggle dropdown (caret) ────────────────────────────
  // Hover-only dropdowns are flaky for slow-mouse / keyboard / touch
  // users. Clicking the small ▾ caret now PINS the menu open until the
  // user clicks a submenu item, presses Escape, or clicks anywhere
  // outside. The rest of the parent button still navigates to the
  // smart-landing target (e.g. clicking "Performance" itself goes to
  // executive.html), so the click-to-pin is opt-in via the caret.
  //
  // Single delegated listener on document so it survives re-renders
  // (e.g. reports.html re-rendering the shell after login).
  document.addEventListener('click', (e) => {
    // Caret click — toggle the dropdown without following the parent link (the caret sits inside it).
    const caret = e.target.closest('.shell-nav-caret');
    if (caret) { e.preventDefault(); e.stopPropagation(); toggleMenu(caret); return; }
    if (e.target.closest('.shell-search-btn')) {
      e.preventDefault();
      const box = document.getElementById('shell-search');
      if (box && !box.hidden) closeSearch(true); else openSearch();
      return;
    }
    if (!e.target.closest('.shell-search')) closeSearch(false);
    // Click outside every dropdown closes them; a click on a submenu link navigates normally.
    if (!e.target.closest('.shell-dropdown') && !e.target.closest('.shell-nav-item')) closeMenus(null);
  });

  // Keyboard (APG disclosure pattern): Enter/Space/ArrowDown on a caret opens its menu on the first link, ArrowUp on
  // the last; arrows move inside a menu; Escape closes the menu (or the finder) and returns focus to where it came
  // from; leaving a menu with Tab closes it. Ctrl/Cmd+K opens the finder — no single-character shortcut (WCAG 2.1.4).
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Escape') {
      const box = document.getElementById('shell-search');
      if (box && !box.hidden) { closeSearch(true); return; }
      const item = t.closest && t.closest('.shell-nav-item');
      if (item) {
        const caret = item.querySelector('.shell-nav-caret');
        closeMenus(null); item.classList.add('is-suppressed');
        if (caret && t !== caret) caret.focus();
        return;
      }
      closeMenus(null);
      return;
    }
    const caret = t.closest && t.closest('.shell-nav-caret');
    if (caret && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const r = toggleMenu(caret, e.key === 'ArrowDown' || e.key === 'ArrowUp' ? true : null);
      if (r && r.open) { const links = r.dropdown.querySelectorAll('a'); const to = e.key === 'ArrowUp' ? links[links.length - 1] : links[0]; if (to) to.focus(); }
      return;
    }
    const inDrop = t.closest && t.closest('.shell-dropdown');
    if (inDrop && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const links = Array.from(inDrop.querySelectorAll('a')); const i = links.indexOf(document.activeElement);
      const n = links[(i + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length]; if (n) n.focus();
      return;
    }
    const inFind = t.closest && t.closest('#shell-search');
    if (inFind && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const els = [document.getElementById('shell-search-q'), ...document.querySelectorAll('#shell-search-list a')].filter(Boolean);
      const i = els.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); const n = els[Math.max(0, Math.min(els.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) n.focus();
      return;
    }
    if (t.id === 'shell-search-q' && e.key === 'Enter') {
      const first = document.querySelector('#shell-search-list a'); if (first) { e.preventDefault(); first.click(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      if (document.getElementById('shell-search')) { e.preventDefault(); openSearch(); }
    }
  });
  // leaving a menu or the finder with Tab closes it (and keeps aria-expanded true to what is shown)
  document.addEventListener('focusout', (e) => {
    const next = e.relatedTarget;
    const item = e.target.closest && e.target.closest('.shell-nav-item');
    if (item && !(next && item.contains(next))) { const d = item.querySelector('.shell-dropdown.is-open'); if (d) closeMenus(null); }
    const box = e.target.closest && e.target.closest('#shell-search');
    if (box && next && !box.contains(next) && !(next.closest && next.closest('.shell-search-btn'))) closeSearch(false);
  });
  document.addEventListener('mouseleave', (e) => { const it = e.target; if (it && it.classList && it.classList.contains('shell-nav-item')) it.classList.remove('is-suppressed'); }, true);
  document.addEventListener('input', (e) => { if (e.target && e.target.id === 'shell-search-q') searchList(e.target.value); });
})();
