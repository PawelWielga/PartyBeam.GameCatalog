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

## Current bootstrap key

The committed store contains the public key for `partybeam.placeholder` `0.1.0`. That package is a first-party integration probe, and its private key is not committed to this repository. The key remains active so PartyBeam installations that bundle the matching public store can acquire and verify the placeholder package; it must not be reused for subsequent game releases.

When a long-lived production key is created:

1. keep the private key only in the trusted signing environment;
2. export its P-256 SubjectPublicKeyInfo PEM public key;
3. choose a stable `keyId` that can survive key rotation/history;
4. add the public key as `active` and bind it to publisher `partybeam`;
5. review the trust-store change independently from a game release and retire the placeholder-only key when supported clients no longer need it for new acquisition;
6. run the local validation suite before using the key for publication.

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
