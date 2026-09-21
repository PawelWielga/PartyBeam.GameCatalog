import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { generateChannelDocuments } from "./generate-channel-indexes.mjs";
import { validateCatalogFile } from "./validate-catalog.mjs";
import { validatePublicationProvenanceObject } from "./publication-provenance.mjs";
import { verifyPackageIntegrity } from "./verify-package-integrity.mjs";
import {
  DEFAULT_TRUST_STORE_PATH,
  verifyPackageSignature,
} from "./verify-package-signature.mjs";

function issue(code, message) {
  return { code, message };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function expectedAssetUrl(gameId, version, fileName) {
  const tag = `game-${gameId}-v${version}`;
  return {
    tag,
    assetUrl: `https://github.com/PawelWielga/PartyBeam.GameCatalog/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`,
  };
}

function compareHash(errors, label, actualPath, expectedHash) {
  if (!fs.existsSync(actualPath)) {
    errors.push(issue(`${label}-missing`, `Required file does not exist: ${actualPath}`));
    return;
  }

  const actualHash = sha256File(actualPath);
  if (actualHash !== expectedHash) {
    errors.push(
      issue(
        `${label}-hash-mismatch`,
        `${label} SHA-256 mismatch: expected ${expectedHash}, got ${actualHash}`,
      ),
    );
  }
}

function compareChannelDocument(errors, label, actualPath, expectedDocument, expectedHash) {
  compareHash(errors, label, actualPath, expectedHash);
  if (!fs.existsSync(actualPath)) return;

  const expectedText = serializeJson(expectedDocument);
  const actualText = fs.readFileSync(actualPath, "utf8");
  if (actualText !== expectedText) {
    errors.push(
      issue(
        `${label}-content-mismatch`,
        `${label} does not equal the deterministic projection of the candidate catalog`,
      ),
    );
  }
}

export function authorizePublication({
  catalogPath,
  baselinePath,
  provenancePath,
  channelsDir,
  packagePath,
  trustStorePath = DEFAULT_TRUST_STORE_PATH,
}) {
  const errors = [];

  for (const [label, filePath] of [
    ["candidate catalog", catalogPath],
    ["baseline catalog", baselinePath],
    ["provenance", provenancePath],
    ["package", packagePath],
    ["trust store", trustStorePath],
  ]) {
    if (!filePath || !fs.existsSync(filePath)) {
      errors.push(issue("required-file-missing", `${label} file does not exist: ${filePath}`));
    }
  }
  if (!channelsDir || !fs.existsSync(channelsDir)) {
    errors.push(issue("channels-directory-missing", `channels directory does not exist: ${channelsDir}`));
  }
  if (errors.length > 0) return errors;

  const provenance = readJson(provenancePath);
  const provenanceErrors = validatePublicationProvenanceObject(provenance);
  if (provenanceErrors.length > 0) {
    return provenanceErrors.map((error) =>
      issue(error.code, `${error.instancePath}: ${error.message}`),
    );
  }

  const catalog = readJson(catalogPath);

  if (provenance.componentPayloadsVerified !== true) {
    errors.push(
      issue(
        "component-payload-verification-required",
        "publication is blocked until all declared component payload bytes have been verified",
      ),
    );
  }
  if (provenance.fullPackageVerification !== true) {
    errors.push(
      issue(
        "full-package-verification-required",
        "publication is blocked until PartyBeam's canonical full package verifier succeeds",
      ),
    );
  }
  if (provenance.componentPayloadsVerified === true && provenance.fullPackageVerification === true) {
    if (!provenance.canonicalVerifier) {
      errors.push(issue("canonical-verifier-evidence-required", "canonical verifier evidence is required for full verification"));
    } else {
      if (provenance.canonicalVerifier.releaseAssetSha256 !== provenance.releaseAsset.sha256) {
        errors.push(issue("canonical-verifier-asset-mismatch", "canonical verifier evidence does not match the release asset SHA-256"));
      }
      if (provenance.signature) {
        if (provenance.canonicalVerifier.keyId !== provenance.signature.keyId) {
          errors.push(issue("canonical-verifier-key-mismatch", "canonical verifier evidence does not match the publication signing key"));
        }
      } else if (provenance.canonicalVerifier.keyId !== undefined) {
        errors.push(issue("canonical-verifier-unexpected-key", "unsigned publication evidence must not claim a signing key"));
      }
    }
  }

  compareHash(errors, "baseline-catalog", baselinePath, provenance.baselineCatalogSha256);
  compareHash(errors, "candidate-catalog", catalogPath, provenance.candidateCatalogSha256);
  compareHash(errors, "trust-store", trustStorePath, provenance.trustStoreSha256);

  const catalogErrors = validateCatalogFile(catalogPath, { baselinePath });
  for (const error of catalogErrors) {
    errors.push(issue(`catalog-${error.code}`, `${error.instancePath}: ${error.message}`));
  }

  const game = catalog.games.find((entry) => entry.gameId === provenance.gameId);
  const release = game?.releases.find((entry) => entry.version === provenance.version);
  if (!game || !release) {
    errors.push(
      issue(
        "provenance-release-missing",
        `candidate catalog does not contain ${provenance.gameId}@${provenance.version}`,
      ),
    );
    return errors;
  }

  if (game.publisher.id !== provenance.publisherId) {
    errors.push(issue("provenance-publisher-mismatch", "provenance publisherId does not match candidate catalog publisher"));
  }

  if (release.publicationState !== "published") {
    errors.push(issue("release-not-published", "publication candidate release must have publicationState 'published'"));
  }
  if (release.channel !== provenance.channel) {
    errors.push(
      issue(
        "provenance-channel-mismatch",
        `provenance channel '${provenance.channel}' does not match catalog release channel '${release.channel}'`,
      ),
    );
  }
  if (release.publishedAt !== provenance.publishedAt) {
    errors.push(issue("provenance-published-at-mismatch", "provenance publishedAt does not match catalog release"));
  }

  const expected = expectedAssetUrl(provenance.gameId, provenance.version, release.package.fileName);
  if (provenance.releaseTag !== expected.tag) {
    errors.push(issue("release-tag-mismatch", `expected release tag '${expected.tag}'`));
  }
  if (provenance.assetUrl !== expected.assetUrl || release.package.assetUrl !== expected.assetUrl) {
    errors.push(issue("asset-url-mismatch", `expected immutable public asset URL '${expected.assetUrl}'`));
  }

  const signaturePresenceMatches = Boolean(provenance.signature) === Boolean(release.package.signature);
  const signatureIdentityMatches = !provenance.signature
    || (
      provenance.signature.algorithm === release.package.signature?.algorithm
      && provenance.signature.keyId === release.package.signature?.keyId
    );

  if (
    provenance.releaseAsset.fileName !== release.package.fileName
    || provenance.releaseAsset.sizeBytes !== release.package.sizeBytes
    || provenance.releaseAsset.sha256 !== release.package.integrity.digest
    || provenance.manifestSha256 !== release.package.manifestSha256
    || provenance.packageSha256 !== release.package.packageSha256
    || !signaturePresenceMatches
    || !signatureIdentityMatches
  ) {
    errors.push(issue("provenance-release-identity-mismatch", "provenance release identity does not match candidate catalog"));
  }

  const assetErrors = verifyPackageIntegrity({
    catalogPath,
    gameId: provenance.gameId,
    version: provenance.version,
    packagePath,
  });
  for (const error of assetErrors) {
    errors.push(issue(`asset-${error.code}`, error.message));
  }

  if (release.package.signature) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-authorization-"));
    try {
      const signaturePath = path.join(tempDir, "signature.json");
      fs.writeFileSync(
        signaturePath,
        serializeJson({
          schemaVersion: 1,
          manifestSha256: release.package.manifestSha256,
          packageSha256: release.package.packageSha256,
          signature: release.package.signature,
        }),
        "utf8",
      );

      const signatureErrors = verifyPackageSignature({
        signaturePath,
        publisherId: game.publisher.id,
        trustStorePath,
      });
      for (const error of signatureErrors) {
        errors.push(issue(error.code, error.message));
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const expectedChannels = generateChannelDocuments(catalog);
  compareChannelDocument(
    errors,
    "channel-discovery",
    path.join(channelsDir, "channels.json"),
    expectedChannels.discovery,
    provenance.channelIndexes.discoverySha256,
  );
  compareChannelDocument(
    errors,
    "channel-stable",
    path.join(channelsDir, "channels", "stable.json"),
    expectedChannels.stable,
    provenance.channelIndexes.stableSha256,
  );
  compareChannelDocument(
    errors,
    "channel-test",
    path.join(channelsDir, "channels", "test.json"),
    expectedChannels.test,
    provenance.channelIndexes.testSha256,
  );

  return errors;
}

function parseArgs(argv) {
  const options = { trustStorePath: DEFAULT_TRUST_STORE_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--catalog") options.catalogPath = path.resolve(argv[++index]);
    else if (value === "--baseline") options.baselinePath = path.resolve(argv[++index]);
    else if (value === "--provenance") options.provenancePath = path.resolve(argv[++index]);
    else if (value === "--channels-dir") options.channelsDir = path.resolve(argv[++index]);
    else if (value === "--package") options.packagePath = path.resolve(argv[++index]);
    else if (value === "--trust-store") options.trustStorePath = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }

  for (const required of ["catalogPath", "baselinePath", "provenancePath", "channelsDir", "packagePath"]) {
    if (!options[required]) throw new Error(`Missing required argument: ${required}`);
  }
  return options;
}

function printErrors(errors) {
  for (const error of errors) console.error(`[${error.code}] ${error.message}`);
}

async function main() {
  const errors = authorizePublication(parseArgs(process.argv.slice(2)));
  if (errors.length > 0) {
    printErrors(errors);
    process.exitCode = 1;
    return;
  }

  console.log("Publication authorization precheck passed. GitHub mutation may proceed in trusted tooling.");
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
