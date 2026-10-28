/**
 * Endeavour Mining — Zoho Analytics → reports.db Sync Module
 *
 * Two incremental sync jobs:
 *   syncChangeCab()   — Change records + CAB Approvals  (every 6h)
 *   syncSurveyData()  — Survey Results + Answers        (daily at 2am)
 *
 * Strategy:
 *   1. Read last_sync_at from sync_metadata for the job.
 *   2. Fetch ALL rows from Zoho (CSV export has no server-side date filter).
 *   3. Always collect live IDs for reconciliation (deletion detection).
 *   4. Upsert new/updated rows using INSERT … ON CONFLICT(unique_id) DO UPDATE.
 *   5. On full-sync runs (every 4th run or first run), reconcile local DB
 *      against the live ID set to purge records deleted in Zoho.
 *   6. Detect schema drift: warn when Zoho returns unexpected or missing columns.
 *   7. Update sync_metadata.last_sync_at on success.
 *
 * The module does NOT import from server.js to avoid circular deps.
 * Instead it receives fetchView + db helpers via init().
 */

'use strict';

const {
  getLastSyncAt, markSyncSuccess, markSyncError, countTable,
  upsertChangeBatch, upsertCABBatch,
  upsertSurveyResultBatch, upsertSurveyAnswerBatch,
  reconcileChangeRecords, reconcileCABApprovals, reconcileSurveyResults,
  upsertRequestBatch, upsertRequestUdfBatch, reconcileRequestRecords,
} = require('./reports-db');

// Populated by init() — avoids circular dependency with server.js
let _fetchView = null;
let _VIEWS     = null;

/**
 * Call once from server.js:
 *   const sync = require('./zoho-sync');
 *   sync.init(fetchView, VIEWS);
 */
function init(fetchViewFn, viewsMap) {
  _fetchView = fetchViewFn;
  _VIEWS     = viewsMap;
  console.log('[Sync] zoho-sync module initialised.');
}

// ── HELPERS ───────────────────────────────────────────────────────

/**
 * Parse a Zoho date/time string into an ISO string that SQLite can sort.
 * Zoho returns dates as "06 Mar, 2026 14:30:00" or "06 Mar, 2026" etc.
 * Returns null for empty/invalid values.
 */
