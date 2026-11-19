'use strict';
// P09 — profile task reachability, slice A (6 profiles; one login each stays under the 10-per-15-min login throttle).
const { runJourney } = require('./fixtures/harness');
const { profileSteps } = require('./fixtures/profileTaskJourney');

runJourney('P09 profile tasks A (simulation, not acceptance)', profileSteps(['administrator', 'executive', 'business', 'operations', 'coordinator', 'field']), { timeout: 600000 });
