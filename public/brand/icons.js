/**
 * EDV / Endeavour Mining — Brand Icon Library
 *
 * Lucide-style monochrome line icons (24×24 viewBox, stroke=currentColor,
 * round caps/joins). Single colour SVG that picks up CSS `color` via
 * `currentColor` — set the parent's text colour to control the icon.
 *
 * INCLUDED VIA:
 *   <script nonce="%%CSP_NONCE%%" src="brand/icons.js"></script>
 *   (place BEFORE _shell.js so the shell can use the same library.)
 *
 * USAGE:
 *   In static HTML:
 *     <button>${EDV_ICONS.html('zap')} Force Sync</button>      ← only works inside template literals
 *     <i class="icon icon-zap"></i>                              ← works anywhere; needs brand/icons.css
 *
 *   In JS string-building:
 *     btn.innerHTML = EDV_ICONS.html('zap') + ' Force Sync';
 *
 * ADDING ICONS:
 *   Append to the LIB object below. Use Lucide path data (lucide.dev, MIT)
 *   so the visual language stays consistent.
 *
 * POLICY — what to replace and what to keep:
 *   REPLACE:  ⚡ ⬇ 📊 📋 📤 ⚙ 📡 💾 🔄 💡 🚨 (Claude/chat-bot vibes)
 *   KEEP:     ✓ ✕ ⚠ ✏ (BMP characters — render at text size, professional)
 *             🟢 🟡 🔴 (functional RAG colour indicators)
 *             😊 😟 (CSAT emotional indicators — contextually right)
 *
 * Source: Lucide Icons (https://lucide.dev) — MIT licensed.
 */
(function () {
  'use strict';

  // The 1em defaults on the <svg> itself make the icon scale with the
  // surrounding text-size whenever it's dropped raw into a layout (e.g.
  // activity-tracker tab labels, JS-rendered button text). The .icon CSS
  // class and .shell-nav-icon CSS still override these defaults via
  // `.icon svg { width: 100%; height: 100% }` etc., so existing call sites
  // are unaffected. Previously the absence of width/height let the browser
  // default to ~150px → the SVG filled whatever container it landed in,
  // which is how the activity-tracker tabs ended up with huge icons.
  const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
                 + 'width="1em" height="1em" '
                 + 'fill="none" stroke="currentColor" stroke-width="2" '
                 + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  const SVG_CLOSE = '</svg>';

  // Inner SVG path data per icon. Wrapper added by html().
  const LIB = {
    // ── NAV (also used by _shell.js) ─────────────────────────────────
    'headset':       '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1v-6Z"/><path d="M21 14h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2a1 1 0 0 0 1-1v-6Z"/><path d="M3 14a9 9 0 0 1 18 0"/>',
    'file-text':     '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    'trending-up':   '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    'gauge':         '<path d="M12 14L8 10"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    'line-chart':    '<path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 6-6"/>',
    'target':        '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    'presentation':  '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/><path d="M12 16v5"/>',
    'sliders':       '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    'book-open':     '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    'building':      '<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',

    // ── BUTTON / ACTION ICONS ────────────────────────────────────────
    'zap':           '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',                                              // Force sync, fast actions
    'download':      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',  // Export / Download
    'upload':        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',     // Upload / Submit
    'save':          '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',  // Save
    'refresh-cw':    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',  // Refresh
    'copy':          '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',                       // Copy
    'edit':          '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',  // Edit
    'trash':         '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',  // Delete
    'plus':          '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',                            // Add
    'x':             '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',                              // Close
    'check':         '<polyline points="20 6 9 17 4 12"/>',                                                                     // Confirm
    'chevron-down':  '<polyline points="6 9 12 15 18 9"/>',                                                                     // Dropdown
    'chevron-right': '<polyline points="9 18 15 12 9 6"/>',                                                                     // Disclosure

    // ── STATE / EMPTY STATES ─────────────────────────────────────────
    'cloud-off':     '<path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"/>',  // Proxy offline / connection lost
    'wifi-off':      '<line x1="2" y1="2" x2="22" y2="22"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    'alert-circle':  '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    'alert-triangle':'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'info':          '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',                                  // Tip / info boxes
    'lightbulb':     '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',

    // ── DOMAIN / DASHBOARD-SPECIFIC ──────────────────────────────────
    'bar-chart-3':   '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',                       // Reports / data sections
    'hard-drive':    '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',  // Assets / hardware inventory
    'wallet':        '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',  // Finance / money
    'users':         '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',  // Group, team
    'user':          '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',                       // Single user
    'calendar':      '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',  // Date
    'clock':         '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'filter':        '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    'search':        '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    'log-out':       '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    'shield':        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
    'shield-check':  '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',

    // ── INSPECTION MODULE ───────────────────────────────────────────
    'clipboard-check': '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="m9 14 2 2 4-4"/>',  // Inspections nav
    'camera':          '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',                       // Photo capture
    'mic':             '<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/>',                                  // Voice dictation
  };

  // ── PUBLIC API ──────────────────────────────────────────────────────
  function html(name) {
    const path = LIB[name];
    if (!path) {
      if (typeof console !== 'undefined') console.warn('[EDV_ICONS] Unknown icon:', name);
      return '';
    }
    return SVG_OPEN + path + SVG_CLOSE;
  }

  // Hydrate <i class="icon icon-NAME"> placeholders into inline SVG. Lets pages
  // write semantic markup without inline SVG everywhere. Run once on
  // DOMContentLoaded (auto-wired below); also exposed for manual calls.
  function hydrate(root) {
    root = root || document;
    const els = root.querySelectorAll('i.icon, span.icon, [data-icon]');
    els.forEach(el => {
      // Already hydrated — skip
      if (el.firstElementChild && el.firstElementChild.tagName === 'svg'.toUpperCase()) return;
      // Determine name: prefer data-icon, then any `icon-NAME` class
      let name = el.getAttribute('data-icon');
      if (!name) {
        const m = (el.className || '').match(/\bicon-([a-z][\w-]*)\b/);
        if (m) name = m[1];
      }
      if (!name) return;
      const svg = html(name);
      if (svg) el.innerHTML = svg;
    });
  }

  const API = { html, get: html, hydrate, names: () => Object.keys(LIB) };

  // CommonJS (Node — for any future server-side template builders)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  // Browser global
  if (typeof window !== 'undefined') {
    window.EDV_ICONS = API;
    // Auto-hydrate static placeholders once the DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => hydrate());
    } else {
      hydrate();
    }
  }
})();
