/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  THE COMMIT AUTHOR EMAIL IS A DEPLOYMENT PRECONDITION, NOT A COSMETIC DETAIL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Slice 13 merged green and Vercel never built it. The dashboard did not say
 * "failed" — it said BLOCKED, with no build logs at all, which is a different
 * failure class: the build never started, so there was nothing to log.
 *
 * The cause was the commit author email, and the evidence is exact:
 *
 *   commit    author email                  GitHub account   Vercel
 *   3d25026   dev@greenwaymarijuana.com     mblyman89        deployed
 *   10eb1a6   superninja@ninjatech.ai       (none)           BLOCKED
 *
 * Vercel's own troubleshooting documentation, under "Build Logs not available",
 * lists the preconditions that make a deployment fail without producing logs.
 * One of them is, in Vercel's words, that commits were made from a contributor
 * that is not a team member. Vercel identifies the contributor by resolving the
 * git author email to a GitHub account and then checking that account against
 * the Vercel team. An email that belongs to NO GitHub account cannot resolve to
 * a team member, so the deployment is refused before a container is allocated.
 *
 * `dev@greenwaymarijuana.com` is a verified email on the GitHub account
 * `mblyman89` — the repository owner and the Vercel team member. That is why 47
 * consecutive commits deployed and the one commit that used a different address
 * did not. The GitHub API confirms the resolution directly: for 3d25026 the
 * commit's `author.login` is `mblyman89`, and for 10eb1a6 `author` is null.
 *
 * ═══ WHY THIS IS A MODULE AND NOT A HABIT ═══
 *
 * The regression happened because `git config user.email` was EMPTY in the
 * build sandbox. Git does not fail when the identity is unset; it silently
 * synthesises one from the machine, producing addresses like `root@172.16.x.x`.
 * Nothing in the pipeline looked at it. A green PR and a blocked deployment
 * look identical from inside CI, which is precisely why this needs a mechanical
 * check rather than a rule someone remembers.
 *
 * This module is PURE: it takes commit records and a policy and returns a
 * verdict. It performs no git calls and no I/O, so it is testable in isolation.
 * `scripts/compliance/verify-commit-authorship.ts` supplies the real commits.
 *
 * WHAT THIS DOES NOT DO, stated plainly rather than implied (rule 40): it does
 * not verify that the email is registered with GitHub or with Vercel. It cannot
 * — that is a live network fact. It verifies that every commit uses the exact
 * address that is KNOWN to deploy, which is the property that actually broke.
 */

/** The address that is verified on the GitHub account holding Vercel access. */
export const REQUIRED_AUTHOR_EMAIL = "dev@greenwaymarijuana.com";

/** The display name paired with that address on every deploying commit. */
export const REQUIRED_AUTHOR_NAME = "Greenway Dev";

/** One commit, reduced to only the fields that decide deployability. */
export interface CommitIdentity {
  /** Abbreviated or full SHA. Used only for reporting. */
  readonly sha: string;
  /** Subject line. Used only for reporting. */
  readonly subject: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly committerName: string;
  readonly committerEmail: string;
  /**
   * Number of parents. Two or more means a merge commit.
   *
   * This matters because of a real false positive this check produced on its
   * own first CI run. On a `pull_request` event GitHub does not check out the
   * branch; it checks out a SYNTHETIC MERGE COMMIT of the branch into the base,
   * at refs/pull/<n>/merge, and it authors that commit itself:
   *
   *   61ca7cf  parents 10eb1a6 + 5b77837
   *            author  223766961+superninja-app[bot]@users.noreply.github.com
   *            subject "Merge 5b78375... into 10eb1a6d..."
   *
   * That commit exists on ZERO branches (the branches-where-head API returns an
   * empty list), is discarded when the PR is merged, and is never the commit
   * Vercel builds. Failing a PR because of it would be failing on an artefact
   * of the CI runner, which would make the check useless noise.
   *
   * Merge commits made by the squash-merge protocol do not reach main either -
   * a squash merge produces a single-parent commit. So skipping multi-parent
   * commits costs no real coverage.
   */
  readonly parentCount: number;
}

