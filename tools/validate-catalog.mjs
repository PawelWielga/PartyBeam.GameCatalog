import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { compareSemver, hasPrerelease } from "./semver.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
export const DEFAULT_SCHEMA_PATH = path.join(REPO_ROOT, "schemas/v1/catalog.schema.json");
export const DEFAULT_CATALOG_PATH = path.join(REPO_ROOT, "catalog/v1/catalog.json");
const ENGLISH_LOCALE = "en";
const INTERNET_ACCESS_CAPABILITY = "internetAccess";

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON from ${filePath}: ${error.message}`);
  }
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function sameValue(left, right) {
  return stableSerialize(left) === stableSerialize(right);
}

function issue(code, instancePath, message) {
  return { code, instancePath, message };
}

function buildSchemaValidator(schemaPath) {
  const schema = readJson(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  if (!ajv.validateSchema(schema)) {
    const details = ajv.errorsText(ajv.errors, { separator: "; " });
    throw new Error(`Catalog schema is invalid: ${details}`);
  }

  return ajv.compile(schema);
}

function validateOfficialReleaseUrl(assetUrl, fileName, instancePath) {
  const errors = [];
  let parsed;

  try {
    parsed = new URL(assetUrl);
  } catch {
    return [issue("asset-url-invalid", instancePath, "assetUrl must be a valid URL")];
  }

  if (parsed.protocol !== "https:") {
    errors.push(issue("asset-url-scheme", instancePath, "assetUrl must use HTTPS"));
  }

  if (parsed.hostname !== "github.com") {
    errors.push(issue("asset-url-host", instancePath, "assetUrl must point to github.com"));
    return errors;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const expectedPrefix = ["PawelWielga", "PartyBeam.GameCatalog", "releases", "download"];
  const prefixMatches = expectedPrefix.every((segment, index) => segments[index] === segment);

  if (!prefixMatches || segments.length < 6) {
    errors.push(
      issue(
        "asset-url-repository",
        instancePath,
        "assetUrl must be a PartyBeam.GameCatalog GitHub Release asset URL",
      ),
    );
    return errors;
  }

  let urlFileName;
  try {
    urlFileName = decodeURIComponent(segments.at(-1));
  } catch {
    errors.push(issue("asset-url-encoding", instancePath, "assetUrl contains invalid URL encoding"));
    return errors;
  }

  if (urlFileName !== fileName) {
    errors.push(
      issue(
        "asset-url-filename",
        instancePath,
        `assetUrl filename '${urlFileName}' does not match package.fileName '${fileName}'`,
      ),
    );
  }

  return errors;
}

function validateBaselineImmutability(candidate, baseline) {
  const errors = [];
  const candidateGames = new Map(candidate.games.map((game) => [game.gameId, game]));

  for (const baselineGame of baseline.games ?? []) {
    const candidateGame = candidateGames.get(baselineGame.gameId);
    if (!candidateGame) {
      errors.push(
        issue(
          "game-history-removed",
          `/games/${baselineGame.gameId}`,
          `existing game '${baselineGame.gameId}' cannot be removed from canonical catalog history; delist its releases instead`,
        ),
      );
      continue;
    }

    if (candidateGame.publisher?.id !== baselineGame.publisher?.id) {
      errors.push(
        issue(
          "publisher-identity-changed",
          `/games/${baselineGame.gameId}/publisher/id`,
          `publisher.id for existing game '${baselineGame.gameId}' is immutable`,
        ),
      );
    }

    const candidateReleases = new Map(
      (candidateGame.releases ?? []).map((release) => [release.version, release]),
    );

    for (const baselineRelease of baselineGame.releases ?? []) {
      const releasePath = `/games/${baselineGame.gameId}/releases/${baselineRelease.version}`;
      const candidateRelease = candidateReleases.get(baselineRelease.version);
      if (!candidateRelease) {
        errors.push(
          issue(
            "release-history-removed",
            releasePath,
            `existing release ${baselineGame.gameId}@${baselineRelease.version} cannot be removed from canonical history; set publicationState to 'delisted' instead`,
          ),
        );
        continue;
      }

      if (!sameValue(candidateRelease.package, baselineRelease.package)) {
        errors.push(
          issue(
            "release-package-mutated",
            `${releasePath}/package`,
            `package metadata for immutable release ${baselineGame.gameId}@${baselineRelease.version} changed`,
          ),
        );
      }

      if (!sameValue(candidateRelease.compatibility, baselineRelease.compatibility)) {
        errors.push(
          issue(
            "release-compatibility-mutated",
            `${releasePath}/compatibility`,
            `compatibility projection for immutable release ${baselineGame.gameId}@${baselineRelease.version} changed`,
          ),
        );
      }

      if (candidateRelease.publishedAt !== baselineRelease.publishedAt) {
        errors.push(
          issue(
            "release-published-at-mutated",
            `${releasePath}/publishedAt`,
            `publishedAt for immutable release ${baselineGame.gameId}@${baselineRelease.version} changed`,
          ),
        );
      }
    }
  }

  return errors;
}

export function validateCatalogObject(
  catalog,
  {
    schemaPath = DEFAULT_SCHEMA_PATH,
    baseline = null,
    enforceCurrentPublisherPolicy = true,
  } = {},
) {
  const errors = [];
  const validateSchema = buildSchemaValidator(schemaPath);

  if (!validateSchema(catalog)) {
    for (const schemaError of validateSchema.errors ?? []) {
      errors.push(
        issue(
          `schema-${schemaError.keyword}`,
          schemaError.instancePath || "/",
          schemaError.message ?? "schema validation failed",
        ),
      );
    }
    return errors;
  }

  const gameIds = new Set();

  catalog.games.forEach((game, gameIndex) => {
    const gamePath = `/games/${gameIndex}`;

    if (gameIds.has(game.gameId)) {
      errors.push(issue("duplicate-game-id", `${gamePath}/gameId`, `duplicate gameId '${game.gameId}'`));
    }
    gameIds.add(game.gameId);

    if (!(game.catalogMetadata.defaultLocale in game.catalogMetadata.locales)) {
      errors.push(
        issue(
          "default-locale-missing",
          `${gamePath}/catalogMetadata/defaultLocale`,
          `defaultLocale '${game.catalogMetadata.defaultLocale}' must exist in catalogMetadata.locales`,
        ),
      );
    }

    if (enforceCurrentPublisherPolicy && game.publisher.kind !== "first-party") {
      errors.push(
        issue(
          "publisher-not-approved-for-mvp",
          `${gamePath}/publisher/kind`,
          "MVP publication currently accepts first-party publishers only",
        ),
      );
    }

    const releaseVersions = new Set();

    game.releases.forEach((release, releaseIndex) => {
      const releasePath = `${gamePath}/releases/${releaseIndex}`;
      const compatibilityPath = `${releasePath}/compatibility`;

      if (releaseVersions.has(release.version)) {
        errors.push(
          issue(
            "duplicate-release-version",
            `${releasePath}/version`,
            `duplicate release identity ${game.gameId}@${release.version}`,
          ),
        );
      }
      releaseVersions.add(release.version);

      const prerelease = hasPrerelease(release.version);
      if (release.channel === "stable" && prerelease) {
        errors.push(
          issue(
            "stable-is-prerelease",
            `${releasePath}/channel`,
            `stable release '${release.version}' must not be a SemVer prerelease`,
          ),
        );
      }
      if (release.channel === "test" && !prerelease) {
        errors.push(
          issue(
            "test-is-stable-version",
            `${releasePath}/channel`,
            `test release '${release.version}' must use a SemVer prerelease version`,
          ),
        );
      }

      const contractRange = release.compatibility.gameContractApi;
      if (compareSemver(contractRange.minInclusive, contractRange.maxExclusive) >= 0) {
        errors.push(
          issue(
            "game-contract-range",
            `${compatibilityPath}/gameContractApi`,
            "gameContractApi.minInclusive must be lower than maxExclusive",
          ),
        );
      }

      if (release.compatibility.playerCount.min > release.compatibility.playerCount.max) {
        errors.push(
          issue(
            "player-count-range",
            `${compatibilityPath}/playerCount`,
            "playerCount.min must be less than or equal to playerCount.max",
          ),
        );
      }

      if (!release.compatibility.runtimeLocales.some((locale) => locale.toLowerCase() === ENGLISH_LOCALE)) {
        errors.push(
          issue(
            "runtime-english-fallback-missing",
            `${compatibilityPath}/runtimeLocales`,
            "PartyBeam package manifest v1 requires English ('en') as a runtime locale fallback",
          ),
        );
      }

      if (!release.compatibility.catalogLocales.some((locale) => locale.toLowerCase() === ENGLISH_LOCALE)) {
        errors.push(
          issue(
            "catalog-english-fallback-missing",
            `${compatibilityPath}/catalogLocales`,
            "PartyBeam package manifest v1 requires English ('en') as a catalog locale fallback",
          ),
        );
      }

      const requiredCapabilities = new Set(release.compatibility.capabilities.required);
      const optionalCapabilities = new Set(release.compatibility.capabilities.optional);
      for (const capability of optionalCapabilities) {
        if (requiredCapabilities.has(capability)) {
          errors.push(
            issue(
              "capability-required-and-optional",
              `${compatibilityPath}/capabilities`,
              `capability '${capability}' cannot be both required and optional`,
            ),
          );
        }
      }

      const expectedInternetAccess = requiredCapabilities.has(INTERNET_ACCESS_CAPABILITY)
        ? "required"
        : optionalCapabilities.has(INTERNET_ACCESS_CAPABILITY)
          ? "optional"
          : "none";

      if (release.compatibility.capabilities.internetAccess !== expectedInternetAccess) {
        errors.push(
          issue(
            "internet-access-summary",
            `${compatibilityPath}/capabilities/internetAccess`,
            `internetAccess must be '${expectedInternetAccess}' based on required/optional capability declarations`,
          ),
        );
      }

      const catalogLocales = new Set(Object.keys(game.catalogMetadata.locales));
      for (const locale of release.compatibility.catalogLocales) {
        if (!catalogLocales.has(locale)) {
          errors.push(
            issue(
              "compatibility-catalog-locale-missing",
              `${compatibilityPath}/catalogLocales`,
              `catalog locale '${locale}' has no catalogMetadata.locales entry`,
            ),
          );
        }
      }

      errors.push(
        ...validateOfficialReleaseUrl(
          release.package.assetUrl,
          release.package.fileName,
          `${releasePath}/package/assetUrl`,
        ),
      );
    });
  });

  if (baseline) {
    errors.push(...validateBaselineImmutability(catalog, baseline));
  }

  return errors;
}

export function validateCatalogFile(
  catalogPath,
  { schemaPath = DEFAULT_SCHEMA_PATH, baselinePath = null, enforceCurrentPublisherPolicy = true } = {},
) {
  const catalog = readJson(catalogPath);
  const baseline = baselinePath ? readJson(baselinePath) : null;
  return validateCatalogObject(catalog, {
    schemaPath,
    baseline,
    enforceCurrentPublisherPolicy,
  });
}

function parseArgs(argv) {
  const options = {
    catalogPath: DEFAULT_CATALOG_PATH,
    schemaPath: DEFAULT_SCHEMA_PATH,
    baselinePath: null,
    enforceCurrentPublisherPolicy: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--catalog") {
      options.catalogPath = path.resolve(argv[++index]);
    } else if (value === "--schema") {
      options.schemaPath = path.resolve(argv[++index]);
    } else if (value === "--baseline") {
      options.baselinePath = path.resolve(argv[++index]);
    } else if (value === "--allow-approved-external") {
      options.enforceCurrentPublisherPolicy = false;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
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
  const errors = validateCatalogFile(options.catalogPath, options);

  if (errors.length > 0) {
    printErrors(errors);
    process.exitCode = 1;
    return;
  }

  const catalog = readJson(options.catalogPath);
  const releaseCount = catalog.games.reduce((count, game) => count + game.releases.length, 0);
  console.log(`Catalog valid: ${catalog.games.length} game(s), ${releaseCount} release(s).`);
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
