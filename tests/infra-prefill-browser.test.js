'use strict';
// P4 / B9 — real Chromium proof of the prefill rule the weekly report uses (public/lib/infraPrefill.js applyToDom):
//   * a value TYPED while the snapshot request is still in flight is NOT overwritten when the answer arrives;
//   * a value already present (saved/typed earlier) is never overwritten; an empty measurable cell is filled;
//   * a measurable cell without a snapshot is reported unknown (never 0), Backup is left alone;
//   * at 360 px the provenance badge stays inside the viewport (no horizontal page scroll).
// Skips ONLY when Playwright/Chromium are absent.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

let pw = null; try { pw = require('playwright'); } catch (_) { pw = null; }
const PUB = path.join(__dirname, '..', 'public');
const FIXTURE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font:14px sans-serif} table{width:100%;border-collapse:collapse} td{display:block;padding:4px 8px} input{width:100%;box-sizing:border-box;font-size:16px}
.infra-prov{display:inline-block;margin-top:3px;max-width:100%;overflow-wrap:anywhere;font-size:.72rem}</style>
<script src="/lib/wanLineMatch.js"></script><script src="/lib/infraPrefill.js"></script></head><body><main><table><tbody id="infra-body">
<tr><td><input value="WAN1 Fetekro Exploration very long service name"></td><td><input class="infra-value-input" value=""><span class="infra-prov" id="p0"></span></td></tr>
<tr><td><input value="LAN"></td><td><input class="infra-value-input" value=""><span class="infra-prov" id="p1"></span></td></tr>
<tr><td><input value="WLAN"></td><td><input class="infra-value-input" value="97%"><span class="infra-prov" id="p2"></span></td></tr>
<tr><td><input value="Servers"></td><td><input class="infra-value-input" value=""><span class="infra-prov" id="p3"></span></td></tr>
<tr><td><input value="Backup"></td><td><input class="infra-value-input" value=""><span class="infra-prov" id="p4"></span></td></tr>
</tbody></table></main></body></html>`;

function serve() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/fixture.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(FIXTURE); }
    const f = path.join(PUB, path.normalize(u.pathname).replace(/^([/\\])+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

const DATA = { fills: [
  { match: 'wan1', sub_site: '', value: '99.9%', source: 'meraki', data_through: '2026-11-07' },
  { match: 'lan', sub_site: '', value: '98%', source: 'opmanager', data_through: '2026-11-08' },
  { match: 'wifi', sub_site: '', value: '99.5%', source: 'opmanager', data_through: '2026-11-08' },
], tokens: [] };

test('a value typed during the in-flight prefill survives; empty cells fill; unknown stays unknown; 360 px fits', { skip: !pw && 'playwright not installed on this machine' }, async (t) => {
  let browser; try { browser = await pw.chromium.launch(); } catch (e) { t.skip('chromium not available: ' + e.message.split('\n')[0]); return; }
  const srv = await serve();
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + srv.address().port + '/fixture.html');
    await page.waitForFunction(() => !!window.InfraPrefill);
    // the editor opens: prefill request starts but has not answered yet
    await page.evaluate(() => {
      window.__release = null;
      const pending = new Promise((r) => { window.__release = r; });
      window.__result = pending.then((data) => {
        const res = window.InfraPrefill.applyToDom(document.getElementById('infra-body'), data, {
          onFill: (tr, f) => { tr.querySelector('.infra-prov').textContent = window.InfraPrefill.provenance({ status_value: f.value, value_source: f.source, value_data_through: f.data_through }).text; },
          onUnknown: (tr) => { tr.querySelector('.infra-prov').textContent = window.InfraPrefill.provenance({ status_value: '', measurable: true }).text; },
        });
        return { filled: res.filled, unknown: res.unknown };
      });
    });
    // ...the coordinator types the WAN1 value meanwhile
    await page.fill('#infra-body tr:nth-child(1) .infra-value-input', '95%');
    await page.evaluate((d) => window.__release(d), DATA);
    const res = await page.evaluate(() => window.__result);
    const vals = await page.$$eval('#infra-body .infra-value-input', (els) => els.map((e) => e.value));
    assert.deepStrictEqual(vals, ['95%', '98%', '97%', '', ''], 'typed WAN1 and saved WLAN kept; LAN filled; Servers unknown; Backup untouched');
    assert.deepStrictEqual(res, { filled: 1, unknown: 1 });
    assert.strictEqual(await page.textContent('#p1'), 'OpManager · 2026-11-08', 'visible provenance badge, not only a tooltip');
    assert.strictEqual(await page.textContent('#p3'), '— inconnu');
    assert.strictEqual(await page.textContent('#p0'), '', 'no auto badge on the typed value');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, 'no horizontal scroll at 360 px (' + overflow + ' px)');
    assert.deepStrictEqual(errors, []);
  } finally { srv.close(); await browser.close(); }
});
