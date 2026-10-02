# GameSdk migration

## Decision

PartyBeam.GameCatalog will consume the versioned PartyBeam package contract from `PartyBeam.GameSdk`.

The current Platform-pinned schema snapshot exists because GameSdk did not previously exist. It is not the long-term source of truth.

## Migration

1. GameSdk publishes/version-controls package v1 schemas and deterministic descriptor fixtures.
2. GameCatalog pins an exact GameSdk contract version/artifact locally for deterministic offline validation.
3. Run all existing valid/invalid catalog/package fixtures against the GameSdk contract.
4. Preserve GameCatalog-owned catalog/channel/provenance/trust schemas.
5. Update package-projection tooling to report the consumed GameSdk contract version.
6. Remove the obsolete Platform commit/schema snapshot only after equivalent validation is proven.

## Non-goals

- do not move catalog/channel policy into GameSdk;
- do not move publisher trust-store/publication authorization into GameSdk;
- do not make GameCatalog depend on Platform implementation code;
- do not change historical release semantics during extraction.
