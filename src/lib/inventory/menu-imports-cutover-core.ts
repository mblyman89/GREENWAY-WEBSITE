/**
 * src/lib/inventory/menu-imports-cutover-core.ts   (S21, bible F-075 / F-088)
 *
 * PURE: has the one-time Cultivera import been completed, when, and how big
 * was it? The Menu Imports page uses this to stop advertising uploads once
 * the migration is done (S21.2 / S21.4 / S21.6).
 *
 * "Completed" uses the SAME predicate the S18 guard uses (readCutoverDone): a menu
 * version with `import_id` set (a Cultivera upload), `is_test` false, and
 * `published_at` set. `published_at` is the right witness, not `status`:
 * publish_menu_version (0236) archives the previous live version by changing
 * ONLY its status, so an import that receiving has since published on top of
 * is `archived` but keeps its `published_at`. Keying on status "published"
 * would un-complete the import the moment receiving publishes, which is
 * exactly when it matters most.
 *
 * Which import? The EARLIEST published one: that is the one-time import. If a
 * later real upload was also published (possible before the S18 re-upload
 * refusal existed), both dates are reported - never silently pick one.
 *
 * Why not the page's listVersions(30)? Every approval auto-publishes a new
 * version, so after about 30 approvals the import is no longer among the 30
 * newest rows and the page would wrongly say "not done". The server
 * (menu-imports-cutover.ts) does two bounded reads of its own instead.
 *
 * Counts (never guessed):
 *   products = item_count (written by the parser from the workbook, SLICE 4A:
 *              an independent witness that never passes through PostgREST's
 *              1,000-row cap).
 *   lots     = summary_json->lotPlan->lotsPlanned when it is a whole number >= 0
 *              (import-service.ts writes `{...summary, lotPlan: lotPlan.summary}`).
 *              Imports staged before SLICE 46 have no lot plan -> "lot count
 *              not recorded", not 0. It is the PLANNED count (lots are minted
 *              idempotently at publish), so the copy says "lots planned".
 *
 * This is a copy decision, not a safety gate: the upload itself is still
 * refused server-side by the S18 guard (refuseUpload). Hiding the form is
 * progressive disclosure; the tools stay one click away for test-mode
 * rehearsals and the lot backfill.
 */

/** The named columns the server reads (lot plan via a JSON path, not the whole summary). */
export const COMPLETED_IMPORT_SELECT = "id, import_id, is_test, published_at, item_count, lot_plan:summary_json->lotPlan";

export type CutoverVersionRow = {
  id: string;
  import_id: string | null;
  is_test?: boolean | null;
  published_at: string | null;
  item_count?: number | null;
  /** summary_json->lotPlan (import-lot-core ImportLotPlan.summary). */
  lot_plan?: unknown;
};

export type CompletedImport = {
  versionId: string;
  importId: string;
  publishedAt: string;
  products: number | null;
  lots: number | null;
};

export type MenuImportsCutover =
  | { done: false; unknown: boolean }
  | { done: true; first: CompletedImport; latest: CompletedImport | null; realPublishedCount: number | null };

function wholeOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** lotPlan.lotsPlanned, only when it is really there. */
export function lotsPlannedFrom(plan: unknown): number | null {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
  return wholeOrNull((plan as { lotsPlanned?: unknown }).lotsPlanned);
}

/** Same predicate as readCutoverDone's first read (S18). */
export function isCompletedCultiveraVersion(v: CutoverVersionRow | null | undefined): boolean {
  if (!v) return false;
  if (typeof v.import_id !== "string" || !v.import_id.trim()) return false;
  if (v.is_test === true) return false;
  return typeof v.published_at === "string" && !Number.isNaN(Date.parse(v.published_at));
}

function toCompleted(v: CutoverVersionRow): CompletedImport {
  return {
    versionId: v.id,
    importId: v.import_id as string,
    publishedAt: v.published_at as string,
    products: wholeOrNull(v.item_count),
    lots: lotsPlannedFrom(v.lot_plan),
  };
}

/**
 * The verdict from the server's two bounded reads: the EARLIEST and the
 * LATEST real published import (plus the exact count from the first read).
 * `failed` (either read errored) -> not done, unknown: the page keeps the
 * pre-S21 layout (the upload itself is still guarded server-side by S18).
 */
export function menuImportsCutover(input: {
  earliest: CutoverVersionRow | null | undefined;
  latest: CutoverVersionRow | null | undefined;
  count: number | null | undefined;
  failed: boolean;
}): MenuImportsCutover {
  if (input.failed) return { done: false, unknown: true };
  if (!isCompletedCultiveraVersion(input.earliest)) return { done: false, unknown: false };
  const first = toCompleted(input.earliest as CutoverVersionRow);
  const later =
    isCompletedCultiveraVersion(input.latest) && (input.latest as CutoverVersionRow).id !== first.versionId
      ? toCompleted(input.latest as CutoverVersionRow)
      : null;
  return { done: true, first, latest: later, realPublishedCount: wholeOrNull(input.count) };
}

