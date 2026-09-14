const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemver(version) {
  const match = SEMVER_RE.exec(version);
  if (!match) throw new Error(`Invalid SemVer '${version}'.`);

  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: match[4]
      ? match[4].split(".").map((part) => (/^(0|[1-9][0-9]*)$/.test(part)
        ? { numeric: true, value: BigInt(part) }
        : { numeric: false, value: part }))
      : null,
  };
}

function compareIdentifier(left, right) {
  if (left.numeric && right.numeric) {
    if (left.value < right.value) return -1;
    if (left.value > right.value) return 1;
    return 0;
  }
  if (left.numeric !== right.numeric) return left.numeric ? -1 : 1;
  if (left.value < right.value) return -1;
  if (left.value > right.value) return 1;
  return 0;
}

export function compareSemver(leftVersion, rightVersion) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);

  for (const field of ["major", "minor", "patch"]) {
    if (left[field] < right[field]) return -1;
    if (left[field] > right[field]) return 1;
  }

  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= left.prerelease.length) return -1;
    if (index >= right.prerelease.length) return 1;
    const result = compareIdentifier(left.prerelease[index], right.prerelease[index]);
    if (result !== 0) return result;
  }

  return 0;
}

export function hasPrerelease(version) {
  return parseSemver(version).prerelease !== null;
}
