/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  A GREEN PIPELINE AND AN UNDEPLOYABLE COMMIT LOOKED IDENTICAL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Slice 13 merged with every job in compliance-tests.yml green, and Vercel
 * never built it. The dashboard did not say "failed" - it said BLOCKED, and
 * there were no build logs at all, because no build was ever started.
 *
 * The difference between the commit that deployed and the commit that did not
 * was the git author email, and nothing else:
 *
 *   3d25026  dev@greenwaymarijuana.com  -> GitHub user mblyman89  -> deployed
 *   10eb1a6  superninja@ninjatech.ai    -> no GitHub user at all  -> BLOCKED
 *
 * That resolution is checkable against the GitHub API: for 3d25026 the commit's
 * `author.login` is `mblyman89`; for 10eb1a6 the `author` field is null. Vercel
 * documents this under "Build Logs not available", listing among the causes of
 * a log-less failure that commits were made from a contributor that is not a
 * team member. An email that maps to no GitHub account can never map to a team
 * member, so the deployment is refused before a container is allocated.
 *
 * The regression itself was mundane: `git config user.email` was unset in the
 * build sandbox. Git does not error on an unset identity - it silently invents
 * one from the hostname, producing addresses like root@172.16.236.161.
 *
 * ═══ WHY THIS TEST READS A YAML FILE ═══
 *
 * The fix is one CI step and one `fetch-depth: 0`. Both are single lines, both
 * look like ordinary YAML, and either can be dropped in a tidy-up without
 * anything going red. The repository would return to the state above, where the
 * only signal is a deployment that silently never happens. This follows the
 * precedent set by ci-runs-the-verbatim-verifier.test.ts and
 * ci-runs-the-typechecker.test.ts for the same reason.
 *
 * WHAT THIS TEST DOES NOT DO, stated plainly rather than implied (rule 40): it
 * does not inspect any commit. It proves only that the thing which does is
 * invoked where it can fail a pull request, and that it is given the history
 * depth it needs to see more than a single commit.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  REQUIRED_AUTHOR_EMAIL,
  REQUIRED_AUTHOR_NAME,
  evaluateCommitAuthorship,
  parseCommitLog,
  formatAuthorshipVerdict,
} from "../../src/lib/git/commit-authorship-core";

const ROOT = join(__dirname, "..", "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "compliance-tests.yml");
const VERIFIER = join(ROOT, "scripts", "compliance", "verify-commit-authorship.ts");
const CORE = join(ROOT, "src", "lib", "git", "commit-authorship-core.ts");
const SELFTESTS = join(ROOT, "scripts", "compliance", "run-pure-selftests.ts");

function workflowText(): string {
  return readFileSync(WORKFLOW, "utf8");
}

/** Extract the `compliance:` job block, up to the next top-level job key. */
function complianceJob(): string {
  const text = workflowText();
  const start = text.indexOf("\n  compliance:");
  expect(start, "the compliance job must exist").toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const next = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the commit authorship check is wired into CI", () => {
  it("the verifier script exists", () => {
    expect(existsSync(VERIFIER)).toBe(true);
  });

  it("the pure core it depends on exists", () => {
    expect(existsSync(CORE)).toBe(true);
  });

  it("CI invokes the verifier", () => {
    expect(workflowText()).toContain(
      "npx tsx scripts/compliance/verify-commit-authorship.ts",
    );
  });

  it("the verifier runs inside the compliance job, where it can fail a PR", () => {
    expect(complianceJob()).toContain(
      "npx tsx scripts/compliance/verify-commit-authorship.ts",
    );
  });

  it("the step is named, so a reader of a red X knows what broke", () => {
    expect(complianceJob()).toContain(
      "Commit authorship (the Vercel deployment precondition)",
    );
  });

  it("the compliance job checks out full history, or the check sees one commit", () => {
    // A shallow checkout has no merge base, so the verifier degrades to
    // inspecting HEAD alone. That is honest but much weaker, and the weakening
    // would be invisible. Pin the depth that makes the range check possible.
    expect(complianceJob()).toMatch(/fetch-depth:\s*0/);
  });

  it("the workflow still runs on pull_request, where blocking is useful", () => {
    expect(workflowText()).toMatch(/on:\s*\n\s*pull_request:/);
  });

  it("the pure self-tests are registered with the self-test runner", () => {
    const text = readFileSync(SELFTESTS, "utf8");
    expect(text).toContain("__runCommitAuthorshipTests");
    expect(text).toContain("src/lib/git/commit-authorship-core");
  });
});

