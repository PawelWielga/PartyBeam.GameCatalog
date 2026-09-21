# PartyBeam.GameCatalog

Public, GitHub-only catalog and distribution boundary for official PartyBeam games.

This repository contains machine-readable catalog metadata and public compiled PartyBeam game release assets. Game source code remains in per-game repositories and does not need to be public.

For the exact remaining work and execution order needed for the PartyBeam ecosystem First MVP, see [docs/first-mvp-roadmap.md](docs/first-mvp-roadmap.md). The current critical publication items are the retained first-party publisher key (#11), the signed Grimcellar Test-channel publication (#12), and then the real Reflex publication/end-to-end evidence (#7).

## Ownership boundary

This repository owns:

- official catalog metadata;
- exact release/distribution metadata;
- stable vs test/prerelease classification and deterministic channel indexes;
- public package asset locations;
- transport integrity metadata for downloadable `.partybeam` assets;
- the signed manifest/package hash and signature-envelope projection needed by publication tooling;
- the public publisher signing-key trust store used by publication validation;
- publication and delisting state.

This repository does **not** own:

- PartyBeam shell/session/runtime code;
- game source code or gameplay logic;
- arbitrary community feeds or sideloading;
- accounts, entitlements, purchases or DRM;
- signing private keys;
- the authoritative package-internal manifest contract.

The signed package manifest remains authoritative for package-internal declarations. Catalog compatibility fields are a discovery/filtering projection and publication validation must reject disagreement with the signed manifest.

## Public contract layout

```text
catalog/
  v1/
    catalog.json
    channels.json
    channels/
      stable.json
      test.json
schemas/
  v1/
    catalog.schema.json
    channel-index.schema.json
    channels.schema.json
    publication-provenance.schema.json
    publisher-trust-store.schema.json
  upstream/partybeam/v1/
trust/
  v1/
    publisher-keys.json
fixtures/
  v1/
    assets/
    channels/
    integrity/
    package-contract/
    valid/
    invalid/
docs/
  catalog-contract-v1.md
  channel-indexes.md
  package-contract-alignment.md
  publisher-trust-store.md
  publication-workflow.md
  ci-policy.md
tools/
  generate-channel-indexes.mjs
  prepare-publication.mjs
  validate-catalog.mjs
  validate-catalog-semantics.mjs
  validate-channel-indexes.mjs
  validate-fixtures.mjs
  validate-package-projection.mjs
  validate-package-signature.mjs
  validate-publication-preparation.mjs
  verify-package-integrity.mjs
  verify-package-signature.mjs
```

`catalog/v1/catalog.json` is the canonical v1 release document. Channel files are deterministic discovery projections and must never become a second source of package/integrity truth.

## Public URL conventions

PartyBeam clients may read the current v1 catalog directly from GitHub:

```text
https://raw.githubusercontent.com/PawelWielga/PartyBeam.GameCatalog/main/catalog/v1/catalog.json
```

Channel discovery is available at:

```text
https://raw.githubusercontent.com/PawelWielga/PartyBeam.GameCatalog/main/catalog/v1/channels.json
```

Published package URLs use public GitHub Release assets in this repository. The naming convention is:

```text
release tag: game-<gameId>-v<semver>
asset name:  <gameId>-<semver>.partybeam
```

The catalog stores the exact resolved asset URL and transport SHA-256. URL naming is not a substitute for integrity verification.

## Package authenticity model

PartyBeam package manifest v1, merged in `PawelWielga/PartyBeam.Platform` PR #19, uses a detached signature envelope with:

- exact `manifestSha256`;
- deterministic logical `packageSha256`;
- `ecdsa-p256-sha256-p1363` signature metadata;
- explicit trusted `keyId`.

The catalog stores those values unchanged for one exact release. Separately, `package.integrity.digest` is SHA-256 of the downloadable GitHub Release asset bytes.

This distinction is intentional: PartyBeam signs logical package contents independently of ZIP/container layout, while the catalog must also verify the exact bytes fetched from GitHub.

Publication additionally binds each trusted `keyId` to an explicit `publisherId` through `trust/v1/publisher-keys.json`. The store contains the integration-only public key used for `partybeam.placeholder` and the retained `partybeam-first-party-2026-09` public release identity used for production-intended first-party games. Private signing material is never committed.

See `docs/package-contract-alignment.md` and `docs/publisher-trust-store.md`.

## Validation

Install the pinned validation dependencies and run the full local suite:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
```

Validate only the canonical live catalog:

```bash
npm run validate
```

Regenerate stable/test discovery projections from the canonical catalog:

```bash
npm run generate-channels
```

Check that committed channel projections are exact deterministic derivatives of the catalog:

```bash
npm run validate-channels
```

Validate a candidate against an older catalog to enforce immutable exact-release metadata:

```bash
npm run validate -- --baseline path/to/previous-catalog.json
```

Verify actual `.partybeam` asset bytes against a catalog release:

```bash
npm run verify-package -- \
  --catalog path/to/catalog.json \
  --game partybeam.example \
  --version 1.2.3 \
  --package path/to/partybeam.example-1.2.3.partybeam
```

Audit every canonical public Release asset through an anonymous download, including delisted historical releases:

```bash
npm run audit-public-assets

# or one exact release
npm run audit-public-assets -- --game-id partybeam.example --version 1.2.3
```

The audit fails if an asset is unavailable or its downloaded byte count/SHA-256 differs from the immutable catalog record.

Verify that the securely stored retained first-party private key matches the committed public release identity before signing a release:

```bash
npm run verify-retained-signing-key -- --private-key /secure/path/partybeam-first-party-2026-09.private.pem
```

Verify the detached ECDSA P-256 signature against an explicitly trusted publisher key:

```bash
npm run verify-package-signature -- \
  --signature path/to/signature.json \
  --publisher partybeam \
  --trust-store trust/v1/publisher-keys.json
```

Validate catalog metadata against a signed package manifest and detached signature envelope:

```bash
npm run validate-package-projection -- \
  --catalog path/to/catalog.json \
  --game partybeam.example \
  --version 1.2.3 \
  --manifest path/to/manifest.json \
  --signature path/to/signature.json
```

The validation layer covers:

- JSON Schema 2020-12 correctness;
- pinned PartyBeam manifest/signature-envelope schemas;
- unique game identities and exact release versions;
- stable/test SemVer consistency;
- deterministic channel indexes with stable as default and test as explicit opt-in;
- Game Contract range ordering and player-range correctness;
- English runtime/catalog fallback required by package manifest v1;
- required/optional capability consistency and derived Internet-access summary;
- official public `PartyBeam.GameCatalog` GitHub Release destinations;
- immutable package and compatibility metadata for an already known `(gameId, version)`;
- physical release-asset SHA-256 and size when package bytes are supplied;
- exact manifest SHA-256 and PartyBeam logical package SHA-256;
- ECDSA P-256/P1363 signature shape and cryptographic verification over the prehashed logical `packageSha256`;
- trusted `keyId` → `publisherId` binding and active-key policy for new publication;
- game/release/publisher identity agreement;
- Game Contract, player, controller, surface, locale, capability and standby/resume projection agreement;
- localized catalog metadata/support URL agreement with the signed manifest;
- first-party-only MVP publication policy while retaining schema support for future approved external publishers.

Publication-side signature verification uses `@noble/curves` P-256 with `prehash: false` because PartyBeam's .NET contract signs the already-computed `packageSha256` via `ECDsa.SignHash`. Full package verification still belongs to PartyBeam's canonical `GamePackageVerifier`, which additionally validates the actual component payload bytes.

## Stable and test channels

`catalog/v1/channels.json` explicitly declares `stable` as the default channel. Test is prerelease-only and requires opt-in.

`stable.json` and `test.json` carry only game/version identities and `latestVersion`. PartyBeam resolves an exact version back into `catalog.json` for full release metadata, which prevents channel files from contradicting hashes or compatibility information.

See `docs/channel-indexes.md`.

## Placeholder integration game

The stable catalog contains `partybeam.placeholder` `0.1.0`, a deliberately small first-party package used to exercise normal PartyBeam discovery and package loading before a production game is ready. The public Release asset contains TV, Android-controller and browser-controller web components and reports `runtime.ready` through the standard sandbox bridge.

The package is signed and was fully verified with PartyBeam's canonical `PartyBeam.PackageVerifier`. It is integration content, not a replacement for the real Reflex end-to-end publication evidence described in `docs/reflex-end-to-end-smoke.md`.

## Publication preparation

Issue #4 has a deterministic local preparation path. It generates a reviewable catalog candidate, matching channel-index candidates and provenance record without mutating GitHub:

```bash
npm run prepare-publication -- \
  --catalog catalog/v1/catalog.json \
  --manifest /path/to/manifest.json \
  --signature /path/to/signature.json \
  --package /path/to/<gameId>-<version>.partybeam \
  --trust-store trust/v1/publisher-keys.json \
  --published-at 2026-09-14T08:00:00Z \
  --output /tmp/catalog.candidate.json \
  --channels-output-dir /tmp/catalog-v1-candidate \
  --provenance /tmp/publication.provenance.json
```

Preparation derives the channel, Release tag/URL, asset hash/size, catalog metadata and compatibility projection from signed package inputs, verifies the signature against an active publisher key, regenerates stable/test projections, then runs all currently available catalog/package consistency gates. Reusing an existing exact game/version is rejected.

The generated provenance records `cryptographicSignatureVerified: true`, but initially records `componentPayloadsVerified: false` and `fullPackageVerification: false`. It additionally binds SHA-256 hashes of the candidate catalog and all generated channel documents. Run `npm run verify-full-package` with a clean `PartyBeam.Platform` checkout to invoke the canonical .NET verifier and produce finalized provenance bound to the exact verifier commit, package bytes and trusted key. `npm run publish-github-release` then performs a non-mutating authorization/collision preflight by default; explicit `--execute` creates the Release, uploads one non-replaceable asset and verifies its anonymous public bytes. A prepared candidate alone is still not authorization to create the public GitHub Release.

See `docs/publication-workflow.md`.

## CI policy

GitHub Actions are currently **disabled intentionally** until the planned self-hosted runner is configured. Validation logic stays in repository scripts so it can be run locally now and invoked unchanged by the future self-hosted workflow.

See `docs/ci-policy.md`.

## Trust model

PartyBeam MVP accepts only official first-party publications. The schema nevertheless carries explicit publisher identity so a future approved external publisher can be represented without redefining game or release identity.

A catalog entry is an official publication statement, not permission to run arbitrary native code. Package authenticity, runtime sandboxing, capability enforcement and Game Contract compatibility remain separate concerns.

## Version and identity rules

- `gameId` is stable across all releases of one game;
- `publisher.id` is explicit and stable;
- each `(gameId, version)` pair identifies one immutable package release;
- `version` is SemVer 2.0.0;
- stable releases cannot contain a SemVer prerelease suffix;
- test releases use SemVer prerelease versions;
- catalog delisting does not invalidate a previously downloaded verified compatible package;
- package bytes or signed logical identity for an already published exact version must never be silently replaced.

See `docs/catalog-contract-v1.md` for the full catalog contract rationale.
