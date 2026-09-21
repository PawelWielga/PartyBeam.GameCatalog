import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeCanonicalVerification } from "./verify-full-package.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const PACKAGE_PATH = path.join(REPO_ROOT, "fixtures/v1/assets/partybeam.integrity-fixture-0.1.0.partybeam");
const CONTRACT_SOURCE_PATH = path.join(REPO_ROOT, "schemas/upstream/partybeam/v1/source.json");
let failed = false;

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-full-verifier-test-"));
try {
  const trustStorePath = path.join(tempDir, "trust.json");
  const trustStore = {
    schemaVersion: 1,
    keys: [{
      keyId: "test-key",
      publisherId: "partybeam",
      algorithm: "ecdsa-p256-sha256-p1363",
      status: "active",
      publicKeyPem: "test fixture public key",
    }],
  };
  fs.writeFileSync(trustStorePath, `${JSON.stringify(trustStore, null, 2)}\n`, "utf8");
  const packageStat = fs.statSync(PACKAGE_PATH);
  const packageSha256 = sha256File(PACKAGE_PATH);
  const provenance = {
    schemaVersion: 1,
    gameId: "partybeam.integrity-fixture",
    version: "0.1.0",
    channel: "stable",
    releaseTag: "game-partybeam.integrity-fixture-v0.1.0",
    assetUrl: "https://github.com/PawelWielga/PartyBeam.GameCatalog/releases/download/game-partybeam.integrity-fixture-v0.1.0/partybeam.integrity-fixture-0.1.0.partybeam",
    publishedAt: "2026-09-14T05:00:00Z",
    baselineCatalogSha256: "a".repeat(64),
    candidateCatalogSha256: "b".repeat(64),
    trustStoreSha256: sha256File(trustStorePath),
    channelIndexes: {
      discoverySha256: "c".repeat(64),
      stableSha256: "d".repeat(64),
      testSha256: "e".repeat(64),
    },
    releaseAsset: {
      fileName: path.basename(PACKAGE_PATH),
      sizeBytes: packageStat.size,
      sha256: packageSha256,
    },
    manifestSha256: "f".repeat(64),
    packageSha256: "1".repeat(64),
    signature: { algorithm: "ecdsa-p256-sha256-p1363", keyId: "test-key" },
    partyBeamPackageContract: JSON.parse(fs.readFileSync(CONTRACT_SOURCE_PATH, "utf8")),
    cryptographicSignatureVerified: true,
    componentPayloadsVerified: false,
    fullPackageVerification: false,
    cryptographicVerificationNote: "Prepared fixture awaiting canonical verification.",
  };
  const verifierResult = {
    ok: true,
    gameId: provenance.gameId,
    version: provenance.version,
    publisherId: "partybeam",
    issues: [],
  };

  const finalized = finalizeCanonicalVerification({
    provenance,
    packagePath: PACKAGE_PATH,
    trustStore,
    trustStorePath,
    verifierResult,
    verifierCommit: "2".repeat(40),
    gameContractVersion: "1.0.0",
    verifiedAt: "2026-09-21T12:00:00Z",
  });
  if (
    finalized.componentPayloadsVerified === true
    && finalized.fullPackageVerification === true
    && finalized.canonicalVerifier.releaseAssetSha256 === packageSha256
    && finalized.canonicalVerifier.keyId === "test-key"
  ) {
    pass("successful canonical verification produces bound full-package evidence");
  } else {
    fail("canonical verification did not finalize provenance correctly");
  }

  let identityMismatchRejected = false;
  try {
    finalizeCanonicalVerification({
      provenance,
      packagePath: PACKAGE_PATH,
      trustStore,
      trustStorePath,
      verifierResult: { ...verifierResult, gameId: "partybeam.other" },
      verifierCommit: "2".repeat(40),
      gameContractVersion: "1.0.0",
      verifiedAt: "2026-09-21T12:00:00Z",
    });
  } catch (error) {
    identityMismatchRejected = error.message.includes("identity does not match");
  }
  if (identityMismatchRejected) pass("canonical verifier identity mismatch fails closed");
  else fail("canonical verifier identity mismatch was accepted");

  const tamperedPackagePath = path.join(tempDir, path.basename(PACKAGE_PATH));
  fs.copyFileSync(PACKAGE_PATH, tamperedPackagePath);
  fs.appendFileSync(tamperedPackagePath, "tamper", "utf8");
  let tamperedPackageRejected = false;
  try {
    finalizeCanonicalVerification({
      provenance,
      packagePath: tamperedPackagePath,
      trustStore,
      trustStorePath,
      verifierResult,
      verifierCommit: "2".repeat(40),
      gameContractVersion: "1.0.0",
      verifiedAt: "2026-09-21T12:00:00Z",
    });
  } catch (error) {
    tamperedPackageRejected = error.message.includes("Package bytes do not match");
  }
  if (tamperedPackageRejected) pass("package tampering after preparation fails closed");
  else fail("tampered package was accepted for full verification evidence");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failed) process.exitCode = 1;
else console.log("All canonical full-package verification tests passed.");
