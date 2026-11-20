'use strict';
// P11 r5 (R2-N3 residual) — the field outbox creates an inspection only for a field-app id (EM-IT-<date>-F + 12 hex,
// public/field/app.js fieldInspectionId). Field tests keep their readable labels and map them here, deterministically.
const crypto = require('crypto');
module.exports = function fieldId(id) {
  const s = String(id);
  if (/^EM-IT-\d{8}-F[0-9A-F]{12}$/.test(s)) return s;
  const d = (s.match(/\d{8}/) || ['20261019'])[0];
  return `EM-IT-${d}-F` + crypto.createHash('sha256').update(s).digest('hex').slice(0, 12).toUpperCase();
};
