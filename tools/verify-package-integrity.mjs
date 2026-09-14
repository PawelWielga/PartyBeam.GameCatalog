import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_CATALOG_PATH, validateCatalogFile } from "./validate-catalog.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

export function verifyPackageIntegrity({ catalogPath, gameId, version, packagePath }) {
  const errors = validateCatalogFile(catalogPath);
  if (errors.length > 0) {
    return errors.map((error) => ({
      code: `catalog-${error.code}`,
      message: `${error.instancePath}: ${error.message}`,
    }));
  }

  const catalog = readJson(catalogPath);
  const game = catalog.games.find((entry) => entry.gameId === gameId);
  if (!game) {
    return [{ code: "game-not-found", message: `Game '${gameId}' was not found in the catalog.` }];
  }

  const release = game.releases.find((entry) => entry.version === version);
  if (!release) {
    return [{ code: "release-not-found", message: `Release '${gameId}@${version}' was not found in the catalog.` }];
  }

  if (!fs.existsSync(packagePath)) {
    return [{ code: "package-not-found", message: `Package file does not exist: ${packagePath}` }];
  }

  const errorsOut = [];
  const fileName = path.basename(packagePath);
  if (fileName !== release.package.fileName) {
    errorsOut.push({
      code: "package-filename-mismatch",
      message: `Expected '${release.package.fileName}', got '${fileName}'.`,
    });
  }

  const actualDigest = sha256File(packagePath);
  const expectedDigest = release.package.integrity.digest;
  if (actualDigest !== expectedDigest) {
    errorsOut.push({
      code: "package-hash-mismatch",
      message: `SHA-256 mismatch for ${gameId}@${version}: expected ${expectedDigest}, got ${actualDigest}.`,
    });
  }

  if (release.package.sizeBytes !== undefined) {
    const actualSize = fs.statSync(packagePath).size;
    if (actualSize !== release.package.sizeBytes) {
      errorsOut.push({
        code: "package-size-mismatch",
        message: `Size mismatch for ${gameId}@${version}: expected ${release.package.sizeBytes}, got ${actualSize}.`,
      });
    }
  }

  return errorsOut;
}

function parseArgs(argv) {
  const options = {
    catalogPath: DEFAULT_CATALOG_PATH,
    gameId: null,
    version: null,
    packagePath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--catalog") {
      options.catalogPath = path.resolve(argv[++index]);
    } else if (value === "--game") {
      options.gameId = argv[++index];
    } else if (value === "--version") {
      options.version = argv[++index];
    } else if (value === "--package") {
      options.packagePath = path.resolve(argv[++index]);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!options.gameId || !options.version || !options.packagePath) {
    throw new Error("Required arguments: --game <gameId> --version <semver> --package <path>");
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const errors = verifyPackageIntegrity(options);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[${error.code}] ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Package integrity valid: ${options.gameId}@${options.version}`);
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
