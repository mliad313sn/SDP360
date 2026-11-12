-- G1-SYNC (plan F, R8 holes 1-3) — fenced sync lease.
-- Every lock row carries a random lease token. acquireLock takes / steals the lock in ONE statement
-- (INSERT … ON CONFLICT DO UPDATE … WHERE stale RETURNING token), releaseLock deletes only its own token,
-- and a run checks its token before every write batch, so a run that lost its lease stops writing.
-- Idempotent. Rows written before this column existed have token NULL: they are treated as a plain lock
-- (fresh → refused, stale → stolen) and released by nobody but a steal.
ALTER TABLE sync_locks ADD COLUMN IF NOT EXISTS token TEXT;
