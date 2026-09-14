import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateCatalogFile } from "./validate-catalog.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const MANIFEST_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "schemas/upstream/partybeam/v1/game-package-manifest.schema.json",
);
const SIGNATURE_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "schemas/upstream/partybeam/v1/game-package-signature-envelope.schema.json",
);
const SIGNATURE_ALGORITHM = "ecdsa-p256-sha256-p1363";
const INTERNET_ACCESS_CAPABILITY = "internetAccess";
const REQUIRED_COMPONENT_KINDS = ["tv", "androidController", "browserController"];
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildSchemaValidator(schemaPath) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson(schemaPath));
}

function schemaErrors(validate, value, prefix) {
  if (validate(value)) {
    return [];
  }

  return (validate.errors ?? []).map((error) =>
    issue(
      `${prefix}-schema-${error.keyword}`,
      error.instancePath || "/",
      error.message ?? "schema validation failed",
    ),
  );
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

  const common = new Map(
    (components[0].runtimeLocales ?? []).map((locale) => [locale.toLowerCase(), locale]),
  );
  for (const component of components.slice(1)) {
    const current = new Set((component.runtimeLocales ?? []).map((locale) => locale.toLowerCase()));
    for (const key of [...common.keys()]) {
      if (!current.has(key)) {
        common.delete(key);
      }
    }
  }
  return [...common.values()];
}

