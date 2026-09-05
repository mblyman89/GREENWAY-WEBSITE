import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * THE VERCEL BUILD FAILURE — why it happened and what stops it recurring.
 *
 * The owner reported that a merged slice failed to build on Vercel. The CI
 * `build` job — the one whose step is literally named "next build (the command
 * Vercel runs)" — was green on that exact commit. Three separate slices merged
 * with all checks passing and a broken deployment.
 *
 * Two independent causes, both of which this file pins.
 *
 * ── CAUSE 1: CI had more memory than Vercel ──────────────────────────────────
 *
 * Node's default old-space heap is roughly HALF OF SYSTEM RAM. Vercel documents
 * its build container as 8192 MB ("Each Vercel build container is allocated
 * 8192 MB of memory" — Vercel KB, Troubleshooting Builds Failing with SIGKILL
 * or Out of Memory Errors), so Vercel's default heap lands near 4096 MB.
 *
 * The CI build step set NODE_OPTIONS=--max-old-space-size=6144. So the job
 * advertised as running "the command Vercel runs" was running it with about
 * 50% more heap than Vercel actually has. That is not a check; it is a check
 * shaped object. It could not fail for the reason production was failing.
 *
 * The heap is now declared ONCE, in the `build` script, so both machines get
 * the same ceiling. 7168 MB leaves the build agent headroom inside the
 * documented 8192 MB rather than racing the OOM killer at 8192.
 *
 * ── CAUSE 2: the build type-checked 563 files it then threw away ─────────────
 *
 * tsconfig.json includes "**\/*.ts", which pulls every file in tests/ into the
 * program. next build hands that entire list to typescript.createProgram() and
 * only AFTERWARDS discards the test diagnostics, through an ignoreRegex in
 * next/dist/lib/typescript/runTypeCheck.js matching *.test.ts, __tests__ and
 * __mocks__.
 *
 * So the memory was spent in full on ~9,000 lines of compliance assertions
 * whose results the build had already decided to ignore — and it grew with
 * every slice (537 test files at SLICE 16, 561 at Slice 13). Reproduced
 * locally with a constrained heap: "Compiled successfully", then death inside
 * "Running TypeScript" with "Ineffective mark-compacts near heap limit".
 * Compile fine, type-check OOM — the signature Vercel was showing.
 *
 * next.config.ts now points the BUILD at tsconfig.build.json, which excludes
 * tests. This is NOT ignoreBuildErrors: application code is still fully
 * type-checked and a real error still fails the build (verified by injecting
 * one). tests/ is still fully type-checked by `npm run typecheck` in the
 * compliance job. The files are checked once, in the job built for it, instead
 * of twice — the second time uselessly, inside the memory-constrained build.
 */

const repoRoot = path.resolve(__dirname, "..", "..");

const WORKFLOW = path.join(repoRoot, ".github", "workflows", "compliance-tests.yml");
const PACKAGE_JSON = path.join(repoRoot, "package.json");
const NEXT_CONFIG = path.join(repoRoot, "next.config.ts");
const BUILD_TSCONFIG = path.join(repoRoot, "tsconfig.build.json");
const ROOT_TSCONFIG = path.join(repoRoot, "tsconfig.json");

/** Vercel's documented build container size, in MB. */
const VERCEL_CONTAINER_MB = 8192;

describe("the build command fits inside a Vercel build container", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const buildScript = pkg.scripts?.build ?? "";

  it("declares an explicit heap ceiling instead of inheriting Node's default", () => {
    expect(
      /max-old-space-size=\d+/.test(buildScript),
      "The `build` script no longer pins --max-old-space-size. Node then defaults to about " +
        "half of system RAM, which differs between the CI runner and Vercel's build container " +
        "— the exact divergence that let three slices merge green while Vercel failed.",
    ).toBe(true);
  });

  it("leaves the build agent headroom inside the documented 8192 MB", () => {
    const mb = Number(/max-old-space-size=(\d+)/.exec(buildScript)?.[1] ?? 0);
    expect(mb).toBeGreaterThan(0);

    // Below the container size, not equal to it: the agent and the kernel need
    // room, and a heap set to the full container just moves the failure from a
    // V8 heap error to a SIGKILL from the OOM killer.
    expect(
      mb,
      `the build heap (${mb} MB) is not below Vercel's ${VERCEL_CONTAINER_MB} MB container; ` +
        "setting it to the full container size trades a heap error for a SIGKILL",
    ).toBeLessThan(VERCEL_CONTAINER_MB);

    // And high enough to actually be the fix rather than a token change.
    expect(mb).toBeGreaterThanOrEqual(6144);
  });
});

