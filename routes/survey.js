'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Survey routes — extracted from server.js (E-A01, expert audit 2026-11-05).
// Every /api/survey* route and its private helpers, byte-identical to the inline
// handlers: only `app.` → `router.`; server-internal values come in through deps
// (rdb is read through getRdb() because server.js assigns it after boot).
// SURVEY_VIEW_ID and _surveyCache stay in server.js (also read by /health).
// ─────────────────────────────────────────────────────────────────────────
module.exports = function surveyRoutes(deps) {
  const {
    express, axios, CONFIG, IS_DEV, SURVEY_VIEW_ID, _surveyCache,
    requireReportSession, requireAdmin, fail, safeError,
    getValidToken, fetchView, buildDataFreshness,
  } = deps;
  const router = express.Router();
  const rdb = new Proxy({}, { get: (_t, k) => deps.getRdb()[k] });
  // A8 — invariant 1 on survey data: a reply belongs to the helpdesk group of its ticket. null = admin tier (all),
  // [] = site-less account (nothing), else the lowercased Zoho groups of the caller's sites (services/siteGroups).
  const scopeOf = (req) => require('../services/siteGroups').userSiteGroups(rdb, req.reportUser);
  // ?groups= narrows WITHIN the perimeter, never widens it.
  const narrow = (own, q) => {
    const asked = String(q || '').split(',').map((g) => g.trim().toLowerCase()).filter(Boolean);
    if (!asked.length) return own;
    return own == null ? asked : asked.filter((g) => own.includes(g));
  };

  // ══════════════════════════════════════════════════════════════════
  // SURVEY — reads from Analytics Plus view 106803000000002079
  // Overall Score field = percentage string e.g. "100%", "80%", "0%"
  // Survey responses come directly from Analytics Plus view 106803000000002079
  // ══════════════════════════════════════════════════════════════════

  // Survey views — Zoho Survey tables synced into Analytics Plus
  // 106803000000002079 = Zoho Survey Results  (has: Survey Sent on, Survey Responded on, Survey ID, Request ID, Overall Score)
  // 106803000000002077 = Zoho Survey Questions (has: Question text, Survey ID, type — for rating/quality breakdown)
  // 106803000000002076 = Zoho Survey Answers   (has: Answer text, Question ID, Response ID — for verbatim)
  const SURVEY_QUESTIONS_VIEW_ID = process.env.ZOHO_SURVEY_QUESTIONS_VIEW_ID || '106803000000002077';
  const SURVEY_ANSWERS_VIEW_ID   = process.env.ZOHO_SURVEY_ANSWERS_VIEW_ID   || '106803000000002076'; // typed comments — corrected from 2075

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
      fail(res, err);
    }
  });

  /**
   * GET /api/survey/summary — reads view 106803000000002079 directly
   * Returns same shape as before so dashboard works without changes
   */
  router.get('/api/survey/summary', requireReportSession, async (req, res) => {
    // A8: a non-admin reads only his sites' replies — computed per request, never from the shared fleet cache
    const own = await scopeOf(req);
    if (own != null) {
      try {
        const v = await require('../reports-db').getCustomerVoiceDB(12, { groups: own }) || {};
        if (!(v.totalResponses > 0)) return res.json({ ...emptyResult('No survey reply on your sites\' tickets.'), scope: 'own_sites' });
        return res.json({ surveyId: SURVEY_VIEW_ID, surveyName: 'IT Helpdesk CSAT', source: 'PostgreSQL (survey_results)', scope: 'own_sites',
          totalResponses: v.totalResponses, totalSent: v.totalSent ?? null, totalResponded: v.totalResponded ?? null, responseRate: v.responseRate ?? null,
          ratingScale: 100, avgRating: v.avgRating, csatPct: v.csatPct, nps: v.nps, promoters: v.promoters, passives: v.passives, detractors: v.detractors,
          byMonth: v.byMonth || [], verbatim: [], sentimentSummary: { positive: 0, neutral: 0, negative: 0 }, questionMap: { ratingQ: 'Overall Score' } });
      } catch (e) { return fail(res, e); }
    }
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
            source:       'PostgreSQL (survey_results)',
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
      let groupList = groups ? groups.split(',').map(g => g.trim()).filter(Boolean) : [];
      const rdb = require('../reports-db');
      // A8: non-admin → requested groups ∩ own groups (or own groups when none requested); none left → nothing measured
      const own = await scopeOf(req);
      if (own != null) {
        const keep = narrow(own, groups);
        if (!keep.length) return res.json({ totalResponses: 0, avgRating: null, csatPct: null, nps: null, promoters: 0, passives: 0, detractors: 0, byMonth: [], groupFiltered: groupList.length > 0, scope: 'own_sites', as_of: null });
        const kept = new Set(keep);
        groupList = [...new Set([...groupList.filter((g) => kept.has(g.toLowerCase())), ...((await rdb.listSites()) || [])
          .flatMap((s) => String(s.zoho_group || '').split(',').map((x) => x.trim())).filter((g) => g && kept.has(g.toLowerCase()))])];
      }

      // Forked reader  — q1 period+group-filtered scores, q2 12-mo trend rows.
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
      fail(res, err);
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
    const own = await scopeOf(req);
    if (own != null) {   // A8: own groups only, never the fleet cache
      try {
        const d = await require('../reports-db').getCustomerVoiceByDimensionDB({ groups: own });
        return res.json({ ...d, scope: 'own_sites' });
      } catch (e) { return fail(res, e); }
    }
    if (_dimCache.data && Date.now() - _dimCache.ts < _dimCache.TTL) {
      return res.json(_dimCache.data);
    }

    // DB-first (Phase 3 of executive.html rewrite, 2026-05-26).
    // Was 500'ing because both Zoho calls (survey view + 30k REQUEST_TABLE
    // rows) were getting rate-limited. JOIN survey_results to
    // request_records inside PostgreSQL — single round-trip, no Zoho calls.
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
            group:     String(r.tech_group || '').trim().toLowerCase(),   // A8 perimeter key
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
          // eslint-disable-next-line security/detect-unsafe-regex -- reviewed (consolidation 2026-10-28): anchored; \s* / \d+ / [.,]\d+ are disjoint classes, linear
          if (!text || /^\s*\d+([.,]\d+)?\s*$/.test(text)) return;
          if (text.length < 5) return;
          const _ck = rid + '|' + text.toLowerCase();
          if (_seenComment.has(_ck)) return;
          _seenComment.add(_ck);
          const ctx = resultMap[rid] || {};
          allComments.push({
            responseId: rid,
            requestId:  ctx.requestId || '',
            group:      ctx.group || '',
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

    // A8: the cache is fleet-wide; a non-admin (or a ?groups= drill-down) is filtered per request
    const own = await scopeOf(req);
    const keep = narrow(own, req.query.groups);
    if (keep != null) {
      const set = new Set(keep);
      const mine = _voiceCache.comments.filter(c => set.has(c.group) && (!monthFilter || c.ym === monthFilter));
      const out = aggregateVoice(mine, { month: monthFilter || null, scope: own == null ? 'groups' : 'own_sites' });
      if (!monthFilter) delete out.allComments;
      return res.json(out);
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

  /**
   * GET /api/survey/voice-tiles?yr=YYYY&mo=M — A8 CSAT / NPS tiles per site and helpdesk group (services/voiceTiles.js):
   * replies, response rate on closed tickets, CSAT, NPS, 6-month trend, created/closed volumes; perimeter-filtered;
   * a failed or never-run survey sync reads 'unknown' with its cause. No reply = null, never 0.
   */
  router.get('/api/survey/voice-tiles', requireReportSession, async (req, res) => {
    try {
      const now = new Date();
      const yr = Number(req.query.yr) || now.getUTCFullYear();
      const mo = Number(req.query.mo) || (now.getUTCMonth() + 1);
      if (!(yr >= 2000 && yr <= 2100 && mo >= 1 && mo <= 12)) return res.status(400).json({ error: 'yr / mo out of range' });
      const VT = require('../services/voiceTiles');
      const ms = VT.months(yr, mo, 6);
      const [ny, nm] = [mo === 12 ? yr + 1 : yr, mo === 12 ? 1 : mo + 1];
      const rdb2 = require('../reports-db');
      const data = await rdb2.getSurveyVoiceTilesDB({ from: ms[0] + '-01', to: `${ny}-${String(nm).padStart(2, '0')}-01` });
      const own = await scopeOf(req);
      const ids = own == null ? null : require('../services/userSites').siteIds(req.reportUser);
      const meta = ((await rdb2.getSyncStatus()) || []).find((j) => j.job_name === 'survey') || null;
      res.json(VT.build({ data, sites: (await rdb2.listSites()) || [], year: yr, month: mo, trendMonths: 6, scopeGroups: own, scopeSiteIds: ids, meta }));
    } catch (err) { fail(res, err); }
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
      const own = await scopeOf(req);   // A8 — own sites' replies only below the admin tier
      const records  = await getSurveyResults({ since, limit: +limit, offset: +offset, ...(own != null ? { groups: own } : {}) });
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
      fail(res, err);
    }
  });

  /**
   * GET /api/survey/:response_id/answers
   * Returns all individual question answers for a single survey response.
   */
  router.get('/api/survey/:response_id/answers', requireReportSession, async (req, res) => {
    try {
      const { getSurveyAnswers, getSyncStatus } = require('../reports-db');
      const own = await scopeOf(req);   // A8 — a reply outside the caller's sites reads as none (no existence oracle)
      const answers  = await getSurveyAnswers(req.params.response_id, own != null ? { groups: own } : {});
      const syncMeta = (await getSyncStatus()).find(j => j.job_name === 'survey') || {};
      res.json({
        ok: true,
        count: answers.length,
        source: 'local_db',
        as_of:  syncMeta.last_sync_at || null,
        data:   answers,
      });
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
};
