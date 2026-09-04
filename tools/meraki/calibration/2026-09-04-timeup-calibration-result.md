# Meraki "% Time Up" — calibration result (2026-09-04)

**Verdict: Meraki's Summary-Report "% Time Up" ≈ per-sample rule "a loss/latency sample with
loss ≥ 5 % counts as DOWN"** (primary destination or merged — negligible difference; missing
intervals = down; no latency cap needed). Applied via config `wan_timeup_loss_pct = 5`.

Ground truth: 30 points transcribed from the Meraki UI (5 appliances × wan1/wan2 × day/week/month),
`timeup-groundtruth.csv`. Raw series archived under `series/` (Meraki keeps 31 days only).
Harness: `node tools/meraki/calibrate-timeup.js` (re-score any time with `--offline`).

| Rule | MAE (30 pts) | max | week MAE | month MAE |
|---|---|---|---|---|
| **loss ≥ 5 % = down** (calibrated) | **2.3** | 38.2 (one day point) | **0.83** | **0.80** (max 2.17) |
| loss < 100 = up (previous production rule) | 11.36 | 79.4 | — | — |

Best-rule residuals on the decisive points (Meraki → derived):
- Sabodala wan2 month 22.43 → 20.83 (−1.6) · week 20.62 → 21.33 (+0.7)
- MANA wan1 month 85.09 → 82.92 (−2.2) · week 81.4 → 80.75 (−0.7)
- Lafigue wan2 month 70.41 → 68.33 (−2.1) · week 94.65 → 88.59 (−6.1)
- Hounde / Abidjan / clean links: within ±0.3

What refuted the earlier hypotheses (same day, live data): the event-based availability
(uplink active/failed status, our poller) read **100 %** for Sabodala wan2 and MANA wan1 where
Meraki shows 22 % / 85 % — so "% Time Up" is NOT the uplink status; and loss<100 read 100 % too.

Caveats / next refinements:
- **Day windows are unreliable here**: Lafigue wan2 day (−38 pts), MANA/Sabodala wan1 day (−4/−5)
  — a rolling 24 h window is very sensitive to the exact capture instant, and "Captured At" was
  defaulted to 2026-09-04T12:00Z. Week/month carry the decision.
- Loss cap 4 vs 5 tie at grid granularity; residuals show a small negative bias on week/month →
  a finer grid (4.5–6 in 0.5 steps) once more degraded points exist may nudge it. Keep 5 for now.
- Latency cap: unidentifiable on this data (none of the points is latency-driven) → leave empty.
- Identifiability note "30 combos tie": expected — the tie is across the *irrelevant* latency /
  missing / destination axes, not across the loss cap.
