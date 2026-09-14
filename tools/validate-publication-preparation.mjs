import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { preparePublication } from "./prepare-publication.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const PACKAGE_CONTRACT_DIR = path.join(REPO_ROOT, "fixtures/v1/package-contract");
const PACKAGE_PATH = path.join(
  REPO_ROOT,
  "fixtures/v1/assets/partybeam.reflex-1.2.0-beta.1.partybeam",
);
const CATALOG_PATH = path.join(REPO_ROOT, "catalog/v1/catalog.json");
const PUBLISHED_AT = "2026-09-14T08:00:00Z";
let failed = false;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-publication-test-"));

try {
  const outputPath = path.join(tempDir, "catalog.candidate.json");
  const provenancePath = path.join(tempDir, "publication.provenance.json");

  const prepared = preparePublication({
    catalogPath: CATALOG_PATH,
    manifestPath: path.join(PACKAGE_CONTRACT_DIR, "manifest.json"),
    signaturePath: path.join(PACKAGE_CONTRACT_DIR, "signature.json"),
    packagePath: PACKAGE_PATH,
    publishedAt: PUBLISHED_AT,
    outputPath,
    provenancePath,
  });

  const release = prepared.candidate.games[0]?.releases[0];
  if (
    release?.version === "1.2.0-beta.1"
    && release.channel === "test"
    && release.package.fileName === "partybeam.reflex-1.2.0-beta.1.partybeam"
    && release.package.integrity.digest === fileSha256(PACKAGE_PATH)
    && release.compatibility.surfaces.join(",") === "tv,android,browser"
  ) {
    pass("publication candidate derives exact release metadata from signed package inputs");
  } else {
    fail("publication candidate does not contain the expected derived release metadata");
  }

  const persistedCandidate = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const persistedProvenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  if (
    persistedCandidate.games[0]?.gameId === "partybeam.reflex"
    && persistedProvenance.releaseTag === "game-partybeam.reflex-v1.2.0-beta.1"
    && persistedProvenance.cryptographicSignatureVerified === false
    && persistedProvenance.candidateCatalogSha256 === fileSha256(outputPath)
  ) {
    pass("publication preparation writes auditable candidate and explicit unverified provenance");
  } else {
    fail("publication candidate/provenance output is incomplete or misleading");
  }

  let duplicateRejected = false;
  try {
    preparePublication({
      catalogPath: outputPath,
      manifestPath: path.join(PACKAGE_CONTRACT_DIR, "manifest.json"),
      signaturePath: path.join(PACKAGE_CONTRACT_DIR, "signature.json"),
      packagePath: PACKAGE_PATH,
      publishedAt: PUBLISHED_AT,
      outputPath: path.join(tempDir, "duplicate.json"),
      provenancePath: path.join(tempDir, "duplicate.provenance.json"),
    });
  } catch (error) {
    duplicateRejected = error.message.includes("already exists") && error.message.includes("immutable");
  }

  if (duplicateRejected) {
    pass("publication preparation rejects reusing an existing exact game/version identity");
  } else {
    fail("publication preparation must reject duplicate exact game/version publication");
  }

  const tamperedEnvelope = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_CONTRACT_DIR, "signature.json"), "utf8"),
  );
  tamperedEnvelope.packageSha256 = "0".repeat(64);
  const tamperedSignaturePath = path.join(tempDir, "tampered-signature.json");
  fs.writeFileSync(tamperedSignaturePath, `${JSON.stringify(tamperedEnvelope, null, 2)}\n`, "utf8");

  let tamperedRejected = false;
  try {
    preparePublication({
      catalogPath: CATALOG_PATH,
      manifestPath: path.join(PACKAGE_CONTRACT_DIR, "manifest.json"),
      signaturePath: tamperedSignaturePath,
      packagePath: PACKAGE_PATH,
      publishedAt: PUBLISHED_AT,
      outputPath: path.join(tempDir, "tampered.json"),
      provenancePath: path.join(tempDir, "tampered.provenance.json"),
    });
  } catch (error) {
    tamperedRejected = error.message.includes("packageSha256 mismatch");
  }

  if (tamperedRejected) {
    pass("publication preparation rejects a tampered logical package hash before producing output");
  } else {
    fail("tampered logical package hash must block publication preparation");
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("All publication preparation tests passed.");
}
