'use strict';
// P09 — profile task reachability, slice A (6 profiles; one login each stays under the 10-per-15-min login throttle).
require('./fixtures/profileTaskJourney').profileJourney('P09 profile tasks A (simulation, not acceptance)',
  ['administrator', 'executive', 'business', 'operations', 'coordinator', 'field']);
