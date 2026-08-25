/* Business-only account detection (Site Awareness SP1.5).
 * A user whose ONLY roles are business viewer roles (site-business / group-business) gets the
 * restricted "Ma Vue Site" experience: the nav shows only that page and every other page
 * redirects them there. A user who ALSO holds any hierarchy or other feature role is NOT
 * business-only (they keep full access). UMD — usable in Node (tests) and the browser.
 */
(function (root) {
  var BUSINESS_ROLES = ['site-business', 'group-business'];
  function isBusinessOnly(roles) {
    if (!Array.isArray(roles) || roles.length === 0) return false;
    return roles.every(function (r) { return BUSINESS_ROLES.indexOf(r) !== -1; });
  }
  var api = { isBusinessOnly: isBusinessOnly, BUSINESS_ROLES: BUSINESS_ROLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BusinessRoles = api;
})(typeof self !== 'undefined' ? self : this);
