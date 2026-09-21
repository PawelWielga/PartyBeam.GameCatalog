# PartyBeam.GameCatalog First MVP roadmap

## Role

PartyBeam.GameCatalog is the public distribution/trust boundary for the ecosystem First MVP.

It must prove that real private-source PartyBeam games can be built, signed, published as immutable public compiled packages, discovered through stable/test indexes, downloaded anonymously and verified by PartyBeam.Platform.

Status snapshot: 2026-09-21.

## Current state

Completed foundations:

- catalog schema/layout;
- signature/integrity validation;
- canonical PartyBeam package verifier integration;
- fail-closed publication preparation/authorization;
- stable and test channel projections;
- release immutability/delisting policy;
- public placeholder package proving the basic publication path.

The placeholder signing key is integration-only and must not be reused for real games.

## Ordered First MVP work

### GC-MVP-01 - retained first-party publisher key

Issue: #11.

Do this first.

1. Generate a retained ECDSA P-256 keypair using the PartyBeam package signature algorithm.
2. Store the private key outside Git/release assets/client artifacts.
3. Add only the public key to `trust/v1/publisher-keys.json`.
4. Keep `publisherId = partybeam`.
5. Give the retained key a stable explicit `keyId`.
6. Validate schema/trust-store semantics.
7. Prove local sign -> GameCatalog verify -> PartyBeam verify.
8. Document rotation/revocation/private-key handling.

DONE when both GameCatalog and PartyBeam trust the retained public identity and the private material is absent from repositories/artifacts.

### GC-MVP-02 - publish Grimcellar preview

Issue: #12. Consumer: `PartyBeam.Game.Grimcellar#9`.

Target:

- `partybeam.grimcellar`
- `0.1.0-preview.1`
- Test channel
- tag `game-partybeam.grimcellar-v0.1.0-preview.1`
- asset `partybeam.grimcellar-0.1.0-preview.1.partybeam`

Order:

1. require GC-MVP-01;
2. record exact Grimcellar source/dependency identities;
3. build/test/package in the private source repository;
4. calculate manifest/component/package hashes;
5. sign the canonical logical package hash with the retained key;
6. run PartyBeam canonical full-package verification;
7. run `prepare-publication` and final authorization;
8. create immutable GitHub Release;
9. update canonical catalog + generated channel projections;
10. anonymously re-download and audit bytes;
11. consume through PartyBeam normal Test-channel selection.

No sideload or unsigned package may substitute for this.

### GC-MVP-03 - use Grimcellar publication to unblock Platform web-host validation

Consumer: `PartyBeam.Platform#50` / PR #54.

The package from GC-MVP-02 must be usable for the real smoke path:

`GameCatalog -> signed download -> PartyBeam verification -> Tv.Web authoritative GameSession -> Android controller`.

Any failure in publication/trust/catalog data is fixed here. Any runtime/session failure is fixed in PartyBeam.Platform or the game repo as appropriate.

### GC-MVP-04 - publish Reflex validation game

Issues:

- `PartyBeam.Game.Reflex#8`
- GameCatalog #7

Prerequisites:

- Reflex [01]-[06] complete;
- timing/fairness acceptance complete;
- retained publisher key from GC-MVP-01.

Order:

1. record exact Reflex source/version and PartyBeam contract identities;
2. build all declared TV/Android/browser components from the same exact source version;
3. produce final manifest + hashes;
4. sign using the retained first-party key;
5. run canonical full-package verifier;
6. prepare/authorize publication;
7. publish immutable public Release;
8. update Test channel;
9. audit anonymous bytes;
10. run the documented Reflex end-to-end smoke through PartyBeam.

Keep Reflex prerelease on Test until its real E2E stability gates pass.

### GC-MVP-05 - close publication evidence

After Grimcellar and Reflex:

- retain immutable exact release records;
- keep channel projections deterministic;
- ensure historical package audit succeeds;
- close #7, #11 and #12 only when their acceptance criteria are actually met;
- update README/docs examples to use real first-party releases where appropriate.

## Not required before First MVP

- community catalogs/sideloading;
- third-party publisher onboarding;
- paid entitlements/DRM;
- cloud account integration;
- richer catalog backend/service;
- replacing GitHub Release distribution.

## Failure ownership

- package source/build defect -> game repository;
- manifest/Game Contract/runtime contract defect -> PartyBeam.Platform;
- publication/trust/catalog/release metadata defect -> this repository;
- transport/download runtime defect after valid package selection -> PartyBeam.Platform or Dihor.GameKit.Networking depending on layer.

## Maintenance rule

Keep this roadmap aligned with the ecosystem execution plan in `PartyBeam.Platform/docs/ecosystem-first-mvp-execution.md`.
