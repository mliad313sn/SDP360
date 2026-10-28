'use strict';
// Step 4 (SDP-DASH-2.0) — static analysis (SAST) of the server code. Run: npx eslint .
// Only security-relevant rules are ERRORS (they fail CI); the noisy heuristic ones are left off
// rather than drowned in warnings nobody reads. tools/ci/lint.js keeps doing the syntax gate.
const security = require('eslint-plugin-security');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'vendor/**', 'public/**', 'prod-snapshot/**', 'Meridian/**', '.claude/**',
    'docs/**', 'data/**', 'tools/installer-build/**', 'unpacked_tmpl/**', 'coverage/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: { security },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-bidi-characters': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-child-process': 'error',
    },
  },
  // Tests compile page scripts with new Function() on purpose (static checks of inline code).
  { files: ['tests/**/*.js'], rules: { 'no-new-func': 'off', 'security/detect-unsafe-regex': 'off' } },
];
