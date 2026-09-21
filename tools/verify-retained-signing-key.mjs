import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { p256 } from "@noble/curves/nist.js";
import { DEFAULT_TRUST_STORE_PATH, verifyPackageSignature } from "./verify-package-signature.mjs";

const EXPECTED_KEY_ID = "partybeam-first-party-2026-09";

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64");
}

function parseArgs(argv) {
  let privateKeyPath;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--private-key") privateKeyPath = path.resolve(argv[++index]);
    else throw new Error("Unknown argument: " + value);
  }
  if (!privateKeyPath) throw new Error("Required argument: --private-key <path>");
  return { privateKeyPath };
}

function derFingerprint(publicKeyObject) {
  return crypto.createHash("sha256")
    .update(publicKeyObject.export({ type: "spki", format: "der" }))
    .digest("hex");
}

const { privateKeyPath } = parseArgs(process.argv.slice(2));
const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
const privateKey = crypto.createPrivateKey(privateKeyPem);
const privateJwk = privateKey.export({ format: "jwk" });

if (privateJwk.kty !== "EC" || privateJwk.crv !== "P-256" || !privateJwk.d) {
  throw new Error("Retained signing key must be an EC P-256 private key.");
}

const trustStore = JSON.parse(fs.readFileSync(DEFAULT_TRUST_STORE_PATH, "utf8"));
const trusted = trustStore.keys.find((key) => key.keyId === EXPECTED_KEY_ID);
if (!trusted) throw new Error("Official trust store does not contain " + EXPECTED_KEY_ID + ".");
if (trusted.publisherId !== "partybeam" || trusted.status !== "active") {
  throw new Error("Retained key must be active and bound to publisher partybeam.");
}

const privatePublic = crypto.createPublicKey(privateKey);
const trustedPublic = crypto.createPublicKey(trusted.publicKeyPem);
const privatePublicDer = privatePublic.export({ type: "spki", format: "der" });
const trustedPublicDer = trustedPublic.export({ type: "spki", format: "der" });
if (privatePublicDer.length !== trustedPublicDer.length || !crypto.timingSafeEqual(privatePublicDer, trustedPublicDer)) {
  throw new Error("Provided private key does not match the retained public key in the official trust store.");
}

const secretKey = decodeBase64Url(privateJwk.d);
const packageHash = crypto.randomBytes(32);
const signature = p256.sign(packageHash, secretKey, {
  prehash: false,
  lowS: false,
  format: "compact",
});

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-retained-key-check-"));
try {
  const envelopePath = path.join(tempDir, "signature.json");
  fs.writeFileSync(envelopePath, JSON.stringify({
    schemaVersion: 1,
    manifestSha256: crypto.randomBytes(32).toString("hex"),
    packageSha256: packageHash.toString("hex"),
    signature: {
      algorithm: "ecdsa-p256-sha256-p1363",
      keyId: EXPECTED_KEY_ID,
      valueBase64: Buffer.from(signature).toString("base64"),
    },
  }, null, 2) + "\n", "utf8");

  const errors = verifyPackageSignature({
    signaturePath: envelopePath,
    publisherId: "partybeam",
    trustStorePath: DEFAULT_TRUST_STORE_PATH,
  });
  if (errors.length > 0) {
    throw new Error("Retained-key signature verification failed: " + JSON.stringify(errors));
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("Retained PartyBeam signing identity verified.");
console.log("keyId: " + EXPECTED_KEY_ID);
console.log("publicKeySha256: " + derFingerprint(trustedPublic));
