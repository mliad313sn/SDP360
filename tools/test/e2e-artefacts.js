'use strict';
// G4-CI — classify the JSON files a browser-journey run leaves in the artefact directory.
//
// Two kinds of JSON land there:
//   - a JOURNEY artefact (tests/e2e/fixtures/browser.js): { journey, status, external:{…}, pages, page_errors }
//   - a side record written by a spec helper, e.g. the UAT committee's uat-<seat>.json
//     (tests/e2e/fixtures/uat.js): { seat, simulation, results } — no `journey`, no `external`.
// The runner used to treat every *.json as a journey artefact and crashed on the first UAT record
// ("Cannot read properties of undefined (reading 'unexpected_count')") after all 40 journeys had passed.
// A side record is kept (renamed run<i>-…) and summarised, never counted as a journey; a file that claims to be
// a journey but lacks the fields the gate needs is a PROBLEM, never a silent pass.

/** 'journey' | 'uat' | 'other' */
function kindOf(a) {
  if (a && typeof a === 'object' && typeof a.journey === 'string') return 'journey';
  if (a && typeof a === 'object' && typeof a.seat === 'string' && Array.isArray(a.results)) return 'uat';
  return 'other';
}

/** Problems for a journey artefact that cannot be judged (missing gate fields). [] when well-formed. */
function journeyShapeProblems(a) {
  const p = [];
  if (!a.external || typeof a.external !== 'object') p.push('no `external` request record');
  if (!Array.isArray(a.page_errors)) p.push('no `page_errors` list');
  return p;
}

/**
 * Fold one run's parsed artefacts into the summary. Pure: no I/O.
 * @param {number} run   1-based run number
 * @param {Array<{file:string, data:any}>} items
 * @param {object} summary  { journeys:{}, side_records:{} } — mutated
 * @returns {string[]} problems
 */
function collectRun(run, items, summary) {
  const problems = [];
  summary.journeys = summary.journeys || {};
  summary.side_records = summary.side_records || {};
  for (const { file, data: a } of items) {
    const kind = kindOf(a);
    if (kind === 'journey') {
      const bad = journeyShapeProblems(a);
      if (bad.length) { problems.push(`run ${run}: ${file} (${a.journey}) is not a judgeable journey artefact: ${bad.join(', ')}`); continue; }
      (summary.journeys[a.journey] = summary.journeys[a.journey] || []).push({ run, status: a.status, unexpected_external: a.external.unexpected_count, allowlisted_external: a.external.allowlisted_count, pages: a.pages, page_errors: a.page_errors.length });
      if (a.status !== 'passed') problems.push(`run ${run}: ${a.journey} status ${a.status}`);
      if (a.external.unexpected_count) problems.push(`run ${run}: ${a.journey} made ${a.external.unexpected_count} external request(s): ${(a.external.unexpected || []).slice(0, 5).join(', ')}`);
    } else if (kind === 'uat') {
      const by = {};
      for (const r of a.results) by[r.status] = (by[r.status] || 0) + 1;
      (summary.side_records[file] = summary.side_records[file] || []).push({ run, kind: 'uat', seat: a.seat, flows: a.results.length, by_status: by });
    } else {
      (summary.side_records[file] = summary.side_records[file] || []).push({ run, kind: 'other' });
    }
  }
  return problems;
}

module.exports = { kindOf, journeyShapeProblems, collectRun };
