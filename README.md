# PartyBeam.GameCatalog

Public, GitHub-only catalog and distribution boundary for official PartyBeam games.

This repository contains machine-readable catalog metadata and, in later implementation stages, public compiled PartyBeam game release assets. Game source code remains in per-game repositories and does not need to be public.

## Ownership boundary

This repository owns:

- official catalog metadata;
- exact release/distribution metadata;
- stable vs test/prerelease classification;
- public package asset locations;
- integrity/authenticity metadata required to verify a package before preparation;
- publication and delisting state.

This repository does **not** own:

- PartyBeam shell/session/runtime code;
- game source code or gameplay logic;
- arbitrary community feeds or sideloading;
- accounts, entitlements, purchases or DRM;
- the authoritative package-internal manifest contract.

The signed package manifest remains authoritative for package-internal declarations. Catalog compatibility fields are a discovery/filtering projection and later publication validation must reject disagreement with the signed manifest.

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
    valid/
    invalid/
docs/
  catalog-contract-v1.md
```

`catalog/v1/catalog.json` is the canonical v1 catalog document. Future incompatible catalog contracts must use a new versioned path rather than changing v1 semantics in place.

Stable/test channel-specific indexes are intentionally deferred to issue #5. The v1 release model already carries deterministic channel classification so those indexes can later be derived and validated without changing release identity.

## Public URL conventions

PartyBeam clients may read the current v1 catalog directly from GitHub:

```text
https://raw.githubusercontent.com/PawelWielga/PartyBeam.GameCatalog/main/catalog/v1/catalog.json
```

Schemas and fixtures use the same versioned repository paths. Client-facing URLs must be HTTPS and must not require private-repository credentials.

Published package URLs use public GitHub Release assets in this repository. The planned naming convention is:

```text
release tag: game-<gameId>-v<semver>
asset name:  <gameId>-<semver>.partybeam
```

The catalog always stores the exact resolved asset URL, hash and signature metadata. URL naming is therefore a publication convention, not a substitute for integrity verification.

## Trust model

PartyBeam MVP accepts only official first-party publications. The schema nevertheless carries explicit publisher identity so a future approved external publisher can be represented without redefining game or release identity.

A catalog entry is an official publication statement, not a permission to run arbitrary native code. Package authenticity, runtime sandboxing, capability enforcement and Game Contract compatibility remain separate concerns.

## Version and identity rules

- `gameId` is stable across all releases of one game.
- `publisher.id` is explicit and stable.
- each `(gameId, version)` pair identifies exactly one immutable package release;
- `version` is SemVer 2.0.0;
- stable releases cannot contain a SemVer prerelease suffix;
- test releases may be prereleases;
- catalog delisting must not redefine whether a previously downloaded verified package may run;
- package bytes for an already published exact version must never be silently replaced.

See `docs/catalog-contract-v1.md` and issue #2 for the full v1 contract rationale.
