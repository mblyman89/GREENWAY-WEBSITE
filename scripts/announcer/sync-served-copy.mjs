#!/usr/bin/env node
/**
 * Keep public/announcer/ byte-identical to pi-agent/.
 *
 * WHY THIS EXISTS
 * ---------------
 * install.sh downloads the agent from "${SITE}/announcer/greenway_announcer.py".
 * In Next.js that URL is served from public/announcer/. So there are two copies
 * of the same file, and only ONE of them is the one a real Raspberry Pi in a
 * real shop actually installs.
 *
 * That is a defect factory. On 2026-xx three PRs were merged that changed
 * pi-agent/greenway_announcer.py and did not change the served copy. The repo
 * looked correct. The tests that guard this were red. The owner was told to run
 * a command that DID NOT EXIST in the file his Pi would have downloaded:
 * the served copy was 2195 lines, the real agent was 3615.
 *
 * A guard that tells you something is broken but not how to fix it gets
 * ignored under pressure. This script is the fix, and the test failure names
 * it by name, so "how do I fix this" has exactly one answer:
 *
 *     npm run announcer:sync
 *
 * MODES
 *   (default)  copy pi-agent/* -> public/announcer/*, report what changed
 *   --check    change nothing; exit 1 if they differ (for CI / pre-commit)
 *
 * The source of truth is ALWAYS pi-agent/. public/announcer/ is a build
 * artifact that happens to be committed, because Next.js serves it statically.
 * Never hand-edit public/announcer/.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The files a Pi downloads. Keep in step with tests/compliance/announcer-admin.test.ts. */
export const SERVED_FILES = ["greenway_announcer.py", "install.sh"];

const SRC_DIR = join(ROOT, "pi-agent");
const DEST_DIR = join(ROOT, "public", "announcer");

/**
 * Compare source and served copy without writing anything.
 * Returns one entry per file so the caller can report ALL problems at once
 * rather than dying on the first — a report that stops at the first fault
 * makes you run the tool once per fault.
 */
export function inspect() {
  return SERVED_FILES.map((file) => {
    const srcPath = join(SRC_DIR, file);
    const destPath = join(DEST_DIR, file);

    if (!existsSync(srcPath)) {
      return { file, state: "source-missing", srcPath, destPath };
    }
    const src = readFileSync(srcPath, "utf8");

    if (!existsSync(destPath)) {
      return { file, state: "served-missing", src, srcPath, destPath };
    }
    const served = readFileSync(destPath, "utf8");

    if (served === src) {
      return { file, state: "in-sync", src, srcPath, destPath };
    }
    return {
      file,
      state: "drifted",
      src,
      srcPath,
      destPath,
      srcLines: src.split("\n").length,
      servedLines: served.split("\n").length,
    };
  });
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const results = inspect();

  const broken = results.filter((r) => r.state !== "in-sync");

  if (broken.length === 0) {
    console.log("announcer: public/announcer/ is in sync with pi-agent/ " + `(${SERVED_FILES.join(", ")})`);
    return 0;
  }

  if (checkOnly) {
    console.error("\nannouncer: the files a Raspberry Pi downloads are NOT up to date.\n");
    for (const r of broken) {
      if (r.state === "source-missing") {
        console.error(`  ${r.file}: MISSING from pi-agent/ - cannot sync`);
      } else if (r.state === "served-missing") {
        console.error(`  ${r.file}: not served at all from public/announcer/`);
      } else {
        console.error(
          `  ${r.file}: served copy is ${r.servedLines} lines, source is ${r.srcLines}`,
        );
      }
    }
    console.error("\n  A Pi installing right now would get the OLD file.");
    console.error("  Fix it with:  npm run announcer:sync\n");
    return 1;
  }

  // A missing SOURCE is not something copying can fix, and silently doing
  // nothing would be worse than failing.
  const sourceMissing = broken.filter((r) => r.state === "source-missing");
  if (sourceMissing.length > 0) {
    for (const r of sourceMissing) {
      console.error(`announcer: ${r.srcPath} does not exist. Nothing to copy from.`);
    }
    return 1;
  }

  mkdirSync(DEST_DIR, { recursive: true });
  for (const r of broken) {
    writeFileSync(r.destPath, r.src);
    if (r.state === "served-missing") {
      console.log(`announcer: created public/announcer/${r.file}`);
    } else {
      console.log(
        `announcer: updated public/announcer/${r.file} ` +
          `(${r.servedLines} -> ${r.srcLines} lines)`,
      );
    }
  }
  console.log("\nannouncer: served copies now match pi-agent/. Commit them with your change.");
  return 0;
}

// Only run when invoked directly, so the test suite can import inspect().
if (process.argv[1] && process.argv[1].endsWith("sync-served-copy.mjs")) {
  process.exit(main());
}
