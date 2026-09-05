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

// %P (the parent list) is required: it is how a merge commit is recognised.
// On a pull_request event the checked-out HEAD is a synthetic merge commit that
// GitHub authors itself and then discards, and judging it would be a false
// alarm. See src/lib/git/commit-authorship-core.ts.
const LOG_FORMAT = "%H%x1f%s%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%P%x1e";

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

    // If that lone commit is the synthetic pull_request merge, inspecting it
    // and then skipping it would check nothing at all while reporting a pass.
    // Follow its second parent - the branch GitHub merged in - so there is
    // always something real under examination.
    if (commits.length === 1 && (commits[0]?.parentCount ?? 0) >= 2) {
      const second = (commits[0]?.sha ?? "") === "" ? undefined : "HEAD^2";
      if (second !== undefined) {
        const reRaw = tryGit(["log", "-1", `--format=${LOG_FORMAT}`, second]);
        const reCommits = reRaw === null ? [] : parseCommitLog(reRaw);
        if (reCommits.length > 0) {
          commits = reCommits;
          scope =
            "HEAD^2 only - HEAD was the synthetic pull_request merge commit " +
            "and no merge base was available, so the branch tip it merged in " +
            "was inspected instead. Skipping the merge alone would have " +
            "checked nothing.";
        }
      }
    }
  } else {
    // `--first-parent` is deliberately NOT used. On a pull_request event HEAD
    // is the synthetic merge commit, whose FIRST parent is the base branch, so
    // first-parent traversal would walk away from the branch entirely and see
    // nothing. Plain `base..HEAD` walks both sides and reaches the real branch
    // commits, which are the ones that decide whether Vercel will build.
    const raw = git(["log", `--format=${LOG_FORMAT}`, resolved.range]);
    commits = parseCommitLog(raw);
    scope = `${resolved.range} (base resolved from ${resolved.how})`;

    // ── The loophole this closes ──────────────────────────────────────────
    // When HEAD *is* the synthetic merge commit, `base..HEAD` can resolve to
    // that merge and nothing else - the branch commits are already reachable
    // from the base in the eyes of that range. Skipping the merge then leaves
    // ZERO commits checked and the run reports a cheerful pass, which is
    // exactly what a locally reproduced pull_request event showed:
    //
    //   1 commit(s) in range, 1 of them merge commit(s)
    //   OK: all 0 commit(s) are authored ...
    //
    // A bad branch commit sailed straight through. So when everything in range
    // is a merge, re-derive the range from the merge's SECOND parent, which is
    // the branch tip GitHub merged in.
    const allMerges =
      commits.length > 0 && commits.every((c) => c.parentCount >= 2);
    if (allMerges) {
      const parents = tryGit(["log", "-1", "--format=%P", "HEAD"]);
      const second = (parents ?? "").trim().split(/\s+/)[1];
      if (second !== undefined && second !== "") {
        const first = (parents ?? "").trim().split(/\s+/)[0] ?? "";
        const base = tryGit(["merge-base", first, second]);
        const from = base && base.trim() !== "" ? base.trim() : first;
        const reRaw = git(["log", `--format=${LOG_FORMAT}`, `${from}..${second}`]);
        const reCommits = parseCommitLog(reRaw);
        if (reCommits.length > 0) {
          commits = reCommits;
          scope =
            `${from.slice(0, 7)}..${second.slice(0, 7)} - HEAD was a merge ` +
            "commit with nothing else in range, so the range was re-derived " +
            "from its second parent (the branch GitHub merged in). Checking " +
            "only the merge would have checked nothing at all.";
        }
      }
    }
  }

  const merges = commits.filter((c) => c.parentCount >= 2).length;
  console.log(
    `commit-authorship: ${commits.length} commit(s) in range, ` +
      `${merges} of them merge commit(s)`,
  );
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
