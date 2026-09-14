import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { p256 } from "@noble/curves/nist.js";
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

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function publicKeyToPem(publicKey) {
  const keyObject = crypto.createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: toBase64Url(publicKey.subarray(1, 33)),
      y: toBase64Url(publicKey.subarray(33, 65)),
    },
    format: "jwk",
  });

  return keyObject.export({ type: "spki", format: "pem" });
}

function signPackageHash(envelope, secretKey, keyId) {
  const signature = p256.sign(Buffer.from(envelope.packageSha256, "hex"), secretKey, {
    prehash: false,
    lowS: false,
    format: "compact",
  });

  return {
    ...envelope,
    signature: {
      algorithm: "ecdsa-p256-sha256-p1363",
      keyId,
      valueBase64: Buffer.from(signature).toString("base64"),
    },
  };
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-publication-test-"));

try {
  const { secretKey, publicKey } = p256.keygen();
  const keyId = "test-ephemeral-p256";
  const publisherId = "partybeam";
  const sourceEnvelope = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_CONTRACT_DIR, "signature.json"), "utf8"),
  );
  const signedEnvelope = signPackageHash(sourceEnvelope, secretKey, keyId);
  const signaturePath = path.join(tempDir, "signature.json");
  const trustStorePath = path.join(tempDir, "trust.json");

  fs.writeFileSync(signaturePath, `${JSON.stringify(signedEnvelope, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    trustStorePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        keys: [
          {
            keyId,
            publisherId,
            algorithm: "ecdsa-p256-sha256-p1363",
            status: "active",
            publicKeyPem: publicKeyToPem(publicKey),
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const outputPath = path.join(tempDir, "catalog.candidate.json");
  const provenancePath = path.join(tempDir, "publication.provenance.json");

  const prepared = preparePublication({
    catalogPath: CATALOG_PATH,
    manifestPath: path.join(PACKAGE_CONTRACT_DIR, "manifest.json"),
    signaturePath,
    packagePath: PACKAGE_PATH,
    publishedAt: PUBLISHED_AT,
    outputPath,
    provenancePath,
    trustStorePath,
  });

  const release = prepared.candidate.games[0]?.releases[0];
  if (
    release?.version === "1.2.0-beta.1"
    && release.channel === "test"
    && release.package.fileName === "partybeam.reflex-1.2.0-beta.1.partybeam"
    && release.package.integrity.digest === fileSha256(PACKAGE_PATH)
    && release.compatibility.surfaces.join(",") === "tv,android,browser"
  ) {
    pass("publication candidate derives exact release metadata from trusted signed package inputs");
  } else {
    fail("publication candidate does not contain the expected derived release metadata");
  }

  const persistedCandidate = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const persistedProvenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  if (
    persistedCandidate.games[0]?.gameId === "partybeam.reflex"
    && persistedProvenance.releaseTag === "game-partybeam.reflex-v1.2.0-beta.1"
    && persistedProvenance.cryptographicSignatureVerified === true
    && persistedProvenance.componentPayloadsVerified === false
    && persistedProvenance.fullPackageVerification === false
    && persistedProvenance.trustStoreSha256 === fileSha256(trustStorePath)
    && persistedProvenance.candidateCatalogSha256 === fileSha256(outputPath)
  ) {
    pass("publication provenance records trusted signature verification without overstating full package verification");
  } else {
    fail("publication candidate/provenance output is incomplete or misleading");
  }

  let emptyProductionTrustRejected = false;
  try {
    preparePublication({
      catalogPath: CATALOG_PATH,
      manifestPath: path.join(PACKAGE_CONTRACT_DIR, "manifest.json"),
      signaturePath,
      packagePath: PACKAGE_PATH,
      publishedAt: PUBLISHED_AT,
      outputPath: path.join(tempDir, "untrusted.json"),
      provenancePath: path.join(tempDir, "untrusted.provenance.json"),
    });
  } catch (error) {
    emptyProductionTrustRejected = error.message.includes("signature-untrusted-key");
  }

  if (emptyProductionTrustRejected) {
    pass("empty production trust store fails closed until an official publisher key is configured");
  } else {
    fail("publication must not pass without an explicitly trusted publisher key");
  }

  let duplicateRejected = false;
  try {
    preparePublication({
      catalogPath: outputPath,
      manifestPath: path.join(PACKAGE_CONTRACT_DIR, "manifest.json"),
      signaturePath,
      packagePath: PACKAGE_PATH,
      publishedAt: PUBLISHED_AT,
      outputPath: path.join(tempDir, "duplicate.json"),
      provenancePath: path.join(tempDir, "duplicate.provenance.json"),
      trustStorePath,
    });
  } catch (error) {
    duplicateRejected = error.message.includes("already exists") && error.message.includes("immutable");
  }

  if (duplicateRejected) {
    pass("publication preparation rejects reusing an existing exact game/version identity");
  } else {
    fail("publication preparation must reject duplicate exact game/version publication");
  }

  const invalidSignatureEnvelope = structuredClone(signedEnvelope);
  const signatureBytes = Buffer.from(invalidSignatureEnvelope.signature.valueBase64, "base64");
  signatureBytes[0] ^= 0x01;
  invalidSignatureEnvelope.signature.valueBase64 = signatureBytes.toString("base64");
  const invalidSignaturePath = path.join(tempDir, "invalid-cryptographic-signature.json");
  fs.writeFileSync(
    invalidSignaturePath,
    `${JSON.stringify(invalidSignatureEnvelope, null, 2)}\n`,
    "utf8",
  );

  let invalidSignatureRejected = false;
  try {
    preparePublication({
      catalogPath: CATALOG_PATH,
      manifestPath: path.join(PACKAGE_CONTRACT_DIR, "manifest.json"),
      signaturePath: invalidSignaturePath,
      packagePath: PACKAGE_PATH,
      publishedAt: PUBLISHED_AT,
      outputPath: path.join(tempDir, "invalid-signature.json"),
      provenancePath: path.join(tempDir, "invalid-signature.provenance.json"),
      trustStorePath,
    });
  } catch (error) {
    invalidSignatureRejected = error.message.includes("signature-invalid");
  }

  if (invalidSignatureRejected) {
    pass("cryptographically invalid package signature blocks publication preparation");
  } else {
    fail("invalid package signature must block publication preparation");
  }

  const mismatchedEnvelope = structuredClone(sourceEnvelope);
  mismatchedEnvelope.packageSha256 = "0".repeat(64);
  const signedMismatch = signPackageHash(mismatchedEnvelope, secretKey, keyId);
  const mismatchedSignaturePath = path.join(tempDir, "signed-mismatched-package-hash.json");
  fs.writeFileSync(
    mismatchedSignaturePath,
    `${JSON.stringify(signedMismatch, null, 2)}\n`,
    "utf8",
  );

  let mismatchRejected = false;
  try {
    preparePublication({
      catalogPath: CATALOG_PATH,
      manifestPath: path.join(PACKAGE_CONTRACT_DIR, "manifest.json"),
      signaturePath: mismatchedSignaturePath,
      packagePath: PACKAGE_PATH,
      publishedAt: PUBLISHED_AT,
      outputPath: path.join(tempDir, "mismatch.json"),
      provenancePath: path.join(tempDir, "mismatch.provenance.json"),
      trustStorePath,
    });
  } catch (error) {
    mismatchRejected = error.message.includes("packageSha256 mismatch");
  }

  if (mismatchRejected) {
    pass("even a valid signature cannot authorize a package hash that disagrees with the manifest");
  } else {
    fail("signed package hash disagreement with manifest must block publication preparation");
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("All publication preparation tests passed.");
}
