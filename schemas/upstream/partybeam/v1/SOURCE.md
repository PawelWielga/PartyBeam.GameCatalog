# Upstream schema source

These schema files are a temporary local snapshot of the PartyBeam game package v1 contract so catalog publication validation can run deterministically without network access.

Source repository: `PawelWielga/PartyBeam`

Source draft PR: `#19` (`feature/02-game-package-manifest`)

Pinned source head at snapshot time:

```text
3fd679e154396ea66b640b3a29311fead7a2c91f
```

Upstream files:

- `schemas/game-package-manifest.v1.schema.json`
- `schemas/game-package-signature-envelope.v1.schema.json`

The PartyBeam repository remains authoritative. When PR #19 is merged or the schemas change, this snapshot must be refreshed and the catalog projection fixtures rerun before publication tooling is considered synchronized.

Do not evolve these copied schemas independently inside GameCatalog.
