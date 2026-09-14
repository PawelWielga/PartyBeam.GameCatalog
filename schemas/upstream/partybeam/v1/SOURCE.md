# Upstream schema source

These schema files are a temporary local snapshot of the PartyBeam game package v1 contract so catalog publication validation can run deterministically without network access.

Source repository: `PawelWielga/PartyBeam`

Source draft PR: `#19` (`feature/02-game-package-manifest`)

Pinned source head at snapshot time:

```text
895498c0e2721730cdcd8f322b0163934bab8978
```

Upstream files:

- `schemas/game-package-manifest.v1.schema.json`
- `schemas/game-package-signature-envelope.v1.schema.json`

Compared with the previous pinned head, the manifest wire schema only tightened `safeRelativePath` to reject ASCII control characters. The signature-envelope wire schema remained unchanged. Upstream also added stricter runtime validation and a shared-core `IGamePackageVerificationService` integration seam.

The PartyBeam repository remains authoritative. When PR #19 is merged or the schemas change, this snapshot must be refreshed and the catalog projection fixtures rerun before publication tooling is considered synchronized.

Do not evolve these copied schemas independently inside GameCatalog.
