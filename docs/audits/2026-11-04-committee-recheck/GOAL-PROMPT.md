# /goal prompt template — plan v3 (PO-governed)

/goal — SDP360 / <ID> <title>
CONTEXT  Committee re-check of the 4 Nov 2026 report on head 367c309. Your goal row is in
  playbook-v3/PLAN-V3.md §4; the evidence and proposed fix for each finding you close are in playbook-v3/check-*.md
  (search the finding ids). Line numbers drift: locate by content.
MISSION  Close the listed findings with the smallest correct change. Defect fixes ship ON; any other user-visible
  change goes behind the switch named in your row (default = today) with a PILOT-PROFILE.md row.
METHOD   Failing test first (unit + one smoke/route test where a route changes); then code; then the neighbour suites.
DONE     Each finding id: test name proving it + file:line; evidence file docs/agent-execution/<ID>.md with a
  verdict table (finding → FIXED/PARTIAL + proof); items left for a person listed.
GUARDRAILS  .claude/rules/SDP360_BOUNDARIES.md; PostgreSQL only; no new external connector; no fabricated approval,
  production data or threshold; httpError.fail for every error response; await-precedence; no push/merge.
