# WAN ISP outage alerting — down + recovery emails, dual-signal

**Date:** 2026-08-24 · **Branch:** `feat/wan-isp-alerts` · Status: built, tests green, NOT deployed.

## Goal
Automatic email to the **ISP** when a WAN link is down > threshold, and a **recovery** email when it
comes back — precise (down time from the event log), with the **site coordinator + service desk in cc**.

## Two signals, two jobs (user-chosen design A)
- **Poller (every 5 min, `orgUplinkStatuses`)** = fast detection + the alert **trigger** + provisional
  outage rows. Opens within ≤5 min.
- **Ingester (now every 5 min, `getNetworkEvents`, 3h lookback + nightly 3d backfill)** = Meraki's
  **authoritative event log** with exact `wan_x_down`/`wan_x_up` timestamps → **reconciles** the
  poller's rows (corrects durations, sets attribution) throughout the day, not only overnight.
- So: **poller = WHEN to alert (fast); event log = the exact times in the email**.

## The rule (user-confirmed)
**Never email an ISP for a SITE/power outage.** If BOTH uplinks of a device are down at once, it's a
box/power fault, not the operator → no ISP email (`wanAlert.isSiteOutage`). A genuine single-uplink
ISP outage still alerts.

## Emails
- **DOWN**: single-uplink outage open ≥ `trigger_minutes` (15), not yet notified. To = circuit ISP;
  cc = coordinator (`resolveFromRows`, confirmed only) + service desk. HTML body (site NAME, ISP,
  circuit, uplink, down-since exact, duration). Stamps `notified_at` → sent once.
- **RECOVERY**: on close, ONLY if a down email was sent (`notified_at != null`). Total duration.

## Design
- **Pure `services/wanAlert.js`** — `isSiteOutage`, `alertRecipients` (dedup, cc≠to), `humanDuration`,
  `buildDownEmail`/`buildRecoveryEmail` (HTML). No I/O; fully unit-tested.
- **`tools/meraki/poll-wan-outages.js`** — pre-resolves site name/code maps + directory rows
  (best-effort), a `_sendAlert('down'|'recovery', row)` helper; down block + recovery-on-close wired.
  Fixes a latent bug: the old notification passed `text`, which `mailer.send` (html-only) ignored.
- **`services/slaWanConfig.js`** `notify` gains `recovery_enabled:true`, `cc_coordinator:true`,
  `servicedesk_email:'oneitsupport@endeavourmining.com'`. Still **armed OFF** (`enabled:false`).
- **`server.js`** — added a `*/5` ingester cron (3h `since`), kept the `25 5` nightly backfill.

## Safety / non-goals
- Armed OFF by default; per-circuit `isp_notify_email` required (no ISP contact → no email).
- Send once (down), recovery only if down was sent, never after restore, never for site outages.
- Recipients: ISP (circuit) + confirmed coordinator (directory) + service desk. No free-text.
- Config UI not added (edited via the existing super_admin `/sla/config` JSON PUT) — possible follow-up.

## Tests
- `tests/wan-alert.test.js` (5) — pure logic. `tests/wan-outage-poller.test.js` (+3) — cc/html,
  both-down suppression, recovery-when-notified. sqlite-pinned, regression green (goldens + await).