export interface AuthorshipPolicy {
  readonly requiredEmail: string;
  readonly requiredName: string;
  /**
   * Committer identity is checked too, but separately. GitHub itself rewrites
   * the committer on some merge paths (`noreply@github.com`), so a committer
   * mismatch is reported as a WARNING and never fails the gate. Vercel keys on
   * the AUTHOR, and that is what is enforced.
   */
  readonly allowedCommitterEmails: readonly string[];
}

export const DEFAULT_AUTHORSHIP_POLICY: AuthorshipPolicy = {
  requiredEmail: REQUIRED_AUTHOR_EMAIL,
  requiredName: REQUIRED_AUTHOR_NAME,
  allowedCommitterEmails: [REQUIRED_AUTHOR_EMAIL, "noreply@github.com"],
};

export type ViolationKind =
  | "author-email-mismatch"
  | "author-name-mismatch"
  | "author-email-empty";

export interface AuthorshipViolation {
  readonly sha: string;
  readonly subject: string;
  readonly kind: ViolationKind;
  readonly found: string;
  readonly expected: string;
  /** Plain-language explanation aimed at whoever has to fix it. */
  readonly message: string;
}

export interface AuthorshipWarning {
  readonly sha: string;
  readonly message: string;
}

export interface AuthorshipVerdict {
  readonly ok: boolean;
  readonly checked: number;
  /**
   * Merge commits that were deliberately not checked. Reported rather than
   * hidden, so "checked 4" and "skipped 1" always account for every commit and
   * nobody has to wonder whether something was silently ignored.
   */
  readonly skippedMerges: number;
  readonly violations: readonly AuthorshipViolation[];
  readonly warnings: readonly AuthorshipWarning[];
}

/**
 * Git synthesises an identity when none is configured. Those addresses look
 * like `root@172.16.236.161` or `runner@fv-az123`. They are not typos, so the
 * error message must explain the mechanism, not just the mismatch.
 */
function looksAutoGenerated(email: string): boolean {
  return /@(?:\d{1,3}\.){3}\d{1,3}$/.test(email) || /\.\(none\)$/.test(email);
}

function explain(found: string, expected: string): string {
  if (found.trim() === "") {
    return (
      "the author email is EMPTY. Git had no configured identity. " +
      `Run: git config user.email "${expected}"`
    );
  }
  if (looksAutoGenerated(found)) {
    return (
      `the author email "${found}" was auto-generated by git from the machine ` +
      "hostname because user.email was never set. It belongs to no GitHub " +
      "account, so Vercel cannot resolve it to a team member and will refuse " +
      `the deployment before any build starts. Run: git config user.email "${expected}"`
    );
  }
  return (
    `the author email "${found}" is not "${expected}". Only the required ` +
    "address is verified on the GitHub account that holds Vercel access. Any " +
    "other address makes Vercel mark the deployment BLOCKED with no build logs."
  );
}

/**
 * Evaluate a set of commits against the authorship policy. Pure.
 */
