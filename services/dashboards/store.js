'use strict';
// Step 6 (lot 6.4) — persistence of composed dashboards (sqlite: schema created lazily by services/defstore.js;
// PostgreSQL: db/postgres/reports/018_dashboards.sql, applied by the migrator). A dashboard has ONE working draft
// and N published versions; the version on air is `published_version`. Versions are never rewritten — a rollback
// republishes an old definition as the next version, so the history reads straight down.
module.exports = require('../defstore').createStore({ table: 'dashboards', versions: 'dashboard_versions', key: 'dashboard_id' });
