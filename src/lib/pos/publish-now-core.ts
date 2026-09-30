/**
 * src/lib/pos/publish-now-core.ts  (R14a -- "publish now, fix after")
 *
 * PURE. The owner, Round 14, verbatim:
 *   "I can't publish the menu, the publish page wants me to fix everything
 *    first. I need to be able to publish the menu right away, then be able to
 *    go back and fix each product using all the new features."
 *
 * WHAT CHANGES
 *   The commit gate (import-commit-core evaluateCommitGate) refused the first
 *   Cultivera publish while ANY fact-review row was pending (612 on the owner's
 *   upload). It now accepts an explicit, attributed acknowledgement -- "publish
 *   now; these N products still await review; I will fix them after" -- that
 *   opens the gate over pending rows ONLY. Integrity refusals (short read,
 *   failed decisions read, arithmetic imbalance, blocking errors) still refuse.
 *
 * WHY RULE 3.1 STILL HOLDS (docs/data-governance.md)
 *   "Never auto-commit uncertain data" is about FACTS. The transformer already
 *   withholds every uncertain fact: mg fields are filled only from VERIFIED
 *   extraction (transform.ts toMenuItem, `confidence === "verified"`), and a
 *   row with no source potency shows no THC box. The pending rows therefore go
 *   live with exactly the facts the machine could prove and nothing it guessed.
 *   The acknowledgement does NOT approve them: each stays PENDING in the Fact
 *   Review queue, counted, until a human approves, fixes or rejects it -- the
 *   "decide later" of a data-steward queue, never "decided by the machine".
 *
 * WHY THE MIRROR WIDENS (mirrorTargetVersionIds)
 *   A decision is mirrored onto menu_items by recordFactReview. It used to
 *   write only versions whose import_id is this import. After the first
 *   publish, every received delivery auto-publishes an intake-origin version
 *   (import_id NULL, intake-menu-staging.ts) that COPIES the live rows with
 *   their source_item_id -- so a fix made after the first delivery would land
 *   on an archived version and never reach the website. The mirror now also
 *   writes the live and staged intake-origin versions (same source_item_id =
 *   the same card, carried forward). Archived versions are history and are
 *   never rewritten, except this import's own versions (unchanged behaviour).
 *
 * No fs, no network, no Supabase. Self-tests run in the pure runner.
 */

/** R14a: the exact tick-box sentence; the count is the one the owner saw. */
export function publishNowAcknowledgementCopy(pending: number): string {
  return (
    `Publish now and fix after: ${pending} product(s) still await a fact-review decision. ` +
    `They go live with only the facts the import could verify (nothing guessed), stay in ` +
    `Fact Review, and every fix, approve or reject you make afterwards updates the live menu.`
  );
}

/** R14a: the refusal when the box was not ticked (the owner asked to publish over the queue). */
export const PUBLISH_NOW_NOT_TICKED_COPY =
  "Tick \"Publish now and fix after\" to publish with products still awaiting review, or decide them first in Fact Review.";

/** R14a: the refusal when a role without the override tries it. */
export const PUBLISH_NOW_NOT_ALLOWED_COPY =
  "Only the owner or an admin can publish with products still awaiting review. Decide them in Fact Review, or ask the owner.";

/** R14a: the live-menu banner on the import page and at the top of Fact Review. */
export function liveWithOpenReviewsCopy(pending: number): string | null {
  if (!Number.isInteger(pending) || pending <= 0) return null;
  return (
    `This menu is live with ${pending} product(s) still awaiting a fact-review decision. ` +
    `Keep fixing: each decision updates the live menu within a minute.`
  );
}

/** The audit action written for a publish that went out with open reviews. */
export const PUBLISHED_WITH_OPEN_REVIEWS_AUDIT = "menu_version.published_with_open_reviews";

export type MirrorVersionRow = {
  id: string;
  import_id: string | null;
  status: string;
};

/**
 * R14a: the menu_versions a fact decision for `importId` must be written to.
 *   - every version of THIS import (any status) -- the pre-R14a behaviour;
 *   - PLUS intake-origin versions (import_id NULL) that are live or staged:
 *     they carry this import's cards forward by source_item_id.
 * Never: another POS import's versions, archived intake versions (history).
 * Deduplicated, input order kept.
 */
export function mirrorTargetVersionIds(rows: readonly MirrorVersionRow[], importId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r.id !== "string" || r.id === "" || seen.has(r.id)) continue;
    const own = r.import_id === importId && importId !== "";
    const carried = r.import_id === null && (r.status === "published" || r.status === "staged");
    if (!own && !carried) continue;
    seen.add(r.id);
    out.push(r.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPublishNowCoreTests(): void {
  let failures = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      failures += 1;
      console.error(`  PUBLISH-NOW FAIL: ${msg}`);
    }
  };

  ok(publishNowAcknowledgementCopy(612).includes("612 product(s)"), "tick copy names the count");
  ok(publishNowAcknowledgementCopy(612).includes("nothing guessed"), "tick copy states never-guess");
  ok(publishNowAcknowledgementCopy(612).includes("stay in Fact Review"), "tick copy says rows stay pending");
  ok(liveWithOpenReviewsCopy(0) === null, "no banner at 0");
  ok(liveWithOpenReviewsCopy(-1) === null && liveWithOpenReviewsCopy(1.5) === null, "no banner on junk");
  ok((liveWithOpenReviewsCopy(3) ?? "").startsWith("This menu is live with 3 product(s)"), "banner names the count");
  ok(PUBLISHED_WITH_OPEN_REVIEWS_AUDIT === "menu_version.published_with_open_reviews", "audit action pinned");

  const rows: MirrorVersionRow[] = [
    { id: "v-own-live", import_id: "imp", status: "published" },
    { id: "v-own-arch", import_id: "imp", status: "archived" },
    { id: "v-intake-live", import_id: null, status: "published" },
    { id: "v-intake-staged", import_id: null, status: "staged" },
    { id: "v-intake-arch", import_id: null, status: "archived" },
    { id: "v-other", import_id: "other", status: "published" },
    { id: "v-own-live", import_id: "imp", status: "published" },
  ];
  const ids = mirrorTargetVersionIds(rows, "imp");
  ok(ids.includes("v-own-live") && ids.includes("v-own-arch"), "own versions, any status");
  ok(ids.includes("v-intake-live"), "live intake-origin version carries the card");
  ok(ids.includes("v-intake-staged"), "staged intake-origin version carries the card");
  ok(!ids.includes("v-intake-arch"), "archived intake history untouched");
  ok(!ids.includes("v-other"), "another import never touched");
  ok(ids.length === 4, "deduplicated");
  ok(
    mirrorTargetVersionIds([...rows, { id: "v-blank", import_id: "", status: "published" }], "").every((id) =>
      id.startsWith("v-intake"),
    ),
    "empty import id matches no own version (not even a blank import_id)",
  );
  ok(mirrorTargetVersionIds([], "imp").length === 0, "no versions, no targets");

  if (failures > 0) throw new Error(`publish-now-core self-tests: ${failures} failed`);
  console.log("publish-now-core self-tests passed (15 assertions)");
}
