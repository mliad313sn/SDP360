# Chunk 4D-2d — survey / Customer-Voice → PostgreSQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork 3 read-only survey/Customer-Voice aggregate readers in `reports-db.js` to PostgreSQL behind `REPORTS_BACKEND=postgres`, preserving KPI math byte-for-byte; default backend stays sqlite (synchronous returns), prod untouched. Completes the entire 4D-2 KPI-aggregate half.

**Architecture:** Each fn gets `if (REPORTS_BACKEND === 'postgres') return _fnPg(...)` first; the sqlite body stays synchronous; a new `async _fnPg` queries `pgHandle()` with the dialect-reconciled SQL and reuses the post-query JS (extracted to a shared `_assemble*` helper). Tests accrete into `tests/pg-reports-aggregates.test.js`.

**Tech Stack:** Node.js, `services/pgDb.js` async adapter, local PostgreSQL 17 (`PG_ADMIN_URL`), `node:test`, better-sqlite3 (sqlite default).

**Spec:** `docs/superpowers/specs/2026-06-26-pg-reports-agg-survey-design.md` (reviewed ✅).

**Dialect cheat-sheet (from the reviewed spec):**
- `strftime('%Y-%m', x)` → `to_char(x::timestamptz,'YYYY-MM')`. **getCustomerVoiceDB** monthlyRows bucket is `COALESCE(survey_sent_on,survey_responded_on)` — its `WHERE COALESCE(...) >= ?` self-guarantees a valid timestamp → **direct cast, no NULLIF**. **getSurveyMetrics** monthly bucket is `survey_sent_on` — its WHERE (`1=1 [AND survey_sent_on>=?]`) lets NULL/'' survive when `since` is absent → **`NULLIF(survey_sent_on,'')::timestamptz`**.
- `ROUND(AVG(overall_score),1)` → `ROUND(AVG(overall_score)::numeric,1)` (overall_score is `double precision`; PG has no round(double,int)). Two such in **getSurveyMetrics** (avgScore + monthly avg_score). **getCustomerVoiceDB has NONE** (all averaging via JS Math.round over raw AVG — no cast).
- raw ISO cutoff bounds (`COALESCE(...) >= ?`, `survey_sent_on >= ?`) → UNCHANGED (lexical TEXT).
- `LEFT JOIN`, `COALESCE`, `SUM(CASE…)`, `GROUP BY <alias>`, bare-alias `ORDER BY month DESC`, dynamic `${where}` → unchanged.
- pg forks query `pgHandle()`, NEVER `db`. Object-arg fn (getSurveyMetrics) destructures identically in both branches.

**Test builder to add** (copy from `tests/pg-reports-hot.test.js:32`, place near `_chg`/`_cab`):
```js
const _sres = o => ({ result_id:null, response_id:null, survey_id:null, survey_name:null,
  request_id:null, request_display_id:null, change_id:null, user_id:null, overall_score:null,
  survey_sent_on:null, survey_responded_on:null, ...o });
```

---

### Task 1: Survey metric bundles — getSurveyMetrics · getCustomerVoiceDB

**Files:**
- Modify: `reports-db.js` (`getSurveyMetrics` ~4685, `getCustomerVoiceDB` ~2519)
- Test: `tests/pg-reports-aggregates.test.js` (add `_sres` builder + one test)

- [ ] **Step 1: Add the `_sres` builder** near `_chg`/`_cab`. Then write the failing test:

