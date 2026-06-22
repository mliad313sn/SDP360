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
  getLastSyncAt, markSyncSuccess, markSyncError,
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
      udf[key] = row[key] || null;
    }
  }
  return Object.keys(udf).length > 0 ? JSON.stringify(udf) : null;
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
];

// ── FULL-SYNC CADENCE ─────────────────────────────────────────────
// Run reconciliation every FULL_SYNC_EVERY incremental syncs.
// This keeps the daily cost low while still catching deletions promptly.
const FULL_SYNC_EVERY = 4;

/**
 * Decide whether this run should be a full-sync (reconciliation) run.
 * We use the sync_count from sync_metadata: if count % FULL_SYNC_EVERY === 0
 * it's time for a full sync. Count 0 (first ever run) is always a full sync.
 *
 * @param {object|null} meta — row from sync_metadata (may be null first run)
 * @returns {boolean}
 */
function shouldFullSync(meta) {
  if (!meta || meta.sync_count == null) return true;  // first run
  return meta.sync_count % FULL_SYNC_EVERY === 0;
}

// ── SYNC: CHANGE + CAB ────────────────────────────────────────────

async function syncChangeCab() {
  if (!_fetchView) throw new Error('[Sync] Not initialised — call sync.init() first');
  const JOB = 'change_cab';
  console.log('[Sync] change_cab — starting…');

  try {
    const lastSync = getLastSyncAt(JOB);
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

    const changeUpserted = upsertChangeBatch(changeMapped);
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

    const cabUpserted = upsertCABBatch(cabMapped);
    console.log(`[Sync] change_cab — upserted ${cabUpserted} CAB approval records`);

    // ── Reconciliation (deletion detection) ──────────────────────
    // Every FULL_SYNC_EVERY runs we do a full reconcile to detect Zoho deletions.
    // We pass a dummy meta object based on the last_sync_at to decide.
    let changeDeleted = 0;
    let cabDeleted    = 0;
    const isFullSync  = !lastSync; // first run is always a full sync (no cursor yet)

    if (isFullSync || !lastSync) {
      // Always reconcile on first run
      changeDeleted = reconcileChangeRecords(liveChangeIds);
      cabDeleted    = reconcileCABApprovals(liveCabIds);
      console.log(`[Sync] change_cab — reconciliation: removed ${changeDeleted} Change + ${cabDeleted} CAB stale records`);
    } else {
      // Check if sync_count divisible by FULL_SYNC_EVERY (passed via side effect)
      // We reconcile on every run since we always fetch ALL rows anyway —
      // cost is minimal (a single SELECT then small deletes if needed).
      changeDeleted = reconcileChangeRecords(liveChangeIds);
      cabDeleted    = reconcileCABApprovals(liveCabIds);
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

    markSyncSuccess(JOB, totalUpserted, {
      deleted:        totalDeleted,
      schemaSnapshot: schemaSnap,
      fullSync:       true,   // we always do a full fetch so mark as full
    });
    console.log(`[Sync] change_cab ✅ done — ${totalUpserted} upserted, ${totalDeleted} deleted`);
    return { job: JOB, upserted: totalUpserted, deleted: totalDeleted };

  } catch (err) {
    markSyncError(JOB, err.message);
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
    const lastSync = getLastSyncAt(JOB);
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

    const resultsUpserted = upsertSurveyResultBatch(resultsMapped);
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

    const answersUpserted = upsertSurveyAnswerBatch(answersMapped);
    console.log(`[Sync] survey — upserted ${answersUpserted} Survey Answers`);

    // ── Reconciliation: purge results deleted in Zoho ────────────
    const surveyDeleted = reconcileSurveyResults(liveResultIds);
    if (surveyDeleted > 0) {
      console.log(`[Sync] survey — reconciliation removed ${surveyDeleted} stale Survey Results (+answers)`);
    }

    const totalUpserted = resultsUpserted + answersUpserted;
    const schemaSnap    = JSON.stringify({
      results: resultSchemaSnapshot ? JSON.parse(resultSchemaSnapshot) : [],
      answers: answerSchemaSnapshot ? JSON.parse(answerSchemaSnapshot) : [],
    });

    markSyncSuccess(JOB, totalUpserted, {
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
    markSyncError(JOB, err.message + (zohoBody ? ` — body=${zohoBody}` : ''));
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
    const lastSync = force ? null : getLastSyncAt(JOB);
    console.log(`[Sync] requests — effective lastSync: ${lastSync || (force ? 'FORCED FULL RE-SYNC' : 'never')}`);

    // Request table is large (~47k rows); request up to 50k at a time
    const requestResult = await _fetchView(_VIEWS.REQUEST_TABLE, 50000);
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
    const newRows = lastSync
      ? allRows.filter(r => {
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
      pending_status:         (r['Request Pending Status']||'yes').toLowerCase().trim()==='no' ? 0 : 1,
      overdue_status:         !(r['Overdue Status']||'').trim() ? null   // NULL = no SLA rule (automated tickets — matches AP filter)
                              : ['yes','true','1'].includes((r['Overdue Status']||'').toLowerCase().trim()) ? 1 : 0,
      request_type:           r['Request Type']                                 || null,
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

    const upserted = upsertRequestBatch(mapped);
    console.log(`[Sync] requests — upserted ${upserted} Request records`);

    // ── Reconciliation (deletion detection) ──────────────────────
    const deleted = reconcileRequestRecords(liveIds);
    if (deleted > 0) {
      console.log(`[Sync] requests — reconciliation removed ${deleted} stale records`);
    }

    // ── MAJOR_INCIDENTS UDF backfill ──────────────────────────────
    // The base REQUEST_TABLE Zoho view (002201) does NOT return UDF columns
    // (Root Cause Analysis, Corrective Action, Lessons Learned, Preventive
    // Measures, Workaround Details, PIR Required). Those columns ARE returned
    // by the MAJOR_INCIDENTS Report view (790842), which is small (typically
    // <500 rows over 12 months). We fetch it on every request sync and write
    // the JSON-encoded UDFs back into request_records.udf_json keyed by
    // request_id. The base sync runs first, so request_records always exists
    // when we try to UPDATE here.
    let udfUpdated = 0;
    try {
      const miResult = await _fetchView(_VIEWS.MAJOR_INCIDENTS, 2000);
      if (miResult && Array.isArray(miResult.rows)) {
        const miRows = miResult.rows;
        console.log(`[Sync] requests — fetched ${miRows.length} MAJOR_INCIDENTS rows for UDF backfill`);

        // First-row diagnostic: helps spot when the Zoho view starts returning
        // a different column-name format and extractUdf() silently drops everything.
        if (miRows.length > 0) {
          const firstCols = Object.keys(miRows[0]);
          const udfCols   = firstCols.filter(c => c.startsWith('UDF:'));
          if (udfCols.length === 0) {
            console.warn(`[Sync] requests — ⚠️ MAJOR_INCIDENTS view returned NO "UDF:" columns. Cols: ${firstCols.slice(0,12).join(', ')}…`);
          } else {
            console.log(`[Sync] requests — UDF columns found: ${udfCols.join(' | ')}`);
          }
        }

        // 2026-06-02 expand the field-name fallbacks. The MAJOR_INCIDENTS
        // (view 790842) is a Zoho Analytics REPORT, not the raw REQUEST_TABLE.
        // The "Request ID" column may be exposed under several names depending
        // on how the report's columns were configured at the Zoho side:
        //   • 'Request ID' / 'RequestID'              — long internal id
        //     (e.g. 212627000021435102), matches request_records.request_id
        //   • 'Request Display ID' / 'Display ID'     — short display id
        //     (e.g. 307800), matches request_records.display_id
        // The previous code only tried the first pair; if Zoho ever drops the
        // long-id column from the report (configurable per analyst), the
        // whole UDF backfill silently produces 0 rows. Now we cascade both.
        let extractedCount = 0;
        let firstRowDumped = false;
        const _LONG_ID_KEYS    = ['Request ID', 'RequestID', 'Request_ID', 'Request Id'];
        const _DISPLAY_ID_KEYS = ['Request Display ID', 'Display ID', 'Display_ID', 'RequestDisplayID'];
        const udfRows = miRows.map((r, ix) => {
          let rid = null, ridKind = null;
          for (const k of _LONG_ID_KEYS)    { if (r[k] != null && String(r[k]).trim()) { rid = String(r[k]).trim(); ridKind = 'long';    break; } }
          if (!rid) {
            for (const k of _DISPLAY_ID_KEYS) { if (r[k] != null && String(r[k]).trim()) { rid = String(r[k]).trim(); ridKind = 'display'; break; } }
          }
          if (!rid) {
            // First-row diagnostic ONLY (once per sync). Tells us what columns
            // the view actually exposes so we can extend _LONG_ID_KEYS /
            // _DISPLAY_ID_KEYS in a follow-up if a new variant appears.
            if (!firstRowDumped) {
              firstRowDumped = true;
              const keys = Object.keys(r);
              const candidates = keys.filter(k => /request|display|id$/i.test(k));
              console.warn(`[Sync] requests — ⚠️ MAJOR_INCIDENTS row #${ix} has no Request/Display ID column. Total keys: ${keys.length}. ID-shaped candidates: ${candidates.join(' | ') || '(none)'}`);
              if (candidates.length === 0) {
                console.warn(`[Sync] requests — First 12 keys: ${keys.slice(0, 12).join(' | ')}`);
              }
            }
            return null;
          }
          const udf = extractUdf(r);
          if (!udf) return null;     // no UDF columns present → skip
          extractedCount++;
          return { request_id: rid, udf_json: udf, _ridKind: ridKind };
        }).filter(Boolean);

        // Pass-through to the DB helper. It now also matches on display_id
        // as a fallback when request_id doesn't match — see comment in
        // reports-db.js `upsertRequestUdfBatch`.
        udfUpdated = upsertRequestUdfBatch(udfRows);
        const unmatched = udfRows.length - udfUpdated;
        console.log(`[Sync] requests — UDF backfill: extracted=${extractedCount}, dbUpdated=${udfUpdated}, unmatched=${unmatched}`);
        if (extractedCount > 0) {
          const _kinds = {};
          udfRows.forEach(r => { _kinds[r._ridKind] = (_kinds[r._ridKind] || 0) + 1; });
          console.log(`[Sync] requests — UDF id-kind breakdown: ${Object.entries(_kinds).map(([k, v]) => k + '=' + v).join(', ')}`);
        }
        if (unmatched > 0 && udfRows[0]) {
          console.warn(`[Sync] requests — ⚠️ ${unmatched} UDF rows had no matching request_id NOR display_id in DB (e.g. "${udfRows[0].request_id}" / kind=${udfRows[0]._ridKind}). Possible format mismatch.`);
        }
      }
    } catch (udfErr) {
      // Non-fatal: log and continue. UDFs are nice-to-have on top of the
      // already-synced base request data.
      console.warn(`[Sync] requests — UDF backfill failed (continuing): ${udfErr.message}`);
    }

    markSyncSuccess(JOB, upserted, {
      deleted,
      schemaSnapshot: schemaSnapshot || '[]',
      fullSync: true,
    });
    console.log(`[Sync] requests ✅ done — ${upserted} upserted, ${deleted} deleted, ${udfUpdated} UDFs backfilled`);
    return { job: JOB, upserted, deleted, udfUpdated };

  } catch (err) {
    markSyncError(JOB, err.message);
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
};
