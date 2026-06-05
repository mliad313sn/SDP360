/**
 * activity-tracker/api.js — fetch wrappers for /api/tracker/*
 *
 * Exposes window.TRApi.{ load, save, reset, exportPptx }.
 * Each returns a promise that resolves with the parsed JSON body or
 * rejects with an Error carrying the server error message.
 *
 * Token source mirrors the legacy file: report_token cookie. The
 * actual auth is gated by `auth.js` upstream — by the time this
 * runs the user is authenticated.
 */
(function (global) {
  'use strict';

  function token() {
    return document.cookie.match(/report_token=([^;]+)/)?.[1] || '';
  }
  function headers(json) {
    const h = { 'x-report-token': token() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function load() {
    const r = await fetch('/api/tracker/load', { credentials: 'same-origin', headers: headers() });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || ('HTTP ' + r.status));
    }
    return r.json();
  }

  async function save(D) {
    const r = await fetch('/api/tracker/save', {
      method: 'POST', credentials: 'same-origin',
      headers: headers(true),
      body: JSON.stringify({ D }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || ('HTTP ' + r.status));
    }
    return r.json();
  }

  async function reset() {
    const r = await fetch('/api/tracker/reset', { method: 'POST', credentials: 'same-origin', headers: headers() });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || ('HTTP ' + r.status));
    }
    return r.json();
  }

  async function exportPptx(payload) {
    const r = await fetch('/api/tracker/export', {
      method: 'POST', credentials: 'same-origin',
      headers: headers(true),
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || ('HTTP ' + r.status));
    }
    return r.blob();
  }

  // Preview what a delete-year would do — counts rows that would be
  // deleted from tracker_inputs and shows post-deletion years[].
  // Returns the JSON envelope from the server. Does NOT mutate.
  async function previewDeleteYear(year) {
    const r = await fetch('/api/tracker/delete-year?year=' + encodeURIComponent(year), {
      method: 'GET', credentials: 'same-origin', headers: headers(),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || ('HTTP ' + r.status));
    }
    return r.json();
  }

  // Commit the delete. Server runs it in a single transaction, returns
  // the fresh D object so the UI can re-render without a second load.
  async function deleteYear(year) {
    const r = await fetch('/api/tracker/delete-year', {
      method: 'POST', credentials: 'same-origin',
      headers: headers(true),
      body: JSON.stringify({ year }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || ('HTTP ' + r.status));
    }
    return r.json();
  }

  global.TRApi = { load, save, reset, exportPptx, previewDeleteYear, deleteYear };
})(window);
