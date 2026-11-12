'use strict';
// The app's top-level layer stack, on Express 4 (`app._router.stack`) AND Express 5
// (`app.router.stack`; `app._router` no longer exists there). Every route walker — the
// authz shadow/enforce instrument, the inventory and route-matrix tools, the boundary
// tests — must read the stack through this helper: on Express 5 a walker that reads
// `app._router` sees NO routes, and an instrument that wraps nothing fails OPEN silently.
function routerStack(app) {
  if (!app) return [];
  if (app._router && Array.isArray(app._router.stack)) return app._router.stack;
  let r = null;
  try { r = app.router; } catch (_) { r = null; }   // Express 4 throws on the removed app.router getter
  return r && Array.isArray(r.stack) ? r.stack : [];
}
module.exports = { routerStack };
