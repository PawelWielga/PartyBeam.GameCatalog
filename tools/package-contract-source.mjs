import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256, PACKAGE_SCHEMA_VERSION } from "@partybeam/game-sdk/package-v1";

export const PACKAGE_CONTRACT_SOURCE = JSON.parse(
  fs.readFileSync(new URL("../vendor/gamesdk-source.json", import.meta.url), "utf8"),
);
const sdkRoot = new URL("../", import.meta.resolve("@partybeam/game-sdk"));
const installed = JSON.parse(fs.readFileSync(new URL("package.json", sdkRoot), "utf8"));
if (installed.name !== PACKAGE_CONTRACT_SOURCE.sdkPackage
  || installed.version !== PACKAGE_CONTRACT_SOURCE.sdkVersion
  || PACKAGE_SCHEMA_VERSION !== PACKAGE_CONTRACT_SOURCE.packageSchemaVersion) {
  throw new Error("Installed GameSdk package/version does not match the contract pin.");
}
const artifact = new URL(`../vendor/partybeam-game-sdk-${installed.version}.tgz`, import.meta.url);
if (sha256(fs.readFileSync(artifact)) !== PACKAGE_CONTRACT_SOURCE.artifactSha256) {
  throw new Error("Vendored GameSdk artifact does not match the contract pin.");
}

export function packageSchemaPath(name) {
  const resolved = fileURLToPath(import.meta.resolve(
    `@partybeam/game-sdk/schemas/game-package-${name}.v1.schema.json`,
  ));
  if (sha256(fs.readFileSync(resolved)) !== PACKAGE_CONTRACT_SOURCE.schemaSha256[name]) {
    throw new Error(`Installed GameSdk ${name} schema does not match the contract pin.`);
  }
  return resolved;
}

export const PACKAGE_CONTRACT_LABEL = `${installed.name}@${installed.version} / package-v${PACKAGE_SCHEMA_VERSION}`;