describe("the required identity is the one that actually deploys", () => {
  it("pins the email verified on the GitHub account holding Vercel access", () => {
    // Hard-coded deliberately. If someone changes the constant, this fails and
    // forces them to confirm the new address really is on the Vercel team.
    expect(REQUIRED_AUTHOR_EMAIL).toBe("dev@greenwaymarijuana.com");
  });

  it("pins the display name used by every deploying commit", () => {
    expect(REQUIRED_AUTHOR_NAME).toBe("Greenway Dev");
  });
});

describe("the check would have caught the real failure", () => {
  const good = {
    sha: "3d25026",
    subject: "Slice 12: Socket Mobile S720 scanner",
    authorName: "Greenway Dev",
    authorEmail: "dev@greenwaymarijuana.com",
    committerName: "Greenway Dev",
    committerEmail: "dev@greenwaymarijuana.com",
  };

  it("passes the commit Vercel deployed (3d25026)", () => {
    expect(evaluateCommitAuthorship([good]).ok).toBe(true);
  });

  it("fails the commit Vercel blocked (10eb1a6)", () => {
    const verdict = evaluateCommitAuthorship([
      {
        ...good,
        sha: "10eb1a6",
        subject: "Slice 13",
        authorName: "SuperNinja",
        authorEmail: "superninja@ninjatech.ai",
        committerName: "SuperNinja",
        committerEmail: "superninja@ninjatech.ai",
      },
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations[0]?.kind).toBe("author-email-mismatch");
  });

  it("fails the hostname identity git invents when user.email is unset", () => {
    const verdict = evaluateCommitAuthorship([
      { ...good, authorName: "root", authorEmail: "root@172.16.236.161" },
    ]);
    expect(verdict.ok).toBe(false);
    // The message must explain the mechanism. "root@172.16.236.161 is wrong"
    // invites someone to retype it; explaining that git synthesised it points
    // at the actual repair, which is configuring the identity.
    expect(verdict.violations[0]?.message).toContain("auto-generated");
  });

  it("does not fire on GitHub's own squash-merge committer", () => {
    // Squash merges are the standing merge protocol. If the guard tripped on
    // noreply@github.com it would block every legitimate merge and be disabled
    // within a week.
    const verdict = evaluateCommitAuthorship([
      { ...good, committerName: "GitHub", committerEmail: "noreply@github.com" },
    ]);
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings).toHaveLength(0);
  });

  it("reports every offender in a batch, not merely the first", () => {
    const bad = { ...good, authorEmail: "superninja@ninjatech.ai" };
    const worse = { ...good, authorEmail: "root@172.16.236.161" };
    const verdict = evaluateCommitAuthorship([good, bad, worse]);
    expect(verdict.checked).toBe(3);
    expect(verdict.violations).toHaveLength(2);
  });

  it("tells the reader how to repair it", () => {
    const text = formatAuthorshipVerdict(
      evaluateCommitAuthorship([
        { ...good, authorEmail: "superninja@ninjatech.ai" },
      ]),
    );
    expect(text).toContain("git config user.email");
    expect(text).toContain(REQUIRED_AUTHOR_EMAIL);
  });

  it("parses real git log output including em dashes in subjects", () => {
    // Subjects in this repository contain literal em dashes. A parser that
    // splits on anything punctuation-like would corrupt them, so the format
    // uses ASCII unit/record separators instead.
    const raw =
      "abc1234\u001fSLICE 18E \u2014 classification provenance\u001f" +
      "Greenway Dev\u001fdev@greenwaymarijuana.com\u001f" +
      "Greenway Dev\u001fdev@greenwaymarijuana.com\u001e\n";
    const parsed = parseCommitLog(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.subject).toBe(
      "SLICE 18E \u2014 classification provenance",
    );
    expect(evaluateCommitAuthorship(parsed).ok).toBe(true);
  });
});
