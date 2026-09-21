import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPublicAssets } from "./audit-public-assets.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const CATALOG_PATH = path.join(REPO_ROOT, "fixtures/v1/integrity/valid.catalog.json");
const PACKAGE_PATH = path.join(REPO_ROOT, "fixtures/v1/assets/partybeam.integrity-fixture-0.1.0.partybeam");
const packageBytes = fs.readFileSync(PACKAGE_PATH);
let failed = false;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

const successResults = await auditPublicAssets({
  catalogPath: CATALOG_PATH,
  fetchImpl: async () => new Response(packageBytes, { status: 200 }),
});
if (successResults.length === 1 && successResults[0].ok) {
  pass("anonymous public asset bytes match catalog size and SHA-256");
} else {
  fail("valid public asset bytes did not pass audit");
}

const tamperedResults = await auditPublicAssets({
  catalogPath: CATALOG_PATH,
  gameId: "partybeam.integrity-fixture",
  version: "0.1.0",
  fetchImpl: async () => new Response(Buffer.concat([packageBytes, Buffer.from("tamper")]), { status: 200 }),
});
if (
  !tamperedResults[0].ok
  && tamperedResults[0].errors.some((error) => error.includes("size mismatch"))
  && tamperedResults[0].errors.some((error) => error.includes("SHA-256 mismatch"))
) {
  pass("remote asset byte replacement fails size and hash audit");
} else {
  fail("tampered public asset bytes were accepted");
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-delisted-audit-test-"));
try {
  const delistedCatalogPath = path.join(tempDir, "catalog.json");
  const delistedCatalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  delistedCatalog.games[0].releases[0].publicationState = "delisted";
  fs.writeFileSync(delistedCatalogPath, `${JSON.stringify(delistedCatalog, null, 2)}\n`, "utf8");
  const delistedResults = await auditPublicAssets({
    catalogPath: delistedCatalogPath,
    fetchImpl: async () => new Response(packageBytes, { status: 200 }),
  });
  if (delistedResults.length === 1 && delistedResults[0].ok && delistedResults[0].publicationState === "delisted") {
    pass("delisted historical releases remain covered by integrity audit");
  } else {
    fail("delisted historical release was skipped by integrity audit");
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const unavailableResults = await auditPublicAssets({
  catalogPath: CATALOG_PATH,
  fetchImpl: async () => new Response("not found", { status: 404 }),
});
if (!unavailableResults[0].ok && unavailableResults[0].errors[0].includes("HTTP 404")) {
  pass("unavailable historical asset fails closed with HTTP status");
} else {
  fail("unavailable historical asset was accepted");
}

if (failed) process.exitCode = 1;
else console.log("All public asset audit tests passed.");
