'use strict';
// Historique de la réconciliation + journal des imports (sqlite).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-hist-'));
process.env.ASSETS_BACKEND = 'sqlite';
const adb = require('../assets-db');

// Une vue minimale, la forme que buildReconcileView produit.
const view = (o) => Object.assign({
  counts: { gaps_open: 0, gaps_decided: 0, sites_touched: 0, ous_touched: 0,
    retirement_candidates: 0, retirement_applicable: true, sources_present: ['ad'] },
  by_site: [],
}, o);

test('snapshotReconcile écrit UN point pour la journée et le relit', () => {
  adb.snapshotReconcile(view({
    counts: { gaps_open: 545, gaps_decided: 3, sites_touched: 12, ous_touched: 66,
      retirement_candidates: 751, retirement_applicable: true, sources_present: ['ad', 'entra'] },
    by_site: [{ site: 'KALANA', n: 54 }, { site: 'ABIDJAN', n: 50 }],
  }), 'azize', { asOf: '2026-07-01' });

  const h = adb.getReconcileHistory({ months: 12 });
  const p = h.points.find((x) => x.date === '2026-07-01');
  assert.strictEqual(p.gaps_open, 545);
  assert.strictEqual(p.retirement_candidates, 751);
  assert.deepStrictEqual(p.by_site.KALANA, 54);
});

test('deux captures le MÊME jour = un seul point, le dernier gagne (idempotent)', () => {
  adb.snapshotReconcile(view({ counts: Object.assign(view().counts, { gaps_open: 100 }) }), 'x', { asOf: '2026-07-05' });
  adb.snapshotReconcile(view({ counts: Object.assign(view().counts, { gaps_open: 80 }) }), 'x', { asOf: '2026-07-05' });
  const pts = adb.getReconcileHistory({ months: 12 }).points.filter((x) => x.date === '2026-07-05');
  assert.strictEqual(pts.length, 1);
  assert.strictEqual(pts[0].gaps_open, 80, 'la dernière capture du jour écrase la première');
});

test('retirement_candidates est NULL quand non applicable — jamais 0', () => {
  // Un 0 dessinerait une fausse chute sur la courbe. null = pas mesuré.
  adb.snapshotReconcile(view({
    counts: { gaps_open: 5, gaps_decided: 0, sites_touched: 1, ous_touched: 1,
      retirement_candidates: 0, retirement_applicable: false, sources_present: ['ad'] },
  }), 'x', { asOf: '2026-06-01' });
  const p = adb.getReconcileHistory({ months: 12 }).points.find((x) => x.date === '2026-06-01');
  assert.strictEqual(p.retirement_candidates, null);
  assert.strictEqual(p.retirement_applicable, false);
});

test('les points sortent triés par date croissante — une courbe se lit de gauche à droite', () => {
  const dates = adb.getReconcileHistory({ months: 12 }).points.map((x) => x.date);
  const sorted = [...dates].sort();
  assert.deepStrictEqual(dates, sorted);
});

test('la fenêtre months borne l\'historique', () => {
  adb.snapshotReconcile(view(), 'x', { asOf: '2020-01-01' });   // très ancien
  const recent = adb.getReconcileHistory({ months: 3 }).points.map((x) => x.date);
  assert.ok(!recent.includes('2020-01-01'), '2020 est hors de la fenêtre de 3 mois');
});

test('by_site permet à un site de tracer SA courbe', () => {
  const h = adb.getReconcileHistory({ months: 12 });
  // series_by_site : { KALANA: [{date,n}, ...], ... } aligné sur les points présents.
  assert.ok(h.series_by_site.KALANA, 'la série par site existe');
  const kal = h.series_by_site.KALANA.find((x) => x.date === '2026-07-01');
  assert.strictEqual(kal.n, 54);
});

// ── Journal des imports ─────────────────────────────────────────────────────
test('logImport ajoute une ligne par dépôt, listImportLog les rend du plus récent au plus ancien', () => {
  adb.logImport({ source: 'ad', row_count: 4807, dated_count: 4805, imported_by: 'azize', at: '2026-07-23T18:03:00Z' });
  adb.logImport({ source: 'entra', row_count: 6797, dated_count: 6797, imported_by: 'azize', at: '2026-07-23T17:54:00Z' });
  const log = adb.listImportLog(10);
  assert.ok(log.length >= 2);
  assert.ok(log[0].imported_at >= log[1].imported_at, 'le plus récent en premier');
  const ad = log.find((r) => r.source === 'ad');
  assert.strictEqual(ad.row_count, 4807);
  assert.strictEqual(ad.dated_count, 4805);
});

test('le journal est APPEND-ONLY — un second import AD ne remplace pas le premier', () => {
  const before = adb.listImportLog(50).filter((r) => r.source === 'ad').length;
  adb.logImport({ source: 'ad', row_count: 4810, dated_count: 4808, imported_by: 'azize', at: '2026-08-23T18:03:00Z' });
  const after = adb.listImportLog(50).filter((r) => r.source === 'ad').length;
  assert.strictEqual(after, before + 1, 'chaque import laisse sa propre trace');
});
