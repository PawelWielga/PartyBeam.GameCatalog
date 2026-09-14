import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
export const DEFAULT_PROVENANCE_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "schemas/v1/publication-provenance.schema.json",
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function issue(code, instancePath, message) {
  return { code, instancePath, message };
}

function buildValidator(schemaPath) {
  const schema = readJson(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  if (!ajv.validateSchema(schema)) {
    const details = ajv.errorsText(ajv.errors, { separator: "; " });
    throw new Error(`Publication provenance schema is invalid: ${details}`);
  }

  return ajv.compile(schema);
}

export function validatePublicationProvenanceObject(
  provenance,
  { schemaPath = DEFAULT_PROVENANCE_SCHEMA_PATH } = {},
) {
  const validate = buildValidator(schemaPath);
  if (validate(provenance)) return [];

  return (validate.errors ?? []).map((error) =>
    issue(
      `provenance-schema-${error.keyword}`,
      error.instancePath || "/",
      error.message ?? "publication provenance schema validation failed",
    ),
  );
}

export function validatePublicationProvenanceFile(
  provenancePath,
  { schemaPath = DEFAULT_PROVENANCE_SCHEMA_PATH } = {},
) {
  return validatePublicationProvenanceObject(readJson(provenancePath), { schemaPath });
}
