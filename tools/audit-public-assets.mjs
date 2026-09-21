import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { DEFAULT_CATALOG_PATH, validateCatalogFile } from "./validate-catalog.mjs";
import { hashAnonymousAsset } from "./publish-github-release.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function selectReleases(catalog, { gameId, version }) {
  const selected = [];
  for (const game of catalog.games) {
    if (gameId && game.gameId !== gameId) continue;
    for (const release of game.releases) {
      if (version && release.version !== version) continue;
      selected.push({ gameId: game.gameId, version: release.version, release });
    }
  }
  if (selected.length === 0) {
    const requested = [gameId, version].filter(Boolean).join("@");
    throw new Error(`No catalog releases matched '${requested || "catalog"}'`);
  }
  return selected;
}

export async function auditPublicAssets({
  catalogPath = DEFAULT_CATALOG_PATH,
  gameId,
  version,
  fetchImpl = fetch,
}) {
  const validationErrors = validateCatalogFile(catalogPath);
  if (validationErrors.length > 0) {
    throw new Error(
      `Catalog validation failed before asset audit:\n${validationErrors.map((error) => `[${error.code}] ${error.instancePath}: ${error.message}`).join("\n")}`,
    );
  }

  const catalog = readJson(catalogPath);
  const selected = selectReleases(catalog, { gameId, version });
  const results = [];
  for (const item of selected) {
    try {
      const actual = await hashAnonymousAsset(item.release.package.assetUrl, fetchImpl);
      const expected = {
        sizeBytes: item.release.package.sizeBytes,
        sha256: item.release.package.integrity.digest,
      };
      const errors = [];
      if (actual.sizeBytes !== expected.sizeBytes) {
        errors.push(`size mismatch: expected ${expected.sizeBytes}, got ${actual.sizeBytes}`);
      }
      if (actual.sha256 !== expected.sha256) {
        errors.push(`SHA-256 mismatch: expected ${expected.sha256}, got ${actual.sha256}`);
      }
      results.push({
        gameId: item.gameId,
        version: item.version,
        publicationState: item.release.publicationState,
        assetUrl: item.release.package.assetUrl,
        expected,
        actual,
        ok: errors.length === 0,
        errors,
      });
    } catch (error) {
      results.push({
        gameId: item.gameId,
        version: item.version,
        publicationState: item.release.publicationState,
        assetUrl: item.release.package.assetUrl,
        expected: {
          sizeBytes: item.release.package.sizeBytes,
          sha256: item.release.package.integrity.digest,
        },
        ok: false,
        errors: [error.message],
      });
    }
  }
  return results;
}

function parseArgs(argv) {
  const options = { catalogPath: DEFAULT_CATALOG_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--catalog") options.catalogPath = path.resolve(argv[++index]);
    else if (value === "--game-id") options.gameId = argv[++index];
    else if (value === "--version") options.version = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (options.version && !options.gameId) {
    throw new Error("--version requires --game-id");
  }
  return options;
}

async function main() {
  const results = await auditPublicAssets(parseArgs(process.argv.slice(2)));
  for (const result of results) {
    if (result.ok) {
      console.log(`PASS: ${result.gameId}@${result.version} (${result.publicationState}) ${result.actual.sizeBytes} bytes ${result.actual.sha256}`);
    } else {
      for (const error of result.errors) {
        console.error(`FAIL: ${result.gameId}@${result.version} (${result.publicationState}): ${error}`);
      }
    }
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
  else console.log(`All ${results.length} public catalog asset(s) passed anonymous integrity audit.`);
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
