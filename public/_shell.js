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
    // Distinct icons so the Insights dropdown items don't collide visually:
    // Inspections keeps clipboard-check; Meetings → users (a council of people);
    // Site Actions → check (a register of actions to close). All three were
    // clipboard-check before, which made them indistinguishable at a glance.
    users:            ICONS.html('users'),
    check:            ICONS.html('check'),
  };

  // Canonical nav. Each item declares the role(s) that grant access.
  // 'any' = any logged-in user. Non-'any' values pass through to
  // window.__userHasRole. Children are shown in a dropdown for items
  // that have them; the parent button still navigates (smart landing
  // routes to the first accessible child).
  const NAV = [
    {
      // Label renamed Operations → Helpdesk for clarity (the link points to
      // the live helpdesk dashboard). id kept stable so existing pages'
      // data-section="operations" attributes don't need to change.
      id:    'operations',
      label: 'Helpdesk',
      icon:  ICON_LIB.headset,
      href:  'index.html',
      roles: ['any'],
      title: 'Live helpdesk dashboard — ticket triage and SLA monitoring'
    },
    {
      // Reports is now a dropdown grouping both the site-report flow
      // (weekly/monthly PPTX from operational data) and the Deck
      // Builder (executive board deck). The parent click smart-lands
      // on Site Reports — broadest audience, matches pre-2026-05-24
      // behaviour. For viewers without `report-author` / `executive`
      // / `super_admin`, only Site Reports is visible; renderNavItem
      // collapses single-visible-child dropdowns to a flat link so
      // they don't see a redundant one-item menu.
      id:       'reports',
      label:    'Reports',
      icon:     ICON_LIB['file-text'],
      href:     'reports.html',
      roles:    ['any'],
      title:    'Site reports and executive deck builder',
      children: [
        { id: 'site-reports',    label: 'Site Reports', icon: ICON_LIB['file-text'],   href: 'reports.html',           roles: ['any'] },
        { id: 'reports-builder', label: 'Deck Builder', icon: ICON_LIB.presentation,   href: 'executive-report.html',  roles: ['report-author', 'super_admin', 'executive'] }
      ]
    },
    {
      // Label renamed Performance → Insights to better describe the actual
      // contents (analytics + scorecard + activity tracking + inspections +
      // meetings — all read-only analytical / observational views).
      // id kept stable as 'performance' so existing pages with
      // data-section="performance" don't need to change.
      //
      // Order intentional: "any"-role items first (Inspections, Tracker,
      // Meetings) so a site-IT user clicking the parent label smart-lands
      // on Inspections (their most-frequent page). Admin- and executive-
      // gated items follow at the bottom — those users have their own
      // defaultLanding() targets and don't depend on this menu's order.
      id:       'performance',
      label:    'Insights',
      icon:     ICON_LIB['trending-up'],
      roles:    ['any'],
      title:    'Analytics, scorecards, inspections, and strategic activity tracking',
      children: [
        // Site Awareness — read-only per-site business view (GM/FM). site-business sees only
        // their site; group-business (CIO/CFO) + executive see all. super_admin passes via hierarchy.
        { id: 'site-awareness', label: 'Ma Vue Site',       icon: ICON_LIB.building,           href: 'site-awareness.html',    roles: ['site-business', 'group-business', 'executive'] },
        { id: 'inspections', label: 'Inspections',         icon: ICON_LIB['clipboard-check'], href: 'inspections.html',       roles: ['any']       },
        { id: 'tracker',     label: 'Activity Tracker',    icon: ICON_LIB.target,             href: 'activity-tracker.html',  roles: ['any']       },
        // Single Meetings entry — lands on meetings.html (List active by
        // default). Dashboard / Issues / Council / Compliance / Setup are
        // reached through the module's own intra-module tab strip, same
        // pattern as Activity Tracker. Keeps Insights ▾ lean and matches
        // the user mental model of "one module = one nav entry".
        { id: 'meetings',    label: 'Meetings Decisions',  icon: ICON_LIB.users,              href: 'meetings.html',          roles: ['any']       },
        { id: 'site-actions', label: 'Site Actions',       icon: ICON_LIB.check,              href: 'site-actions.html',      roles: ['any']       },
        // Assets — ONE tabbed module (Inventory · Hygiene · Finance & Licences)
        // over the ManageEngine-synced fleet, driven by one shared filter bar.
        // The former standalone Hygiene + Finance pages are now the #hygiene /
        // #finance tabs of assets.html (their old URLs redirect there).
        { id: 'assets',      label: 'Assets',              icon: ICON_LIB['hard-drive'],      href: 'assets.html',            roles: ['any']       },
        // WAN — one module, two tabs: "Santé & Qualité" (per-site availability +
        // quality from the Meraki archive, any role) and "SLA & Refacturation"
        // (contractual SLA + ISP chargeback, admin-gated inside). Old wan-health.html
        // / wan-sla.html URLs redirect to wan.html#health / #sla.
        { id: 'wan',        label: 'WAN',                  icon: ICON_LIB['bar-chart-3'],     href: 'wan.html',               roles: ['any']       },
        // IT Review — the review of what the meetings produce, hence right after
        // them. It now mounts the app shell (#__shell) like every other page and
        // opens IN-PLACE (no target:'_blank'): its own internal header was
        // de-stickied so the app banner is the sole sticky top bar.
        { id: 'it-review',   label: 'IT Review',           icon: ICON_LIB['bar-chart-3'],     href: 'it-review.html',         roles: ['any'] },
        // scorecard-viewer (feature role, 2026-06-12): READ-ONLY access to the
        // two gated analytical pages for users who must consult them without
        // holding the powerful executive/admin hierarchy tiers. Keep in sync
        // with the data-require attributes in analytics.html + executive.html.
        { id: 'analytics',   label: 'Analytics',           icon: ICON_LIB['line-chart'],      href: 'analytics.html',         roles: ['admin', 'scorecard-viewer']     },
        { id: 'scorecard',   label: 'Executive Scorecard', icon: ICON_LIB.gauge,              href: 'executive.html',         roles: ['executive', 'scorecard-viewer'] }
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
    const titleA   = item.title ? ` title="${escapeHtml(item.title)}"` : '';
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
      const kids = visKids.map(c => {
        const ca = ctx.current === c.id ? ' is-active' : '';
        const ct = c.target ? ` target="${c.target}"` : '';
        return `<a href="${escapeHtml(c.href)}"${ct} class="${ca.trim()}" title="${escapeHtml(c.label)}">
          <span class="shell-nav-icon">${c.icon || ''}</span>
          <span>${escapeHtml(c.label)}</span>
        </a>`;
      }).join('');

      return `<div class="shell-nav-item${activeC}"${titleA} tabindex="0">
        <a href="${escapeHtml(href)}"${target} style="display:contents;color:inherit;text-decoration:none">
          <span class="shell-nav-icon">${item.icon || ''}</span>
          <span class="shell-nav-label">${escapeHtml(item.label)}</span>
        </a><span class="shell-nav-caret" role="button" tabindex="0" aria-label="Toggle ${escapeHtml(item.label)} menu" title="Click to pin menu open">▾</span>
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
          ${renderUserPill(user)}
          ${version ? `<span class="shell-version">${escapeHtml(version)}</span>` : ''}
        </div>
      </div>
    `;

    // Render INSIDE the mount node so re-renders work — pages with their
    // own auth flow (e.g. reports.html) can call window.__shell.render()
    // again after login to refresh the user pill. The mount keeps its
    // data-section / data-current attributes for context.
    mount.innerHTML = html.trim();
  }

  // ── PUBLIC API ──────────────────────────────────────────────────
  window.__shell = {
    render: () => {
      const mount = document.getElementById('__shell');
      if (mount) render(mount);
    },
    NAV,
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
    const caret = e.target.closest('.shell-nav-caret');
    if (caret) {
      // Caret click — toggle dropdown, suppress the parent <a>'s
      // navigation. The caret span lives inside the parent link, so
      // we both prevent default navigation AND stop propagation.
      e.preventDefault();
      e.stopPropagation();
      const item = caret.closest('.shell-nav-item');
      const dropdown = item && item.querySelector('.shell-dropdown');
      if (!dropdown) return;
      const wasOpen = dropdown.classList.contains('is-open');
      // Close every other open dropdown first (only one pinned at a time).
      document.querySelectorAll('.shell-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
      if (!wasOpen) dropdown.classList.add('is-open');
      return;
    }
    // Click anywhere else — if it's outside any open dropdown, close them.
    // Click INSIDE a dropdown (i.e. on a submenu link) is left alone so
    // the link navigates normally; the new page will render without any
    // pinned dropdown.
    if (!e.target.closest('.shell-dropdown') && !e.target.closest('.shell-nav-item')) {
      document.querySelectorAll('.shell-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
    }
  });

  // Escape closes any pinned dropdown — keyboard accessibility.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.shell-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
    }
  });
})();
