# Stable and test channel indexes

The canonical catalog remains `catalog/v1/catalog.json`. Channel documents are deterministic discovery projections of that catalog and must never redefine package hashes, signatures, compatibility metadata or publication state.

## Discovery document

`catalog/v1/channels.json` declares:

- `defaultChannel: stable`;
- stable index path;
- test index path;
- whether the channel represents prereleases;
- whether explicit opt-in is required.

Stable is always the default/recommended channel. Enabling Developer/Test behavior in PartyBeam does not globally replace stable with test; prerelease selection remains a per-game client decision.

## Channel indexes

The two indexes are:

```text
catalog/v1/channels/stable.json
catalog/v1/channels/test.json
```

Each game entry contains only:

- stable `gameId`;
- `latestVersion` for that channel;
- all currently published exact `versions` for that channel in descending SemVer precedence.

The client resolves the selected exact version back into the canonical catalog for package URL, integrity/authenticity metadata and compatibility data.

This avoids two independent copies of release truth.

## Stable channel

Stable contains only releases where:

- `publicationState == published`;
- `channel == stable`;
- SemVer has no prerelease identifier.

A title with no published stable release is absent from `stable.json`.

## Test channel

Test contains only releases where:

- `publicationState == published`;
- `channel == test`;
- SemVer has a prerelease identifier.

A prerelease-only title may therefore exist only in `test.json`.

Stable releases are not copied into the test index. A PartyBeam installation that allows test releases can inspect stable and test independently and retain stable as the normal/default selection unless the user opts a specific game into prerelease tracking.

## Determinism

`npm run generate-channels` derives all three channel documents from the canonical catalog.

`npm run validate-channels` regenerates them in memory and rejects committed indexes that differ from the canonical derivation. This means channel files cannot silently drift from catalog release state.

SemVer ordering follows SemVer 2.0.0 precedence, including numeric prerelease identifiers. Build metadata does not affect precedence.

`prepare-publication` uses the same generator against the candidate catalog and can write candidate channel documents with `--channels-output-dir`. Their exact SHA-256 values are recorded in publication provenance so catalog and channel changes can be reviewed as one atomic publication set.

## Delisting

Channel indexes contain only `published` releases. A `delisted` release disappears from new channel discovery but remains in the canonical catalog as historical/auditable exact release metadata.

Disappearance from a channel index is not remote revocation and does not instruct PartyBeam to delete a previously verified local package.

See `docs/release-lifecycle.md` for the full distinction between ordinary delisting, package invalidity and explicit critical-update/safety policy.

## Fixtures

Channel validation covers:

- `fixtures/v1/channels/stable-only.json`;
- `fixtures/v1/valid/multiple-releases.json` for stable + beta;
- `fixtures/v1/channels/prerelease-only.json`;
- `fixtures/v1/invalid/stable-prerelease.json` for contradictory channel/SemVer metadata.

GitHub Actions remain intentionally disabled until the self-hosted runner is configured. Channel validation is already part of `npm test` so the same gate can be used unchanged when CI returns.
