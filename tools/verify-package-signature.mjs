import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { p256 } from "@noble/curves/nist.js";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const TRUST_STORE_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "schemas/v1/publisher-trust-store.schema.json",
);
export const DEFAULT_TRUST_STORE_PATH = path.join(REPO_ROOT, "trust/v1/publisher-keys.json");
const SIGNATURE_ALGORITHM = "ecdsa-p256-sha256-p1363";

function issue(code, instancePath, message) {
  return { code, instancePath, message };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON from ${filePath}: ${error.message}`);
  }
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function decodeP1363Signature(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    return null;
  }

  const bytes = Buffer.from(value, "base64");
  return bytes.length === 64 ? bytes : null;
}

function decodeSha256(value) {
  if (typeof value !== "string" || !/^[0-9A-Fa-f]{64}$/.test(value)) {
    return null;
  }
  return Buffer.from(value, "hex");
}

function publicKeyPemToRawP256(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const jwk = key.export({ format: "jwk" });

  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new Error("trusted public key must be an EC P-256 public key");
  }

  const x = decodeBase64Url(jwk.x);
  const y = decodeBase64Url(jwk.y);
  if (x.length !== 32 || y.length !== 32) {
    throw new Error("trusted P-256 public key coordinates must be 32 bytes each");
  }

  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

function validateTrustStore(trustStore, schemaPath = TRUST_STORE_SCHEMA_PATH) {
  const schema = readJson(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  const errors = [];

  if (!validate(trustStore)) {
    for (const schemaError of validate.errors ?? []) {
      errors.push(
        issue(
          `trust-store-schema-${schemaError.keyword}`,
          schemaError.instancePath || "/",
          schemaError.message ?? "trust store schema validation failed",
        ),
      );
    }
    return errors;
  }

  const keyIds = new Set();
  for (const [index, key] of trustStore.keys.entries()) {
    if (keyIds.has(key.keyId)) {
      errors.push(
        issue(
          "trust-store-duplicate-key-id",
          `/keys/${index}/keyId`,
          `duplicate keyId '${key.keyId}'`,
        ),
      );
    }
    keyIds.add(key.keyId);
  }

  return errors;
}

export function verifyPackageSignature({
  signaturePath,
  publisherId,
  trustStorePath = DEFAULT_TRUST_STORE_PATH,
  allowRetired = false,
}) {
  const errors = [];
  const envelope = readJson(signaturePath);
  const trustStore = readJson(trustStorePath);

  const trustErrors = validateTrustStore(trustStore);
  if (trustErrors.length > 0) {
    return trustErrors;
  }

  if (envelope.schemaVersion !== 1) {
    errors.push(
      issue(
        "signature-envelope-schema-version",
        "/schemaVersion",
        `unsupported signature envelope schemaVersion '${envelope.schemaVersion}'`,
      ),
    );
  }

  const packageHash = decodeSha256(envelope.packageSha256);
  if (!packageHash) {
    errors.push(
      issue(
        "signature-package-hash",
        "/packageSha256",
        "packageSha256 must be a 64-character hexadecimal SHA-256 value",
      ),
    );
  }

  const signature = envelope.signature ?? {};
  if (signature.algorithm !== SIGNATURE_ALGORITHM) {
    errors.push(
      issue(
        "signature-algorithm",
        "/signature/algorithm",
        `signature algorithm must be '${SIGNATURE_ALGORITHM}'`,
      ),
    );
  }

  const signatureBytes = decodeP1363Signature(signature.valueBase64);
  if (!signatureBytes) {
    errors.push(
      issue(
        "signature-p1363-size",
        "/signature/valueBase64",
        "P-256 P1363 signature must be valid base64 decoding to exactly 64 bytes",
      ),
    );
  }

  const trustedKey = trustStore.keys.find((key) => key.keyId === signature.keyId);
  if (!trustedKey) {
    errors.push(
      issue(
        "signature-untrusted-key",
        "/signature/keyId",
        `signing key '${signature.keyId}' is not present in the trusted publisher key store`,
      ),
    );
    return errors;
  }

  if (trustedKey.publisherId !== publisherId) {
    errors.push(
      issue(
        "signature-publisher-key-mismatch",
        "/signature/keyId",
        `signing key '${signature.keyId}' belongs to publisher '${trustedKey.publisherId}', not '${publisherId}'`,
      ),
    );
  }

  const allowedStatuses = allowRetired ? new Set(["active", "retired"]) : new Set(["active"]);
  if (!allowedStatuses.has(trustedKey.status)) {
    errors.push(
      issue(
        "signature-key-not-active",
        "/signature/keyId",
        `signing key '${signature.keyId}' has status '${trustedKey.status}' and cannot authorize this publication`,
      ),
    );
  }

  if (trustedKey.algorithm !== SIGNATURE_ALGORITHM) {
    errors.push(
      issue(
        "signature-key-algorithm",
        "/signature/keyId",
        `trusted key '${signature.keyId}' does not use '${SIGNATURE_ALGORITHM}'`,
      ),
    );
  }

  if (errors.length > 0 || !packageHash || !signatureBytes) {
    return errors;
  }

  let publicKey;
  try {
    publicKey = publicKeyPemToRawP256(trustedKey.publicKeyPem);
  } catch (error) {
    return [
      issue(
        "signature-invalid-public-key",
        "/signature/keyId",
        `trusted public key '${signature.keyId}' is invalid: ${error.message}`,
      ),
    ];
  }

  let valid = false;
  try {
    valid = p256.verify(signatureBytes, packageHash, publicKey, {
      prehash: false,
      lowS: false,
      format: "compact",
    });
  } catch (error) {
    return [
      issue(
        "signature-verification-error",
        "/signature/valueBase64",
        `signature verification failed: ${error.message}`,
      ),
    ];
  }

  if (!valid) {
    errors.push(
      issue(
        "signature-invalid",
        "/signature/valueBase64",
        `signature is not valid for packageSha256 using trusted key '${signature.keyId}'`,
      ),
    );
  }

  return errors;
}

function parseArgs(argv) {
  const options = {
    trustStorePath: DEFAULT_TRUST_STORE_PATH,
    allowRetired: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--signature") options.signaturePath = path.resolve(argv[++index]);
    else if (value === "--publisher") options.publisherId = argv[++index];
    else if (value === "--trust-store") options.trustStorePath = path.resolve(argv[++index]);
    else if (value === "--allow-retired") options.allowRetired = true;
    else throw new Error(`Unknown argument: ${value}`);
  }

  if (!options.signaturePath || !options.publisherId) {
    throw new Error("Required arguments: --signature <path> --publisher <publisherId>");
  }

  return options;
}

function printErrors(errors) {
  for (const error of errors) {
    console.error(`[${error.code}] ${error.instancePath}: ${error.message}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const errors = verifyPackageSignature(options);

  if (errors.length > 0) {
    printErrors(errors);
    process.exitCode = 1;
    return;
  }

  console.log(`Package signature valid for publisher '${options.publisherId}'.`);
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedAsScript) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
