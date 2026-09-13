# PartyBeam official catalog contract v1

This document defines the semantics of `schemas/v1/catalog.schema.json` and the invariants that PartyBeam publication tooling must enforce.

## Status

The v1 catalog shape is the initial implementation for issue #2.

`PawelWielga/PartyBeam#4` still owns the final signed package manifest contract. Until that issue is complete, the catalog's `compatibility` object is deliberately treated as a **catalog projection** of package-manifest truth. Final field naming and signature metadata must be aligned with the completed package contract before issue #2 is considered fully frozen.

The catalog must never be used to weaken or override a signed package manifest.

## Document identity

A catalog document contains:

- `schemaVersion`: currently `1`;
- `catalogId`: currently `partybeam-official`;
- optional `generatedAt` informational timestamp;
- `games`: official catalog entries.

Incompatible catalog changes require a new versioned schema/path. Existing v1 documents must not silently acquire incompatible meaning.

## Game identity

`gameId` is the stable machine-readable identity for one game across releases.

Changing title, artwork, supported languages or publisher display text does not create a new game identity. A new unrelated title must not reuse an existing `gameId`.

`publisher.id` is explicit and stable. The MVP publication policy accepts only approved first-party releases, but the schema can represent an `approved-external` publisher later without redefining release identity.

`creator` is optional and can be used when the creator identity is useful separately from the publication identity.

## Catalog metadata

`catalogMetadata` contains discovery/presentation metadata rather than runtime authority.

- `defaultLocale` selects the fallback catalog locale.
- `locales` contains localized title/summary and optional public HTTPS references.
- `supportUrl` is an optional public support/help destination.

The default locale must exist in `locales`. This cross-field invariant is enforced by the publication validator rather than JSON Schema alone.

Age rating, monetization and advertising metadata are intentionally outside the MVP contract.

## Exact releases

Every release is identified by the tuple:

```text
(gameId, version)
```

`version` is SemVer 2.0.0. The tuple is immutable after publication: once PartyBeam trusts bytes for an exact release identity, different bytes must not later appear under that same identity.

A game may contain multiple releases simultaneously. The canonical valid fixture demonstrates both stable and prerelease history for one `gameId`.

### Channel classification

`channel` classifies the exact release:

- `stable`: a SemVer without a prerelease suffix;
- `test`: an official SemVer prerelease.

Channel indexes are implemented separately in issue #5. They must be derivable from exact release records and must not create a second contradictory release identity.

### Publication state

`publicationState` is either:

- `published`: eligible for normal discovery according to its channel;
- `delisted`: retained as historical/auditable metadata but excluded from normal new discovery.

Delisting is a distribution state only. It is not a remote revocation instruction and must not invalidate an already verified compatible local package merely because the online catalog no longer offers it.

## Package resolution

`package` resolves one exact public compiled asset:

- `assetUrl`: HTTPS GitHub Release asset in `PartyBeam.GameCatalog`;
- `fileName`: expected `.partybeam` package name;
- optional `sizeBytes`: useful for download/storage UX;
- `integrity`: package hash, currently SHA-256;
- `signature`: signature algorithm identifier, trusted key identifier and encoded signature value;
- `manifestSha256`: SHA-256 of the authoritative package manifest representation selected by the package contract.

Catalog signature fields are transport/discovery metadata required so a client can obtain verification inputs. They do not replace verification of the package itself.

The concrete package-signing representation remains subject to final alignment with `PartyBeam#4`. Publication validation must fail closed when the catalog's integrity/authenticity metadata disagrees with the package.

## Compatibility projection

`compatibility` exists so PartyBeam can perform catalog discovery/filtering before downloading a complete package. It mirrors selected signed manifest facts:

- supported Game Contract API range;
- available surfaces (`tv`, `android`, `browser`);
- runtime locales and catalog locales;
- min/max player count;
- supported controller topology;
- required/optional capability summary;
- Internet access requirement summary;
- standby/resume support.

The signed manifest remains authoritative. A publication pipeline must reject a release if this projection disagrees with the corresponding signed manifest fields.

The catalog intentionally stores only an Internet-access summary. Exact WAN endpoint/origin allowlists remain package-manifest/runtime-security data and must not be broadened by catalog metadata.

## Validation invariants beyond JSON Schema

Issue #3 must implement deterministic checks for invariants that JSON Schema cannot safely express on its own:

1. `gameId` values are unique within a catalog.
2. `(gameId, version)` release identity is unique.
3. an existing exact release cannot change package bytes/hash/signature identity.
4. `catalogMetadata.defaultLocale` exists in `catalogMetadata.locales`.
5. `playerCount.min <= playerCount.max`.
6. required and optional capability names do not conflict.
7. catalog compatibility projection matches the authoritative signed package manifest.
8. `assetUrl` is a public GitHub Release asset owned by this distribution repository.
9. referenced package bytes hash to `package.integrity.digest` when bytes are available.
10. signature metadata is valid and the package signature verifies against an approved publisher key.
11. stable/test classification agrees with SemVer prerelease semantics.
12. only publisher identities allowed by current official-catalog policy may be newly published.

Validation must fail closed. A malformed or unverifiable release must never become discoverable merely because a JSON file parsed successfully.

## Public URL stability

The canonical v1 catalog is:

```text
https://raw.githubusercontent.com/PawelWielga/PartyBeam.GameCatalog/main/catalog/v1/catalog.json
```

The v1 schema is:

```text
https://raw.githubusercontent.com/PawelWielga/PartyBeam.GameCatalog/main/schemas/v1/catalog.schema.json
```

PartyBeam clients must not need a GitHub token, private-repository credential or publisher secret to read catalog data or download public package assets.

## Fixtures

Canonical fixtures live under `fixtures/v1/`:

- `valid/multiple-releases.json`: one game with a stable release and a test prerelease;
- `invalid/stable-prerelease.json`: prerelease incorrectly classified as stable;
- `invalid/missing-signature.json`: package publication without required authenticity metadata.

Issue #3 expands this suite with tampering, duplicate identity, bad destination, hash mismatch and manifest disagreement cases.

## Relationship to PartyBeam product policy

This contract follows PartyBeam's existing rules:

- the official catalog is the only MVP game publication source;
- Developer/Test mode is not a trust bypass;
- Game Contract compatibility is independently versioned from PartyBeam app version;
- all components used in one GameSession belong to one exact game release;
- package authenticity does not grant native privileges or unrestricted device/network access;
- delisting does not imply remote deletion or revocation of an already prepared valid package.
