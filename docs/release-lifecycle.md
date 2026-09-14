# Release lifecycle, delisting and immutability

The canonical PartyBeam catalog is an append-only history of game/release identities plus a mutable discovery state.

This document separates three concepts that must never be conflated:

1. **delisting** — stop offering a valid release for new discovery/acquisition;
2. **package invalidity / trust failure** — bytes or signature no longer verify against the expected exact identity/trust policy;
3. **critical required update / safety policy** — an explicit PartyBeam runtime/product decision that an older release must no longer be prepared/launched.

Ordinary catalog disappearance is never sufficient to infer the latter two.

## Immutable exact release identity

Once `(gameId, version)` appears in the canonical catalog, its release identity is historical fact.

The following are immutable for that exact release:

- `gameId` and exact SemVer `version`;
- `publisher.id` for the game identity;
- package URL/name and all package integrity/authenticity metadata;
- manifest/logical package hashes and signature metadata;
- compatibility projection;
- original `publishedAt` timestamp.

The exact release record must not be deleted from canonical history. Different bytes or compatibility facts require a new SemVer version.

The validator compares candidate catalogs against a baseline and rejects:

- removal of an existing game identity;
- removal of an existing release identity;
- publisher identity changes;
- package identity/hash/signature changes;
- compatibility projection changes;
- `publishedAt` changes.

## Mutable publication state

`publicationState` is intentionally mutable between:

```text
published
<->
delisted
```

Changing this state does not change the exact release identity.

### Published

A published release may appear in its deterministic stable/test channel index and therefore be discoverable for new acquisition.

### Delisted

A delisted release:

- remains in `catalog/v1/catalog.json` for audit/history;
- retains the same package URL/hash/signature/compatibility facts;
- is excluded from generated stable/test channel indexes;
- is not offered through normal new discovery/acquisition;
- does **not** instruct a client to delete a previously prepared local package;
- does **not** imply that a previously verified package has become cryptographically invalid;
- does **not** by itself mean a required update exists.

A release may be relisted only as the same exact immutable release. Relisting must not be used as an opportunity to replace bytes.

## Game-level removal

The canonical v1 catalog has no separate game-level deletion state. A game whose releases are all delisted remains in canonical history but naturally disappears from stable/test discovery because no published release is projected into those indexes.

Deleting the whole game object is invalid once the identity has appeared in the baseline catalog.

## Corrections

If a published release contains a bug in code, metadata that is part of signed/package truth, hashes, compatibility declarations or package contents, publish a **new SemVer release**.

Example:

```text
1.4.2  published
1.4.3  published   <- correction
```

The old release may then be delisted if it should no longer be offered to new installations. Its exact historical record remains unchanged.

Never replace a GitHub Release asset in place behind the same `(gameId, version)` identity.

## Obsolete prereleases

After a stable release supersedes test builds, old prereleases may be marked `delisted`.

They disappear from `channels/test.json`, but remain in the canonical catalog for historical/audit purposes. The stable release is a new exact version; it does not rewrite the prerelease history.

## Delisting vs signing-key lifecycle

Publisher signing-key state is separate from catalog delisting:

- `active` — can authorize new publication;
- `retired` — cannot authorize new publication, but may verify historical signatures when explicitly requested;
- `revoked` — security/trust event and not accepted by normal verification.

A key becoming retired does not delist its historical releases. A release being delisted does not retire/revoke its signing key.

A true key compromise/revocation may require a separate PartyBeam safety policy, but that must be explicit. It must not be inferred from `publicationState: delisted`.

See `docs/publisher-trust-store.md`.

## Required update and runtime safety

The GameCatalog v1 `publicationState` does not encode a remote kill switch.

If PartyBeam later needs a critical minimum-version or package-revocation mechanism for a security/safety reason, that must be a separate, explicit and reviewable policy contract with clearly defined client behavior.

Clients must not implement:

```text
not in current channel index => delete / refuse existing local package
```

Normal offline/LAN operation depends on this distinction.

## Validation tests

`tools/validate-release-lifecycle.mjs` covers:

- published -> delisted;
- delisted -> published relist of unchanged identity;
- delisted release disappearing from channel discovery while staying in canonical history;
- attempted release deletion;
- attempted game deletion;
- attempted `publishedAt` mutation;
- attempted package/hash mutation during delisting;
- correction represented by a new SemVer version while preserving the old release.

The same rules are enforced by `validate-catalog.mjs --baseline ...` and are therefore reusable by the future self-hosted CI/publication workflow.
