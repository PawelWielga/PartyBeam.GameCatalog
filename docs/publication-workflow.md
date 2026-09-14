# GitHub-only package publication workflow

This document describes the intended publication path for official PartyBeam games while GitHub Actions remain intentionally disabled.

## Current implementation status

The repository currently implements the **deterministic preparation and validation** half of publication.

`tools/prepare-publication.mjs` creates reviewable publication outputs but never uploads anything. Before it writes a candidate, it now requires the detached ECDSA P-256 signature to verify against an `active` publisher key from `trust/v1/publisher-keys.json`.

The committed production trust store is intentionally empty until a real PartyBeam production public signing key is provisioned, so production publication currently fails closed.

The remaining blocker to a real GitHub Release mutation is full verification of the actual component payload bytes using PartyBeam's canonical `GamePackageVerifier`. PartyBeam PR #19 defines that verifier, but the `.partybeam` container/extraction path is not yet integrated here.

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

### 2. Publication-side trusted signature verification

GameCatalog verifies the detached envelope before creating a catalog candidate:

- `keyId` exists in the public trust store;
- the trusted key is bound to the manifest `publisher.id`;
- the key is `active` for new publication;
- algorithm is exactly `ecdsa-p256-sha256-p1363`;
- P1363 signature decodes to exactly 64 bytes;
- signature verifies over the already-computed 32-byte `packageSha256` without hashing it again.

This step proves that an authorized publisher key signed the logical package hash declared by the envelope.

It does **not** yet prove that every component byte physically contained in the `.partybeam` asset matches the component hashes declared by the manifest.

### 3. Canonical PartyBeam full-package verification

Before public upload, PartyBeam's canonical `GamePackageVerifier` must additionally verify:

- manifest semantics;
- component presence and hashes;
- exact component release identity;
- deterministic logical package hash;
- trusted `keyId`;
- ECDSA P-256/SHA-256/P1363 signature.

The publication-side signature gate and the canonical verifier should agree on trust/key material. The canonical verifier remains authoritative for the complete package because it receives actual component payload bytes.

Until this step is wired into GameCatalog, no public Release mutation command is provided.

### 4. Prepare a catalog candidate

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
  --provenance /tmp/publication.provenance.json
```

The command:

- refuses an unexpected package filename;
- recomputes the exact manifest hash;
- recomputes PartyBeam's logical package hash and compares it with the envelope;
- verifies the detached ECDSA signature against an active trusted publisher key;
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
- exact trust-store SHA-256 used for authorization;
- physical release asset filename, size and SHA-256;
- exact manifest hash;
- logical PartyBeam package hash;
- signature algorithm and key ID;
- pinned PartyBeam package-contract source commit;
- the requested publication timestamp;
- explicit verification-state flags.

A successfully prepared candidate records:

```json
{
  "cryptographicSignatureVerified": true,
  "componentPayloadsVerified": false,
  "fullPackageVerification": false
}
```

This is intentionally precise. The publisher signature has been cryptographically verified, but the actual component payloads inside the `.partybeam` container have not yet been independently re-read and checked by GameCatalog. Therefore the provenance is still **not authorization to publish**.

## Future GitHub mutation phase

After full PartyBeam package verification is integrated, the trusted publication workflow can add the mutation phase:

1. verify the complete package with the canonical PartyBeam verifier;
2. require provenance with `fullPackageVerification: true`;
3. confirm the target Release tag does not already exist;
4. create `game-<gameId>-v<version>` in `PartyBeam.GameCatalog`;
5. upload exactly one immutable `<gameId>-<version>.partybeam` asset;
6. confirm the public asset can be fetched anonymously and its bytes match the prepared SHA-256/size;
7. submit the generated catalog candidate as a reviewed repository change;
8. rerun all local validation against the final public asset and baseline catalog;
9. only then make the release discoverable through the canonical catalog/channel indexes.

If any step fails, publication must stop. A failed or partial attempt must never be papered over by changing bytes behind the same exact version.

## No overwrite rule

A published `(gameId, version)` is immutable.

Corrections require a new SemVer release. Publication tooling must not use GitHub Release asset replacement as a way to change trusted package bytes while preserving an existing version identity.

The preparation command enforces this on catalog metadata already. The future GitHub mutation step must enforce the same rule against existing Release tags/assets before upload.

## Publisher key lifecycle

New publication requires an `active` key. A `retired` key can be used only when historical verification is explicitly requested. A `revoked` key is not accepted by normal verification.

Key retirement/revocation is separate from release delisting. See `docs/publisher-trust-store.md`.

## GitHub Actions policy

There is currently no active workflow under `.github/workflows/`.

When the self-hosted runner is configured, automation should call the same repository scripts described here. Validation/business rules must remain in versioned code rather than being duplicated in workflow YAML.

See `docs/ci-policy.md`.
