# GitHub-only package publication workflow

This document describes the intended publication path for official PartyBeam games while GitHub Actions remain intentionally disabled.

## Current implementation status

The repository implements deterministic publication preparation, canonical full-package verification through PartyBeam's trusted-tooling CLI, and a fail-closed final authorization precheck.

`tools/prepare-publication.mjs` creates reviewable publication outputs but never uploads anything. It always verifies the integrity envelope against the manifest/logical package identity. When publisher-signature metadata is present, it additionally verifies the ECDSA P-256 signature against an `active` publisher key from `trust/v1/publisher-keys.json`.

`tools/verify-full-package.mjs` invokes `PartyBeam.PackageVerifier` from a clean `PawelWielga/PartyBeam.Platform` checkout. It records the exact verifier commit and only marks component/full-package verification complete when the canonical verifier returns the expected game, version and publisher identity for the exact prepared asset. Signed packages are checked with their trusted key; unsigned First MVP packages use the explicit `--allow-unsigned` verifier policy.

`tools/authorize-publication.mjs` is a separate final gate intended to run immediately before GitHub Release mutation. It independently rechecks the candidate catalog, immutable baseline, package bytes, exact publisher identity, optional publisher signature/trust state, canonical-verifier evidence and channel projections. It has no force/bypass option.

The committed production trust store currently contains the public key for the one-off `partybeam.placeholder` integration release. Its private key is not committed and it is not the long-lived key for future game publication.

`tools/publish-github-release.mjs` runs the final authorization checks and remote collision preflight by default. It mutates GitHub only with explicit `--execute`, never overwrites an existing Release/tag, uploads exactly one asset, validates the resulting metadata and verifies an anonymous download against the prepared byte count and SHA-256. Until the self-hosted workflow and its least-privilege credential are configured, an authenticated trusted operator runs this command locally.

## First MVP unsigned-official policy

Mandatory publisher signing is deferred to Post-MVP/Production Ready. First MVP may publish an unsigned first-party package only when all of the following remain true:

- the package is distributed through the official PartyBeam.GameCatalog and immutable GitHub Release path;
- `signature.json` is present as the integrity envelope;
- exact `manifestSha256`, declared component SHA-256 values and logical `packageSha256` agree;
- the downloadable Release asset size and SHA-256 are pinned;
- publisher/game/version/catalog projection agree;
- PartyBeam's canonical full-package verifier succeeds in explicit unsigned mode;
- the final authorization gate and anonymous public-asset audit succeed.

Signed packages continue to use the trusted-key path whenever a signature is present. Arbitrary sideloading, loose files and hash bypasses remain invalid.

## Trust and credential boundary

Private game source stays in the producer repository.

PartyBeam clients need only public catalog/package URLs. They must never contain:

- PATs;
- GitHub App private keys;
- signing private keys;
- producer-repository credentials;
- credentials used to create Releases or update this repository.

When automated publication is enabled later, cross-repository credentials belong only to trusted producer/self-hosted automation with least privilege.

Signing private keys are separate from GitHub publication credentials and must never be committed to either repository. Public verification keys are intentionally safe to store in `trust/v1/publisher-keys.json`.

## Publication phases

### 1. Producer builds one exact release

The private game repository produces:

- `<gameId>-<version>.partybeam`;
- exact `manifest.json`;
- detached `signature.json` generated according to PartyBeam package manifest v1.

Every component in the package belongs to the same exact SemVer release.

### 2. Publication-side integrity and optional signature verification

GameCatalog always verifies that the envelope's `manifestSha256` and `packageSha256` match the exact manifest and deterministic logical package descriptor.

When `signature` is present it additionally verifies:

- `keyId` exists in the public trust store;
- the trusted key is bound to the manifest `publisher.id`;
- the key is `active` for new publication;
- algorithm is exactly `ecdsa-p256-sha256-p1363`;
- P1363 signature decodes to exactly 64 bytes;
- signature verifies over the already-computed 32-byte `packageSha256` without hashing it again.

For an unsigned First MVP release, provenance explicitly records `cryptographicSignatureVerified: false`; it must never imply publisher authentication.

