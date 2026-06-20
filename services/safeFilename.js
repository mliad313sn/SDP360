'use strict';

const path = require('path');

/**
 * Build a safe absolute path for a user-supplied filename INSIDE `dir`.
 *
 * Hardens file-write routes against path traversal (e.g. ?name=../../x):
 *   - strips any directory components via path.basename (kills ../, absolute paths)
 *   - replaces anything that isn't [A-Za-z0-9._-] with '_'
 *   - optionally forces an extension
 *   - defense-in-depth: throws if the resolved path escapes `dir`
 *
 * @param {string} dir   the fixed output directory (must be trusted)
 * @param {string} name  the untrusted filename (e.g. req.query.name)
 * @param {object} [opts]
 * @param {string} [opts.ext]      forced extension, e.g. '.pptx'
 * @param {string} [opts.fallback] name to use when input is empty/invalid
 * @returns {string} absolute path guaranteed to live directly under `dir`
 * @throws  {Error}  'unsafe filename' if the result would escape `dir`
 */
function safeJoin(dir, name, opts = {}) {
  const fallback = opts.fallback || 'file';
  let base = path.basename(String(name == null ? '' : name).trim());
  base = base.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!base || base === '.' || base === '..') base = fallback;
  if (opts.ext) {
    const want = opts.ext.startsWith('.') ? opts.ext : '.' + opts.ext;
    if (path.extname(base).toLowerCase() !== want.toLowerCase()) base += want;
  }
  const full = path.resolve(dir, base);
  const rel  = path.relative(path.resolve(dir), full);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw new Error('unsafe filename');
  }
  return full;
}

module.exports = { safeJoin };
