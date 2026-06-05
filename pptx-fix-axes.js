/**
 * pptx-fix-axes.js
 *
 * Post-processes a pptxgenjs-generated PPTX buffer to fix a known bug in
 * pptxgenjs 3.12.x: combo charts with `secondaryValAxis/secondaryCatAxis:true`
 * reference secondary axis IDs in the series XML but never write the
 * corresponding <c:catAx> / <c:valAx> definitions.
 *
 * PowerPoint is strict — any referenced axId must have a definition block or
 * the chart is silently blank.  LibreOffice is forgiving so it renders fine there.
 *
 * This module scans every chart XML inside the PPTX, detects broken combo
 * charts, and injects the missing secondary axis definitions before handing
 * the buffer back.
 *
 * Usage:
 *   const { fixComboChartAxes } = require('./pptx-fix-axes');
 *   const buf = await pptx.write('nodebuffer');
 *   const fixed = await fixComboChartAxes(buf);
 *   res.send(fixed);
 */

'use strict';
const JSZip = require('jszip');

// ── XML helpers ──────────────────────────────────────────────────────────────

/** Return all axId values that have an actual <c:catAx> or <c:valAx> definition. */
function definedAxIds(xml) {
  const ids = new Set();
  for (const m of xml.matchAll(/<c:(?:catAx|valAx)>\s*<c:axId val="(\d+)"\/>/g)) {
    ids.add(m[1]);
  }
  return ids;
}

/** Return all axId values referenced inside a specific chart-type block. */
function chartBlockAxIds(xml, tag) {
  const m = xml.match(new RegExp(`<c:${tag}>.*?</c:${tag}>`, 's'));
  if (!m) return [];
  return [...m[0].matchAll(/<c:axId val="(\d+)"\/>/g)].map(r => r[1]);
}

/**
 * Strip a chart-type block's <c:axId> list down to only the IDs in `keepSet`.
 * pptxgenjs emits a spurious 3rd axId on both bar and line blocks in a combo
 * chart — this removes it.
 */
function trimAxIds(xml, tag, keepSet) {
  return xml.replace(
    new RegExp(`(<c:${tag}>.*?)((?:<c:axId val="\\d+"\\/>\\s*){2,})(</c:${tag}>)`, 's'),
    (_, open, axBlock, close) => {
      const kept = [...axBlock.matchAll(/<c:axId val="(\d+)"\/>/g)]
        .map(m => m[1])
        .filter(id => keepSet.has(id));
      const newAxIds = kept.map(id => `        <c:axId val="${id}"/>`).join('\n');
      return open + '\n' + newAxIds + '\n      ' + close;
    }
  );
}

/**
 * Build the XML for the two missing secondary axis definitions.
 *
 * @param {string} secCatId  axId for the hidden secondary category axis
 * @param {string} secValId  axId for the visible secondary value axis (right, 0-100%)
 */
function secondaryAxesXml(secCatId, secValId) {
  return `
      <c:catAx>
        <c:axId val="${secCatId}"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="1"/>
        <c:axPos val="b"/>
        <c:numFmt formatCode="General" sourceLinked="1"/>
        <c:majorTickMark val="none"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="none"/>
        <c:crossAx val="${secValId}"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:noMultiLvlLbl val="0"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="${secValId}"/>
        <c:scaling>
          <c:orientation val="minMax"/>
          <c:max val="100"/>
          <c:min val="0"/>
        </c:scaling>
        <c:delete val="0"/>
        <c:axPos val="r"/>
        <c:numFmt formatCode="0\\%" sourceLinked="0"/>
        <c:majorTickMark val="none"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:spPr>
          <a:ln w="12700" cap="flat">
            <a:solidFill><a:srgbClr val="888888"/></a:solidFill>
            <a:prstDash val="solid"/><a:round/>
          </a:ln>
        </c:spPr>
        <c:txPr>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:pPr>
              <a:defRPr sz="900" b="0" i="0" u="none" strike="noStrike">
                <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
                <a:latin typeface="Arial"/>
              </a:defRPr>
            </a:pPr>
            <a:endParaRPr lang="en-US"/>
          </a:p>
        </c:txPr>
        <c:crossAx val="${secCatId}"/>
        <c:crosses val="max"/>
        <c:crossBetween val="between"/>
      </c:valAx>`;
}

// ── Main fix function ────────────────────────────────────────────────────────

/**
 * Accepts a pptxgenjs `nodebuffer` output, fixes all combo chart secondary-axis
 * definitions, and returns a corrected Buffer.
 *
 * @param {Buffer} pptxBuffer
 * @returns {Promise<Buffer>}
 */
async function fixComboChartAxes(pptxBuffer) {
  const zip = await JSZip.loadAsync(pptxBuffer);
  let fixedCount = 0;

  const chartFiles = Object.keys(zip.files).filter(
    p => p.startsWith('ppt/charts/chart') && p.endsWith('.xml')
  );

  for (const path of chartFiles) {
    let xml = await zip.file(path).async('string');

    // Only process combo charts (bar + line in the same plotArea)
    if (!xml.includes('<c:barChart>') || !xml.includes('<c:lineChart>')) continue;

    const defined   = definedAxIds(xml);
    const barIds    = chartBlockAxIds(xml, 'barChart');
    const lineIds   = chartBlockAxIds(xml, 'lineChart');

    // barChart should keep only the 2 primary defined axes
    const barKeep   = new Set(barIds.filter(id => defined.has(id)));

    // lineChart secondary axes = IDs in lineChart that are NOT defined
    // (exclude the shared extra ID that also appears in barChart)
    const barExtra  = new Set(barIds.filter(id => !defined.has(id)));
    const lineSecondary = lineIds.filter(id => !defined.has(id) && !barExtra.has(id));

    if (lineSecondary.length !== 2) {
      // Unexpected structure — leave this chart alone
      console.warn(`[pptx-fix-axes] Skipping ${path}: unexpected secondary IDs ${lineSecondary}`);
      continue;
    }

    // Higher numeric value = catAx, lower = valAx (pptxgenjs convention)
    const secCatId = String(Math.max(...lineSecondary.map(Number)));
    const secValId = String(Math.min(...lineSecondary.map(Number)));

    // 1. Trim the spurious 3rd axId from both chart blocks
    xml = trimAxIds(xml, 'barChart',  barKeep);
    xml = trimAxIds(xml, 'lineChart', new Set(lineSecondary));

    // 2. Inject the secondary axis definitions before </c:plotArea>
    xml = xml.replace('</c:plotArea>', secondaryAxesXml(secCatId, secValId) + '\n    </c:plotArea>');

    zip.file(path, xml);
    fixedCount++;
  }

  if (fixedCount > 0) {
    console.log(`[pptx-fix-axes] Fixed ${fixedCount} combo chart(s)`);
  }

  return zip.generateAsync({
    type:               'nodebuffer',
    compression:        'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

module.exports = { fixComboChartAxes };
