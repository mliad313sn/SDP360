# ADR — P11 round 3: identity normalisation for commitment four-eyes

- **Status:** accepted (engineering, sandbox). AI decision — not a business or InfoSec approval.
- **Date:** 2026-11-20 · **Lot:** qual/p11-fix11 (finding N-R3-1, P2; four-eyes e-mail alias, P3)

## Context
Four-eyes on commitments (`services/commitmentLifecycle.js` `isSelf`) compared free-text owner / executor / creator
values to the actor's username, full name, e-mail and id after `trim().toLowerCase()` only. An insider with verify
rights could set the owner to a value that only looks like herself — `alice<ZWSP>`, `al<Cyrillic i>ce`, `Alice␠␠A` — and
verify her own work. The store also recorded the old/new owner but not who changed it, and the reviewer set-up check
probed the raw reviewer string, so a former owner's e-mail alias was accepted as reviewer.

## Decisions
1. **Two normalised keys.** `identityKey` = NFKC, all `\p{Cf}` format characters removed (zero-width, soft hyphen,
   bidi marks), whitespace collapsed, case folded (`toUpperCase().toLowerCase()`). `skeletonKey` = `identityKey`, then
   NFD with combining marks removed and a small fixed map of Cyrillic / Greek letters that render like Latin ones.
2. **Refusal side broad, grant side strict.** `isSelf` (who may NOT verify) uses the skeleton — a false match only
   means more caution. `isReviewer` (who MAY verify) uses `identityKey` only: an invisible character cannot hide a real
   grant, but a homoglyph never creates one.
3. **The re-pointer is a past holder.** An owner / executor change records `by` (the actor) in the hash-chained event;
   `historyOf` adds it to past owners / executors (older `{from,to}` events fall back to the event's actor). This closes
   every look-alike variant the map does not know, because Alice is excluded for having made the change at all.
   Trade-off accepted: a manager who reassigns an owner can no longer verify that commitment.
4. **Aliases resolve to the account.** The reviewer value is resolved (normalised username or e-mail, single active
   account) and checked with ALL that account's identities. Unknown or ambiguous = the raw value stands.

## Not done (open)
The confusable map is deliberately small (no full Unicode TR39 table vendored). Owner values are still free text;
refusing unresolved names for high / critical commitments is a policy choice left to the closure-policy owner (D-04).
Rollback: revert the commit; no data migration (the `by` field is additive in the event JSON).
