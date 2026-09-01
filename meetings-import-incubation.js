'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Business Incubation bulk import — a sibling of meetings-import.js.
//
// Coordinators author an Incubation Follow-up Report (a fixed Word template). The
// STRUCTURED data is uploaded via a dedicated xlsx with these sheets:
//   • Session     (1 row/session)  → one md_meetings row, intake_source='business_incubation'
//   • Challenges  (N rows)         → md_issues  (the §5 "Défis & Obstacles" table)
//   • InfoFlow    (N rows)         → incubation.flow   (§3 information flow)
//   • Services    (N rows)         → incubation.services (§4 services provided)
//   • Codes       (cheat-sheet)    → reference only
//
// The §2 business description + the identification roles live in the incubation
// blob too. Everything is mapped onto the EXISTING meetings model (reuse), so an
// incubation session's challenges become the same trackable/escalatable issues as
// any PV, and it counts toward the department's engagement cadence.
//
// Async commit: meetingsDb.saveMeeting / setMeetingIncubation are Promises under
// MEETINGS_BACKEND=postgres. Callers MUST await commit(...).
// ─────────────────────────────────────────────────────────────────────────────
const XLSX = require('xlsx');

const SHEET = {
  session:    ['Session', 'Sessions', 'Identification'],
  challenges: ['Challenges', 'Defis', 'Défis', 'Issues'],
  flow:       ['InfoFlow', 'Flow', 'Information Flow', 'Flux'],
  services:   ['Services', 'Service'],
};

