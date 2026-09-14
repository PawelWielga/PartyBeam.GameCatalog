import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { DEFAULT_CATALOG_PATH, validateCatalogFile } from "./validate-catalog.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "catalog/v1");
const CHANNEL_INDEX_SCHEMA_PATH = path.join(REPO_ROOT, "schemas/v1/channel-index.schema.json");
const CHANNELS_SCHEMA_PATH = path.join(REPO_ROOT, "schemas/v1/channels.schema.json");

const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function compareOrdinal(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function parseSemver(version) {
  const match = SEMVER_RE.exec(version);
  if (!match) throw new Error(`Invalid SemVer '${version}'.`);

  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: match[4]
      ? match[4].split(".").map((part) => (/^(0|[1-9][0-9]*)$/.test(part)
        ? { numeric: true, value: BigInt(part) }
        : { numeric: false, value: part }))
      : null,
  };
}

function compareIdentifier(left, right) {
  if (left.numeric && right.numeric) {
    if (left.value < right.value) return -1;
    if (left.value > right.value) return 1;
    return 0;
  }
  if (left.numeric !== right.numeric) return left.numeric ? -1 : 1;
  return compareOrdinal(left.value, right.value);
}

export function compareSemver(leftVersion, rightVersion) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);

  for (const field of ["major", "minor", "patch"]) {
    if (left[field] < right[field]) return -1;
    if (left[field] > right[field]) return 1;
  }

  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= left.prerelease.length) return -1;
    if (index >= right.prerelease.length) return 1;
    const result = compareIdentifier(left.prerelease[index], right.prerelease[index]);
    if (result !== 0) return result;
  }

  return 0;
}

function isPrerelease(version) {
  return parseSemver(version).prerelease !== null;
}

function buildChannelIndex(catalog, channel) {
  const games = [];

  for (const game of catalog.games) {
    const versions = game.releases
      .filter((release) => release.publicationState === "published")
      .filter((release) => release.channel === channel)
      .filter((release) => (channel === "stable" ? !isPrerelease(release.version) : isPrerelease(release.version)))
      .map((release) => release.version)
      .sort((left, right) => compareSemver(right, left));

    if (versions.length === 0) continue;

    games.push({
      gameId: game.gameId,
      latestVersion: versions[0],
      versions,
    });
  }

  games.sort((left, right) => compareOrdinal(left.gameId, right.gameId));

  return {
    schemaVersion: 1,
    catalogId: "partybeam-official",
    channel,
    sourceCatalogPath: "catalog/v1/catalog.json",
    games,
  };
}

function buildChannelDiscovery() {
  return {
    schemaVersion: 1,
    catalogId: "partybeam-official",
    defaultChannel: "stable",
    channels: {
      stable: {
        indexPath: "catalog/v1/channels/stable.json",
        prerelease: false,
        optInRequired: false,
      },
      test: {
        indexPath: "catalog/v1/channels/test.json",
        prerelease: true,
        optInRequired: true,
      },
    },
  };
}

function validateGeneratedDocument(document, schemaPath) {
  const schema = readJson(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  if (validate(document)) return;

  const details = (validate.errors ?? [])
    .map((error) => `${error.instancePath || "/"}: ${error.message}`)
    .join("; ");
  throw new Error(`Generated channel document is invalid: ${details}`);
}

export function generateChannelDocuments(catalog) {
  const discovery = buildChannelDiscovery();
  const stable = buildChannelIndex(catalog, "stable");
  const test = buildChannelIndex(catalog, "test");

  validateGeneratedDocument(discovery, CHANNELS_SCHEMA_PATH);
  validateGeneratedDocument(stable, CHANNEL_INDEX_SCHEMA_PATH);
  validateGeneratedDocument(test, CHANNEL_INDEX_SCHEMA_PATH);

  return { discovery, stable, test };
}

function serialize(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function writeChannelDocuments({ catalogPath = DEFAULT_CATALOG_PATH, outputDir = DEFAULT_OUTPUT_DIR }) {
  const errors = validateCatalogFile(catalogPath);
  if (errors.length > 0) {
    const details = errors.map((error) => `[${error.code}] ${error.instancePath}: ${error.message}`).join("\n");
    throw new Error(`Cannot generate channel indexes from invalid catalog:\n${details}`);
  }

  const catalog = readJson(catalogPath);
  const documents = generateChannelDocuments(catalog);
  const channelsDir = path.join(outputDir, "channels");
  fs.mkdirSync(channelsDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, "channels.json"), serialize(documents.discovery), "utf8");
  fs.writeFileSync(path.join(channelsDir, "stable.json"), serialize(documents.stable), "utf8");
  fs.writeFileSync(path.join(channelsDir, "test.json"), serialize(documents.test), "utf8");

  return documents;
}

function parseArgs(argv) {
  const options = {
    catalogPath: DEFAULT_CATALOG_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--catalog") options.catalogPath = path.resolve(argv[++index]);
    else if (value === "--output-dir") options.outputDir = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const documents = writeChannelDocuments(options);
  console.log(
    `Generated channel indexes: ${documents.stable.games.length} stable game(s), ${documents.test.games.length} test game(s).`,
  );
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
