-- Production hardening of the audit tables (committee review 2026-10-28, audit P1-2 / security rec. 4).
-- NOT applied by the application or the migrator: a DBA runs it once, as a superuser, after a backup,
-- in a change window (CAB). Today the application role OWNS its tables, so it could disable the
-- append-only triggers; after this script a separate owner holds the audit tables and the application
-- role keeps only SELECT and INSERT on them.
--
--   psql "$SUPERUSER_URL" -v app_role=sdp_app -f tools/pg/harden-audit-grants.sql
--
-- Tables: every append-only, hash-chained audit table — the SAME list as services/auditChain.js TABLES
-- (tests/audit-grants-rehearsal.test.js fails if they differ, or if the migrated schema carries a hash-chained
-- table neither lists — P11 round 3 R3-A1: the script covered 6 of 12, leaving the PPM, publication, weekly
-- submission, access-request, finance-certification and WAN-SLA claim ledgers owned by the application role).
--
-- Roll-back: ALTER TABLE <t> OWNER TO :app_role; for each table below, and
--            ALTER FUNCTION sdp_append_only() / sdp_hash_chain() / sdp_chain_payload(jsonb) OWNER TO :app_role;
-- After this script, a migration that redefines those three functions must be run by the DBA (the
-- application role can no longer replace them — which is the point: replacing the trigger function
-- would switch the append-only rule and the hash chain off without touching a trigger).
\set ON_ERROR_STOP on
SELECT set_config('sdp.audit_tables', 'governance_policy_history,handoff_events,commitment_events,closure_verifications,minutes_history,governance_role_events,ppm_events,report_publications,weekly_report_submissions,access_request_events,finance_certification_events,wan_sla_claim_events', false);
BEGIN;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sdp_audit_owner') THEN CREATE ROLE sdp_audit_owner NOLOGIN; END IF; END $$;
DO $$ DECLARE t TEXT; app TEXT := current_setting('sdp.app_role', true);
BEGIN
  FOREACH t IN ARRAY string_to_array(current_setting('sdp.audit_tables'), ',') LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I OWNER TO sdp_audit_owner', t);
  END LOOP;
  -- security review: the trigger FUNCTIONS too — an owner of sdp_append_only() could CREATE OR REPLACE it
  -- to let UPDATE/DELETE through, or empty the hash chain, without ever touching a trigger
  IF to_regprocedure('sdp_append_only()') IS NOT NULL THEN ALTER FUNCTION sdp_append_only() OWNER TO sdp_audit_owner; END IF;
  IF to_regprocedure('sdp_hash_chain()') IS NOT NULL THEN ALTER FUNCTION sdp_hash_chain() OWNER TO sdp_audit_owner; END IF;
  IF to_regprocedure('sdp_chain_payload(jsonb)') IS NOT NULL THEN ALTER FUNCTION sdp_chain_payload(jsonb) OWNER TO sdp_audit_owner; END IF;
END $$;
SELECT set_config('sdp.app_role', :'app_role', true);
DO $$ DECLARE t TEXT; app TEXT := current_setting('sdp.app_role');
BEGIN
  FOREACH t IN ARRAY string_to_array(current_setting('sdp.audit_tables'), ',') LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE ALL ON %I FROM %I', t, app);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO %I', t, app);
    -- identity sequences behind the id columns
    EXECUTE format('GRANT USAGE ON SEQUENCE %s TO %I', pg_get_serial_sequence(t, 'id'), app);
  END LOOP;
END $$;
COMMIT;
-- Check (expect only SELECT and INSERT for the application role):
SELECT table_name, privilege_type FROM information_schema.role_table_grants
 WHERE grantee = :'app_role' AND table_name = ANY (string_to_array(current_setting('sdp.audit_tables'), ','))
 ORDER BY 1, 2;
