# GameSdk contract source

GameCatalog consumes `@partybeam/game-sdk` **0.1.0-alpha.4**, package schema **v1**,
from immutable commit `ad06755e8d9c56394466eed14080a83f1535e535`.
`vendor/gamesdk-source.json` records the source, exact packed npm artifact hash
and hashes of both installed schemas. The local file dependency and lockfile
pin `vendor/partybeam-game-sdk-0.1.0-alpha.4.tgz`; validation requires neither
GitHub access nor a neighboring checkout after dependencies are installed.
The initial `npm ci` may fetch pinned Ajv/crypto dependencies from npm. Subsequent
installation works with `npm ci --offline` once those dependencies are cached.

## Ownership and compatibility

GameSdk owns manifest/envelope schemas, descriptor/hash primitives and the
data-only conformance corpus. Catalog reads those exports from the installed
package, without maintaining a separate schema snapshot or descriptor algorithm.
Catalog retains catalog/channel/provenance/trust schemas, semantic projection
checks, publisher authorization and immutable public-release policy.
Platform remains the independent canonical full-package verifier required by
publication; this migration does not replace its evidence or execution policy.

Both SDK schemas were byte-identical to the previous Platform snapshot.
Existing fixture and publication tests run alongside the SDK corpus (58 manifest,
15 envelope, 6 descriptor vectors and three generated-game fixtures). Existing
published catalog metadata and release assets are not rewritten.

New provenance identifies SDK version, schema version, commit, artifact and
schema hashes. Authorization rejects a mismatched SDK pin. The provenance schema
also accepts the original Platform repository/PR/ref/commit shape for historical
records, preserving its existing validation semantics. That historical record
does not make Platform the current package-contract source.

## Coordinated upgrade

1. Inspect the SDK version/commit, compatibility notes and real consumers.
2. Use a clean LF checkout of that exact commit; run `npm pack --ignore-scripts`.
   Commit the resulting npm artifact under `vendor/` and record its measured
   SHA-256 and installed schema hashes in `gamesdk-source.json`.
3. Update the local file dependency and npm lockfile together. Never edit the
   artifact's schemas locally; fix/version the contract in GameSdk instead.
4. Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm test`,
   `npm run validate`, `npm run validate-channels` and offline validation.
   Module initialization verifies SDK version/artifact identity; schema loading
   verifies measured hashes. Inconsistent pins fail closed.
5. Prove historical release compatibility and canonical Platform verification
   where behavior changes. Preserve already published release bytes and prior
   provenance; adopt producer changes only under new release identities.

GitHub Actions remain intentionally disabled by `ci-policy.md`. Local checks
are mandatory; runtime/device E2E and G09 cross-validator convergence are
separate acceptance gates.
