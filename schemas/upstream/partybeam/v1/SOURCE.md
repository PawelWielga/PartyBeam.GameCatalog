# Upstream schema source

These schema files are a pinned local snapshot of the PartyBeam game package v1 contract so catalog publication validation can run deterministically without network access.

Source repository: `PawelWielga/PartyBeam.Platform`

Source merged PR: `#19` (`[02] Define signed game package manifest and validation contract`)

Pinned source head at snapshot time:

```text
7747374d55ed20e4cc5e4afc9903c8efce42102d
```

Upstream files:

- `schemas/game-package-manifest.v1.schema.json`
- `schemas/game-package-signature-envelope.v1.schema.json`

The merged contract additionally fixes the schema IDs to canonical URNs and constrains the P1363 signature to its exact 64-byte Base64 representation.

Contract rules that materially affect GameCatalog include:

- manifest v1 requires exactly one `tv` component and exactly one `androidController` component;
- `browserController` is optional and may appear at most once;
- component `artifactPath` collision checks are case-insensitive, while logical package descriptor ordering remains ordinal;
- descriptor paths continue to reject traversal, backslashes, URI/drive separators and control characters.

The PartyBeam.Platform repository remains authoritative. When the schemas change, this snapshot must be refreshed and the catalog projection fixtures rerun before publication tooling is considered synchronized.

Do not evolve these copied schemas independently inside GameCatalog.