export function evaluateCommitAuthorship(
  commits: readonly CommitIdentity[],
  policy: AuthorshipPolicy = DEFAULT_AUTHORSHIP_POLICY,
): AuthorshipVerdict {
  const violations: AuthorshipViolation[] = [];
  const warnings: AuthorshipWarning[] = [];
  let skippedMerges = 0;
  let checked = 0;

  for (const c of commits) {
    // See CommitIdentity.parentCount: on a pull_request event the checked-out
    // HEAD is a synthetic merge commit that GitHub authors and then throws
    // away. It is never built by Vercel, so judging it would be a false alarm.
    if (c.parentCount >= 2) {
      skippedMerges += 1;
      continue;
    }
    checked += 1;

    const email = c.authorEmail.trim();

    if (email === "") {
      violations.push({
        sha: c.sha,
        subject: c.subject,
        kind: "author-email-empty",
        found: "",
        expected: policy.requiredEmail,
        message: explain("", policy.requiredEmail),
      });
    } else if (email.toLowerCase() !== policy.requiredEmail.toLowerCase()) {
      violations.push({
        sha: c.sha,
        subject: c.subject,
        kind: "author-email-mismatch",
        found: email,
        expected: policy.requiredEmail,
        message: explain(email, policy.requiredEmail),
      });
    } else if (c.authorName.trim() !== policy.requiredName) {
      // The email is right, so the deployment will not be blocked. The name is
      // still pinned so history stays uniform; this is a real violation but a
      // cosmetic one, and the message says so rather than implying urgency.
      violations.push({
        sha: c.sha,
        subject: c.subject,
        kind: "author-name-mismatch",
        found: c.authorName.trim(),
        expected: policy.requiredName,
        message:
          `the author email is correct, so this commit WILL deploy, but the ` +
          `author name "${c.authorName.trim()}" is not "${policy.requiredName}". ` +
          `Run: git config user.name "${policy.requiredName}"`,
      });
    }

    const committer = c.committerEmail.trim().toLowerCase();
    const allowed = policy.allowedCommitterEmails.map((e) => e.toLowerCase());
    if (committer !== "" && !allowed.includes(committer)) {
      warnings.push({
        sha: c.sha,
        message:
          `committer email "${c.committerEmail.trim()}" is outside the allowed ` +
          "set. This does not block a deployment (Vercel keys on the author), " +
          "so it is reported and not enforced.",
      });
    }
  }

  return {
    ok: violations.length === 0,
    checked,
    skippedMerges,
    violations,
    warnings,
  };
}

/** Render a verdict for a terminal. Pure. */
export function formatAuthorshipVerdict(verdict: AuthorshipVerdict): string {
  const lines: string[] = [];

  const skipNote =
    verdict.skippedMerges > 0
      ? ` (${verdict.skippedMerges} merge commit(s) skipped: GitHub authors the` +
        " synthetic pull_request merge commit itself and it never reaches main)"
      : "";

  if (verdict.ok) {
    lines.push(
      `OK: all ${verdict.checked} commit(s) are authored ` +
        `${REQUIRED_AUTHOR_NAME} <${REQUIRED_AUTHOR_EMAIL}>.${skipNote}`,
    );
  } else {
    lines.push(
      `COMMIT AUTHORSHIP CHECK FAILED: ${verdict.violations.length} of ` +
        `${verdict.checked} commit(s) would block the Vercel deployment.`,
    );
    lines.push("");
    for (const v of verdict.violations) {
      lines.push(`  ${v.sha}  ${v.subject}`);
      lines.push(`      ${v.message}`);
      lines.push("");
    }
    lines.push(
      "To repair commits that are already made, rewrite their identity without " +
        "touching their content:",
    );
    lines.push("");
    lines.push(`  git config user.name  "${REQUIRED_AUTHOR_NAME}"`);
    lines.push(`  git config user.email "${REQUIRED_AUTHOR_EMAIL}"`);
    lines.push(
      "  git filter-branch -f --env-filter '" +
        `export GIT_AUTHOR_NAME="${REQUIRED_AUTHOR_NAME}"; ` +
        `export GIT_AUTHOR_EMAIL="${REQUIRED_AUTHOR_EMAIL}"; ` +
        `export GIT_COMMITTER_NAME="${REQUIRED_AUTHOR_NAME}"; ` +
        `export GIT_COMMITTER_EMAIL="${REQUIRED_AUTHOR_EMAIL}"` +
        "' -- origin/main..HEAD",
    );
  }

  for (const w of verdict.warnings) {
    lines.push(`  warning ${w.sha}: ${w.message}`);
  }

  return lines.join("\n");
}

