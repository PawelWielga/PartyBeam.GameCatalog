# PartyBeam package contract alignment

This document records how `PartyBeam.GameCatalog` v1 projects the signed PartyBeam game package contract.

The current alignment target is merged `PawelWielga/PartyBeam.Platform` PR #121, pinned to canonical `main` commit `867546d31a71c2006054b58472a9714f3e9e5ec2` in `schemas/upstream/partybeam/v1/source.json`. This includes optional game-owned `catalog.artwork[]` payloads.

## Authority

The verified package remains authoritative for runtime facts. The catalog is a public discovery/distribution projection and must never override a different manifest value.

Publication validation therefore checks separate layers:

1. release asset integrity: SHA-256 of the actual downloadable `.partybeam` file;
2. signed logical package identity: exact manifest hash, logical package hash and detached signature;
3. publication trust: `keyId` must resolve to an active public key bound to the exact publisher identity;
4. catalog projection equality: discovery/compatibility fields must agree with the verified manifest;
5. full package-payload verification: performed by PartyBeam's canonical `GamePackageVerifier` through `npm run verify-full-package`, including every declared catalog-artwork payload.

## Integrity and signature mapping

PartyBeam package manifest v1 uses a detached `signature.json` envelope:

- `manifestSha256`: SHA-256 of the exact `manifest.json` bytes;
- `packageSha256`: SHA-256 of PartyBeam's deterministic logical package-content descriptor;
- `signature.algorithm`: `ecdsa-p256-sha256-p1363`;
- `signature.keyId`: trusted signing-key identifier;
- `signature.valueBase64`: 64-byte IEEE P1363 ECDSA signature encoded as Base64.

The catalog release stores those values unchanged under `package.manifestSha256`, `package.packageSha256` and `package.signature`.

`package.integrity.digest` is deliberately different: it is the SHA-256 of the downloadable GitHub Release asset bytes. PartyBeam's logical package hash is container-independent, while the catalog still needs a transport-level hash for the exact asset being downloaded.

A repacked container can therefore have a different `package.integrity.digest` while retaining the same signed logical `packageSha256` only before publication under a new allowed identity/policy. An already published `(gameId, version)` remains immutable in this catalog and its public asset must not be silently replaced.

## Publisher trust mapping

`tools/verify-package-signature.mjs` verifies the detached ECDSA signature before publication preparation.

The public trust store in `trust/v1/publisher-keys.json` binds:

```text
keyId -> publisherId -> algorithm/status/public key
```

For a new publication:

- the key must exist;
- its `publisherId` must equal manifest `publisher.id`;
- its status must be `active`;
- its algorithm must be `ecdsa-p256-sha256-p1363`;
- the P1363 signature must verify over the already-computed 32-byte `packageSha256` without hashing it a second time.

The production trust store currently contains the public key used only for the signed `partybeam.placeholder` integration release. Future game publications require a separately managed long-lived production signing key; the placeholder private key is not committed or reused.

See `docs/publisher-trust-store.md`.

## Identity mapping

| Catalog | Verified manifest |
| --- | --- |
| `game.gameId` | `gameId` |
| `release.version` | `version` |
| `game.publisher.id` | `publisher.id` |
| `game.publisher.displayName` | `publisher.displayName` |

`publisher.kind` is catalog policy metadata (`first-party` today, `approved-external` later). It is intentionally not supplied by the package to grant itself publication trust.

## Compatibility projection

| Catalog | Verified manifest |
| --- | --- |
| `compatibility.gameContractApi.minInclusive` | `gameContract.minimumVersion` |
| `compatibility.gameContractApi.maxExclusive` | `gameContract.maximumVersionExclusive` |
| `compatibility.playerCount.min` | `players.minimum` |
| `compatibility.playerCount.max` | `players.maximum` |
| `compatibility.controllerTopologies[0]` | `controllerTopology` |
| `compatibility.catalogLocales` | `catalogLocales` |
| `compatibility.standbyResumeSupported` | `supportsStandbyResume` |
| `compatibility.capabilities.required` | `capabilities.required` |
| `compatibility.capabilities.optional` | `capabilities.optional` |

Controller topology wire values are normalized for existing catalog consumers:

- manifest `onePhonePerPlayer` -> catalog `one-phone-per-player`;
- manifest `sharedPhone` -> catalog `shared-phone`.

`compatibility.capabilities.internetAccess` is derived from the signed capability lists:

- `required` when `internetAccess` is in `capabilities.required`;
- `optional` when it is in `capabilities.optional`;
- `none` otherwise.

The exact WAN `network.outboundAllowlist` stays in the verified manifest and is not duplicated into catalog discovery metadata. Publication validation still checks PartyBeam's semantic coupling: `internetAccess` requires at least one valid HTTPS allowlist destination, while an allowlist without `internetAccess` is invalid.

