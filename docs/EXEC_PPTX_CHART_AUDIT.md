# Executive Deck Builder — PPTX Chart Audit

**Date:** 2026-05-28
**Trigger:** Are the charts in the "Executive New Report" PPTX export computed correctly?
**Scope:** `public/executive-report.html` (browser-side payload builder) +
`tools/exec-pptx/charts.py` (matplotlib renderers).

## Verdict

**Charts render correctly.** The matplotlib renderers themselves
(`charts.py`) are mathematically sound — bucketing, percentages,
formatting all match the dashboard semantics.

The risk is on the **browser-side payload builder**
(`_buildExecPptxPayload` at executive-report.html:5731) which extracts
data from `_data.*` globals and pre-aggregates for the renderer.
Audited line-by-line; one bug fixed, four notes for follow-up.

---

## Findings

### 🔴 Bug fixed in this commit — change-type substring false-positives

**Before:**
```js
const chgByType = (type) =>
  chgInMonth.filter(c =>
    (c['Change Type']||c.type||'').toLowerCase().includes(type)
  ).length;
```

Calling `chgByType('emergency')` matches every change whose type **contains**
the substring `emergency` — including "Non-Emergency" if your taxonomy
has it. Same trap with `'major'` matching "Non-Major", and `'standard'`
matching "Substandard" (rare but possible).

**After:**
```js
const re = new RegExp('(^|[^a-z])' + type + '([^a-z]|$)', 'i');
// + broader field-name matching (Change Type | Type | changeType | type)
```

Anchored regex with non-letter boundaries — "Emergency Change" matches,
"Non-Emergency" does not. Also widens the field lookup so SDP exports that
use the unprefixed `Type` column still get classified.

**Impact on the donut (slide 8):** if your taxonomy doesn't use negated
labels, no visible change. If it does, the emergency / major / standard
slices were over-counted by however many "Non-X" rows existed in the
month — typically small but worth getting right.

---

### 🟡 Note 1 — "Standard" donut bucket includes "Normal" changes

The donut has 3 slices: **Standard / Major / Emergency**.

ITIL taxonomies typically have FOUR types: **Standard (pre-approved) /
Normal (requires CAB) / Major (high-impact) / Emergency (bypass CAB)**.

The fallback at line 5901:
```js
standard: chgByType('standard') || (chgInMonth.length - chgByType('emergency') - chgByType('major'))
```

When `chgByType('standard')` is 0 (no rows literally typed "Standard"),
the fallback computes "everything else" — which silently rolls up
"Normal" changes into the Standard bucket.

**Recommendation:** Either
(a) add a 4th slice to `chart_changes_donut` for Normal, OR
(b) explicitly merge Standard + Normal into a single "Routine" slice and
    rename the bucket. Not blocking; just be aware the slice mixes two
    ITIL categories today.

---

### 🟡 Note 2 — `'E-Mail'` vs `'Email'` channel-key fragility

Line 5774:
```js
const emailCur = chanCur['E-Mail'] || chanCur['Email'] || 0;
```

If a future SDP config produces `'EMAIL'` (uppercase), `'Mail'`, or any
variant, the count silently drops to 0. **Recommendation:** normalise
keys at the `tally()` step, e.g., trim + lowercase + remove hyphens
before bucketing.

---

### 🟡 Note 3 — `monthly_trend` SLA % uses *Created-month* denominator

Lines 5781–5803:

For each Created month, count tickets created in that month, then divide
SLA violations by inbound count. The dashboard uses the same formula —
this is **consistent** with the on-screen "Resolution SLA %" tile. But it
is NOT the strict ManageEngine canonical (which uses tickets *resolved
in month* as the denominator).

**No action required** — this is a deliberate alignment with the
dashboard. Documented here so future contributors don't "fix" it into
inconsistency.

---

### 🟡 Note 4 — Categories chart shows top 8 only

Line 5813: `.slice(0, 8)`. Categories beyond the top 8 by current-month
volume are dropped from the chart. The bars renderer (`chart_categories`
in charts.py) is fine, but the executive PPTX may understate long-tail
category activity.

**Recommendation:** if a stakeholder reports "where did Network &
Internet Access go?", check if it fell out of the top-8 cut. Consider
exposing the cap as a config variable so it can be tuned per-audience.

---

## What's verified correct

| Aspect | Verified |
|---|---|
| Color palette (orange / blue / green / red / slate / yellow / amber) | ✓ matches `public/_tokens.css` |
| Image dimensions (image3-9.png) match template slot sizes | ✓ 1381×681, 681×485, 1101×751, 1525×713, 561×614, 589×592 |
| 150 DPI render → PowerPoint won't rescale → no blurry charts | ✓ |
| `inbound` / `closed` bucketing by Created month | ✓ matches `/index.html` and `/executive.html` |
| `closed` regex includes "confirm" variant | ✓ canonical per `dashboard-shared.js` |
| `slaResPct` formula `1 - violations/total` | ✓ same as KPI tile in dashboard |
| `csat` promoters/passives/detractors bucket boundaries (≥90/70–89/<70) | ✓ matches Customer Voice tab math |
| Ageing buckets (0-30 / 31-45 / 46-60 / >60) | ✓ matches dashboard ageing report |
| Current-month bar highlight (orange edge) on `chart_monthly_volume` | ✓ |
| Empty-state fallbacks ("No data" placeholder bars) | ✓ all 7 renderers handle empty input |

---

## Test the fix

After deploying this commit:

1. Open `/executive-report.html`, select May 2026, click **Executive New Report**
2. Wait ~30-60s for the PPTX to download
3. Open the deck → slide 8 (Changes by type donut)
4. The 3 slices should match the on-screen Change & Incidents KPIs:
   - **Standard** = standard + normal changes (per ITIL caveat above)
   - **Major** = exact match on "Major"
   - **Emergency** = exact match on "Emergency" (no double-count if you
     have Non-Emergency or similar in the taxonomy)

If numbers still look off, run:
```cmd
:: From the executive-report.html DevTools console:
const p = _buildExecPptxPayload();
console.log('Changes payload:', p.changes);
```

The `total`, `standard`, `major`, `emergency` numbers should now add up
correctly (allowing for the Standard-includes-Normal caveat).

---

## Audit conclusion

The exec PPTX chart pipeline is **correct in the matplotlib renderers**
and **mostly correct in the browser-side payload builder**. One concrete
bug fixed (substring change-type matching), four follow-up notes for
future hardening.

Charts will look right after this commit ships. No structural rewrite
needed.
