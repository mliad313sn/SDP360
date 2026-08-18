'use strict';
// Personal Roadmap Manager — REST for the Service & Support Manager's private objectives +
// deliverables. Every route is requireReportSession + requireSuperAdmin (a personal tool),
// and user_id is ALWAYS req.reportUser.id — never trusted from body/query, so one super_admin
// can never read or mutate another's roadmap. DI factory like routes/opmanager.js /
// routes/meridian.js: server.js passes { express, requireReportSession, requireSuperAdmin }.
// NOT mounted in server.js yet (that's a later task) — the page is a later task too.
module.exports = function roadmapRoutes(deps) {
  const { express, requireReportSession, requireSuperAdmin } = deps;
  const router = express.Router();
  const rdb = require('../reports-db');
  const roadmapEvidence = require('../services/roadmapEvidence');
  const jsonBody = express.json();

  // GET the whole roadmap (lazy-seeds the 4 default objectives on first hit).
  // Best-effort → empty roadmap on throw, never 500 (mirrors the WAN readers' contract).
  router.get('/api/roadmap', requireReportSession, requireSuperAdmin, async (req, res) => {
    try { res.json(await rdb.getRoadmap(req.reportUser.id)); }
    catch (e) { res.json({ objectives: [], deliverables: [] }); }
  });

  // Obj-2 (Plateforme ITSM & actifs) live evidence: CMDB completeness + SDP asset total +
  // asset-class coverage, composed from existing assets-db readers. Best-effort → honest
  // empty (completeness null, never a fabricated 0/100) on throw, never 500.
  router.get('/api/roadmap/evidence/platform', requireReportSession, requireSuperAdmin, async (req, res) => {
    try { res.json(await roadmapEvidence.loadPlatformEvidence()); }
    catch (e) { res.json({ cmdb_completeness_pct: null, sdp_total: 0, asset_class_count: 0, asset_classes: [] }); }
  });

  // Obj-3 (Incidents & gouvernance CAB) live evidence: RCA/template conformity of major
  // incidents (primary KPI) + change success rate (secondary), composed from reports-db
  // readers. Best-effort → honest empty (all pct null, never a fabricated 0/100) on throw,
  // never 500. The "14 active actions" are MANUAL deliverables, not derived here.
  router.get('/api/roadmap/evidence/incidents', requireReportSession, requireSuperAdmin, async (req, res) => {
    try { res.json(await roadmapEvidence.loadIncidentsEvidence()); }
    catch (e) { res.json({ total_mi: 0, conformity_pct: null, rca_pct: null, ca_pct: null, pir_pct: null, ll_pct: null, change_success_rate: null, changes_count: null }); }
  });

  router.put('/api/roadmap/objective/:key', requireReportSession, requireSuperAdmin, jsonBody, async (req, res) => {
    try { await rdb.upsertRoadmapObjective(req.reportUser.id, req.params.key, req.body || {}); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/roadmap/deliverable', requireReportSession, requireSuperAdmin, jsonBody, async (req, res) => {
    try { const uid = await rdb.addRoadmapDeliverable(req.reportUser.id, req.body || {}); res.json({ ok: true, uid }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/api/roadmap/deliverable/:uid', requireReportSession, requireSuperAdmin, jsonBody, async (req, res) => {
    try { await rdb.updateRoadmapDeliverable(req.reportUser.id, req.params.uid, req.body || {}); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/api/roadmap/deliverable/:uid', requireReportSession, requireSuperAdmin, async (req, res) => {
    try { await rdb.deleteRoadmapDeliverable(req.reportUser.id, req.params.uid); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
