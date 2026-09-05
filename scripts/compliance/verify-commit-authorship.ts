/**
 * scripts/compliance/verify-commit-authorship.ts
 *
 * Fails the build when a commit is authored by an address that Vercel cannot
 * resolve to a team member. See src/lib/git/commit-authorship-core.ts for the
 * evidence; the short version is that Slice 13 merged green and Vercel marked
 * the deployment BLOCKED with no build logs, because its author email
 * (superninja@ninjatech.ai) belongs to no GitHub account.
 *
 * Run with:  npx tsx scripts/compliance/verify-commit-authorship.ts
 *
 * ═══ WHICH COMMITS ARE CHECKED ═══
 *
 * Only the commits a pull request ADDS. Rewriting history that already landed
 * on main is not something a CI check may do, and failing a PR for a commit
 * somebody else merged months ago would train everyone to ignore this gate.
 *
 * On GitHub Actions the checkout is shallow (fetch-depth 1 by default), so the
 * merge base is often not present. Rather than guess, this script DETECTS that
 * situation and says so, then checks whatever it can see. A check that cannot
 * see the commits reports SKIPPED loudly; it never reports a silent pass.
 */
import { execFileSync } from "node:child_process";
import {
  evaluateCommitAuthorship,
  formatAuthorshipVerdict,
  parseCommitLog,
  REQUIRED_AUTHOR_EMAIL,
  REQUIRED_AUTHOR_NAME,
  type CommitIdentity,
} from "../../src/lib/git/commit-authorship-core";

const LOG_FORMAT = "%H%x1f%s%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1e";

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function tryGit(args: readonly string[]): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

/**
 * Resolve the range of commits this branch adds. Returns null when the base is
 * genuinely unavailable (shallow clone with no merge base fetched).
 */
function resolveRange(): { range: string; how: string } | null {
  // On a pull_request event GitHub tells us the base branch by name.
  const baseRef = process.env["GITHUB_BASE_REF"];
  const candidates: Array<{ ref: string; how: string }> = [];

  if (baseRef && baseRef.trim() !== "") {
    candidates.push({
      ref: `origin/${baseRef.trim()}`,
      how: `GITHUB_BASE_REF=${baseRef.trim()}`,
    });
  }
  candidates.push({ ref: "origin/main", how: "origin/main" });
  candidates.push({ ref: "main", how: "local main" });

  for (const c of candidates) {
    if (tryGit(["rev-parse", "--verify", "--quiet", c.ref]) === null) continue;
    const base = tryGit(["merge-base", c.ref, "HEAD"]);
    if (base === null || base.trim() === "") continue;
    return { range: `${base.trim()}..HEAD`, how: c.how };
  }
  return null;
}

function main(): void {
  if (tryGit(["rev-parse", "--is-inside-work-tree"]) === null) {
    console.log(
      "commit-authorship: not a git work tree; nothing to check. Skipping.",
    );
    return;
  }

  const resolved = resolveRange();

  let commits: CommitIdentity[];
  let scope: string;

  if (resolved === null) {
    // Shallow clone, or a repository with no reachable base. Check HEAD alone
    // rather than pretending the check ran over a range it never saw.
    const raw = tryGit(["log", "-1", `--format=${LOG_FORMAT}`, "HEAD"]);
    if (raw === null) {
      console.log(
        "commit-authorship: could not read the git log. Skipping (loudly).",
      );
      return;
    }
    commits = parseCommitLog(raw);
    scope =
      "HEAD only - the merge base was not available (this is normal in a " +
      "shallow CI checkout; set fetch-depth: 0 to widen the check)";
  } else {
    const raw = git(["log", `--format=${LOG_FORMAT}`, resolved.range]);
    commits = parseCommitLog(raw);
    scope = `${resolved.range} (base resolved from ${resolved.how})`;
  }

  console.log(`commit-authorship: checking ${commits.length} commit(s)`);
  console.log(`commit-authorship: scope = ${scope}`);
  console.log(
    `commit-authorship: required = ${REQUIRED_AUTHOR_NAME} <${REQUIRED_AUTHOR_EMAIL}>`,
  );
  console.log("");

  if (commits.length === 0) {
    console.log("commit-authorship: no new commits to check. OK.");
    return;
  }

  const verdict = evaluateCommitAuthorship(commits);
  console.log(formatAuthorshipVerdict(verdict));

  if (!verdict.ok) {
    console.log("");
    console.log(
      "This is the check that would have caught the BLOCKED Vercel deployment " +
        "on Slice 13 before it was merged.",
    );
    process.exit(1);
  }
}

main();
