'use strict';
// C-24 — structural layout assertions (no screenshot hashes): measured in the page, judged in Node.
//   * the page itself never scrolls horizontally (documentElement.scrollWidth ≤ clientWidth + 1);
//   * the shell header is rendered, visible at the top, and fits the viewport width;
//   * the first content block after the header starts at or below the header's bottom (no overlap);
//   * every visible box that pokes past the right edge lives inside a horizontal scroll container
//     (overflow-x auto/scroll/hidden) — a wide table in its own scroller is fine, the page is not.

function measure() {
  const vw = document.documentElement.clientWidth;
  const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const box = (r) => r && { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
  const sh = document.getElementById('__shell');
  const hdr = sh ? [...sh.querySelectorAll('*')].find(visible) : null;
  // no shared shell (field PWA): the first visible block of the body that is not the skip link
  let c = sh ? sh.nextElementSibling : document.body.firstElementChild;
  // VISUAL POLISH 2026-11 — a legacy page body is wrapped in <main class="edv-main"> for the landmark; that wrapper is
  // display:contents (no box of its own, so the page layout is untouched). The "first content block" is then its first
  // visible child, exactly what a sighted user sees under the header: step INTO a display:contents element, never past it.
  const skip = (e) => /^(SCRIPT|STYLE|TEMPLATE|LINK|NOSCRIPT)$/.test(e.tagName) || !visible(e) || getComputedStyle(e).position === 'fixed' || (!sh && /(^|\s)edv-skip(\s|$)/.test(e.className || ''));
  const firstBlock = (e) => {
    for (; e; e = e.nextElementSibling) {
      if (getComputedStyle(e).display === 'contents') { const inner = firstBlock(e.firstElementChild); if (inner) return inner; continue; }
      if (!skip(e)) return e;
    }
    return null;
  };
  c = firstBlock(c);
  const clipped = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true; } return false; };
  const escaping = [...document.querySelectorAll('body *')].filter((e) => visible(e) && getComputedStyle(e).position !== 'fixed' && e.getBoundingClientRect().right > vw + 1 && !clipped(e))
    .slice(0, 5).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.split(/\s+/)[0] : '') + '→' + Math.round(e.getBoundingClientRect().right));
  return { vw, scrollWidth: document.documentElement.scrollWidth, header: box(hdr && hdr.getBoundingClientRect()), content: c ? (c.tagName.toLowerCase() + (c.id ? '#' + c.id : '')) : null, contentBox: box(c && c.getBoundingClientRect()), escaping };
}

// Returns the list of problems (empty = layout OK).
// opts.shell === false: the page has no shared shell (field PWA) — the header checks are skipped.
function judge(m, opts) {
  const shell = !(opts && opts.shell === false);
  const p = [];
  if (m.scrollWidth > m.vw + 1) p.push(`horizontal page scroll (scrollWidth ${m.scrollWidth} > ${m.vw})`);
  if (!shell) { /* no shared header on this page */ } else if (!m.header) p.push('no visible shell header');
  else {
    if (m.header.top < 0 || m.header.top > 2) p.push(`header not at the top (top ${m.header.top})`);
    if (m.header.left < -1 || m.header.right > m.vw + 1) p.push(`header outside the viewport (${m.header.left}..${m.header.right})`);
  }
  if (!m.contentBox) p.push('no visible content block after the header');
  else if (shell && m.header && m.contentBox.top < m.header.bottom - 1) p.push(`content ${m.content} (top ${m.contentBox.top}) overlaps the header (bottom ${m.header.bottom})`);
  if (m.contentBox && (m.contentBox.left < -1 || m.contentBox.right > m.vw + 1)) p.push(`content ${m.content} outside the viewport (${m.contentBox.left}..${m.contentBox.right})`);
  if (m.escaping.length) p.push('boxes past the right edge outside any scroll container: ' + m.escaping.join(', '));
  return p;
}

module.exports = { measure, judge };