/**
 * Parse the output of:
 *   git log --format='%H%x1f%s%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%P%x1e' <range>
 *
 * Unit separator (0x1f) between fields and record separator (0x1e) between
 * commits, because subjects legitimately contain every printable character
 * including the em dashes this repository uses in prose.
 *
 * %P is the space-separated parent list, which is how a merge commit is
 * identified. A record without it is treated as single-parent, so an older
 * format string degrades to checking everything rather than skipping it.
 * Pure.
 */
export function parseCommitLog(raw: string): CommitIdentity[] {
  const out: CommitIdentity[] = [];
  for (const record of raw.split("\u001e")) {
    const trimmed = record.replace(/^[\r\n]+/, "");
    if (trimmed.trim() === "") continue;
    const f = trimmed.split("\u001f");
    if (f.length < 6) continue;

    const parents = (f[6] ?? "").trim();
    const parentCount = parents === "" ? 1 : parents.split(/\s+/).length;

    out.push({
      sha: (f[0] ?? "").trim(),
      subject: f[1] ?? "",
      authorName: f[2] ?? "",
      authorEmail: f[3] ?? "",
      committerName: f[4] ?? "",
      committerEmail: f[5] ?? "",
      parentCount,
    });
  }
  return out;
}

/* ───────────────────────────── self-tests ───────────────────────────── */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`commit-authorship-core: ${msg}`);
}