This phase still does **not** prove that every component byte physically contained in the `.partybeam` asset matches the component hashes declared by the manifest.

### 3. Canonical PartyBeam full-package verification

Before public upload, PartyBeam's canonical `GamePackageVerifier` must additionally verify:

- manifest semantics;
- component presence and hashes;
- exact component release identity;
- deterministic logical package hash;
- trusted `keyId` and ECDSA P-256/SHA-256/P1363 signature when signature metadata is present.

The publication-side integrity/signature gate and canonical verifier must agree on package identity. For signed packages they must also agree on trust/key material. The canonical verifier remains authoritative for the complete package because it receives actual component payload bytes.

After phase 4 creates prepared provenance, run the canonical verifier from a clean PartyBeam.Platform checkout:

```bash
npm run verify-full-package -- \
  --provenance /tmp/publication.provenance.json \
  --package /path/to/<gameId>-<version>.partybeam \
  --trust-store trust/v1/publisher-keys.json \
  --verifier-project /path/to/PartyBeam.Platform/eng/PartyBeam.PackageVerifier/PartyBeam.PackageVerifier.csproj \
  --game-contract-version 1.0.0 \
  --output /tmp/publication.verified.provenance.json
```

The verifier checkout must have the canonical GitHub origin, the exact canonical project path and a clean worktree. Successful output records the source commit, Game Contract version, verification timestamp and asset hash; signed releases additionally record key ID. Hand-editing the flags does not satisfy the provenance schema or the independent authorization checks below.

### 4. Prepare catalog and channel candidates

From a clean GameCatalog checkout:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test

npm run prepare-publication -- \
  --catalog catalog/v1/catalog.json \
  --manifest /path/to/manifest.json \
  --signature /path/to/signature.json \
  --package /path/to/<gameId>-<version>.partybeam \
  --trust-store trust/v1/publisher-keys.json \
  --published-at 2026-09-14T08:00:00Z \
  --output /tmp/catalog.candidate.json \
  --channels-output-dir /tmp/catalog-v1-candidate \
  --provenance /tmp/publication.provenance.json
```

The command:

- refuses an unexpected package filename;
- recomputes the exact manifest hash;
- recomputes PartyBeam's logical package hash and compares it with the envelope;
- verifies the detached ECDSA signature against an active trusted publisher key when one is present;
- calculates the physical release-asset SHA-256 and size;
- derives stable/test channel from SemVer;
- derives catalog metadata and compatibility projection from the manifest;
- constructs the deterministic GitHub Release tag and public asset URL;
- validates the candidate against the catalog schema and semantic rules;
- validates catalog ↔ manifest/signature projection;
- validates the physical package file against the generated catalog entry;
- validates immutable existing releases against the baseline catalog;
- refuses to add an already existing `(gameId, version)`;
- deterministically generates `channels.json`, `channels/stable.json` and `channels/test.json` from the candidate catalog;
- writes an audit/provenance JSON file binding SHA-256 hashes of all candidate documents.

No GitHub mutation occurs in this phase.

### 5. Final publication authorization precheck

After canonical full-package verification has produced provenance with both full-verification flags set to `true`, run:

```bash
npm run authorize-publication -- \
  --catalog /tmp/catalog.candidate.json \
  --baseline catalog/v1/catalog.json \
  --provenance /tmp/publication.verified.provenance.json \
  --channels-dir /tmp/catalog-v1-candidate \
  --package /path/to/<gameId>-<version>.partybeam \
  --trust-store trust/v1/publisher-keys.json
