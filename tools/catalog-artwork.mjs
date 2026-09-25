import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAX_COVER_BYTES = 8 * 1024 * 1024;
export const RECOMMENDED_COVER_WIDTH = 1024;
export const RECOMMENDED_COVER_HEIGHT = 1536;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/");
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Catalog artwork path escapes the configured root: ${relativePath}`);
  }
  return resolved;
}

export function catalogCoverPath(gameId) {
  return `artwork/v1/${gameId}/cover.png`;
}

export function catalogCoverUrl(gameId) {
  return `https://raw.githubusercontent.com/PawelWielga/PartyBeam.GameCatalog/main/${catalogCoverPath(gameId)}`;
}

export function findCanonicalCover(manifest) {
  const covers = (manifest.catalog?.artwork ?? []).filter((asset) => asset.kind === "cover");
  if (covers.length > 1) {
    throw new Error("Manifest declares more than one canonical catalog cover.");
  }
  return covers[0] ?? null;
}

export function inspectPng(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (
    bytes.length < 24
    || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("Catalog cover must be a valid PNG with an IHDR header.");
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) {
    throw new Error("Catalog cover PNG dimensions must be positive.");
  }
  if (width * 3 !== height * 2) {
    throw new Error(`Catalog cover must use an exact 2:3 aspect ratio; got ${width}x${height}.`);
  }

  return { width, height };
}

export function readCatalogCover({ manifest, sourceRoot }) {
  const declaration = findCanonicalCover(manifest);
  if (!declaration) return null;

  if (path.extname(declaration.artifactPath).toLowerCase() !== ".png") {
    throw new Error(
      `Catalog cover '${declaration.artifactPath}' must be PNG for catalog publication.`,
    );
  }
  if (!sourceRoot) {
    throw new Error("artworkSourceRoot is required when the manifest declares a catalog cover.");
  }

  const sourcePath = resolveInside(sourceRoot, declaration.artifactPath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Declared catalog cover does not exist: ${sourcePath}`);
  }

  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) {
    throw new Error(`Declared catalog cover is not a file: ${sourcePath}`);
  }
  if (stat.size < 1) {
    throw new Error("Catalog cover must not be empty.");
  }
  if (stat.size > MAX_COVER_BYTES) {
    throw new Error(
      `Catalog cover exceeds the ${MAX_COVER_BYTES}-byte publication limit: ${stat.size} bytes.`,
    );
  }

  const bytes = fs.readFileSync(sourcePath);
  const digest = sha256Bytes(bytes);
  if (digest !== declaration.sha256.toLowerCase()) {
    throw new Error(
      `Catalog cover SHA-256 mismatch: manifest declares ${declaration.sha256.toLowerCase()}, got ${digest}.`,
    );
  }

  const { width, height } = inspectPng(bytes);
  const catalogPath = catalogCoverPath(manifest.gameId);

  return {
    bytes,
    metadata: {
      id: declaration.id,
      kind: declaration.kind,
      sourceArtifactPath: normalizeRelativePath(declaration.artifactPath),
      catalogPath,
      publicUrl: catalogCoverUrl(manifest.gameId),
      contentType: "image/png",
      sizeBytes: bytes.length,
      sha256: digest,
      width,
      height,
    },
  };
}

export function writeCatalogCover({ cover, outputRoot, overwrite = false }) {
  if (!cover) return null;
  if (!outputRoot) {
    throw new Error("artworkOutputDir is required when the manifest declares a catalog cover.");
  }

  const targetPath = resolveInside(outputRoot, cover.metadata.catalogPath);
  if (!overwrite && fs.existsSync(targetPath)) {
    throw new Error(
      `Refusing to overwrite existing catalog artwork output: ${targetPath}. Use --force explicitly.`,
    );
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, cover.bytes, overwrite ? undefined : { flag: "wx" });
  return targetPath;
}

export function validatePublishedCatalogCover({
  metadata,
  gameId,
  artworkRoot,
}) {
  const errors = [];
  const expectedPath = catalogCoverPath(gameId);
  const expectedUrl = catalogCoverUrl(gameId);

  if (metadata.kind !== "cover") {
    errors.push({ code: "artwork-kind-mismatch", message: "Catalog artwork provenance must describe the canonical cover." });
  }
  if (metadata.catalogPath !== expectedPath) {
    errors.push({ code: "artwork-path-mismatch", message: `Expected catalog artwork path '${expectedPath}'.` });
  }
  if (metadata.publicUrl !== expectedUrl) {
    errors.push({ code: "artwork-url-mismatch", message: `Expected catalog artwork URL '${expectedUrl}'.` });
  }
  if (!artworkRoot) {
    errors.push({ code: "artwork-directory-missing", message: "Catalog artwork candidate directory is required." });
    return errors;
  }

  let filePath;
  try {
    filePath = resolveInside(artworkRoot, expectedPath);
  } catch (error) {
    errors.push({ code: "artwork-path-invalid", message: error.message });
    return errors;
  }

  if (!fs.existsSync(filePath)) {
    errors.push({ code: "artwork-file-missing", message: `Catalog artwork candidate does not exist: ${filePath}` });
    return errors;
  }

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      errors.push({ code: "artwork-not-file", message: `Catalog artwork candidate is not a file: ${filePath}` });
      return errors;
    }
    if (stat.size !== metadata.sizeBytes) {
      errors.push({
        code: "artwork-size-mismatch",
        message: `Catalog artwork size mismatch: expected ${metadata.sizeBytes}, got ${stat.size}.`,
      });
    }
    if (stat.size > MAX_COVER_BYTES) {
      errors.push({
        code: "artwork-size-limit",
        message: `Catalog artwork exceeds the ${MAX_COVER_BYTES}-byte publication limit.`,
      });
    }

    const bytes = fs.readFileSync(filePath);
    const digest = sha256Bytes(bytes);
    if (digest !== metadata.sha256) {
      errors.push({
        code: "artwork-hash-mismatch",
        message: `Catalog artwork SHA-256 mismatch: expected ${metadata.sha256}, got ${digest}.`,
      });
    }

    const dimensions = inspectPng(bytes);
    if (dimensions.width !== metadata.width || dimensions.height !== metadata.height) {
      errors.push({
        code: "artwork-dimensions-mismatch",
        message: `Catalog artwork dimensions mismatch: expected ${metadata.width}x${metadata.height}, got ${dimensions.width}x${dimensions.height}.`,
      });
    }
  } catch (error) {
    errors.push({ code: "artwork-invalid", message: error.message });
  }

  return errors;
}
