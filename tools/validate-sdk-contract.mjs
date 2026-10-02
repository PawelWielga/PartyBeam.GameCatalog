import assert from "node:assert/strict";
import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { buildPackageDescriptor, createUnsignedIntegrityEnvelope, hashEquals, sha256 } from "@partybeam/game-sdk/package-v1";
import { packageSchemaPath, PACKAGE_CONTRACT_LABEL } from "./package-contract-source.mjs";

const read = name => fs.readFileSync(new URL(import.meta.resolve(
  `@partybeam/game-sdk/fixtures/package/v1/${name}`,
)));
const json = name => JSON.parse(read(name));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const manifestSchema = ajv.compile(JSON.parse(fs.readFileSync(packageSchemaPath("manifest"))));
const envelopeSchema = ajv.compile(JSON.parse(fs.readFileSync(packageSchemaPath("signature-envelope"))));
const corpus = json("conformance.json");

function mutate(base, changes) {
  const result = structuredClone(base);
  for (const change of changes ?? []) {
    const parent = change.path.slice(0, -1).reduce((value, key) => value[key], result);
    const key = change.path.at(-1);
    if (change.operation === "delete") delete parent[key];
    else {
      assert.equal(change.operation, "set");
      parent[key] = change.value;
    }
  }
  return result;
}

for (const vector of corpus.manifests) {
  const value = mutate(json(corpus.bases.manifest), vector.changes);
  assert.equal(manifestSchema(value), vector.schemaValid, vector.id);
  if (vector.descriptorValid !== undefined) {
    const descriptor = () => buildPackageDescriptor("a".repeat(64), value.components);
    if (vector.descriptorValid) assert.doesNotThrow(descriptor, vector.id);
    else assert.throws(descriptor, TypeError, vector.id);
  }
}
for (const vector of corpus.envelopes) {
  const value = mutate(json(corpus.bases.envelope), vector.changes);
  assert.equal(envelopeSchema(value), vector.schemaValid, vector.id);
  if (vector.integrityValid !== undefined) {
    const bytes = read("generated/reflex/manifest.json");
    const expected = createUnsignedIntegrityEnvelope(bytes, JSON.parse(bytes).components);
    assert.equal(hashEquals(value.manifestSha256, expected.manifestSha256)
      && hashEquals(value.packageSha256, expected.packageSha256), vector.integrityValid, vector.id);
  }
}
for (const vector of corpus.descriptors) {
  const descriptor = () => buildPackageDescriptor(vector.manifestSha256, vector.components);
  if (!vector.valid) assert.throws(descriptor, TypeError, vector.id);
  else {
    const bytes = descriptor();
    assert.equal(bytes.toString("utf8"), vector.expectedUtf8, vector.id);
    assert.equal(sha256(bytes), vector.expectedSha256, vector.id);
  }
}
for (const name of corpus.generated) {
  const bytes = read(`generated/${name}/manifest.json`);
  const manifest = JSON.parse(bytes);
  const envelope = json(`generated/${name}/envelope.json`);
  assert.equal(manifestSchema(manifest), true, name);
  assert.equal(envelopeSchema(envelope), true, name);
  assert.deepEqual(createUnsignedIntegrityEnvelope(bytes, manifest.components), envelope, name);
  assert.deepEqual(buildPackageDescriptor(envelope.manifestSha256, manifest.components),
    read(`generated/${name}/descriptor.txt`), name);
}
console.log(`PASS: ${PACKAGE_CONTRACT_LABEL}: ${corpus.manifests.length} manifest, ${corpus.envelopes.length} envelope, ${corpus.descriptors.length} descriptor vectors and ${corpus.generated.length} generated game fixtures`);
