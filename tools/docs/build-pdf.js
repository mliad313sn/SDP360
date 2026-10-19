'use strict';
// Builds a paginated A4 PDF (cover, TOC with page numbers, running header/footer) from a markdown study.
// Needs: pandoc, playwright (+ chromium), pagedjs. Usage: node tools/docs/build-pdf.js <md> <out.pdf> <title> <ref> <version>
// Expects pagedjs/dist/paged.polyfill.js resolvable via require and docs/sdp360/pdf-style.css next to it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
let [,, mdPath, outPdf, title, ref, version] = process.argv;
const body = cp.execSync(`pandoc "${mdPath}" -f gfm+pipe_tables -t html5 --wrap=none`, { encoding: 'utf8', maxBuffer: 64e6 });
// Drop the pandoc H1 + its italic subtitle (they go on the cover); keep body from first <blockquote> onward.
let html = body.replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*<p><em>[\s\S]*?<\/em><\/p>\s*/, '');
// paged.js uses querySelector('#id') — ids starting with a digit are invalid selectors → prefix all ids.
html = html.replace(/ id="([^"]+)"/g, (m, id) => ` id="s-${id}"`).replace(/href="#([^"]+)"/g, (m, id) => `href="#s-${id}"`);
const heads = [...html.matchAll(/<h([23]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)]
  .map(m => ({ lvl: m[1], id: m[2], text: m[3].replace(/<[^>]+>/g, '') }));
const toc = '<nav class="toc"><h2 class="toc-title">Sommaire</h2><ul>' + heads.map(h =>
  `<li class="lvl${h.lvl}"><a href="#${h.id}"><span class="t">${h.text}</span><span class="dots"></span><span class="pg"></span></a></li>`).join('') + '</ul></nav>';
const today = '2026-10-19';
const cover = `<section class="cover">
 <div class="brand">ENDEAVOUR MINING · GROUP IT OPERATIONS</div>
 <h1 class="ct">${title}</h1>
 <p class="sub">Document d'étude et de commande</p>
 <table class="ctl"><tr><th>Référence</th><td>${ref}</td></tr><tr><th>Version</th><td>${version}</td></tr><tr><th>Date</th><td>${today}</td></tr>
 <tr><th>Statut</th><td>Pour décision (direction) · Pour exécution (comité produit, agent IA)</td></tr>
 <tr><th>Confidentialité</th><td>Interne — usage Endeavour Mining</td></tr></table>
 <p class="foot">Base d'analyse : dépôt SDP-Dashboard v1.11 (HEAD e74d4cf) — relecture complète du code, des schémas, des tests et du journal de conception.</p>
</section>`;
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'sdp360', 'pdf-style.css'), 'utf8') + `
@page { size: A4; margin: 22mm 16mm 20mm 16mm;
  @top-left { content: "${title}"; font-size: 8pt; color: #64748b; font-family: "DejaVu Sans", sans-serif; }
  @top-right { content: "${ref} · v${version}"; font-size: 8pt; color: #64748b; font-family: "DejaVu Sans", sans-serif; }
  @bottom-left { content: "Interne — Endeavour Mining"; font-size: 8pt; color: #64748b; font-family: "DejaVu Sans", sans-serif; }
  @bottom-right { content: "Page " counter(page) " / " counter(pages); font-size: 8pt; color: #64748b; font-family: "DejaVu Sans", sans-serif; } }
@page cover { margin: 0; @top-left{content:none} @top-right{content:none} @bottom-left{content:none} @bottom-right{content:none} }
.cover { page: cover; height: 297mm; box-sizing: border-box; padding: 40mm 22mm; background: linear-gradient(180deg,#1E293B 0 38%, #fff 38%); break-after: page; }
.cover .brand { color: #E87722; letter-spacing: 2px; font-size: 10pt; font-weight: bold; }
.cover .ct { color: #fff; border: none; font-size: 26pt; margin-top: 30mm; line-height: 1.2; }
.cover .sub { color: #cbd5e1; font-size: 13pt; margin-bottom: 40mm; }
.cover table.ctl { width: 70%; font-size: 10pt; } .cover table.ctl th { width: 32%; background: #f1f5f9; color: #1E293B; }
.cover .foot { position: absolute; bottom: 25mm; left: 22mm; right: 22mm; font-size: 8.5pt; color: #64748b; }
.toc { break-after: page; } .toc ul { list-style: none; padding: 0; margin: 0; } .toc li { margin: 2px 0; }
.toc li a { display: flex; align-items: baseline; color: #1f2937; } .toc .dots { flex: 1; border-bottom: 1px dotted #94a3b8; margin: 0 4px; }
.toc li.lvl2 { font-weight: bold; margin-top: 8px; } .toc li.lvl3 { padding-left: 14px; font-size: 9.5pt; }
.toc .pg::after { content: target-counter(attr(href url), page); }
.toc li a .pg { font-variant-numeric: tabular-nums; }
h2 { break-before: page; } h2.toc-title { break-before: auto; }
h2, h3 { break-after: avoid; } table, pre, blockquote { break-inside: auto; } thead { display: table-header-group; }
`;
// paged.js needs the href attr on the .pg span for target-counter → move href
html = toc.replace(/<a href="(#[^"]+)"><span class="t">([^<]*)<\/span><span class="dots"><\/span><span class="pg"><\/span><\/a>/g,
  '<a href="$1"><span class="t">$2</span><span class="dots"></span><span class="pg" href="$1"></span></a>') + html;
const polyfill = fs.readFileSync(require.resolve('pagedjs/dist/paged.polyfill.js'), 'utf8');
const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${cover}${html}<script>${polyfill}</script></body></html>`;
outPdf = require('path').resolve(outPdf); const htmlOut = outPdf.replace(/\.pdf$/, '.html'); fs.writeFileSync(htmlOut, page);
(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: fs.readdirSync('/opt/pw-browsers').filter(d => /^chromium-\d+$/.test(d)).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(fs.existsSync) });
  const pg = await browser.newPage();
  pg.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await pg.goto('file://' + htmlOut, { waitUntil: 'load' });
  pg.on('console', m => console.log('console:', m.type(), m.text().slice(0,200)));
  pg.on('pageerror', e => console.error('pageerror:', e.message));
  // wait until the page count stops changing for 4 s
  let last = -1, stable = 0;
  for (let i = 0; i < 180 && stable < 4; i++) { await pg.waitForTimeout(1000); const c = await pg.evaluate(() => document.querySelectorAll('.pagedjs_page').length); if (c === last && c > 0) stable++; else stable = 0; last = c; }
  const n = await pg.evaluate(() => document.querySelectorAll('.pagedjs_page').length);
  await pg.pdf({ path: outPdf, preferCSSPageSize: true, printBackground: true });
  await browser.close(); console.log('pages', n, '→', outPdf);
})().catch(e => { console.error(e); process.exit(1); });
