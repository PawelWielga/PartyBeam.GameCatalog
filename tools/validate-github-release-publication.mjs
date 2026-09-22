import crypto from "node:crypto";
import {
  assertRemoteResourceAbsent,
  buildReleasePlan,
  hashAnonymousAsset,
  validatePublishedRelease,
} from "./publish-github-release.mjs";

let failed = false;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

const assetBytes = Buffer.from("canonical release asset fixture", "utf8");
const assetSha256 = crypto.createHash("sha256").update(assetBytes).digest("hex");
const provenance = {
  gameId: "partybeam.release-fixture",
  version: "1.0.0-beta.1",
  channel: "test",
  releaseTag: "game-partybeam.release-fixture-v1.0.0-beta.1",
  assetUrl: "https://github.com/PawelWielga/PartyBeam.GameCatalog/releases/download/game-partybeam.release-fixture-v1.0.0-beta.1/partybeam.release-fixture-1.0.0-beta.1.partybeam",
  releaseAsset: {
    fileName: "partybeam.release-fixture-1.0.0-beta.1.partybeam",
    sizeBytes: assetBytes.length,
    sha256: assetSha256,
  },
  packageSha256: "a".repeat(64),
  signature: { keyId: "fixture-key" },
  componentPayloadsVerified: true,
  fullPackageVerification: true,
  canonicalVerifier: { commit: "b".repeat(40) },
};

const plan = buildReleasePlan({
  provenance,
  packagePath: `C:/tmp/${provenance.releaseAsset.fileName}`,
});
if (plan.prerelease && plan.tag === provenance.releaseTag && plan.repository === "PawelWielga/PartyBeam.GameCatalog") {
  pass("test-channel publication produces an exact immutable prerelease plan");
} else {
  fail("release plan does not preserve provenance identity/channel");
}

const unsignedProvenance = {
  ...provenance,
  gameId: "partybeam.grimcellar",
  version: "0.1.0-preview.1",
  releaseTag: "game-partybeam.grimcellar-v0.1.0-preview.1",
  assetUrl: "https://github.com/PawelWielga/PartyBeam.GameCatalog/releases/download/game-partybeam.grimcellar-v0.1.0-preview.1/partybeam.grimcellar-0.1.0-preview.1.partybeam",
  releaseAsset: {
    ...provenance.releaseAsset,
    fileName: "partybeam.grimcellar-0.1.0-preview.1.partybeam",
  },
  signature: undefined,
};
const unsignedPlan = buildReleasePlan({
  provenance: unsignedProvenance,
  packagePath: `C:/tmp/${unsignedProvenance.releaseAsset.fileName}`,
});
if (
  unsignedPlan.notes.includes("Signing key: none (First MVP unsigned-official profile)")
  && unsignedPlan.tag === unsignedProvenance.releaseTag
) {
  pass("unsigned First MVP publication produces a release plan without signature metadata");
} else {
  fail("unsigned release plan did not preserve unsigned First MVP publication semantics");
}

const validReleaseErrors = validatePublishedRelease(plan, {
  tagName: plan.tag,
  isDraft: false,
  isPrerelease: true,
  assets: [{
    name: plan.asset.fileName,
    size: plan.asset.sizeBytes,
    state: "uploaded",
    digest: `sha256:${plan.asset.sha256}`,
    url: plan.assetUrl,
  }],
});
if (validReleaseErrors.length === 0) pass("published release metadata matches the exact publication plan");
else fail(`valid published release was rejected: ${validReleaseErrors.join("; ")}`);

const conflictingReleaseErrors = validatePublishedRelease(plan, {
  tagName: plan.tag,
  isDraft: false,
  isPrerelease: false,
  assets: [
    {
      name: plan.asset.fileName,
      size: plan.asset.sizeBytes,
      state: "uploaded",
      digest: `sha256:${plan.asset.sha256}`,
      url: plan.assetUrl,
    },
    { name: "unexpected.partybeam", size: 1, state: "uploaded", digest: "sha256:invalid", url: "https://example.invalid" },
  ],
});
if (
  conflictingReleaseErrors.some((error) => error.includes("prerelease"))
  && conflictingReleaseErrors.some((error) => error.includes("exactly one asset"))
) {
  pass("contradictory channel metadata and extra assets fail post-publication validation");
} else {
  fail("invalid published release metadata was accepted");
}

const anonymousResult = await hashAnonymousAsset(
  plan.assetUrl,
  async () => new Response(assetBytes, { status: 200 }),
);
if (anonymousResult.sizeBytes === assetBytes.length && anonymousResult.sha256 === assetSha256) {
  pass("anonymous download verification streams and hashes the exact public bytes");
} else {
  fail("anonymous download verification returned the wrong identity");
}

let missingCanonicalEvidenceRejected = false;
try {
  buildReleasePlan({
    provenance: { ...provenance, canonicalVerifier: undefined },
    packagePath: `C:/tmp/${provenance.releaseAsset.fileName}`,
  });
} catch (error) {
  missingCanonicalEvidenceRejected = error.message.includes("Canonical verifier evidence is missing");
}
if (missingCanonicalEvidenceRejected) pass("release planning fails without canonical verifier evidence");
else fail("release planning accepted missing canonical verifier evidence");

assertRemoteResourceAbsent({ status: 1, stderr: "gh: Not Found (HTTP 404)", stdout: "" }, "fixture tag");
let existingTagRejected = false;
try {
  assertRemoteResourceAbsent({ status: 0, stderr: "", stdout: "{}" }, "fixture tag");
} catch (error) {
  existingTagRejected = error.message.includes("already exists") && error.message.includes("immutable");
}
if (existingTagRejected) pass("existing remote release identity is rejected without an overwrite path");
else fail("existing remote release identity was accepted");

if (failed) process.exitCode = 1;
else console.log("All GitHub Release publication tests passed.");
