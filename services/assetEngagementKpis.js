'use strict';
// G-07 (audit 2026-09-24) — the printable asset-engagement KPI report.
//
// PURE: no DB, no clock, no I/O. tools/pg/asset-engagement-kpis.js gathers the rows and
// hands them here, so the T0 baseline and the 30-day re-measure are produced by the same
// wording and can be diffed line by line.
//
// House rules honoured here:
//   - a share needs a denominator: 0 active assets prints '—', never 0 % (which would
//     read as "this site is clean");
//   - null is "not measured", 0 is "measured zero" — they never render the same;
//   - no money on an assets worklist surface (the $ in the AP export is a currency lie).

const pad = (s, n) => String(s == null ? '' : s).padEnd(n);
const rpad = (s, n) => String(s == null ? '' : s).padStart(n);

function share(n, total) {
  if (!total || total <= 0) return '—';
  return Math.round((Number(n) || 0) * 100 / total) + '%';
}

function formatKpiReport(d = {}) {
  const sites = Array.isArray(d.sites) ? d.sites : [];
  const effort = Array.isArray(d.effort) ? d.effort : [];
  const eng = d.engagement || {};
  const L = [];

  L.push('PARC INFORMATIQUE — indicateurs d’engagement');
  L.push('Arrêté au ' + (d.as_of || '?'));
  L.push(d.last_sync
    ? 'Dernière synchronisation du registre : ' + d.last_sync
    : 'Registre jamais synchronisé — les compteurs ci-dessous ne reflètent aucun import.');
  L.push('');

  if (!sites.length) {
    L.push('Aucun site avec des actifs sur ce périmètre — rien à mesurer.');
  } else {
    L.push(pad('Site', 16) + rpad('Actifs', 8) + rpad('sans QR', 14) + rpad('sans date', 14)
      + rpad('sans coût', 14) + rpad('sans util.', 14));
    L.push('-'.repeat(80));
    const tot = { active: 0, no_tag: 0, no_date: 0, no_cost: 0, no_user: 0 };
    for (const s of sites) {
      const a = Number(s.active) || 0;
      for (const k of Object.keys(tot)) tot[k] += Number(s[k]) || 0;
      L.push(pad(s.site, 16) + rpad(a, 8)
        + rpad((s.no_tag || 0) + ' (' + share(s.no_tag, a) + ')', 14)
        + rpad((s.no_date || 0) + ' (' + share(s.no_date, a) + ')', 14)
        + rpad((s.no_cost || 0) + ' (' + share(s.no_cost, a) + ')', 14)
        + rpad((s.no_user || 0) + ' (' + share(s.no_user, a) + ')', 14));
    }
    L.push('-'.repeat(80));
    L.push(pad('TOTAL', 16) + rpad(tot.active, 8)
      + rpad(tot.no_tag + ' (' + share(tot.no_tag, tot.active) + ')', 14)
      + rpad(tot.no_date + ' (' + share(tot.no_date, tot.active) + ')', 14)
      + rpad(tot.no_cost + ' (' + share(tot.no_cost, tot.active) + ')', 14)
      + rpad(tot.no_user + ' (' + share(tot.no_user, tot.active) + ')', 14));
  }

  L.push('');
  L.push('SCORE DE TENUE DU PARC');
  if (!effort.length) {
    L.push('Aucun instantané d’effort enregistré — la tendance se construit à partir du premier.');
  } else {
    for (const e of effort) {
      // A null Δ means "no comparable snapshot 30 days back", which is NOT a flat
      // score: printing 0 there would credit a site with an effort it never made.
      const delta = (e.delta == null) ? 'Δ non comparable' : ('Δ ' + (e.delta > 0 ? '+' : '') + e.delta + ' pts');
      L.push('  ' + rpad(e.rank == null ? '?' : e.rank, 3) + '. ' + pad(e.site, 16)
        + rpad(e.effort_score == null ? '—' : e.effort_score, 5) + '   ' + delta
        + (e.active != null ? '   (' + e.active + ' actifs)' : ''));
    }
  }

  L.push('');
  L.push('USAGE DU MODULE (30 derniers jours)');
  L.push(eng.viewers_30d == null
    ? '  Ouvertures du module : non mesuré (aucun événement dans le journal).'
    : '  ' + eng.viewers_30d + ' utilisateur(s) distinct(s) ont ouvert le module.');
  L.push(eng.exports_30d == null
    ? '  Exports : non mesuré.'
    : '  ' + eng.exports_30d + ' export(s).');

  return L.join('\n');
}

// Δ against the ~30-day baseline, with the rule _buildLeaderboard already applies:
// when the baseline resolves to the SAME snapshot as the latest one (a site with a
// single snapshot in the window), there is nothing to compare against — that is null,
// not 0. Printing 0 there asserts "this site made no effort" on no measurement at all.
// A baseline that really is older and equal DOES print 0: that zero was measured.
function effortDelta(latest, baseline) {
  if (!latest || !baseline) return null;
  if (baseline.date === latest.date) return null;
  if (latest.score == null || baseline.score == null) return null;
  return Math.round(Number(latest.score) - Number(baseline.score));
}

module.exports = { formatKpiReport, share, effortDelta };
