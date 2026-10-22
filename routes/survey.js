'use strict';
// ---------------------------------------------------------------------------
// Survey routes (/api/survey/*) - extracted from server.js (SDP-DASH-2.0 step 5, lot 5.4, 2026-10-22).
// Analytics Plus survey views (list, summary, KPIs, by-dimension, voice of customer + their
// cache-clear routes) and the DB-backed /api/survey + /api/survey/:response_id/answers.
// Handlers unchanged (`app.` became `router.`); the two DB-backed routes keep their place AFTER
// the static /api/survey/* paths, so :response_id still cannot shadow them.
// ---------------------------------------------------------------------------
// reports-db is required here: server.js declares its `let rdb` further down than this mount.
const rdb = require('../reports-db');
const { buildDataFreshness } = require('../services/dataFreshness');

module.exports = function surveyRoutes(deps) {
  const {
    express, axios, IS_DEV, safeError, CONFIG, VIEWS, getValidToken, fetchView, requireReportSession, requireAdmin,
  } = deps;
  const router = express.Router();

  // ══════════════════════════════════════════════════════════════════
  // SURVEY — reads from Analytics Plus view 106803000000002079
  // Overall Score field = percentage string e.g. "100%", "80%", "0%"
  // Survey responses come directly from Analytics Plus view 106803000000002079
  // ══════════════════════════════════════════════════════════════════

  // Survey views — Zoho Survey tables synced into Analytics Plus
  // 106803000000002079 = Zoho Survey Results  (has: Survey Sent on, Survey Responded on, Survey ID, Request ID, Overall Score)
  // 106803000000002077 = Zoho Survey Questions (has: Question text, Survey ID, type — for rating/quality breakdown)
  // 106803000000002076 = Zoho Survey Answers   (has: Answer text, Question ID, Response ID — for verbatim)
  const SURVEY_VIEW_ID           = process.env.ZOHO_SURVEY_VIEW_ID           || '106803000000002079';
  const SURVEY_QUESTIONS_VIEW_ID = process.env.ZOHO_SURVEY_QUESTIONS_VIEW_ID || '106803000000002077';
  const SURVEY_ANSWERS_VIEW_ID   = process.env.ZOHO_SURVEY_ANSWERS_VIEW_ID   || '106803000000002076'; // typed comments — corrected from 2075
  const _surveyCache   = { data: null, ts: 0, TTL: 600000 }; // 10 min TTL

  // ── Voice of Customer: theme + sentiment classification helpers ──────────────
  const VOC_THEMES = [
    ['Resolution Time',        ['trop de temps','prend du temps','long time','slow','lent','delai','délai','reactiv','response time','tardive','tarde','attente','waiting','took','urgent','critical','delay','prend trop','pris trop','takes a lot']],
    ['Issue Not Resolved',     ["n'a pas été résolu","not resolved","not yet","not done","not fix","pas résolu","pas encore","not solve","not complete","still waiting","closed","fermé","no resolution","no action","pas été résolu","still open","not close"]],
    ['Access / Login',         ['access','accès','accede','accèder','password','passeword','compte','login','portail portal','authentif','connect','bi ','pronto','ds tools','eam','sharepoint','google account','profile','profil']],
    ['Hardware / Equipment',   ['ordinateur','computer','matériel','equipment','mouse','imprimante','printer','usb','device','appareil','hardware','écran','screen','laptop','clavier','keyboard']],
    ['Network / Connectivity', ['internet','connexion','network','réseau','wifi','vpn','lenteur','navigation réseau','hgo','camp','bandwidth','déconnect']],
    ['Portal / UX',            ['portail','portal','interface','design','simple','easy','convivial','langue','language','français','notification','form','formulaire','page','navigation','ux']],
    ['Training / Awareness',   ['formation','training','sensibilisation','guide','awareness','compréhension','explain','explication']],
    ['Application / Software', ['windows','application','logiciel','software','sage','mypath','pronto','oracle','sap','scada','outlook','teams','ds tool']],
    ['Positive Feedback',      ['satisf','merci','thank','good','parfait','perfect','bien fait','excellent','great','bravo','rapide','promptitude','résolv','resolved','impeccable','impressed','apprécie','appreciate','félicit']],
  ];

  function classifyVocThemes(text) {
    const tl = text.toLowerCase();
    const matched = VOC_THEMES.filter(([, kws]) => kws.some(k => tl.includes(k))).map(([name]) => name);
    return matched.length > 0 ? matched : ['Other'];
  }

  function classifyVocSentiment(text) {
    const tl = text.toLowerCase();
    const neg = ["n'a pas été résolu","not resolved","not done","not fix","pas satisf","not satisf","problème non",
      "not yet","still waiting","trop de temps","long time","pas encore","issue still","not solved","no resolution",
      "no action","problem not","takes a lot of time","takes too long","catastroph","déçu","déçue","unresolved",
      "pas résolu","not action","not done","jamais","never","pas totalement résolu","not complete","poor service",
      "not yet done","not fixed"];
    const pos = ["satisf","merci","thank","good","parfait","perfect","bien fait","excellent","great","bravo",
      "rapide","promptitude","résolv","resolved","done","impeccable","impressed","apprécie","appreciate",
      "très bien","very good","happy","félicit","super","wonderful"];
    const negCount = neg.filter(k => tl.includes(k)).length;
    const posCount = pos.filter(k => tl.includes(k)).length;
    return negCount > posCount ? 'negative' : posCount > 0 ? 'positive' : 'neutral';
  }

  /**
   * Fetch all rows from a view — uses same CSV approach as fetchView (reliable, correct headers).
   * The JSON + limit/offset approach returns 404 because the Analytics Plus API requires
   * the ZANALYTICS-ORGID header and only supports responseFormat=csv with maxRows.
   * For the survey view (2,758 rows) maxRows=5000 covers everything in one shot.
   */
  async function fetchAllViewRows(viewId) {
    const result = await fetchView(viewId, 5000);
    return result.rows || [];
  }

  const { filterRecentMonths } = require('../services/recentMonths');   // shared by the raw request cache + routes/survey.js

  /**
   * Parse "Overall Score" value to a 0–100 number
   * Handles: "100%", "80%", "0%", "4", "5", "4.5", null
   */
  function parseScore(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const s = String(raw).trim();
    // Percentage string e.g. "80%"
    if (s.endsWith('%')) return parseFloat(s) || null;
    // Numeric (treat as percentage if >10, else as 0-5 scale)
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    if (n > 10) return n;           // already a percentage like 80
    if (n <= 5)  return n / 5 * 100; // 0–5 scale → convert to %
    return n / 10 * 100;            // 0–10 scale → convert to %
  }

  /**
   * Parse Analytics Plus date string: "18 Jun, 2025 11:35:06"
   */
  function parseAPDate(str) {
    if (!str) return null;
    try {
      // "18 Jun, 2025 11:35:06" → strip comma
      const clean = str.replace(',', '');
      const d = new Date(clean);
      if (!isNaN(d)) return d;
    } catch(e) {}
    return null;
  }

  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /**
   * GET /api/survey/list — now returns the Analytics Plus survey view info
   */
  router.get('/api/survey/list', requireReportSession, async (req, res) => {
    try {
      // Just confirm the view is accessible and return its ID
      const token = await getValidToken();
      const url = `${CONFIG.analyticsApi}/workspaces/${CONFIG.workspaceId}/views/${SURVEY_VIEW_ID}/data`;
      const r = await axios.get(url, {
        headers: { 'Authorization': `Zoho-oauthtoken ${token}` },
        params:  { limit: 1, offset: 0, responseFormat: 'json' },
        timeout: 15000,
      });
      const total = r.data.totalRows || r.data.total_rows || '?';
      res.json({
        success: true,
        source:  'Analytics Plus',
        message: 'Survey data lives in Analytics Plus view 106803000000002079',
        surveys: [{
          id:        SURVEY_VIEW_ID,
          name:      'IT Helpdesk CSAT (Analytics Plus view)',
          responses: total,
          viewId:    SURVEY_VIEW_ID,
        }],
        hint: `Set ZOHO_SURVEY_VIEW_ID=${SURVEY_VIEW_ID} in .env (already defaulted). Call /api/survey/summary to get CSAT data.`,
      });
    } catch(err) {
      res.status(500).json({ error: err.message, details: err.response?.data });
    }
  });

  /**
   * GET /api/survey/summary — reads view 106803000000002079 directly
   * Returns same shape as before so dashboard works without changes
   */
  router.get('/api/survey/summary', requireReportSession, async (req, res) => {
    // Serve cache if fresh
    if (_surveyCache.data && Date.now() - _surveyCache.ts < _surveyCache.TTL) {
      return res.json(_surveyCache.data);
    }

    // DB-first (Phase 2 of executive.html rewrite, 2026-05-26).
    // Read from survey_results (synced hourly from Zoho). Avoids the HTTP
    // 400 the live Zoho view path was returning, which left the
    // executive.html Customer Voice card showing "Request failed with
    // status code 400". Live Zoho is retained as a fallback ONLY if the
    // DB returns 0 responses.
    try {
      const rdb2 = require('../reports-db');
      if (typeof rdb2.getCustomerVoiceDB === 'function') {
        const dbVoice = await rdb2.getCustomerVoiceDB(12) || {};
        if (dbVoice.totalResponses > 0) {
          // Wrap into the legacy /api/survey/summary shape so the
          // executive.html chart code reads it transparently.
          const result = {
            surveyId:     SURVEY_VIEW_ID,
            surveyName:   'IT Helpdesk CSAT',
            source:       'SQLite (survey_results)',
            totalResponses:  dbVoice.totalResponses,
            // New (2026-05-27): server now computes responseRate from
            // survey_results itself (sent vs responded counts), so the
            // client no longer has to derive a denominator from closed
            // tickets. Falls back to null if the DB doesn't yet expose
            // these fields (e.g., during a partial deploy).
            totalSent:       dbVoice.totalSent      != null ? dbVoice.totalSent      : null,
            totalResponded:  dbVoice.totalResponded != null ? dbVoice.totalResponded : null,
            responseRate:    dbVoice.responseRate   != null ? dbVoice.responseRate   : null,
            ratingScale:     100,
            avgRating:       dbVoice.avgRating,
            csatPct:         dbVoice.csatPct,
            nps:             dbVoice.nps,
            promoters:       dbVoice.promoters,
            passives:        dbVoice.passives,
            detractors:      dbVoice.detractors,
            byMonth:         dbVoice.byMonth || [],
            verbatim:        [],
            sentimentSummary: { positive: 0, neutral: 0, negative: 0 },
            questionMap:     { ratingQ: 'Overall Score' },
            _meta: { source: 'db', viewId: SURVEY_VIEW_ID, totalResponses: dbVoice.totalResponses, totalSent: dbVoice.totalSent || null },
          };
          _surveyCache.data = result; _surveyCache.ts = Date.now();
          console.log(`[survey] ✅ DB: CSAT ${result.csatPct}%, NPS ${result.nps}, ${result.totalResponses} responses`);
          return res.json(result);
        }
      }
    } catch(e) { console.warn('[survey] DB lookup failed:', e.message); }

    // ── DB returned empty / errored — DO NOT call Zoho here.
    // The live-Zoho fallback was causing 502s through IIS because Zoho is
    // rate-limited ("too many requests"). Each fallback call hung until
    // the IIS ARR proxy timeout fired. Return a safe empty result so the
    // page renders cleanly with "—" placeholders instead of 502s.
    // The hourly survey cron will populate survey_results going forward;
    // for now this is the right resilience trade-off.
    // (The dead Zoho-fallback code from before 2026-05-26 was deleted
    // in this same edit — git history preserves it if ever needed.)
    const empty = emptyResult(
      'survey_results table is empty — Zoho sync may not have populated yet, ' +
      'OR survey_responses haven\'t been entered for this period. ' +
      'pm2 logs … | findstr "[Sync] survey" should show the next sync attempt.'
    );
    _surveyCache.data = empty; _surveyCache.ts = Date.now();
    console.log('[survey] ⚠ DB returned 0 — serving safe empty (Zoho fallback skipped to avoid 502).');
    return res.json(empty);
  });

  function emptyResult(note) {
    return {
      surveyId: SURVEY_VIEW_ID, surveyName: 'IT Helpdesk CSAT', source: 'Analytics Plus',
      totalResponses: 0, responseRate: null, ratingScale: 100,
      avgRating: null, csatPct: null, nps: null,
      promoters: 0, passives: 0, detractors: 0,
      byMonth: [], verbatim: [], sentimentSummary: { positive: 0, neutral: 0, negative: 0 },
      questionMap: {}, note,
    };
  }

  /**
   * GET /api/survey/kpis?yr=2026&mo=2&groups=ITY IT Agents,Mana IT Agent,...
   * Group + period-filtered CSAT — joins survey_results with request_records on request_id.
   */
  router.get('/api/survey/kpis', requireReportSession, async (req, res) => {
    try {
      const { yr, mo, groups } = req.query;
      const groupList = groups ? groups.split(',').map(g => g.trim()).filter(Boolean) : [];
      const rdb = require('../reports-db');

      // Forked reader (sqlite/pg dispatch) — q1 period+group-filtered scores, q2 12-mo trend rows.
      const { rows1: kpiRows, rows2: trendRows } = await rdb.getSurveyKpisDB({ yr, mo, groups: groupList });

      let scoreSum = 0, n = 0, satisfied = 0, promoters = 0, passives = 0, detractors = 0;
      kpiRows.forEach(r => {
        const s = r.overall_score;
        scoreSum += s; n++;
        if (s >= 80) satisfied++;
        if (s >= 90) promoters++;
        else if (s >= 70) passives++;
        else detractors++;
      });

      const byMonthMap = {};
      trendRows.forEach(r => {
        const s = r.overall_score;
        const mon = r.responded_on ? r.responded_on.substring(0, 7) : null; // YYYY-MM
        if (mon) {
          if (!byMonthMap[mon]) byMonthMap[mon] = { sum: 0, n: 0, satisfied: 0 };
          byMonthMap[mon].sum += s; byMonthMap[mon].n++; if (s >= 80) byMonthMap[mon].satisfied++;
        }
      });

      const byMonth = Object.entries(byMonthMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ({
          month: k,
          responses: v.n,
          avgRating: v.n > 0 ? Math.round(v.sum / v.n * 10) / 10 : null,
          csatPct:   v.n > 0 ? Math.round(v.satisfied / v.n * 100) : null,
        }));

      const npsBase = promoters + passives + detractors;
      // Include survey sync timestamp so the dashboard can warn when data is stale
      const { getSyncStatus } = require('../reports-db');
      const surveySync = (await getSyncStatus()).find(j => j.job_name === 'survey') || {};
      res.json({
        totalResponses: n,
        avgRating:  n > 0 ? Math.round(scoreSum / n * 10) / 10 : null,
        csatPct:    n > 0 ? Math.round(satisfied / n * 100) : null,
        nps:        npsBase > 0 ? Math.round((promoters - detractors) / npsBase * 100) : null,
        promoters, passives, detractors,
        byMonth,
        groupFiltered: groupList.length > 0,
        as_of: surveySync.last_sync_at || null,   // ISO timestamp of last survey sync
      });
    } catch(err) {
      console.error('[survey/kpis]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/survey/cache/clear
   */
  router.post('/api/survey/cache/clear', requireReportSession, requireAdmin, (req, res) => {
    _surveyCache.data = null; _surveyCache.ts = 0;
    res.json({ ok: true, message: 'Survey cache cleared' });
  });

  /**
   * GET /api/survey/debug — shows raw sample rows for troubleshooting
   * SECURITY: Only available in development mode. Returns 404 in production.
   */
  router.get('/api/survey/debug', requireReportSession, async (req, res) => {
    if (!IS_DEV) {
      return res.status(404).json({ error: 'Not found.' });
    }
    try {
      const rows = await fetchAllViewRows(SURVEY_VIEW_ID);
      const sample = rows.slice(0, 5);
      const scores = sample.map(r => ({ raw: r['Overall Score'], parsed: parseScore(r['Overall Score']) }));
      res.json({
        viewId:    SURVEY_VIEW_ID,
        totalRows: rows.length,
        columns:   rows.length > 0 ? Object.keys(rows[0]) : [],
        scoreSamples: scores,
        dateSamples:  sample.map(r => r['Survey Responded on'] || r['Survey Sent on']),
        sampleRows:   sample,
      });
    } catch(err) {
      safeError(err, res);
    }
  });

  /**
   * GET /api/survey/by-dimension
   *
   * Joins survey responses (view 106803000000002079) with REQUEST_TABLE (106803000000002201)
   * via Request ID to produce CSAT broken down by:
   *   - Technician  (for Tech Scorecard CSAT column)
   *   - Site        (for IT Management Panel "CSAT by Site")
   *   - Group       (for group-level reporting)
   *
   * Returns:
   * {
   *   byTech:  [ { name, csatPct, avgScore, responses } ],
   *   bySite:  [ { site, csatPct, avgScore, responses } ],
   *   byGroup: [ { group, csatPct, avgScore, responses } ],
   *   totalJoined: number,   // how many survey rows matched a request row
   *   totalSurvey: number,   // total survey rows fetched
   * }
   */
  const _dimCache = { data: null, ts: 0, TTL: 600000 }; // 10 min cache

  router.get('/api/survey/by-dimension', requireReportSession, async (req, res) => {
    if (_dimCache.data && Date.now() - _dimCache.ts < _dimCache.TTL) {
      return res.json(_dimCache.data);
    }

    // DB-first (Phase 3 of executive.html rewrite, 2026-05-26).
    // Was 500'ing because both Zoho calls (survey view + 30k REQUEST_TABLE
    // rows) were getting rate-limited. JOIN survey_results to
    // request_records inside SQLite — single round-trip, no Zoho calls.
    try {
      const rdb2 = require('../reports-db');
      if (typeof rdb2.getCustomerVoiceByDimensionDB === 'function') {
        const dbDim = await rdb2.getCustomerVoiceByDimensionDB();
        if (dbDim && dbDim.totalSurvey > 0) {
          _dimCache.data = dbDim;
          _dimCache.ts   = Date.now();
          console.log(`[survey/by-dim] ✅ DB: ${dbDim.totalSurvey} surveys joined to ${dbDim.totalJoined} request rows (${dbDim.joinRate}%) · techs:${dbDim.byTech.length} sites:${dbDim.bySite.length} groups:${dbDim.byGroup.length}`);
          return res.json(dbDim);
        }
      }
    } catch(e) { console.warn('[survey/by-dim] DB lookup failed:', e.message); }

    // ── DB returned empty / errored — DO NOT call Zoho here.
    // Identical reasoning to /api/survey/summary above: the live-Zoho
    // path fetches two views (survey + REQUEST_TABLE 30k rows) and both
    // are rate-limited. Falling through hangs IIS until it returns 502.
    // Return a safe empty structure so executive.html renders cleanly.
    console.log('[survey/by-dim] ⚠ DB returned 0 — serving safe empty (Zoho fallback skipped to avoid 502).');
    const safeEmpty = {
      byTech:      [],
      bySite:      [],
      byGroup:     [],
      totalSurvey: 0,
      totalJoined: 0,
      joinRate:    0,
      closedCount: 0,
      _meta: { source: 'db-empty', note: 'survey_results table is empty or no joins matched request_records.' },
    };
    _dimCache.data = safeEmpty; _dimCache.ts = Date.now();
    return res.json(safeEmpty);

    // ── Unreachable below — kept commented for emergency restore.
    // To re-enable Zoho fallback: delete the early-return above and
    // uncomment the try/catch block below. NOT recommended while Zoho
    // is rate-limiting (will cause 502 spikes through IIS).
    /* eslint-disable no-unreachable, no-unused-labels */
    // eslint-disable-next-line no-constant-condition
    if (false) try {
      // Fetch both tables in parallel
      // Survey: fetchAllViewRows (5k cap — fine for survey rows)
      // Requests: last 13 months only (surveys are always recent, no need for full history)
      // Fetch ALL request rows (not filtered to 13 months) — surveys can reference any historical ticket.
      // 30 000 row cap is safe: SDP tables are ~15-25k rows for Endeavour Mining's volume.
      console.log('[survey/by-dim] Fetching survey rows + full request table (no time filter)...');
      const [surveyResult, requestRaw] = await Promise.all([
        fetchAllViewRows(SURVEY_VIEW_ID),
        fetchView(VIEWS.REQUEST_TABLE, 30000),
      ]);
      const requestResult = requestRaw.rows || []; // keep ALL rows — no month filter for join

      // Count closed/resolved tickets — used for survey response rate calculation
      // Survey is sent "When a request is closed" per SDP Survey Settings config
      const closedStatuses = ['closed','resolved','completed'];
      const closedCount = requestResult.filter(r =>
        closedStatuses.includes((r['Status'] || r['status'] || '').toLowerCase().trim())
      ).length;
      console.log(`[survey/by-dim] Survey rows: ${surveyResult.length}, Request rows: ${requestResult.length}, Closed tickets: ${closedCount}`);

      // Build request lookup map: Request ID → { Technician, Site, Group }
      // Index by ALL available ID variants so survey row can match on any of them.
      // Analytics Plus entity IDs (18-digit) and SDP display IDs (shorter) may both appear.
      const reqMap = {};
      requestResult.forEach(r => {
        const data = {
          tech:  (r['Technician'] || r['Assigned To'] || '').trim() || null,
          site:  (r['Site'] || '').trim() || null,
          group: (r['Group'] || '').trim() || null,
        };
        // Index by every ID field variant found on this row
        ['Request ID', 'RequestID', 'Request Display ID', 'ID'].forEach(field => {
          const v = (r[field] || '').toString().trim();
          if (v && v !== '-No Value-') reqMap[v] = data;
        });
      });
      console.log(`[survey/by-dim] Built reqMap with ${Object.keys(reqMap).length} unique IDs from ${requestResult.length} request rows`);

      // Aggregate CSAT + NPS + monthly breakdown by dimension
      const techMap  = {};
      const siteMap  = {};
      const groupMap = {};
      let joined = 0;

      // Month parser for survey dates: "17 Aug, 2025 11:35:06" → "Aug 2025"
      const MN3_SRV = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const parseSurveyMonth = (s) => {
        if (!s) return null;
        const p = s.trim().replace(/,/g, '').split(/\s+/);
        // "17 Aug 2025 ..." → p[0]=day, p[1]=mon, p[2]=year
        if (p.length >= 3 && isNaN(parseInt(p[1])) && MN3_SRV.includes(p[1])) return p[1] + ' ' + p[2];
        // "Aug 2025" → p[0]=mon, p[1]=year
        if (p.length >= 2 && isNaN(parseInt(p[0])) && MN3_SRV.includes(p[0])) return p[0] + ' ' + p[1];
        return null;
      };

      // Accumulate into a bucket {sum,n,satisfied,promoters,passives,detractors,byMonth}
      const _acc = (map, key, score, monthKey) => {
        if (!map[key]) map[key] = { sum:0, n:0, satisfied:0, promoters:0, passives:0, detractors:0, byMonth:{} };
        const b = map[key];
        b.sum += score; b.n++;
        if (score >= 80) b.satisfied++;
        // NPS classification (mirrors /api/survey/summary logic)
        if      (score >= 90) b.promoters++;
        else if (score >= 70) b.passives++;
        else                  b.detractors++;
        // Monthly CSAT breakdown
        if (monthKey) {
          if (!b.byMonth[monthKey]) b.byMonth[monthKey] = { n:0, satisfied:0 };
          b.byMonth[monthKey].n++;
          if (score >= 80) b.byMonth[monthKey].satisfied++;
        }
      };

      let noMatchCount = 0;
      surveyResult.forEach(row => {
        const rid   = (row['Request ID'] || row['RequestID'] || row['request_id'] || '').toString().trim();
        const score = parseScore(row['Overall Score']);
        if (score === null || !rid) return;

        const req = reqMap[rid];
        if (!req) { noMatchCount++; return; }
        joined++;

        // Month from survey response date (when the customer filled out the survey)
        const monthKey = parseSurveyMonth(row['Survey Responded on'] || row['Survey Sent on'] || '');

        if (req.tech)  _acc(techMap,  req.tech,  score, monthKey);
        if (req.site)  _acc(siteMap,  req.site,  score, monthKey);
        if (req.group) _acc(groupMap, req.group, score, monthKey);
      });

      // Convert bucket map → sorted array with full metric set
      const toArr = (map, keyField) =>
        Object.entries(map)
          .filter(([k]) => k && k !== '-No Value-' && k !== 'Unassigned')
          .map(([k, v]) => {
            const npsBase = v.promoters + v.passives + v.detractors;
            // Monthly CSAT as sorted array [{month, responses, csatPct}]
            const MO_ORD = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
            const byMonth = Object.entries(v.byMonth)
              .map(([mo, d]) => ({ month: mo, responses: d.n, csatPct: Math.round(d.satisfied/d.n*100) }))
              .sort((a, b) => {
                const [am, ay] = a.month.split(' '), [bm, by] = b.month.split(' ');
                return parseInt(ay) !== parseInt(by) ? parseInt(ay)-parseInt(by) : MO_ORD[am]-MO_ORD[bm];
              });
            return {
              [keyField]: k,
              csatPct:    Math.round(v.satisfied / v.n * 100),
              avgScore:   Math.round(v.sum / v.n),
              responses:  v.n,
              promoters:  v.promoters,
              passives:   v.passives,
              detractors: v.detractors,
              nps:        npsBase > 0 ? Math.round((v.promoters - v.detractors) / npsBase * 100) : null,
              byMonth,    // monthly CSAT trend for this dimension
            };
          })
          .sort((a, b) => b.responses - a.responses);

      const result = {
        byTech:       toArr(techMap,  'name'),
        bySite:       toArr(siteMap,  'site'),
        byGroup:      toArr(groupMap, 'group'),
        totalSurvey:  surveyResult.length,
        totalJoined:  joined,
        joinRate:     surveyResult.length > 0 ? Math.round(joined / surveyResult.length * 100) : 0,
        closedCount,  // closed tickets — denominator for per-group response rate
        _meta: {
          requestRowsFetched: requestResult.length,
          surveyRowsFetched:  surveyResult.length,
          joinedRows:         joined,
          techCount:          Object.keys(techMap).length,
          siteCount:          Object.keys(siteMap).length,
          groupCount:         Object.keys(groupMap).length,
        },
      };

      _dimCache.data = result;
      _dimCache.ts   = Date.now();

      console.log(`[survey/by-dim] ✅ Joined ${joined}/${surveyResult.length} (${result.joinRate}%), no-match: ${noMatchCount}, techs: ${result._meta.techCount}, sites: ${result._meta.siteCount}`);
      res.json(result);

    } catch(err) {
      console.error('[survey/by-dim]', err.message);
      res.status(500).json({ error: err.message, byTech: [], bySite: [], byGroup: [] });
    }
  });

  // POST /api/survey/dimension-cache/clear
  router.post('/api/survey/dimension-cache/clear', requireReportSession, requireAdmin, (req, res) => {
    _dimCache.data = null; _dimCache.ts = 0;
    res.json({ ok: true });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GET /api/survey/voice
  // Fetches Survey Answers (view 2075) + Survey Results (view 2079)
  // Classifies typed text comments by theme and sentiment
  // Returns: totalComments, sentimentBreakdown, themes[], quotes[]
  // Cache TTL: 30 min (text analysis is heavier)
  // ══════════════════════════════════════════════════════════════════════════════
  // Cache stores both the full aggregated result AND the raw parsed comment list
  // so month-filtered views can be computed without re-fetching from Zoho.
  const _voiceCache = { data: null, comments: null, ts: 0, TTL: 1800000 };

  // Parse "30 Mar, 2026" or "17 Aug, 2025" → "2026-03"
  function parseDateToYM(dateStr) {
    if (!dateStr) return '';
    const MON = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    const m = dateStr.match(/(\w{3})[,\s]+(\d{4})/);
    return m ? `${m[2]}-${MON[m[1]] || '00'}` : '';
  }

  // Build aggregated result object from a comment list
  function aggregateVoice(comments, meta) {
    const sentBreakdown = { positive: 0, neutral: 0, negative: 0 };
    const themeMap = {};
    comments.forEach(c => {
      sentBreakdown[c.sentiment] = (sentBreakdown[c.sentiment] || 0) + 1;
      c.themes.forEach(t => {
        if (!themeMap[t]) themeMap[t] = { count: 0, scores: [] };
        themeMap[t].count++;
        if (c.score !== null && c.score !== undefined) themeMap[t].scores.push(c.score);
      });
    });
    const total = comments.length || 1;
    const themes = Object.entries(themeMap)
      .map(([name, d]) => ({
        name,
        count:    d.count,
        pct:      Math.round(d.count / total * 100),
        avgScore: d.scores.length > 0 ? Math.round(d.scores.reduce((a,b) => a+b, 0) / d.scores.length) : null,
      }))
      .sort((a, b) => b.count - a.count);

    const negQuotes = comments
      .filter(c => c.sentiment === 'negative' && c.text.split(/\s+/).length >= 6)
      .sort((a, b) => (a.score || 100) - (b.score || 100))
      .slice(0, 8);
    const posQuotes = comments
      .filter(c => c.sentiment === 'positive' && c.text.split(/\s+/).length >= 5)
      .slice(0, 5);
    const neutralQuotes = comments
      .filter(c => c.sentiment === 'neutral' && c.text.split(/\s+/).length >= 8)
      .slice(0, 4);

    return {
      totalComments:      comments.length,
      sentimentBreakdown: sentBreakdown,
      themes,
      quotes:             [...negQuotes, ...posQuotes, ...neutralQuotes],
      allComments:        comments,   // full list — used for month-filtered views
      _meta:              meta || {},
    };
  }

  router.get('/api/survey/voice', requireReportSession, async (req, res) => {
    // ?month=YYYY-MM  — return data filtered to a specific month (no cache for filtered views)
    const monthFilter = (req.query.month || '').trim();  // e.g. "2026-03"

    // Ensure raw comment list is cached. DB-only since this fix —
    // previously this endpoint fetched two Zoho views (SURVEY_ANSWERS_VIEW_ID
    // and SURVEY_VIEW_ID), which kept failing with 'Request failed with
    // status code 400' on prod (rate-limited Zoho calls). Other survey
    // endpoints went DB-only in commit e5e85d5; this one was missed. Now
    // reads the same data from survey_results + survey_answers tables that
    // the daily survey sync writes into reports.db.
    if (!_voiceCache.comments || Date.now() - _voiceCache.ts >= _voiceCache.TTL) {
      try {
        console.log('[survey/voice] Building from local DB (survey_results + survey_answers)...');

        // ISO → 'Day Mon, Year' (e.g. '2026-03-19T...' → '19 Mar, 2026') so
        // the client-side renderers that already display c.date keep working.
        const _MN_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const isoToZohoDateShort = (iso) => {
          if (!iso) return '';
          const d = new Date(iso);
          if (isNaN(d.getTime())) return '';
          return `${d.getDate()} ${_MN_SHORT[d.getMonth()]}, ${d.getFullYear()}`;
        };

        // Query 1: per-response context (score / ticket linkage / date).
        // Keyed by response_id so the answer loop can stitch the context
        // onto each typed comment without a per-row sub-query.
        const resultRows = await rdb.getSurveyResultsForVoice();
        const resultMap = {};
        resultRows.forEach(r => {
          if (!r.response_id) return;
          const iso = r.survey_responded_on || r.survey_sent_on || '';
          resultMap[r.response_id] = {
            score:     r.overall_score != null ? Math.round(r.overall_score) : null,
            requestId: r.request_id || '',
            displayId: r.request_display_id || '',
            date:      isoToZohoDateShort(iso),
            ym:        iso ? iso.slice(0, 7) : '',
          };
        });

        // Query 2: only rows worth examining — skipped=0 AND has free-text
        // OR a long answer_option. SQL pre-filter avoids iterating star_rating
        // selections in JS.
        const answerRows = await rdb.getSurveyVoiceAnswers();
        console.log(`[survey/voice] DB query: ${resultRows.length} responses, ${answerRows.length} candidate answer rows`);

        // Map DB rows to the legacy `r` shape so the existing extraction loop
        // (below) doesn't need to change. The 'Response ID' / 'Text' / 'Option'
        // keys match what the old Zoho fetch produced.
        const answersRaw = answerRows.map(r => ({
          'Response ID': r.response_id,
          'Text':        r.answer_text   || '',
          'Option':      r.answer_option || '',
        }));

        // Extract typed text answers.
        // _seenComment guards against duplicate answer rows: survey_answers
        // historically accumulated dupes (INSERT with no UNIQUE key \u2014 fixed by
        // the reports-db dedup migration), which inflated theme counts (e.g.
        // "14 mentions" from 2 respondents on the June 2026 deck). One comment
        // per (respondent, text) regardless of how many rows carry it.
        const allComments = [];
        const _seenComment = new Set();
        answersRaw.forEach(r => {
          const rid = (r['Response ID'] || r['\ufeffResponse ID'] || Object.values(r)[0] || '').toString().trim();
          const textRaw = r['Text'] || r['\ufeffText'] || r['Comment'] || r['\ufeffComment'] || '';
          const optRaw  = r['Option'] || r['\ufeffOption'] || '';
          const ratingWords = /^(excellent|good|satisf|poor|bad|very good|very bad|bien|bon|mauvais|parfait|moyen|neutre|neutral|nul|great|ok|okay|fair|average|horrible|terrible|outstanding)$/i;
          const optCandidate = optRaw.length > 25 && !ratingWords.test(optRaw.trim()) ? optRaw : '';
          const text = (textRaw || optCandidate).trim();
          // eslint-disable-next-line security/detect-unsafe-regex -- reviewed (step 4): linear: one optional group, no overlap
          if (!text || /^\s*\d+([.,]\d+)?\s*$/.test(text)) return;
          if (text.length < 5) return;
          const _ck = rid + '|' + text.toLowerCase();
          if (_seenComment.has(_ck)) return;
          _seenComment.add(_ck);
          const ctx = resultMap[rid] || {};
          allComments.push({
            responseId: rid,
            requestId:  ctx.requestId || '',
            text,
            score:     ctx.score,
            date:      ctx.date || '',
            ym:        parseDateToYM(ctx.date || ''),   // ← "2026-03" for fast month filtering
            sentiment: classifyVocSentiment(text),
            themes:    classifyVocThemes(text),
          });
        });

        const meta = { answersRows: answerRows.length, surveyRows: resultRows.length,
                       answerCols: answersRaw.length > 0 ? Object.keys(answersRaw[0]) : [],
                       source: 'db' };

        _voiceCache.comments = allComments;
        _voiceCache.data     = aggregateVoice(allComments, meta);
        _voiceCache.ts       = Date.now();
        console.log(`[survey/voice] ✅ cached ${allComments.length} comments (DB-only, no Zoho fallback)`);

      } catch(err) {
        console.error('[survey/voice]', err.message);
        return res.status(200).json({ totalComments: 0, sentimentBreakdown: {positive:0,neutral:0,negative:0},
          themes: [], quotes: [], allComments: [], error: IS_DEV ? err.message : 'Voice of customer data unavailable.' });
      }
    }

    // Month filter: compute on-the-fly from cached comment list
    if (monthFilter) {
      const filtered = _voiceCache.comments.filter(c => c.ym === monthFilter);
      console.log(`[survey/voice] month=${monthFilter} → ${filtered.length} comments`);
      const result = aggregateVoice(filtered, { month: monthFilter, totalCached: _voiceCache.comments.length });
      return res.json(result);
    }

    // No filter: return full cached result (without the heavy allComments array to keep payload small)
    const { allComments: _drop, ...publicResult } = _voiceCache.data;
    res.json(publicResult);
  });

  // POST /api/survey/voice-cache/clear
  router.post('/api/survey/voice-cache/clear', requireReportSession, requireAdmin, (req, res) => {
    _voiceCache.data = null; _voiceCache.ts = 0;
    res.json({ ok: true });
  });

  // ── SURVEY DATA ENDPOINTS ─────────────────────────────────────────

  /**
   * GET /api/survey
   * Query params: since (ISO date), limit (default 500), offset
   * Response includes source transparency: source, as_of, data_freshness, stale_warning
   */
  router.get('/api/survey', requireReportSession, async (req, res) => {
    try {
      const { getSurveyResults, getSyncStatus } = require('../reports-db');
      const { since, limit = 500, offset = 0 } = req.query;
      const records  = await getSurveyResults({ since, limit: +limit, offset: +offset });
      const syncMeta = (await getSyncStatus()).find(j => j.job_name === 'survey') || {};
      const freshness = buildDataFreshness(syncMeta);
      // Override the stale_warning to name the correct trigger job
      if (freshness.stale_warning) {
        freshness.stale_warning = 'Data may be outdated — trigger /api/sync/trigger/survey to refresh';
      }
      res.json({
        ok: true,
        count: records.length,
        ...freshness,
        data: records,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/survey/:response_id/answers
   * Returns all individual question answers for a single survey response.
   */
  router.get('/api/survey/:response_id/answers', requireReportSession, async (req, res) => {
    try {
      const { getSurveyAnswers, getSyncStatus } = require('../reports-db');
      const answers  = await getSurveyAnswers(req.params.response_id);
      const syncMeta = (await getSyncStatus()).find(j => j.job_name === 'survey') || {};
      res.json({
        ok: true,
        count: answers.length,
        source: 'local_db',
        as_of:  syncMeta.last_sync_at || null,
        data:   answers,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.helpers = { SURVEY_VIEW_ID, surveyCache: _surveyCache };
  return router;
};
