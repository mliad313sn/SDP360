'use strict';
// The pages of SDP-Dashboard 2.0 (step 6 onwards), declared ONCE: server.js serves each one through sendHtmlPage (so
// its assets get ?v=) and caches it, and services/cspPolicy.js puts every one of them under the strict policy (no
// inline script — tests/csp-inline.test.js). A new page = one line here, never a line in server.js.
const V2_PAGES = [
  ['dashboard.html', 'Dashboard'],                    // step 6: composed dashboards
  ['direction.html', 'Leadership space'],
  ['dashboard-composer.html', 'Dashboard composer'],
  ['trackers.html', 'Trackers'],                      // step 7: business trackers
  ['tracker-builder.html', 'Tracker builder'],
];

module.exports = { V2_PAGES };