function compareOrdinal(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function logicalPackageSha256(manifestSha256, components) {
  const componentLines = [...components]
    .sort((left, right) => compareOrdinal(left.artifactPath, right.artifactPath))
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
  if ((capabilities.required ?? []).includes(INTERNET_ACCESS_CAPABILITY)) {
    return "required";
  }
  if ((capabilities.optional ?? []).includes(INTERNET_ACCESS_CAPABILITY)) {
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

function validateSignatureEncoding(signature, errors) {
  const encoded = signature.valueBase64 ?? "";
  if (!/^[A-Za-z0-9+/]{86}==$/.test(encoded)) {
    errors.push(
      issue(
        "projection-signature-encoding",
        "/signature/valueBase64",
        "P-256 P1363 signature must be canonical Base64 for exactly 64 bytes",
      ),
    );
    return;
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== encoded) {
    errors.push(
      issue(
        "projection-signature-size",
        "/signature/valueBase64",
        "P-256 P1363 signature must decode to exactly 64 bytes",
      ),
    );
  }
}

function findLocalizedMetadata(localized, locale) {
  const target = locale.toLowerCase();
  for (const [key, value] of Object.entries(localized ?? {})) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
}

function normalizedSupportUrl(value) {
  if (value === null || value === undefined || value === "") return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function isValidWanDestination(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && !url.hash;
  } catch {
    return false;
  }
}

function validateCaseInsensitiveUnique(values, pathPrefix, code, label, errors) {
  const seen = new Set();
  for (const value of values) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      errors.push(
        issue(code, pathPrefix, `${label} '${value}' is duplicated when compared case-insensitively`),
      );
    }
    seen.add(normalized);
  }
}

function validateManifestSemantics(manifest, errors) {
  const componentIds = new Set();
  const artifactPaths = new Set();

  for (const component of manifest.components) {
    if (componentIds.has(component.id)) {
      errors.push(
        issue(
          "manifest-duplicate-component-id",
          "/components",
          `component id '${component.id}' is declared more than once`,
        ),
      );
    }
    componentIds.add(component.id);

    if (artifactPaths.has(component.artifactPath)) {
      errors.push(
        issue(
          "manifest-duplicate-artifact-path",
          "/components",
          `artifactPath '${component.artifactPath}' is referenced by more than one component`,
        ),
      );
    }
    artifactPaths.add(component.artifactPath);

    validateCaseInsensitiveUnique(
      component.runtimeLocales,
      `/components/${component.id}/runtimeLocales`,
      "manifest-duplicate-runtime-locale",
      "runtime locale",
      errors,
    );
  }

  for (const kind of REQUIRED_COMPONENT_KINDS) {
    const count = manifest.components.filter((component) => component.kind === kind).length;
    if (count !== 1) {
      errors.push(
        issue(
          "manifest-required-component-count",
          "/components",
          `manifest v1 requires exactly one '${kind}' component; found ${count}`,
        ),
      );
    }
  }

  validateCaseInsensitiveUnique(
    manifest.catalogLocales,
    "/catalogLocales",
    "manifest-duplicate-catalog-locale",
    "catalog locale",
    errors,
  );

  const declaredCatalogLocales = new Set(manifest.catalogLocales.map((locale) => locale.toLowerCase()));
  const localizedKeys = Object.keys(manifest.catalog.localized);
  validateCaseInsensitiveUnique(
    localizedKeys,
    "/catalog/localized",
    "manifest-duplicate-localized-key",
    "localized catalog key",
    errors,
  );

  for (const locale of localizedKeys) {
    if (!declaredCatalogLocales.has(locale.toLowerCase())) {
      errors.push(
        issue(
          "manifest-localized-locale-not-declared",
          `/catalog/localized/${locale}`,
          `localized catalog key '${locale}' is not declared in catalogLocales`,
        ),
      );
    }
  }

  const requiredCapabilities = new Set(manifest.capabilities.required);
  const optionalCapabilities = new Set(manifest.capabilities.optional);
  for (const capability of optionalCapabilities) {
    if (requiredCapabilities.has(capability)) {
      errors.push(
        issue(
          "manifest-capability-required-and-optional",
          "/capabilities",
          `capability '${capability}' cannot be both required and optional`,
        ),
      );
    }
  }

  const hasInternetAccess = requiredCapabilities.has(INTERNET_ACCESS_CAPABILITY)
    || optionalCapabilities.has(INTERNET_ACCESS_CAPABILITY);
  const allowlist = manifest.network.outboundAllowlist;

  if (hasInternetAccess && allowlist.length === 0) {
    errors.push(
      issue(
        "manifest-missing-wan-allowlist",
        "/network/outboundAllowlist",
        "internetAccess requires at least one explicitly declared HTTPS destination",
      ),
    );
  }
  if (!hasInternetAccess && allowlist.length > 0) {
    errors.push(
      issue(
        "manifest-wan-without-internet-access",
        "/network/outboundAllowlist",
        "outbound WAN destinations cannot be declared without internetAccess capability",
      ),
    );
  }

  for (const destination of allowlist) {
    if (!isValidWanDestination(destination)) {
      errors.push(
        issue(
          "manifest-invalid-wan-destination",
          "/network/outboundAllowlist",
          `WAN destination '${destination}' must be an absolute HTTPS URL without user-info or fragment data`,
        ),
      );
    }
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

  const catalog = readJson(catalogPath);
  const { bytes: manifestBytes, value: manifest } = readDocument(manifestPath);
  const { value: envelope } = readDocument(signaturePath);

  const manifestValidator = buildSchemaValidator(MANIFEST_SCHEMA_PATH);
  const signatureValidator = buildSchemaValidator(SIGNATURE_SCHEMA_PATH);
  errors.push(...schemaErrors(manifestValidator, manifest, "manifest"));
  errors.push(...schemaErrors(signatureValidator, envelope, "signature"));
  if (errors.length > 0) {
    return errors;
  }

  validateManifestSemantics(manifest, errors);
  if (errors.length > 0) {
    return errors;
  }

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
  compareValue(errors, "projection-publisher-id", "/publisher/id", game.publisher.id, manifest.publisher.id);
  compareValue(
    errors,
    "projection-publisher-display-name",
    "/publisher/displayName",
    game.publisher.displayName,
    manifest.publisher.displayName,
  );

  const manifestHash = sha256(manifestBytes);
  compareValue(
    errors,
    "projection-manifest-hash-envelope",
    "/package/manifestSha256",
    envelope.manifestSha256.toLowerCase(),
    manifestHash,
  );
  compareValue(
    errors,
    "projection-manifest-hash-catalog",
    "/package/manifestSha256",
    release.package.manifestSha256,
    manifestHash,
  );

  const logicalHash = logicalPackageSha256(manifestHash, manifest.components);
  compareValue(
    errors,
    "projection-package-hash-envelope",
    "/package/packageSha256",
    envelope.packageSha256.toLowerCase(),
    logicalHash,
  );
  compareValue(
    errors,
    "projection-package-hash-catalog",
    "/package/packageSha256",
    release.package.packageSha256,
    logicalHash,
  );

  const signature = envelope.signature;
  if (signature.algorithm !== SIGNATURE_ALGORITHM) {
    errors.push(
      issue(
        "projection-signature-algorithm",
        "/signature/algorithm",
        `signature algorithm must be '${SIGNATURE_ALGORITHM}'`,
      ),
    );
  }
  validateSignatureEncoding(signature, errors);

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
    manifest.gameContract.minimumVersion,
  );
  compareValue(
    errors,
    "projection-game-contract-max",
    "/compatibility/gameContractApi/maxExclusive",
    release.compatibility.gameContractApi.maxExclusive,
    manifest.gameContract.maximumVersionExclusive,
  );
  compareValue(
    errors,
    "projection-player-min",
    "/compatibility/playerCount/min",
    release.compatibility.playerCount.min,
    manifest.players.minimum,
  );
  compareValue(
    errors,
    "projection-player-max",
    "/compatibility/playerCount/max",
    release.compatibility.playerCount.max,
    manifest.players.maximum,
  );

  const manifestTopology = TOPOLOGY_BY_MANIFEST.get(manifest.controllerTopology);
  compareSet(
    errors,
    "projection-controller-topology",
    "/compatibility/controllerTopologies",
    release.compatibility.controllerTopologies,
    manifestTopology ? [manifestTopology] : [],
  );

  const surfaces = manifest.components
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
    release.compatibility.runtimeLocales.map((locale) => locale.toLowerCase()),
    commonRuntimeLocales(manifest.components).map((locale) => locale.toLowerCase()),
  );
  compareSet(
    errors,
    "projection-catalog-locales",
    "/compatibility/catalogLocales",
    release.compatibility.catalogLocales.map((locale) => locale.toLowerCase()),
    manifest.catalogLocales.map((locale) => locale.toLowerCase()),
  );
  compareSet(
    errors,
    "projection-required-capabilities",
    "/compatibility/capabilities/required",
    release.compatibility.capabilities.required,
    manifest.capabilities.required,
  );
  compareSet(
    errors,
    "projection-optional-capabilities",
    "/compatibility/capabilities/optional",
    release.compatibility.capabilities.optional,
    manifest.capabilities.optional,
  );
  compareValue(
    errors,
    "projection-internet-access",
    "/compatibility/capabilities/internetAccess",
    release.compatibility.capabilities.internetAccess,
    deriveInternetAccess(manifest.capabilities),
  );
  compareValue(
    errors,
    "projection-standby-resume",
    "/compatibility/standbyResumeSupported",
    release.compatibility.standbyResumeSupported,
    manifest.supportsStandbyResume,
  );

  if (!manifest.catalogLocales.some(
    (locale) => locale.toLowerCase() === game.catalogMetadata.defaultLocale.toLowerCase(),
  )) {
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
    normalizedSupportUrl(manifest.catalog.supportUrl),
  );

  const englishMetadata = findLocalizedMetadata(manifest.catalog.localized, "en");
  for (const [locale, metadata] of Object.entries(game.catalogMetadata.locales)) {
    const localized = findLocalizedMetadata(manifest.catalog.localized, locale);
    const manifestMetadata = localized?.shortDescription?.trim() ? localized : englishMetadata;
    if (!manifestMetadata) {
      errors.push(
        issue(
          "projection-localized-metadata-missing",
          `/catalogMetadata/locales/${locale}`,
          `manifest has no usable localized metadata or English fallback for '${locale}'`,
        ),
      );
      continue;
    }

    compareValue(
      errors,
      "projection-localized-title",
      `/catalogMetadata/locales/${locale}/title`,
      metadata.title,
      manifestMetadata.title?.trim() || manifest.catalog.canonicalTitle,
    );
    compareValue(
      errors,
      "projection-localized-summary",
      `/catalogMetadata/locales/${locale}/summary`,
      metadata.summary,
      manifestMetadata.shortDescription,
    );
  }

  for (const component of manifest.components) {
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
