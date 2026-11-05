-- C-21 (G45 · A04) — scoped deputies. A deputy row may be limited to a set of sites and to a set of
-- duty families / governance roles / registers, inside its existing date window (start_date … end_date).
--   scope_site_ids  JSON array of site ids, e.g. [3,7]                 NULL = every site (the behaviour until now)
--   scope_roles     JSON array of tokens: a governance role key (handoffs.escalation_target), a register
--                   (handoffs | commitments | shift_handovers | meetings) or a duty family (site-it-support,
--                   network-oncall)                                    NULL = every role (the behaviour until now)
-- A scoped deputy counts only when the item in hand matches its scope (services/governanceRoles.deputyInScope);
-- with no context to compare against, a scoped deputy does not count (fail closed). ADDITIVE and idempotent.
ALTER TABLE deputies ADD COLUMN IF NOT EXISTS scope_site_ids TEXT;
ALTER TABLE deputies ADD COLUMN IF NOT EXISTS scope_roles TEXT;
