# PartyBeam.Reflex first-publication end-to-end smoke

This procedure is the GameCatalog-side evidence plan for issue #7. The first real Reflex publication now exists, so the document records that immutable release and the remaining E2E work instead of describing publication as hypothetical.

Reflex remains on the **test** channel until the full real-path stability matrix is complete. Do not promote a prerelease to stable merely to satisfy this procedure.

## Current readiness

As of 2026-09-24:

- `partybeam.reflex@0.1.0-alpha.0` is published publicly as a GitHub prerelease in the Test channel;
- GameCatalog publication commit is `86370a468b5970446b0c099c4eea543f327805f9`;
- Release tag is `game-partybeam.reflex-v0.1.0-alpha.0`;
- the Release contains exactly one public package asset, `partybeam.reflex-0.1.0-alpha.0.partybeam`;
- outer asset SHA-256 is `f6506a8dbeff7ba0a9c8ea8dd0394cb5a37a80910f8e4ecc5e1f90a17f205f81`;
- manifest SHA-256 is `bd6cc7ca658859d36ec54c439b6e8b81fb42d51678d61eca425cdbaa1a944d76`;
- logical package SHA-256 is `0ab481f4817a53747a759aae65dc1b4e8618ee61f1461615b4195d65d0588dc8`;
- canonical PartyBeam full-package verification passed before publication;
- the release intentionally uses the First MVP unsigned-official profile: `signature.json` is present, but no publisher signature/keyId is required;
- stable channel does not contain this prerelease;
- Reflex issue #9 and Platform #16 remain open for real E2E evidence.

The issue #9 audit subsequently found a game-owned resource-pressure adaptation gap in alpha.0. Reflex PR #15 prepares `0.1.0-alpha.1`. Alpha.0 remains useful evidence for the already-published catalog/download/runtime path, but final #9 acceptance must use the next immutable package after that fix is validated and published.

No fake release or fixture package may substitute for the public immutable package path.

## Required identities to record

Before packaging, record:

```text
Reflex source commit:
Reflex version:
PartyBeam consumer/verifier commit:
GameCatalog baseline commit:
Release tag:
Outer asset SHA-256:
manifestSha256:
packageSha256:
Publisher signing profile: unsigned-official / signed
Publisher keyId: <only when signed>
```

All evidence below must refer to these exact identities.

## 1. Producer validation

From the private Reflex source repository:

1. execute its complete local unit/integration test suite;
2. build the TV, Android-controller and browser-controller payloads from one exact source/version;
3. generate final `manifest.json` rather than publishing the template;
4. prove each component `releaseVersion` exactly equals the package version;
5. calculate each component SHA-256 from the actual built payload bytes;
6. run PartyBeam's canonical manifest/package validation against those bytes;
7. generate the logical `packageSha256` using the PartyBeam descriptor contract;
8. produce canonical `signature.json` binding `manifestSha256` and `packageSha256`;
9. for First MVP unsigned-official publication, omit publisher signature metadata; if a signature is present, verify it against the active publisher trust store;
10. retain source/build provenance without copying private source into GameCatalog.

Expected output set:

```text
<gameId>-<version>.partybeam
manifest.json
signature.json
producer provenance / source commit evidence
```

Private signing material must never be included in any output. The current First MVP Reflex publication does not require retained publisher private-key material.

## 2. GameCatalog preparation

The trust store remains part of publication tooling, but a Reflex First MVP unsigned-official package does not require a retained publisher key. When optional signature metadata is present, the corresponding publisher key must be active and trusted.

Run:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test

npm run prepare-publication -- \
  --catalog catalog/v1/catalog.json \
  --manifest /path/to/manifest.json \
  --signature /path/to/signature.json \
  --package /path/to/partybeam.reflex-<version>.partybeam \
  --trust-store trust/v1/publisher-keys.json \
  --published-at <UTC timestamp> \
  --output /tmp/catalog.candidate.json \
  --channels-output-dir /tmp/catalog-v1-candidate \
  --provenance /tmp/reflex-publication.provenance.json
