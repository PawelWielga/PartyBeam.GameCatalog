# PartyBeam.Reflex first-publication end-to-end smoke

This procedure is the GameCatalog-side evidence plan for issue #7. It is intentionally written before the first real publication so the test cannot be weakened after seeing a convenient result.

The first Reflex release should use the **test** channel unless all Reflex stability gates have already been completed. Do not publish an experimental build as stable merely to satisfy this procedure.

## Current readiness

At the time this document was added:

- `PawelWielga/PartyBeam.Reflex` is private, as intended;
- Reflex already has a manifest template for `partybeam.reflex`, TV + Android controller + browser controller and deterministic local package tooling;
- Reflex packaging currently creates a deterministic ZIP-based `.partybeam`, but that producer implementation is not treated as the generic PartyBeam container contract;
- Reflex issue #7 `[06] Integrate synchronized timing and fairness policy` is still open and blocks producer publication issue #8;
- PartyBeam package-contract PR #19 is still draft;
- PartyBeam catalog-consumer issue #5 is still open;
- the GameCatalog production publisher trust store is intentionally empty until a real PartyBeam public signing key is provisioned;
- GitHub Actions remain disabled until the self-hosted runner is configured.

No fake release or fixture package may be substituted for these prerequisites.

## Required identities to record

Before packaging, record:

```text
Reflex source commit:
Reflex version:
PartyBeam package-contract commit:
PartyBeam consumer commit:
GameCatalog baseline commit:
Publisher keyId:
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
8. sign that exact logical hash with the approved private signing key;
9. produce detached `signature.json` with the approved `keyId`;
10. retain source/build provenance without copying private source into GameCatalog.

Expected output set:

```text
<gameId>-<version>.partybeam
manifest.json
signature.json
producer provenance / source commit evidence
```

Private signing material must not be included in any output.

## 2. GameCatalog preparation

The corresponding public key must already exist as `active` for publisher `partybeam` in `trust/v1/publisher-keys.json` through a separately reviewed trust-store change.

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
- publisher/signing-key binding;
- detached ECDSA signature;
- package filename or physical asset hash/size;
- game/version identity;
- compatibility projection;
- channel/SemVer classification;
- baseline immutability.

Before public upload, provenance must be upgraded by the canonical full-package verification path so it truthfully records:

```json
{
  "cryptographicSignatureVerified": true,
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
7. verify manifest, component bytes, logical package hash and signature through PartyBeam's normal verifier/trust store;
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
5. confirm package URL/hash/signature/compatibility/`publishedAt` did not change;
6. on a PartyBeam installation that already prepared the package, confirm the local title remains playable and receives no special delisted warning solely because of delisting;
7. confirm a fresh installation cannot acquire it through normal channel discovery.

Optionally relist the same exact release and prove discovery returns without altering package identity.

## 8. Tamper/failure smoke

At least once, using a non-production candidate or disposable download, prove these fail closed:

- one byte changed in `.partybeam` -> transport SHA-256 mismatch;
- manifest bytes changed -> `manifestSha256` mismatch;
- component bytes changed -> component hash failure in PartyBeam verifier;
- `packageSha256` changed -> logical hash mismatch/signature failure;
- signature byte changed -> invalid ECDSA signature;
- unknown `keyId` -> untrusted key;
- trusted key bound to another publisher -> publisher/key mismatch;
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
keyId:
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
