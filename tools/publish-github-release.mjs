import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { authorizePublication } from "./authorize-publication.mjs";
import { DEFAULT_TRUST_STORE_PATH } from "./verify-package-signature.mjs";

const RELEASE_REPOSITORY = "PawelWielga/PartyBeam.GameCatalog";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runGh(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function assertSuccess(result, action) {
  if (result.status !== 0) {
    throw new Error(`${action} failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.status}`}`);
  }
}

export function assertRemoteResourceAbsent(result, label) {
  if (result.status === 0) throw new Error(`${label} already exists; exact releases are immutable`);
  const output = `${result.stderr}\n${result.stdout}`;
  if (!output.includes("HTTP 404")) {
    throw new Error(`Could not confirm that ${label} is absent: ${output.trim()}`);
  }
}

export function buildReleasePlan({ provenance, packagePath }) {
  const resolvedPackagePath = path.resolve(packagePath);
  if (path.basename(resolvedPackagePath) !== provenance.releaseAsset.fileName) {
    throw new Error("Package filename does not match finalized publication provenance");
  }
  if (provenance.componentPayloadsVerified !== true || provenance.fullPackageVerification !== true) {
    throw new Error("Finalized canonical full-package verification is required");
  }
  if (!provenance.canonicalVerifier) {
    throw new Error("Canonical verifier evidence is missing");
  }

  return {
    repository: RELEASE_REPOSITORY,
    tag: provenance.releaseTag,
    target: "main",
    title: `${provenance.gameId} ${provenance.version}`,
    notes: [
      `Official PartyBeam package for ${provenance.gameId}@${provenance.version}.`,
      "",
      `Asset SHA-256: ${provenance.releaseAsset.sha256}`,
      `Logical package SHA-256: ${provenance.packageSha256}`,
      `Signing key: ${provenance.signature?.keyId ?? "none (First MVP unsigned-official profile)"}`,
      `Canonical verifier commit: ${provenance.canonicalVerifier.commit}`,
    ].join("\n"),
    prerelease: provenance.channel === "test",
    packagePath: resolvedPackagePath,
    assetUrl: provenance.assetUrl,
    asset: provenance.releaseAsset,
  };
}

export function validatePublishedRelease(plan, release) {
  const errors = [];
  if (release.tagName !== plan.tag) errors.push("published release tag does not match the plan");
  if (release.isDraft !== false) errors.push("published release must not remain a draft");
  if (release.isPrerelease !== plan.prerelease) errors.push("published release prerelease state does not match the catalog channel");
  if (!Array.isArray(release.assets) || release.assets.length !== 1) {
    errors.push("published release must contain exactly one asset");
  } else {
    const asset = release.assets[0];
    if (asset.name !== plan.asset.fileName) errors.push("published asset filename does not match provenance");
    if (asset.size !== plan.asset.sizeBytes) errors.push("published asset size does not match provenance");
    if (asset.state !== "uploaded") errors.push("published asset is not in the uploaded state");
    if (asset.digest !== `sha256:${plan.asset.sha256}`) errors.push("published asset API digest does not match provenance");
    if (asset.url !== plan.assetUrl) errors.push("published asset URL does not match provenance");
  }
  return errors;
}

export async function hashAnonymousAsset(assetUrl, fetchImpl = fetch) {
  const response = await fetchImpl(assetUrl, {
    redirect: "follow",
    headers: { Accept: "application/octet-stream" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Anonymous asset download failed with HTTP ${response.status}`);
  }

  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    hash.update(chunk);
    sizeBytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

export async function publishGitHubRelease({
  catalogPath,
  baselinePath,
  provenancePath,
  channelsDir,
  packagePath,
  trustStorePath = DEFAULT_TRUST_STORE_PATH,
  execute = false,
  gh = runGh,
  fetchImpl = fetch,
}) {
  const authorizationErrors = authorizePublication({
    catalogPath,
    baselinePath,
    provenancePath,
    channelsDir,
    packagePath,
    trustStorePath,
  });
  if (authorizationErrors.length > 0) {
    throw new Error(`Publication authorization failed:\n${authorizationErrors.map((error) => `[${error.code}] ${error.message}`).join("\n")}`);
  }

  const plan = buildReleasePlan({ provenance: readJson(provenancePath), packagePath });
  const encodedTag = encodeURIComponent(plan.tag);
  assertRemoteResourceAbsent(
    gh(["api", `repos/${plan.repository}/releases/tags/${encodedTag}`]),
    `GitHub Release '${plan.tag}'`,
  );
  assertRemoteResourceAbsent(
    gh(["api", `repos/${plan.repository}/git/ref/tags/${encodedTag}`]),
    `Git tag '${plan.tag}'`,
  );

  if (!execute) return { plan, published: false };

  const createArgs = [
    "release",
    "create",
    plan.tag,
    plan.packagePath,
    "--repo",
    plan.repository,
    "--target",
    plan.target,
    "--title",
    plan.title,
    "--notes",
    plan.notes,
    "--latest=false",
  ];
  if (plan.prerelease) createArgs.push("--prerelease");
  const created = gh(createArgs);
  assertSuccess(created, `Creating immutable release '${plan.tag}'`);

  const viewed = gh([
    "release",
    "view",
    plan.tag,
    "--repo",
    plan.repository,
    "--json",
    "tagName,isDraft,isImmutable,isPrerelease,assets,url",
  ]);
  assertSuccess(viewed, `Reading published release '${plan.tag}'`);
  const release = JSON.parse(viewed.stdout);
  const releaseErrors = validatePublishedRelease(plan, release);
  if (releaseErrors.length > 0) {
    throw new Error(`Release was created but post-publication metadata verification failed: ${releaseErrors.join("; ")}`);
  }

  const downloaded = await hashAnonymousAsset(plan.assetUrl, fetchImpl);
  if (downloaded.sizeBytes !== plan.asset.sizeBytes || downloaded.sha256 !== plan.asset.sha256) {
    throw new Error(
      `Release was created but anonymous download verification failed: expected ${plan.asset.sizeBytes} bytes/${plan.asset.sha256}, got ${downloaded.sizeBytes} bytes/${downloaded.sha256}`,
    );
  }

  return { plan, published: true, releaseUrl: release.url, anonymousDownload: downloaded };
}

function parseArgs(argv) {
  const options = { trustStorePath: DEFAULT_TRUST_STORE_PATH, execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--catalog") options.catalogPath = path.resolve(argv[++index]);
    else if (value === "--baseline") options.baselinePath = path.resolve(argv[++index]);
    else if (value === "--provenance") options.provenancePath = path.resolve(argv[++index]);
    else if (value === "--channels-dir") options.channelsDir = path.resolve(argv[++index]);
    else if (value === "--package") options.packagePath = path.resolve(argv[++index]);
    else if (value === "--trust-store") options.trustStorePath = path.resolve(argv[++index]);
    else if (value === "--execute") options.execute = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  for (const required of ["catalogPath", "baselinePath", "provenancePath", "channelsDir", "packagePath"]) {
    if (!options[required]) throw new Error(`Missing required argument: ${required}`);
  }
  return options;
}

async function main() {
  const result = await publishGitHubRelease(parseArgs(process.argv.slice(2)));
  if (!result.published) {
    console.log(`Preflight passed for ${result.plan.tag}. Re-run with --execute to create the immutable public Release.`);
    return;
  }
  console.log(`Published and anonymously verified ${result.releaseUrl}`);
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
