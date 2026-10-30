'use strict';
// WP-M01-001 — preloaded by `npm test` (--require) into every test process. Gives the
// declared suite throwaway admin credentials so it runs on a box with no .env (CI).
// Never overrides a value that is already set; production never loads this file.
if (!process.env.DASH_USER) process.env.DASH_USER = 'test-admin';
if (!process.env.DASH_PASS) process.env.DASH_PASS = 'test-admin-pass-0000';