```

The preparation must fail if any of these differ:

- manifest bytes/hash;
- logical package hash;
- publisher/signing-key binding when publisher signature metadata is present;
- detached ECDSA signature when publisher signature metadata is present;
- package filename or physical asset hash/size;
- game/version identity;
- compatibility projection;
- channel/SemVer classification;
- baseline immutability.

Before public upload, provenance must be upgraded by the canonical full-package verification path so it truthfully records:

```json
{
  "cryptographicSignatureVerified": false,
  "componentPayloadsVerified": true,
  "fullPackageVerification": true
}
```

A candidate with `fullPackageVerification: false` is not publication authorization.

## 3. Public GitHub Release

Only after all prior gates pass:

1. confirm tag `game-partybeam.reflex-v<version>` does not already exist;
2. create the public Release in `PartyBeam.GameCatalog`;
3. upload exactly `partybeam.reflex-<version>.partybeam`;
4. do not upload Reflex source files, source maps containing private source, private repository metadata or credentials;
5. fetch the Release asset anonymously, without a GitHub token;
6. recompute SHA-256 and size from the anonymously downloaded bytes;
7. require exact equality with the prepared catalog candidate;
8. if the tag/version already exists with different bytes, stop and publish a new SemVer version instead.

Record the final public asset URL and GitHub Release/tag identity.

## 4. Catalog and channel commit

The reviewed GameCatalog change must update together:

```text
catalog/v1/catalog.json
catalog/v1/channels.json
catalog/v1/channels/stable.json
catalog/v1/channels/test.json
```

For the first prerelease:

- the exact release exists in canonical `catalog.json`;
- `publicationState` is `published`;
- `channel` is `test`;
- version has a SemVer prerelease identifier;
- `test.json` references the exact version;
- `stable.json` does not gain that prerelease merely because Test mode exists.

Run `npm test` and `npm run validate-channels` against the final candidate before committing.

## 5. PartyBeam online consumption

Using the normal PartyBeam catalog implementation — not a test-only file injection:

1. fetch public channel discovery/catalog anonymously;
2. confirm stable remains the default;
3. opt `partybeam.reflex` into prerelease selection explicitly;
4. resolve the exact Reflex test version from the public catalog;
5. download its `.partybeam` from the public GameCatalog Release URL with no private-source credential;
6. verify transport SHA-256/size;
7. verify manifest, component bytes and logical package hash through PartyBeam's normal verifier; when publisher signature metadata is present, verify that signature/trust binding too;
8. reject use/preparation if any verification fails;
9. expose compatible/incompatible status through normal PartyBeam catalog UX.

Record PartyBeam commit/version and structured verification outcome.

## 6. Offline/LAN retention

After successful online preparation:

1. retain the exact verified package locally on the TV/shared-screen host;
2. remove WAN access;
3. keep LAN available;
4. start Reflex using the retained exact version;
5. join with a supported phone that does not already have the required Reflex controller payload cached;
6. verify the host can redistribute the exact prepared component over LAN through the normal PartyBeam path;
7. complete a game without WAN.

This step belongs jointly to PartyBeam/Reflex E2E ownership. Failure must be filed in the repository that owns the broken layer rather than bypassed in GameCatalog.

## 7. Delist and local-playability smoke

After preserving evidence for the published test release:

1. create a candidate that changes only that exact release's `publicationState` to `delisted`;
2. regenerate channel indexes;
3. confirm it disappears from normal new test-channel discovery;
4. confirm the exact immutable release record remains in canonical `catalog.json`;
5. confirm package URL/hash/integrity metadata/compatibility/`publishedAt` did not change;
6. on a PartyBeam installation that already prepared the package, confirm the local title remains playable and receives no special delisted warning solely because of delisting;
7. confirm a fresh installation cannot acquire it through normal channel discovery.

Optionally relist the same exact release and prove discovery returns without altering package identity.

## 8. Tamper/failure smoke

At least once, using a non-production candidate or disposable download, prove these fail closed:

- one byte changed in `.partybeam` -> transport SHA-256 mismatch;
- manifest bytes changed -> `manifestSha256` mismatch;
- component bytes changed -> component hash failure in PartyBeam verifier;
- `packageSha256` changed -> logical hash mismatch/signature failure;
- for a signed-package candidate, signature byte changed -> invalid ECDSA signature;
- for a signed-package candidate, unknown `keyId` -> untrusted key;
- for a signed-package candidate, trusted key bound to another publisher -> publisher/key mismatch;
- catalog compatibility changed away from manifest -> projection validation failure;
- attempt to republish same `(gameId, version)` with different identity -> immutability failure.

## Evidence record

For the GameCatalog #7 completion comment, record at minimum:

```text
Reflex repo/source commit:
Reflex version:
PartyBeam commit:
GameCatalog commit:
Release tag:
Public asset URL:
Anonymous download: PASS/FAIL
Release asset SHA-256:
manifestSha256:
packageSha256:
Signing profile: unsigned-official/signed
keyId: <only when signed>
Full PartyBeam package verification: PASS/FAIL
Channel classification: stable/test
Online discovery/download: PASS/FAIL
Offline retained launch: PASS/FAIL
Fresh-client LAN redistribution: PASS/FAIL
Delist behavior: PASS/FAIL
Tamper checks: PASS/FAIL
```

Do not mark GameCatalog #7 complete with fixture-only evidence.

## Troubleshooting ownership

Use the owning repository for defects:

- catalog schema/index/provenance/public Release metadata -> `PartyBeam.GameCatalog`;
- package manifest/verifier/container/runtime preparation/catalog consumer -> `PartyBeam`;
- Reflex build/package contents/game behavior -> `PartyBeam.Reflex`;
- multiplayer transport/synchronized timing primitives -> `PartyGameKit`.

Cross-repository evidence should link exact commits rather than copying implementation between repositories.
