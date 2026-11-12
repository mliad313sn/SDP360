-- F-PRODUCT-05 (committee 12 Nov 2026, finding N9) — department crosswalk between the two department vocabularies:
-- md_departments.code (meetings / PV, 15 codes) and action_departments.name (report actions, handoffs, 10 names).
-- ADDITIVE and idempotent. READ-ONLY reference data: nothing renames a stored label, no user gets a department.
-- Only exact / obvious pairs are seeded, all 'proposed' (the mapping is approved by people — HR / department heads
-- + Group IT). Every other value is seeded alone ('unmapped', the other side NULL) and is never merged by the code.
-- Read only while report_config department_rollup_enabled = '1' (roll-up) or by the admin list / the --check tool.
CREATE TABLE IF NOT EXISTS department_crosswalk (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  md_code                TEXT,
  action_department_name TEXT,
  status                 TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'unmapped')),
  note                   TEXT,
  created_at             TIMESTAMPTZ DEFAULT now(),
  CHECK (md_code IS NOT NULL OR action_department_name IS NOT NULL),
  CHECK (status = 'unmapped' OR (md_code IS NOT NULL AND action_department_name IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_department_crosswalk_md ON department_crosswalk(md_code) WHERE md_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_department_crosswalk_action ON department_crosswalk(lower(action_department_name)) WHERE action_department_name IS NOT NULL;

INSERT INTO department_crosswalk (md_code, action_department_name, status, note)
SELECT v.md_code, v.action_name, v.status, v.note FROM (VALUES
  ('mining',       'Mining',       'proposed', 'exact label'),
  ('maintenance',  'Maintenance',  'proposed', 'exact label'),
  ('supply_chain', 'Supply Chain', 'proposed', 'exact label'),
  ('finance',      'Finance',      'proposed', 'exact label'),
  ('security',     'Security',     'proposed', 'exact label'),
  ('mobile_maint', NULL, 'unmapped', NULL),
  ('process',      NULL, 'unmapped', 'not merged with "Processing": Process and Mill / Plant are two meeting departments'),
  ('mill',         NULL, 'unmapped', 'not merged with "Processing": Process and Mill / Plant are two meeting departments'),
  ('geology',      NULL, 'unmapped', NULL),
  ('survey_dept',  NULL, 'unmapped', NULL),
  ('hse',          NULL, 'unmapped', NULL),
  ('engineering',  NULL, 'unmapped', NULL),
  ('hr',           NULL, 'unmapped', 'not merged with "Human Resource": to be confirmed by HR'),
  ('exploration',  NULL, 'unmapped', NULL),
  ('other_dept',   NULL, 'unmapped', NULL),
  (NULL, 'Technical Service',  'unmapped', NULL),
  (NULL, 'Processing',         'unmapped', 'not merged with Process or Mill / Plant'),
  (NULL, 'Human Resource',     'unmapped', 'not merged with "HR": to be confirmed by HR'),
  (NULL, 'Social performance', 'unmapped', NULL),
  (NULL, 'General Manager',    'unmapped', NULL)
) AS v(md_code, action_name, status, note)
WHERE NOT EXISTS (SELECT 1 FROM department_crosswalk);
