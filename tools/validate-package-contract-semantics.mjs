import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validatePackageProjection } from "./validate-package-projection.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const FIXTURE_DIR = path.join(REPO_ROOT, "fixtures/v1/package-contract");
const baseManifest = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "manifest.json"), "utf8"));
const baseCatalog = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "valid.catalog.json"), "utf8"));
const baseEnvelope = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "signature.json"), "utf8"));
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

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function logicalPackageSha256(manifestSha256, components) {
  const lines = [...components]
    .sort((left, right) => (left.artifactPath < right.artifactPath ? -1 : left.artifactPath > right.artifactPath ? 1 : 0))
    .map((component) => `component:${component.kind}:${component.artifactPath}:${component.sha256.toLowerCase()}`);
  const descriptor = [
    "partybeam-package-content-v1",
    `manifest:${manifestSha256}`,
    ...lines,
    "",
  ].join("\n");
  return sha256(Buffer.from(descriptor, "utf8"));
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-contract-semantics-"));

function validateManifest(manifest, name, { catalog = baseCatalog, envelope = baseEnvelope } = {}) {
  const manifestPath = path.join(tempDir, `${name}.manifest.json`);
  const catalogPath = path.join(tempDir, `${name}.catalog.json`);
  const signaturePath = path.join(tempDir, `${name}.signature.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  fs.writeFileSync(signaturePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  return validatePackageProjection({
    catalogPath,
    gameId: "partybeam.reflex",
    version: "1.2.0-beta.1",
    manifestPath,
    signaturePath,
  });
}

function expectCode(errors, code, description) {
  if (errors.some((error) => error.code === code)) {
    pass(description);
  } else {
    fail(`${description}: expected '${code}', got ${JSON.stringify(errors)}`);
  }
}

try {
  const duplicateComponent = clone(baseManifest);
  duplicateComponent.components[1].id = duplicateComponent.components[0].id;
  expectCode(
    validateManifest(duplicateComponent, "duplicate-component"),
    "manifest-duplicate-component-id",
    "duplicate component IDs are rejected beyond JSON Schema",
  );

  const duplicateArtifact = clone(baseManifest);
  duplicateArtifact.components[1].artifactPath = duplicateArtifact.components[0].artifactPath;
  expectCode(
    validateManifest(duplicateArtifact, "duplicate-artifact"),
    "manifest-duplicate-artifact-path",
    "duplicate component artifact paths are rejected",
  );

  const duplicateKind = clone(baseManifest);
  duplicateKind.components[2].kind = "tv";
  expectCode(
    validateManifest(duplicateKind, "duplicate-kind"),
    "manifest-schema-contains",
    "manifest schema requires exactly one component of each MVP kind",
  );

  const artworkOutsideCatalog = clone(baseManifest);
  artworkOutsideCatalog.catalog.artwork = [
    {
      id: "cover",
      kind: "cover",
      artifactPath: "assets/cover.png",
      sha256: "0".repeat(64),
    },
  ];
  expectCode(
    validateManifest(artworkOutsideCatalog, "artwork-outside-catalog"),
    "manifest-invalid-artwork-path",
    "catalog artwork must stay under the catalog package namespace",
  );

  const artworkCollision = clone(baseManifest);
  artworkCollision.components[0].artifactPath = "catalog/cover.png";
  artworkCollision.catalog.artwork = [
    {
      id: "cover",
      kind: "cover",
      artifactPath: "catalog/cover.png",
      sha256: "0".repeat(64),
    },
  ];
  expectCode(
    validateManifest(artworkCollision, "artwork-component-collision"),
    "manifest-duplicate-artwork-path",
    "catalog artwork cannot collide with a component payload",
  );

  const multipleCovers = clone(baseManifest);
  multipleCovers.catalog.artwork = [
    {
      id: "cover",
      kind: "cover",
      artifactPath: "catalog/cover.png",
      sha256: "0".repeat(64),
    },
    {
      id: "cover-alt",
      kind: "cover",
      artifactPath: "catalog/cover-alt.png",
      sha256: "1".repeat(64),
    },
  ];
  expectCode(
    validateManifest(multipleCovers, "multiple-covers"),
    "manifest-multiple-canonical-covers",
    "manifest cannot declare more than one canonical cover",
  );

  const wanWithoutCapability = clone(baseManifest);
  wanWithoutCapability.capabilities.optional = [];
  expectCode(
    validateManifest(wanWithoutCapability, "wan-without-capability"),
    "manifest-wan-without-internet-access",
    "WAN allowlist cannot exist without internetAccess capability",
  );

  const internetWithoutWan = clone(baseManifest);
  internetWithoutWan.network.outboundAllowlist = [];
  expectCode(
    validateManifest(internetWithoutWan, "internet-without-wan"),
    "manifest-missing-wan-allowlist",
    "internetAccess requires at least one signed WAN destination",
  );

  const invalidWan = clone(baseManifest);
  invalidWan.network.outboundAllowlist = ["https://api.example.com/reflex/#fragment"];
  expectCode(
    validateManifest(invalidWan, "invalid-wan"),
    "manifest-invalid-wan-destination",
    "WAN destinations reject fragments/user-boundary ambiguity",
  );

  const undeclaredLocalized = clone(baseManifest);
  undeclaredLocalized.catalog.localized.de = { shortDescription: "Nicht deklariert." };
  expectCode(
    validateManifest(undeclaredLocalized, "undeclared-localized"),
    "manifest-localized-locale-not-declared",
    "localized metadata keys must be declared in catalogLocales",
  );

  const duplicateLocaleCase = clone(baseManifest);
  duplicateLocaleCase.catalogLocales = ["en", "EN", "pl"];
  expectCode(
    validateManifest(duplicateLocaleCase, "duplicate-locale-case"),
    "manifest-duplicate-catalog-locale",
    "catalog locales are unique case-insensitively",
  );

  const invalidSupport = clone(baseManifest);
  invalidSupport.catalog.supportUrl = "http://invalid.example/support";
  const invalidSupportText = `${JSON.stringify(invalidSupport, null, 2)}\n`;
  const manifestHash = sha256(Buffer.from(invalidSupportText, "utf8"));
  const logicalHash = logicalPackageSha256(manifestHash, invalidSupport.components);
  const alignedEnvelope = clone(baseEnvelope);
  alignedEnvelope.manifestSha256 = manifestHash;
  alignedEnvelope.packageSha256 = logicalHash;
  const alignedCatalog = clone(baseCatalog);
  delete alignedCatalog.games[0].catalogMetadata.supportUrl;
  alignedCatalog.games[0].releases[0].package.manifestSha256 = manifestHash;
  alignedCatalog.games[0].releases[0].package.packageSha256 = logicalHash;

  const supportManifestPath = path.join(tempDir, "invalid-support.manifest.json");
  const supportCatalogPath = path.join(tempDir, "invalid-support.catalog.json");
  const supportSignaturePath = path.join(tempDir, "invalid-support.signature.json");
  fs.writeFileSync(supportManifestPath, invalidSupportText, "utf8");
  fs.writeFileSync(supportCatalogPath, `${JSON.stringify(alignedCatalog, null, 2)}\n`, "utf8");
  fs.writeFileSync(supportSignaturePath, `${JSON.stringify(alignedEnvelope, null, 2)}\n`, "utf8");

  const supportErrors = validatePackageProjection({
    catalogPath: supportCatalogPath,
    gameId: "partybeam.reflex",
    version: "1.2.0-beta.1",
    manifestPath: supportManifestPath,
    signaturePath: supportSignaturePath,
  });
  if (supportErrors.length === 0) {
    pass("invalid optional supportUrl is ignored rather than promoted into a blocking publication error");
  } else {
    fail(`invalid optional supportUrl should remain non-blocking: ${JSON.stringify(supportErrors)}`);
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("All package contract semantic tests passed.");
}
