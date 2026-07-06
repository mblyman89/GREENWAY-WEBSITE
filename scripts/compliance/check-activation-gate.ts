/**
 * scripts/compliance/check-activation-gate.ts
 *
 * S-11 grep-guard (GAP M-8): every code path that flips an inventory lot to
 * status "active" MUST go through the lot-activation compliance gate
 * (evaluateLotBatchActivation — CCRS identifier + COA on record + passing lab
 * result) or be an explicitly reviewed non-intake release.
 *
 * The legacy acceptManifest/acceptManifestAction (which activated every
 * quarantined lot with NO gate) were deleted in S-11. This script fails when:
 *   1. any identifier named acceptManifest reappears anywhere in src/, or
 *   2. a `status: "active"` write against inventory_lots appears in a file
 *      that is NOT on the reviewed allow-list below.
 *
 * ALLOW-LIST (reviewed):
 *   • src/lib/inventory/intake-store.ts — finalizeManifestDispositions: the
 *     ONLY intake activation path; every accepted lot is evaluated against
 *     evaluateLotBatchActivation and dirty lots are HELD in quarantine.
 *   • src/lib/inventory/disposition.ts — cancelDestruction: releases a lot
 *     from destruction-quarantine back to active. The lot was already active
 *     (gate-passed) before destruction was staged; this is an un-quarantine,
 *     not an intake activation.
 *
 * Run: npx tsx scripts/compliance/check-activation-gate.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..");

function fail(msg: string): never {
  console.error(`ACTIVATION-GATE GUARD FAIL: ${msg}`);
  process.exit(1);
}

function grep(args: string[]): string[] {
  try {
    const out = execFileSync("grep", args, { cwd: root, encoding: "utf-8" });
    return out.split("\n").filter(Boolean);
  } catch (e) {
    // grep exits 1 when nothing matches — that's success for us.
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1) return [];
    throw e;
  }
}

// 1. The retired ungated helpers must never come back as live identifiers.
//    (Comments explaining the retirement are fine — we flag declarations/calls.)
const acceptManifestHits = grep([
  "-rnE",
  "(function|const|=>)\\s*acceptManifest\\b|acceptManifest\\s*\\(",
  "src",
  "--include=*.ts",
  "--include=*.tsx",
]).filter((line) => {
  // grep output: file:lineno:content — ignore comment-only lines (the
  // retirement notes legitimately mention the old name).
  const content = line.split(":").slice(2).join(":").trimStart();
  return !content.startsWith("//") && !content.startsWith("*") && !content.startsWith("/*");
});
if (acceptManifestHits.length > 0) {
  fail(
    `retired ungated helper 'acceptManifest' has reappeared:\n  ${acceptManifestHits.join("\n  ")}`,
  );
}

// 2. Every `status: "active"` write on inventory lots must be in an allowed file.
const ALLOWED_FILES = new Set([
  "src/lib/inventory/intake-store.ts",
  "src/lib/inventory/disposition.ts",
]);
const activeWrites = grep([
  "-rn",
  'status: "active"',
  "src",
  "--include=*.ts",
  "--include=*.tsx",
]).filter((line) => {
  // Only lot-table writes matter: other tables (medical authorizations,
  // non-cannabis items, …) legitimately use an "active" status. A file is in
  // scope when it touches the inventory_lots table at all.
  const file = line.split(":")[0];
  try {
    return readFileSync(resolve(root, file), "utf-8").includes('from("inventory_lots")');
  } catch {
    return true; // unreadable ⇒ be conservative, flag it
  }
});
const offenders = activeWrites
  .map((line) => line.split(":")[0])
  .filter((file) => !ALLOWED_FILES.has(file));
if (offenders.length > 0) {
  fail(
    `lot activation ('status: "active"') found OUTSIDE the reviewed allow-list — route it through ` +
      `evaluateLotBatchActivation (finalizeManifestDispositions) or add it to the allow-list after review:\n  ` +
      [...new Set(offenders)].join("\n  "),
  );
}

// 3. The one intake activation site must still be gate-protected: the file
//    must call evaluateLotBatchActivation.
const intakeStore = readFileSync(resolve(root, "src/lib/inventory/intake-store.ts"), "utf-8");
if (!intakeStore.includes("evaluateLotBatchActivation")) {
  fail("intake-store.ts no longer references evaluateLotBatchActivation — the activation gate is gone");
}

console.log(
  `ACTIVATION-GATE GUARD OK — no acceptManifest, ${activeWrites.length} activation write(s) all in reviewed files, gate present.`,
);
