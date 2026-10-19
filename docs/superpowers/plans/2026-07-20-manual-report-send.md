# Manual report send — pick the period + the confirmed recipients — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** From Admin → Automated Reports, send a site's coordinator report **on demand**: choose the period, preview it, pick which of that site's **already-confirmed** addresses receive it, and re-send deliberately when it was already sent — with the re-send traced in the log.

**Branch:** `feat/manual-report-send` (from `main`).

## Verified substrate (checked directly — do not re-derive)
- **The server pipeline already exists and is complete.** `POST /api/reports/send?type=coordinator&site=<CODE>[&year=&month=&kind=weekly|monthly][&preview=1][&force=1]` (`server.js:4848-4890`, `requireReportSession`+`requireAdmin`, 120 s cap ahead of the IIS 5-min ARR timeout) is a thin wrapper over `services/sendCoordinator.js sendCoordinatorReport({db, cfg, site, period, kind, force, preview, deps})`.
- Its documented contract (`sendCoordinator.js:9-15`): unresolvable site → `{skipped, reason}`; `preview` → `{preview:true, subject, html}` **before** recipient resolution, PDF and mail (no side effects); no confirmed recipient → `{skipped:true, reason:'no confirmed recipient'}`; already sent → `{skipped:true, reason:'already sent today'}`; else `{ok:true, to, cc, pdf, messageId}`.
- Recipient resolution (`sendCoordinator.js:74-85`): `D.reportDirectory.resolveFromRows(rows, site, REPORT_TYPE, {neverSendUnconfirmed: config.never_send_unconfirmed === '1'})`. `resolveFromRows` (`reportDirectory.js:57-70`) returns `null` unless the address exists AND is confirmed; `kind==='fm'` reads `fm_email`/`fm_email_confirmed`, otherwise `coordinator_email`/`coordinator_email_confirmed`; `cc` = `cc_emails` comma-split.
- Directory columns (`reportDirectory.js:7`): `site_name, coordinator_name, coordinator_email, coordinator_email_confirmed, fm_name, fm_email, fm_email_confirmed, cc_emails, active`.
- Dedup: `reportSentLog.alreadySentToday(db, REPORT_TYPE, site, period)` (db FIRST arg). Log write: `reportSentLog.record(db, {report_type, site_code, period, recipients, result})`.
- **The gap is only (a) the UI and (b) recipient CHOICE** — today the send always goes to the coordinator + every CC.

## The rule that must not break
The admin may **select among that site's already-confirmed addresses**; they may **never type a new one**. Adding an address goes through the directory (where it is confirmed). The **server is the enforcement point** — it re-validates any selection against the directory row and refuses anything else. This preserves `never_send_unconfirmed`.

---

## Task 0 — Recipient selection in the pipeline (server-side, validated)

**Files:** Modify `services/sendCoordinator.js`; Test `tests/send-coordinator-recipients.test.js`.

- [ ] **Step 1 — failing test.** Copy the DI harness from the existing sendCoordinator test (`tests/send-*.test.js` — inject `deps.reportDirectory`, `deps.reportSentLog`, `deps.buildMailer`, `deps.renderPdf` so nothing hits SMTP/Chrome). A directory row: coordinator `coord@x.com` **confirmed**, FM `fm@x.com` **confirmed**, `cc_emails: 'cc1@x.com, cc2@x.com'`. Assert `sendCoordinatorReport({…, recipients})`:
  1. **No `recipients`** → unchanged behaviour: mails `to: coord@x.com`, `cc: ['cc1@x.com','cc2@x.com']`.
  2. `recipients: {to:'fm@x.com', cc:['cc2@x.com']}` → mails exactly that (a confirmed FM + one of the CCs).
  3. `recipients: {to:'coord@x.com', cc:[]}` → mails the coordinator with **no** CC.
  4. **Rejection — an address not on the row**: `recipients:{to:'someone@else.com'}` → `{skipped:true, reason:/not a confirmed recipient/i}`, and the mailer + `record` stubs are **never called**.
  5. **Rejection — an UNCONFIRMED address on the row**: same row but `fm_email_confirmed = 0`, `recipients:{to:'fm@x.com'}` → skipped, never mailed. (The whole point: selecting it in the UI must not bypass confirmation.)
  6. **Rejection — a CC not on the row** → skipped, never mailed.
  7. `force:true` → `record` is called with `result:'resent'`; without force → `result:'sent'` (so a deliberate re-send is traceable in the log).
  Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement** in `sendCoordinatorReport`:
  - Accept an optional `recipients` param `{to?, cc?}`.
  - After the existing `resolveFromRows` gate (keep it — it still proves the site has SOME confirmed recipient), when `recipients` is supplied build the **allowed set** from the SAME directory row: the coordinator address **only if confirmed**, the FM address **only if confirmed**, plus every `cc_emails` entry. Compare case-insensitively + trimmed.
  - If `recipients.to` is absent or not in the allowed set, or any `recipients.cc` entry is not in the allowed set → return `{skipped:true, reason:'"<addr>" is not a confirmed recipient for <site>'}` **before** the PDF/mail/log steps.
  - Otherwise use `{to: recipients.to, cc: recipients.cc || []}` in place of the resolved pair.
  - `record(db, {… result: force ? 'resent' : 'sent'})`.
