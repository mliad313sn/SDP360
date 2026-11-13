'use strict';
// W4-CONNECTORS — .mpp import through an ADMIN-CONFIGURED local converter (no binary .mpp parser exists in Node, and we
// ship no licensed library). When report_config `ppm_mpp_converter_cmd` holds the absolute path of a local executable
// (typically a wrapper around MPXJ: `mpxj-convert <in.mpp> <out.xml>`), the server:
//   1. checks the upload (non-empty, ≤ MAX_BYTES, OLE2 compound-file magic D0 CF 11 E0 A1 B1 1A E1 = a real .mpp);
//   2. writes it to a fresh private temp dir (mode 0700) as in.mpp;
//   3. runs the command with execFile (ARGUMENT ARRAY, NO SHELL): [cmd, in.mpp, out.xml], cwd = the temp dir, a
//      timeout, a bounded stdout/stderr buffer and a minimal environment;
//   4. reads out.xml (MSPDI) back, removes the temp dir in every case, and returns the XML text — the caller then
//      reuses the MSPDI import (dry run / committee apply / empty project).
// Nothing is ever executed while the command is empty: the route answers 501 with how to configure it.
// The command path is validated (absolute, no shell metacharacters, an existing regular executable file) on every call.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 60000;
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const err = (msg, status, reason) => Object.assign(new Error(msg), { status, reason });
const HOW_TO = 'set report_config ppm_mpp_converter_cmd to the absolute path of a local converter that takes <in.mpp> <out.xml> and writes MS-Project XML (MSPDI) — for example a wrapper script around MPXJ (see docs/ppm/W4-CONNECTORS.md); or save the plan from MS Project as XML and use the MSPDI import';

/** Validates the configured command. Returns the resolved path or throws {status, reason}. */
function validateCommand(cmd, { fsImpl = fs } = {}) {
  const c = String(cmd == null ? '' : cmd).trim();
  if (!c) throw err(`no .mpp converter is configured: ${HOW_TO}`, 501, 'MPP_CONVERTER_NOT_CONFIGURED');
  if (!path.isAbsolute(c)) throw err('ppm_mpp_converter_cmd must be an absolute path to an executable file', 500, 'MPP_CONVERTER_INVALID');
  if (/[\s;&|`$<>(){}*?!'"\\\n\r]/.test(c.replace(/^[A-Za-z]:\\/, '').replace(/\\/g, '/'))) throw err('ppm_mpp_converter_cmd must be a bare executable path (no arguments, spaces or shell characters)', 500, 'MPP_CONVERTER_INVALID');
  let st; try { st = fsImpl.statSync(c); } catch (_) { throw err('the configured .mpp converter does not exist on this server', 500, 'MPP_CONVERTER_MISSING'); }
  if (!st.isFile()) throw err('the configured .mpp converter is not a regular file', 500, 'MPP_CONVERTER_INVALID');
  if (process.platform !== 'win32') { try { fsImpl.accessSync(c, fs.constants.X_OK); } catch (_) { throw err('the configured .mpp converter is not executable', 500, 'MPP_CONVERTER_INVALID'); } }
  return c;
}

/** Checks the uploaded bytes. Throws {status 400/413}. */
function validateUpload(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw err('send the .mpp file as the request body', 400, 'EMPTY_BODY');
  if (buf.length > MAX_BYTES) throw err(`the .mpp file is larger than ${MAX_BYTES / 1024 / 1024} MB`, 413, 'MPP_TOO_LARGE');
  if (!buf.subarray(0, 8).equals(OLE2_MAGIC)) throw err('this is not an .mpp file (an MS Project file is an OLE2 compound document)', 400, 'MPP_NOT_OLE2');
}

/**
 * @param {Buffer} buf  the uploaded .mpp
 * @param {{cmd:string, timeoutMs?:number, run?:Function, fsImpl?}} opts  run(cmd, args, options, cb) defaults to execFile
 * @returns {Promise<string>} the MSPDI XML text
 */
async function convert(buf, { cmd, timeoutMs = TIMEOUT_MS, run = execFile, fsImpl = fs } = {}) {
  const exe = validateCommand(cmd, { fsImpl });
  validateUpload(buf);
  const dir = fsImpl.mkdtempSync(path.join(os.tmpdir(), 'sdp-mpp-'));
  try {
    try { fsImpl.chmodSync(dir, 0o700); } catch (_) { /* best-effort on Windows */ }
    const inPath = path.join(dir, 'in.mpp'), outPath = path.join(dir, 'out.xml');
    fsImpl.writeFileSync(inPath, buf, { mode: 0o600 });
    await new Promise((resolve, reject) => {
      run(exe, [inPath, outPath], { cwd: dir, timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true, shell: false,
        env: { PATH: process.env.PATH || '', HOME: dir, TMPDIR: dir, TEMP: dir, TMP: dir, SystemRoot: process.env.SystemRoot || '' } }, (e) => {
        if (!e) return resolve();
        if (e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT') return reject(err(`the .mpp converter did not finish within ${Math.round(timeoutMs / 1000)} s`, 504, 'MPP_CONVERTER_TIMEOUT'));
        reject(err(`the .mpp converter failed (exit ${e.code == null ? '?' : e.code})`, 502, 'MPP_CONVERTER_FAILED'));
      });
    });
    let st; try { st = fsImpl.statSync(outPath); } catch (_) { throw err('the .mpp converter produced no output file', 502, 'MPP_CONVERTER_NO_OUTPUT'); }
    if (st.size > MAX_BYTES * 4) throw err('the converted XML is too large', 502, 'MPP_CONVERTER_OUTPUT_TOO_LARGE');
    return fsImpl.readFileSync(outPath, 'utf8');
  } finally {
    try { fsImpl.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
}

module.exports = { convert, validateCommand, validateUpload, MAX_BYTES, TIMEOUT_MS, OLE2_MAGIC, HOW_TO };
