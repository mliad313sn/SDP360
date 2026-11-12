-- F1-PPM / F-PRODUCT-09 (gap E07 residue). ADDITIVE and idempotent. No row is updated.
-- portfolio_tasks.allocation_pct has DEFAULT 100 and no bound (039). The write path (services/governanceStore
-- normalise) refuses a value outside 0..100, so an out-of-range value can only be a legacy / hand-written row.
-- The CHECK is added NOT VALID (no validation of the existing rows) and ONLY when no out-of-range row exists at
-- that moment: PostgreSQL checks a CHECK on every UPDATE of a row, so adding it over a legacy row would refuse any
-- later edit of that task (status, owner, soft delete). When such rows exist the constraint is NOT added and
-- `node tools/governance/alloc-audit.js` lists them and says the constraint is absent; a person corrects the rows,
-- then runs the statement that tool prints. The column DEFAULT is left as it is (convention = PMO decision,
-- report_config ppm_alloc_unspecified).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'portfolio_tasks_allocation_pct_range'
                    AND conrelid = to_regclass(quote_ident(current_schema()) || '.portfolio_tasks'))
     AND NOT EXISTS (SELECT 1 FROM portfolio_tasks WHERE allocation_pct IS NOT NULL AND (allocation_pct < 0 OR allocation_pct > 100)) THEN
    ALTER TABLE portfolio_tasks ADD CONSTRAINT portfolio_tasks_allocation_pct_range
      CHECK (allocation_pct IS NULL OR allocation_pct BETWEEN 0 AND 100) NOT VALID;
  END IF;
END $$;
