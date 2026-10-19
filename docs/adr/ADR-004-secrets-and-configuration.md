# ADR-004 — Secrets: encrypted at rest with a mandatory key, write-only, never in a log, a URL or a package

**Status**: Accepted — implemented (Step 4, 2026-10-19) · **Author**: AI agent · **Approval**: product committee (to record)

## Context
Secrets (SMTP, Meraki, OpManager, SDP API, SSO client secret, Teams webhooks) are stored in `report_config` and therefore travel inside every `pg_dump`. v1 encrypted them only when `SDP_CONFIG_KEY` happened to be set (the key was absent in production until 2026-09-24), with a sha256-derived key.

## Decision
- A secret is a `enc:v2:` box (AES-256-GCM, key derived by **scrypt** from `SDP_CONFIG_KEY`); `v1` boxes stay readable and are re-encrypted by `tools/pg/reencrypt-secrets.js`.
- With `NODE_ENV=production` the server **refuses to start** without a key (exit code 78) unless `SDP_ALLOW_PLAINTEXT_SECRETS=1` is set knowingly.
- A secret is **write-only**: redacted on every `GET`, kept when a blank value is saved, never echoed, never logged (`_redactKeys`), never on a command line (installer: environment or stdin), never in a support bundle (keys only), never in an update package (`.env` is a protected path).
- The `.env` file is the only artefact outside the database; it is kept with the backups, because a dump restored without the same key reads its secrets as **empty**, never as plaintext.

## Consequences
- Operators: rotate with `reencrypt-secrets.js --apply` + `SDP_CONFIG_KEY_OLD`; after restoring on another machine, bring the `.env` too.
- Developers: a new secret key joins `_SECRET_BLANK_KEEP` (redact + blank-keep + super_admin gate) or it leaks — the config tests pin the list.
