import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateCatalogFile } from "./validate-catalog.mjs";
import { generateChannelDocuments } from "./generate-channel-indexes.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const CANONICAL_CATALOG = path.join(REPO_ROOT, "catalog/v1/catalog.json");
const CHANNEL_DIR = path.join(REPO_ROOT, "catalog/v1/channels");
const CHANNEL_FIXTURE_DIR = path.join(REPO_ROOT, "fixtures/v1/channels");
const VALID_FIXTURE_DIR = path.join(REPO_ROOT, "fixtures/v1/valid");
const INVALID_FIXTURE_DIR = path.join(REPO_ROOT, "fixtures/v1/invalid");

let failed = false;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function generateValidatedFixture(filePath) {
  const errors = validateCatalogFile(filePath);
  if (errors.length > 0) {
    fail(`channel fixture '${path.basename(filePath)}' is not a valid catalog: ${JSON.stringify(errors)}`);
    return null;
  }
  return generateChannelDocuments(readJson(filePath));
}

const canonicalDocuments = generateValidatedFixture(CANONICAL_CATALOG);
if (canonicalDocuments) {
  const persistedDiscovery = readJson(path.join(REPO_ROOT, "catalog/v1/channels.json"));
  const persistedStable = readJson(path.join(CHANNEL_DIR, "stable.json"));
  const persistedTest = readJson(path.join(CHANNEL_DIR, "test.json"));

  if (
    sameDocument(persistedDiscovery, canonicalDocuments.discovery)
    && sameDocument(persistedStable, canonicalDocuments.stable)
    && sameDocument(persistedTest, canonicalDocuments.test)
  ) {
    pass("committed channel indexes are exactly derivable from the canonical catalog");
  } else {
    fail("committed channel indexes are stale or differ from deterministic generation");
  }
}

const stableOnly = generateValidatedFixture(path.join(CHANNEL_FIXTURE_DIR, "stable-only.json"));
if (stableOnly) {
  const entry = stableOnly.stable.games[0];
  if (
    stableOnly.stable.games.length === 1
    && stableOnly.test.games.length === 0
    && entry.latestVersion === "1.10.0"
    && entry.versions.join(",") === "1.10.0,1.9.0"
  ) {
    pass("stable-only title is exposed only through stable and uses SemVer ordering");
  } else {
    fail("stable-only fixture generated incorrect channel indexes");
  }
}

const stableAndBeta = generateValidatedFixture(path.join(VALID_FIXTURE_DIR, "multiple-releases.json"));
if (stableAndBeta) {
  if (
    stableAndBeta.stable.games.length === 1
    && stableAndBeta.test.games.length === 1
    && stableAndBeta.stable.games[0].latestVersion === "0.1.0"
    && stableAndBeta.test.games[0].latestVersion === "0.2.0-beta.1"
  ) {
    pass("stable and prerelease histories remain independently discoverable for one game");
  } else {
    fail("stable+beta fixture generated incorrect independent channel histories");
  }
}

const prereleaseOnly = generateValidatedFixture(path.join(CHANNEL_FIXTURE_DIR, "prerelease-only.json"));
if (prereleaseOnly) {
  const entry = prereleaseOnly.test.games[0];
  if (
    prereleaseOnly.stable.games.length === 0
    && prereleaseOnly.test.games.length === 1
    && entry.latestVersion === "2.0.0-beta.10"
    && entry.versions.join(",") === "2.0.0-beta.10,2.0.0-beta.2"
  ) {
    pass("prerelease-only title stays out of stable and uses numeric prerelease ordering");
  } else {
    fail("prerelease-only fixture generated incorrect test-channel history");
  }
}

const invalidCrossChannel = path.join(INVALID_FIXTURE_DIR, "stable-prerelease.json");
const invalidErrors = validateCatalogFile(invalidCrossChannel);
if (invalidErrors.length > 0) {
  pass("invalid cross-channel SemVer metadata is rejected before index generation");
} else {
  fail("prerelease mislabeled as stable must be rejected");
}

const discovery = canonicalDocuments?.discovery;
if (
  discovery?.defaultChannel === "stable"
  && discovery.channels.stable.optInRequired === false
  && discovery.channels.test.optInRequired === true
  && discovery.channels.test.prerelease === true
) {
  pass("stable is explicit default and test channel requires opt-in");
} else {
  fail("channel discovery must keep stable as default and test as explicit opt-in");
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("All channel index tests passed.");
}
