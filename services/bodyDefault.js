'use strict';
// Express 5 / body-parser 2 no longer initialise `req.body` to `{}`: a POST with no body
// (or a non-JSON content type) reaches the handler with `req.body === undefined`, and the
// many `const { x } = req.body` handlers would throw a 500 where Express 4 gave them `{}`.
// This keeps the Express 4 contract. A parser that runs later still replaces it (body-parser
// only skips requests that are already finished, not requests that already carry a body).
module.exports = function bodyDefault(req, res, next) {
  if (req.body === undefined) req.body = {};
  next();
};
