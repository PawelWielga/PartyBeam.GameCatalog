# PartyBeam.GameCatalog

Public, GitHub-only catalog and distribution boundary for official PartyBeam games.

This repository contains machine-readable catalog metadata and public compiled PartyBeam game release assets. Game source code remains in per-game repositories and does not need to be public.

## Ownership boundary

This repository owns:

- official catalog metadata;
- exact release/distribution metadata;
- stable vs test/prerelease classification;
- public package asset locations;
- transport integrity metadata for downloadable `.partybeam` assets;
- the signed manifest/package hash and signature-envelope projection needed by publication tooling;
- publication and delisting state.

This repository does **not** own:

- PartyBeam shell/session/runtime code;
- game source code or gameplay logic;
- arbitrary community feeds or sideloading;
- accounts, entitlements, purchases or DRM;
- the authoritative package-internal manifest contract.

The signed package manifest remains authoritative for package-internal declarations. Catalog compatibility fields are a discovery/filtering projection and publication validation must reject disagreement with the signed manifest.

## Public contract layout

```text
catalog/
  v1/
    catalog.json
schemas/
  v1/
    catalog.schema.json
fixtures/
  v1/
    assets/
    integrity/
    package-contract/
    valid/
    invalid/
docs/
  catalog-contract-v1.md
  package-contract-alignment.md
  ci-policy.md
tools/
  validate-catalog.mjs
  validate-fixtures.mjs
  validate-package-projection.mjs
  verify-package-integrity.mjs
```

`catalog/v1/catalog.json` is the canonical v1 catalog document. Future incompatible catalog contracts must use a new versioned path rather than changing frozen v1 semantics in place.

Stable/test channel-specific indexes are intentionally deferred to issue #5. The release model already carries deterministic channel classification so those indexes can be derived without redefining release identity.

## Public URL conventions

PartyBeam clients may read the current v1 catalog directly from GitHub:

```text
https://raw.githubusercontent.com/PawelWielga/PartyBeam.GameCatalog/main/catalog/v1/catalog.json
```

Published package URLs use public GitHub Release assets in this repository. The planned naming convention is:

```text
release tag: game-<gameId>-v<semver>
asset name:  <gameId>-<semver>.partybeam
```

The catalog stores the exact resolved asset URL and transport SHA-256. URL naming is not a substitute for integrity verification.

## Package authenticity model

PartyBeam package manifest v1, currently implemented in `PawelWielga/PartyBeam` draft PR #19, uses a detached signature envelope with:

- exact `manifestSha256`;
- deterministic logical `packageSha256`;
- `ecdsa-p256-sha256-p1363` signature metadata;
- explicit trusted `keyId`.

The catalog stores those values unchanged for one exact release. Separately, `package.integrity.digest` is SHA-256 of the downloadable GitHub Release asset bytes.

This distinction is intentional: PartyBeam signs logical package contents independently of ZIP/container layout, while the catalog must also verify the exact bytes fetched from GitHub.

See `docs/package-contract-alignment.md` for the field-by-field mapping.

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
- unique game identities and exact release versions;
- stable/test SemVer consistency;
- official public `PartyBeam.GameCatalog` GitHub Release destinations;
- immutable package and compatibility metadata for an already known `(gameId, version)`;
- physical release-asset SHA-256 and size when package bytes are supplied;
- exact manifest SHA-256 and PartyBeam logical package SHA-256;
- ECDSA P-256 signature metadata shape and equality with the detached envelope;
- game/release/publisher identity agreement;
- Game Contract, player, controller, surface, locale, capability and standby/resume projection agreement;
- localized catalog metadata/support URL agreement with the signed manifest;
- first-party-only MVP publication policy while retaining schema support for future approved external publishers.

Cryptographic ECDSA verification against the production trusted-key store remains owned by PartyBeam's canonical package verifier while PR #19 is still draft. This repository must share/invoke that verified implementation once available rather than invent a second crypto contract.

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
