import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { p256 } from "@noble/curves/nist.js";
import { verifyPackageSignature } from "./verify-package-signature.mjs";

let failed = false;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function publicKeyToPem(publicKey) {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error("Expected an uncompressed P-256 public key.");
  }

  const keyObject = crypto.createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: toBase64Url(publicKey.subarray(1, 33)),
      y: toBase64Url(publicKey.subarray(33, 65)),
    },
    format: "jwk",
  });

  return keyObject.export({ type: "spki", format: "pem" });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-signature-test-"));

try {
  const { secretKey } = p256.keygen();
  const publicKey = p256.getPublicKey(secretKey, false);
  const publisherId = "partybeam";
  const keyId = "test-ephemeral-p256";
  const packageHash = crypto.randomBytes(32);
  const signature = p256.sign(packageHash, secretKey, {
    prehash: false,
    lowS: false,
    format: "compact",
  });

  const envelopePath = path.join(tempDir, "signature.json");
  const trustStorePath = path.join(tempDir, "trust.json");

  fs.writeFileSync(
    envelopePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        manifestSha256: crypto.randomBytes(32).toString("hex"),
        packageSha256: packageHash.toString("hex"),
        signature: {
          algorithm: "ecdsa-p256-sha256-p1363",
          keyId,
          valueBase64: Buffer.from(signature).toString("base64"),
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  fs.writeFileSync(
    trustStorePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        keys: [
          {
            keyId,
            publisherId,
            algorithm: "ecdsa-p256-sha256-p1363",
            status: "active",
            publicKeyPem: publicKeyToPem(publicKey),
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const validErrors = verifyPackageSignature({
    signaturePath: envelopePath,
    publisherId,
    trustStorePath,
  });
  if (validErrors.length === 0) {
    pass("valid P-256 P1363 signature is accepted for the trusted publisher key");
  } else {
    fail(`valid signature was rejected: ${JSON.stringify(validErrors)}`);
  }

  const wrongPublisherErrors = verifyPackageSignature({
    signaturePath: envelopePath,
    publisherId: "different-publisher",
    trustStorePath,
  });
  if (wrongPublisherErrors.some((error) => error.code === "signature-publisher-key-mismatch")) {
    pass("trusted key cannot authorize a different publisher identity");
  } else {
    fail("publisher/key identity mismatch must be rejected");
  }

  const tamperedEnvelope = JSON.parse(fs.readFileSync(envelopePath, "utf8"));
  tamperedEnvelope.packageSha256 = crypto.randomBytes(32).toString("hex");
  const tamperedPath = path.join(tempDir, "tampered-signature.json");
  fs.writeFileSync(tamperedPath, `${JSON.stringify(tamperedEnvelope, null, 2)}\n`, "utf8");

  const tamperedErrors = verifyPackageSignature({
    signaturePath: tamperedPath,
    publisherId,
    trustStorePath,
  });
  if (tamperedErrors.some((error) => error.code === "signature-invalid")) {
    pass("signature verification rejects a changed packageSha256");
  } else {
    fail("changed packageSha256 must invalidate the signature");
  }

  const retiredTrust = JSON.parse(fs.readFileSync(trustStorePath, "utf8"));
  retiredTrust.keys[0].status = "retired";
  const retiredPath = path.join(tempDir, "retired-trust.json");
  fs.writeFileSync(retiredPath, `${JSON.stringify(retiredTrust, null, 2)}\n`, "utf8");

  const retiredPublicationErrors = verifyPackageSignature({
    signaturePath: envelopePath,
    publisherId,
    trustStorePath: retiredPath,
  });
  if (retiredPublicationErrors.some((error) => error.code === "signature-key-not-active")) {
    pass("retired signing keys cannot authorize new publication");
  } else {
    fail("retired key must not authorize new publication");
  }

  const retiredHistoricalErrors = verifyPackageSignature({
    signaturePath: envelopePath,
    publisherId,
    trustStorePath: retiredPath,
    allowRetired: true,
  });
  if (retiredHistoricalErrors.length === 0) {
    pass("retired keys may still verify historical signatures when explicitly requested");
  } else {
    fail(`historical retired-key verification was rejected: ${JSON.stringify(retiredHistoricalErrors)}`);
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("All package signature verification tests passed.");
}
