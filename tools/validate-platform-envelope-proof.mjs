import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashEquals, computePackageSha256, sha256 } from '@partybeam/game-sdk/package-v1';
import { validateEnvelope } from '../node_modules/@partybeam/game-sdk/src/package-tools/manifest.js';
import { PACKAGE_CONTRACT_SOURCE, packageSchemaPath } from './package-contract-source.mjs';
import { validatePackageProjection } from './validate-package-projection.mjs';
import Ajv2020 from 'ajv/dist/2020.js';

assert.equal(process.argv.length, 3, 'Usage: node tools/validate-platform-envelope-proof.mjs <Platform proof.json>');
const proof = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(proof.formatVersion, 1);
assert.equal(proof.sdkArtifactSha256, PACKAGE_CONTRACT_SOURCE.artifactSha256);
const fixture = fs.readFileSync(new URL(import.meta.resolve('@partybeam/game-sdk/fixtures/package/v1/catalog-lf-manifest.json')));
assert.equal(proof.manifestUtf8, fixture.toString('utf8'), 'Proof must use the immutable SDK fixture bytes');
assert.ok(Array.isArray(proof.cases) && proof.cases.length > 80, 'Missing generated envelope matrix');
const ids = new Set();
const schema = new Ajv2020({ strict: true }).compile(JSON.parse(fs.readFileSync(packageSchemaPath('signature-envelope'))));
const manifest = JSON.parse(proof.manifestUtf8);
const manifestHash = sha256(fixture);
const packageHash = computePackageSha256(manifestHash, manifest.components);
const baseCatalog = JSON.parse(fs.readFileSync(new URL('../fixtures/v1/package-contract/valid.catalog.json', import.meta.url)));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'partybeam-envelope-matrix-'));
let accepted = 0;
try {
  const manifestPath = path.join(temporary, 'manifest.json');
  const signaturePath = path.join(temporary, 'signature.json');
  const catalogPath = path.join(temporary, 'catalog.json');
  fs.writeFileSync(manifestPath, fixture);
  for (const row of proof.cases) {
    assert.equal(typeof row.id, 'string');
    assert.ok(!ids.has(row.id), `Duplicate case ${row.id}`);
    ids.add(row.id);
    assert.equal(row.sdk.id, row.id);
    const schemaValid = schema(row.envelope);
    assert.equal(schemaValid, row.sdk.schemaValid, `${row.id}: Catalog/SDK schema mismatch`);
    let metadataValid = true;
    try { validateEnvelope(row.envelope); }
    catch (error) {
      if (error.name !== 'PackageError') throw error;
      metadataValid = false;
    }
    assert.equal(metadataValid, row.sdk.metadataValid, `${row.id}: installed SDK metadata mismatch`);
    const encoding = row.envelope?.signature?.valueBase64;
    const canonicalEncoding = encoding === undefined || (typeof encoding === 'string'
      && Buffer.from(encoding, 'base64').length === 64
      && Buffer.from(encoding, 'base64').toString('base64') === encoding);
    assert.equal(canonicalEncoding, row.sdk.canonicalEncoding, `${row.id}: encoding mismatch`);
    assert.equal(row.platformReachedIntegrity, metadataValid && canonicalEncoding, `${row.id}: Platform metadata mismatch`);

    const catalog = structuredClone(baseCatalog);
    // Align only the projection; actual manifest/logical hash checks remain real.
    // Invalid envelopes retain the valid catalog so they must fail its envelope gate.
    if (schemaValid) {
      const projected = catalog.games[0].releases[0].package;
      projected.manifestSha256 = row.envelope.manifestSha256.toLowerCase();
      projected.packageSha256 = row.envelope.packageSha256.toLowerCase();
      if (row.envelope.signature === undefined) delete projected.signature;
      else projected.signature = structuredClone(row.envelope.signature);
    }
    fs.writeFileSync(catalogPath, JSON.stringify(catalog));
    fs.writeFileSync(signaturePath, JSON.stringify(row.envelope));
    const issues = validatePackageProjection({ catalogPath, manifestPath, signaturePath,
      gameId: manifest.gameId, version: manifest.version });
    assert.ok(!issues.some(issue => issue.code.startsWith('catalog-')), `${row.id}: invalid test catalog`);
    const projectionSchemaValid = !issues.some(issue => issue.code.startsWith('signature-schema-'));
    assert.equal(projectionSchemaValid, schemaValid, `${row.id}: real projection schema gate mismatch`);
    const expected = metadataValid && canonicalEncoding
      && hashEquals(row.envelope?.manifestSha256, manifestHash)
      && hashEquals(row.envelope?.packageSha256, packageHash);
    assert.equal(issues.length === 0, expected, `${row.id}: projection mismatch: ${JSON.stringify(issues)}`);
    if (expected) accepted++;
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(`PASS: ${proof.cases.length} identical SDK/Platform/Catalog envelope cases; ${accepted} accepted projections. No payload/crypto/publication proof.`);
