import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { DEFAULT_CATALOG_PATH, validateCatalogFile } from "./validate-catalog.mjs";
import { compareSemver, hasPrerelease } from "./semver.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "catalog/v1");
const CHANNEL_INDEX_SCHEMA_PATH = path.join(REPO_ROOT, "schemas/v1/channel-index.schema.json");
const CHANNELS_SCHEMA_PATH = path.join(REPO_ROOT, "schemas/v1/channels.schema.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function compareOrdinal(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function buildChannelIndex(catalog, channel) {
  const games = [];

  for (const game of catalog.games) {
    const versions = game.releases
      .filter((release) => release.publicationState === "published")
      .filter((release) => release.channel === channel)
      .filter((release) => (channel === "stable" ? !hasPrerelease(release.version) : hasPrerelease(release.version)))
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