function _pickSheet(wb, names) {
  for (const n of names) if (wb.Sheets[n]) return wb.Sheets[n];
  // case-insensitive fallback
  const lower = {}; wb.SheetNames.forEach(s => lower[s.toLowerCase()] = s);
  for (const n of names) { const hit = lower[n.toLowerCase()]; if (hit) return wb.Sheets[hit]; }
  return null;
}
function _normHeader(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/[\s.\-/]+/g, '_'); }
function _rows(sheet) {
  if (!sheet) return [];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false });
  if (!aoa.length) return [];
  const hdr = aoa[0].map(_normHeader);
  const out = [];
  for (let i = 1; i < aoa.length; i++) {
    const arr = aoa[i];
    if (!arr || arr.every(c => c === '' || c == null)) continue;
    const row = { __row: i + 1 };
    hdr.forEach((h, c) => { if (h) row[h] = arr[c]; });
    out.push(row);
  }
  return out;
}
function _toIsoDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);            if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);  if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`; // dd/mm/yyyy
  return null;
}
function _buildRef(site, dept, iso) {
  if (!site || !dept || !iso) return '';
  return `${site}_${String(dept).replace(/\s+/g, '_')}_INC_${iso.slice(0, 7)}`;
}
function _priority(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (/haut|high|élev|elev|critique|critical/.test(s)) return 'HIGH';
  if (/bas|low|faible/.test(s)) return 'LOW';
  if (/moy|medium|normal/.test(s)) return 'MEDIUM';
  return 'MEDIUM';
}
// Map a free challenge-category label onto the meetings category codes. Coordinators
// may paste the Word labels ("Radio System", "4G Network"); an exact code wins first.
const _CAT_ALIAS = [
  [/radio|gsm|4g|lte|wan|wifi|wlan|network|réseau|reseau|internet|connect|vsat|link/i, 'CN'],
  [/server|serveur|datacenter|data center|infra|backup|vm|storage/i, 'IN'],
  [/ot|scada|plc|industrial|automat/i, 'OT'],
  [/app|erp|logiciel|software|sap|pronto/i, 'AP'],
  [/security|cyber|sécur|secur|virus|phishing/i, 'SC'],
  [/report|data|bi|dashboard|donnée|donnee/i, 'DR'],
  [/laptop|desktop|printer|imprimante|hardware|matériel|materiel|device|phone|tablet/i, 'HW'],
  [/licen|vendor|fournisseur|contract/i, 'LV'],
  [/support|helpdesk|service desk|ticket/i, 'SD'],
];
function _mapCategory(v, validSet) {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) return { code: 'CN', guessed: true };            // default; incubation challenges are usually connectivity
  if (validSet.has(raw)) return { code: raw, guessed: false };
  if (validSet.has(raw.toUpperCase())) return { code: raw.toUpperCase(), guessed: false };
  for (const [re, code] of _CAT_ALIAS) if (re.test(raw)) return { code, guessed: true };
  return { code: 'CN', guessed: true };
}
function _toBool(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'y' || s === 'yes' || s === 'true' || s === '1' || s === 'oui' || s === 'o';
}

// ── parseBuffer ──────────────────────────────────────────────────────────────
function parseBuffer(buf, lookups) {
  const errors = [], warnings = [];
  let wb;
  try { wb = XLSX.read(buf, { type: 'buffer', cellDates: false }); }
  catch (e) { errors.push({ row: 0, field: '_workbook', msg: 'Could not parse the workbook: ' + e.message }); return { sessions: [], errors, warnings, summary: { sessions: 0, challenges: 0 } }; }

  const sSheet = _pickSheet(wb, SHEET.session);
  if (!sSheet) { errors.push({ row: 0, field: '_workbook', msg: 'No "Session" tab found (accepted: ' + SHEET.session.join(', ') + ')' }); return { sessions: [], errors, warnings, summary: { sessions: 0, challenges: 0 } }; }

  const setSite = new Set((lookups.sites || []).map(x => x.code));
  const setDept = new Set((lookups.departments || []).map(x => x.code));
  const setStat = new Set((lookups.statuses || []).map(x => x.code));
  const setMst  = new Set((lookups.meeting_statuses || []).map(x => x.code));
  const setCat  = new Set((lookups.categories || []).map(x => x.code));

  const byRef = {};
  _rows(sSheet).forEach(row => {
    const rn = row.__row;
    const site = String(row.site_code || row.site || '').trim();
    const dept = String(row.department || row.dept || row.departement || '').trim();
    if (!setSite.has(site)) { errors.push({ row: rn, field: 'site_code', msg: `Unknown site_code "${site}" (see Codes tab)` }); }
    if (!setDept.has(dept)) { errors.push({ row: rn, field: 'department', msg: `Unknown department "${dept}" (see Codes tab)` }); }
    const start = _toIsoDate(row.session_start || row.session_date || row.date);
    if (!start) errors.push({ row: rn, field: 'session_start', msg: 'session_start missing / unrecognised (YYYY-MM-DD)' });
    const end = _toIsoDate(row.session_end);
    let ref = row.reference ? String(row.reference).trim() : '';
    if (!ref) ref = _buildRef(site, dept, start);
    if (!ref) return;
    if (byRef[ref]) { errors.push({ row: rn, field: 'reference', msg: `Duplicate reference "${ref}" in the workbook` }); return; }
    const status = row.status ? String(row.status).trim().toLowerCase() : 'submitted';
    if (row.status && !setMst.has(status)) warnings.push({ row: rn, field: 'status', msg: `status "${row.status}" not a known meeting_status — defaulting` });

    byRef[ref] = {
      __row: rn,
      header: {
        reference: ref, site_code: site, department: dept,
        meeting_date: start, intake_source: 'business_incubation',
        other_attendees: row.other_attendees || row.attendees || '',
        // roles → the meeting's contact fields (keeps scoring/contacts meaningful):
        //   business-side incubation manager = department_head; IT manager = site_it_lead.
        department_head: row.incubation_manager || '', department_head_title: 'Incubation Manager',
        site_it_lead: row.it_manager || '',
        next_meeting_date: _toIsoDate(row.next_session), next_meeting_location: '',
        status: setMst.has(status) ? status : 'submitted',
        // the report is signed off by the two managers → stamp both sign-offs
        dept_head_signed_at: row.incubation_manager ? '1' : null,
        site_it_signed_at:   row.it_manager ? '1' : null,
      },
      incubation: {
        roles: {
          incubator: row.incubator || '', incubator_title: row.incubator_title || '',
          incubation_manager: row.incubation_manager || '', it_manager: row.it_manager || '',
        },
        session_start: start, session_end: end, duration: String(row.duration || '').trim(),
        business_description: String(row.business_description || row.description || '').trim(),
        flow: [], services: [],
      },
      issues: [],
    };
  });

  // ── Challenges → issues ──────────────────────────────────────────────────
  const cSheet = _pickSheet(wb, SHEET.challenges);
  if (cSheet) _rows(cSheet).forEach(row => {
    const rn = row.__row;
    const ref = String(row.session_reference || row.reference || row.meeting_reference || '').trim();
    if (!ref) { errors.push({ row: rn, field: 'session_reference', msg: '[Challenges] session_reference is required' }); return; }
    if (!byRef[ref]) { errors.push({ row: rn, field: 'session_reference', msg: `[Challenges] session_reference "${ref}" not in the Session tab` }); return; }
    const title = String(row.challenge || row.title || '').trim();
    if (!title) { errors.push({ row: rn, field: 'challenge', msg: '[Challenges] challenge is required' }); return; }
    const cat = _mapCategory(row.category, setCat);
    if (cat.guessed && row.category) warnings.push({ row: rn, field: 'category', msg: `[Challenges] category "${row.category}" mapped to ${cat.code} — override with a code from the Codes tab if wrong` });
    byRef[ref].issues.push({
      ord: byRef[ref].issues.length,
      title,
      description: String(row.comment || row.description || '').trim(),
      category: cat.code,
      severity: _priority(row.priority || row.priorite || row.severity),
      champion: String(row.owner || row.responsable || row.champion || '').trim(),
      champion_email: String(row.owner_email || '').trim(),
      affects: '',
      target_date: _toIsoDate(row.timeline || row.target_date) || null,
      status: (row.status && setStat.has(String(row.status).trim().toLowerCase())) ? String(row.status).trim().toLowerCase() : 'open',
      escalate: _toBool(row.escalate),
      escalation_reason: null, council_theme: null,
      notes: '',
    });
  });

  // ── InfoFlow → incubation.flow ───────────────────────────────────────────
  const fSheet = _pickSheet(wb, SHEET.flow);
  if (fSheet) _rows(fSheet).forEach(row => {
    const ref = String(row.session_reference || row.reference || '').trim();
    if (!ref || !byRef[ref]) { if (ref) warnings.push({ row: row.__row, field: 'session_reference', msg: `[InfoFlow] "${ref}" not in the Session tab — skipped` }); return; }
    const inc = String(row.incoming || row.infos_entrantes || '').trim();
    const act = String(row.activity || row.activite || row.activité || '').trim();
    const out = String(row.outgoing || row.infos_sortantes || '').trim();
    if (inc || act || out) byRef[ref].incubation.flow.push({ incoming: inc, activity: act, outgoing: out });
  });

  // ── Services → incubation.services ───────────────────────────────────────
  const svSheet = _pickSheet(wb, SHEET.services);
  if (svSheet) _rows(svSheet).forEach(row => {
    const ref = String(row.session_reference || row.reference || '').trim();
    if (!ref || !byRef[ref]) { if (ref) warnings.push({ row: row.__row, field: 'session_reference', msg: `[Services] "${ref}" not in the Session tab — skipped` }); return; }
    const svc = String(row.service || '').trim();
    if (svc) byRef[ref].incubation.services.push({
      service: svc, beneficiary: String(row.beneficiary || row.beneficiaire || row.bénéficiaire || '').trim(),
      status: String(row.status || row.statut || '').trim(),
    });
  });

  const sessions = Object.values(byRef);
  const summary = {
    sessions: sessions.length,
    challenges: sessions.reduce((s, m) => s + m.issues.length, 0),
    by_site: {},
  };
  sessions.forEach(m => { summary.by_site[m.header.site_code] = (summary.by_site[m.header.site_code] || 0) + 1; });
  return { sessions, errors, warnings, summary };
}

// ── commit ───────────────────────────────────────────────────────────────────
async function commit(parsed, meetingsDb, opts = {}) {
  const out = { created: 0, updated: 0, skipped: 0, challenges: 0, errors: [] };
  if (!parsed || !Array.isArray(parsed.sessions)) { out.errors.push({ row: 0, msg: 'Nothing to commit (empty payload)' }); return out; }
  if (!opts.force && parsed.errors && parsed.errors.length) {
    out.errors.push({ row: 0, msg: `Refusing to commit while ${parsed.errors.length} validation errors are present. Pass force=true to skip bad rows.` });
    return out;
  }
  for (const m of parsed.sessions) {
    try {
      const state = { header: m.header, projects: [], issues: m.issues, actions: [], author_name: opts.author_name || 'incubation-import' };
      const result = await meetingsDb.saveMeeting(state, null, opts.userId || null);
      if (result.created) out.created++; else out.updated++;
      await meetingsDb.setMeetingIncubation(result.id, m.incubation);
      out.challenges += m.issues.length;
    } catch (e) {
      out.skipped++;
      out.errors.push({ row: m.__row || 0, msg: `Save failed for ${m.header.reference}: ${e.message}` });
    }
  }
  return out;
}

// ── buildTemplate ──────────────────────────────────────────────────────────
function buildTemplate(lookups) {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().slice(0, 10);
  const site = (lookups.sites && lookups.sites.find(s => s.code === 'SMI')) ? 'SMI' : ((lookups.sites && lookups.sites[0] && lookups.sites[0].code) || 'SMI');
  const dept = (lookups.departments && lookups.departments[0] && lookups.departments[0].code) || 'mining';
  const ref = _buildRef(site, dept, today);

  const sHdr = ['reference','site_code','department','session_start','session_end','duration','incubator','incubator_title','incubation_manager','it_manager','other_attendees','business_description','next_session','status'];
  const sData = [sHdr, [ref, site, dept, today, today, '2 days', 'Incubator Name', 'Business role', 'Incubation Manager Name', 'IT Manager Name', '', 'One-paragraph description of the department / occupation', '', 'submitted']];
  const s1 = XLSX.utils.aoa_to_sheet(sData); s1['!cols'] = sHdr.map(h => ({ wch: Math.max(h.length + 2, 16) })); XLSX.utils.book_append_sheet(wb, s1, 'Session');

  const cHdr = ['session_reference','ord','challenge','category','priority','owner','owner_email','comment','timeline','escalate'];
  const cData = [cHdr, [ref, 1, 'Radio coverage gap in the operational pit', 'CN', 'Haute', 'IT Team', '', 'Collect GPS coords of affected zones', '', 'N']];
  const s2 = XLSX.utils.aoa_to_sheet(cData); s2['!cols'] = cHdr.map(h => ({ wch: Math.max(h.length + 2, 14) })); XLSX.utils.book_append_sheet(wb, s2, 'Challenges');

  const fHdr = ['session_reference','ord','incoming','activity','outgoing'];
  const fData = [fHdr, [ref, 1, 'Drilling data; samples', 'Geological analysis & planning', 'Geological & block models']];
  const s3 = XLSX.utils.aoa_to_sheet(fData); s3['!cols'] = fHdr.map(h => ({ wch: Math.max(h.length + 2, 22) })); XLSX.utils.book_append_sheet(wb, s3, 'InfoFlow');

  const vHdr = ['session_reference','ord','service','beneficiary','status'];
  const vData = [vHdr, [ref, 1, 'Data Mobile', 'All departments', 'Active']];
  const s4 = XLSX.utils.aoa_to_sheet(vData); s4['!cols'] = vHdr.map(h => ({ wch: Math.max(h.length + 2, 18) })); XLSX.utils.book_append_sheet(wb, s4, 'Services');

  const codes = [['LOOKUP','CODE','NAME EN','NAME FR']];
  const grp = [['site', lookups.sites || []], ['department', lookups.departments || []], ['category', lookups.categories || []], ['priority', [{code:'Haute/High'},{code:'Moyenne/Medium'},{code:'Basse/Low'}]], ['issue_status', lookups.statuses || []], ['meeting_status', lookups.meeting_statuses || []]];
  grp.forEach(([name, list]) => { list.forEach(r => codes.push([name, r.code, r.name_en || r.name || '', r.name_fr || ''])); codes.push(['','','','']); });
  const s5 = XLSX.utils.aoa_to_sheet(codes); s5['!cols'] = [{wch:18},{wch:24},{wch:36},{wch:36}]; XLSX.utils.book_append_sheet(wb, s5, 'Codes');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parseBuffer, commit, buildTemplate, _priority, _mapCategory, _buildRef };
