import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import {
  MAX_COVER_BYTES,
  catalogCoverPath,
  catalogCoverUrl,
  inspectPng,
  readCatalogCover,
  validatePublishedCatalogCover,
  writeCatalogCover,
} from "./catalog-artwork.mjs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let failed = false;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function makePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * rowBytes] = 0;
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND"),
  ]);
}

function manifestFor(bytes, artifactPath = "catalog/cover.png") {
  return {
    gameId: "partybeam.artwork-test",
    catalog: {
      artwork: [
        {
          id: "cover",
          kind: "cover",
          artifactPath,
          sha256: sha256(bytes),
        },
      ],
    },
  };
}

function expectThrow(action, fragment, description) {
  try {
    action();
    fail(description);
  } catch (error) {
    if (error.message.includes(fragment)) pass(description);
    else fail(`${description}: unexpected error '${error.message}'`);
  }
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "partybeam-catalog-artwork-test-"));

try {
  const sourceRoot = path.join(tempDir, "source");
  const outputRoot = path.join(tempDir, "output");
  fs.mkdirSync(path.join(sourceRoot, "catalog"), { recursive: true });

  const validBytes = makePng(2, 3);
  const sourcePath = path.join(sourceRoot, "catalog/cover.png");
  fs.writeFileSync(sourcePath, validBytes);

  const dimensions = inspectPng(validBytes);
  if (dimensions.width === 2 && dimensions.height === 3) {
    pass("valid PNG cover dimensions are read");
  } else {
    fail("valid PNG cover dimensions were not read");
  }

  const cover = readCatalogCover({
    manifest: manifestFor(validBytes),
    sourceRoot,
  });
  if (
    cover?.metadata.catalogPath === catalogCoverPath("partybeam.artwork-test")
    && cover.metadata.publicUrl === catalogCoverUrl("partybeam.artwork-test")
    && cover.metadata.sha256 === sha256(validBytes)
    && cover.metadata.contentType === "image/png"
  ) {
    pass("game-owned cover is bound to deterministic catalog metadata");
  } else {
    fail("game-owned cover metadata was not derived deterministically");
  }

  writeCatalogCover({ cover, outputRoot });
  const authorizationErrors = validatePublishedCatalogCover({
    metadata: cover.metadata,
    gameId: "partybeam.artwork-test",
    artworkRoot: outputRoot,
  });
  if (authorizationErrors.length === 0) {
    pass("staged cover passes publication-time verification");
  } else {
    fail(`staged cover verification failed: ${JSON.stringify(authorizationErrors)}`);
  }

  const wrongAspectBytes = makePng(3, 3);
  fs.writeFileSync(sourcePath, wrongAspectBytes);
  expectThrow(
    () => readCatalogCover({ manifest: manifestFor(wrongAspectBytes), sourceRoot }),
    "exact 2:3",
    "non-2:3 cover is rejected",
  );

  fs.writeFileSync(sourcePath, validBytes);
  const wrongHashManifest = manifestFor(validBytes);
  wrongHashManifest.catalog.artwork[0].sha256 = "0".repeat(64);
  expectThrow(
    () => readCatalogCover({ manifest: wrongHashManifest, sourceRoot }),
    "SHA-256 mismatch",
    "cover bytes must match the manifest SHA-256",
  );

  const corruptBytes = Buffer.from(validBytes);
  corruptBytes[corruptBytes.length - 1] ^= 0xff;
  fs.writeFileSync(sourcePath, corruptBytes);
  expectThrow(
    () => readCatalogCover({ manifest: manifestFor(corruptBytes), sourceRoot }),
    "invalid CRC",
    "corrupt PNG chunk CRC is rejected",
  );

  const oversizedBytes = Buffer.alloc(MAX_COVER_BYTES + 1);
  fs.writeFileSync(sourcePath, oversizedBytes);
  expectThrow(
    () => readCatalogCover({ manifest: manifestFor(oversizedBytes), sourceRoot }),
    "publication limit",
    "cover exceeding the publication byte limit is rejected",
  );

  fs.writeFileSync(sourcePath, validBytes);
  const jpegManifest = manifestFor(validBytes, "catalog/cover.jpg");
  fs.renameSync(sourcePath, path.join(sourceRoot, "catalog/cover.jpg"));
  expectThrow(
    () => readCatalogCover({ manifest: jpegManifest, sourceRoot }),
    "must be PNG",
    "non-PNG cover path is rejected",
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failed) process.exitCode = 1;
else console.log("All catalog artwork tests passed.");