```js
test('agg pg: getSurveyMetrics + getCustomerVoiceDB (to_char, ROUND ::numeric, NULLIF, CSAT/NPS)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    // getSurveyMetrics: 4 scored (95,70,50,85) + 1 unscored; 3 responded. month 2026-05.
    await rdb.upsertSurveyResultBatch([
      _sres({result_id:'M1',overall_score:95,survey_sent_on:'2026-05-10 09:00:00',survey_responded_on:'2026-05-10 10:00:00'}),
      _sres({result_id:'M2',overall_score:70,survey_sent_on:'2026-05-10 09:00:00',survey_responded_on:'2026-05-10 10:00:00'}),
      _sres({result_id:'M3',overall_score:50,survey_sent_on:'2026-05-10 09:00:00',survey_responded_on:'2026-05-10 10:00:00'}),
      _sres({result_id:'M4',overall_score:85,survey_sent_on:'2026-05-10 09:00:00'}),
      _sres({result_id:'M5',survey_sent_on:'2026-05-10 09:00:00'}),
    ]);
    const sm = await rdb.getSurveyMetrics({});
    assert.equal(sm.total_sent, 5);
    assert.equal(sm.responded_count, 3);
    assert.equal(sm.response_rate_pct, 60, 'round(3/5*100,1)');
    assert.equal(sm.avg_score, 75, 'ROUND(AVG(95,70,50,85)::numeric,1)=75');
    assert.equal(sm.satisfied_count, 2);     // 95,85 ≥80
    assert.equal(sm.neutral_count, 1);       // 70 in 60-80
    assert.equal(sm.dissatisfied_count, 1);  // 50 <60
    const mm = sm.monthly_trend.find(r => r.month === '2026-05');
    assert.ok(mm, 'monthly row'); assert.equal(mm.avg_score, 75); assert.equal(mm.sent_count, 5); assert.equal(mm.responded_count, 3);

    // getCustomerVoiceDB: 4 scored (95,75,50,95) + 1 sent-only. month 2026-06 → 'Jun 2026'.
    await rdb.upsertSurveyResultBatch([
      _sres({result_id:'V1',overall_score:95,survey_sent_on:'2026-06-10 09:00:00',survey_responded_on:'2026-06-10 10:00:00'}),
      _sres({result_id:'V2',overall_score:75,survey_sent_on:'2026-06-10 09:00:00',survey_responded_on:'2026-06-10 10:00:00'}),
      _sres({result_id:'V3',overall_score:50,survey_sent_on:'2026-06-10 09:00:00',survey_responded_on:'2026-06-10 10:00:00'}),
      _sres({result_id:'V4',overall_score:95,survey_sent_on:'2026-06-10 09:00:00',survey_responded_on:'2026-06-10 10:00:00'}),
      _sres({result_id:'V5',survey_sent_on:'2026-06-10 09:00:00'}),
    ]);
    const cv = await rdb.getCustomerVoiceDB();
    // tot is over ALL scored rows (incl the May ones): scored = M1-M4 (4) + V1-V4 (4) = 8.
    // Promoters(≥90): M1(95),V1(95),V4(95)=3; passives(70-89): M2(70),M4(85),V2(75)=3; detractors(<70): M3(50),V3(50)=2.
    assert.equal(cv.promoters, 3); assert.equal(cv.passives, 3); assert.equal(cv.detractors, 2);
    assert.equal(cv.totalResponses, 8, 'scored rows');
    // satisfied(≥80): M1(95),M4(85),V1(95),V4(95)=4 → csatPct round(4/8*100)=50
    assert.equal(cv.csatPct, 50);
    // nps round((3/8 - 2/8)*100)=round(12.5)=13
    assert.equal(cv.nps, 13);
    // sendCounts over the 12-mo window: all 10 rows (5 May + 5 Jun) → totalSent=10, totalResponded=7
    assert.equal(cv.totalSent, 10); assert.equal(cv.totalResponded, 7);
    assert.equal(cv.responseRate, 70, 'round(7/10*100)');
    assert.ok(cv.byMonth.find(r => r.month === 'Jun 2026'), 'byMonth Jun 2026');
    assert.ok(cv.byMonth.find(r => r.month === 'May 2026'), 'byMonth May 2026');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

> NOTE: getCustomerVoiceDB's `tot` query (CSAT/NPS source) has **no cutoff** (`WHERE overall_score IS NOT NULL`), so it aggregates BOTH the May and Jun seeds — the numbers above account for all 8 scored rows. `sendCounts`/`monthlyRows` DO use the 12-month cutoff, which includes both months (today is 2026-06-26).

- [ ] **Step 2: Run red** — `PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres' node --test --test-force-exit --test-name-pattern="getSurveyMetrics" tests/pg-reports-aggregates.test.js` → FAILS.

- [ ] **Step 3: Implement both forks.** Add the dispatch line + an `async _fnPg` awaiting each `.get`/`.all` against `pgHandle()`, applying:
  - **getSurveyMetrics**: `since` bound (survey_sent_on>=?) UNCHANGED; `ROUND(AVG(overall_score)::numeric, 1)`; monthly `to_char(NULLIF(survey_sent_on,'')::timestamptz,'YYYY-MM') as month` + `ROUND(AVG(CASE WHEN overall_score IS NOT NULL THEN overall_score END)::numeric, 1) as avg_score`, `GROUP BY month ORDER BY month DESC LIMIT 12`. Extract `_assembleSurveyMetrics({total, responded, avgScore, buckets, monthly})` (the `responseRatePct` toFixed + `monthly.reverse()` JS).
  - **getCustomerVoiceDB**: raw ISO cutoff (COALESCE(...) >= ?) UNCHANGED (sendCounts + monthlyRows); monthlyRows `to_char(COALESCE(survey_sent_on, survey_responded_on)::timestamptz,'YYYY-MM') as yyyymm` (DIRECT cast, no NULLIF); NO SQL ROUND (JS Math.round). Extract `_assembleCustomerVoice({sendCounts, tot, monthlyRows})` (the byMonth map + return).

- [ ] **Step 4: Run green** — PASSES.

- [ ] **Step 5: Commit** — `feat(pg-reports-agg-survey): getSurveyMetrics + getCustomerVoiceDB forks (TDD; to_char NULLIF-guard vs direct, ROUND(AVG::numeric), CSAT/NPS, raw-ISO cutoffs unchanged)`

---

### Task 2: Dimension join — getCustomerVoiceByDimensionDB

**Files:**
- Modify: `reports-db.js` (`getCustomerVoiceByDimensionDB` ~3235)
- Test: `tests/pg-reports-aggregates.test.js` (one test)

- [ ] **Step 1: Write the failing test:**

