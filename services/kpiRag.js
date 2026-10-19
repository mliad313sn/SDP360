'use strict';
// Step 3 — the KPI/RAG registry lives in public/lib/kpiRag.js (UMD) so the browser engine
// (activity-tracker/engine.js) and the server (tracker-pptx.js, scoring services) read the SAME
// policies. This file only re-exports it for server callers.
module.exports = require('../public/lib/kpiRag');
