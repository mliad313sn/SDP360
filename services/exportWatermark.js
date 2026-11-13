'use strict';
// P9 / goal B7 — export watermark (user + UTC timestamp), applied by services/exportPolicy.gate while
// export_watermark_enabled = '1'. Default '0' = files leave byte-for-byte as today.
//   csv  → a final line "# <watermark>" (after the data, so header parsing is untouched)
//   html → a footer paragraph before </body> (appended when there is no </body>)
//   xlsx → a first sheet "Export" (A1 = watermark) — SheetJS CE: cell styling is already dropped on write
//   pptx → a small footer text box on every slide (ZIP edit of ppt/slides/slideN.xml)
//   pdf / json / other → unchanged body; the X-Export-Watermark response header carries the stamp
// Any failure returns the original body: a watermark never costs an export.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function _csv(chunk, wm) {
  const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  const safe = '"# ' + String(wm).replace(/"/g, '""') + '"';   // quoted: never a formula cell
  return s + (s.endsWith('\n') ? '' : '\r\n') + safe + '\r\n';
}
function _html(chunk, wm) {
  const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  const foot = `<p class="export-watermark" style="font:11px Arial,sans-serif;color:#666;margin-top:24px">${esc(wm)}</p>`;
  return /<\/body>/i.test(s) ? s.replace(/<\/body>(?![\s\S]*<\/body>)/i, foot + '</body>') : s + foot;
}
function _xlsx(chunk, wm) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(chunk, { type: 'buffer' });
  const ws = XLSX.utils.aoa_to_sheet([[wm]]);
  ws['!cols'] = [{ wch: 80 }];
  let name = 'Export'; while (wb.SheetNames.includes(name)) name += '_';
  wb.SheetNames.unshift(name); wb.Sheets[name] = ws;
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
async function _pptx(chunk, wm) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(chunk);
  const shape = `<p:sp><p:nvSpPr><p:cNvPr id="9999" name="Export watermark"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="228600" y="0"/><a:ext cx="6400800" cy="228600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="none"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="700"><a:solidFill><a:srgbClr val="888888"/></a:solidFill></a:rPr><a:t>${esc(wm)}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const n of names) {
    const xml = await zip.file(n).async('string');
    if (xml.includes('</p:spTree>')) zip.file(n, xml.replace(/<\/p:spTree>(?![\s\S]*<\/p:spTree>)/, shape + '</p:spTree>'));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** → transformed body (same type family), or the original chunk when the format is not stamped. */
async function apply(chunk, contentType, wm) {
  try {
    const ct = String(contentType || '');
    if (/csv/.test(ct)) return _csv(chunk, wm);
    if (/html/.test(ct)) return _html(chunk, wm);
    if (/spreadsheetml/.test(ct) && Buffer.isBuffer(chunk)) return _xlsx(chunk, wm);
    if (/presentationml/.test(ct) && Buffer.isBuffer(chunk)) return await _pptx(chunk, wm);
    return chunk;
  } catch (_) { return chunk; }
}

module.exports = { apply };
