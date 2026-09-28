/**
 * src/lib/pos/publish-queue-core.ts
 *
 * S16 - the Publish page as an exception queue (bible S16.2, F-056, F-062).
 *
 * Products you approve publish themselves (S00). So the Publish page is not
 * "the place you publish from" any more; it is the short list of updates that
 * need a person, each with ONE button that resolves it, plus a read-only list
 * of what went live by itself recently.
 *
 * This PURE module (no DB, no React, no server-only) decides, from rows the
 * page already loads (no new query):
 *
 *   - queueReason: WHY an update is waiting, from what was recorded on the
 *     row (summary_json.publish_outcome, written by S01) - never guessed.
 *   - primaryAction: the one button for that reason.
 *   - splitQueue: superseded rows (older than the live menu) are not work for
 *     a person - the S15 rule archives them on the next publish - so they are
 *     listed apart, without a button.
 *   - recentAutoPublished: the last N updates that went live by themselves.
 *
 * Self-tests at the bottom follow the house `__runXxxTests()` pattern and are
 * registered in scripts/compliance/run-pure-selftests.ts.
 */

import { parseIntakeSummary } from "@/lib/pos/intake-version-copy-core";

/**
 * Why an update waits for a person.
 *   fact_review    receiving update held because a product fact needs a
 *                  second look (publish_outcome = held_for_fact_review).
 *   publish_failed receiving update whose automatic publish did not finish
 *                  (auto_publish_failed, or auto_publish_attempted but still
 *                  staged - started, never confirmed).
 *   needs_publish  receiving update with no recorded outcome (staged before
 *                  S01 recorded one). Say only what is certain.
 *   pos_upload     a POS export upload (Cultivera). These never publish by
 *                  themselves.
 */
export type QueueReason = "fact_review" | "publish_failed" | "needs_publish" | "pos_upload";

export type QueueRowInput = {
  import_id: string | null;
  summary_json: unknown;
};

export function queueReason(v: QueueRowInput): QueueReason {
  if (v.import_id !== null) return "pos_upload";
  const state = parseIntakeSummary(v.summary_json).outcome?.state ?? null;
  if (state === "held_for_fact_review") return "fact_review";
  if (state === "auto_publish_failed" || state === "auto_publish_attempted") return "publish_failed";
  return "needs_publish";
}

/** The label of the one button each reason gets. */
export const QUEUE_ACTION_LABEL: Record<QueueReason, string> = {
  fact_review: "Check the flagged facts \u2192",
  publish_failed: "Try publishing again \u2192",
  needs_publish: "Review & publish \u2192",
  pos_upload: "Review this upload \u2192",
};

/** A short tag naming the reason, shown next to the row. */
export const QUEUE_REASON_TAG: Record<QueueReason, string> = {
  fact_review: "Fact check",
  publish_failed: "Publish didn't finish",
  needs_publish: "Needs a Publish click",
  pos_upload: "POS upload",
};

/**
 * The one primary action for a waiting row. Every reason resolves on the
 * row's review page: it shows the flagged facts with fix-it links (S02) and
 * the Publish button with its removal guard.
 */
export function primaryAction(reason: QueueReason, reviewHref: string): { label: string; href: string } {
  return { label: QUEUE_ACTION_LABEL[reason], href: reviewHref };
}

/**
 * Waiting rows vs rows the S15 rule will archive on the next publish. Input
 * order is kept in both lists.
 */
export function splitQueue<T extends { freshness: string }>(
  rows: readonly T[],
): { waiting: T[]; superseded: T[] } {
  const waiting: T[] = [];
  const superseded: T[] = [];
  for (const r of rows) (r.freshness === "superseded" ? superseded : waiting).push(r);
  return { waiting, superseded };
}

/**
 * The calm sentence shown when nothing waits. Bible 6.6 (F-075): the Publish
 * page and Menu Imports must use the SAME string, so both render this one.
 * Moved verbatim from menu-imports/page.tsx (it rendered "&mdash;").
 */
export const QUEUE_EMPTY_COPY =
  "Nothing waiting \u2014 every menu update from receiving has published automatically.";

/** How many "Recently published automatically" rows the page shows (bible S16.2). */
export const RECENT_AUTO_MAX = 10;

export type RecentInput = {
  id: string;
  import_id: string | null;
  published_at: string | null;
  summary_json: unknown;
};

/**
 * Updates that went live BY THEMSELVES, newest first: receiving updates whose
 * recorded outcome is auto_publish_attempted AND that really were published
 * (published_at set - live now or archived since). A held update someone
 * published by hand is not "automatic" and is left out. Unparseable
 * published_at is left out (never guess an order).
 */
