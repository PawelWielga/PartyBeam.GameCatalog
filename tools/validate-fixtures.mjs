import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateCatalogFile, validateCatalogObject } from "./validate-catalog.mjs";
import { verifyPackageIntegrity } from "./verify-package-integrity.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const VALID_DIR = path.join(REPO_ROOT, "fixtures/v1/valid");
const INVALID_DIR = path.join(REPO_ROOT, "fixtures/v1/invalid");
const INTEGRITY_DIR = path.join(REPO_ROOT, "fixtures/v1/integrity");
const INTEGRITY_PACKAGE = path.join(
  REPO_ROOT,
  "fixtures/v1/assets/partybeam.integrity-fixture-0.1.0.partybeam",
);
const CANONICAL_CATALOG = path.join(REPO_ROOT, "catalog/v1/catalog.json");

function jsonFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function formatErrors(errors) {
  return errors
    .map((error) => {
      const location = error.instancePath ? `${error.instancePath}: ` : "";
      return `[${error.code}] ${location}${error.message}`;
    })
    .join("\n");
}

let failed = false;

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

const canonicalErrors = validateCatalogFile(CANONICAL_CATALOG);
if (canonicalErrors.length === 0) {
  pass("canonical catalog validates");
} else {
  fail(`canonical catalog must validate\n${formatErrors(canonicalErrors)}`);
}

for (const filePath of jsonFiles(VALID_DIR)) {
  const errors = validateCatalogFile(filePath);
  const name = path.basename(filePath);

  if (errors.length === 0) {
    pass(`valid fixture accepted: ${name}`);
  } else {
    fail(`valid fixture rejected: ${name}\n${formatErrors(errors)}`);
  }
}

for (const filePath of jsonFiles(INVALID_DIR)) {
  const errors = validateCatalogFile(filePath);
  const name = path.basename(filePath);

  if (errors.length > 0) {
    pass(`invalid fixture rejected: ${name}`);
  } else {
    fail(`invalid fixture unexpectedly accepted: ${name}`);
  }
}

const baseline = readJson(path.join(VALID_DIR, "multiple-releases.json"));

const mutatedPackage = clone(baseline);
mutatedPackage.games[0].releases[0].package.integrity.digest = "f".repeat(64);
const mutationErrors = validateCatalogObject(mutatedPackage, { baseline });
if (mutationErrors.some((error) => error.code === "release-package-mutated")) {
  pass("immutable exact release rejects changed package identity");
} else {
  fail(`immutable release mutation was not rejected\n${formatErrors(mutationErrors)}`);
}

const delisted = clone(baseline);
delisted.games[0].releases[0].publicationState = "delisted";
const delistErrors = validateCatalogObject(delisted, { baseline });
if (delistErrors.length === 0) {
  pass("delisting does not mutate exact release identity");
} else {
  fail(`delisting should remain valid\n${formatErrors(delistErrors)}`);
}

const externalPublisher = clone(baseline);
externalPublisher.games[0].publisher.kind = "approved-external";
const futureSchemaErrors = validateCatalogObject(externalPublisher, {
  enforceCurrentPublisherPolicy: false,
});
const currentPolicyErrors = validateCatalogObject(externalPublisher);

if (futureSchemaErrors.length === 0) {
  pass("schema can represent a future approved external publisher");
} else {
  fail(`approved external publisher is not representable\n${formatErrors(futureSchemaErrors)}`);
}

if (currentPolicyErrors.some((error) => error.code === "publisher-not-approved-for-mvp")) {
  pass("current MVP publication policy rejects external publishers");
} else {
  fail("current MVP policy must reject external publishers");
}

const integrityIdentity = {
  gameId: "partybeam.integrity-fixture",
  version: "0.1.0",
  packagePath: INTEGRITY_PACKAGE,
};

const validIntegrityErrors = verifyPackageIntegrity({
  ...integrityIdentity,
  catalogPath: path.join(INTEGRITY_DIR, "valid.catalog.json"),
});

if (validIntegrityErrors.length === 0) {
  pass("actual package bytes match the catalog SHA-256 and size");
} else {
  fail(`valid package bytes were rejected\n${formatErrors(validIntegrityErrors)}`);
}

const wrongHashErrors = verifyPackageIntegrity({
  ...integrityIdentity,
  catalogPath: path.join(INTEGRITY_DIR, "wrong-hash.catalog.json"),
});

if (wrongHashErrors.some((error) => error.code === "package-hash-mismatch")) {
  pass("wrong package SHA-256 is rejected");
} else {
  fail(`wrong package SHA-256 was not rejected\n${formatErrors(wrongHashErrors)}`);
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("All catalog validation tests passed.");
}
