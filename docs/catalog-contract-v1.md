# PartyBeam official catalog contract v1

This document defines the semantics of `schemas/v1/catalog.schema.json` and the invariants PartyBeam publication tooling must enforce.

## Status

Catalog v1 is aligned with the current game-package v1 contract through merged `PawelWielga/PartyBeam.Platform` PR #121. The upstream schema snapshot used by local publication validation is pinned under `schemas/upstream/partybeam/v1/` together with its source commit.

PartyBeam.Platform remains authoritative for the package format and cryptographic verification. Any upstream contract change must refresh the pinned schemas and projection fixtures before publication tooling is considered synchronized.

The catalog must never weaken or override the package manifest/integrity envelope. When a publisher signature is present, it must also preserve and verify that signature projection.

## Document identity

A catalog document contains:

- `schemaVersion`: currently `1`;
- `catalogId`: currently `partybeam-official`;
- optional `generatedAt` informational timestamp;
- `games`: official catalog entries.

Incompatible catalog changes require a new versioned schema/path. Existing v1 documents must not silently acquire incompatible meaning after the contract is frozen.

## Game identity

`gameId` is the stable machine-readable identity for one game across releases.

Changing title, artwork, supported languages or publisher display text does not create a new game identity. A new unrelated title must not reuse an existing `gameId`.

`publisher.id` and `publisher.displayName` are projected from the manifest. `publisher.kind` is catalog admission policy metadata and is deliberately not controlled by the package itself. First MVP publication accepts only `first-party` with the canonical publisher id `partybeam`; the schema can represent `approved-external` later without redefining release identity.

`creator` remains optional catalog metadata when a separate creator identity is useful.

## Catalog metadata

`catalogMetadata` contains discovery/presentation data.

- `defaultLocale` selects the preferred catalog fallback;
- `locales` contains localized title/summary plus optional official presentation references;
- when a package declares a canonical `kind: "cover"` asset, every locale receives the deterministic GameCatalog `artworkUrl`;
- `supportUrl` mirrors the verified manifest support destination when one is declared.

For package v1, English (`en`) is required as the terminal catalog fallback. Publication validation checks that catalog locales agree with the verified manifest and that catalog summaries/titles do not contradict package author metadata.

Age rating, monetization and advertising metadata remain outside the MVP contract.

## Exact releases

Every release is identified by:

```text
(gameId, version)
```

`version` is SemVer 2.0.0. The tuple is immutable after publication: different package bytes, logical package identity, signature identity or compatibility facts must not later replace an already published exact release.

A game may contain multiple releases simultaneously.

### Channel classification

- `stable`: SemVer without a prerelease suffix;
- `test`: official SemVer prerelease.

Channel indexes are implemented separately. They are derived from exact release records and must not create a second release identity.

### Publication state

`publicationState` is either:

- `published`: eligible for normal discovery according to channel;
- `delisted`: retained as historical/auditable metadata but excluded from normal new discovery.

Delisting is a distribution state only. It does not invalidate or delete an already verified compatible local package.

## Package resolution and integrity layers

`package` resolves one exact public `.partybeam` GitHub Release asset and carries two deliberately separate integrity layers.

### Downloaded asset integrity

- `assetUrl`: public HTTPS GitHub Release asset in `PartyBeam.GameCatalog`;
- `fileName`: expected `.partybeam` filename;
- optional `sizeBytes`;
- `integrity.algorithm`: `SHA-256`;
- `integrity.digest`: SHA-256 of the exact downloadable asset bytes.

This protects transport/download integrity for the physical release asset.

### Logical package identity and optional publisher signature

PartyBeam package v1 uses `signature.json` as an integrity/signature envelope. GameCatalog always mirrors:

- `manifestSha256`: SHA-256 of the exact `manifest.json` bytes;
- `packageSha256`: SHA-256 of PartyBeam's deterministic logical package-content descriptor.

When publisher signing is present, GameCatalog additionally mirrors:

- `signature.algorithm`: `ecdsa-p256-sha256-p1363`;
- `signature.keyId`: trusted signing-key identifier;
- `signature.valueBase64`: 64-byte IEEE P1363 ECDSA signature encoded as canonical Base64.

The logical `packageSha256` is intentionally not the same concept as the `.partybeam` asset-byte hash. First MVP may omit publisher signature metadata while still pinning both logical identity and exact downloadable bytes.

See `docs/package-contract-alignment.md` for the field mapping and descriptor rules.

## Compatibility projection

`compatibility` allows PartyBeam to perform discovery/filtering before fully preparing a package. The manifest remains authoritative.

The projection mirrors:

