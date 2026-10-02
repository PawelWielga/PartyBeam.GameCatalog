# AGENTS.md

## Repository role

`PartyBeam.GameCatalog` owns public PartyBeam game discovery, immutable release assets, channels, publication provenance and trust policy.

It does not own PartyBeam game/runtime implementation or the canonical package-internal contract.

## Required architecture

Before changing package/publication validation read:

- `README.md`;
- `docs/game-sdk-migration.md`;
- `docs/package-contract-alignment.md`;
- the current `PartyBeam.GameSdk` architecture/roadmap;
- the PartyBeam.Platform ecosystem target architecture.

## Ownership rules

- PartyBeam package/Game Contract schemas and reusable producer/conformance tooling belong in `PartyBeam.GameSdk`.
- Catalog/channel/provenance/trust-store schemas remain here.
- Platform owns runtime security/execution policy.
- Dihor.GameKit.Networking is unrelated to catalog/package publication and must remain product-neutral.
- Game source/build logic remains in individual game repositories.

Consume package schemas and descriptor primitives from the pinned GameSdk dependency. Do not add copied Platform/package schemas here. Update vendor artifact, source metadata and lockfile together; run existing and SDK conformance tests before upgrading.

## Validation

Publication must remain deterministic and runnable offline against pinned contract artifacts. Never weaken exact-version, integrity, signature/trust or immutability checks to simplify migration.

## Workflow

Use focused issues/PRs. When moving contract ownership to GameSdk, keep old snapshots only until equivalent pinned GameSdk validation passes, then delete the duplicate.
