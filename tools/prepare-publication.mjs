import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { generateChannelDocuments } from "./generate-channel-indexes.mjs";
import { validateCatalogFile } from "./validate-catalog.mjs";
import { validatePackageProjection } from "./validate-package-projection.mjs";
import { verifyPackageIntegrity } from "./verify-package-integrity.mjs";
import {
  DEFAULT_TRUST_STORE_PATH,
  verifyPackageSignature,
} from "./verify-package-signature.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const UPSTREAM_SOURCE_PATH = path.join(
  REPO_ROOT,
  "schemas/upstream/partybeam/v1/source.json",
);
const PROVENANCE_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "schemas/v1/publication-provenance.schema.json",
);
const SIGNATURE_ALGORITHM = "ecdsa-p256-sha256-p1363";
const SURFACE_BY_COMPONENT_KIND = new Map([
  ["tv", "tv"],
  ["androidController", "android"],
  ["browserController", "browser"],
]);
const TOPOLOGY_BY_MANIFEST = new Map([
  ["onePhonePerPlayer", "one-phone-per-player"],
  ["sharedPhone", "shared-phone"],
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function compareOrdinal(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function logicalPackageSha256(manifestSha256, components) {
  const lines = [...components]
    .sort((left, right) => compareOrdinal(left.artifactPath, right.artifactPath))
    .map(
      (component) =>
        `component:${component.kind}:${component.artifactPath}:${component.sha256.toLowerCase()}`,
    );

  const descriptor = [
    "partybeam-package-content-v1",
    `manifest:${manifestSha256.toLowerCase()}`,
    ...lines,
    "",
  ].join("\n");

  return sha256Bytes(Buffer.from(descriptor, "utf8"));
}

function deriveInternetAccess(capabilities) {
  if (capabilities.required.includes("internetAccess")) return "required";
  if (capabilities.optional.includes("internetAccess")) return "optional";
  return "none";
}

function commonRuntimeLocales(components) {
  if (components.length === 0) return [];

  const common = new Set(components[0].runtimeLocales);
  for (const component of components.slice(1)) {
    const current = new Set(component.runtimeLocales);
    for (const locale of [...common]) {
      if (!current.has(locale)) common.delete(locale);
    }
  }

  return [...common];
}

function normalizeSupportUrl(value) {
  if (value === null || value === undefined || value === "") return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || !url.hostname
      || url.username
      || url.password
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function buildCatalogMetadata(manifest) {
  const english = manifest.catalog?.localized?.en;
  if (!english || !english.shortDescription?.trim()) {
    throw new Error("PartyBeam manifest v1 requires usable English catalog metadata.");
  }

  const locales = {};
  for (const locale of manifest.catalogLocales) {
    const localized = manifest.catalog.localized[locale];
    const source = localized?.shortDescription?.trim() ? localized : english;
    locales[locale] = {
      title: source.title?.trim() || manifest.catalog.canonicalTitle,
      summary: source.shortDescription,
    };
  }

  const metadata = {
    defaultLocale: "en",
    locales,
  };

  const supportUrl = normalizeSupportUrl(manifest.catalog.supportUrl);
  if (supportUrl) metadata.supportUrl = supportUrl;

  return metadata;
}

function buildCompatibility(manifest) {
  const topology = TOPOLOGY_BY_MANIFEST.get(manifest.controllerTopology);
  if (!topology) {
    throw new Error(`Unsupported controllerTopology '${manifest.controllerTopology}'.`);
  }

  const surfaces = manifest.components.map((component) => {
    const surface = SURFACE_BY_COMPONENT_KIND.get(component.kind);
    if (!surface) throw new Error(`Unsupported component kind '${component.kind}'.`);
    return surface;
  });

  return {
    gameContractApi: {
      minInclusive: manifest.gameContract.minimumVersion,
      maxExclusive: manifest.gameContract.maximumVersionExclusive,
    },
    surfaces: [...new Set(surfaces)],
    runtimeLocales: commonRuntimeLocales(manifest.components),
    catalogLocales: [...manifest.catalogLocales],
    playerCount: {
      min: manifest.players.minimum,
      max: manifest.players.maximum,
    },
    controllerTopologies: [topology],
    capabilities: {
      required: [...manifest.capabilities.required],
      optional: [...manifest.capabilities.optional],
      internetAccess: deriveInternetAccess(manifest.capabilities),
    },
    standbyResumeSupported: manifest.supportsStandbyResume,
  };
}

function hasPrerelease(version) {
  return version.split("+")[0].includes("-");
}

function formatValidationErrors(errors) {
  return errors
    .map((error) => {
      const location = error.instancePath ? `${error.instancePath}: ` : "";
      return `[${error.code}] ${location}${error.message}`;
    })
    .join("\n");
}

function buildAssetUrl(gameId, version, fileName) {
  const tag = `game-${gameId}-v${version}`;
  return {
    tag,
    url: `https://github.com/PawelWielga/PartyBeam.GameCatalog/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`,
  };
}

function validateEnvelopeAgainstManifest(manifestBytes, manifest, envelope) {
  const manifestSha256 = sha256Bytes(manifestBytes);
  const packageSha256 = logicalPackageSha256(manifestSha256, manifest.components);

  if (envelope.manifestSha256?.toLowerCase() !== manifestSha256) {
    throw new Error(
      `signature envelope manifestSha256 mismatch: expected ${manifestSha256}, got ${envelope.manifestSha256}`,
    );
  }

  if (envelope.packageSha256?.toLowerCase() !== packageSha256) {
    throw new Error(
      `signature envelope packageSha256 mismatch: expected ${packageSha256}, got ${envelope.packageSha256}`,
    );
  }

  if (envelope.signature?.algorithm !== SIGNATURE_ALGORITHM) {
    throw new Error(`signature envelope must use '${SIGNATURE_ALGORITHM}'.`);
  }

  return { manifestSha256, packageSha256 };
}

function validateProvenance(provenance) {
  const schema = readJson(PROVENANCE_SCHEMA_PATH);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (validate(provenance)) return;

  const details = (validate.errors ?? [])
    .map((error) => `${error.instancePath || "/"}: ${error.message}`)
    .join("; ");
  throw new Error(`Generated publication provenance is invalid: ${details}`);
}

function mergeRelease(baseCatalog, manifestBytes, manifest, envelope, packagePath, publishedAt) {
  const packageBytes = fs.readFileSync(packagePath);
  const fileName = path.basename(packagePath);
  const expectedFileName = `${manifest.gameId}-${manifest.version}.partybeam`;

  if (fileName !== expectedFileName) {
    throw new Error(`Package filename must be '${expectedFileName}', got '${fileName}'.`);
  }

  const { manifestSha256, packageSha256 } = validateEnvelopeAgainstManifest(
    manifestBytes,
    manifest,
    envelope,
  );
  const { tag, url: assetUrl } = buildAssetUrl(manifest.gameId, manifest.version, fileName);

  const release = {
    version: manifest.version,
    channel: hasPrerelease(manifest.version) ? "test" : "stable",
    publicationState: "published",
    publishedAt,
    package: {
      assetUrl,
      fileName,
      sizeBytes: packageBytes.length,
      integrity: {
        algorithm: "SHA-256",
        digest: sha256Bytes(packageBytes),
      },
      manifestSha256,
      packageSha256,
      signature: {
        algorithm: envelope.signature.algorithm,
        keyId: envelope.signature.keyId,
        valueBase64: envelope.signature.valueBase64,
      },
    },
    compatibility: buildCompatibility(manifest),
  };

  const candidate = structuredClone(baseCatalog);
  let game = candidate.games.find((entry) => entry.gameId === manifest.gameId);

  if (game) {
    if (game.publisher.id !== manifest.publisher.id) {
      throw new Error(
        `Existing game '${manifest.gameId}' belongs to publisher '${game.publisher.id}', not '${manifest.publisher.id}'.`,
      );
    }
    if (game.releases.some((entry) => entry.version === manifest.version)) {
      throw new Error(
        `Release '${manifest.gameId}@${manifest.version}' already exists. Published exact versions are immutable.`,
      );
    }

    game.publisher.displayName = manifest.publisher.displayName;
    game.catalogMetadata = buildCatalogMetadata(manifest);
    game.releases.push(release);
  } else {
    game = {
      gameId: manifest.gameId,
      publisher: {
        id: manifest.publisher.id,
        displayName: manifest.publisher.displayName,
        kind: "first-party",
      },
      catalogMetadata: buildCatalogMetadata(manifest),
      releases: [release],
    };
    candidate.games.push(game);
    candidate.games.sort((left, right) => compareOrdinal(left.gameId, right.gameId));
  }

  return {
    candidate,
    release,
    tag,
    manifestSha256,
    packageSha256,
  };
}

function writeChannelOutputs(outputDir, channelTexts) {
  if (!outputDir) return;

  const channelsDir = path.join(outputDir, "channels");
  fs.mkdirSync(channelsDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "channels.json"), channelTexts.discovery, "utf8");
  fs.writeFileSync(path.join(channelsDir, "stable.json"), channelTexts.stable, "utf8");
  fs.writeFileSync(path.join(channelsDir, "test.json"), channelTexts.test, "utf8");
}

export function preparePublication({
  catalogPath,
  manifestPath,
  signaturePath,
  packagePath,
  publishedAt,
  outputPath,
  provenancePath = `${outputPath}.provenance.json`,
  channelsOutputDir = null,
  trustStorePath = DEFAULT_TRUST_STORE_PATH,
  overwrite = false,
}) {
  for (const [name, filePath] of [
    ["catalog", catalogPath],
    ["manifest", manifestPath],
    ["signature", signaturePath],
    ["package", packagePath],
    ["trust store", trustStorePath],
  ]) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`${name} file does not exist: ${filePath}`);
    }
  }

  if (!publishedAt) throw new Error("publishedAt is required for deterministic publication metadata.");
  if (!outputPath) throw new Error("outputPath is required.");
  if (!overwrite && (fs.existsSync(outputPath) || fs.existsSync(provenancePath))) {
    throw new Error("Refusing to overwrite existing publication output. Use --force explicitly.");
  }

  const baselineErrors = validateCatalogFile(catalogPath);
  if (baselineErrors.length > 0) {
    throw new Error(`Baseline catalog is invalid:\n${formatValidationErrors(baselineErrors)}`);
  }

  const baseCatalogBytes = fs.readFileSync(catalogPath);
  const baseCatalog = JSON.parse(baseCatalogBytes.toString("utf8"));
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const envelope = readJson(signaturePath);
  const packageContractSource = readJson(UPSTREAM_SOURCE_PATH);
  const trustStoreBytes = fs.readFileSync(trustStorePath);

  const signatureErrors = verifyPackageSignature({
    signaturePath,
    publisherId: manifest.publisher?.id,
    trustStorePath,
  });
  if (signatureErrors.length > 0) {
    throw new Error(
      `Publication signature failed trusted-key verification:\n${formatValidationErrors(signatureErrors)}`,
    );
  }

  const prepared = mergeRelease(
    baseCatalog,
    manifestBytes,
    manifest,
    envelope,
    packagePath,
    publishedAt,
  );

  const candidateText = serializeJson(prepared.candidate);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-publication-"));
  const tempCatalogPath = path.join(tempDir, "catalog.json");

  try {
    fs.writeFileSync(tempCatalogPath, candidateText, "utf8");

    const catalogErrors = validateCatalogFile(tempCatalogPath, { baselinePath: catalogPath });
    const projectionErrors = validatePackageProjection({
      catalogPath: tempCatalogPath,
      gameId: manifest.gameId,
      version: manifest.version,
      manifestPath,
      signaturePath,
    });
    const assetErrors = verifyPackageIntegrity({
      catalogPath: tempCatalogPath,
      gameId: manifest.gameId,
      version: manifest.version,
      packagePath,
    });

    const allErrors = [...catalogErrors, ...projectionErrors, ...assetErrors];
    if (allErrors.length > 0) {
      throw new Error(`Publication candidate failed validation:\n${formatValidationErrors(allErrors)}`);
    }

    const channelDocuments = generateChannelDocuments(prepared.candidate);
    const channelTexts = {
      discovery: serializeJson(channelDocuments.discovery),
      stable: serializeJson(channelDocuments.stable),
      test: serializeJson(channelDocuments.test),
    };

    const provenance = {
      schemaVersion: 1,
      gameId: manifest.gameId,
      version: manifest.version,
      channel: prepared.release.channel,
      releaseTag: prepared.tag,
      assetUrl: prepared.release.package.assetUrl,
      publishedAt,
      baselineCatalogSha256: sha256Bytes(baseCatalogBytes),
      candidateCatalogSha256: sha256Bytes(Buffer.from(candidateText, "utf8")),
      trustStoreSha256: sha256Bytes(trustStoreBytes),
      channelIndexes: {
        discoverySha256: sha256Bytes(Buffer.from(channelTexts.discovery, "utf8")),
        stableSha256: sha256Bytes(Buffer.from(channelTexts.stable, "utf8")),
        testSha256: sha256Bytes(Buffer.from(channelTexts.test, "utf8")),
      },
      releaseAsset: {
        fileName: prepared.release.package.fileName,
        sizeBytes: prepared.release.package.sizeBytes,
        sha256: prepared.release.package.integrity.digest,
      },
      manifestSha256: prepared.manifestSha256,
      packageSha256: prepared.packageSha256,
      signature: {
        algorithm: prepared.release.package.signature.algorithm,
        keyId: prepared.release.package.signature.keyId,
      },
      partyBeamPackageContract: packageContractSource,
      cryptographicSignatureVerified: true,
      componentPayloadsVerified: false,
      fullPackageVerification: false,
      cryptographicVerificationNote:
        "ECDSA P-256 P1363 signature over packageSha256 was verified against an active publisher key. Component payload bytes inside the .partybeam container are not yet independently re-verified here; full PartyBeam GamePackageVerifier verification remains required before final GitHub Release publication.",
    };

    validateProvenance(provenance);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.mkdirSync(path.dirname(provenancePath), { recursive: true });
    fs.writeFileSync(outputPath, candidateText, "utf8");
    fs.writeFileSync(provenancePath, serializeJson(provenance), "utf8");
    writeChannelOutputs(channelsOutputDir, channelTexts);

    return {
      candidate: prepared.candidate,
      provenance,
      channelDocuments,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = {
    overwrite: false,
    trustStorePath: DEFAULT_TRUST_STORE_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--catalog") options.catalogPath = path.resolve(argv[++index]);
    else if (value === "--manifest") options.manifestPath = path.resolve(argv[++index]);
    else if (value === "--signature") options.signaturePath = path.resolve(argv[++index]);
    else if (value === "--package") options.packagePath = path.resolve(argv[++index]);
    else if (value === "--published-at") options.publishedAt = argv[++index];
    else if (value === "--output") options.outputPath = path.resolve(argv[++index]);
    else if (value === "--provenance") options.provenancePath = path.resolve(argv[++index]);
    else if (value === "--channels-output-dir") options.channelsOutputDir = path.resolve(argv[++index]);
    else if (value === "--trust-store") options.trustStorePath = path.resolve(argv[++index]);
    else if (value === "--force") options.overwrite = true;
    else throw new Error(`Unknown argument: ${value}`);
  }

  for (const required of [
    "catalogPath",
    "manifestPath",
    "signaturePath",
    "packagePath",
    "publishedAt",
    "outputPath",
  ]) {
    if (!options[required]) throw new Error(`Missing required argument: ${required}`);
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { provenance } = preparePublication(options);
  console.log(
    `Publication candidate prepared: ${provenance.gameId}@${provenance.version} (${provenance.channel}), ${provenance.releaseTag}`,
  );
  console.log("Trusted publisher signature verified. No GitHub Release was created; full component payload verification is still required.");
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