```js
test('agg pg: getCustomerVoiceByDimensionDB (LEFT JOIN + dimensions)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    await rdb.upsertRequestBatch([
      _req({request_id:'R1',display_id:'#REQ-1',technician:'Tina',site:'Hounde',tech_group:'Hounde IT Agents',pending_status:0}),
    ]);
    await rdb.upsertSurveyResultBatch([
      _sres({result_id:'SR1',request_display_id:'#REQ-1',overall_score:90,survey_responded_on:'2026-06-10 10:00:00'}),
      _sres({result_id:'SR2',request_display_id:'#NOPE',overall_score:60,survey_responded_on:'2026-06-10 10:00:00'}),
    ]);
    const cv = await rdb.getCustomerVoiceByDimensionDB();
    assert.equal(cv.totalSurvey, 2, 'both scored rows');
    assert.equal(cv.totalJoined, 1, 'only SR1 joins a request');
    assert.equal(cv.joinRate, 50);
    assert.equal(cv.closedCount, 1, 'R1 pending_status=0');
    const s = cv.bySite.find(r => r.site === 'Hounde');
    assert.ok(s, 'Hounde site dimension'); assert.equal(s.responses, 1); assert.equal(s.csatPct, 100); // 90 ≥80
    assert.ok(cv.byGroup.find(r => r.group === 'Hounde IT Agents'), 'group dim');
    assert.ok(cv.byTech.find(r => r.name === 'Tina'), 'tech dim');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run red** — FAILS.
- [ ] **Step 3: Implement** the fork: add the dispatch line + `async _fnPg` awaiting BOTH queries (the survey⨝request `LEFT JOIN` + the closed-count) against `pgHandle()`. No dialect rewrite needed in the SQL (no strftime/julianday/datetime/ROUND). Extract the entire post-query JS (`monthLbl`, `_acc`, techMap/siteMap/groupMap, `toArr`, return) into a shared `_assembleCustomerVoiceByDimension(rows, closedRow)` reused by both branches.
- [ ] **Step 4: Run green** — PASSES.
- [ ] **Step 5: Commit** — `feat(pg-reports-agg-survey): getCustomerVoiceByDimensionDB fork (TDD; LEFT JOIN survey→request, all-JS dimension aggregation, shared assembler)`

---

### Task 3: Suite green + regression + sqlite sync smoke + README + finish-branch

**Files:**
- Modify: `tools/pg/README.md` (add 4D-2d section)

- [ ] **Step 1: Full 4D-2 suite green** — `tests/pg-reports-aggregates.test.js` → all pass (4D-2a 6 + 4D-2b 3 + 4D-2c 2 + 4D-2d 2 = 13).
- [ ] **Step 2: Full reports.db pg regression** — auth/config/reports/hot/aggregates → 8+6+6+4+13 green.
- [ ] **Step 3: sqlite synchronous-return smoke** — extend the throwaway smoke to assert the 3 new fns (`getSurveyMetrics({})`, `getCustomerVoiceDB()`, `getCustomerVoiceByDimensionDB()`) are NOT `instanceof Promise` under sqlite.
- [ ] **Step 4: `node --check reports-db.js`** clean.
- [ ] **Step 5: README** — add `## reports.db — Sub-chunk 4D-2d` to `tools/pg/README.md`: the 3 fns, the to_char direct-vs-NULLIF asymmetry, the ROUND(AVG(double))::numeric (getSurveyMetrics only), the LEFT JOIN + all-JS dimension aggregation, raw-ISO cutoffs unchanged. **Update the DEFERRED block: 4D-2 is now COMPLETE; remaining = 4D-wiring + 4B-RR + KPI reconciliation.**
- [ ] **Step 6: Commit + finish-branch:**

```bash
git add tools/pg/README.md && git commit -m "feat(pg-reports-agg-survey): suite green + sqlite sync smoke + README 4D-2d section (4D-2 COMPLETE)"
git checkout main && git merge --no-ff feat/pg-reports-agg-survey -m "merge: pg reports.db survey/Customer-Voice readers (Chunk 4D-2d) behind REPORTS_BACKEND — 4D-2 KPI-aggregate half COMPLETE"
```

- [ ] **Step 7: Post-merge sanity** — on main, `node --check reports-db.js` + re-run `tests/pg-reports-aggregates.test.js` (13 green). Update the migration memory (`project_pg_migration_chunk1_done.md` + index): mark 4D-2d merged + **4D-2 COMPLETE**; remaining = 4D-wiring + 4B-RR.

---

## Remember
- pg forks query `pgHandle()`, NEVER `db`.
- Keep the sqlite body untouched and synchronous; only the pg branch is async.
- Reuse the post-query JS — extract a shared `_assemble*` helper for each (the bodies are non-trivial).
- getCustomerVoiceDB: direct `::timestamptz` cast (WHERE self-guards); getSurveyMetrics: NULLIF guard. Don't mix them up.
- getCustomerVoiceDB's `tot` (CSAT/NPS) has NO cutoff — tests must account for cross-month accumulation.
- DRY, YAGNI, TDD, frequent commits.
