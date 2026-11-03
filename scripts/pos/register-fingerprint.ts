/**
 * scripts/pos/register-fingerprint.ts  (D143 — "am I on the newest register app?")
 *
 * The node-side half of src/lib/pos/register-fingerprint-core.ts. It walks the
 * register's real import graph starting at RegisterShell.tsx, hashes every
 * project file it reaches plus FINGERPRINT_EXTRA_FILES, and hashes the sorted
 * manifest into ONE sha256 fingerprint.
 *
 * It is imported by BOTH builds so they can never disagree about the recipe:
 *   - next.config.ts           -> the live server's fingerprint (Vercel deploy)
 *   - register-app/vite.config -> the fingerprint baked into the iPad bundle
 * and can be run directly to print the value:
 *   npx tsx scripts/pos/register-fingerprint.ts
 *
 * It never throws: any failure yields null, which the lock screen shows as
 * "cannot verify" (never as a false green).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  extractImportSpecs,
  FINGERPRINT_ENTRY,
  FINGERPRINT_EXTRA_FILES,
  fingerprintManifest,
  isLocalSpec,
  normalizeRelPath,
  normalizeSource,
} from "../../src/lib/pos/register-fingerprint-core";

const TRY_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];
const PARSE_EXT = /\.(tsx?|jsx?|mjs)$/;

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveSpec(repoRoot: string, fromAbs: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(repoRoot, "src", spec.slice(2))
    : path.resolve(path.dirname(fromAbs), spec);
  for (const s of TRY_SUFFIXES) {
    if (isFile(base + s)) return base + s;
  }
  return null;
}

function digestOf(abs: string): string | null {
  try {
    return createHash("sha256").update(normalizeSource(readFileSync(abs, "utf8"))).digest("hex");
  } catch {
    return null;
  }
}

export type RegisterFingerprintResult = {
  fingerprint: string;
  files: number;
  manifest: string;
};

/** Compute the register fingerprint for a checkout rooted at `repoRoot`. */
export function computeRegisterFingerprintDetailed(repoRoot: string): RegisterFingerprintResult | null {
  try {
    const parts = new Map<string, string | null>();
    const queue: string[] = [path.join(repoRoot, FINGERPRINT_ENTRY)];
    const seen = new Set<string>();
    while (queue.length) {
      const abs = queue.shift()!;
      if (seen.has(abs)) continue;
      seen.add(abs);
      const rel = normalizeRelPath(path.relative(repoRoot, abs));
      const digest = digestOf(abs);
      parts.set(rel, digest);
      if (digest === null || !PARSE_EXT.test(abs)) continue;
      const src = readFileSync(abs, "utf8");
      for (const spec of extractImportSpecs(src)) {
        if (!isLocalSpec(spec)) continue;
        const hit = resolveSpec(repoRoot, abs, spec);
        if (hit) queue.push(hit);
        else parts.set(`unresolved:${rel}:${spec}`, null);
      }
    }
    for (const extra of FINGERPRINT_EXTRA_FILES) {
      if (!parts.has(extra)) parts.set(extra, digestOf(path.join(repoRoot, extra)));
    }
    if (parts.get(FINGERPRINT_ENTRY) == null) return null;
    const manifest = fingerprintManifest([...parts].map(([p, digest]) => ({ path: p, digest })));
    const fingerprint = createHash("sha256").update(manifest).digest("hex");
    return { fingerprint, files: parts.size, manifest };
  } catch {
    return null;
  }
}

export function computeRegisterFingerprint(repoRoot: string): string | null {
  return computeRegisterFingerprintDetailed(repoRoot)?.fingerprint ?? null;
}

// CLI: print the fingerprint (and with --manifest, every hashed file).
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /register-fingerprint\.ts$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  const root = path.resolve(process.argv[1]!, "..", "..", "..");
  const r = computeRegisterFingerprintDetailed(root);
  if (!r) {
    console.error("Could not compute the register fingerprint.");
    process.exitCode = 1;
  } else {
    if (process.argv.includes("--manifest")) console.log(r.manifest);
    console.log(`Register fingerprint: ${r.fingerprint.slice(0, 10)}  (${r.files} files)  full=${r.fingerprint}`);
  }
}