export function __runCommitAuthorshipTests(): void {
  const good: CommitIdentity = {
    sha: "3d25026",
    subject: "Slice 12: Socket Mobile S720 scanner",
    authorName: REQUIRED_AUTHOR_NAME,
    authorEmail: REQUIRED_AUTHOR_EMAIL,
    committerName: REQUIRED_AUTHOR_NAME,
    committerEmail: REQUIRED_AUTHOR_EMAIL,
    parentCount: 1,
  };

  // 1. The known-good commit passes.
  const v1 = evaluateCommitAuthorship([good]);
  assert(v1.ok, "the known-good commit 3d25026 must pass");
  assert(v1.checked === 1, "checked count must be 1");

  // 2. The real commit that Vercel blocked must fail.
  const blocked: CommitIdentity = {
    ...good,
    sha: "10eb1a6",
    subject: "Slice 13",
    authorName: "SuperNinja",
    authorEmail: "superninja@ninjatech.ai",
    committerName: "SuperNinja",
    committerEmail: "superninja@ninjatech.ai",
  };
  const v2 = evaluateCommitAuthorship([blocked]);
  assert(!v2.ok, "10eb1a6 (superninja@ninjatech.ai) must FAIL the gate");
  assert(
    v2.violations[0]?.kind === "author-email-mismatch",
    "must be reported as an email mismatch",
  );

  // 3. The auto-generated identity must fail AND explain the mechanism.
  const auto: CommitIdentity = {
    ...good,
    sha: "81761e9",
    authorName: "root",
    authorEmail: "root@172.16.236.161",
    committerName: "root",
    committerEmail: "root@172.16.236.161",
  };
  const v3 = evaluateCommitAuthorship([auto]);
  assert(!v3.ok, "root@172.16.236.161 must FAIL the gate");
  assert(
    (v3.violations[0]?.message ?? "").includes("auto-generated"),
    "the message must explain that git synthesised the address",
  );

  // 4. An empty email must fail with its own distinct explanation.
  const v4 = evaluateCommitAuthorship([{ ...good, authorEmail: "" }]);
  assert(!v4.ok, "an empty author email must FAIL");
  assert(
    v4.violations[0]?.kind === "author-email-empty",
    "an empty email must be its own violation kind",
  );

  // 5. Case differences in the email are accepted; git addresses are not
  //    case-sensitive in practice and GitHub resolves them identically.
  const v5 = evaluateCommitAuthorship([
    { ...good, authorEmail: "Dev@GreenwayMarijuana.com" },
  ]);
  assert(v5.ok, "email comparison must be case-insensitive");

  // 6. A wrong NAME with the right email is a violation, but the message must
  //    say the commit still deploys, so nobody panics about the wrong thing.
  const v6 = evaluateCommitAuthorship([{ ...good, authorName: "root" }]);
  assert(!v6.ok, "a wrong author name must be reported");
  assert(
    v6.violations[0]?.kind === "author-name-mismatch",
    "must be a name mismatch, not an email mismatch",
  );
  assert(
    (v6.violations[0]?.message ?? "").includes("WILL deploy"),
    "the name-mismatch message must state that the commit still deploys",
  );

  // 7. GitHub's own squash committer must NOT be treated as a problem.
  const v7 = evaluateCommitAuthorship([
    { ...good, committerName: "GitHub", committerEmail: "noreply@github.com" },
  ]);
  assert(v7.ok, "committer noreply@github.com must not fail the gate");
  assert(v7.warnings.length === 0, "and must not even warn");

  // 8. An unexpected committer warns but never fails.
  const v8 = evaluateCommitAuthorship([
    { ...good, committerEmail: "someone@else.example" },
  ]);
  assert(v8.ok, "an odd committer must not fail the gate");
  assert(v8.warnings.length === 1, "an odd committer must warn exactly once");

  // 9. Mixed batches report every offender, not just the first.
  const v9 = evaluateCommitAuthorship([good, blocked, auto, good]);
  assert(v9.checked === 4, "must check all four commits");
  assert(v9.violations.length === 2, "must report both offenders");

  // 10. The empty set is vacuously fine (a PR can contain zero new commits).
  assert(evaluateCommitAuthorship([]).ok, "an empty commit list must pass");

  // 11. parseCommitLog round-trips a realistic record, INCLUDING an em dash and
  //     a subject containing the delimiterless punctuation this repo uses.
  const raw =
    `abc1234\u001fSLICE 18E \u2014 classification provenance\u001f` +
    `${REQUIRED_AUTHOR_NAME}\u001f${REQUIRED_AUTHOR_EMAIL}\u001f` +
    `${REQUIRED_AUTHOR_NAME}\u001f${REQUIRED_AUTHOR_EMAIL}\u001f0000001\u001e\n` +
    `def5678\u001fSlice 13\u001fSuperNinja\u001fsuperninja@ninjatech.ai\u001f` +
    `SuperNinja\u001fsuperninja@ninjatech.ai\u001f0000002\u001e\n`;
  const parsed = parseCommitLog(raw);
  assert(parsed.length === 2, "must parse exactly two commits");
  assert(
    parsed[0]?.subject === "SLICE 18E \u2014 classification provenance",
    "the em dash in a subject must survive parsing",
  );
  assert(
    parsed[1]?.authorEmail === "superninja@ninjatech.ai",
    "the second commit's author email must parse",
  );
  const verdict = evaluateCommitAuthorship(parsed);
  assert(!verdict.ok, "the parsed batch must fail because of the second commit");

  // 12. Trailing whitespace / stray newlines must not create phantom commits.
  assert(parseCommitLog("").length === 0, "empty log must parse to no commits");
  assert(parseCommitLog("\n\n").length === 0, "blank log must parse to none");

  // 13. The formatter must name the offending sha and the repair command.
  const text = formatAuthorshipVerdict(evaluateCommitAuthorship([blocked]));
  assert(text.includes("10eb1a6"), "the report must name the offending commit");
  assert(
    text.includes(REQUIRED_AUTHOR_EMAIL),
    "the report must state the required address",
  );
  assert(
    text.includes("git config user.email"),
    "the report must tell the reader how to fix it",
  );

  // 14. A passing verdict must read as a pass.
  assert(
    formatAuthorshipVerdict(evaluateCommitAuthorship([good])).startsWith("OK:"),
    "a clean verdict must render as OK",
  );

  // ─────────────────────────────────────────────────────────────────────────
  // 15-19. THE SYNTHETIC pull_request MERGE COMMIT.
  //
  // These cases exist because the check produced a false positive on its own
  // first CI run. On a pull_request event the runner checks out
  // refs/pull/<n>/merge - a merge commit GitHub creates and authors itself:
  //
  //   61ca7cf  parents 10eb1a6 + 5b77837
  //            author  223766961+superninja-app[bot]@users.noreply.github.com
  //
  // It exists on zero branches and is discarded on merge, so Vercel never
  // builds it. Failing a PR because of it would be failing on an artefact of
  // the CI runner rather than on anything that can reach production.
  // ─────────────────────────────────────────────────────────────────────────
  const syntheticMerge: CommitIdentity = {
    sha: "61ca7cf",
    subject: "Merge 5b78375 into 10eb1a6d",
    authorName: "superninja-app[bot]",
    authorEmail: "223766961+superninja-app[bot]@users.noreply.github.com",
    committerName: "GitHub",
    committerEmail: "noreply@github.com",
    parentCount: 2,
  };

  // 15. The exact commit that produced the false positive must now pass.
  const v15 = evaluateCommitAuthorship([syntheticMerge]);
  assert(v15.ok, "the synthetic pull_request merge commit must not fail the gate");
  assert(v15.skippedMerges === 1, "it must be counted as a skipped merge");
  assert(v15.checked === 0, "and must not be counted as checked");

  // 16. Skipping must be reported, never silent.
  assert(
    formatAuthorshipVerdict(v15).includes("skipped"),
    "the report must disclose that a merge commit was skipped",
  );

  // 17. Skipping a merge must NOT excuse a real offender beside it.
  const v17 = evaluateCommitAuthorship([syntheticMerge, blocked, good]);
  assert(!v17.ok, "a real offender must still fail when a merge is present");
  assert(v17.checked === 2, "two non-merge commits must be checked");
  assert(v17.skippedMerges === 1, "one merge must be skipped");

  // 18. An octopus merge (3+ parents) is still a merge.
  assert(
    evaluateCommitAuthorship([{ ...syntheticMerge, parentCount: 3 }]).ok,
    "a merge with three parents must also be skipped",
  );

  // 19. A ROOT commit has zero parents and must still be checked - skipping
  //     anything that is not >= 2 parents would create a real blind spot.
  const v19 = evaluateCommitAuthorship([
    { ...blocked, parentCount: 0 },
  ]);
  assert(!v19.ok, "a parentless root commit must still be checked");

  // 20. parseCommitLog must read %P and count parents from it.
  const mergeRaw =
    `61ca7cf\u001fMerge a into b\u001fsuperninja-app[bot]\u001f` +
    `223766961+superninja-app[bot]@users.noreply.github.com\u001f` +
    `GitHub\u001fnoreply@github.com\u001f10eb1a6 5b77837\u001e\n`;
  const mergeParsed = parseCommitLog(mergeRaw);
  assert(mergeParsed.length === 1, "the merge record must parse");
  assert(
    mergeParsed[0]?.parentCount === 2,
    "two space-separated parents must yield parentCount 2",
  );
  assert(
    evaluateCommitAuthorship(mergeParsed).ok,
    "a parsed synthetic merge commit must not fail the gate",
  );

  // 21. A single-parent record must parse as parentCount 1 and be checked.
  const singleRaw =
    `def5678\u001fSlice 13\u001fSuperNinja\u001fsuperninja@ninjatech.ai\u001f` +
    `SuperNinja\u001fsuperninja@ninjatech.ai\u001f10eb1a6\u001e\n`;
  const singleParsed = parseCommitLog(singleRaw);
  assert(
    singleParsed[0]?.parentCount === 1,
    "one parent must yield parentCount 1",
  );
  assert(
    !evaluateCommitAuthorship(singleParsed).ok,
    "a single-parent bad commit must still fail",
  );
}
