# SLICE 3 — the customer-facing menu (+ Vercel authorship fix)

Working scratchpad for this slice only. `todo.md` is Michael's standing
bookkeeping document and was NOT touched.

## 0. Commit authorship (Michael: "use dev@greenwaymarijuana.com")
- [x] Set git user.email/user.name to dev@greenwaymarijuana.com
- [x] Found the REAL cause. The local identity was already correct ON THE
      COMMIT. The problem is that `gh pr merge --squash` asks GitHub to build
      a NEW squash commit server-side, and GitHub authors that commit as the
      PR author — this agent authenticates as a GitHub App installation, so
      it landed as `superninja-app[bot]`. Verified via the GitHub API:
      a5266ac9 and 12f5a23e both show
      `commit.author.email = ...superninja-app[bot]@users.noreply.github.com`,
      while every hand-made commit before them is dev@greenwaymarijuana.com.
- [x] PROVED the fix empirically: pushed a probe commit to a real branch and
      read it back through the API —
      `author_email = dev@greenwaymarijuana.com`,
      `committer_email = dev@greenwaymarijuana.com`.
      A PUSHED commit keeps the identity; only the server-side squash rewrites
      it. So this slice merges with a fast-forward push, not an API squash.
- [x] Probe branch deleted afterwards.

## 1. Verify the reported symptom (Rules 1/5 — facts, not memory)
- [x] Traced the ACTUAL customer path: /menu -> loadLiveMenuItems()
      -> loadLiveMenuAll() -> getPublishedVersion() + getVersionItems()
- [x] getVersionItems had NO pagination at all (not even a `.limit`), so
      PostgREST silently returned at most 1,000 items
- [x] Found a SECOND, subtler bug: the variant read chunked 200 item ids but
      never paged WITHIN a chunk, so 200 items x ~8 sizes = 1,600 variants
      collapsed to 1,000 and products lost sizes/prices
- [x] Swept the whole render path and found 4 more "chunk but never page"
      reads that decorate the card: brand identity, images, category
      overrides, strain/terpene index
- [x] Found the commit gate reading TRUNCATED evidence (`limit: 5000`)
- [x] CONCLUSION on "nothing shows up": the cap explains a menu that stops at
      1,000 products, NOT an empty one. An empty menu means no `published`
      menu_version exists (import stages; publishing is a separate step).
      Reported to Michael rather than guessed at.

## 2. Build
- [x] getVersionItems: items via pagedAll, variants via chunkedIn, both with
      a stable `.order()` + `id` tiebreaker
- [x] Both reads now FAIL CLOSED — a partial read is never served as a whole
      menu (the old code did `continue` and served partial prices)
- [x] versionItemIndex paged (a capped diff invents "removed" products)
- [x] getImportDiagnostics paged; explicit `limit` still honoured for display
- [x] import-service: commit gate no longer passes `limit: 5000`
- [x] card-identity, image-resolver, classification overrides, listKbStrains

## 3. Gates
- [x] pure self-tests: PASS
- [x] tsc --noEmit: 0 errors
- [x] eslint: 0 errors (14 pre-existing warnings, none in touched files)
- [x] vitest: 511 files / 12,977 tests pass (was 12,952 + 25 new)
- [x] Guardrails proven NON-VACUOUS: reintroduced both the commit-gate cap and
      the unpaged variant read, watched each fail, restored and re-verified
- [x] Behavioural tests prove 4,179 rows survive a 1,000-row server cap, and
      that the OLD code really did short-change 75 of 200 products

## 4. Ship
- [x] Branch, PR
- [x] Merge preserving dev@greenwaymarijuana.com (fast-forward push)
- [x] Owner deliverable