- [ ] **Step 4** PASS + `node --test --test-force-exit tests/send-*.test.js` green (the scheduled CLI path is unchanged when no `recipients` is passed). **Step 5 — commit:** `feat(reports): optional recipient selection, validated against the confirmed directory row`.

## Task 1 — Route passes the selection

**Files:** Modify `server.js` (`POST /api/reports/send`); Test `tests/report-send-route.smoke.test.js` (or extend an existing route smoke).

- [ ] **Step 1 — failing smoke.** Assert: `POST /api/reports/send?type=coordinator&site=<seeded>&preview=1` → 200 with `preview:true` + `subject`; posting a JSON body `{recipients:{to:'not@allowed.com'}}` (without preview) → 200 with `skipped:true` and a reason naming the address (NOT a 500); no session → 401/403; `type=bogus` → 400. Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement:** read `req.body && req.body.recipients` (the global `express.json()` already parses it — the route's "no body parser" comment is now stale, update it) and pass it through to `sendCoordinatorReport`. Everything else unchanged. **Step 4** PASS + syntax + `await-precedence` 5/5. **Step 5 — commit:** `feat(reports): /api/reports/send accepts a validated recipient selection`.

## Task 2 — The admin UI (Automated Reports → per-site Send)

**Files:** Modify `public/reports.html` (the `#ap-autoreports` card, Recipients tab). Browser-verify.

- [ ] **Step 1 — implement.** READ the Automated Reports card first (its Recipients table renders one row per site with Edit; there is a Schedule tab beside it). Add a **`Send ›`** action per site row opening a small dialog (reuse the page's existing modal + `toast()` patterns):
  - **Period**: month + year selectors (default = current month) and **kind** (weekly / monthly), mapping to the route's `year`/`month`/`kind` params.
  - **Recipients**: checkboxes built from that site's directory row — the coordinator and the FM each shown ONLY when their address is **confirmed** (an unconfirmed one is listed but **disabled**, with the reason in `title`: it must be confirmed in the directory first), plus one checkbox per CC address. A radio/primary choice picks the single **To**; the CC checkboxes pick the CCs. **No free-text field.** Disable Send until a To is chosen.
  - **Preview** button → `POST …&preview=1` → render the returned `subject` + `html` in the dialog (an iframe/srcdoc or a scrollable panel). Preview never sends.
  - **Send** button → `POST` with the selection in the JSON body. On `{ok:true}` → success toast naming the address. On `{skipped:true, reason:'already sent today'}` → show a **"Renvoyer quand même"** button that re-posts with `force=1` (this is the deliberate, traced re-send). On any other `{skipped:true}` → show the reason verbatim.
  - Keep the whole dialog admin-only (the card already is).
- [ ] **Step 2 — VERIFY IN BROWSER (mandatory).** `preview_start`, admin PG session, **restart (stop+start — `reports.html` is `_htmlCache`'d)**, open `/reports.html#admin` → Automated Reports:
  - The Send dialog opens for a site and lists ONLY that site's addresses; an unconfirmed one is visibly disabled with its reason.
  - **Preview** renders the report HTML and sends nothing (check the network + that no log row appears).
  - **Send** with a chosen To/CC returns a result; if SMTP is unreachable in dev, the failure must surface readably (that still proves the wiring — say so in the report rather than claiming a delivery).
  - A second send of the same site+period shows "already sent today" + the **Renvoyer quand même** path.
  - Zero console errors. Screenshot.
- [ ] **Step 3 — commit:** `feat(reports): manual per-site send with period + confirmed-recipient selection`.

## Task 3 — Regression + CLAUDE.md + finish
- [ ] Full `tests/send-*.test.js` + `report-*` + `await-precedence` green.
- [ ] CLAUDE.md: Current-State entry + a pitfall row — the manual send may only target addresses **present AND confirmed on that site's directory row**; the server re-validates every selection (the client is never trusted), so `never_send_unconfirmed` still holds; a re-send requires `force=1` and is logged with `result:'resent'`.
- [ ] Commit, merge to `main`, rebuild the deploy ZIP.

## Done criteria
- [ ] A selection is validated server-side against the confirmed directory row; an unconfirmed or foreign address is refused without mailing or logging.
- [ ] No-selection behaviour is byte-identical to the scheduled CLI (no regression).
- [ ] Preview has no side effects; a re-send is explicit and logged as `resent`.
- [ ] The admin can pick period + recipients per site, browser-verified.