export function recentAutoPublished<T extends RecentInput>(versions: readonly T[], max = RECENT_AUTO_MAX): T[] {
  return versions
    .filter((v) => v.import_id === null && typeof v.published_at === "string" && !Number.isNaN(Date.parse(v.published_at)))
    .filter((v) => parseIntakeSummary(v.summary_json).outcome?.state === "auto_publish_attempted")
    .sort((a, b) => Date.parse(b.published_at as string) - Date.parse(a.published_at as string) || (a.id < b.id ? -1 : 1))
    .slice(0, Math.max(0, max));
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runPublishQueueTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL publish-queue-core: " + msg);
    passed += 1;
  };
  const out = (state: string, extra: Record<string, unknown> = {}) => ({
    publish_outcome: { state, at: "2026-01-01T00:00:00Z", ...extra },
  });

  // queueReason: recorded outcome only.
  ok(queueReason({ import_id: "imp", summary_json: out("held_for_fact_review") }) === "pos_upload", "an import row is a POS upload whatever its summary says");
  ok(queueReason({ import_id: null, summary_json: out("held_for_fact_review", { held_count: 2 }) }) === "fact_review", "held -> fact_review");
  ok(queueReason({ import_id: null, summary_json: out("auto_publish_failed", { error: "x" }) }) === "publish_failed", "failed -> publish_failed");
  ok(queueReason({ import_id: null, summary_json: out("auto_publish_attempted") }) === "publish_failed", "attempted but still staged -> publish_failed");
  ok(queueReason({ import_id: null, summary_json: null }) === "needs_publish", "no summary -> needs_publish");
  ok(queueReason({ import_id: null, summary_json: out("made_up_state") }) === "needs_publish", "unknown state is not trusted");
  ok(queueReason({ import_id: null, summary_json: ["legacy"] }) === "needs_publish", "array summary -> needs_publish");

  // One action per reason, all distinct, all pointing at the review page.
  const reasons: QueueReason[] = ["fact_review", "publish_failed", "needs_publish", "pos_upload"];
  ok(new Set(reasons.map((r) => QUEUE_ACTION_LABEL[r])).size === 4, "four distinct button labels");
  ok(new Set(reasons.map((r) => QUEUE_REASON_TAG[r])).size === 4, "four distinct tags");
  ok(reasons.every((r) => primaryAction(r, "/x").href === "/x"), "the action goes to the row's review page");
  ok(primaryAction("fact_review", "/v").label === "Check the flagged facts \u2192", "fact button copy");
  ok(primaryAction("publish_failed", "/v").label === "Try publishing again \u2192", "failed button copy");
  ok(reasons.every((r) => !/REMOVE|WHOLE|REPLACE/.test(QUEUE_ACTION_LABEL[r] + QUEUE_REASON_TAG[r])), "no alarm words");

  // splitQueue keeps order.
  const sq = splitQueue([
    { id: "a", freshness: "latest" },
    { id: "b", freshness: "superseded" },
    { id: "c", freshness: "unknown" },
    { id: "d", freshness: "superseded" },
  ]);
  ok(sq.waiting.map((r) => r.id).join() === "a,c", "waiting keeps order and excludes superseded");
  ok(sq.superseded.map((r) => r.id).join() === "b,d", "superseded kept apart, in order");
  ok(splitQueue([]).waiting.length === 0, "empty in, empty out");
  ok(QUEUE_EMPTY_COPY === "Nothing waiting \u2014 every menu update from receiving has published automatically.", "empty-queue copy is the Menu Imports sentence verbatim");

  // recentAutoPublished.
  const v = (id: string, published_at: string | null, state: string | null, import_id: string | null = null) => ({
    id,
    import_id,
    published_at,
    summary_json: state ? out(state) : {},
  });
  const recent = recentAutoPublished([
    v("old", "2026-01-01T10:00:00Z", "auto_publish_attempted"),
    v("new", "2026-01-03T10:00:00Z", "auto_publish_attempted"),
    v("mid", "2026-01-02T10:00:00Z", "auto_publish_attempted"),
    v("held", "2026-01-04T10:00:00Z", "held_for_fact_review"),
    v("hand", "2026-01-04T11:00:00Z", "auto_publish_failed"),
    v("staged", null, "auto_publish_attempted"),
    v("pos", "2026-01-05T10:00:00Z", "auto_publish_attempted", "imp"),
    v("bad", "garbage", "auto_publish_attempted"),
    v("legacy", "2026-01-06T10:00:00Z", null),
  ]);
  ok(recent.map((r) => r.id).join() === "new,mid,old", "only real automatic publishes, newest first");
  ok(recentAutoPublished([v("a", "2026-01-01T00:00:00Z", "auto_publish_attempted")], 0).length === 0, "max 0 -> none");
  const many = Array.from({ length: 15 }, (_, i) =>
    v(`r${String(i).padStart(2, "0")}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, "auto_publish_attempted"),
  );
  const top = recentAutoPublished(many);
  ok(top.length === RECENT_AUTO_MAX && RECENT_AUTO_MAX === 10, "capped at 10");
  ok(top[0].id === "r14" && top[9].id === "r05", "the cap keeps the newest");
  const tie = recentAutoPublished([
    v("b", "2026-01-01T00:00:00Z", "auto_publish_attempted"),
    v("a", "2026-01-01T00:00:00Z", "auto_publish_attempted"),
  ]);
  ok(tie.map((r) => r.id).join() === "a,b", "equal times break by id (stable)");

  return { passed };
}
