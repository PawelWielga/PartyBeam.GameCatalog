# Publisher signing key trust store

`trust/v1/publisher-keys.json` is the publication-side trust store for PartyBeam package signing keys.

It is public by design. Only **public** verification keys belong here. Private signing keys must never be committed to this repository, game repositories or PartyBeam client artifacts.

## Purpose

The trust store answers one narrow question during publication:

> Is this `keyId` currently authorized to publish packages for this exact `publisherId`?

It does not grant runtime capabilities, native execution privileges, DRM entitlement or catalog admission to arbitrary external publishers.

The machine-readable contract is `schemas/v1/publisher-trust-store.schema.json`.

## Key states

Each key has one status:

- `active` — may authorize a new publication and verify historical signatures;
- `retired` — must not authorize a new publication, but may be used explicitly to verify historical signatures;
- `revoked` — must not authorize publication and is not accepted by normal historical verification.

Key retirement is normal rotation. Revocation is a security event and must not be confused with game/release delisting.

## Publisher binding

Every key is bound to one explicit `publisherId`. A valid ECDSA signature from a trusted key is rejected if the manifest publisher identity differs from the key's `publisherId`.

For MVP, normal catalog publication still accepts first-party publishers only. Supporting a future approved external publisher therefore requires both:

1. catalog policy explicitly allowing that publisher; and
2. an active public signing key bound to that publisher in this trust store.

Adding a key alone does not create an arbitrary community feed or bypass official-catalog policy.

## Signature algorithm

Manifest/signature-envelope v1 uses exactly:

```text
ecdsa-p256-sha256-p1363
```

The signature is IEEE P1363 `r || s` over the already computed 32-byte logical `packageSha256`. Verification must therefore treat `packageSha256` as a prehashed ECDSA digest and must not SHA-256 it a second time.

`tools/verify-package-signature.mjs` implements this publication-side check with `@noble/curves` P-256 verification using `prehash: false`. `lowS: false` is intentional because PartyBeam's .NET `ECDsa.SignHash` contract does not require low-S normalization.

## Current first-party keys

The official store contains two different first-party identities with deliberately different purposes:

- `partybeam-placeholder-2026-09` remains an integration-only key for the already published `partybeam.placeholder` probe. It must not be reused for Grimcellar, Reflex or later releases.
- `partybeam-first-party-2026-09` is the retained first-party release identity for production-intended official PartyBeam game packages.

The retained key's public SPKI SHA-256 fingerprint is:

```text
6e9b228b34f838fad9d1a0dcd93b23eb36d41b905ade60a178046f362533ec25
```

Only the public key and lifecycle metadata belong in Git.

## Retained private-key handling

The private half of `partybeam-first-party-2026-09` must be stored outside all PartyBeam repositories, release assets, package contents, CI logs and client artifacts.

Operational rules:

1. keep at least one encrypted/offline backup controlled by the project owner;
2. use the private key only in a trusted signing environment;
3. never paste the private key into issues, PR comments, build logs or package metadata;
4. before a release, verify that the local private key matches the committed public identity with:
   ```bash
   npm run verify-retained-signing-key -- --private-key /secure/path/partybeam-first-party-2026-09.private.pem
   ```
5. when rotating normally, add the replacement key as `active`, publish new packages with it, and change the old key to `retired` only after clients that must acquire new releases trust the replacement;
6. if compromise is suspected, mark the affected key `revoked`, stop publication immediately, publish a replacement trust snapshot, and treat packages signed only by the revoked identity as untrusted for normal verification;
7. never delete historical public keys from the trust store merely because they are no longer used for new signing. Preserve lifecycle state so historical verification remains explicit and auditable.

The verification command performs a throwaway local signature over a random logical `packageSha256`, checks that the supplied private key corresponds exactly to the retained public key, and passes the resulting P1363 signature through the normal GameCatalog verifier. It does not print or persist private key material.

## Local verification

```bash
npm run verify-package-signature -- \
  --signature /path/to/signature.json \
  --publisher partybeam \
  --trust-store trust/v1/publisher-keys.json
```

Normal verification accepts `active` keys only. Historical auditing may explicitly add `--allow-retired`.

## Relationship to PartyBeam verifier

This repository verifies the detached signature so catalog preparation can fail closed before any GitHub mutation. PartyBeam's `GamePackageVerifier` remains the canonical full-package verifier because it additionally checks the actual component payload bytes against `components[].sha256`.

A successful detached-signature check proves that the trusted publisher signed the logical hash declared by the manifest/envelope, but does not by itself prove that every component payload byte inside the downloadable container matches that declaration. Before publication authorization, `npm run verify-full-package` invokes PartyBeam.Platform's canonical container verifier and binds its result to finalized provenance.
