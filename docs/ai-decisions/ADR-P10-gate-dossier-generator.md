# ADR-P10 — Gate dossiers generated from one source, freshness by content hash

Status: accepted (engineering, reversible) · AI decision, sandbox only.

## Context
RELEASE-GATES.md lists 21 human gates; approvers need one dossier each, in French and English, that a new SHA can
regenerate, and a test that fails when a dossier cites evidence older than the tree.

## Decision
- One JS source (`tools/release/gate-dossiers.source.js`) holds both languages per gate; the renderer is pure
  (source + manifest → Markdown).
- Freshness = content hash (sha256, CRLF-normalised) of every cited file recorded in a manifest at generation time.
  Git commit/date are captured into the manifest for the reader but never used by the check, so it works on a shallow
  CI clone and in a merge where the dossier commit and the evidence commit differ.
- Parallel-lot evidence is declared as a glob; a newly matching file makes the dossiers stale and is then cited with
  its hash.
- The generator refuses a missing cited file and a RELEASE-GATES row without a dossier. It never writes a decision,
  name, approval date, threshold or signature.

## Alternatives rejected
- Comparing git commit ancestry only: breaks on shallow clones and when evidence and dossier land in one commit.
- Re-rendering with live git dates in the test: non-deterministic across clones.

## Consequences
Every merge that touches a cited file turns `tests/gate-dossiers.test.js` red until `node tools/release/gate-dossiers.js
--sha=<sha>` is run. That is the intended signal. Revert = delete the four paths listed in P10-gate-dossiers.md.
