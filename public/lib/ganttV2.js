/* W2-UI — interactive, virtualised Gantt v2 for public/project.html (switch report_config ppm_gantt_v2_enabled,
   default '0' → the page keeps today's SVG Gantt). Vanilla JS, no framework, no CDN; every rule it applies
   (working-day maths, layout, virtual window, link rules, inline-edit validation, undo stack, companion views) lives
   in the PURE lib/ganttCore.js and is unit-tested there. This file only draws and listens.

   GanttV2.mount(el, ctx) — ctx: { pid, tasks, plan, order, ghost(t), canEdit, typed, today, api, reload, msg, fail,
                                  esc, openTask(id), calendar }
     · views: Gantt (split grid + timeline, one vertical scroll, rows windowed) · Task usage · Resource usage ·
       Resource graph · Network diagram · List (the fallback at 560 px and below, and for screen-reader users)
     · zoom day / week / month / quarter (buttons, Ctrl + mouse wheel, + / − keys)
     · writes go ONLY through PUT /api/governance/portfolio/task with the task's row version (409 STALE_VERSION →
       the page reloads the truth, the command is dropped from the undo stack); no new right, no new route
     · drag a bar = move (duration kept in working days), drag its right edge = resize, drag the round handle onto
       another bar = finish-to-start link; keyboard: arrows move between rows, Alt+←/→ move one working day,
       Alt+Shift+←/→ resize, Enter opens the task, Ctrl+Z / Ctrl+Y undo / redo; grid cells: Enter / F2 edit,
       Enter commits, Escape cancels
   Text: English, French when the UI language policy is on (lib/i18n/gantt.fr.js — every T("…") key has an entry). */
