import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { authorizePublication } from "./authorize-publication.mjs";
import { generateChannelDocuments } from "./generate-channel-indexes.mjs";
import { DEFAULT_TRUST_STORE_PATH } from "./verify-package-signature.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const BASELINE_PATH = path.join(REPO_ROOT, "catalog/v1/catalog.json");
const FIXTURE_CATALOG_PATH = path.join(REPO_ROOT, "fixtures/v1/integrity/valid.catalog.json");
const PACKAGE_PATH = path.join(
  REPO_ROOT,
  "fixtures/v1/assets/partybeam.integrity-fixture-0.1.0.partybeam",
);
const PACKAGE_CONTRACT_SOURCE_PATH = path.join(
  REPO_ROOT,
  "schemas/upstream/partybeam/v1/source.json",
);
let failed = false;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeChannels(root, documents) {
  fs.mkdirSync(path.join(root, "channels"), { recursive: true });
  fs.writeFileSync(path.join(root, "channels.json"), serializeJson(documents.discovery), "utf8");
  fs.writeFileSync(path.join(root, "channels/stable.json"), serializeJson(documents.stable), "utf8");
  fs.writeFileSync(path.join(root, "channels/test.json"), serializeJson(documents.test), "utf8");
}

function errorCodes(errors) {
  return new Set(errors.map((error) => error.code));
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-authorization-test-"));

try {
  const catalogPath = path.join(tempDir, "catalog.candidate.json");
  fs.copyFileSync(FIXTURE_CATALOG_PATH, catalogPath);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const release = catalog.games[0].releases[0];

  const channelsDir = path.join(tempDir, "channel-candidate");
  const channelDocuments = generateChannelDocuments(catalog);
  writeChannels(channelsDir, channelDocuments);

  const discoveryPath = path.join(channelsDir, "channels.json");
  const stablePath = path.join(channelsDir, "channels/stable.json");
  const testPath = path.join(channelsDir, "channels/test.json");
  const provenancePath = path.join(tempDir, "publication.provenance.json");

  const provenance = {
    schemaVersion: 1,
    gameId: catalog.games[0].gameId,
    version: release.version,
    publisherId: catalog.games[0].publisher.id,
    channel: release.channel,
    releaseTag: `game-${catalog.games[0].gameId}-v${release.version}`,
    assetUrl: release.package.assetUrl,
    publishedAt: release.publishedAt,
    baselineCatalogSha256: sha256File(BASELINE_PATH),
    candidateCatalogSha256: sha256File(catalogPath),
    trustStoreSha256: sha256File(DEFAULT_TRUST_STORE_PATH),
    channelIndexes: {
      discoverySha256: sha256File(discoveryPath),
      stableSha256: sha256File(stablePath),
      testSha256: sha256File(testPath),
    },
    releaseAsset: {
      fileName: release.package.fileName,
      sizeBytes: release.package.sizeBytes,
      sha256: release.package.integrity.digest,
    },
    manifestSha256: release.package.manifestSha256,
    packageSha256: release.package.packageSha256,
    signature: {
      algorithm: release.package.signature.algorithm,
      keyId: release.package.signature.keyId,
    },
    partyBeamPackageContract: JSON.parse(fs.readFileSync(PACKAGE_CONTRACT_SOURCE_PATH, "utf8")),
    cryptographicSignatureVerified: true,
    componentPayloadsVerified: false,
    fullPackageVerification: false,
    cryptographicVerificationNote:
      "Synthetic authorization fixture: signature flag alone is intentionally insufficient for final publication.",
  };
  fs.writeFileSync(provenancePath, serializeJson(provenance), "utf8");

  const blockedErrors = authorizePublication({
    catalogPath,
    baselinePath: BASELINE_PATH,
    provenancePath,
    channelsDir,
    packagePath: PACKAGE_PATH,
    trustStorePath: DEFAULT_TRUST_STORE_PATH,
  });
  const blockedCodes = errorCodes(blockedErrors);

  if (
    blockedCodes.has("component-payload-verification-required")
    && blockedCodes.has("full-package-verification-required")
  ) {
    pass("prepared publication cannot pass the final gate before canonical component/full-package verification");
  } else {
    fail(`missing fail-closed verification errors: ${[...blockedCodes].join(", ")}`);
  }

  const artworkProvenancePath = path.join(tempDir, "artwork-publication.provenance.json");
  const artworkProvenance = {
    ...provenance,
    catalogArtwork: {
      id: "cover",
      kind: "cover",
      sourceArtifactPath: "catalog/cover.png",
      catalogPath: `artwork/v1/${provenance.gameId}/cover.png`,
      publicUrl:
        `https://raw.githubusercontent.com/PawelWielga/PartyBeam.GameCatalog/main/artwork/v1/${provenance.gameId}/cover.png`,
      contentType: "image/png",
      sizeBytes: 1234,
      sha256: "a".repeat(64),
      width: 1024,
      height: 1536,
    },
  };
  fs.writeFileSync(artworkProvenancePath, serializeJson(artworkProvenance), "utf8");
  const missingArtworkErrors = authorizePublication({
    catalogPath,
    baselinePath: BASELINE_PATH,
    provenancePath: artworkProvenancePath,
    channelsDir,
    packagePath: PACKAGE_PATH,
    trustStorePath: DEFAULT_TRUST_STORE_PATH,
  });
  if (errorCodes(missingArtworkErrors).has("artwork-directory-missing")) {
    pass("cover publication cannot pass authorization without the staged catalog artwork");
  } else {
    fail("cover publication must require the staged catalog artwork directory");
  }

  provenance.componentPayloadsVerified = true;
  provenance.fullPackageVerification = true;
  fs.writeFileSync(provenancePath, serializeJson(provenance), "utf8");
  const missingEvidenceErrors = authorizePublication({
    catalogPath,
    baselinePath: BASELINE_PATH,
    provenancePath,
    channelsDir,
    packagePath: PACKAGE_PATH,
    trustStorePath: DEFAULT_TRUST_STORE_PATH,
  });
  if (errorCodes(missingEvidenceErrors).has("provenance-schema-required")) {
    pass("manually flipping verification flags cannot bypass canonical verifier evidence");
  } else {
    fail("full verification flags must require canonical verifier evidence");
  }

  provenance.canonicalVerifier = {
    repository: "PawelWielga/PartyBeam.Platform",
    commit: "a".repeat(40),
    project: "eng/PartyBeam.PackageVerifier/PartyBeam.PackageVerifier.csproj",
    gameContractVersion: "1.0.0",
    verifiedAt: "2026-09-14T05:00:00Z",
    releaseAssetSha256: release.package.integrity.digest,
    keyId: release.package.signature.keyId,
  };
  fs.writeFileSync(provenancePath, serializeJson(provenance), "utf8");
  const forgedFlagErrors = authorizePublication({
    catalogPath,
    baselinePath: BASELINE_PATH,
    provenancePath,
    channelsDir,
    packagePath: PACKAGE_PATH,
    trustStorePath: DEFAULT_TRUST_STORE_PATH,
  });
  const forgedFlagCodes = errorCodes(forgedFlagErrors);
  if ([...forgedFlagCodes].some((code) => code.includes("untrusted-key"))) {
    pass("manually flipping verification flags cannot bypass trusted-key verification");
  } else {
    fail("authorization must independently re-verify publisher trust/signature state");
  }

  provenance.componentPayloadsVerified = false;
  provenance.fullPackageVerification = false;
  delete provenance.canonicalVerifier;
  fs.writeFileSync(provenancePath, serializeJson(provenance), "utf8");
  fs.appendFileSync(catalogPath, "\n", "utf8");
  const tamperedErrors = authorizePublication({
    catalogPath,
    baselinePath: BASELINE_PATH,
    provenancePath,
    channelsDir,
    packagePath: PACKAGE_PATH,
    trustStorePath: DEFAULT_TRUST_STORE_PATH,
  });
  if (errorCodes(tamperedErrors).has("candidate-catalog-hash-mismatch")) {
    pass("candidate catalog byte tampering after provenance generation is detected");
  } else {
    fail("candidate catalog hash must be bound by publication provenance");
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failed) process.exitCode = 1;
else console.log("All publication authorization tests passed.");
