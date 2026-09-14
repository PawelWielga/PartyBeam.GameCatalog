# GitHub-only package publication workflow

This document describes the intended publication path for official PartyBeam games while GitHub Actions remain intentionally disabled.

## Current implementation status

The repository currently implements deterministic publication preparation plus a fail-closed final authorization precheck.

`tools/prepare-publication.mjs` creates reviewable publication outputs but never uploads anything. Before it writes a candidate, it requires the detached ECDSA P-256 signature to verify against an `active` publisher key from `trust/v1/publisher-keys.json`.

`tools/authorize-publication.mjs` is a separate final gate intended to run immediately before any future GitHub Release mutation. It independently rechecks the candidate catalog, immutable baseline, package bytes, publisher signature/trust state and channel projections. It has no force/bypass option.

The committed production trust store is intentionally empty until a real PartyBeam production public signing key is provisioned, so production publication currently fails closed.

The remaining blocker to a real GitHub Release mutation is full verification of the actual component payload bytes using PartyBeam's canonical `GamePackageVerifier`. PartyBeam PR #19 defines that verifier, but the canonical `.partybeam` container/extraction path is not yet integrated with the publication tooling.

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

The integration that invokes this verifier must be the only code allowed to mark both `componentPayloadsVerified` and `fullPackageVerification` as `true`. Hand-editing those flags is not a supported workflow and does not replace the independent authorization checks below.

Until this step is wired into GameCatalog, no public Release mutation command is provided.

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
- deterministically generates `channels.json`, `channels/stable.json` and `channels/test.json` from the candidate catalog;
- writes an audit/provenance JSON file binding SHA-256 hashes of all candidate documents.

No GitHub mutation occurs in this phase.

### 5. Final publication authorization precheck

After canonical full-package verification has produced provenance with both full-verification flags set to `true`, run:

```bash
npm run authorize-publication -- \
  --catalog /tmp/catalog.candidate.json \
  --baseline catalog/v1/catalog.json \
  --provenance /tmp/publication.provenance.json \
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
- publisher/key binding and ECDSA signature from the candidate release itself;
- deterministic Release tag and public asset URL;
- exact release identity recorded in provenance;
- SHA-256 and exact deterministic contents of discovery/stable/test channel documents.

A prepared candidate currently fails this gate by design because its full component verification flags are false. Manually flipping those flags is insufficient to bypass the gate because signature/trust, package bytes, candidate hashes and channel projections are independently recomputed.

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
- signature algorithm and key ID;
- pinned PartyBeam package-contract source commit;
- the requested publication timestamp;
- explicit verification-state flags.

A freshly prepared candidate records:

```json
{
  "cryptographicSignatureVerified": true,
  "componentPayloadsVerified": false,
  "fullPackageVerification": false
}
```

This is intentionally precise. The publisher signature has been cryptographically verified, but the actual component payloads inside the `.partybeam` container have not yet been independently re-read and checked by the canonical PartyBeam verifier. Therefore the provenance is still **not authorization to publish**.

The provenance file is audit evidence, not a cryptographic authorization token by itself. Trusted publication tooling must run the final authorization precheck against the actual candidate files and package bytes immediately before mutation.

## Future GitHub mutation phase

After full PartyBeam package verification is integrated, the trusted publication workflow can add the mutation phase:

1. verify the complete package with the canonical PartyBeam verifier;
2. produce/update provenance only from that successful verifier result;
3. run `npm run authorize-publication` and require success;
4. confirm the target Release tag does not already exist;
5. create `game-<gameId>-v<version>` in `PartyBeam.GameCatalog`;
6. upload exactly one immutable `<gameId>-<version>.partybeam` asset;
7. confirm the public asset can be fetched anonymously and its bytes match the prepared SHA-256/size;
8. submit the generated catalog and channel candidates as one reviewed repository change;
9. rerun all local validation against the final public asset and baseline catalog;
10. only then make the release discoverable through the canonical catalog/channel indexes.

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