## Component and surface mapping

Manifest schema v1 requires exactly one component of each kind:

- `tv` -> catalog surface `tv`;
- `androidController` -> catalog surface `android`;
- `browserController` -> catalog surface `browser`.

Publication validation additionally rejects duplicate component IDs and duplicate `artifactPath` values because those are semantic constraints not fully expressible by the upstream JSON Schema alone.

`compatibility.runtimeLocales` is the case-insensitive intersection of `components[].runtimeLocales`, meaning languages in this catalog field are safe to advertise as supported across the complete release rather than merely by one component.

Per-component runtime locale differences remain authoritative in the verified manifest.

## Catalog presentation metadata

The package manifest's `catalog` object supplies signed author metadata. Publication validation maps:

- valid `catalog.supportUrl` -> `catalogMetadata.supportUrl`;
- `catalog.localized[locale].shortDescription` -> `catalogMetadata.locales[locale].summary`;
- localized manifest `title` when present, otherwise `catalog.canonicalTitle` -> catalog localized `title`.

Locale keys are matched case-insensitively, matching PartyBeam's validator. A localized key must be declared in `catalogLocales`, and case-only duplicates are rejected.

A declared non-English catalog locale with missing/incomplete localized metadata falls back to English. An invalid optional `supportUrl` is ignored rather than converted into a blocking catalog error, matching PartyBeam's non-blocking warning semantics.

A canonical cover is no longer hand-maintained catalog metadata for new publications. When the manifest declares exactly one `catalog.artwork[]` item with `kind: "cover"`, publication tooling validates the game-owned PNG and projects the same deterministic `artworkUrl` into every catalog locale. Games without a declared cover remain valid and omit `artworkUrl`.

### Catalog artwork mapping

The initial cover flow is:

```text
game/build root: <manifest artworkPath, normally catalog/cover.png>
        ↓ SHA-256 must equal manifest catalog.artwork[].sha256
.partybeam: same declared artwork payload
        ↓ canonical PartyBeam verifier checks packaged bytes
GameCatalog: artwork/v1/<gameId>/cover.png
        ↓
catalogMetadata.locales[*].artworkUrl
```

GameCatalog accepts PNG covers only, requires an exact 2:3 aspect ratio, enforces an 8 MiB publication limit and recommends 1024×1536 pixels. The output filename is normalized to `cover.png` regardless of the source artifact path. Publication provenance binds source artifact path, output path, public URL, byte size, SHA-256 and dimensions.

This keeps the game repository/package as the source of truth while GameCatalog owns only the public distribution copy needed before PartyBeam downloads the package.

## Validation tooling

`tools/validate-package-projection.mjs` validates one exact catalog release against `manifest.json` and `signature.json`.

It verifies:

- pinned upstream manifest and signature-envelope JSON Schemas;
- semantic component uniqueness/kind rules;
- case-insensitive locale uniqueness/declaration rules;
- WAN/internetAccess coupling and HTTPS destination safety;
- exact `manifest.json` SHA-256;
- deterministic logical `packageSha256` using PartyBeam's descriptor format;
- signature-envelope metadata shape and exact equality with catalog signature metadata;
- game/release/publisher identity;
- Game Contract range;
- player range and controller topology;
- component surface projection;
- common runtime locales and catalog locales;
- required/optional capabilities and derived Internet access requirement;
- standby/resume support;
- localized title/summary and optional support URL projection/fallback;
- exact component `releaseVersion` equality with package version;
- catalog-artwork path/id uniqueness and canonical-cover cardinality;
- deterministic cover URL projection when `kind: "cover"` is declared.

`tools/verify-package-signature.mjs` separately performs the publication-side trusted-key ECDSA P-256/P1363 verification. Test keys are generated ephemerally and no private signing key is stored in this repository.

PartyBeam's `GamePackageVerifier` remains canonical for **full package verification** because it receives and hashes the actual component and catalog-artwork payload bytes. GameCatalog requires its machine-readable `catalogArtwork` result to match publication provenance before final authorization.

## CI status

GitHub Actions are intentionally disabled until the planned self-hosted runner is configured. See `docs/ci-policy.md`.

All validation remains callable locally through deterministic repository scripts and is intended to be wired into the self-hosted workflow later without moving validation logic into workflow YAML.

## First MVP optional-signature profile

The pinned Platform contract permits `signature.json` to omit the publisher `signature` member while retaining mandatory `manifestSha256` and `packageSha256`. GameCatalog mirrors that absence in catalog metadata and provenance with `cryptographicSignatureVerified: false`. If signature metadata is present, the existing trusted-key verification remains mandatory.

This profile applies only to official First MVP distribution and does not introduce arbitrary sideloading.
