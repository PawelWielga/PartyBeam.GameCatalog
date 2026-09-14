import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateCatalogObject } from "./validate-catalog.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const BASE_FIXTURE = path.join(REPO_ROOT, "fixtures/v1/valid/multiple-releases.json");
const baseline = JSON.parse(fs.readFileSync(BASE_FIXTURE, "utf8"));
let failed = false;

function clone(value) {
  return structuredClone(value);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function expectCode(name, candidate, code) {
  const errors = validateCatalogObject(candidate);
  if (errors.some((error) => error.code === code)) {
    pass(name);
  } else {
    fail(`${name}: expected validation code '${code}', got ${errors.map((error) => error.code).join(", ") || "none"}`);
  }
}

const invalidContractRange = clone(baseline);
invalidContractRange.games[0].releases[0].compatibility.gameContractApi.minInclusive = "2.0.0";
invalidContractRange.games[0].releases[0].compatibility.gameContractApi.maxExclusive = "2.0.0";
expectCode(
  "Game Contract range must have minInclusive lower than maxExclusive",
  invalidContractRange,
  "game-contract-range",
);

const missingRuntimeEnglish = clone(baseline);
missingRuntimeEnglish.games[0].releases[0].compatibility.runtimeLocales = ["pl"];
expectCode(
  "runtime locale projection requires English fallback",
  missingRuntimeEnglish,
  "runtime-english-fallback-missing",
);

const missingCatalogEnglish = clone(baseline);
missingCatalogEnglish.games[0].releases[0].compatibility.catalogLocales = ["pl"];
expectCode(
  "catalog locale projection requires English fallback",
  missingCatalogEnglish,
  "catalog-english-fallback-missing",
);

const inconsistentInternetAccess = clone(baseline);
inconsistentInternetAccess.games[0].releases[0].compatibility.capabilities.optional.push("internetAccess");
inconsistentInternetAccess.games[0].releases[0].compatibility.capabilities.internetAccess = "none";
expectCode(
  "internetAccess summary must match signed capability projection",
  inconsistentInternetAccess,
  "internet-access-summary",
);

if (failed) {
  process.exitCode = 1;
} else {
  console.log("All catalog semantic invariant tests passed.");
}