describe("CI builds the way Vercel builds", () => {
  const yaml = readFileSync(WORKFLOW, "utf8");

  it("runs the real build script rather than a hand-rolled variant", () => {
    expect(yaml).toContain("npm run build");
  });

  it("does not give the build job a heap the deploying machine will not have", () => {
    // The step that claims to run "the command Vercel runs" must not quietly
    // run it under better conditions. Any NODE_OPTIONS here re-opens the exact
    // gap that hid this failure: CI green, Vercel red, nobody able to explain
    // the difference.
    const buildJobStart = yaml.indexOf("  build:");
    expect(buildJobStart, "no `build` job in the workflow").toBeGreaterThan(-1);
    const buildJob = yaml.slice(buildJobStart);

    const runLine = buildJob.indexOf("run: npm run build");
    expect(runLine, "the build job does not run `npm run build`").toBeGreaterThan(-1);

    // Look at the step containing that run line, not the whole job.
    const stepStart = buildJob.lastIndexOf("- name:", runLine);
    const step = buildJob.slice(stepStart, runLine);
    const declaresHeap = /^\s*NODE_OPTIONS:.*max-old-space-size/m.test(step);

    expect(
      declaresHeap,
      "the CI build step sets NODE_OPTIONS --max-old-space-size again. That is what made this " +
        "job pass on commits Vercel could not build: it was testing with ~6144 MB while Vercel " +
        "had Node's default (~4096 MB on an 8192 MB container). Set the heap in the `build` " +
        "script so both machines get the same one.",
    ).toBe(false);
  });
});

describe("the build does not type-check files whose errors it discards", () => {
  const nextConfig = readFileSync(NEXT_CONFIG, "utf8");

  it("points the build at a tsconfig that excludes tests", () => {
    expect(nextConfig).toContain("tsconfigPath");
    expect(nextConfig).toContain("tsconfig.build.json");
    expect(existsSync(BUILD_TSCONFIG), "tsconfig.build.json is missing").toBe(true);
  });

  it("never silences real type errors to achieve it", () => {
    // The lazy version of this fix is ignoreBuildErrors: true, which would make
    // the build green by making it blind. Application code must still fail.
    expect(
      /ignoreBuildErrors\s*:\s*true/.test(nextConfig),
      "next.config.ts sets typescript.ignoreBuildErrors — that does not fix the memory problem, " +
        "it just stops the build reporting real defects in application code",
    ).toBe(false);
  });

  it("excludes tests from the build program but not from the repo's type checking", () => {
    const buildTsconfig = JSON.parse(readFileSync(BUILD_TSCONFIG, "utf8")) as {
      extends?: string;
      exclude?: string[];
    };

    // It must build ON the real config, so compiler options cannot drift apart.
    expect(buildTsconfig.extends).toBe("./tsconfig.json");

    const exclude = buildTsconfig.exclude ?? [];
    expect(exclude).toContain("tests");
    expect(exclude.some((e) => e.includes("*.test.ts"))).toBe(true);

    // And the ROOT config must still include them, because that is the one
    // `npm run typecheck` uses and the only thing type-checking tests/ at all.
    const rootTsconfig = JSON.parse(readFileSync(ROOT_TSCONFIG, "utf8")) as {
      include?: string[];
      exclude?: string[];
    };
    expect(rootTsconfig.include ?? []).toContain("**/*.ts");
    expect(
      (rootTsconfig.exclude ?? []).some((e) => /tests?\b/.test(e)),
      "the ROOT tsconfig now excludes tests too, so nothing type-checks them at all — the " +
        "coverage this fix was careful to preserve has been lost",
    ).toBe(false);
  });

  it("still runs the whole-repo type check in CI, including tests", () => {
    const yaml = readFileSync(WORKFLOW, "utf8");
    expect(yaml).toContain("npm run typecheck");
  });
});
