'use strict';
// How the dashboard process is hosted on the server, and how to start / stop / restart it.
// Two hosts are supported:
//   windows  — the native Windows service "SDPDashboard" (tools/service/SdpDashboardService.exe,
//              installed by Setup.exe: automatic start, restart on failure, no third-party tool)
//   pm2      — the historical host (pm2 process "endeavour-dashboard"), kept for the servers that
//              already run that way; Setup never switches an existing server from pm2 on its own
// The choice is written in .env as SDP_SERVICE (windows | pm2). Without it, the service is detected.
// A restart is ALWAYS stop → wait → start (never `pm2 reload`: the EADDRINUSE crash loop).
// The process runner is injected so the logic is tested without Windows or pm2.
const { spawnSync } = require('child_process');

const WINDOWS_SERVICE = 'SDPDashboard';

function defaultRun(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return { status: r.status == null ? -1 : r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? r.error.message : '') };
}
const sleep = (ms) => { const t = Date.now(); while (Date.now() - t < ms) { /* short, bounded wait */ } };

/** `sc query` output → 'running' | 'stopped' | 'starting' | 'stopping' | 'unknown' */
function parseScState(text) {
  const m = /STATE\s*:\s*\d+\s+([A-Z_]+)/.exec(String(text || ''));
  if (!m) return 'unknown';
  return { RUNNING: 'running', STOPPED: 'stopped', START_PENDING: 'starting', STOP_PENDING: 'stopping', PAUSED: 'stopped' }[m[1]] || 'unknown';
}

function pm2Name(env) { return (env && env.PM2_NAME) || 'endeavour-dashboard'; }

/** Which host runs the dashboard here: .env SDP_SERVICE first, then what the machine has. */
function detect(env = {}, { run = defaultRun, platform = process.platform } = {}) {
  const forced = String(env.SDP_SERVICE || '').toLowerCase();
  if (forced === 'windows' || forced === 'pm2') return forced;
  if (platform === 'win32' && run('sc', ['query', WINDOWS_SERVICE]).status === 0) return 'windows';
  const j = run('pm2', ['jlist']);
  if (j.status === 0) { try { if (JSON.parse(j.stdout || '[]').some((p) => p.name === pm2Name(env))) return 'pm2'; } catch (_) { /* unreadable */ } }
  return 'none';
}

function status(env = {}, deps = {}) {
  const run = deps.run || defaultRun;
  const kind = detect(env, deps);
  if (kind === 'windows') return { kind, state: parseScState(run('sc', ['query', WINDOWS_SERVICE]).stdout), name: WINDOWS_SERVICE };
  if (kind === 'pm2') {
    try {
      const p = JSON.parse(run('pm2', ['jlist']).stdout || '[]').find((x) => x.name === pm2Name(env));
      const s = p && p.pm2_env ? p.pm2_env.status : 'unknown';
      return { kind, state: s === 'online' ? 'running' : s === 'stopped' ? 'stopped' : s, restarts: p && p.pm2_env ? p.pm2_env.restart_time : null, name: pm2Name(env) };
    } catch (_) { return { kind, state: 'unknown', name: pm2Name(env) }; }
  }
  return { kind: 'none', state: 'not installed', name: null };
}

function must(r, what) { if (r.status !== 0) throw new Error(`${what} failed: ${String(r.stderr || r.stdout).trim().slice(-300)}`); }

function start(env = {}, deps = {}) {
  const run = deps.run || defaultRun; const kind = detect(env, deps);
  if (kind === 'windows') {
    const r = run('net', ['start', WINDOWS_SERVICE]);
    if (r.status !== 0 && !/already been started/i.test(r.stdout + r.stderr)) must(r, 'service start');
  } else if (kind === 'pm2') must(run('pm2', ['start', pm2Name(env)]), 'pm2 start');
  else throw new Error('no SDP Dashboard service is installed on this machine (run Setup again, mode Repair)');
  return kind;
}
function stop(env = {}, deps = {}) {
  const run = deps.run || defaultRun; const kind = detect(env, deps);
  if (kind === 'windows') {
    const r = run('net', ['stop', WINDOWS_SERVICE]);
    if (r.status !== 0 && !/is not started/i.test(r.stdout + r.stderr)) must(r, 'service stop');
  } else if (kind === 'pm2') must(run('pm2', ['stop', pm2Name(env)]), 'pm2 stop');
  else throw new Error('no SDP Dashboard service is installed on this machine');
  return kind;
}
/** stop → wait (the port must be released) → start. Never a reload. */
function restart(env = {}, deps = {}) {
  stop(env, deps);
  (deps.sleep || sleep)(deps.waitMs == null ? 5000 : deps.waitMs);
  return start(env, deps);
}

module.exports = { WINDOWS_SERVICE, parseScState, detect, status, start, stop, restart };
