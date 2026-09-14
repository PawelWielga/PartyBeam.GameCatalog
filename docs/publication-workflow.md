# GitHub-only package publication workflow

This document describes the intended publication path for official PartyBeam games while GitHub Actions remain intentionally disabled.

## Current implementation status

The repository currently implements the **deterministic preparation and validation** half of publication.

It does not yet provide a command that mutates GitHub Releases. This is intentional: a package must pass PartyBeam's canonical trusted-key cryptographic verification before public upload, and that verifier currently lives in the draft `PawelWielga/PartyBeam#19` implementation.

`tools/prepare-publication.mjs` therefore creates reviewable publication outputs but never uploads anything.

## Trust and credential boundary

Private game source stays in the producer repository.

PartyBeam clients need only public catalog/package URLs. They must never contain:

- PATs;
- GitHub App private keys;
- signing private keys;
- producer-repository credentials;
- credentials used to create Releases or update this repository.

When automated publication is enabled later, cross-repository credentials belong only to trusted producer/self-hosted automation with least privilege.

Signing private keys are separate from GitHub publication credentials and must never be committed to either repository.

## Publication phases

### 1. Producer builds one exact release

The private game repository produces:

- `<gameId>-<version>.partybeam`;
- exact `manifest.json`;
- detached `signature.json` generated according to PartyBeam package manifest v1.

Every component in the package belongs to the same exact SemVer release.

### 2. Canonical PartyBeam package verification

Before public upload, PartyBeam's canonical `GamePackageVerifier` must verify:

- manifest semantics;
- component presence and hashes;
- exact component release identity;
- deterministic logical package hash;
- trusted `keyId`;
- ECDSA P-256/SHA-256/P1363 signature.

This is a mandatory publication gate. The current GameCatalog preparation tool does **not** claim this gate has run.

### 3. Prepare a catalog candidate

From a clean GameCatalog checkout:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test

npm run prepare-publication -- \
  --catalog catalog/v1/catalog.json \
  --manifest /path/to/manifest.json \
  --signature /path/to/signature.json \
  --package /path/to/<gameId>-<version>.partybeam \
  --published-at 2026-09-14T08:00:00Z \
  --output /tmp/catalog.candidate.json \
  --provenance /tmp/publication.provenance.json
```

The command:

- refuses an unexpected package filename;
- recomputes the exact manifest hash;
- recomputes PartyBeam's logical package hash and compares it with the envelope;
- calculates the physical release-asset SHA-256 and size;
- derives stable/test channel from SemVer;
- derives catalog metadata and compatibility projection from the signed manifest;
- constructs the deterministic GitHub Release tag and public asset URL;
- validates the candidate against the catalog schema and semantic rules;
- validates catalog ↔ manifest/signature projection;
- validates the physical package file against the generated catalog entry;
- validates immutable existing releases against the baseline catalog;
- refuses to add an already existing `(gameId, version)`;
- writes an audit/provenance JSON file.

No GitHub mutation occurs in this phase.

## Provenance record

The generated provenance includes:

- exact game/version/channel;
- deterministic Release tag and asset URL;
- baseline and candidate catalog SHA-256;
- physical release asset filename, size and SHA-256;
- exact manifest hash;
- logical PartyBeam package hash;
- signature algorithm and key ID;
- the requested publication timestamp.

Until canonical trusted-key verification is integrated, the record explicitly contains:

```json
"cryptographicSignatureVerified": false
```

A preparation provenance file with that value is **not authorization to publish**.

## Future GitHub mutation phase

After PartyBeam's verifier is merged and integrated, the trusted publication workflow can add the mutation phase:

1. verify package cryptographically with the canonical PartyBeam verifier;
2. confirm the target Release tag does not already exist;
3. create `game-<gameId>-v<version>` in `PartyBeam.GameCatalog`;
4. upload exactly one immutable `<gameId>-<version>.partybeam` asset;
5. confirm the public asset can be fetched anonymously and its bytes match the prepared SHA-256/size;
6. submit the generated catalog candidate as a reviewed repository change;
7. rerun all local validation against the final public asset and baseline catalog;
8. only then make the release discoverable through the canonical catalog/channel indexes.

If any step fails, publication must stop. A failed or partial attempt must never be papered over by changing bytes behind the same exact version.

## No overwrite rule

A published `(gameId, version)` is immutable.

Corrections require a new SemVer release. Publication tooling must not use GitHub Release asset replacement as a way to change trusted package bytes while preserving an existing version identity.

The preparation command enforces this on catalog metadata already. The future GitHub mutation step must enforce the same rule against existing Release tags/assets before upload.

## GitHub Actions policy

There is currently no active workflow under `.github/workflows/`.

When the self-hosted runner is configured, automation should call the same repository scripts described here. Validation/business rules must remain in versioned code rather than being duplicated in workflow YAML.

See `docs/ci-policy.md`.
