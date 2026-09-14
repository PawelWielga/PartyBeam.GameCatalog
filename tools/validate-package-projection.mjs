import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { validateCatalogFile } from "./validate-catalog.mjs";

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

function issue(code, instancePath, message) {
  return { code, instancePath, message };
}

function readDocument(filePath) {
  const bytes = fs.readFileSync(filePath);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function normalizedSet(values) {
  return [...new Set(values)].sort();
}

function sameSet(left, right) {
  return JSON.stringify(normalizedSet(left)) === JSON.stringify(normalizedSet(right));
}

function commonRuntimeLocales(components) {
  if (components.length === 0) {
    return [];
  }

  const first = new Set(components[0].runtimeLocales ?? []);
  for (const component of components.slice(1)) {
    const current = new Set(component.runtimeLocales ?? []);
    for (const locale of [...first]) {
      if (!current.has(locale)) {
        first.delete(locale);
      }
    }
  }
  return [...first];
}

function logicalPackageSha256(manifestSha256, components) {
  const componentLines = [...components]
    .sort((left, right) => left.artifactPath.localeCompare(right.artifactPath, "en", { sensitivity: "variant" }))
    .map(
      (component) =>
        `component:${component.kind}:${component.artifactPath}:${component.sha256.toLowerCase()}`,
    );

  const descriptor = [
    "partybeam-package-content-v1",
    `manifest:${manifestSha256.toLowerCase()}`,
    ...componentLines,
    "",
  ].join("\n");

  return sha256(Buffer.from(descriptor, "utf8"));
}

function deriveInternetAccess(capabilities) {
  if ((capabilities.required ?? []).includes("internetAccess")) {
    return "required";
  }
  if ((capabilities.optional ?? []).includes("internetAccess")) {
    return "optional";
  }
  return "none";
}

function compareValue(errors, code, instancePath, actual, expected) {
  if (actual !== expected) {
    errors.push(issue(code, instancePath, `catalog value '${actual}' does not match manifest value '${expected}'`));
  }
}

function compareSet(errors, code, instancePath, actual, expected) {
  if (!sameSet(actual ?? [], expected ?? [])) {
    errors.push(
      issue(
        code,
        instancePath,
        `catalog values ${JSON.stringify(actual ?? [])} do not match manifest projection ${JSON.stringify(expected ?? [])}`,
      ),
    );
  }
}

export function validatePackageProjection({
  catalogPath,
  gameId,
  version,
  manifestPath,
  signaturePath,
}) {
  const errors = [];

  const catalogErrors = validateCatalogFile(catalogPath);
  if (catalogErrors.length > 0) {
    return catalogErrors.map((error) => ({ ...error, code: `catalog-${error.code}` }));
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const { bytes: manifestBytes, value: manifest } = readDocument(manifestPath);
  const { value: envelope } = readDocument(signaturePath);

  const game = catalog.games.find((candidate) => candidate.gameId === gameId);
  if (!game) {
    return [issue("projection-game-missing", "/games", `catalog has no game '${gameId}'`)];
  }

  const release = game.releases.find((candidate) => candidate.version === version);
  if (!release) {
    return [
      issue(
        "projection-release-missing",
        `/games/${gameId}/releases`,
        `catalog has no exact release '${gameId}@${version}'`,
      ),
    ];
  }

  compareValue(errors, "projection-game-id", "/gameId", game.gameId, manifest.gameId);
  compareValue(errors, "projection-release-version", "/version", release.version, manifest.version);
  compareValue(errors, "projection-publisher-id", "/publisher/id", game.publisher.id, manifest.publisher?.id);
  compareValue(
    errors,
    "projection-publisher-display-name",
    "/publisher/displayName",
    game.publisher.displayName,
    manifest.publisher?.displayName,
  );

  const manifestHash = sha256(manifestBytes);
  compareValue(
    errors,
    "projection-manifest-hash-envelope",
    "/package/manifestSha256",
    envelope.manifestSha256,
    manifestHash,
  );
  compareValue(
    errors,
    "projection-manifest-hash-catalog",
    "/package/manifestSha256",
    release.package.manifestSha256,
    manifestHash,
  );

  const logicalHash = logicalPackageSha256(manifestHash, manifest.components ?? []);
  compareValue(
    errors,
    "projection-package-hash-envelope",
    "/package/packageSha256",
    envelope.packageSha256,
    logicalHash,
  );
  compareValue(
    errors,
    "projection-package-hash-catalog",
    "/package/packageSha256",
    release.package.packageSha256,
    logicalHash,
  );

  if (envelope.schemaVersion !== 1) {
    errors.push(
      issue(
        "projection-envelope-schema",
        "/signature/schemaVersion",
        `unsupported signature envelope schemaVersion '${envelope.schemaVersion}'`,
      ),
    );
  }

  const signature = envelope.signature ?? {};
  if (signature.algorithm !== SIGNATURE_ALGORITHM) {
    errors.push(
      issue(
        "projection-signature-algorithm",
        "/signature/algorithm",
        `signature algorithm must be '${SIGNATURE_ALGORITHM}'`,
      ),
    );
  }

  let signatureBytes = null;
  try {
    signatureBytes = Buffer.from(signature.valueBase64 ?? "", "base64");
  } catch {
    signatureBytes = null;
  }
  if (!signatureBytes || signatureBytes.length !== 64) {
    errors.push(
      issue(
        "projection-signature-size",
        "/signature/valueBase64",
        "P-256 P1363 signature must decode to exactly 64 bytes",
      ),
    );
  }

  compareValue(
    errors,
    "projection-signature-algorithm-catalog",
    "/package/signature/algorithm",
    release.package.signature.algorithm,
    signature.algorithm,
  );
  compareValue(
    errors,
    "projection-signature-key-catalog",
    "/package/signature/keyId",
    release.package.signature.keyId,
    signature.keyId,
  );
  compareValue(
    errors,
    "projection-signature-value-catalog",
    "/package/signature/valueBase64",
    release.package.signature.valueBase64,
    signature.valueBase64,
  );

  compareValue(
    errors,
    "projection-game-contract-min",
    "/compatibility/gameContractApi/minInclusive",
    release.compatibility.gameContractApi.minInclusive,
    manifest.gameContract?.minimumVersion,
  );
  compareValue(
    errors,
    "projection-game-contract-max",
    "/compatibility/gameContractApi/maxExclusive",
    release.compatibility.gameContractApi.maxExclusive,
    manifest.gameContract?.maximumVersionExclusive,
  );
  compareValue(
    errors,
    "projection-player-min",
    "/compatibility/playerCount/min",
    release.compatibility.playerCount.min,
    manifest.players?.minimum,
  );
  compareValue(
    errors,
    "projection-player-max",
    "/compatibility/playerCount/max",
    release.compatibility.playerCount.max,
    manifest.players?.maximum,
  );

  const manifestTopology = TOPOLOGY_BY_MANIFEST.get(manifest.controllerTopology);
  compareSet(
    errors,
    "projection-controller-topology",
    "/compatibility/controllerTopologies",
    release.compatibility.controllerTopologies,
    manifestTopology ? [manifestTopology] : [],
  );

  const surfaces = (manifest.components ?? [])
    .map((component) => SURFACE_BY_COMPONENT_KIND.get(component.kind))
    .filter(Boolean);
  compareSet(
    errors,
    "projection-surfaces",
    "/compatibility/surfaces",
    release.compatibility.surfaces,
    surfaces,
  );
  compareSet(
    errors,
    "projection-runtime-locales",
    "/compatibility/runtimeLocales",
    release.compatibility.runtimeLocales,
    commonRuntimeLocales(manifest.components ?? []),
  );
  compareSet(
    errors,
    "projection-catalog-locales",
    "/compatibility/catalogLocales",
    release.compatibility.catalogLocales,
    manifest.catalogLocales ?? [],
  );
  compareSet(
    errors,
    "projection-required-capabilities",
    "/compatibility/capabilities/required",
    release.compatibility.capabilities.required,
    manifest.capabilities?.required ?? [],
  );
  compareSet(
    errors,
    "projection-optional-capabilities",
    "/compatibility/capabilities/optional",
    release.compatibility.capabilities.optional,
    manifest.capabilities?.optional ?? [],
  );
  compareValue(
    errors,
    "projection-internet-access",
    "/compatibility/capabilities/internetAccess",
    release.compatibility.capabilities.internetAccess,
    deriveInternetAccess(manifest.capabilities ?? {}),
  );
  compareValue(
    errors,
    "projection-standby-resume",
    "/compatibility/standbyResumeSupported",
    release.compatibility.standbyResumeSupported,
    manifest.supportsStandbyResume,
  );

  if (!manifest.catalogLocales?.includes(game.catalogMetadata.defaultLocale)) {
    errors.push(
      issue(
        "projection-default-locale",
        "/catalogMetadata/defaultLocale",
        `catalog defaultLocale '${game.catalogMetadata.defaultLocale}' is not declared by the manifest`,
      ),
    );
  }

  compareValue(
    errors,
    "projection-support-url",
    "/catalogMetadata/supportUrl",
    game.catalogMetadata.supportUrl ?? null,
    manifest.catalog?.supportUrl ?? null,
  );

  for (const [locale, metadata] of Object.entries(game.catalogMetadata.locales ?? {})) {
    const manifestMetadata = manifest.catalog?.localized?.[locale];
    if (!manifestMetadata) {
      errors.push(
        issue(
          "projection-localized-metadata-missing",
          `/catalogMetadata/locales/${locale}`,
          `manifest does not contain localized catalog metadata for '${locale}'`,
        ),
      );
      continue;
    }

    compareValue(
      errors,
      "projection-localized-title",
      `/catalogMetadata/locales/${locale}/title`,
      metadata.title,
      manifestMetadata.title ?? manifest.catalog.canonicalTitle,
    );
    compareValue(
      errors,
      "projection-localized-summary",
      `/catalogMetadata/locales/${locale}/summary`,
      metadata.summary,
      manifestMetadata.shortDescription,
    );
  }

  for (const component of manifest.components ?? []) {
    if (component.releaseVersion !== manifest.version) {
      errors.push(
        issue(
          "projection-mixed-component-version",
          `/manifest/components/${component.id}/releaseVersion`,
          `component '${component.id}' uses '${component.releaseVersion}', expected '${manifest.version}'`,
        ),
      );
    }
  }

  return errors;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--catalog") options.catalogPath = path.resolve(argv[++index]);
    else if (value === "--game") options.gameId = argv[++index];
    else if (value === "--version") options.version = argv[++index];
    else if (value === "--manifest") options.manifestPath = path.resolve(argv[++index]);
    else if (value === "--signature") options.signaturePath = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }

  for (const required of ["catalogPath", "gameId", "version", "manifestPath", "signaturePath"]) {
    if (!options[required]) throw new Error(`Missing required argument: ${required}`);
  }
  return options;
}

function printErrors(errors) {
  for (const error of errors) {
    console.error(`[${error.code}] ${error.instancePath}: ${error.message}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const errors = validatePackageProjection(options);
  if (errors.length > 0) {
    printErrors(errors);
    process.exitCode = 1;
    return;
  }
  console.log(`Catalog projection valid for ${options.gameId}@${options.version}.`);
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
