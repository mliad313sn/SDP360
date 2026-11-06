-- E-S03 (audit S-05) — access recertification campaigns. A super_admin opens a campaign (all sites or one site);
-- every in-scope account × role (kind 'role') and account × site (kind 'site') becomes a review line, assigned to
-- the approver resolved by the R7 rule (services/accessApproverPolicy.js), never the subject. The approver answers
-- keep / revoke / unknown with a reason. A revoke answer is RECORDED ONLY while report_config access_recert_apply
-- = '0'; at '1' it is applied through the role-change path (rdb.updateUser) with a system_log identity row.
-- Nothing auto-revokes. Behind access_recert_enabled (default '0'). Nothing is deleted. ADDITIVE and idempotent.
CREATE TABLE IF NOT EXISTS access_recert_campaigns (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  scope_site_id INTEGER,                 -- NULL = every site
  status TEXT NOT NULL DEFAULT 'open',
  orphan_days INTEGER,                   -- N used for the "no login for N days" orphan list when opened
  opened_by INTEGER NOT NULL,
  opened_at TEXT NOT NULL,
  closed_by INTEGER, closed_at TEXT,
  CONSTRAINT access_recert_campaigns_status CHECK (status IN ('open', 'closed')));
CREATE TABLE IF NOT EXISTS access_recert_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES access_recert_campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                    -- role | site
  user_id INTEGER NOT NULL,
  role TEXT,                             -- kind role
  site_id INTEGER,                       -- kind site (or the scope site of a role line)
  approver_user_id INTEGER,              -- NULL = no eligible approver found (UNKNOWN; a super_admin decides)
  answer TEXT,                           -- NULL until answered
  reason TEXT,
  answered_by INTEGER, answered_at TEXT,
  applied_by INTEGER, applied_at TEXT,   -- only when access_recert_apply = '1' and answer = revoke
  CONSTRAINT access_recert_lines_kind CHECK (kind IN ('role', 'site')),
  CONSTRAINT access_recert_lines_answer CHECK (answer IS NULL OR answer IN ('keep', 'revoke', 'unknown')),
  CONSTRAINT access_recert_lines_not_self CHECK (approver_user_id IS NULL OR approver_user_id <> user_id),
  CONSTRAINT access_recert_lines_answer_not_self CHECK (answered_by IS NULL OR answered_by <> user_id));
CREATE UNIQUE INDEX IF NOT EXISTS uq_access_recert_line ON access_recert_lines(campaign_id, kind, user_id, COALESCE(role, ''), COALESCE(site_id, -1));
CREATE INDEX IF NOT EXISTS idx_access_recert_lines_campaign ON access_recert_lines(campaign_id, answer);