/** The store's calendar date (Port Orchard, WA), e.g. "Aug 1, 2026". */
export function storeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
}

// --- Copy (bible S21.2 / S21.4) ------------------------------------------------

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** "(N products, N lots planned)" - each part only when it was recorded. */
export function completedCounts(c: Pick<CompletedImport, "products" | "lots">): string {
  const products = c.products === null ? "product count not recorded" : plural(c.products, "product", "products");
  const lots = c.lots === null ? "lot count not recorded" : plural(c.lots, "lot planned", "lots planned");
  return `(${products}, ${lots})`;
}

/** S21.4 subtitle, verbatim, with the date filled in. */
export function completedSubtitle(date: string): string {
  return `Menu updates from receiving publish automatically. Your one-time Cultivera import was completed on ${date}.`;
}

/** S21.2 banner line. */
export function completedHeadline(date: string, c: Pick<CompletedImport, "products" | "lots">): string {
  return `Initial Cultivera import completed ${date} ${completedCounts(c)}`;
}

/** Shown only when more than one real upload was published (never hidden). */
export function laterUploadNote(date: string, count: number): string {
  return `${plural(count, "real Cultivera upload was", "real Cultivera uploads were")} published in total; the most recent went live ${date}. Menu updates since then came from receiving.`;
}

/** S21.2 toggle label. */
export const ONE_TIME_TOOLS_SUMMARY = "Show one-time import tools";

/**
 * Under the toggle: why it is closed, and what it is still for. `refused` is
 * the S18 guard's own verdict (readCutoverDone: flag on AND receiving has
 * published on top of the import). Only then does the copy say "refused";
 * otherwise it says what an upload really does (stages, never auto-publishes).
 */
export function oneTimeToolsNote(refused: boolean): string {
  return refused
    ? "You won't need these day to day. A second real upload is refused now that receiving has published on top of the import (it would replace your menu with an old POS export). A Test-mode upload is still allowed for rehearsals."
    : "You won't need these day to day. A second real upload would stage an old POS export as a new menu draft (nothing publishes until someone presses Publish). Use Test mode for rehearsals.";
}

// --- Embedded self-tests ---------------------------------------------------------