```

This command independently verifies:

- `componentPayloadsVerified === true`;
- `fullPackageVerification === true`;
- exact SHA-256 of baseline catalog, candidate catalog and trust store;
- immutable candidate-vs-baseline rules;
- exact package filename, byte size and transport SHA-256;
- exact publisher identity and, when present, publisher/key binding plus ECDSA signature from the candidate release;
- deterministic Release tag and public asset URL;
- exact release identity recorded in provenance;
- SHA-256 and exact deterministic contents of discovery/stable/test channel documents.

A prepared candidate fails this gate until canonical verification evidence is present. Manually flipping the flags is insufficient because the schema requires verifier evidence while package bytes, publisher identity, optional signature/trust data, candidate hashes and channel projections are independently recomputed.

The command has no `--force` or ignore-verification mode.

## Provenance record

The generated provenance includes:

- exact game/version/channel;
- deterministic Release tag and asset URL;
- baseline and candidate catalog SHA-256;
- exact trust-store SHA-256 used for authorization;
- SHA-256 of channel discovery, stable and test candidate documents;
- physical release asset filename, size and SHA-256;
- exact manifest hash;
- logical PartyBeam package hash;
- publisher ID and optional signature algorithm/key ID;
- pinned PartyBeam package-contract source commit;
- the requested publication timestamp;
- explicit verification-state flags.

A freshly prepared signed candidate records `cryptographicSignatureVerified: true`; an unsigned First MVP candidate records `false`. Both initially record `componentPayloadsVerified: false` and `fullPackageVerification: false`.

This is intentionally precise: hash/envelope preparation is not authorization to publish, and an unsigned release must never be described as cryptographically publisher-authenticated. The actual component payloads inside the `.partybeam` container still need to be independently read and checked by the canonical PartyBeam verifier. Therefore prepared provenance is still **not authorization to publish**. `verify-full-package` produces a separate finalized provenance file after canonical verification succeeds.

The provenance file is audit evidence, not a cryptographic authorization token by itself. Trusted publication tooling must run the final authorization precheck against the actual candidate files and package bytes immediately before mutation.

## Trusted GitHub mutation phase

After full PartyBeam package verification succeeds, first run a non-mutating remote preflight:

```bash
npm run publish-github-release -- \
  --catalog /tmp/catalog.candidate.json \
  --baseline catalog/v1/catalog.json \
  --provenance /tmp/publication.verified.provenance.json \
  --channels-dir /tmp/catalog-v1-candidate \
  --package /path/to/<gameId>-<version>.partybeam \
  --trust-store trust/v1/publisher-keys.json
```

The preflight reruns `authorize-publication` and confirms through the GitHub API that neither the deterministic Release nor its tag exists. To perform the mutation, rerun the exact command with `--execute`.

The command then:

1. reruns the complete local authorization gate;
2. rechecks that the Release and tag do not exist;
3. creates `game-<gameId>-v<version>` from the repository's `main` branch;
4. uploads exactly one `<gameId>-<version>.partybeam` asset without a clobber path;
5. validates tag, stable/prerelease state, filename, asset count and size through the GitHub API;
6. downloads the public asset without authorization headers and verifies its SHA-256 and size.

After successful upload verification, submit the generated catalog and channel candidates as one reviewed repository change and rerun all local validation. Only merging those files makes the release discoverable through canonical indexes.

If any step fails, publication must stop. A failed or partial attempt must never be papered over by changing bytes behind the same exact version.

## No overwrite rule

A published `(gameId, version)` is immutable.

Corrections require a new SemVer release. Publication tooling must not use GitHub Release asset replacement as a way to change trusted package bytes while preserving an existing version identity.

The preparation command enforces this on catalog metadata. `publish-github-release` independently refuses both an existing Release and an existing Git tag and provides no clobber/overwrite option. Repository administrators should enable GitHub immutable releases when available; regardless of that setting, later byte replacement is detected by catalog integrity validation.

## Publisher key lifecycle

During First MVP a package may omit publisher signature metadata. If a package is signed, new publication requires an `active` key. A `retired` key can be used only when historical verification is explicitly requested and a `revoked` key is not accepted. Mandatory signing and retained first-party key operations are Post-MVP under #11.

Key retirement/revocation is separate from release delisting. See `docs/publisher-trust-store.md`.

## GitHub Actions policy

There is currently no active workflow under `.github/workflows/`.

When the self-hosted runner is configured, automation should call the same repository scripts described here. Validation/business rules must remain in versioned code rather than being duplicated in workflow YAML.

See `docs/ci-policy.md`.
