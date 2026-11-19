#!/usr/bin/env node
'use strict';
// P04 PPM certification — T7 browser half: the interactive Gantt v2 (public/lib/ganttV2.js) with N tasks in a real
// headless Chromium. Measures (1) mount time, (2) frame times while the timeline is scrolled top → bottom → top for
// SCROLL_S seconds, (3) a memory soak: SOAK cycles of re-mount + full scroll, JS heap read through the DevTools
// protocol after a forced GC each cycle. Fictitious tasks only; no server, no database, no network (the page is a
// local file that loads the shipped public/lib files).
//
//   node tools/ppm/bench-gantt-browser.js [--tasks=5000] [--scroll-s=10] [--soak=30] [--json] [--chromium=<path>]
//
// Exit 0 always (a measurement, not a gate) unless the browser cannot be started (exit 2, reason printed).
// The 60 fps target = p95 frame ≤ 16.7 ms is the REQUEST's figure; whether it is the acceptance threshold is a PMO
// decision (PROPOSED). Headless frame times are an approximation of a real screen (no GPU compositing, no vsync).
const fs = require('fs');
const os = require('os');
const path = require('path');
const ENGINE = require('../../services/ppm/scheduleEngine');

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const N = Number(arg('tasks', 5000)), SCROLL_S = Number(arg('scroll-s', 10)), SOAK = Number(arg('soak', 30));
const JSON_OUT = process.argv.includes('--json');
const CANDIDATES = [arg('chromium', ''), process.env.PLAYWRIGHT_CHROMIUM || '', '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].filter(Boolean);

function tasksOf(n) {
  // 10-task chains under a summary every 50 tasks: links, summaries, milestones, progress — the shapes the page draws
  const t = [];
  for (let i = 1; i <= n; i++) {
    const summary = i % 50 === 1;
    const parent = summary ? null : i - ((i - 1) % 50);
    const row = { id: i, name: 'Fictitious task ' + i, parent_id: parent, status: i % 7 === 0 ? 'done' : 'todo', progress_pct: (i * 13) % 101, version: 1 };
    if (!summary) { row.duration_days = i % 25 === 0 ? 0 : 1 + (i % 5); row.effort_hours = 8 * row.duration_days; if ((i - 1) % 10 !== 1 && i > 2) row.depends_on = [i - 1]; }
    t.push(row);
  }
  return t;
}

async function main() {
  let pw; try { pw = require('playwright'); } catch (e) { console.error('playwright not installed:', e.message); process.exit(2); }
  const exe = CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
  let browser;
  try { browser = await pw.chromium.launch(exe ? { executablePath: exe, args: ['--js-flags=--expose-gc'] } : { args: ['--js-flags=--expose-gc'] }); }
  catch (e) { console.error('chromium could not start:', e.message.split('\n')[0]); process.exit(2); }
  const tasks = tasksOf(N);
  const t0 = process.hrtime.bigint();
  const plan = ENGINE.schedule(tasks, { anchor: '2027-01-04' });
  const engineMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gantt-bench-'));
  const lib = path.resolve(__dirname, '../../public/lib');
  fs.writeFileSync(path.join(dir, 'data.js'), 'window.__T=' + JSON.stringify(tasks) + ';window.__P=' + JSON.stringify(plan) + ';');
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://${lib}/ganttV2.css">
<style>body{margin:0;font:13px sans-serif} #g{width:1280px}</style><div id="g"></div>
<script src="file://${lib}/ganttCore.js"></script><script src="file://${lib}/ganttV2.js"></script><script src="data.js"></script>`);
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(dir, 'index.html'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => { await page.evaluate(() => window.gc && window.gc()); const m = (await cdp.send('Performance.getMetrics')).metrics; return Math.round((m.find((x) => x.name === 'JSHeapUsedSize') || {}).value / 1048576 * 10) / 10; };
  const mount = () => page.evaluate(() => {
    const s = performance.now();
    const el = document.getElementById('g'); el.innerHTML = '';
    window.GanttV2.mount(el, { pid: 1, tasks: window.__T, plan: window.__P, canEdit: true, typed: false, today: '2027-02-01', esc: null, api: () => Promise.resolve({}), reload: () => {}, msg: () => {}, fail: () => {} });
    const tl = el.querySelector('.g2-tl');
    return { ms: Math.round((performance.now() - s) * 10) / 10, bars: el.querySelectorAll('.g2-bar').length, rows: el.querySelectorAll('.g2-c[data-row]').length, scroll_h: tl ? tl.scrollHeight : null };
  });
  const scroll = (seconds) => page.evaluate((sec) => new Promise((done) => {
    const tl = document.querySelector('.g2-tl'); if (!tl) return done({ frames: 0, error: 'no timeline' });
    const max = tl.scrollHeight - tl.clientHeight; const frames = []; let last = performance.now(); const end = last + sec * 1000; let dir = 1, maxBars = 0;
    const step = Math.max(40, Math.round(max / (sec * 30)));   // a full top → bottom pass in about half the time
    function f(now) {
      frames.push(now - last); last = now;
      tl.scrollTop = Math.min(max, Math.max(0, tl.scrollTop + dir * step));
      tl.dispatchEvent(new Event('scroll'));
      if (tl.scrollTop >= max) dir = -1; else if (tl.scrollTop <= 0) dir = 1;
      maxBars = Math.max(maxBars, document.querySelectorAll('.g2-bar').length);
      if (now < end) requestAnimationFrame(f); else {
        frames.shift(); const s = frames.slice().sort((a, b) => a - b); const q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
        done({ frames: s.length, mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length * 10) / 10, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round(s[s.length - 1] * 10) / 10, over_16_7_ms: s.filter((x) => x > 16.7).length, max_bars_drawn: maxBars });
      }
    }
    requestAnimationFrame(f);
  }), seconds);
  // the same headless browser scrolling a plain 130 000-px div: the frame cadence this machine gives with NO Gantt
  const baseline = await page.evaluate((sec) => new Promise((done) => {
    const d = document.createElement('div'); d.style.cssText = 'height:800px;overflow:auto'; d.innerHTML = '<div style="height:130000px;background:linear-gradient(#fff,#ccc)"></div>'; document.body.appendChild(d);
    const fr = []; let last = performance.now(); const end = last + sec * 1000;
    function f(now) { fr.push(now - last); last = now; d.scrollTop += 400; if (now < end) requestAnimationFrame(f); else { d.remove(); fr.shift(); fr.sort((a, b) => a - b); done({ frames: fr.length, p50: Math.round(fr[fr.length >> 1] * 10) / 10, p95: Math.round(fr[Math.floor(fr.length * 0.95)] * 10) / 10 }); } }
    requestAnimationFrame(f);
  }), Math.min(5, SCROLL_S));
  const out = { tasks: N, baseline_plain_scroll: baseline, engine_schedule_ms: Math.round(engineMs), chromium: browser.version(), executable: exe || 'playwright default', headless: true };
  out.heap_before_mb = await heap();
  out.mount = await mount();
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const m0 = await metrics();
  out.scroll = await scroll(SCROLL_S);
  const m1 = await metrics();
  // where the scroll time went (seconds of main-thread work per category over the scroll run)
  const d = (k) => Math.round(((m1[k] || 0) - (m0[k] || 0)) * 1000);
  out.scroll.main_thread_ms = { script: d('ScriptDuration'), layout: d('LayoutDuration'), style: d('RecalcStyleDuration'), task_total: d('TaskDuration'), layouts: (m1.LayoutCount || 0) - (m0.LayoutCount || 0) };
  out.heap_after_first_mb = await heap();
  const soak = [];
  for (let i = 0; i < SOAK; i++) { await mount(); await scroll(1); soak.push(await heap()); }
  out.soak = { cycles: SOAK, heap_mb: soak, first: soak[0] == null ? null : soak[0], last: soak.length ? soak[soak.length - 1] : null, max: soak.length ? Math.max(...soak) : null,
    growth_mb_last_half: soak.length >= 4 ? Math.round((soak[soak.length - 1] - soak[Math.floor(soak.length / 2)]) * 10) / 10 : null };
  out.page_errors = errors;
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  if (JSON_OUT) { console.log(JSON.stringify(out, null, 1)); return; }
  console.log(`Gantt v2 browser bench — ${N} tasks, ${out.chromium} (headless)`);
  console.log(`  engine schedule        ${out.engine_schedule_ms} ms (Node)`);
  console.log(`  baseline (plain div)   p50 ${out.baseline_plain_scroll.p50} ms, p95 ${out.baseline_plain_scroll.p95} ms — what this headless browser gives without any Gantt`);
  console.log(`  mount                  ${out.mount.ms} ms, ${out.mount.bars} bars + ${out.mount.rows} grid cells in the DOM, scroll height ${out.mount.scroll_h}px`);
  console.log(`  scroll ${SCROLL_S}s            ${out.scroll.frames} frames, mean ${out.scroll.mean} ms, p50 ${out.scroll.p50}, p95 ${out.scroll.p95}, p99 ${out.scroll.p99}, max ${out.scroll.max}; ${out.scroll.over_16_7_ms} frames > 16.7 ms; max bars drawn ${out.scroll.max_bars_drawn}`);
  console.log(`  main thread during scroll: script ${out.scroll.main_thread_ms.script} ms · layout ${out.scroll.main_thread_ms.layout} ms · style ${out.scroll.main_thread_ms.style} ms · all tasks ${out.scroll.main_thread_ms.task_total} ms (${out.scroll.main_thread_ms.layouts} layouts)`);
  console.log(`  heap                   before ${out.heap_before_mb} MB · after first pass ${out.heap_after_first_mb} MB · soak ${SOAK} cycles: first ${out.soak.first} last ${out.soak.last} max ${out.soak.max} MB (growth over the last half ${out.soak.growth_mb_last_half} MB)`);
  if (errors.length) console.log('  page errors:', errors);
}
main().catch((e) => { console.error(e); process.exit(1); });
