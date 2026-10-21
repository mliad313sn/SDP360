'use strict';
// Preloaded into every node:test child by tools/test/run-all.js (G8.6).
// With --test-force-exit, each child process calls process.exit() as soon as
// its tests finish. On Linux a piped stdout is ASYNCHRONOUS in Node, so the
// tail of the child's serialized report was still queued when the process
// died: whole tests (sometimes half a file) vanished from the run while it
// still said "fail 0". Making stdout/stderr blocking guarantees every report
// byte is written before exit.
for (const s of [process.stdout, process.stderr]) {
  try { if (s && s._handle && typeof s._handle.setBlocking === 'function') s._handle.setBlocking(true); } catch { /* best effort */ }
}