export function __runMenuImportsCutoverTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(`menu-imports-cutover-core: ${msg}`);
    passed += 1;
  };
  const v = (o: Partial<CutoverVersionRow> & { id: string }): CutoverVersionRow => ({
    import_id: "imp-1",
    is_test: false,
    published_at: "2026-08-01T17:00:00Z",
    item_count: 4512,
    lot_plan: { lotsPlanned: 5120 },
    ...o,
  });
  const run = (earliest: CutoverVersionRow | null, latest: CutoverVersionRow | null = earliest, count: number | null = 1, failed = false) =>
    menuImportsCutover({ earliest, latest, count, failed });

  // Columns: named, lot plan by JSON path (never the whole summary / "*").
  ok(COMPLETED_IMPORT_SELECT === "id, import_id, is_test, published_at, item_count, lot_plan:summary_json->lotPlan", "named columns");

  // lotsPlannedFrom - only a real whole number counts.
  ok(lotsPlannedFrom({ lotsPlanned: 7 }) === 7, "lots read");
  ok(lotsPlannedFrom({ lotsPlanned: 0 }) === 0, "zero lots is a real count");
  ok(lotsPlannedFrom({}) === null && lotsPlannedFrom(null) === null && lotsPlannedFrom("x") === null, "no plan -> null");
  ok(lotsPlannedFrom({ lotsPlanned: "7" }) === null, "string is not a count");
  ok(lotsPlannedFrom({ lotsPlanned: 2.5 }) === null && lotsPlannedFrom({ lotsPlanned: -1 }) === null, "fraction/negative -> null");
  ok(lotsPlannedFrom(Object.assign([], { lotsPlanned: 3 })) === null, "arrays -> null (even one carrying the key)");

  // The predicate mirrors readCutoverDone.
  ok(isCompletedCultiveraVersion(v({ id: "a" })), "real published import");
  ok(!isCompletedCultiveraVersion(v({ id: "a", import_id: null })), "receiving version is not an import");
  ok(!isCompletedCultiveraVersion(v({ id: "a", import_id: "  " })), "blank import id");
  ok(!isCompletedCultiveraVersion(v({ id: "a", is_test: true })), "test upload never completes cutover");
  ok(isCompletedCultiveraVersion(v({ id: "a", is_test: null })) && isCompletedCultiveraVersion(v({ id: "a", is_test: undefined })), "missing is_test = real (column default false)");
  ok(!isCompletedCultiveraVersion(v({ id: "a", published_at: null })), "staged import not completed");
  ok(!isCompletedCultiveraVersion(v({ id: "a", published_at: "not a date" })), "unparseable date not completed");
  ok(!isCompletedCultiveraVersion(null), "null row");

  // Not done / unknown.
  const none = run(null, null, 0);
  ok(none.done === false && none.unknown === false, "no import: not done, known");
  const bad = run(v({ id: "c1" }), v({ id: "c1" }), 1, true);
  ok(bad.done === false && bad.unknown === true, "failed read: not done, unknown (never claims done)");
  ok(run(v({ id: "t", is_test: true })).done === false, "a test row that slipped through never counts");

  // Done.
  const one = run(v({ id: "c1" }));
  ok(one.done === true, "published import -> done");
  if (one.done) {
    ok(one.first.versionId === "c1" && one.first.importId === "imp-1" && one.first.publishedAt === "2026-08-01T17:00:00Z", "the import row");
    ok(one.first.products === 4512 && one.first.lots === 5120, "counts read");
    ok(one.latest === null && one.realPublishedCount === 1, "single upload: no later note");
  }
  const two = run(v({ id: "early" }), v({ id: "late", import_id: "imp-2", published_at: "2026-08-05T00:00:00Z", item_count: 10 }), 2);
  ok(two.done && two.first.versionId === "early" && two.latest?.versionId === "late" && two.latest.products === 10, "earliest + latest");
  ok(two.done && two.realPublishedCount === 2, "count of real uploads");
  ok(run(v({ id: "e" }), null, null).done, "latest missing still done");
  const badLatest = run(v({ id: "e" }), v({ id: "t", is_test: true }), 2);
  ok(badLatest.done && badLatest.latest === null, "a latest row failing the predicate is never reported as a later upload");
  const noCount = run(v({ id: "e" }), null, null);
  ok(noCount.done && noCount.realPublishedCount === null && noCount.latest === null, "unknown count stays null");

  // Unrecorded counts are never invented.
  const bare = run(v({ id: "x", item_count: null, lot_plan: null }));
  ok(bare.done && bare.first.products === null && bare.first.lots === null, "missing counts stay null");

  // Store date (America/Los_Angeles, not UTC).
  ok(storeDate("2026-08-01T17:00:00Z") === "Aug 1, 2026", "store date");
  ok(storeDate("2026-08-01T05:00:00Z") === "Jul 31, 2026", "UTC morning is the previous day in WA");
  ok(storeDate("nope") === "\u2014", "bad date -> dash");

  // Copy.
  ok(completedCounts({ products: 4512, lots: 5120 }) === "(4,512 products, 5,120 lots planned)", "counts copy");
  ok(completedCounts({ products: 1, lots: 1 }) === "(1 product, 1 lot planned)", "singulars");
  ok(completedCounts({ products: 0, lots: 0 }) === "(0 products, 0 lots planned)", "zeros are real");
  ok(completedCounts({ products: null, lots: null }) === "(product count not recorded, lot count not recorded)", "unknowns said plainly");
  ok(
    completedSubtitle("Aug 1, 2026") ===
      "Menu updates from receiving publish automatically. Your one-time Cultivera import was completed on Aug 1, 2026.",
    "S21.4 subtitle verbatim",
  );
  ok(
    completedHeadline("Aug 1, 2026", { products: 4512, lots: 5120 }) ===
      "Initial Cultivera import completed Aug 1, 2026 (4,512 products, 5,120 lots planned)",
    "S21.2 headline",
  );
  ok(laterUploadNote("Aug 5, 2026", 2).startsWith("2 real Cultivera uploads were published"), "later note plural");
  ok(laterUploadNote("Aug 5, 2026", 1).startsWith("1 real Cultivera upload was published"), "later note singular");
  ok(laterUploadNote("Aug 5, 2026", 2).includes("went live Aug 5, 2026"), "later note date");
  ok(ONE_TIME_TOOLS_SUMMARY === "Show one-time import tools", "S21.2 toggle label verbatim");
  ok(oneTimeToolsNote(true).includes("is refused now that receiving has published"), "refused note only when S18 refuses");
  ok(oneTimeToolsNote(true).includes("Test-mode upload is still allowed"), "refused note keeps rehearsals");
  ok(!oneTimeToolsNote(false).includes("refused"), "never claims a refusal S18 would not make");
  ok(oneTimeToolsNote(false).includes("nothing publishes until someone presses Publish"), "not-refused note says uploads stage");

  return { passed };
}
