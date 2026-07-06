/**
 * scripts/compliance/check-pattern-parity.ts
 *
 * S-4 parity guard: the WA I-502 compliance regex patterns are defined ONCE in
 * `src/lib/ai/compliance-patterns.json` and the Python crawler carries a
 * byte-identical copy at `crawler/app/compliance_patterns.json` (the crawler
 * Docker image only ships `crawler/app`, so it can't read the site file at
 * runtime). This script fails when:
 *   1. the two files are not byte-identical (drift), or
 *   2. any pattern fails to compile as a JS RegExp, or
 *   3. any pattern uses a construct Python's `re` can't parse (lookbehind /
 *      named groups are banned by policy; we lint for the obvious ones).
 *
 * Run: npx tsx scripts/compliance/check-pattern-parity.ts
 * (also invoked by scripts/compliance/run-pure-selftests.ts)
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..");
const sitePath = resolve(root, "src/lib/ai/compliance-patterns.json");
const crawlerPath = resolve(root, "crawler/app/compliance_patterns.json");

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function fail(msg: string): never {
  console.error(`PARITY FAIL: ${msg}`);
  process.exit(1);
}

const siteBuf = readFileSync(sitePath);
const crawlerBuf = readFileSync(crawlerPath);

// 1. Byte-identical copies.
if (sha256(siteBuf) !== sha256(crawlerBuf)) {
  fail(
    `pattern fixtures have drifted.\n  site:    ${sitePath}\n  crawler: ${crawlerPath}\n` +
      `Fix: cp src/lib/ai/compliance-patterns.json crawler/app/compliance_patterns.json`,
  );
}

// 2. Every pattern must compile as a JS RegExp.
type RawPattern = { pattern: string; flags: string; label: string; severity: string };
const parsed = JSON.parse(siteBuf.toString("utf-8")) as {
  patternsVersion: number;
  patterns: RawPattern[];
};
if (!Number.isInteger(parsed.patternsVersion) || parsed.patternsVersion < 1) {
  fail("patternsVersion must be a positive integer");
}
if (!Array.isArray(parsed.patterns) || parsed.patterns.length === 0) {
  fail("patterns array is empty");
}
for (const p of parsed.patterns) {
  if (!p.label || (p.severity !== "block" && p.severity !== "warn")) {
    fail(`pattern "${p.pattern}" has a bad label/severity`);
  }
  try {
    new RegExp(p.pattern, p.flags);
  } catch (e) {
    fail(`pattern for "${p.label}" does not compile in JS: ${e}`);
  }
  // 3. Ban constructs Python's re can't parse (portability policy).
  if (/\(\?<[=!]/.test(p.pattern)) fail(`pattern for "${p.label}" uses lookbehind (banned)`);
  if (/\(\?P?</.test(p.pattern)) fail(`pattern for "${p.label}" uses named groups (banned)`);
}

console.log(
  `PARITY OK — ${parsed.patterns.length} patterns, version ${parsed.patternsVersion}, sha256 ${sha256(siteBuf).slice(0, 16)}…`,
);
