import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { validatePublicationProvenanceObject } from "./publication-provenance.mjs";
import { DEFAULT_TRUST_STORE_PATH } from "./verify-package-signature.mjs";

const CANONICAL_PROJECT_PATH = "eng/PartyBeam.PackageVerifier/PartyBeam.PackageVerifier.csproj";
const CANONICAL_REPOSITORY = "PawelWielga/PartyBeam.Platform";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function git(repoRoot, ...args) {
  const result = run("git", ["-C", repoRoot, ...args]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function normalizeRemote(remote) {
  return remote
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

function assertPreparedProvenance(provenance) {
  const errors = validatePublicationProvenanceObject(provenance);
  if (errors.length > 0) {
    throw new Error(`Invalid publication provenance: ${errors.map((error) => `${error.instancePath} ${error.message}`).join("; ")}`);
  }
  if (provenance.componentPayloadsVerified || provenance.fullPackageVerification || provenance.canonicalVerifier) {
    throw new Error("Provenance has already been marked as fully verified");
  }
}

export function finalizeCanonicalVerification({
  provenance,
  packagePath,
  trustStore,
  trustStorePath,
  verifierResult,
  verifierCommit,
  gameContractVersion,
  verifiedAt,
}) {
  assertPreparedProvenance(provenance);

  const packageStat = fs.statSync(packagePath);
  const packageSha256 = sha256File(packagePath);
  if (
    packageStat.size !== provenance.releaseAsset.sizeBytes
    || packageSha256 !== provenance.releaseAsset.sha256
  ) {
    throw new Error("Package bytes do not match the prepared release asset identity");
  }
  if (sha256File(trustStorePath) !== provenance.trustStoreSha256) {
    throw new Error("Trust store does not match the SHA-256 bound by publication provenance");
  }

  const trustedKey = trustStore.keys?.find((key) => key.keyId === provenance.signature.keyId);
  if (!trustedKey || trustedKey.status !== "active") {
    throw new Error(`Active trusted key '${provenance.signature.keyId}' was not found`);
  }
  if (trustedKey.algorithm !== provenance.signature.algorithm) {
    throw new Error("Trusted key algorithm does not match publication provenance");
  }

  if (verifierResult?.ok !== true) {
    throw new Error("Canonical PartyBeam package verifier did not return ok=true");
  }
  if (
    verifierResult.gameId !== provenance.gameId
    || verifierResult.version !== provenance.version
    || verifierResult.publisherId !== trustedKey.publisherId
  ) {
    throw new Error("Canonical verifier package identity does not match publication provenance and trust binding");
  }
  if (!/^[a-f0-9]{40}$/.test(verifierCommit)) {
    throw new Error("Canonical verifier commit must be a full Git commit SHA");
  }
  if (Number.isNaN(Date.parse(verifiedAt))) {
    throw new Error("Canonical verification timestamp must be an ISO-8601 date-time");
  }

  const finalized = {
    ...provenance,
    componentPayloadsVerified: true,
    fullPackageVerification: true,
    canonicalVerifier: {
      repository: CANONICAL_REPOSITORY,
      commit: verifierCommit,
      project: CANONICAL_PROJECT_PATH,
      gameContractVersion,
      verifiedAt,
      releaseAssetSha256: packageSha256,
      keyId: trustedKey.keyId,
    },
    cryptographicVerificationNote:
      "PartyBeam.PackageVerifier successfully verified the canonical container, manifest semantics, component payload hashes, logical package hash and trusted P-256 signature.",
  };

  const errors = validatePublicationProvenanceObject(finalized);
  if (errors.length > 0) {
    throw new Error(`Finalized publication provenance is invalid: ${errors.map((error) => `${error.instancePath} ${error.message}`).join("; ")}`);
  }
  return finalized;
}

export function verifyFullPackage({
  provenancePath,
  packagePath,
  trustStorePath = DEFAULT_TRUST_STORE_PATH,
  verifierProjectPath,
  gameContractVersion,
  outputPath,
  verifiedAt = new Date().toISOString(),
}) {
  const provenance = readJson(provenancePath);
  const trustStore = readJson(trustStorePath);
  assertPreparedProvenance(provenance);
  if (fs.existsSync(outputPath)) {
    throw new Error(`Refusing to overwrite existing finalized provenance: ${outputPath}`);
  }

  const projectPath = path.resolve(verifierProjectPath);
  if (!fs.existsSync(projectPath)) throw new Error(`Canonical verifier project does not exist: ${projectPath}`);
  const repoRoot = git(path.dirname(projectPath), "rev-parse", "--show-toplevel");
  const relativeProject = path.relative(repoRoot, projectPath).replaceAll("\\", "/");
  if (relativeProject !== CANONICAL_PROJECT_PATH) {
    throw new Error(`Verifier project must be '${CANONICAL_PROJECT_PATH}' inside the PartyBeam repository`);
  }
  const remote = normalizeRemote(git(repoRoot, "remote", "get-url", "origin"));
  if (remote !== `https://github.com/${CANONICAL_REPOSITORY}`) {
    throw new Error(`Unexpected canonical verifier origin: ${remote}`);
  }
  if (git(repoRoot, "status", "--porcelain").length > 0) {
    throw new Error("Canonical verifier checkout must be clean");
  }
  const verifierCommit = git(repoRoot, "rev-parse", "HEAD");

  const trustedKey = trustStore.keys?.find((key) => key.keyId === provenance.signature.keyId);
  if (!trustedKey || trustedKey.status !== "active") {
    throw new Error(`Active trusted key '${provenance.signature.keyId}' was not found`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-full-verification-"));
  try {
    const publicKeyPath = path.join(tempDir, "trusted-key.pem");
    fs.writeFileSync(publicKeyPath, trustedKey.publicKeyPem, { encoding: "utf8", mode: 0o600 });
    const result = run("dotnet", [
      "run",
      "--project",
      projectPath,
      "--configuration",
      "Release",
      "--verbosity",
      "quiet",
      "--",
      "--package",
      path.resolve(packagePath),
      "--game-contract-version",
      gameContractVersion,
      "--trusted-key",
      `${trustedKey.keyId}=${publicKeyPath}`,
    ], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });

    let verifierResult;
    try {
      verifierResult = JSON.parse(result.stdout.trim());
    } catch {
      throw new Error(`Canonical verifier did not emit valid JSON: ${result.stdout.trim() || result.stderr.trim()}`);
    }
    if (result.status !== 0) {
      throw new Error(`Canonical verifier failed with exit code ${result.status}: ${JSON.stringify(verifierResult)}`);
    }

    const finalized = finalizeCanonicalVerification({
      provenance,
      packagePath,
      trustStore,
      trustStorePath,
      verifierResult,
      verifierCommit,
      gameContractVersion,
      verifiedAt,
    });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(finalized, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return finalized;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = { trustStorePath: DEFAULT_TRUST_STORE_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--provenance") options.provenancePath = path.resolve(argv[++index]);
    else if (value === "--package") options.packagePath = path.resolve(argv[++index]);
    else if (value === "--trust-store") options.trustStorePath = path.resolve(argv[++index]);
    else if (value === "--verifier-project") options.verifierProjectPath = path.resolve(argv[++index]);
    else if (value === "--game-contract-version") options.gameContractVersion = argv[++index];
    else if (value === "--output") options.outputPath = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  for (const required of ["provenancePath", "packagePath", "verifierProjectPath", "gameContractVersion", "outputPath"]) {
    if (!options[required]) throw new Error(`Missing required argument: ${required}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const finalized = verifyFullPackage(options);
  console.log(`Canonical full-package verification passed for ${finalized.gameId}@${finalized.version}.`);
  console.log(`Finalized provenance written to ${options.outputPath}.`);
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedAsScript) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
