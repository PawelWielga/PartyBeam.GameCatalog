import process from "node:process";
import { compareSemver, hasPrerelease, parseSemver } from "./semver.mjs";

let failed = false;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function expectComparison(left, right, expectedSign, description) {
  const actual = Math.sign(compareSemver(left, right));
  if (actual === expectedSign) pass(description);
  else fail(`${description}: compareSemver('${left}', '${right}') returned ${actual}`);
}

expectComparison(
  "9007199254740993.0.0",
  "9007199254740992.999999999999999999999999.999999999999999999999999",
  1,
  "core identifiers above Number.MAX_SAFE_INTEGER retain exact precedence",
);
expectComparison(
  "1.0.0-beta.9007199254740993",
  "1.0.0-beta.9007199254740992",
  1,
  "numeric prerelease identifiers above Number.MAX_SAFE_INTEGER retain exact precedence",
);
expectComparison(
  "1.10.0",
  "1.9.999999999999999999999999",
  1,
  "minor precedence beats arbitrarily large patch identifiers",
);
expectComparison(
  "1.0.0",
  "1.0.0-rc.999999999999999999999999",
  1,
  "stable release has higher precedence than any prerelease",
);
expectComparison(
  "1.0.0-beta.10",
  "1.0.0-beta.2",
  1,
  "numeric prerelease identifiers compare numerically",
);
expectComparison(
  "1.0.0-alpha",
  "1.0.0-1",
  1,
  "non-numeric prerelease identifiers sort after numeric identifiers",
);
expectComparison(
  "1.0.0+build.2",
  "1.0.0+build.999",
  0,
  "build metadata does not affect precedence",
);

if (hasPrerelease("2.0.0-beta.1") && !hasPrerelease("2.0.0+build.1")) {
  pass("prerelease detection ignores build metadata");
} else {
  fail("prerelease detection produced an incorrect result");
}

let invalidRejected = false;
try {
  parseSemver("01.0.0");
} catch {
  invalidRejected = true;
}
if (invalidRejected) pass("invalid leading-zero SemVer is rejected");
else fail("invalid leading-zero SemVer must be rejected");

if (failed) process.exitCode = 1;
else console.log("All shared SemVer tests passed.");
