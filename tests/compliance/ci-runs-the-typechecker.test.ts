/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THREE TYPE ERRORS SHIPPED THROUGH A GREEN PIPELINE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Slice 13 merged with three genuine TypeScript errors in its own test file:
 *
 *     tests/compliance/slice13-inventory-filtering.test.ts(415,7): error TS2353:
 *       Object literal may only specify known properties, and 'fields' does not
 *       exist in type 'InventoryListInput<PageLot>'.
 *     ... the same error again at (432,7) and (447,7)
 *
 * `npx tsc --noEmit` reports all three in seconds. Every automated gate in this
 * repository said green anyway. That is worth stating precisely, because the
 * reason is a property of the tools and not a lapse anyone can promise away:
 *
 *   - vitest TRANSPILES TypeScript, it does not type-check it. The 80 assertions
 *     in that file passed while the object literal they built was ill-typed.
 *   - `next build` DELIBERATELY DISCARDS diagnostics from test files. In
 *     node_modules/next/dist/lib/typescript/runTypeCheck.js:
 *
 *         const ignoreRegex = [
 *           <re1>  ... matches any path segment __tests__ or __mocks__
 *           <re2>  ... matches any file ending .spec.<ext> or .test.<ext>
 *         ];
 *         const regexIgnoredFile = new RegExp(ignoreRegex.map((r) => r.source).join('|'));
 *         ... .filter((d) => !(d.file && regexIgnoredFile.test(d.file.fileName)))
 *
 *     (The two patterns are written here in words rather than pasted verbatim:
 *     the real source ends with a slash that would close this block comment.
 *     Read them at node_modules/next/dist/lib/typescript/runTypeCheck.js.)
 *
 *     `slice13-inventory-filtering.test.ts` matches the second pattern, so its
 *     errors were filtered out before Next picked a `firstError` to throw on.
 *   - the `build` job runs exactly `next build`, so it inherited that blind spot,
 *     and CI run 33930715527 logged "Finished TypeScript in 81s" and passed.
 *
 * Three gates, one uncovered surface, and the uncovered surface was the one that
 * was wrong. tsconfig.json includes every .ts file in the tree with only
 * `node_modules` excluded, so these files were always INTENDED to be
 * type-checked. Nothing was doing it.
 *
 * ═══ WHY THIS TEST READS A YAML FILE ═══
 *
 * The fix is one CI step. A step is one line and can be deleted in a rebase, a
 * tidy-up, or a flaky afternoon, and its deletion looks like every other YAML
 * change. The repository would silently return to the state described above and
 * nothing would go red - which is the same failure mode books-56 recorded for
 * the verbatim quote verifier, and the reason
 * tests/compliance/ci-runs-the-verbatim-verifier.test.ts reads the workflow as
 * text. This file follows that precedent for the same reason.
 *
 * WHAT THIS TEST DOES NOT DO, stated plainly rather than implied (rule 40). It
 * does not type-check anything. It proves only that the thing which does is
 * invoked where it can fail a pull request.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "compliance-tests.yml");
const PKG = join(REPO_ROOT, "package.json");

describe("CI actually type-checks this repository", () => {
  it("package.json defines a typecheck script that runs tsc with no emit", () => {
    /*
     * Rule 66d: assert existence before absence. If the script is gone, the CI
     * step below is invoking nothing and would fail for a confusing reason.
     */
    expect(existsSync(PKG), `${PKG} does not exist`).toBe(true);

    const pkg = JSON.parse(readFileSync(PKG, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = pkg.scripts?.typecheck;

    expect(
      script,
      "package.json no longer defines a `typecheck` script. Without it the CI step is a no-op " +
        "and type errors in tests/ become invisible again: vitest does not type-check, and " +
        "next build filters *.test.ts diagnostics out of its own type check.",
    ).toBeTruthy();

    /*
     * `--noEmit` specifically. A tsc invocation that emits would write JavaScript
     * over the repository as a side effect of checking it, and someone would
     * eventually "fix" that by deleting the step rather than adding the flag.
     */
    expect(script).toContain("tsc");
    expect(script).toContain("--noEmit");
  });

  it("the workflow runs it, in a job that can fail a pull request", () => {
    expect(existsSync(WORKFLOW), `${WORKFLOW} does not exist`).toBe(true);
    const yaml = readFileSync(WORKFLOW, "utf8");

    expect(
      yaml.includes("npm run typecheck"),
      "The CI workflow no longer runs `npm run typecheck`. Slice 13 merged green with three " +
        "TS2353 errors in its own test file because nothing in the pipeline ran tsc: vitest only " +
        "transpiles, and next build discards diagnostics from *.test.ts by design " +
        "(next/dist/lib/typescript/runTypeCheck.js). Restore the step rather than deleting this test.",
    ).toBe(true);

    /*
     * It must run on pull_request. A check that only runs after a merge to main
     * reports the damage instead of preventing it.
     */
    expect(
      /^on:\s*$/m.test(yaml) && /^\s+pull_request:\s*$/m.test(yaml),
      "the compliance workflow no longer triggers on pull_request, so its checks cannot block a " +
        "merge - they can only report on one that already happened",
    ).toBe(true);

    /*
     * And it must sit in the `compliance` job. That job needs no database and no
     * bundler, so a type check there fails fast and for one legible reason. In
     * `build` it would be gated behind a full Next compile; in `migrations` it
     * would be gated behind a Postgres service container. Neither has anything
     * to do with whether the types are sound.
     */
    const migrationsAt = yaml.indexOf("  migrations:");
    const complianceJob = yaml.slice(
      yaml.indexOf("  compliance:"),
      migrationsAt === -1 ? undefined : migrationsAt,
    );
    expect(
      complianceJob.includes("npm run typecheck"),
      "the typecheck step exists in the workflow but not inside the `compliance` job, which is " +
        "the only job that runs without a database or a full build",
    ).toBe(true);
  });

  /**
   * THE ASSERTION THAT KEEPS THE CHECK HONEST (rule 15).
   *
   * A type check that skipped tests/ would pass this file's other assertions
   * while reproducing the exact hole it was written to close. tsconfig.json is
   * what decides, so tsconfig.json is what gets pinned: tests must be inside the
   * include globs and must not be excluded.
   */
  it("tsconfig still puts tests/ inside the type-checked surface", () => {
    const raw = readFileSync(join(REPO_ROOT, "tsconfig.json"), "utf8");
    const cfg = JSON.parse(raw) as { include?: string[]; exclude?: string[] };

    expect(
      cfg.include?.includes("**/*.ts"),
      "tsconfig.json no longer includes `**/*.ts`, so tests/ may not be type-checked at all. " +
        "That is the precise condition under which the Slice 13 TS2353 errors were invisible.",
    ).toBe(true);

    for (const pattern of cfg.exclude ?? []) {
      expect(
        /tests?\b/.test(pattern),
        `tsconfig.json excludes ${JSON.stringify(pattern)}, which removes test files from the ` +
          "type check and reopens the gap this suite exists to hold shut",
      ).toBe(false);
    }
  });
});
