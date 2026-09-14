# PartyBeam package contract alignment

This document records how `PartyBeam.GameCatalog` v1 projects the signed PartyBeam game package contract.

The current alignment target is `PawelWielga/PartyBeam` draft PR #19 (`feature/02-game-package-manifest`). Until that PR is merged, this mapping is implemented and tested here but remains subject to final upstream review.

## Authority

The signed package remains authoritative for runtime facts. The catalog is a public discovery/distribution projection and must never override a different signed manifest value.

Publication validation therefore checks three separate layers:

1. release asset integrity: SHA-256 of the actual downloadable `.partybeam` file;
2. signed logical package identity: exact manifest hash, logical package hash and signature envelope metadata;
3. catalog projection equality: discovery/compatibility fields must agree with the signed manifest.

## Integrity and signature mapping

PartyBeam package manifest v1 uses a detached `signature.json` envelope:

- `manifestSha256`: SHA-256 of the exact `manifest.json` bytes;
- `packageSha256`: SHA-256 of PartyBeam's deterministic logical package-content descriptor;
- `signature.algorithm`: `ecdsa-p256-sha256-p1363`;
- `signature.keyId`: trusted signing-key identifier;
- `signature.valueBase64`: 64-byte IEEE P1363 ECDSA signature encoded as Base64.

The catalog release stores those values unchanged under `package.manifestSha256`, `package.packageSha256` and `package.signature`.

`package.integrity.digest` is deliberately different: it is the SHA-256 of the downloadable GitHub Release asset bytes. PartyBeam's logical package hash is container-independent, while the catalog still needs a transport-level hash for the exact asset being downloaded.

A repacked container can therefore have a different `package.integrity.digest` while retaining the same signed logical `packageSha256` only if publication policy explicitly publishes that new asset. An already published `(gameId, version)` remains immutable in this catalog.

## Identity mapping

| Catalog | Signed manifest |
| --- | --- |
| `game.gameId` | `gameId` |
| `release.version` | `version` |
| `game.publisher.id` | `publisher.id` |
| `game.publisher.displayName` | `publisher.displayName` |

`publisher.kind` is catalog policy metadata (`first-party` today, `approved-external` later). It is intentionally not supplied by the package to grant itself publication trust.

## Compatibility projection

| Catalog | Signed manifest |
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

The exact WAN `network.outboundAllowlist` stays in the signed manifest and is not duplicated into catalog discovery metadata.

## Component and surface mapping

Manifest schema v1 requires exactly one component of each kind:

- `tv` -> catalog surface `tv`;
- `androidController` -> catalog surface `android`;
- `browserController` -> catalog surface `browser`.

`compatibility.runtimeLocales` is the intersection of `components[].runtimeLocales`, meaning languages in this catalog field are safe to advertise as supported across the complete release rather than merely by one component.

Per-component runtime locale differences remain authoritative in the signed manifest.

## Catalog presentation metadata

The package manifest's `catalog` object supplies signed author metadata. Publication validation maps:

- `catalog.supportUrl` -> `catalogMetadata.supportUrl`;
- `catalog.localized[locale].shortDescription` -> `catalogMetadata.locales[locale].summary`;
- localized manifest `title` when present, otherwise `catalog.canonicalTitle` -> catalog localized `title`.

Catalog-only presentation references such as artwork or description URLs may be added by the official publication layer, but they cannot alter signed runtime/security declarations.

## Validation tooling

`tools/validate-package-projection.mjs` validates one exact catalog release against `manifest.json` and `signature.json`.

It currently verifies:

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
- localized title/summary and support URL projection;
- exact component `releaseVersion` equality with the package version.

Cryptographic ECDSA verification against a production trusted public-key registry is intentionally not reimplemented independently here while PartyBeam PR #19 remains draft. The PartyBeam package verifier owns the canonical signature-verification implementation. Once that contract is merged and its trusted-key integration is available for publication tooling, this repository should invoke or share that verifier rather than create a subtly different crypto implementation.

## CI status

GitHub Actions are intentionally disabled until the planned self-hosted runner is configured. See `docs/ci-policy.md`.

All validation remains callable locally through deterministic repository scripts and is intended to be wired into the self-hosted workflow later without moving validation logic into workflow YAML.
