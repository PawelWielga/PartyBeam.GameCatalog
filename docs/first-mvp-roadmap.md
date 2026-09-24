# PartyBeam.GameCatalog First MVP roadmap

## Role

PartyBeam.GameCatalog is the public distribution/trust boundary for the ecosystem First MVP.

It must prove that real private-source PartyBeam games can be built, integrity-verified, published as immutable public compiled packages, discovered through stable/test indexes, downloaded anonymously and verified by PartyBeam.Platform. Mandatory publisher signing is Post-MVP.

Status snapshot: 2026-09-24.

## Current state

Completed foundations:

- catalog schema/layout;
- integrity validation plus optional publisher-signature validation;
- canonical PartyBeam package verifier integration;
- fail-closed publication preparation/authorization;
- stable and test channel projections;
- release immutability/delisting policy;
- public placeholder package proving the basic publication path.

The placeholder signing key remains integration-only. First MVP real-game releases do not require a retained signing key; publisher-signing enforcement is tracked for Post-MVP.

## Ordered First MVP work

### GC-MVP-01 - enable the unsigned official-package First MVP profile

Platform counterpart: `PartyBeam.Platform` First MVP package-verification profile.

1. Keep `signature.json` as the required v1 integrity envelope.
2. Always require exact `manifestSha256` and logical `packageSha256`.
3. Make the publisher `signature` member optional for First MVP official releases.
4. Keep signed-package verification fully supported when signature metadata is present.
5. Require canonical full-package verification, exact Release-asset SHA-256, component hashes, exact version and catalog projection.
6. Accept unsigned packages only through the official GameCatalog/GitHub Release path.
7. Keep retained-key establishment and mandatory publisher signing in #11 as Post-MVP/Production Ready hardening.

DONE when unsigned official packages pass only the explicit First MVP profile while arbitrary sideload/hash bypass remains impossible.

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
4. calculate manifest/component/package hashes and the unsigned First MVP integrity envelope;
5. run PartyBeam canonical full-package verification in the explicit unsigned-official profile;
6. run `prepare-publication` and final authorization;
7. create immutable GitHub Release;
8. update canonical catalog + generated channel projections;
9. anonymously re-download and audit bytes;
10. consume through PartyBeam normal Test-channel selection.

Loose files, arbitrary sideloads or any catalog/hash verification bypass may not substitute for this.

### GC-MVP-03 - use Grimcellar publication to unblock Platform web-host validation

Consumer: `PartyBeam.Platform#50` / PR #54.

The package from GC-MVP-02 must be usable for the real smoke path:

`GameCatalog -> immutable verified download -> PartyBeam integrity verification -> Tv.Web authoritative GameSession -> Android controller`.

Any failure in publication/integrity/catalog data is fixed here. Any runtime/session failure is fixed in PartyBeam.Platform or the game repo as appropriate.

### GC-MVP-04 - publish Reflex validation game

Issues:

- `PartyBeam.Game.Reflex#8`
- GameCatalog #7

Prerequisites:

- Reflex [01]-[06] complete;
- timing/fairness acceptance complete;

Order:

1. record exact Reflex source/version and PartyBeam contract identities;
2. build all declared TV/Android/browser components from the same exact source version;
3. produce final manifest + hashes;
4. create the canonical unsigned First MVP integrity envelope;
5. run canonical full-package verifier in unsigned-official mode;
6. prepare/authorize publication;
7. publish immutable public Release;
8. update Test channel;
9. audit anonymous bytes;
10. run the documented Reflex end-to-end smoke through PartyBeam.

Keep Reflex prerelease on Test until its real E2E stability gates pass.

Current state:

- `partybeam.reflex@0.1.0-alpha.0` is published in Test through catalog commit `86370a468b5970446b0c099c4eea543f327805f9`;
- the public Release/tag/asset and anonymous byte identity have been established;
- Reflex #9 / Platform #16 real-path E2E remains open;
- the #9 audit found a game-owned resource-pressure adaptation gap in alpha.0, so Reflex PR #15 prepares `0.1.0-alpha.1`;
- final E2E evidence must pin the later immutable release after that fix is validated and published rather than attributing post-publication source changes to alpha.0.

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
- replacing GitHub Release distribution;
- mandatory publisher signing/private-key lifecycle (#11).

## Failure ownership

- package source/build defect -> game repository;
- manifest/Game Contract/runtime contract defect -> PartyBeam.Platform;
- publication/integrity/catalog/release metadata defect -> this repository;
- transport/download runtime defect after valid package selection -> PartyBeam.Platform or Dihor.GameKit.Networking depending on layer.

## Maintenance rule

Keep this roadmap aligned with the ecosystem execution plan in `PartyBeam.Platform/docs/ecosystem-first-mvp-execution.md`.
