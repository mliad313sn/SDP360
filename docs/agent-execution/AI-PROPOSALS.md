# AI proposals for the 113 pending human decisions — evidence

*AI work, not an independent human review. Nothing here is a decision, an approval, a signature, a production-readiness
claim or a field acceptance.*

## What was done

The owner delegated the pending human decisions to an AI agent and will review them during his final test. The
repository rule (`.claude/rules/SDP360_BOUNDARIES.md`) forbids inventing an approval, a signature, production readiness
or a field acceptance even when everything is delegated; business policies may only be PROPOSED and shadow-tested. So
the agent produced **proposals**, one per pending decision, and left every human cell empty.

| Artefact | Role |
|---|---|
| `tools/release/ai-proposals.source.js` | One proposal per item of `tools/release/business-readiness.source.js` (1:1): proposed choice (an option word for word, or "Option recommandée : …"), evidence-based justification, what to check at the final test, reversibility, optional TEST-only configuration values, risk if accepted, and the physical human / authority act still required. |
| `tools/release/ai-proposals-check.js` | Renders `docs/business-readiness/PROPOSITIONS-IA.md` (`--write`) and checks it (`--check`): coverage, option traceability, keys present in `services/reportConfig.js` DEFAULTS and accepted by their reader, no approval / signature / validation claim, freshness. |
| `tools/release/final-test-profile.js` | Merges every proposed value into `docs/business-readiness/PROFIL-TEST-FINAL.json` (conflicts are errors) and applies it to a TEST database on request. |
| `tests/ai-proposals.test.js` | 11 tests: 1:1 coverage, choice traceability, keys in DEFAULTS, no claim words, fresh document, register human cells still empty (business-readiness check), profile merge / outbound / money refusals, four-eyes classification, `--apply` refusals, dry-run default, and an end-to-end apply on the test file's own throwaway database. |

Choice rules: reversible and pilot-scoped first; least privilege; no outbound send switched on; nothing of L05 (money)
without the Finance gate; no security or audit control switched off; for production-only gates (CAB, penetration test,
signing key, RPO/RTO acceptance, legal) a value is proposed but the physical act is named in `acte_humain`. Sources: the
gate dossiers, `docs/business-readiness/PLAN-PILOTE.md`, `docs/ops/pilot/PILOT-PROFILE.md`, the P11 report rounds 6 to 9
and the round-9 seat reports (`docs/agent-execution/p11/round9-928ca8f0/`).

## The rule that prevents filling human cells

- The proposals live in their own source and their own document; `docs/business-readiness/REGISTRE-DECISIONS-HUMAINES.md`
  is not touched, and `node tools/release/business-readiness-check.js --check` still refuses any filled decision / name /
  date / signature cell (re-run by `tests/ai-proposals.test.js`).
- `tools/release/ai-proposals-check.js` refuses any proposal text containing "approuv…", "signé(e)", "validé par" or
  "accepté par".
- `tools/release/final-test-profile.js` safety design (the safest of the options considered):
  dry run by default; `--apply` refused when `NODE_ENV=production`, without `--db-url`, when the database name does not
  match `/test|tmp|qual|demo|pilot|recette/i`, or without `--i-confirm-test-database`; **four-eyes keys are never written
  by the tool, on any database, and there is no bypass flag** — they are listed and go through a Policy Center request
  approved by a second super_admin (or `activate-switches.js --apply --operator-token=env`); the profile may not switch
  ON an outbound or money switch; changes go through `reportConfig.setConfig` with actor `ai-final-test-profile`, each
  change is journalled and one `system_log` row (`ai_proposal_test_profile_applied`, "AI proposal applied for final
  test") is written. A `--throwaway` direct write of four-eyes keys was considered and rejected: it would weaken the
  guard the panel spent four rounds hardening.

## How the owner validates

1. On a TEST database: `node tools/release/final-test-profile.js --db-url=env` (plan), then
   `--apply --db-url=env --i-confirm-test-database`; switch on the five four-eyes keys through the Policy Center with a
   second super_admin.
2. Run the "À vérifier au test final" line of each proposal in `docs/business-readiness/PROPOSITIONS-IA.md`.
3. Record the outcome **himself**: either he fills his own cells in the committee copy of the register (and, for gates,
   `docs/sdp360/completion/RELEASE-GATES.md`), or he tells the AI explicitly which proposals he accepts — only then, and
   only on his explicit instruction, may an agent record "accepté par <owner> le <date>" for those lines.
4. The 40 items listed under "Actes humains ou d'autorité requis" still need the named person or body to act (CAB
   meeting, real penetration test, signing-key holder, tenant consent, legal opinion, restore drill…), whatever the
   owner accepts.
