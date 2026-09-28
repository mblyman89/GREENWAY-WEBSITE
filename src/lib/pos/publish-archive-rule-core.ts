/**
 * src/lib/pos/publish-archive-rule-core.ts  (S15 - one archival rule)
 *
 * PURE. The single rule for "which staged menu updates are archived when a
 * menu goes live", shared by the database and the app so the two can never
 * drift apart again.
 *
 * WHY (bible S15, findings F-057, F-058, F-042)
 * Before S15 there were THREE rules and none covered both kinds of update:
 *   1. The RPC publish_menu_version (0002) archived other staged updates only
 *      when the published one came from a POS import, using
 *      `import_id <> v_import`. A receiving update has import_id NULL, and
 *      NULL <> x is NULL (never true), so the database never archived one.
 *   2. The Menu Imports publish button archived receiving updates OLDER than
 *      the one just published (archiveStaleIntakeDrafts, app code).
 *   3. The automatic publish after an approval archived receiving updates of
 *      ANY age, but never a POS import update (intake-menu-staging sweep).
 * So an unpublished Cultivera upload followed by an approval that published
 * itself left the Cultivera update on the Publish page forever with a red
 * "Outdated" chip - and publishing it would have removed every received
 * product.
 *
 * THE RULE (implemented identically in three places)
 *   After a publish of version P, every version that is
 *     status = 'staged'  AND  id <> P.id  AND  created_at < P.created_at
 *   is archived - any origin - and its summary_json gets
 *     archived_reason = "superseded_by_publish:<P.id>"
 *     archived_at     = publish time
 *   A non-object summary is kept under summary_before_archive; a null one
 *   becomes {} first. Staged versions created at or after P are left alone:
 *   they are newer snapshots, judged on the Publish page by what they contain
 *   (publish-guard-core flagDraftFreshness), never by age alone.
 *
 *   Place 1: supabase/migrations/0236_publish_archive_rule.sql (the RPC body)
 *   Place 2: archiveSupersededStaged in src/lib/pos/menu-version.ts, called
 *            after BOTH publish paths - it makes the rule true before the
 *            owner has applied 0236, and is a zero-write no-op after (the RPC
 *            already archived everything, so its select finds nothing).
 *   Place 3: this file - the planner Place 2 executes, and the simulator the
 *            self-tests use to replay the mixed sequences.
 *
 * No fs, no network, no Supabase, no clock (the caller passes the time).
 */

/** Prefix of summary_json.archived_reason. Matches 0236 byte for byte. */
export const ARCHIVED_REASON_PREFIX = "superseded_by_publish:";

/** summary_json.archived_reason for a version superseded by `publishedId`. */
export function supersededReason(publishedId: string): string {
  return ARCHIVED_REASON_PREFIX + publishedId;
}

