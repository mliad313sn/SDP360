// E-D07 — data-quality board page. Data: GET /api/data-quality (admin tier). Every value escaped.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function cell(c) {
    if (!c) return '<span class="dq-s dq-UNKNOWN">UNKNOWN</span>';
    const v = c.value == null ? '' : Array.isArray(c.value) ? (c.value.length ? c.value.join(', ') : 'none') : String(c.value) + (c.unit ? ' ' + c.unit : '');
    const why = c.reason ? ` title="${esc(c.reason)}"` : '';
    return `<a class="dq-s dq-${esc(c.status)}" href="${esc(c.fix || '#')}"${why}>${esc(c.status)}${v ? ' · ' + esc(v) : ''}</a>`;
  }
  function table(head, rows) {
    return `<table><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  async function load() {
    try {
      const r = await fetch('/api/data-quality', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      $('dqMeta').textContent = `Checked ${j.checked_at} · ok ${j.counts.ok} · warn ${j.counts.warn} · UNKNOWN ${j.counts.UNKNOWN} · proposed warn lines: completeness < ${j.thresholds_proposed.completeness_warn_below_pct} %, money coverage < ${j.thresholds_proposed.money_coverage_warn_below_pct} %`;
      $('dqSources').innerHTML = table(['Source', 'Freshness', 'Content drift', 'Duplicates'], j.sources.map((s) => `<tr><td>${esc(s.source)}</td><td>${cell(s.freshness)}</td><td>${cell(s.drift)}</td><td>${cell(s.duplicates)}</td></tr>`));
      $('dqSites').innerHTML = table(['Site', 'Asset hygiene completeness', 'Money coverage', 'Site-code disagreements'], j.sites.map((s) => `<tr><td>${esc(s.site)}</td><td>${cell(s.hygiene_completeness)}</td><td>${cell(s.money_coverage)}</td><td>${cell(s.site_code_disagreements)}</td></tr>`));
      const rr = j.risk_register_unmapped;
      $('dqRisk').innerHTML = cell(rr) + (rr && Array.isArray(rr.labels) && rr.labels.length ? `<ul>${rr.labels.map((l) => `<li>${esc(l.label)} (${esc(l.tickets)})</li>`).join('')}</ul>` : '');
    } catch (e) { $('dqMeta').textContent = 'Could not load: ' + e.message; }
  }
  load();
})();
