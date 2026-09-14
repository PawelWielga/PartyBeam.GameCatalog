# Upstream schema source

These schema files are a temporary local snapshot of the PartyBeam game package v1 contract so catalog publication validation can run deterministically without network access.

Source repository: `PawelWielga/PartyBeam`

Source draft PR: `#19` (`feature/02-game-package-manifest`)

Pinned source head at snapshot time:

```text
c95feca25565da7ca1ae5ed7ad0d714f6e62df6e
```

Upstream files:

- `schemas/game-package-manifest.v1.schema.json`
- `schemas/game-package-signature-envelope.v1.schema.json`

Changes since the previous pinned head that materially affect GameCatalog:

- manifest v1 requires exactly one `tv` component and exactly one `androidController` component;
- `browserController` is optional and may appear at most once;
- component `artifactPath` collision checks are case-insensitive, while logical package descriptor ordering remains ordinal;
- descriptor paths continue to reject traversal, backslashes, URI/drive separators and control characters.

The signature-envelope wire schema remains unchanged.

The PartyBeam repository remains authoritative. When PR #19 is merged or the schemas change, this snapshot must be refreshed and the catalog projection fixtures rerun before publication tooling is considered synchronized.

Do not evolve these copied schemas independently inside GameCatalog.