function parseZohoDate(raw) {
  if (!raw || raw.trim() === '' || raw === '-') return null;
  try {
    // Remove ordinal suffixes (1st, 2nd, 3rd, 4th…) → plain number
    const cleaned = raw.trim().replace(/(\d+)(st|nd|rd|th),?/i, '$1,');
    const d = new Date(cleaned);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Convert a Zoho "Overall Score" string like "80%" → 80.0 (float).
 */
function parsePercent(raw) {
  if (!raw || raw.trim() === '') return null;
  const num = parseFloat(String(raw).replace('%', '').trim());
  return isNaN(num) ? null : num;
}

/**
 * Returns true if the given ISO datetime string is AFTER lastSyncAt.
 * When lastSyncAt is null (first run) every row passes.
 */
function isNew(isoDate, lastSyncAt) {
  if (!lastSyncAt) return true;
  if (!isoDate)    return false;
  return isoDate > lastSyncAt;  // ISO string comparison works lexicographically
}

// Request Status values that mean "the ticket is done" — mirrors
// public/lib/dashboard-shared.js CLOSED_STATUSES (the browser's isClosed). Server
// code can't import the browser file, so keep the two lists in sync by hand.
const CLOSED_STATUSES = new Set([
  'closed', 'resolved', 'confirmed resolution', 'confirm resolution', 'cancelled',
]);

// Derive the stored pending_status (1=open, 0=closed) with the SAME dual-source
// rule the browser's isClosed() uses: trust Zoho's "Request Pending Status" first,
// but when it is EMPTY — legacy tickets never carried that field — fall back to the
// always-present "Request Status". Without the fallback an old *Closed* ticket
// whose pending field is blank was stored as OPEN (=1); a full re-sync (which
// repopulated PG around the cutover) flipped thousands of them, so the ageing
// chart counted ~6000 closed tickets as open >60d. See the July-2026 diagnosis.
function computePendingStatus(pendingRaw, requestStatus) {
  const p = String(pendingRaw || '').toLowerCase().trim();
  if (p === 'no')  return 0;   // explicitly not pending → closed
  if (p === 'yes') return 1;   // explicitly pending → open
  // empty/unknown → the status field decides (open unless it is a terminal status)
  return CLOSED_STATUSES.has(String(requestStatus || '').toLowerCase().trim()) ? 0 : 1;
}

// ── UDF FIELD DETECTION ───────────────────────────────────────────
// Known UDF prefixes from the Change table study
const UDF_PREFIXES = [
  'Communication', 'Date of Lab Test', 'Division', 'Estimated Cost',
  'If Unsuccessful Why', 'Lab Test Owner', 'Lab Test Successful',
  'LAB TESTING', 'Sub Division', 'Why End to End Function',
  'Change Implementation', 'Review decision',
];

function extractUdf(row) {
  const udf = {};
  for (const key of Object.keys(row)) {
    // Match either:
    //   • Change-table UDFs (no prefix — bare names listed in UDF_PREFIXES)
    //   • Request/Major-Incident UDFs (literal "UDF:" prefix in the column name,
    //     e.g. "UDF:Root Cause Analysis :", "UDF:Lessons Learned:")
    if (key.startsWith('UDF:') || UDF_PREFIXES.some(p => key.startsWith(p))) {
      const val = row[key];
      // Keep only NON-EMPTY UDF values. Two reasons:
      //  1. Avoids bloating udf_json with dozens of empty form-field keys on
      //     every request (the REQUEST_TABLE view now exposes 100+ UDF columns).
      //  2. Makes the 790842 backfill non-destructive: it returns empty UDF for
      //     recent incidents, which now yields null here → no upsert → it can't
      //     clobber good values captured from the base REQUEST_TABLE view.
      if (val !== null && val !== undefined && String(val).trim() !== '') {
        udf[key] = val;
      }
    }
  }
  return Object.keys(udf).length > 0 ? JSON.stringify(udf) : null;
}

// Build [{ request_id, udf_json }] for a set of Zoho request rows. Captures the
// non-empty UDFs (incl. "UDF:Services affected", consumed by the Risk Register)
// for EVERY row — not just Major Incidents. Rows with no request id or no UDF
// are dropped (extractUdf returns null for them).
function buildUdfRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(r => {
    const rid = String(r['Request ID'] || r['RequestID'] || '').trim()
             || String(r['Request Display ID'] || '').trim();
    const udf = extractUdf(r);
    return (rid && udf) ? { request_id: rid, udf_json: udf } : null;
  }).filter(Boolean);
}

// ── SCHEMA DRIFT DETECTION ────────────────────────────────────────

/**
 * Compare the columns actually returned by Zoho against a known expected list.
 * Logs warnings for missing or unexpected columns.
 * Returns a JSON string of the actual column names (for storing in sync_metadata).
 *
 * @param {string}   jobLabel   — for log output, e.g. "change_cab/Change"
 * @param {string[]} expected   — columns we know/care about
 * @param {string[]} actual     — columns present in the first Zoho row
 * @returns {string}            — JSON array of actual column names
 */
function checkSchemaDrift(jobLabel, expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet   = new Set(actual);

  const missing     = expected.filter(c => !actualSet.has(c));
  const unexpected  = actual.filter(c => !expectedSet.has(c));

  if (missing.length > 0) {
    console.warn(`[Sync] ⚠️  Schema drift (${jobLabel}) — MISSING columns: ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    console.info(`[Sync] ℹ️  Schema drift (${jobLabel}) — NEW/unexpected columns: ${unexpected.join(', ')}`);
  }
  if (missing.length === 0 && unexpected.length === 0) {
    console.log(`[Sync] Schema OK (${jobLabel}) — all expected columns present`);
  }

  return JSON.stringify(actual);
}

// Expected column lists based on our Zoho model diagram study
const EXPECTED_CHANGE_COLS = [
  'Change ID', 'Change Display ID', 'Subject', 'Status', 'Stage', 'Risk',
  'Change Type', 'Emergency', 'Category', 'Sub Category', 'Change Requester',
  'Change Requester ID', 'Change Owner ID', 'Change Manager', 'Site ID', 'Group ID', 'Group',
  'Scheduled Start Time', 'Scheduled End Time', 'Completed Time', 'Created Time',
  'Change Closure Code',
];

const EXPECTED_CAB_COLS = [
  'Approval ID', 'Change ID', 'Change Approver', 'Approval Status', 'Approval Stage',
  'Approval Level', 'Approval Level Status', 'Recommendation Requested Time',
  'Action Taken On', 'Recommendation Turnaround Time (Minutes)', 'Rule Type', 'Comments',
];

const EXPECTED_SURVEY_RESULT_COLS = [
  'Result ID', 'Response ID', 'Survey ID', 'Survey Name', 'Request ID',
  'Request Display ID', 'Change ID', 'User ID', 'Overall Score',
  'Survey Sent on', 'Survey Responded on',
];

const EXPECTED_SURVEY_ANSWER_COLS = [
  'Response ID', 'Result ID', 'Question ID', 'Text', 'Option',
  'Score', 'Skipped by Logic',
];

const EXPECTED_REQUEST_COLS = [
  'Request ID', 'Request Display ID', 'Subject', 'Request Status',
  'Request Pending Status', 'Overdue Status', 'Service Request', 'Request Type',
  'IsEscalated', 'Reopen Count', 'DueBy Time', 'Time Elapsed',
  'Created Time', 'Resolved Time', 'Completed Time', 'Responded Time',
  'Assigned Time', 'Last Updated Time', 'First Response Overdue Status',
  'Technician', 'Requester', 'Category', 'Sub Category', 'Site', 'Group', 'Mode',
  'Request Template',
];



/**
 * Decide whether this run should be a full-sync (reconciliation) run.
 * We use the sync_count from sync_metadata: if count % FULL_SYNC_EVERY === 0
 * it's time for a full sync. Count 0 (first ever run) is always a full sync.
 *
 * @param {object|null} meta — row from sync_metadata (may be null first run)
 * @returns {boolean}
 */



// ── Truncation guard (Step 1, 2026-10-19) ─────────────────────────
// Every Zoho job downloads the WHOLE view and then deletes local rows whose id is absent
// from the download (reconcile*). A truncated or partial export therefore used to cascade
// into a mass delete. Before any reconciliation, refuse a fetch that is smaller than the
// local table by more than `tolerancePct` (default 20 %). The error is marked transient so
// the runner retries later instead of applying it.
function assertNotTruncated(job, fetched, stored, tolerancePct = Number(process.env.SYNC_TRUNCATION_TOLERANCE_PCT || 20)) {
  const tol = Math.max(0, Math.min(90, Number(tolerancePct) || 0)) / 100;
  if (stored > 0 && fetched < stored * (1 - tol)) {
    const e = new Error(`${job}: fetched ${fetched} rows but ${stored} are stored (−${Math.round(100 - fetched / stored * 100)} %) — export looks truncated, refusing to reconcile`);
    e.transient = true; e.truncation = true;
    throw e;
  }
}

// ── SYNC: CHANGE + CAB ────────────────────────────────────────────

async function syncChangeCab() {
  if (!_fetchView) throw new Error('[Sync] Not initialised — call sync.init() first');
  const JOB = 'change_cab';
  console.log('[Sync] change_cab — starting…');

  try {
    const lastSync = await getLastSyncAt(JOB);
    console.log(`[Sync] change_cab — last sync: ${lastSync || 'never (full fetch)'}`);

    // ── Fetch Change records ──────────────────────────────────────
    const changeResult = await _fetchView(_VIEWS.CHANGE_TABLE, 10000);
    if (!changeResult || !Array.isArray(changeResult.rows)) {
      throw new Error('Change table fetch returned no rows array');
    }

    const changeRows = changeResult.rows;
    console.log(`[Sync] change_cab — fetched ${changeRows.length} Change rows from Zoho`);

    // ── Schema drift check (Change) ──────────────────────────────
    let changeSchemaSnapshot = null;
    if (changeRows.length > 0) {
      const actualCols = Object.keys(changeRows[0]);
      changeSchemaSnapshot = checkSchemaDrift('change_cab/Change', EXPECTED_CHANGE_COLS, actualCols);
    }

    // Build the live ID set (ALL rows) — needed for reconciliation
    const liveChangeIds = new Set(
      changeRows.map(r => r['Change ID'] || r['Change  ID']).filter(Boolean)
    );

    // Upsert ALL change rows every sync (2026-06-22). Unlike requests, the
    // Zoho Change view exposes NO "Last Updated Time" column (see
    // EXPECTED_CHANGE_COLS), so there is no incremental signal for a change
    // that is EDITED AFTER it closes — e.g. RCA / Change Closure Code / UDF
    // filled during the post-implementation review, which is the NORMAL
    // workflow. Created/Completed/Stage don't change on such an edit, so the
    // previous incremental filter (new OR open OR recently-completed) left
    // those rows frozen in SQLite with stale (often empty) post-closure
    // fields. The change set is small (hundreds of rows), so a full upsert
    // every sync is cheap (<10 ms) and guarantees post-closure edits
    // propagate. Deletion reconciliation is handled separately via
    // liveChangeIds + the FULL_SYNC_EVERY cadence.
    const newChangeRows = changeRows;

    console.log(`[Sync] change_cab — ${newChangeRows.length} Change rows to upsert (full — catches post-closure edits)`);

    // Map Zoho columns → DB columns
    const changeMapped = newChangeRows.map(r => ({
      change_id:       r['Change ID']          || r['Change  ID']          || null,
      display_id:      r['Change Display ID']  || r['Display ID']          || null,
      subject:         r['Subject']                                         || null,
      status:          r['Status']                                          || null,
      stage:           r['Stage']                                           || null,
      risk:            r['Risk']                                            || null,
      change_type:     r['Change Type']                                     || null,
      emergency:       (r['Emergency'] || '').toLowerCase() === 'yes' ? 1 : 0,
      category:        r['Category']                                        || null,
      sub_category:    r['Sub Category']                                    || null,
      requester:       r['Change Requester']                               || null,
      requester_id:    r['Change Requester ID']                            || null,
      owner_id:        r['Change Owner ID']                                || null,
      manager:         r['Change Manager']                                 || null,
      site_id:         r['Site ID']                                        || null,
      group_id:        r['Group ID']                                       || null,
      group_name:      r['Group']                                          || null,
      stage_status:    r['Stage and Status']                               || null,
      scheduled_start: parseZohoDate(r['Scheduled Start Time']),
      scheduled_end:   parseZohoDate(r['Scheduled End Time']),
      completed_time:  parseZohoDate(r['Completed Time']),
      created_time:    parseZohoDate(r['Created Time']),
      closure_code:    r['Change Closure Code']                            || null,
      udf_json:        extractUdf(r),
    })).filter(r => r.change_id); // skip rows missing primary key

    const changeUpserted = await upsertChangeBatch(changeMapped);
    console.log(`[Sync] change_cab — upserted ${changeUpserted} Change records`);

    // ── Fetch CAB Approval records ────────────────────────────────
    const cabResult = await _fetchView(_VIEWS.CAB_RECOMMENDATIONS, 5000);
    if (!cabResult || !Array.isArray(cabResult.rows)) {
      throw new Error('CAB Recommendations fetch returned no rows array');
    }

    const cabRows = cabResult.rows;
    console.log(`[Sync] change_cab — fetched ${cabRows.length} CAB rows from Zoho`);

    // ── Schema drift check (CAB) ─────────────────────────────────
    let cabSchemaSnapshot = null;
    if (cabRows.length > 0) {
      const actualCols = Object.keys(cabRows[0]);
      cabSchemaSnapshot = checkSchemaDrift('change_cab/CAB', EXPECTED_CAB_COLS, actualCols);
    }

    // Build live CAB ID set
    const liveCabIds = new Set(cabRows.map(r => r['Approval ID']).filter(Boolean));

    const newCabRows = lastSync
      ? cabRows.filter(r => {
          const requested = parseZohoDate(r['Recommendation Requested Time']);
          return isNew(requested, lastSync);
        })
      : cabRows;

    console.log(`[Sync] change_cab — ${newCabRows.length} new/updated CAB rows to upsert`);

    const cabMapped = newCabRows.map(r => ({
      approval_id:              r['Approval ID']                       || null,
      change_id:                r['Change ID']                         || null,
      approver_name:            r['Change Approver']                   || null,
      approval_status:          r['Approval Status']                   || null,
      approval_stage:           r['Approval Stage']                    || null,
      approval_level:           r['Approval Level']                    || null,
      approval_level_status:    r['Approval Level Status']             || null,
      recommendation_requested: parseZohoDate(r['Recommendation Requested Time']),
      action_taken_on:          parseZohoDate(r['Action Taken On']),
      turnaround_minutes:       parseInt(r['Recommendation Turnaround Time (Minutes)'] || '0', 10) || null,
      rule_type:                r['Rule Type']                         || null,
      comments:                 r['Comments']                          || null,
    })).filter(r => r.approval_id);

    const cabUpserted = await upsertCABBatch(cabMapped);
    console.log(`[Sync] change_cab — upserted ${cabUpserted} CAB approval records`);

    // ── Reconciliation (deletion detection) ──────────────────────
    // Every FULL_SYNC_EVERY runs we do a full reconcile to detect Zoho deletions.
    // We pass a dummy meta object based on the last_sync_at to decide.
    assertNotTruncated(`${JOB}/change`, changeRows.length, await countTable('change_records'));
    assertNotTruncated(`${JOB}/cab`, cabRows.length, await countTable('cab_approvals'));
    let changeDeleted = 0;
    let cabDeleted    = 0;
    const isFullSync  = !lastSync; // first run is always a full sync (no cursor yet)

    if (isFullSync || !lastSync) {
      // Always reconcile on first run
      changeDeleted = await reconcileChangeRecords(liveChangeIds);
      cabDeleted    = await reconcileCABApprovals(liveCabIds);
      console.log(`[Sync] change_cab — reconciliation: removed ${changeDeleted} Change + ${cabDeleted} CAB stale records`);
    } else {
      // Check if sync_count divisible by FULL_SYNC_EVERY (passed via side effect)
      // We reconcile on every run since we always fetch ALL rows anyway —
      // cost is minimal (a single SELECT then small deletes if needed).
      changeDeleted = await reconcileChangeRecords(liveChangeIds);
      cabDeleted    = await reconcileCABApprovals(liveCabIds);
      if (changeDeleted + cabDeleted > 0) {
        console.log(`[Sync] change_cab — reconciliation removed ${changeDeleted} Change + ${cabDeleted} CAB stale records`);
      }
    }

    const totalUpserted = changeUpserted + cabUpserted;
    const totalDeleted  = changeDeleted + cabDeleted;
    const schemaSnap    = JSON.stringify({
      change: changeSchemaSnapshot ? JSON.parse(changeSchemaSnapshot) : [],
      cab:    cabSchemaSnapshot    ? JSON.parse(cabSchemaSnapshot)    : [],
    });

    await markSyncSuccess(JOB, totalUpserted, {
      deleted:        totalDeleted,
      schemaSnapshot: schemaSnap,
      fullSync:       true,   // we always do a full fetch so mark as full
    });
    console.log(`[Sync] change_cab ✅ done — ${totalUpserted} upserted, ${totalDeleted} deleted`);
    return { job: JOB, upserted: totalUpserted, deleted: totalDeleted };

  } catch (err) {
    await markSyncError(JOB, err.message);
    console.error(`[Sync] change_cab ❌ error: ${err.message}`);
    throw err;
  }
}

// ── SYNC: SURVEY DATA ─────────────────────────────────────────────

async function syncSurveyData() {
  if (!_fetchView) throw new Error('[Sync] Not initialised — call sync.init() first');
  const JOB = 'survey';
  console.log('[Sync] survey — starting…');

  try {
    const lastSync = await getLastSyncAt(JOB);
    console.log(`[Sync] survey — last sync: ${lastSync || 'never (full fetch)'}`);

    // ── Fetch Survey Results ──────────────────────────────────────
    // View 106803000000002079 = Zoho Survey Results
    const resultsData = await _fetchView('106803000000002079', 10000);
    if (!resultsData || !Array.isArray(resultsData.rows)) {
      throw new Error('Survey Results fetch returned no rows array');
    }

    const allResults = resultsData.rows;
    console.log(`[Sync] survey — fetched ${allResults.length} Survey Result rows`);

    // ── Schema drift check (Survey Results) ──────────────────────
    let resultSchemaSnapshot = null;
    if (allResults.length > 0) {
      const actualCols = Object.keys(allResults[0]);
      resultSchemaSnapshot = checkSchemaDrift('survey/Results', EXPECTED_SURVEY_RESULT_COLS, actualCols);
    }

    // Build live result ID set for reconciliation
    const liveResultIds = new Set(allResults.map(r => r['Result ID']).filter(Boolean));

    // Incremental: only process results sent since last sync
    const newResults = lastSync
      ? allResults.filter(r => {
          const sent = parseZohoDate(r['Survey Sent on']);
          return isNew(sent, lastSync);
        })
      : allResults;

    console.log(`[Sync] survey — ${newResults.length} new Survey Results to upsert`);

    const resultsMapped = newResults.map(r => ({
      result_id:           r['Result ID']                                        || null,
      response_id:         r['Response ID']                                      || null,
      survey_id:           r['Survey ID']                                        || null,
      survey_name:         r['Survey Name']                                      || null,
      request_id:          r['Request ID']                                       || null,
      request_display_id:  r['Request Display ID'] || r['Request Displ...']      || null,
      change_id:           r['Change ID']                                        || null,
      user_id:             r['User ID']                                          || null,
      overall_score:       parsePercent(r['Overall Score']),
      survey_sent_on:      parseZohoDate(r['Survey Sent on']),
      survey_responded_on: parseZohoDate(r['Survey Responded on'] || r['Survey Respo...']),
    })).filter(r => r.result_id);

    const resultsUpserted = await upsertSurveyResultBatch(resultsMapped);
    console.log(`[Sync] survey — upserted ${resultsUpserted} Survey Results`);

    // ── Fetch Survey Answers ──────────────────────────────────────
    // View 106803000000002076 = Zoho Survey Answers
    const answersData = await _fetchView('106803000000002076', 15000);
    if (!answersData || !Array.isArray(answersData.rows)) {
      throw new Error('Survey Answers fetch returned no rows array');
    }

    const allAnswers = answersData.rows;
    console.log(`[Sync] survey — fetched ${allAnswers.length} Survey Answer rows`);

    // ── Schema drift check (Survey Answers) ──────────────────────
    let answerSchemaSnapshot = null;
    if (allAnswers.length > 0) {
      const actualCols = Object.keys(allAnswers[0]);
      answerSchemaSnapshot = checkSchemaDrift('survey/Answers', EXPECTED_SURVEY_ANSWER_COLS, actualCols);
    }

    // Only keep answers that belong to the new result_ids we just upserted
    const newResultIds = new Set(resultsMapped.map(r => r.result_id).filter(Boolean));
    const newAnswers = lastSync
      ? allAnswers.filter(r => newResultIds.has(r['Result ID']))
      : allAnswers;

    console.log(`[Sync] survey — ${newAnswers.length} Survey Answers to upsert`);

    const answersMapped = newAnswers.map(r => ({
      response_id:   r['Response ID']  || null,
      result_id:     r['Result ID']    || null,
      question_id:   r['Question ID']  || null,
      question_text: null,             // not in this view; join from questions table if needed
      question_type: null,             // same
      answer_text:   r['Text']         || null,
      answer_option: r['Option']       || null,
      score:         r['Score'] !== '' && r['Score'] !== undefined
                       ? parseInt(r['Score'], 10) || null
                       : null,
      skipped:       (r['Skipped by Logi'] || r['Skipped by Logic'] || '').toLowerCase() === 'true' ? 1 : 0,
    })).filter(r => r.response_id && r.result_id);

    const answersUpserted = await upsertSurveyAnswerBatch(answersMapped);
    console.log(`[Sync] survey — upserted ${answersUpserted} Survey Answers`);

    // ── Reconciliation: purge results deleted in Zoho ────────────
    const surveyDeleted = await reconcileSurveyResults(liveResultIds);
    if (surveyDeleted > 0) {
      console.log(`[Sync] survey — reconciliation removed ${surveyDeleted} stale Survey Results (+answers)`);
    }

    const totalUpserted = resultsUpserted + answersUpserted;
    const schemaSnap    = JSON.stringify({
      results: resultSchemaSnapshot ? JSON.parse(resultSchemaSnapshot) : [],
      answers: answerSchemaSnapshot ? JSON.parse(answerSchemaSnapshot) : [],
    });

    await markSyncSuccess(JOB, totalUpserted, {
      deleted:        surveyDeleted,
      schemaSnapshot: schemaSnap,
      fullSync:       true,
    });
    console.log(`[Sync] survey ✅ done — ${totalUpserted} upserted, ${surveyDeleted} deleted`);
    return { job: JOB, upserted: totalUpserted, deleted: surveyDeleted };

  } catch (err) {
    // Surface the Zoho response body on the same [Sync] survey channel.
    // Previously only the generic axios message ('Request failed with status
    // code 400') was logged — the actual cause (errorCode + Zoho message)
    // sat under [fetchView] which a grep on "survey" misses.
    let zohoBody = '';
    if (err.response) {
      try {
        zohoBody = typeof err.response.data === 'string'
          ? err.response.data.slice(0, 500)
          : JSON.stringify(err.response.data).slice(0, 500);
      } catch (_) { zohoBody = '(unparseable body)'; }
    }
    const httpStatus = err.response ? err.response.status : '';
    await markSyncError(JOB, err.message + (zohoBody ? ` — body=${zohoBody}` : ''));
    console.error(`[Sync] survey ❌ error: ${err.message}${httpStatus ? ` (HTTP ${httpStatus})` : ''}`);
    if (zohoBody) console.error(`[Sync] survey ❌ Zoho response body: ${zohoBody}`);
    throw err;
  }
}

// ── SYNC: REQUEST DATA ────────────────────────────────────────────
// The Request table has ~47k rows — synced every 4 hours.
// All Zoho Analytics aggregate formulas for this table are replicated
// locally via getRequestMetrics() in reports-db.js.

async function syncRequestData({ force = false } = {}) {
  if (!_fetchView) throw new Error('[Sync] Not initialised — call sync.init() first');
  const JOB = 'requests';
  console.log(`[Sync] requests — starting… (force=${force})`);

  try {
    // force=true → treat lastSync as null so every fetched row is re-upserted,
    // refreshing overdue_status and filling historical data gaps in SQLite.
    const lastSync = force ? null : await getLastSyncAt(JOB);
    console.log(`[Sync] requests — effective lastSync: ${lastSync || (force ? 'FORCED FULL RE-SYNC' : 'never')}`);

    // Request table is the full ticket archive (56.6k rows as of 2026-08, back to
    // 2022, growing). The ceiling MUST stay comfortably above the live row count:
    // if the Analytics API ever honours maxRows, a value below the archive size
    // would truncate to the newest N and the reconciliation pass (liveIds) would
    // then DELETE the oldest tickets from the DB. 200k = ~14 years of headroom at
    // the current volume. force=true re-upserts every row fetched here, so this is
    // what makes "force sync = the entire ticket history". fetchView already scales
    // its timeout to 120s for maxRows > 10000.
    const requestResult = await _fetchView(_VIEWS.REQUEST_TABLE, 200000);
    if (!requestResult || !Array.isArray(requestResult.rows)) {
      throw new Error('Request table fetch returned no rows array');
    }

    const allRows = requestResult.rows;
    console.log(`[Sync] requests — fetched ${allRows.length} Request rows from Zoho`);

    // ── Schema drift check ────────────────────────────────────────
    let schemaSnapshot = null;
    if (allRows.length > 0) {
      const actualCols = Object.keys(allRows[0]);
      schemaSnapshot = checkSchemaDrift('requests/Request', EXPECTED_REQUEST_COLS, actualCols);
    }

    // Build live ID set (all rows) for reconciliation
    const liveIds = new Set(
      allRows.map(r => String(r['Request ID'] || r['RequestID'] || '')).filter(Boolean)
    );

    // Incremental filter: use Last Updated Time (not Created Time) so that tickets
    // whose overdue_status, request_status, or any other field changes after their
    // initial sync are re-upserted and SQLite stays current.
    // Fall back to Created Time if Last Updated Time is missing.
    //
    // EXCEPTION — always upsert Major Incidents (2026-06-22). They're a tiny set
    // (≈16 over 12 months) but business-critical, and their post-incident fields
    // (RCA / CA / PIR / Lessons) are filled AFTER closure during the PIR. Rather
    // than trust Last Updated Time to bump on every such edit, we full-upsert
    // every MI base row each sync — negligible cost, guaranteed fresh. (UDF text
    // itself comes from the separate full MAJOR_INCIDENTS backfill below.)
    // A ticket is a Major Incident when its Request Type OR its SDP Template
    // says so. The team logs MIs with Template "Major Incident Report" while
    // Request Type stays "Incident" (e.g. #311587), so Request Type alone misses
    // them. Both signals are checked here and everywhere MIs are detected.
    const _tmpl = r => r['Request Template'] || r['Template'] || '';
    const _isMajorIncident = r =>
      /major\s*incident/i.test(r['Request Type'] || '') || /major\s*incident/i.test(_tmpl(r));
    const newRows = lastSync
      ? allRows.filter(r => {
          if (_isMajorIncident(r)) return true;   // always refresh MIs
          const updated = parseZohoDate(r['Last Updated Time']) || parseZohoDate(r['Created Time']);
          return isNew(updated, lastSync);
        })
      : allRows;

    console.log(`[Sync] requests — ${newRows.length} new/updated rows to upsert`);

    // Map Zoho columns → DB columns
    const mapped = newRows.map(r => ({
      request_id:             String(r['Request ID'] || r['RequestID'] || '').trim() || null,
      display_id:             r['Request Display ID']                                || null,
      subject:                r['Subject']                                           || null,
      request_status:         r['Request Status']                                    || null,
      pending_status:         computePendingStatus(r['Request Pending Status'], r['Request Status']),
      overdue_status:         !(r['Overdue Status']||'').trim() ? null   // NULL = no SLA rule (automated tickets — matches AP filter)
                              : ['yes','true','1'].includes((r['Overdue Status']||'').toLowerCase().trim()) ? 1 : 0,
      request_type:           r['Request Type']                                 || null,
      template:               r['Request Template'] || r['Template']            || null,
      service_request:        parseInt(r['Service Request']         ?? '0', 10) || 0,
      is_escalated:           (String(r['IsEscalated'] || '')).toLowerCase() === 'true'
                              || r['IsEscalated'] === 1 || r['IsEscalated'] === '1' ? 1 : 0,
      reopen_count:           parseInt(r['Reopen Count'] || '0', 10) || 0,
      due_by_time:            parseZohoDate(r['DueBy Time']),
      time_elapsed_ms:        parseInt(r['Time Elapsed'] || '0', 10) || null,
      created_time:           parseZohoDate(r['Created Time']),
      resolved_time:          parseZohoDate(r['Resolved Time']),
      completed_time:         parseZohoDate(r['Completed Time']),
      responded_time:         parseZohoDate(r['Responded Time']),
      assigned_time:          parseZohoDate(r['Assigned Time']),
      last_updated_time:      parseZohoDate(r['Last Updated Time']),
      first_response_overdue: r['First Response Overdue Status']                    || null,
      mode:                   r['Mode']                                              || null,
      technician:             r['Technician']                                        || null,
      requester:              r['Requester']                                         || null,
      category:               r['Category']                                          || null,
      sub_category:           r['Sub Category']                                      || null,
      site:                   r['Site']                                              || null,
      tech_group:             r['Group']                                             || null,
      // Risk Register scope filter (2026-05-28): 'Enterprise' / 'Single department' /
      // 'Multiple departments' / 'Individual' — only the first three count as
      // operational risk; 'Individual' is excluded from the Risk Register sheet.
      impact:                 r['Impact']                                            || null,
    })).filter(r => r.request_id);

    const upserted = await upsertRequestBatch(mapped);
    console.log(`[Sync] requests — upserted ${upserted} Request records`);

    // ── Reconciliation (deletion detection) ──────────────────────
    assertNotTruncated(JOB, allRows.length, await countTable('request_records'));
    const deleted = await reconcileRequestRecords(liveIds);
    if (deleted > 0) {
      console.log(`[Sync] requests — reconciliation removed ${deleted} stale records`);
    }

    // ── Major-Incident UDF capture (rewritten 2026-06-22) ─────────
    // The REQUEST_TABLE view (002201) NOW returns all the Major-Incident UDF
    // columns (Root Cause Analysis, Corrective Action, Lessons Learned, PIR
    // Required/Date, Total Downtime, Preventive Measures, Workaround …), so we
    // source UDF straight from the base rows we already fetched — covering
    // EVERY major incident, including recent ones.
    //
    // Why the change: the old path fetched a separate MAJOR_INCIDENTS report
    // (view 790842) and wrote its UDFs back. That report had gone stale — it
    // returned only ~12 rows with EMPTY UDF for recent incidents (the UDF
    // fields were re-created in SDP after the report's columns were mapped),
    // so the register showed RCA/CA/PIR/LL as MISSING (red) even when filled
    // in SDP (e.g. #289097). We keep 790842 ONLY as a fallback for the case
    // where 002201 stops exposing UDF columns. extractUdf() now keeps only
    // non-empty values, so neither path can clobber good data with blanks.
    let udfUpdated = 0;
    try {
      // Capture UDFs (incl. "UDF:Services affected" for the Risk Register) for
      // EVERY changed request — NOT just Major Incidents (the previous bug:
      // regular incidents' Services-affected was never stored). newRows already
      // holds all changed rows PLUS all Major Incidents (always-refreshed
      // above), and extractUdf() returns null for rows with no UDF, so the work
      // stays bounded by the incremental set. A force sync (lastSync=null →
      // newRows=allRows) backfills udf_json across the whole table.
      const _miBase = allRows.filter(r => _isMajorIncident(r));  // for the fallback gate + log
      let udfRows = buildUdfRows(newRows);
      let source = 'REQUEST_TABLE(002201) all-incidents';

      // Fallback: fire ONLY when Major Incidents exist but NONE produced UDF
      // from the base view (i.e. 002201 stopped exposing MI UDF columns) — not
      // merely because a quiet incremental sync had no changed UDF rows.
      const _miUdfCount = buildUdfRows(_miBase).length;
      if (_miBase.length > 0 && _miUdfCount === 0) {
        const miResult = await _fetchView(_VIEWS.MAJOR_INCIDENTS, 2000);
        const miRows   = (miResult && Array.isArray(miResult.rows)) ? miResult.rows : [];
        const _LONG = ['Request ID', 'RequestID', 'Request_ID', 'Request Id'];
        const _DISP = ['Request Display ID', 'Display ID', 'Display_ID', 'RequestDisplayID'];
        udfRows = miRows.map(r => {
          let rid = null;
          for (const k of _LONG) { if (r[k] != null && String(r[k]).trim()) { rid = String(r[k]).trim(); break; } }
          if (!rid) for (const k of _DISP) { if (r[k] != null && String(r[k]).trim()) { rid = String(r[k]).trim(); break; } }
          const udf = extractUdf(r);
          return (rid && udf) ? { request_id: rid, udf_json: udf } : null;
        }).filter(Boolean);
        source = 'MAJOR_INCIDENTS(790842) fallback';
      }

      udfUpdated = await upsertRequestUdfBatch(udfRows);
      console.log(`[Sync] requests — UDF backfill from ${source}: MIs=${_miBase.length}, withUdf=${udfRows.length}, dbUpdated=${udfUpdated}`);
    } catch (udfErr) {
      // Non-fatal: log and continue. UDFs are nice-to-have on top of the
      // already-synced base request data.
      console.warn(`[Sync] requests — UDF backfill failed (continuing): ${udfErr.message}`);
    }

    await markSyncSuccess(JOB, upserted, {
      deleted,
      schemaSnapshot: schemaSnapshot || '[]',
      fullSync: true,
    });
    console.log(`[Sync] requests ✅ done — ${upserted} upserted, ${deleted} deleted, ${udfUpdated} UDFs backfilled`);
    return { job: JOB, upserted, deleted, udfUpdated };

  } catch (err) {
    await markSyncError(JOB, err.message);
    console.error(`[Sync] requests ❌ error: ${err.message}`);
    throw err;
  }
}

// ── EXPORTS ───────────────────────────────────────────────────────

module.exports = {
  init,
  syncChangeCab,
  syncSurveyData,
  syncRequestData,
  // Exposed for unit tests
  buildUdfRows,
  computePendingStatus,
  assertNotTruncated,
  CLOSED_STATUSES,
};
