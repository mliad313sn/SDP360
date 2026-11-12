'use strict';
// F-ARCH-03 — runtime provenance: what the SOURCE says it is (package.json version, git commit
// when there is a repository) next to what the INSTALLED ARTIFACT says it is (manifest.json
// written by the packager: version, commit, build date, Ed25519 signature checked against the
// embedded public key) and the SBOM shipped with it.
//
// Rules: null = unknown. A packaged installation has no .git, so the source commit is null there —
// the boot-time cache token is never presented as a commit. `signature_verified` is true only
// when the signature was actually checked and holds; unsigned or uncheckable → null.
// Nothing here returns a host name, a directory or a secret.
const fs = require('fs');
const path = require('path');
const pkgSvc = require('./updatePackage');

const SBOM_FILE = 'sbom.cdx.json';
const GIT_SHA = /^[0-9a-f]{7,40}$/;

/**
 * @param {{pkgVersion:string|null, build:string|null, manifestText?:string|null, publicKeyPem?:string|Buffer|null, sbomBuf?:Buffer|null}} i
 */
function compute({ pkgVersion = null, build = null, manifestText = null, publicKeyPem = null, sbomBuf = null } = {}) {
  const commit = build && GIT_SHA.test(String(build)) ? String(build) : null;
  const source = { version: pkgVersion || null, commit, commit_source: commit ? 'git' : 'none' };
  let m = null;
  if (manifestText) { try { m = JSON.parse(manifestText); } catch (_) { m = null; } }
  if (!m || typeof m !== 'object' || !m.version) return { source, artifact: null, sbom: null, consistent: null };

  const signed = !!(m.signature && typeof m.signature === 'object' && m.signature.value);
  let verified = null, keyId = null;
  if (signed) {
    keyId = m.signature.key_id ? String(m.signature.key_id) : null;
    if (publicKeyPem) {
      try { verified = pkgSvc.verifyManifestSignature(m, publicKeyPem).ok === true; } catch (_) { verified = null; }
    }
  }
  const artifact = {
    version: String(m.version), commit: m.commit ? String(m.commit) : null, built_at: m.built_at ? String(m.built_at) : null,
    manifest_sha256: pkgSvc.sha256(Buffer.from(manifestText, 'utf8')), signed, key_id: keyId, signature_verified: verified,
  };
  const listed = m.files && m.files[SBOM_FILE] ? m.files[SBOM_FILE].sha256 : null;
  const sha = sbomBuf ? pkgSvc.sha256(sbomBuf) : null;
  const sbom = { present: !!sbomBuf, sha256: sha, matches_manifest: sha && listed ? sha === listed : null };

  let consistent = source.version ? artifact.version === source.version : null;
  if (consistent && source.commit && artifact.commit) {
    const a = source.commit, b = artifact.commit;
    consistent = a.startsWith(b) || b.startsWith(a);
  }
  if (verified === false || sbom.matches_manifest === false) consistent = false;
  return { source, artifact, sbom, consistent };
}

function _read(file) { try { return fs.readFileSync(file); } catch (_) { return null; } }

/** Read the installation at `dir` (the application root). `build` = the boot build id (git SHA or token). */
function load(dir, { build = null } = {}) {
  let pkgVersion = null;
  try { pkgVersion = JSON.parse(String(_read(path.join(dir, 'package.json')) || '{}')).version || null; } catch (_) { pkgVersion = null; }
  const mf = _read(path.join(dir, 'manifest.json'));
  return compute({ pkgVersion, build, manifestText: mf ? mf.toString('utf8') : null,
    publicKeyPem: _read(path.join(dir, 'tools', 'manifest-public.pem')), sbomBuf: _read(path.join(dir, SBOM_FILE)) });
}

/** One log line with the same identity (boot log, Manager status). */
function line(p) {
  const s = p.source, a = p.artifact;
  const sig = !a ? '' : a.signature_verified === true ? ' signature verified' : a.signature_verified === false ? ' signature INVALID' : a.signed ? ' signature not checked' : ' unsigned';
  return `source ${s.version || '?'} commit ${s.commit || 'unknown'} | ` +
    (a ? `artifact ${a.version} commit ${a.commit || 'unknown'}${sig} | sbom ${p.sbom.present ? 'present' : 'absent'}` : 'artifact unknown (no manifest.json)') +
    ` | consistent ${p.consistent === null ? 'unknown' : p.consistent ? 'yes' : 'NO'}`;
}

module.exports = { compute, load, line, SBOM_FILE };