- Game Contract range;
- available component surfaces;
- runtime locales common to the complete release;
- catalog locales;
- player range;
- controller topology;
- required/optional capability lists;
- derived Internet-access requirement;
- standby/resume support.

Manifest component kinds are normalized to catalog surface names:

- `tv` -> `tv`;
- `androidController` -> `android`;
- `browserController` -> `browser`.

Manifest controller topology values are normalized as:

- `onePhonePerPlayer` -> `one-phone-per-player`;
- `sharedPhone` -> `shared-phone`.

`compatibility.capabilities.internetAccess` is derived from the signed capability lists. The exact signed WAN `network.outboundAllowlist` remains package/runtime-security data and is not duplicated into the public discovery projection.

## Validation invariants

Publication validation fails closed and currently enforces at least:

1. catalog JSON Schema validity;
2. unique `gameId` values;
3. unique `(gameId, version)` identities;
4. immutable package and compatibility metadata for existing exact releases;
5. valid stable/test SemVer classification;
6. `gameContractApi.minInclusive < gameContractApi.maxExclusive`;
7. `playerCount.min <= playerCount.max`;
8. English runtime/catalog fallback required by manifest v1;
9. no capability may be both required and optional;
10. derived `internetAccess` summary must agree with required/optional capability declarations;
11. catalog locale declarations must have matching catalog metadata;
12. package URLs must be public GitHub Release assets owned by this distribution repository;
13. actual `.partybeam` bytes must match `package.integrity.digest` and `sizeBytes` when supplied;
14. `manifest.json` and `signature.json` must pass the pinned upstream PartyBeam v1 schemas;
15. exact manifest bytes must hash to both envelope and catalog `manifestSha256`;
16. PartyBeam's deterministic logical descriptor must hash to both envelope and catalog `packageSha256`;
17. when present, signature algorithm/key/value metadata must match the envelope;
18. game, version and publisher identity must agree with the manifest;
19. Game Contract, players, topology, surfaces, locales, capabilities and standby/resume projection must agree with the manifest;
20. localized title/summary and support URL projection must agree with package metadata;
21. every manifest component `releaseVersion` must equal the exact package version;
22. only publisher identities admitted by current official-catalog policy may be newly published;
23. game-owned catalog artwork paths/IDs are unambiguous and at most one canonical cover is declared;
24. a declared cover must be a verified PNG with exact 2:3 aspect ratio, at most 8 MiB, and bytes matching the SHA-256 in the signed manifest;
25. cover publication deterministically targets `artwork/v1/<gameId>/cover.png` and the corresponding raw GitHub URL in every locale;
26. PartyBeam's canonical full-package verifier must report the same declared cover identity/hash before final publication authorization.

For signed packages, cryptographic ECDSA verification against the production trusted-key registry remains mandatory. First MVP unsigned official packages instead rely on the explicit integrity-only policy plus canonical full-package verification. GameCatalog invokes PartyBeam's canonical verifier for the complete container rather than implementing a second package extractor.

## Public URL stability

Canonical v1 catalog:

```text
https://raw.githubusercontent.com/PawelWielga/PartyBeam.GameCatalog/main/catalog/v1/catalog.json
```

Canonical v1 schema:

```text
https://raw.githubusercontent.com/PawelWielga/PartyBeam.GameCatalog/main/schemas/v1/catalog.schema.json
```

PartyBeam clients must not need GitHub tokens, private-repository credentials or publisher secrets to read catalog data or download public package assets.

## Fixtures

Fixtures live under `fixtures/v1/`:

- `valid/`: structurally and semantically valid catalog examples;
- `invalid/`: catalog-shape/semantic rejection examples;
- `assets/` + `integrity/`: physical package-byte hash fixtures;
- `package-contract/`: manifest/integrity-envelope and signed-envelope projection fixtures, including valid mapping, deliberate catalog disagreement, malformed manifest and invalid signature metadata.

The local test suite also creates in-memory mutations for immutable release identity, external-publisher policy, Game Contract ordering, English fallback and Internet-access summary consistency.

## CI policy

GitHub Actions are intentionally disabled until the planned self-hosted runner is configured. Validation is implemented as deterministic repository scripts and is run through `npm test`, `npm run validate`, `npm run verify-package` and `npm run validate-package-projection`.

See `docs/ci-policy.md`.

## Relationship to PartyBeam product policy

This contract follows PartyBeam's current rules:

- the official catalog is the only MVP publication source;
- Developer/Test mode is not a trust bypass;
- Game Contract compatibility is independently versioned from the PartyBeam app;
- all components in one GameSession belong to one exact game release;
- authenticity does not grant native privileges, unrestricted filesystem/network access, entitlement or DRM rights;
- delisting does not imply remote deletion or revocation of an already prepared valid package.
