'use strict';
// P09 — profile task reachability, slice B (5 profiles).
const { runJourney } = require('./fixtures/harness');
const { profileSteps } = require('./fixtures/profileTaskJourney');

runJourney('P09 profile tasks B (simulation, not acceptance)', profileSteps(['pmo', 'finance', 'governance', 'analyst', 'reader']), { timeout: 600000 });