(function (root) {
  'use strict';
  var G = root.GanttCore;
  var HIST = {};   // undo / redo survive the page reload that follows every write (one stack per project)
  var PREFS = { view: null, zoom: 'week' };
  function T(s) { var p = root.__uiPolicy, d = root.I18N_FR_GANTT; return (p && p.i18n_pages === '1' && d && d[s]) || s; }
  function escFallback(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var VIEWS = [['gantt', 'Gantt'], ['task_usage', 'Task usage'], ['resource_usage', 'Resource usage'], ['resource_graph', 'Resource graph'], ['network', 'Network diagram'], ['list', 'List']];
  var COLS = [['name', 'Task', 190], ['duration', 'Duration', 64], ['start', 'Start', 92], ['finish', 'Finish', 92], ['predecessors', 'Predecessors', 96], ['progress', '% complete', 70]];
  var ROW_H = 26, HEAD_H = 40, NARROW = 560;
  var PLAIN = {
    NAME_REQUIRED: 'A task needs a name.', DURATION_INVALID: 'Duration: a whole number of working days (0 = milestone).',
    DATE_INVALID: 'A date is not a real calendar date (YYYY-MM-DD).', PROGRESS_INVALID: '% complete: a number from 0 to 100.',
    PRED_INVALID: 'Predecessors: task numbers separated by commas (e.g. 12, 13SS+2 when link types are on).',
    DEP_SELF: 'A task cannot depend on itself.', DEP_MISSING: 'A dependency points to a task that does not exist in this project.',
    DEP_DUPLICATE: 'The same dependency is listed twice.', DEP_CYCLE: 'These dependencies would make a loop (a task would wait for itself).',
    DEPENDS_ON_HIERARCHY: 'A task cannot depend on its own parent or on one of its sub-tasks.', FIELD_NOT_EDITABLE: 'This column is read-only here.',
    LINK_TYPE_OFF: 'Only finish-to-start links can be drawn while link types are switched off.'
  };

  function mount(el, ctx) {
    var esc = ctx.esc || escFallback;
    var hist = HIST[ctx.pid] = HIST[ctx.pid] || G.createHistory(50);
    var cal = G.makeCal(ctx.calendar || null);
    var byId = {}; (ctx.tasks || []).forEach(function (t) { byId[Number(t.id)] = t; });
    var rows = G.rowsFrom(ctx.tasks || [], ctx.plan, { order: ctx.order, ghost: ctx.ghost });
    var narrow = root.matchMedia ? root.matchMedia('(max-width: ' + NARROW + 'px)').matches : false;
    var view = PREFS.view || (narrow ? 'list' : 'gantt');
    var zoomKey = PREFS.zoom, L = null, focusRow = 0, focusCol = 0, busy = false, raf = 0, drag = null;
    var n = function (v) { return v == null || v === '' ? '—' : esc(String(v)); };
    var say = function (s) { var r = el.querySelector('.g2-live'); if (r) r.textContent = s; };

    function toolbar() {
      return '<div class="g2-tools" role="toolbar" aria-label="' + esc(T('Schedule tools')) + '">' +
        '<label class="g2-lbl">' + esc(T('View')) + ' <select class="g2-view">' + VIEWS.map(function (v) { return '<option value="' + esc(v[0]) + '"' + (v[0] === view ? ' selected' : '') + '>' + esc(T(v[1])) + '</option>'; }).join('') + '</select></label>' +
        '<span class="g2-grp" role="group" aria-label="' + esc(T('Zoom')) + '"><button type="button" class="btn g2-zin" aria-label="' + esc(T('Zoom in')) + '">+</button>' +
        '<select class="g2-zoom" aria-label="' + esc(T('Timescale')) + '">' + G.ZOOMS.map(function (z) { return '<option value="' + esc(z) + '"' + (z === zoomKey ? ' selected' : '') + '>' + esc(T(z === 'day' ? 'Days' : z === 'week' ? 'Weeks' : z === 'month' ? 'Months' : 'Quarters')) + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="btn g2-zout" aria-label="' + esc(T('Zoom out')) + '">−</button></span>' +
        '<button type="button" class="btn g2-today">' + esc(T('Today')) + '</button>' +
        (ctx.canEdit ? '<button type="button" class="btn g2-undo"' + (hist.canUndo() ? '' : ' disabled') + ' title="' + esc(T('Undo')) + ' (Ctrl+Z)">' + esc(T('Undo')) + '</button>' +
          '<button type="button" class="btn g2-redo"' + (hist.canRedo() ? '' : ' disabled') + ' title="' + esc(T('Redo')) + ' (Ctrl+Y)">' + esc(T('Redo')) + '</button>' : '') +
        '<span class="g2-live muted" role="status" aria-live="polite"></span></div>';
    }
    function legend() {
      return '<p class="muted g2-help">' + esc(T('Bar = scheduled dates · red = critical path · dashed = baseline · ◆ = milestone · orange line = today.')) + ' ' +
        (ctx.canEdit ? esc(T('Drag a bar to move it, its right edge to change the duration, its round handle onto another bar to link them (finish-to-start). Keyboard: Alt + arrows move, Alt + Shift + arrows resize, Ctrl+Z undo.')) : esc(T('Read-only: you may not edit this plan.'))) + '</p>';
    }

    function render() {
      el.innerHTML = '<div class="g2">' + toolbar() + legend() + '<div class="g2-body"></div></div>';
      var body = el.querySelector('.g2-body');
      if (!rows.length) { body.innerHTML = '<p class="muted">' + esc(T('No task yet.')) + '</p>'; return wire(); }
      if (view === 'gantt') ganttShell(body);
      else if (view === 'list') body.innerHTML = listHtml();
      else if (view === 'network') body.innerHTML = networkHtml();
      else body.innerHTML = usageHtml(view);
      wire();
    }

    // ---- Gantt: grid + timeline, one vertical scroll, rows windowed --------------------------------------------
    function ganttShell(body) {
      L = G.layout(rows, { scale: zoomKey, rowH: ROW_H, today: ctx.today });
      var gw = COLS.reduce(function (a, c) { return a + c[2]; }, 0);
      body.innerHTML = '<div class="g2-split" style="height:' + Math.min(560, HEAD_H + rows.length * ROW_H + 18) + 'px">' +
        '<div class="g2-grid" role="grid" aria-label="' + esc(T('Task grid')) + '" aria-rowcount="' + (rows.length + 1) + '" aria-colcount="' + COLS.length + '">' +
          '<div class="g2-ghead" role="row" aria-rowindex="1" style="width:' + gw + 'px">' + COLS.map(function (c) { return '<div role="columnheader" class="g2-c" style="width:' + c[2] + 'px">' + esc(T(c[1])) + '</div>'; }).join('') + '</div>' +
          '<div class="g2-gbody"><div class="g2-gin" style="height:' + (rows.length * ROW_H) + 'px;width:' + gw + 'px"></div></div></div>' +
        '<div class="g2-tl" tabindex="-1"><div class="g2-tin" style="width:' + L.width + 'px;height:' + (HEAD_H + L.height) + 'px">' + headerHtml() +
          '<svg class="g2-svg" width="' + L.width + '" height="' + L.height + '" style="top:' + HEAD_H + 'px" role="group" aria-label="' + esc(T('Gantt chart of the project tasks')) + '"></svg></div></div></div>';
      paint();
    }
    function headerHtml() {
      var tk = G.ticks(zoomKey, L.origin, L.endDay, { months: T('MONTHS') === 'MONTHS' ? null : T('MONTHS').split(',') });
      var cell = function (t, next, cls) { var x = L.dayToX(t.day), w = L.dayToX(next) - x; return '<div class="' + cls + '" style="left:' + x + 'px;width:' + w + 'px">' + esc(t.label) + '</div>'; };
      var major = tk.major.map(function (t, i) { return cell(t, i + 1 < tk.major.length ? tk.major[i + 1].day : L.endDay, 'g2-tmaj'); }).join('');
      var minor = tk.minor.map(function (t, i) { return cell(t, i + 1 < tk.minor.length ? tk.minor[i + 1].day : L.endDay, 'g2-tmin'); }).join('');
      return '<div class="g2-thead" aria-hidden="true" style="width:' + L.width + 'px">' + major + minor + '</div>';
    }
    function win() {
      var tl = el.querySelector('.g2-tl');
      return G.visibleWindow({ scrollTop: tl ? tl.scrollTop : 0, viewport: tl ? tl.clientHeight - HEAD_H : 400, rowH: ROW_H, count: rows.length, overscan: 10 });
    }
    function paint() {
      raf = 0;
      var svg = el.querySelector('.g2-svg'), gin = el.querySelector('.g2-gin'); if (!svg || !gin) return;
      var w = win(), out = [], grid = [], i;
      out.push('<defs><pattern id="g2hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#cfd6e0"/><line x1="0" y1="0" x2="0" y2="6" stroke="#3A4A60" stroke-width="2"/></pattern><marker id="g2arr" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#6b7785"/></marker></defs>');
      for (i = w.start; i < w.end; i++) if (i % 2) out.push('<rect class="g2-zebra" x="0" y="' + (i * ROW_H) + '" width="' + L.width + '" height="' + ROW_H + '"/>');
      for (i = w.start; i < w.end; i++) {
        var r = rows[i], b = L.bars[i];
        r.preds.forEach(function (p) { var d = G.linkPath(L, { from: p.id, to: r.id, type: p.type }); if (d) out.push('<path class="g2-link' + (p.type !== 'FS' ? ' g2-typed' : '') + '" d="' + esc(d) + '" marker-end="url(#g2arr)"><title>' + esc('#' + p.id + ' → #' + r.id + ' ' + p.type + (p.lag ? (p.lag > 0 ? '+' : '') + p.lag + ' d' : '')) + '</title></path>'); });
        if (b.baseline) out.push('<rect class="g2-base" x="' + b.baseline.x0 + '" y="' + (b.y + 3) + '" width="' + Math.max(2, b.baseline.x1 - b.baseline.x0) + '" height="' + (ROW_H - 6) + '" rx="4"/>');
        if (b.x0 == null) { out.push('<text class="g2-ns" x="4" y="' + (b.y + 17) + '">' + esc(T('not scheduled')) + '</text>'); continue; }
        var label = r.name + ': ' + (r.start || '') + ' → ' + (r.end || '') + (r.computed ? ' (' + T('moved by the scheduler') + ')' : '') + (r.critical ? ', ' + T('critical') : '') + ', ' + T('progress') + ' ' + (r.progress == null ? T('not reported') : r.progress + ' %');
        var tab = i === focusRow ? '0' : '-1';
        if (b.milestone) {
          var cx = b.x0, cy = b.y + ROW_H / 2;
          out.push('<g class="g2-bar g2-ms' + (r.critical ? ' g2-crit' : '') + '" data-task="' + esc(r.id) + '" data-row="' + i + '" tabindex="' + tab + '" role="img" aria-label="' + esc(label) + '"><title>' + esc(label) + '</title><path d="M' + cx + ',' + (cy - 7) + ' L' + (cx + 7) + ',' + cy + ' L' + cx + ',' + (cy + 7) + ' L' + (cx - 7) + ',' + cy + ' z"/></g>');
        } else {
          var cls = 'g2-bar' + (r.critical ? ' g2-crit' : '') + (r.computed ? ' g2-comp' : '') + (r.summary ? ' g2-sum' : '');
          out.push('<g class="' + cls + '" data-task="' + esc(r.id) + '" data-row="' + i + '" tabindex="' + tab + '" role="img" aria-label="' + esc(label) + '"><title>' + esc(label) + '</title>' +
            '<rect class="g2-fill" x="' + b.x0 + '" y="' + (b.y + 6) + '" width="' + Math.max(3, b.x1 - b.x0) + '" height="' + (ROW_H - 12) + '" rx="4"/>' +
            (b.progressW != null ? '<rect class="g2-prog" x="' + b.x0 + '" y="' + (b.y + ROW_H - 8) + '" width="' + b.progressW + '" height="2"/>' : '') +
            (ctx.canEdit && !r.summary ? '<rect class="g2-rz" data-act="resize" x="' + (b.x1 - 5) + '" y="' + (b.y + 4) + '" width="7" height="' + (ROW_H - 8) + '"/><circle class="g2-lh" data-act="link" cx="' + (b.x1 + 7) + '" cy="' + (b.y + ROW_H / 2) + '" r="4"/>' : '') + '</g>');
        }
      }
      if (L.todayX != null) out.push('<line class="g2-today-l" x1="' + L.todayX + '" x2="' + L.todayX + '" y1="0" y2="' + L.height + '"><title>' + esc(T('today') + ' ' + ctx.today) + '</title></line>');
      svg.innerHTML = out.join('');
      for (i = w.start; i < w.end; i++) grid.push(gridRow(i));
      gin.innerHTML = grid.join('');
    }
    function cellText(r, t, key) {
      if (key === 'name') return r.name || ('#' + String(r.id));
      if (key === 'duration') return r.milestone ? '◆ 0 d' : t.duration_days == null ? '—' : t.duration_days + ' d';
      if (key === 'start') return r.start || '—';
      if (key === 'finish') return r.end || '—';
      if (key === 'predecessors') return G.formatPredecessors(t) || '';
      return t.progress_pct == null ? '—' : t.progress_pct + ' %';
    }
    function gridRow(i) {
      var r = rows[i], t = byId[r.id] || {};
      return '<div class="g2-row' + (r.critical ? ' g2-rcrit' : '') + '" role="row" aria-rowindex="' + (i + 2) + '" style="top:' + (i * ROW_H) + 'px">' + COLS.map(function (c, k) {
        var edit = ctx.canEdit && c[0] !== 'finish';
        var pad = c[0] === 'name' ? 'padding-left:' + (4 + 12 * r.depth) + 'px;' : '';
        return '<div role="gridcell" class="g2-c' + (edit ? ' g2-ed' : '') + '" style="width:' + c[2] + 'px;' + pad + '" data-row="' + i + '" data-col="' + k + '" tabindex="' + (i === focusRow && k === focusCol ? '0' : '-1') + '"' + (edit ? ' aria-readonly="false"' : ' aria-readonly="true"') + '>' + esc(cellText(r, t, c[0])) + (k === 0 ? ' <small class="muted">#' + esc(r.id) + '</small>' : '') + '</div>';
      }).join('') + '</div>';
    }
    function schedule() { if (!raf) raf = (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(paint); }

    // ---- companion views --------------------------------------------------------------------------------------
    function span() {
      var lo = null, hi = null;
      rows.forEach(function (r) { if (r.start && (!lo || r.start < lo)) lo = r.start; if (r.end && (!hi || r.end > hi)) hi = r.end; });
      return lo ? { from: lo, to: hi || lo } : null;
    }
    function usageHtml(kind) {
      var sp = span(); if (!sp) return '<p class="muted">' + esc(T('No dated task: nothing to spread over time.')) + '</p>';
      var unit = zoomKey === 'day' ? 'day' : zoomKey === 'week' ? 'week' : 'month';
      var ps = G.periods(unit, sp.from, sp.to).slice(0, 120);
      var head = '<tr><th>' + esc(T(kind === 'task_usage' ? 'Task' : 'Resource')) + '</th>' + (kind === 'resource_graph' ? '' : '<th>' + esc(T('Total (h)')) + '</th>') + ps.map(function (p) { return '<th>' + esc(p.label) + '</th>'; }).join('') + '</tr>';
      var body;
      if (kind === 'task_usage') {
        body = G.taskUsage(rows, ctx.tasks, { periods: ps, cal: cal }).map(function (u) { return '<tr><td>' + esc(u.name) + '</td><td>' + (u.unknown ? '<i>' + esc(T('effort unknown')) + '</i>' : n(u.total)) + '</td>' + u.cells.map(function (v) { return '<td>' + (v == null ? '<i class="muted">?</i>' : v === 0 ? '' : esc(v)) + '</td>'; }).join('') + '</tr>'; }).join('');
      } else if (kind === 'resource_usage') {
        body = G.resourceUsage(rows, ctx.tasks, { periods: ps, cal: cal }).map(function (g) { var tot = g.cells.reduce(function (a, v) { return a + v; }, 0); return '<tr><td>' + esc(g.unassigned ? T('unassigned') : g.owner) + (g.unknown_tasks ? ' <small class="muted">' + esc(g.unknown_tasks + ' ' + T('task(s) with unknown effort, not counted')) + '</small>' : '') + '</td><td>' + esc(Math.round(tot * 10) / 10) + '</td>' + g.cells.map(function (v) { return '<td>' + (v ? esc(v) : '') + '</td>'; }).join('') + '</tr>'; }).join('');
      } else {
        body = G.resourceGraph(rows, ctx.tasks, { periods: ps, cal: cal }).map(function (g) { return '<tr><td>' + esc(g.unassigned ? T('unassigned') : g.owner) + '</td>' + g.cells.map(function (c) { var h = c.peak_pct == null ? 0 : Math.min(100, c.peak_pct) / 100 * 28; return '<td class="g2-gcell" title="' + esc((c.peak_pct == null ? T('no known allocation') : T('peak') + ' ' + c.peak_pct + ' %') + (c.unknown ? ' · ' + c.unknown + ' ' + T('without allocation') : '')) + '"><span class="g2-gbar' + (c.over ? ' g2-over' : '') + '" style="height:' + h + 'px"></span>' + (c.peak_pct == null ? (c.unknown ? '<i class="muted">?</i>' : '') : '<small>' + esc(c.peak_pct) + '</small>') + '</td>'; }).join('') + '</tr>'; }).join('');
      }
      var note = kind === 'resource_graph' ? T('Peak daily allocation per person (sum of the allocation % of the open tasks running that day). Red = above 100 %. "?" = tasks without an allocation, never counted as 0.') : T('Hours = the task effort spread evenly over its working days. "?" = effort unknown, never counted as 0.');
      return '<p class="muted">' + esc(note) + '</p><div class="scroll"><table class="g2-tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    }
    function networkHtml() {
      var MAX = 400, list = rows.slice(0, MAX), net = G.networkLayout(list);
      var at = {}; net.nodes.forEach(function (nd) { at[nd.id] = nd; });
      var edges = net.edges.map(function (e) { var a = at[e.from], z = at[e.to]; var x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = z.x, y2 = z.y + z.h / 2, mx = (x1 + x2) / 2; return '<path class="g2-link" d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '" marker-end="url(#g2arrn)"/>'; }).join('');
      var nodes = net.nodes.map(function (nd) { var lbl = nd.name + ' · ' + (nd.start || '—') + ' → ' + (nd.end || '—'); return '<g class="g2-node' + (nd.critical ? ' g2-crit' : '') + '" data-task="' + esc(nd.id) + '" tabindex="-1" role="img" aria-label="' + esc(lbl) + '"><rect x="' + nd.x + '" y="' + nd.y + '" width="' + nd.w + '" height="' + nd.h + '" rx="6"/><text x="' + (nd.x + 6) + '" y="' + (nd.y + 18) + '">' + esc(String(nd.name).slice(0, 24)) + '</text><text class="g2-nsub" x="' + (nd.x + 6) + '" y="' + (nd.y + 36) + '">' + esc('#' + nd.id + ' · ' + (nd.start || '—') + ' → ' + (nd.end || '—')) + '</text></g>'; }).join('');
      return (rows.length > MAX ? '<p class="muted">' + esc(T('Only the first 400 tasks are drawn; use the list or the Gantt for the rest.')) + '</p>' : '') +
        '<div class="g2-net scroll"><svg width="' + net.width + '" height="' + net.height + '" role="group" aria-label="' + esc(T('Network diagram')) + '"><defs><marker id="g2arrn" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#6b7785"/></marker></defs>' + edges + nodes + '</svg></div>';
    }
    function listHtml() {
      return '<ul class="g2-list">' + rows.map(function (r) {
        var t = byId[r.id] || {};
        return '<li class="g2-li' + (r.critical ? ' g2-rcrit' : '') + '"><button type="button" class="g2-open" data-task="' + esc(r.id) + '">' + esc(r.name || '#' + r.id) + ' <small class="muted">#' + esc(r.id) + '</small></button>' +
          '<div class="muted">' + esc((r.start || '—') + ' → ' + (r.end || '—')) + ' · ' + esc(cellText(r, t, 'duration')) + ' · ' + esc(cellText(r, t, 'progress')) + (r.critical ? ' · ' + T('critical') : '') + (G.formatPredecessors(t) ? ' · ' + T('after') + ' ' + G.formatPredecessors(t) : '') + '</div></li>';
      }).join('') + '</ul>';
    }

    // ---- writes (existing route + row version), undo / redo -------------------------------------------------
    function put(entry) {
      var t = byId[entry.id] || {};
      var body = Object.assign({ id: entry.id }, entry.fields);
      if (t.version != null) body.version = t.version;
      return ctx.api('/api/governance/portfolio/task', { method: 'PUT', body: JSON.stringify(body) });
    }
    function run(cmd, dir) {
      if (busy) return Promise.resolve();
      busy = true; say(T('Saving…'));
      var list = dir === 'back' ? cmd.backward : cmd.forward, chain = Promise.resolve();
      list.forEach(function (e) { chain = chain.then(function () { return put(e); }); });
      return chain.then(function () {
        if (!dir) hist.push(cmd);
        say(T('Saved.') + ' ' + (dir === 'back' ? T('Undone') + ': ' : dir === 'fwd' ? T('Redone') + ': ' : '') + T(cmd.label));
        busy = false; return ctx.reload();
      }, function (e) {
        busy = false; if (dir) hist.drop(cmd);
        ctx.fail(e); return ctx.reload();
      });
    }
    function write(label, task, patch) { if (!patch) return Promise.resolve(null); return run(G.command(label, task, patch)); }
    // the three gestures as plain calls (pointer, keyboard and tests all go through them)
    function editTask(id, field, raw) {
      var t = byId[Number(id)]; if (!t || !ctx.canEdit) return Promise.resolve({ error: 'FIELD_NOT_EDITABLE' });
      var res = G.editCell(t, field, raw, { cal: cal, typed: !!ctx.typed, tasks: ctx.tasks });
      if (res.error) { refuse(res.error); return Promise.resolve(res); }
      return write('Edit', t, res.patch).then(function () { return res; });
    }
    function moveTask(id, dxPx, mode) {
      var i = L ? L.index[Number(id)] : null, r = i == null ? null : rows[i], t = byId[Number(id)];
      if (!r || !t || !ctx.canEdit || r.summary) return Promise.resolve(null);
      var p = G.dragDates({ start: r.start, end: r.end, milestone: r.milestone }, dxPx, zoomKey, mode, cal);
      return p ? write(mode === 'resize' ? 'Resize' : 'Move', t, p).then(function () { return p; }) : Promise.resolve(null);
    }
    function linkTasks(fromId, toId) {
      if (!ctx.canEdit) return Promise.resolve(null);
      var chk = G.canLink(ctx.tasks, fromId, toId);
      if (!chk.ok) { refuse(chk.code); return Promise.resolve(chk); }
      var patch = G.linkPatch(byId[Number(toId)], fromId, 'FS', 0, { typed: !!ctx.typed });
      if (!patch) { refuse('LINK_TYPE_OFF'); return Promise.resolve({ ok: false, code: 'LINK_TYPE_OFF' }); }
      return write('Link', byId[Number(toId)], patch).then(function () { return { ok: true }; });
    }
    function undo() { var c = hist.undo(); if (c) run(c, 'back'); }
    function redo() { var c = hist.redo(); if (c) run(c, 'fwd'); }
    function refuse(code) { ctx.msg(T(PLAIN[code] || code), 'errors'); say(T(PLAIN[code] || code)); }

    // ---- inline editing --------------------------------------------------------------------------------------
    function editCellAt(cellEl) {
      var i = Number(cellEl.getAttribute('data-row')), k = Number(cellEl.getAttribute('data-col')), key = COLS[k][0];
      if (!ctx.canEdit || key === 'finish') return;
      var r = rows[i], t = byId[r.id]; if (!t) return;
      var raw = key === 'name' ? t.name || '' : key === 'duration' ? (t.duration_days == null ? '' : String(t.duration_days)) : key === 'start' ? t.start_date || '' : key === 'predecessors' ? G.formatPredecessors(t) : (t.progress_pct == null ? '' : String(t.progress_pct));
      var inp = root.document.createElement('input');
      inp.className = 'g2-inp'; inp.value = raw; inp.setAttribute('aria-label', T(COLS[k][1]) + ' — #' + String(r.id));
      if (key === 'start') inp.type = 'date';
      cellEl.textContent = ''; cellEl.appendChild(inp); inp.focus(); if (inp.select) inp.select();
      var done = false;
      function finish(commit) {
        if (done) return; done = true;
        if (!commit) { paint(); focusCell(i, k); return; }
        var res = G.editCell(t, key, inp.value, { cal: cal, typed: !!ctx.typed, tasks: ctx.tasks });
        if (res.error) { refuse(res.error); paint(); focusCell(i, k); return; }
        if (!res.patch) { paint(); focusCell(i, k); return; }
        write('Edit', t, res.patch);
      }
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } ev.stopPropagation(); });
      inp.addEventListener('blur', function () { finish(true); });
    }
    function focusCell(i, k) {
      focusRow = Math.max(0, Math.min(rows.length - 1, i)); focusCol = Math.max(0, Math.min(COLS.length - 1, k));
      var tl = el.querySelector('.g2-tl');
      if (tl) { var top = focusRow * ROW_H, vh = tl.clientHeight - HEAD_H; if (top < tl.scrollTop) tl.scrollTop = top; else if (top + ROW_H > tl.scrollTop + vh) tl.scrollTop = top + ROW_H - vh; }
      paint();
      var c = el.querySelector('.g2-c[data-row="' + focusRow + '"][data-col="' + focusCol + '"]'); if (c) c.focus();
    }
    function focusBar(i) {
      focusRow = Math.max(0, Math.min(rows.length - 1, i)); var tl = el.querySelector('.g2-tl');
      if (tl) { var top = focusRow * ROW_H; if (top < tl.scrollTop || top > tl.scrollTop + tl.clientHeight - HEAD_H - ROW_H) tl.scrollTop = Math.max(0, top - 2 * ROW_H); }
      paint(); var b = el.querySelector('.g2-bar[data-row="' + focusRow + '"]'); if (b) b.focus();
    }
    function nudge(i, mode, dir) {
      var r = rows[i], t = byId[r.id]; if (!t || !ctx.canEdit || r.summary) return;
      var px = dir * G.scaleOf(zoomKey).pxPerDay;
      var bar = { start: r.start, end: r.end, milestone: r.milestone };
      // one WORKING day per key press: step calendar days until the date actually changes
      for (var step = 1; step <= 4; step++) { var p = G.dragDates(bar, px * step, zoomKey, mode, cal); if (p) return write(mode === 'resize' ? 'Resize' : 'Move', t, p); }
    }

    // ---- events ---------------------------------------------------------------------------------------------
    function wire() {
      var q = function (s) { return el.querySelector(s); };
      q('.g2-view').addEventListener('change', function (ev) { view = PREFS.view = ev.target.value; render(); });
      q('.g2-zoom').addEventListener('change', function (ev) { zoomKey = PREFS.zoom = ev.target.value; render(); });
      q('.g2-zin').addEventListener('click', function () { zoomKey = PREFS.zoom = G.zoom(zoomKey, -1); render(); });
      q('.g2-zout').addEventListener('click', function () { zoomKey = PREFS.zoom = G.zoom(zoomKey, 1); render(); });
      q('.g2-today').addEventListener('click', function () { var tl = q('.g2-tl'); if (tl && L && L.todayX != null) tl.scrollLeft = Math.max(0, L.todayX - tl.clientWidth / 3); });
      if (q('.g2-undo')) { q('.g2-undo').addEventListener('click', undo); q('.g2-redo').addEventListener('click', redo); }
      el.querySelector('.g2').addEventListener('keydown', function (ev) {
        if (!(ev.ctrlKey || ev.metaKey) || ev.target.tagName === 'INPUT') return;
        var k = ev.key.toLowerCase();
        if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); } else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); redo(); }
      });
      Array.prototype.forEach.call(el.querySelectorAll('.g2-open'), function (b) { b.addEventListener('click', function () { if (ctx.openTask) ctx.openTask(Number(b.getAttribute('data-task'))); }); });
      var tl = q('.g2-tl'); if (!tl) return;
      var gb = q('.g2-gbody');
      tl.addEventListener('scroll', function () { gb.scrollTop = tl.scrollTop; schedule(); });
      gb.addEventListener('wheel', function (ev) { if (ev.ctrlKey) return; tl.scrollTop += ev.deltaY; ev.preventDefault(); }, { passive: false });
      tl.addEventListener('wheel', function (ev) { if (!ev.ctrlKey) return; ev.preventDefault(); zoomKey = PREFS.zoom = G.zoom(zoomKey, ev.deltaY > 0 ? 1 : -1); render(); }, { passive: false });
      // grid keyboard
      gb.addEventListener('keydown', function (ev) {
        var c = ev.target.closest && ev.target.closest('.g2-c[data-row]'); if (!c || ev.target.tagName === 'INPUT') return;
        var i = Number(c.getAttribute('data-row')), k = Number(c.getAttribute('data-col'));
        var mv = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1], PageDown: [10, 0], PageUp: [-10, 0] }[ev.key];
        if (mv) { ev.preventDefault(); return focusCell(i + mv[0], k + mv[1]); }
        if (ev.key === 'Home') { ev.preventDefault(); return focusCell(ev.ctrlKey ? 0 : i, 0); }
        if (ev.key === 'End') { ev.preventDefault(); return focusCell(ev.ctrlKey ? rows.length - 1 : i, COLS.length - 1); }
        if (ev.key === 'Enter' || ev.key === 'F2') { ev.preventDefault(); if (ctx.canEdit && COLS[k][0] !== 'finish') editCellAt(c); else if (ctx.openTask) ctx.openTask(rows[i].id); }
      });
      gb.addEventListener('dblclick', function (ev) { var c = ev.target.closest && ev.target.closest('.g2-c.g2-ed'); if (c) editCellAt(c); });
      gb.addEventListener('click', function (ev) { var c = ev.target.closest && ev.target.closest('.g2-c[data-row]'); if (c && ev.target.tagName !== 'INPUT') { focusRow = Number(c.getAttribute('data-row')); focusCol = Number(c.getAttribute('data-col')); c.focus(); } });
      // timeline keyboard
      var svg = q('.g2-svg');
      svg.addEventListener('keydown', function (ev) {
        var g = ev.target.closest && ev.target.closest('.g2-bar'); if (!g) return;
        var i = Number(g.getAttribute('data-row'));
        if (ev.altKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { ev.preventDefault(); return nudge(i, ev.shiftKey ? 'resize' : 'move', ev.key === 'ArrowRight' ? 1 : -1); }
        var to = ev.key === 'ArrowDown' ? i + 1 : ev.key === 'ArrowUp' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? rows.length - 1 : null;
        if (to != null) { ev.preventDefault(); return focusBar(to); }
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (ctx.openTask) ctx.openTask(rows[i].id); }
      });
      if (!ctx.canEdit) { svg.addEventListener('click', function (ev) { var g = ev.target.closest && ev.target.closest('.g2-bar'); if (g && ctx.openTask) ctx.openTask(Number(g.getAttribute('data-task'))); }); return; }
      // pointer: move / resize / link
      svg.addEventListener('pointerdown', function (ev) {
        var g = ev.target.closest && ev.target.closest('.g2-bar'); if (!g || ev.button !== 0) return;
        var i = Number(g.getAttribute('data-row')), r = rows[i]; if (r.summary) return;
        var act = ev.target.getAttribute('data-act') || 'move';
        drag = { i: i, act: act, x0: ev.clientX, y0: ev.clientY, g: g, moved: false };
        if (svg.setPointerCapture) try { svg.setPointerCapture(ev.pointerId); } catch (_) { /* older browsers */ }
        ev.preventDefault();
      });
      svg.addEventListener('pointermove', function (ev) {
        if (!drag) return;
        var dx = ev.clientX - drag.x0; if (Math.abs(dx) > 3 || Math.abs(ev.clientY - drag.y0) > 3) drag.moved = true;
        if (drag.act === 'link') {
          var pt = svgPoint(svg, ev), b = L.bars[drag.i], line = svg.querySelector('.g2-tmp');
          if (!line) { line = root.document.createElementNS('http://www.w3.org/2000/svg', 'line'); line.setAttribute('class', 'g2-tmp'); svg.appendChild(line); }
          line.setAttribute('x1', b.x1 + 7); line.setAttribute('y1', b.y + ROW_H / 2); line.setAttribute('x2', pt.x); line.setAttribute('y2', pt.y);
        } else {
          var rect = drag.g.querySelector('.g2-fill') || drag.g.querySelector('path');
          if (drag.act === 'resize' && rect && rect.tagName === 'rect') { var bb = L.bars[drag.i]; rect.setAttribute('width', Math.max(3, bb.x1 - bb.x0 + dx)); }
          else drag.g.setAttribute('transform', 'translate(' + dx + ',0)');
          var p = G.dragDates({ start: rows[drag.i].start, end: rows[drag.i].end, milestone: rows[drag.i].milestone }, dx, zoomKey, drag.act, cal);
          say(p ? p.start_date + ' → ' + p.end_date + ' (' + p.duration_days + ' ' + T('working days') + ')' : '');
        }
      });
      function end(ev) {
        if (!drag) return; var d = drag; drag = null;
        var r = rows[d.i];
        if (!d.moved) { if (ctx.openTask) ctx.openTask(r.id); return; }
        if (d.act === 'link') {
          var tmp = svg.querySelector('.g2-tmp'); if (tmp) tmp.parentNode.removeChild(tmp);
          var target = root.document.elementFromPoint ? root.document.elementFromPoint(ev.clientX, ev.clientY) : null;
          var tg = target && target.closest ? target.closest('.g2-bar') : null; if (!tg) return;
          return linkTasks(r.id, Number(tg.getAttribute('data-task')));
        }
        moveTask(r.id, ev.clientX - d.x0, d.act).then(function (p) { if (!p) paint(); });
      }
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', function () { drag = null; paint(); });
    }
    function svgPoint(svg, ev) { var rc = svg.getBoundingClientRect(); return { x: ev.clientX - rc.left, y: ev.clientY - rc.top }; }

    render();
    return { destroy: function () { el.innerHTML = ''; }, undo: function () { var c = hist.undo(); return c ? run(c, 'back') : Promise.resolve(null); }, redo: function () { var c = hist.redo(); return c ? run(c, 'fwd') : Promise.resolve(null); }, edit: editTask, move: moveTask, link: linkTasks, history: hist };
  }
  root.GanttV2 = { mount: mount, T: T, VIEWS: VIEWS, COLS: COLS, PLAIN: PLAIN };
})(typeof window !== 'undefined' ? window : this);
