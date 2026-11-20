'use strict';
// P11 r6 O-1 — child process of services/blobBackup.js runWorker(): runs ONE heavy backup step with the synchronous
// engine, away from the web server's event loop, then exits.
//
//   stdin  : one JSON object { op, args, keyHex }  (the derived backup key travels here, never on a command line)
//   stdout : one JSON object { ok:true, result } | { ok:false, error:{ message, transient, code, file } }
//
// ops: backup-store (archive + verify the file store), pack-dump (gzip + encrypt a plain pg_dump file),
//      drill-files (the restore drill's live listing, hashes and archive read-back).
const BB = require('./blobBackup');
const B = require('./backup');

function run({ op, args = {} }, key) {
  if (op === 'backup-store') return BB.backupStore({ ...args, key });
  if (op === 'pack-dump') return B.packDump(args.rawFile, { key });
  if (op === 'drill-files') return BB.drillFiles({ ...args, key });
  throw new Error(`unknown worker op ${op}`);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let msg;
  try {
    const req = JSON.parse(input);
    const key = req.keyHex ? Buffer.from(req.keyHex, 'hex') : null;
    msg = { ok: true, result: run(req, key) };
  } catch (e) {
    msg = { ok: false, error: { message: e.message, transient: e.transient, code: e.code, file: e.file } };
  }
  process.stdout.write(JSON.stringify(msg), () => process.exit(0));
});
