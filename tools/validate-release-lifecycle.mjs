import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { generateChannelDocuments } from "./generate-channel-indexes.mjs";
import { validateCatalogObject } from "./validate-catalog.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const BASELINE_PATH = path.join(REPO_ROOT, "fixtures/v1/valid/multiple-releases.json");
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
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

function hasError(errors, code) {
  return errors.some((error) => error.code === code);
}

const delisted = clone(baseline);
delisted.games[0].releases[0].publicationState = "delisted";
const delistErrors = validateCatalogObject(delisted, { baseline });
const delistedChannels = generateChannelDocuments(delisted);

if (
  delistErrors.length === 0
  && delisted.games[0].releases.some((release) => release.version === "0.1.0")
  && delistedChannels.stable.games.length === 0
  && delistedChannels.test.games[0]?.latestVersion === "0.2.0-beta.1"
) {
  pass("delisting hides a release from new stable discovery while retaining exact historical metadata");
} else {
  fail(`ordinary delisting should be valid and disappear from discovery: ${JSON.stringify(delistErrors)}`);
}

const relisted = clone(delisted);
relisted.games[0].releases[0].publicationState = "published";
const relistErrors = validateCatalogObject(relisted, { baseline: delisted });
const relistedChannels = generateChannelDocuments(relisted);

if (
  relistErrors.length === 0
  && relistedChannels.stable.games[0]?.latestVersion === "0.1.0"
) {
  pass("relisting restores discovery of the same immutable exact release");
} else {
  fail(`relisting an unchanged exact release should be valid: ${JSON.stringify(relistErrors)}`);
}

const removedRelease = clone(baseline);
removedRelease.games[0].releases.splice(0, 1);
const removedReleaseErrors = validateCatalogObject(removedRelease, { baseline });
if (hasError(removedReleaseErrors, "release-history-removed")) {
  pass("canonical history rejects deleting an existing exact release");
} else {
  fail("deleting an existing exact release must fail baseline validation");
}

const removedGame = clone(baseline);
removedGame.games = [];
const removedGameErrors = validateCatalogObject(removedGame, { baseline });
if (hasError(removedGameErrors, "game-history-removed")) {
  pass("canonical history rejects deleting an existing game identity");
} else {
  fail("deleting an existing game identity must fail baseline validation");
}

const changedPublishedAt = clone(baseline);
changedPublishedAt.games[0].releases[0].publishedAt = "2026-09-14T12:00:00Z";
const changedPublishedAtErrors = validateCatalogObject(changedPublishedAt, { baseline });
if (hasError(changedPublishedAtErrors, "release-published-at-mutated")) {
  pass("original publication timestamp is immutable for an existing exact release");
} else {
  fail("changing publishedAt for an existing exact release must fail");
}

const mutatedDelistedPackage = clone(baseline);
mutatedDelistedPackage.games[0].releases[0].publicationState = "delisted";
mutatedDelistedPackage.games[0].releases[0].package.integrity.digest = "f".repeat(64);
const mutatedDelistedErrors = validateCatalogObject(mutatedDelistedPackage, { baseline });
if (hasError(mutatedDelistedErrors, "release-package-mutated")) {
  pass("delisting cannot be used to replace bytes or package identity behind an exact version");
} else {
  fail("package identity must remain immutable even during delisting");
}

const correction = clone(baseline);
const correctedRelease = clone(correction.games[0].releases[0]);
correctedRelease.version = "0.1.1";
correctedRelease.publishedAt = "2026-09-14T10:00:00Z";
correctedRelease.package.fileName = "partybeam.reflex-0.1.1.partybeam";
correctedRelease.package.assetUrl = "https://github.com/PawelWielga/PartyBeam.GameCatalog/releases/download/game-partybeam.reflex-v0.1.1/partybeam.reflex-0.1.1.partybeam";
correctedRelease.package.integrity.digest = "3".repeat(64);
correctedRelease.package.manifestSha256 = "4".repeat(64);
correctedRelease.package.packageSha256 = "5".repeat(64);
correctedRelease.package.signature.valueBase64 = "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBA==";
correction.games[0].releases.push(correctedRelease);

const correctionErrors = validateCatalogObject(correction, { baseline });
const correctionChannels = generateChannelDocuments(correction);
if (
  correctionErrors.length === 0
  && correctionChannels.stable.games[0]?.latestVersion === "0.1.1"
  && correction.games[0].releases.some((release) => release.version === "0.1.0")
) {
  pass("a correction is represented by a new SemVer release while preserving prior history");
} else {
  fail(`new-version correction should be valid: ${JSON.stringify(correctionErrors)}`);
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("All release lifecycle tests passed.");
}
