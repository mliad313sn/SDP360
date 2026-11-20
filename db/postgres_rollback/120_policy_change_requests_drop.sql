-- Rollback of 120_policy_change_requests.sql (manual, after policy_center_enabled = '0'). Drops the request history.
DROP TABLE IF EXISTS policy_change_requests;
