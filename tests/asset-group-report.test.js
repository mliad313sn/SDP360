'use strict';

// Task 2 (Assets reports integration) — PURE Asset Group digest composer.
// buildAssetGroupDigest({ leaderboard, forecast, coverage, period, fmtUsd }) -> { subject, html }
// Zero I/O: receives already-computed reader output, builds strings only.

const test = require('node:test');
const assert = require('node:assert');
const { buildAssetGroupDigest } = require('../services/assetGroupReport');
const { fmtUsd } = require('../services/money');

// getEffortLeaderboard() shape: { rows:[{site,effort_score,baseline_score,delta,rank}],
//   most_improved:{...row}|null, needs_attention:{...row}|null }
function makeLeaderboard() {
  return {
    rows: [
      { site: 'MANA', effort_score: 82, baseline_score: 74, delta: 8, rank: 1 },
      { site: 'Sabodala', effort_score: 61, baseline_score: 61, delta: 0, rank: 2 },
      { site: '<script>x</script>', effort_score: 44, baseline_score: 50, delta: -6, rank: 3 },
    ],
    most_improved: { site: 'MANA', effort_score: 82, baseline_score: 74, delta: 8, rank: 1 },
    needs_attention: { site: '<script>x</script>', effort_score: 44, baseline_score: 50, delta: -6, rank: 3 },
  };
}

// getInvestmentForecast() shape: { hardware, software } — coverage lives INSIDE each half.
function makeForecast() {
  return {
    hardware: {
      years: [
        { year: 2027, replacement_usd: 120000, count: 5 },
        { year: 2028, replacement_usd: 90000, count: 4 },
      ],
      due_now: { replacement_usd: 30000, count: 2 },
      beyond_horizon: { count: 9, usd: 777777 }, // COUNTED, never summed into a total
      total_forecast_usd: 240000,
      coverage: { eligible: 11, total: 200, pct: 6, excluded: { no_date: 150, no_cost: 30, no_life: 9 } },
    },
    software: {
      years: [
        { year: 2027, renewal_usd: 15000, count: 8 },
        { year: 2028, renewal_usd: 15000, count: 8 },
      ],
      due_now: { renewal_usd: 5000, count: 3 },
      beyond_horizon: { count: 0, usd: 0 },
      total_forecast_usd: 35000,
      recurring_count: 8,
      coverage: { eligible: 40, total: 50, pct: 80, excluded: { no_expiry: 6, no_cost: 4 } },
    },
  };
}

test('returns {subject, html}; subject carries "Assets" + the month', () => {
  const out = buildAssetGroupDigest({ leaderboard: makeLeaderboard(), forecast: makeForecast(), period: '2026-07', fmtUsd });
  assert.strictEqual(typeof out.subject, 'string');
  assert.match(out.subject, /Assets/);
  assert.match(out.subject, /2026-07/);
  assert.strictEqual(typeof out.html, 'string');
});

test('renders every leaderboard site with score, rank and signed delta', () => {
  const out = buildAssetGroupDigest({ leaderboard: makeLeaderboard(), forecast: makeForecast(), period: '2026-07', fmtUsd });
  assert.match(out.html, /MANA/);
  assert.match(out.html, /Sabodala/);
  assert.match(out.html, /82/);       // score
  assert.match(out.html, /\+8/);      // signed positive delta
  assert.match(out.html, /-6/);       // signed negative delta
});

test('renders most_improved and needs_attention lines', () => {
  const out = buildAssetGroupDigest({ leaderboard: makeLeaderboard(), forecast: makeForecast(), period: '2026-07', fmtUsd });
  assert.match(out.html, /progression/i);
  assert.match(out.html, /surveiller/i);
});

test('omits most_improved / needs_attention lines when null', () => {
  const lb = makeLeaderboard();
  lb.most_improved = null;
  lb.needs_attention = null;
  const out = buildAssetGroupDigest({ leaderboard: lb, forecast: makeForecast(), period: '2026-07', fmtUsd });
  assert.doesNotMatch(out.html, /progression/i);
  assert.doesNotMatch(out.html, /surveiller/i);
});

test('coverage banners appear with N/M/X% numbers, verbatim + prominent', () => {
  const out = buildAssetGroupDigest({ leaderboard: makeLeaderboard(), forecast: makeForecast(), period: '2026-07', fmtUsd });
  // Hardware banner: 11/200 (6%)
  assert.match(out.html, /matériel/i);
  assert.match(out.html, /11\s*\/\s*200/);
  assert.match(out.html, /6\s*%/);
  // Software banner: 40/50 (80%)
  assert.match(out.html, /logiciel/i);
  assert.match(out.html, /40\s*\/\s*50/);
  assert.match(out.html, /80\s*%/);
});

test('forecast amounts render via fmtUsd; no $ glyph anywhere', () => {
  const out = buildAssetGroupDigest({ leaderboard: makeLeaderboard(), forecast: makeForecast(), period: '2026-07', fmtUsd });
  assert.match(out.html, new RegExp(fmtUsd(120000).replace(/[.]/g, '\\.')));
  assert.match(out.html, /USD/);
  assert.ok(!out.html.includes('$'), 'html must not contain a $ glyph');
});

test('beyond_horizon rendered as a COUNT, never summed into a total', () => {
  const out = buildAssetGroupDigest({ leaderboard: makeLeaderboard(), forecast: makeForecast(), period: '2026-07', fmtUsd });
  assert.match(out.html, /au-delà de l'horizon/i);
  assert.match(out.html, /\b9\b/);                 // the beyond count
  assert.ok(!out.html.includes(fmtUsd(777777)), 'beyond_horizon usd must not be rendered/summed');
});

test('table-based markup only (Outlook): no flex/grid, no CSS custom properties', () => {
  const out = buildAssetGroupDigest({ leaderboard: makeLeaderboard(), forecast: makeForecast(), period: '2026-07', fmtUsd });
  assert.ok(!/display:\s*(inline-)?(flex|grid)/i.test(out.html));
  assert.ok(!/var\(--/.test(out.html));
});

test('site names are HTML-escaped (injection safety)', () => {
  const out = buildAssetGroupDigest({ leaderboard: makeLeaderboard(), forecast: makeForecast(), period: '2026-07', fmtUsd });
  assert.ok(!out.html.includes('<script>x</script>'));
  assert.match(out.html, /&lt;script&gt;/);
});

test('degrades cleanly with empty leaderboard + zero-coverage forecast', () => {
  const forecast = makeForecast();
  forecast.hardware.coverage = { eligible: 0, total: 0, pct: 0, excluded: { no_date: 0, no_cost: 0, no_life: 0 } };
  forecast.hardware.years = [];
  forecast.hardware.due_now = { replacement_usd: 0, count: 0 };
  forecast.hardware.beyond_horizon = { count: 0, usd: 0 };
  forecast.hardware.total_forecast_usd = 0;
  const out = buildAssetGroupDigest({
    leaderboard: { rows: [], most_improved: null, needs_attention: null },
    forecast, period: '2026-07', fmtUsd,
  });
  assert.strictEqual(typeof out.html, 'string');
  assert.ok(!out.html.includes('$'));
  assert.ok(!out.html.includes('NaN'));
  assert.match(out.html, /0\s*\/\s*0/); // coverage banner still renders
});