/** The id named in an archived_reason, or null when the row was not superseded by a publish. */
export function supersededBy(summary: unknown): string | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const reason = (summary as Record<string, unknown>).archived_reason;
  if (typeof reason !== "string" || !reason.startsWith(ARCHIVED_REASON_PREFIX)) return null;
  const id = reason.slice(ARCHIVED_REASON_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * The summary_json an archived row carries, exactly as 0236 builds it:
 *   case when null then {} when object then summary else {summary_before_archive: summary} end
 *   || {archived_reason, archived_at}
 */
export function mergeArchivedSummary(
  summary: unknown,
  publishedId: string,
  archivedAtIso: string,
): Record<string, unknown> {
  let base: Record<string, unknown>;
  // typeof null is "object", and spreading null gives {}, so a null summary
  // takes the object branch and ends up as just the reason, like SQL's
  // `when summary_json is null then '{}'`. No copy is needed: the return
  // spreads into a NEW object, so the caller's summary is never mutated
  // (self-tests pin both).
  if (typeof summary === "object" && !Array.isArray(summary)) base = summary as Record<string, unknown>;
  else if (summary === undefined) base = {};
  else base = { summary_before_archive: summary };
  return { ...base, archived_reason: supersededReason(publishedId), archived_at: archivedAtIso };
}

export type ArchiveCandidate = {
  id: string;
  status: string;
  created_at: string;
};

/**
 * Is `candidate` superseded by a publish of `published`? Strictly older only:
 * an equal timestamp is not provably older, so it is kept (0236 uses `<`).
 * Unparseable timestamps are never archived (never guess).
 */
export function isSuperseded(
  published: { id: string; created_at: string },
  candidate: ArchiveCandidate,
): boolean {
  if (candidate.status !== "staged") return false;
  if (candidate.id === published.id) return false;
  const p = Date.parse(published.created_at);
  const c = Date.parse(candidate.created_at);
  // Any comparison with NaN is false, so an unparseable time on either side
  // is never archived (never guess). No separate NaN branch is needed.
  return c < p;
}

/** Ids the rule archives after `published` goes live. Input order is kept. */
export function planSupersededArchive(
  published: { id: string; created_at: string },
  candidates: readonly ArchiveCandidate[],
): string[] {
  return candidates.filter((c) => isSuperseded(published, c)).map((c) => c.id);
}

// ---------------------------------------------------------------------------
// Simulator: replays the RPC + rule over an in-memory table
// ---------------------------------------------------------------------------

export type SimVersion = {
  id: string;
  origin: "receiving" | "pos-import";
  status: "staged" | "published" | "archived";
  created_at: string;
  summary_json?: unknown;
};

/**
 * One publish, as 0236 performs it: archive the live version, promote the
 * target, then archive every superseded staged version with its reason.
 * Throws PUBLISH_VERSION_NOT_FOUND on an unknown id WITHOUT changing anything
 * (0236 raises before its first update). Returns a new array.
 */
export function simulatePublish(
  table: readonly SimVersion[],
  targetId: string,
  atIso: string,
): SimVersion[] {
  const target = table.find((v) => v.id === targetId);
  if (!target) throw new Error(`PUBLISH_VERSION_NOT_FOUND: menu version ${targetId} does not exist`);
  return table.map((v) => {
    if (v.id === targetId) return { ...v, status: "published" as const };
    if (v.status === "published") return { ...v, status: "archived" as const };
    if (isSuperseded(target, v)) {
      return { ...v, status: "archived" as const, summary_json: mergeArchivedSummary(v.summary_json, targetId, atIso) };
    }
    return v;
  });
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern, registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runPublishArchiveRuleTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL publish-archive-rule-core: " + msg);
    passed += 1;
  };
  const AT = "2026-09-28T12:00:00.000Z";

  // Reason round-trip.
  ok(supersededReason("abc") === "superseded_by_publish:abc", "reason format matches 0236");
  ok(supersededBy({ archived_reason: "superseded_by_publish:abc" }) === "abc", "reason parses back");
  ok(supersededBy({ archived_reason: "superseded_by_publish:" }) === null, "empty id is not a reason");
  ok(supersededBy({ archived_reason: "manual" }) === null, "other reasons are not superseded");
  ok(supersededBy({ archived_reason: 7 }) === null, "non-string reason ignored");
  ok(supersededBy(null) === null && supersededBy(["x"]) === null && supersededBy("s") === null, "non-objects ignored");

  // Summary merge mirrors the SQL case expression.
  const fromNull = mergeArchivedSummary(null, "P", AT);
  ok(JSON.stringify(fromNull) === JSON.stringify({ archived_reason: "superseded_by_publish:P", archived_at: AT }),
    "null summary -> just the reason");
  ok(JSON.stringify(mergeArchivedSummary(undefined, "P", AT)) === JSON.stringify(fromNull), "undefined same as null");
  const fromObj = mergeArchivedSummary({ origin: "intake", manifest_id: "m" }, "P", AT);
  ok(fromObj.origin === "intake" && fromObj.manifest_id === "m", "object summary keeps its keys");
  ok(fromObj.archived_reason === "superseded_by_publish:P" && fromObj.archived_at === AT, "object summary gains the reason");
  const fromArr = mergeArchivedSummary(["legacy"], "P", AT);
  ok(Array.isArray(fromArr.summary_before_archive) && (fromArr.summary_before_archive as string[])[0] === "legacy",
    "array summary kept under summary_before_archive");
  ok(mergeArchivedSummary("text", "P", AT).summary_before_archive === "text", "scalar summary kept too");
  const overwrite = mergeArchivedSummary({ archived_reason: "old", archived_at: "old" }, "P", AT);
  ok(overwrite.archived_reason === "superseded_by_publish:P" && overwrite.archived_at === AT, "reason wins over stale keys (jsonb || is right-biased)");
  const input = { a: 1 };
  mergeArchivedSummary(input, "P", AT);
  ok(!("archived_reason" in input), "input summary is not mutated");
  ok(!("summary_before_archive" in mergeArchivedSummary(undefined, "P", AT)), "undefined is treated as no summary, not wrapped");
  ok(!("summary_before_archive" in mergeArchivedSummary(null, "P", AT)), "null is treated as no summary, not wrapped");
  ok(
    supersededBy(Object.assign([] as unknown[], { archived_reason: "superseded_by_publish:x" })) === null,
    "an array is never a summary, even one carrying the key",
  );

  // isSuperseded edges.
  const P = { id: "P", created_at: "2026-01-01T11:00:00Z" };
  ok(isSuperseded(P, { id: "A", status: "staged", created_at: "2026-01-01T10:00:00Z" }), "older staged -> superseded");
  ok(!isSuperseded(P, { id: "T", status: "staged", created_at: "2026-01-01T11:00:00Z" }), "same instant -> kept (strictly older only)");
  ok(!isSuperseded(P, { id: "C", status: "staged", created_at: "2026-01-01T13:00:00Z" }), "newer staged -> kept");
  ok(!isSuperseded(P, { id: "P", status: "staged", created_at: "2026-01-01T10:00:00Z" }), "the published id itself is never archived by the rule");
  ok(!isSuperseded(P, { id: "X", status: "archived", created_at: "2026-01-01T10:00:00Z" }), "already archived untouched");
  ok(!isSuperseded(P, { id: "L", status: "published", created_at: "2026-01-01T09:00:00Z" }), "live row is the swap's job, not the rule's");
  ok(!isSuperseded(P, { id: "G", status: "staged", created_at: "garbage" }), "unparseable candidate time -> kept (never guess)");
  ok(!isSuperseded({ id: "P", created_at: "nope" }, { id: "A", status: "staged", created_at: "2026-01-01T10:00:00Z" }),
    "unparseable published time -> nothing archived");
  ok(planSupersededArchive(P, [
    { id: "b", status: "staged", created_at: "2026-01-01T10:30:00Z" },
    { id: "c", status: "staged", created_at: "2026-01-01T12:00:00Z" },
    { id: "a", status: "staged", created_at: "2026-01-01T10:00:00Z" },
  ]).join(",") === "b,a", "plan keeps input order and filters newer");
  ok(planSupersededArchive(P, []).length === 0, "empty plan");

  // Mixed sequences (bible 6.3 / 6.5): the resulting statuses are asserted.
  // Sequence 1 - the owner's case: Cultivera upload staged, NOT published,
  // then a receiving approval that publishes itself.
  let t: SimVersion[] = [
    { id: "L", origin: "pos-import", status: "published", created_at: "2026-01-01T08:00:00Z" },
    { id: "CV", origin: "pos-import", status: "staged", created_at: "2026-01-01T09:00:00Z" },
    { id: "R1", origin: "receiving", status: "staged", created_at: "2026-01-01T10:00:00Z" },
  ];
  t = simulatePublish(t, "R1", AT);
  const st = (id: string) => t.find((v) => v.id === id)!;
  ok(st("R1").status === "published", "seq1: receiving update live");
  ok(st("L").status === "archived", "seq1: old live archived");
  ok(st("CV").status === "archived", "seq1: stale Cultivera upload archived (was left staged before S15)");
  ok(supersededBy(st("CV").summary_json) === "R1", "seq1: Cultivera row names the publish that superseded it");
  ok(supersededBy(st("L").summary_json) === null, "seq1: old live row is not marked superseded");
  ok(t.filter((v) => v.status === "staged").length === 0, "seq1: zero staged rows left (S15 acceptance)");

  // Sequence 2 - a receiving draft held for review, then a Cultivera publish.
  t = [
    { id: "L", origin: "receiving", status: "published", created_at: "2026-01-01T08:00:00Z" },
    { id: "H", origin: "receiving", status: "staged", created_at: "2026-01-01T09:00:00Z", summary_json: { origin: "intake" } },
    { id: "CV", origin: "pos-import", status: "staged", created_at: "2026-01-01T10:00:00Z" },
  ];
  t = simulatePublish(t, "CV", AT);
  ok(st("H").status === "archived" && supersededBy(st("H").summary_json) === "CV", "seq2: older receiving draft archived by a POS publish");
  ok((st("H").summary_json as Record<string, unknown>).origin === "intake", "seq2: its summary keys survive");

  // Sequence 3 - publishing an OLDER draft keeps the NEWER one staged.
  t = [
    { id: "L", origin: "receiving", status: "published", created_at: "2026-01-01T08:00:00Z" },
    { id: "D1", origin: "receiving", status: "staged", created_at: "2026-01-01T09:00:00Z" },
    { id: "D2", origin: "pos-import", status: "staged", created_at: "2026-01-01T10:00:00Z" },
  ];
  t = simulatePublish(t, "D1", AT);
  ok(st("D2").status === "staged", "seq3: newer draft survives an older publish");
  t = simulatePublish(t, "D2", AT);
  ok(st("D1").status === "archived" && st("D2").status === "published", "seq3: then publishing the newer one swaps cleanly");
  ok(supersededBy(st("D1").summary_json) === null, "seq3: a formerly live row is archived by the swap, not marked superseded");
  ok(t.filter((v) => v.status === "published").length === 1, "seq3: exactly one live version");

  // Sequence 4 - unknown id changes nothing.
  const before = JSON.stringify(t);
  let threw = false;
  try {
    simulatePublish(t, "nope", AT);
  } catch (e) {
    threw = e instanceof Error && e.message.startsWith("PUBLISH_VERSION_NOT_FOUND:");
  }
  ok(threw, "seq4: unknown id raises PUBLISH_VERSION_NOT_FOUND");
  ok(JSON.stringify(t) === before, "seq4: table untouched");

  // Sequence 5 - re-publishing the live id is harmless and idempotent.
  const again = simulatePublish(t, "D2", AT);
  ok(JSON.stringify(again) === JSON.stringify(t), "seq5: republishing the live version changes nothing");

  return { passed };
}
