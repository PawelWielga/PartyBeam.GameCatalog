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
const EXISTING_REFLEX_COVER_PATH = path.join(
  REPO_ROOT,
  "artwork/v1/partybeam.reflex/cover.png",
);
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

function bytesSha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function logicalPackageSha256(manifestSha256, components) {
  const lines = [...components]
    .sort((left, right) => (
      left.artifactPath < right.artifactPath ? -1 : left.artifactPath > right.artifactPath ? 1 : 0
    ))
    .map(
      (component) =>
        `component:${component.kind}:${component.artifactPath}:${component.sha256.toLowerCase()}`,
    );

  return bytesSha256(Buffer.from([
    "partybeam-package-content-v1",
    `manifest:${manifestSha256.toLowerCase()}`,
    ...lines,
    "",
  ].join("\n"), "utf8"));
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
  const { secretKey } = p256.keygen();
  const publicKey = p256.getPublicKey(secretKey, false);
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
  const channelsOutputDir = path.join(tempDir, "channel-candidate");

  const prepared = preparePublication({
    catalogPath: CATALOG_PATH,
    manifestPath: path.join(PACKAGE_CONTRACT_DIR, "manifest.json"),
    signaturePath,
    packagePath: PACKAGE_PATH,
    publishedAt: PUBLISHED_AT,
    outputPath,
    provenancePath,
    channelsOutputDir,
    trustStorePath,
  });

  const preparedGame = prepared.candidate.games.find((game) => game.gameId === "partybeam.reflex");
  const release = preparedGame?.releases.find((candidate) => candidate.version === "1.2.0-beta.1");
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
  const discoveryPath = path.join(channelsOutputDir, "channels.json");
  const stablePath = path.join(channelsOutputDir, "channels/stable.json");
  const testPath = path.join(channelsOutputDir, "channels/test.json");
  const testChannel = JSON.parse(fs.readFileSync(testPath, "utf8"));

  if (
    persistedCandidate.games.some((game) => game.gameId === "partybeam.reflex")
    && persistedProvenance.releaseTag === "game-partybeam.reflex-v1.2.0-beta.1"
    && persistedProvenance.cryptographicSignatureVerified === true
    && persistedProvenance.componentPayloadsVerified === false
    && persistedProvenance.fullPackageVerification === false
    && persistedProvenance.trustStoreSha256 === fileSha256(trustStorePath)
    && persistedProvenance.candidateCatalogSha256 === fileSha256(outputPath)
    && persistedProvenance.channelIndexes.discoverySha256 === fileSha256(discoveryPath)
    && persistedProvenance.channelIndexes.stableSha256 === fileSha256(stablePath)
    && persistedProvenance.channelIndexes.testSha256 === fileSha256(testPath)
  ) {
    pass("publication provenance binds the catalog, trust store and exact generated channel projections");
  } else {
    fail("publication candidate/provenance output is incomplete or misleading");
  }

  const artworkSourceRoot = path.join(tempDir, "game-build");
  const artworkOutputRoot = path.join(tempDir, "artwork-candidate");
  const artworkSourcePath = path.join(artworkSourceRoot, "catalog/cover.png");
  fs.mkdirSync(path.dirname(artworkSourcePath), { recursive: true });
  fs.copyFileSync(EXISTING_REFLEX_COVER_PATH, artworkSourcePath);

  const artworkManifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_CONTRACT_DIR, "manifest.json"), "utf8"),
  );
  const coverBytes = fs.readFileSync(artworkSourcePath);
  artworkManifest.catalog.artwork = [
    {
      id: "cover",
      kind: "cover",
      artifactPath: "catalog/cover.png",
      sha256: bytesSha256(coverBytes),
    },
  ];
  const artworkManifestText = `${JSON.stringify(artworkManifest, null, 2)}\n`;
  const artworkManifestPath = path.join(tempDir, "artwork-manifest.json");
  fs.writeFileSync(artworkManifestPath, artworkManifestText, "utf8");

  const artworkManifestSha256 = bytesSha256(Buffer.from(artworkManifestText, "utf8"));
  const artworkEnvelope = signPackageHash(
    {
      schemaVersion: 1,
      manifestSha256: artworkManifestSha256,
      packageSha256: logicalPackageSha256(artworkManifestSha256, artworkManifest.components),
    },
    secretKey,
    keyId,
  );
  const artworkEnvelopePath = path.join(tempDir, "artwork-signature.json");
  fs.writeFileSync(artworkEnvelopePath, `${JSON.stringify(artworkEnvelope, null, 2)}\n`, "utf8");

  const artworkOutputPath = path.join(tempDir, "artwork-catalog.candidate.json");
  const artworkProvenancePath = path.join(tempDir, "artwork-publication.provenance.json");
  const artworkPrepared = preparePublication({
    catalogPath: CATALOG_PATH,
    manifestPath: artworkManifestPath,
    signaturePath: artworkEnvelopePath,
    packagePath: PACKAGE_PATH,
    publishedAt: PUBLISHED_AT,
    outputPath: artworkOutputPath,
    provenancePath: artworkProvenancePath,
    artworkSourceRoot,
    artworkOutputDir: artworkOutputRoot,
    trustStorePath,
  });

  const artworkGame = artworkPrepared.candidate.games.find(
    (game) => game.gameId === "partybeam.reflex",
  );
  const expectedArtworkUrl =
    "https://raw.githubusercontent.com/PawelWielga/PartyBeam.GameCatalog/main/artwork/v1/partybeam.reflex/cover.png";
  const generatedArtworkPath = path.join(
    artworkOutputRoot,
    "artwork/v1/partybeam.reflex/cover.png",
  );
  if (
    artworkGame?.catalogMetadata.locales.en.artworkUrl === expectedArtworkUrl
    && artworkGame.catalogMetadata.locales.pl.artworkUrl === expectedArtworkUrl
    && artworkPrepared.provenance.catalogArtwork?.sha256 === bytesSha256(coverBytes)
    && artworkPrepared.provenance.catalogArtwork?.sourceArtifactPath === "catalog/cover.png"
    && artworkPrepared.provenance.catalogArtwork?.catalogPath === "artwork/v1/partybeam.reflex/cover.png"
    && fs.existsSync(generatedArtworkPath)
    && fileSha256(generatedArtworkPath) === bytesSha256(coverBytes)
  ) {
    pass("publication preparation derives and stages catalog artwork from the game-owned cover");
  } else {
    fail("publication preparation did not bind the game-owned cover to catalog output");
  }

  const preparedReflexTestEntry = prepared.channelDocuments.test.games.find(
    (game) => game.gameId === "partybeam.reflex",
  );
  const persistedReflexTestEntry = testChannel.games.find(
    (game) => game.gameId === "partybeam.reflex",
  );
  const preparedReflexStableEntry = prepared.channelDocuments.stable.games.find(
    (game) => game.gameId === "partybeam.reflex",
  );

  if (
    prepared.channelDocuments.stable.games.some(
      (game) => game.gameId === "partybeam.placeholder" && game.latestVersion === "0.1.0",
    )
    && preparedReflexTestEntry?.latestVersion === "1.2.0-beta.1"
    && persistedReflexTestEntry?.latestVersion === "1.2.0-beta.1"
    && preparedReflexStableEntry === undefined
  ) {
    pass("prerelease publication is prepared only in the test-channel candidate");
  } else {
    fail("publication preparation generated incorrect stable/test channel candidates");
  }

  const unsignedEnvelope = structuredClone(sourceEnvelope);
  delete unsignedEnvelope.signature;
  const unsignedEnvelopePath = path.join(tempDir, "unsigned-integrity-envelope.json");
  fs.writeFileSync(unsignedEnvelopePath, `${JSON.stringify(unsignedEnvelope, null, 2)}\n`, "utf8");

  const unsignedOutputPath = path.join(tempDir, "unsigned-catalog.candidate.json");
  const unsignedProvenancePath = path.join(tempDir, "unsigned-publication.provenance.json");
  const unsignedChannelsDir = path.join(tempDir, "unsigned-channel-candidate");
  const unsignedPrepared = preparePublication({
    catalogPath: CATALOG_PATH,
    manifestPath: path.join(PACKAGE_CONTRACT_DIR, "manifest.json"),
    signaturePath: unsignedEnvelopePath,
    packagePath: PACKAGE_PATH,
    publishedAt: PUBLISHED_AT,
    outputPath: unsignedOutputPath,
    provenancePath: unsignedProvenancePath,
    channelsOutputDir: unsignedChannelsDir,
    trustStorePath,
  });
  const unsignedRelease = unsignedPrepared.candidate.games
    .find((game) => game.gameId === "partybeam.reflex")
    ?.releases.find((candidate) => candidate.version === "1.2.0-beta.1");
  if (
    unsignedRelease
    && unsignedRelease.package.signature === undefined
    && unsignedPrepared.provenance.signature === undefined
    && unsignedPrepared.provenance.publisherId === "partybeam"
    && unsignedPrepared.provenance.cryptographicSignatureVerified === false
    && unsignedPrepared.provenance.componentPayloadsVerified === false
  ) {
    pass("unsigned First MVP preparation preserves integrity metadata without claiming publisher authentication");
  } else {
    fail("unsigned First MVP publication preparation produced incorrect metadata");
  }

  let unrelatedProductionKeyRejected = false;
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
    unrelatedProductionKeyRejected = error.message.includes("signature-untrusted-key");
  }

  if (unrelatedProductionKeyRejected) {
    pass("production trust store rejects a package signed by an unrelated key");
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
