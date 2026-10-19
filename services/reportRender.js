'use strict';
// renderPdf(html, opts) → {ok, pdf?} | {ok:false, htmlOnly:true, reason}
// Uses the system Chrome/Edge in headless --print-to-pdf mode. All external
// bits (browser discovery, spawn, temp I/O) are injectable for tests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TIMEOUT = +(process.env.REPORT_PDF_TIMEOUT_MS || 90000);

function _findBrowser() {
  const candidates = [
    process.env.REPORT_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

async function renderPdf(html, opts = {}) {
  const findBrowser = opts.findBrowser || _findBrowser;
  const spawnFn = opts.spawnFn || spawn;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;
  const browser = findBrowser();
  if (!browser) return { ok: false, htmlOnly: true, reason: 'no browser found for PDF render' };

  const tmp = opts.tmpDir || os.tmpdir();
  const stamp = opts.stamp || 'report';
  const inHtml = path.join(tmp, `sdp-report-${stamp}.html`);
  const outPdf = path.join(tmp, `sdp-report-${stamp}.pdf`);
  try { (opts.writeFile || fs.writeFileSync)(inHtml, html); } catch (e) { return { ok: false, htmlOnly: true, reason: 'temp write failed: ' + e.message }; }

  const args = ['--headless', '--disable-gpu', '--no-sandbox', `--print-to-pdf=${outPdf}`, '--print-to-pdf-no-header', `file://${inHtml.replace(/\\/g, '/')}`];

  return await new Promise((resolve) => {
    let done = false;
    const child = spawnFn(browser, args, { windowsHide: true });
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch {} resolve({ ok: false, htmlOnly: true, reason: 'pdf render timed out' }); } }, timeoutMs);
    child.on('close', (code) => {
      if (done) return; done = true; clearTimeout(timer);
      if (code !== 0) return resolve({ ok: false, htmlOnly: true, reason: 'browser exited ' + code });
      try {
        const pdf = (opts.readOut || ((p) => fs.readFileSync(p)))(outPdf);
        resolve({ ok: true, pdf });
      } catch (e) { resolve({ ok: false, htmlOnly: true, reason: 'pdf read failed: ' + e.message }); }
    });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, htmlOnly: true, reason: 'spawn error: ' + e.message }); } });
  });
}

module.exports = { renderPdf, _findBrowser };
