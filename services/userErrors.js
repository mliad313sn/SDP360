'use strict';
// I18N-QUALITY (2026-11-21) — the validation messages a user commonly meets on a form, in plain English AND French.
//
// WHY: a coordinator saving a PV without a department used to read « Missing state.header.department » (a JSON path)
// in a red banner, and saving one without a site read « internal_error » (an untyped throw). The raw message stays the
// stable CODE (`error_code`, what tests and logs grep); `error` becomes a sentence a person can act on, and
// `error_fr` carries the French one. The page dictionaries (public/lib/i18n/common.fr.js, I18N-QUALITY block) hold the
// same English → French pairs, so a banner that prints `error` is translated by the page layer when French is on.
//
//   userErrors.body(raw[, extra])   → { error, error_code, error_fr, ...extra } (unknown raw → { error: raw, ...extra })
//   userErrors.decorate(body)       → same, applied to an existing { error } body (used by services/httpError.fail)
//   userErrors.MESSAGES             → raw → { code, en, fr }
const MESSAGES = Object.freeze({
  'Missing state.header.department': { code: 'missing_department', en: 'Choose a department before saving.', fr: 'Choisissez un département avant d’enregistrer.' },
  'Missing department': { code: 'missing_department', en: 'Choose a department before saving.', fr: 'Choisissez un département avant d’enregistrer.' },
  'Missing site_code': { code: 'missing_site', en: 'Choose a site before saving.', fr: 'Choisissez un site avant d’enregistrer.' },
  'Missing meeting_date': { code: 'missing_meeting_date', en: 'Enter the meeting date before saving.', fr: 'Saisissez la date de la réunion avant d’enregistrer.' },
  'Missing state.header': { code: 'missing_form', en: 'The form is empty — reload the page and try again.', fr: 'Le formulaire est vide — rechargez la page et réessayez.' },
  'Missing state.meta in body': { code: 'missing_form', en: 'The form is empty — reload the page and try again.', fr: 'Le formulaire est vide — rechargez la page et réessayez.' },
  'Missing state.meta': { code: 'missing_form', en: 'The form is empty — reload the page and try again.', fr: 'Le formulaire est vide — rechargez la page et réessayez.' },
  'Missing D in request body': { code: 'missing_form', en: 'The form is empty — reload the page and try again.', fr: 'Le formulaire est vide — rechargez la page et réessayez.' },
  'editor role or higher required': { code: 'role_editor_required', en: 'Your role cannot save here — ask an administrator for the editor role.', fr: 'Votre rôle ne permet pas d’enregistrer ici — demandez le rôle « éditeur » à un administrateur.' },
  'Your account has no site assigned for this module. Contact your administrator.': { code: 'no_site_assigned', en: 'Your account has no site assigned for this module. Contact your administrator.', fr: 'Aucun site n’est attribué à votre compte pour ce module. Contactez votre administrateur.' },
  'description is required': { code: 'missing_description', en: 'Describe the action before saving.', fr: 'Décrivez l’action avant d’enregistrer.' },
  'Issue not found': { code: 'issue_not_found', en: 'This issue no longer exists — reload the page.', fr: 'Ce problème n’existe plus — rechargez la page.' },
  'Action not found': { code: 'action_not_found', en: 'This action no longer exists — reload the page.', fr: 'Cette action n’existe plus — rechargez la page.' },
  'Meeting not found': { code: 'meeting_not_found', en: 'This meeting report no longer exists — reload the page.', fr: 'Ce compte rendu de réunion n’existe plus — rechargez la page.' },
});

function lookup(raw) {
  const k = String(raw == null ? '' : raw).trim();
  return Object.prototype.hasOwnProperty.call(MESSAGES, k) ? MESSAGES[k] : null;
}
function body(raw, extra) {
  const m = lookup(raw);
  const out = m ? { error: m.en, error_code: String(raw).trim(), error_fr: m.fr } : { error: raw };
  if (extra && typeof extra === 'object') Object.assign(out, extra);
  return out;
}
function decorate(b) {
  if (!b || typeof b !== 'object' || typeof b.error !== 'string' || b.error_code) return b;
  const m = lookup(b.error);
  if (!m) return b;
  return Object.assign({}, b, { error: m.en, error_code: b.error.trim(), error_fr: m.fr });
}

module.exports = { MESSAGES, body, decorate, lookup };
