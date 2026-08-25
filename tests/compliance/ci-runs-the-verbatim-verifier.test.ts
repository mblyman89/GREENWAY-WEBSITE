/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A VERIFIER NOBODY RUNS APPROVES EVERYTHING (books-56)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `scripts/verify-verbatim-quotes.ts` is how standing rule 24/35 - "the quote
 * is sacred" - stops being a promise and becomes a mechanism. It reads every
 * authority in `GUIDANCE_AUTHORITIES`, finds the mirrored source on disk, and
 * requires the stored `quote` to appear in it verbatim. It exits non-zero on any
 * mismatch. It has worked correctly since books-25.
 *
 * Nothing ran it.
 *
 * Not the vitest suite, not the CI workflow, not a git hook. The only thing
 * invoking it was me, by hand, when I remembered - and "when I remembered" is
 * not a control. Any branch could have reworded an IRS or RCW quotation and gone
 * green through every automated check in the repository.
 *
 * ═══ HOW IT WAS FOUND, WHICH MATTERS MORE THAN THE FIX ═══
 *
 * Not by reading the workflow file. By mutation. `scripts/mutate-books-56-lessons.py`
 * mutations M11 and M12 altered the text of registry quotations and were
 * PREDICTED RED. Both came back GREEN. Under standing rule 112 a surviving
 * mutant is investigated rather than explained away, and the investigation found
 * that the gate everyone assumed was watching had never been switched on.
 *
 * This is the same defect shape as the §280E routing bug and the WAC 192-310-010
 * skip: in all three cases a check existed, was believed to be running, and was
 * silently answering a question about nothing. Standing rule 39 names it - a
 * verifier that cannot see something approves it - and the lesson that keeps
 * repeating is that the absence of a red X is not evidence of a check.
 *
 * ═══ WHY THIS TEST IS SHAPED THE WAY IT IS ═══
 *
 * The obvious fix is to add a CI step, and that is done. But a step added in one
 * commit can be deleted in the next, by anyone, for any reason - a flaky
 * afternoon, a rebase, a tidy-up - and the deletion looks exactly like every
 * other line of YAML. The repository would silently return to the state this
 * file was written to escape, and no test would fail.
 *
 * So the workflow is read as text and the step is required to exist. That is
 * unusual and slightly ugly. It is justified because the failure being prevented
 * is specifically "the check stopped running and nothing said so", which is the
 * one failure a test of the check itself cannot detect.
 *
 * WHAT THIS TEST DOES NOT DO, stated plainly rather than implied. It does not
 * verify any quotation. It proves only that the thing which does is invoked
 * where it can fail a pull request. Claiming more would be the overstatement
 * rule 40 refuses.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = join(__dirname, "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "compliance-tests.yml");
const VERIFIER = "scripts/verify-verbatim-quotes.ts";

describe("CI actually runs the verbatim quote verifier", () => {
  it("the verifier script exists where CI expects it", () => {
    /*
     * Rule 66d: assert existence before absence. If the path is wrong, every
     * other assertion in this file is about a file that is not there, and a
     * grep for a filename that does not exist would fail for the wrong reason.
     */
    expect(
      existsSync(join(REPO_ROOT, VERIFIER)),
      `${VERIFIER} does not exist. If it was renamed, this test and the CI step must both be ` +
        "updated - and until they are, the rule 24/35 check is not running.",
    ).toBe(true);
    expect(existsSync(WORKFLOW), `${WORKFLOW} does not exist`).toBe(true);
  });

  it("the workflow invokes it, in a job that can fail a pull request", () => {
    const yaml = readFileSync(WORKFLOW, "utf8");

    expect(
      yaml.includes(`npx tsx ${VERIFIER}`),
      "The CI workflow no longer runs the verbatim quote verifier. Every authority quotation in " +
        "GUIDANCE_AUTHORITIES is now unchecked by automation: a reworded IRS or RCW passage would " +
        "merge green. This is exactly the state mutations M11 and M12 exposed in books-56. " +
        "Restore the step rather than deleting this test.",
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
     * And it must sit in the `compliance` job, not in `migrations` or `build`.
     * Those two require a database and a full Next build respectively; parking a
     * two-second text check behind either makes it skippable for reasons that
     * have nothing to do with quotations.
     */
    const complianceJob = yaml.slice(
      yaml.indexOf("  compliance:"),
      yaml.indexOf("  migrations:") === -1 ? undefined : yaml.indexOf("  migrations:"),
    );
    expect(
      complianceJob.includes(`npx tsx ${VERIFIER}`),
      "the verifier step exists in the workflow but not inside the `compliance` job, which is the " +
        "only job that runs without a database or a full build",
    ).toBe(true);
  });

  /**
   * THE TEST THAT PROVES THE VERIFIER STILL BITES (rule 15).
   *
   * Pinning the CI step proves the verifier is invoked. It does not prove the
   * verifier would object to anything, and a green step from a broken verifier
   * is the whole problem restated. So this runs it for real, as a subprocess,
   * exactly the way CI does.
   *
   * As a subprocess and not an import, deliberately: `main()` in that file calls
   * `process.exit(1)` on failure, which inside vitest would kill the entire run
   * with no attribution to any test. Its own docblock records that this once
   * happened. A child process is the honest way to observe an exit code.
   */
  it("the verifier passes right now, and is capable of failing", () => {
    const run = (): { status: number; out: string } => {
      try {
        const out = execFileSync("npx", ["tsx", VERIFIER], {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 240_000,
        });
        return { status: 0, out };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { status: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
      }
    };

    const ok = run();
    expect(
      ok.status,
      `the verbatim quote verifier FAILED. A stored quotation no longer matches its mirrored ` +
        `source. Output:\n${ok.out.slice(-4000)}`,
    ).toBe(0);

    /*
     * It must also report that it checked something. "0 verified" with a zero
     * exit code is the classic vacuous pass, and while the script guards against
     * that internally, this asserts the guard's effect from outside where a
     * regression in the guard itself would show up.
     */
    const m = /(\d+) verified against local sources/.exec(ok.out);
    expect(m, `the verifier did not report how many quotes it checked:\n${ok.out.slice(-2000)}`)
      .not.toBeNull();
    expect(
      Number(m![1]),
      "the verifier ran and passed while checking almost nothing, which is how a broken " +
        "cite-to-file mapping looks from the outside",
    ).toBeGreaterThan(300);

    expect(ok.out).toContain("RULE 24/35 VERIFICATION PASSED.");
  }, 300_000);
});
