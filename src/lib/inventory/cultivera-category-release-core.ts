/**
 * src/lib/inventory/cultivera-category-release-core.ts  (R74 S17, pure)
 *
 * WHAT. R74 S1 holds a cannabis card whose Cultivera category gives no product
 * form: hidden, hidden_reason "needs_category", a placeholder category. S15
 * made approval of such a product require a PERSON's category pick. Until now
 * the card stayed hidden even after that pick (the card refresh never changes
 * visibility), so someone had to find it and un-hide it by hand. Owner, round 9:
 * "please also include in this round the automatic go live feature for
 * products held back for no category."
 *
 * RULE (every condition must hold; anything else stays exactly as it was):
 *   1. the live card is hidden with hidden_reason EXACTLY "needs_category"
 *      (any other reason - owner, reviewer_rejected, no_product_master,
 *      no_inventory ... - is never touched);
 *   2. its approved draft carries the S17 marker in its classification
 *      provenance: written ONLY when the S15 gate saw the hold and passed it
 *      with a person's pick in that same approval (never the placeholder,
 *      never a remembered or automatic category, never "Approve all priced");
 *   3. the draft names that category (non-blank chosen website category);
 *   4. the card was rebuilt from that draft in THIS staging (refreshed or
 *      already matching) - a product withheld for an unverified fact, or not
 *      on the live menu, is not released;
 *   5. the rebuilt card now sits on the picked category (the shelf the
 *      person chose), so it can never go live under the placeholder;
 *   6. the switch is on (CULTIVERA_CATEGORY_RELEASE; off = S15 behaviour).
 * Releasing sets hidden=false and hidden_reason=null on that card only.
 * Prices, sizes, stock status and sort order are untouched; a card that is out
 * of stock still shows as out of stock.
 *
 * Pure: no I/O. Self-tests at the bottom (run-pure-selftests.ts).
 */
import { NEEDS_CATEGORY_REASON } from "@/lib/inventory/cultivera-category-gate-core";

/** Kill switch: `off` keeps a picked card hidden (the S15 behaviour). */
export const CATEGORY_RELEASE_ENV = "CULTIVERA_CATEGORY_RELEASE";
export function categoryReleaseEnabled(raw: string | undefined | null): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "false" || v === "0" || v === "no" || v === "disabled");
}

/**
 * The provenance key + value the approval writes when the S15 gate saw the
 * hold and passed it with a person's pick in that submission.
 */
export const CATEGORY_HOLD_PICK_KEY = "categoryHold";
export const CATEGORY_HOLD_PICK_VALUE = "human";

/** The provenance entry to merge into chosen_classification_provenance (or {} when not held). */
export function categoryHoldPickProvenance(held: boolean): Record<string, string> {
  return held ? { [CATEGORY_HOLD_PICK_KEY]: CATEGORY_HOLD_PICK_VALUE } : {};
}

/** True when a draft's provenance carries the S17 marker. Anything malformed = false. */
export function hasCategoryHoldPick(provenance: unknown): boolean {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return false;
  return (provenance as Record<string, unknown>)[CATEGORY_HOLD_PICK_KEY] === CATEGORY_HOLD_PICK_VALUE;
}

export type ReleaseDraft = {
  pos_product_key: string | null;
  chosen_website_category?: string | null;
  chosen_classification_provenance?: unknown;
};

export type ReleaseCard = {
  source_item_id: string;
  name: string;
  category: string;
  hidden: boolean;
  hidden_reason: string | null;
};

export type ReleaseSkip = { key: string; reason: "not_rebuilt" | "category_mismatch" | "not_on_menu" };

export type CategoryReleasePlan = {
  /** Keys whose card was un-hidden. */
  released: string[];
  /** Keys that carried the marker but were NOT released, with the reason. */
  skipped: ReleaseSkip[];
};

const clean = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/**
 * Apply the release rule to the staged snapshot (MUTATES the matching cards).
 * `rebuiltKeys` = the refresh plan's refreshed + unchanged keys (the FINAL plan,
 * after any fact withhold). Nothing happens when the switch is off.
 */
export function applyCategoryHoldReleases(input: {
  items: ReleaseCard[];
  drafts: readonly ReleaseDraft[];
  rebuiltKeys: ReadonlySet<string>;
  enabled: boolean;
}): CategoryReleasePlan {
  const plan: CategoryReleasePlan = { released: [], skipped: [] };
  if (!input.enabled) return plan;
  // The picked category per key, from drafts carrying the marker. Two
  // approved drafts for one key that disagree on the category = not guessed.
  const picked = new Map<string, string | null>();
  for (const d of input.drafts) {
    const key = typeof d.pos_product_key === "string" ? d.pos_product_key.trim() : "";
    if (!key || !hasCategoryHoldPick(d.chosen_classification_provenance)) continue;
    const cat = clean(d.chosen_website_category);
    if (!cat) continue;
    const prev = picked.get(key);
    picked.set(key, prev === undefined ? cat : prev === cat ? cat : null);
  }
  if (picked.size === 0) return plan;
  const byKey = new Map<string, ReleaseCard>();
  for (const it of input.items) if (!byKey.has(it.source_item_id)) byKey.set(it.source_item_id, it);
  for (const [key, cat] of [...picked.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const card = byKey.get(key);
    if (!card) {
      plan.skipped.push({ key, reason: "not_on_menu" });
      continue;
    }
    // Not held (already visible, or hidden for another reason): never touched, never reported.
    if (!(card.hidden === true && card.hidden_reason === NEEDS_CATEGORY_REASON)) continue;
    if (!input.rebuiltKeys.has(key)) {
      plan.skipped.push({ key, reason: "not_rebuilt" });
      continue;
    }
    if (cat === null || clean(card.category) !== cat) {
      plan.skipped.push({ key, reason: "category_mismatch" });
      continue;
    }
    card.hidden = false;
    card.hidden_reason = null;
    plan.released.push(key);
  }
  return plan;
}

/** manifest_events.event_type when picked cards went live. */
export const RELEASE_EVENT = "cultivera_category_holds_released";

/** The timeline note (plain words; says where the card is and what did not change). */
export function categoryReleaseNote(p: { released: number; skipped: number; published: boolean }): string {
  const n = Math.max(0, Math.floor(Number.isFinite(p.released) ? p.released : 0));
  const s = Math.max(0, Math.floor(Number.isFinite(p.skipped) ? p.skipped : 0));
  const what =
    n === 1
      ? "1 product that was held for a category is now visible"
      : `${n} products that were held for a category are now visible`;
  const where = p.published ? "on the live menu" : "in the staged menu (waiting on Admin \u2192 Publish Menu)";
  const kept =
    s > 0
      ? ` ${s === 1 ? "1 picked product stays" : `${s} picked products stay`} hidden: ${s === 1 ? "its" : "their"} card was not rebuilt this time (a fact still needs checking) or is not on the shelf you picked.`
      : "";
  return `${what} ${where}, on the category you picked. Prices, sizes and stock did not change.${kept}`;
}

/** The version-notes suffix. */
export function categoryReleaseNotesSuffix(released: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(released) ? released : 0));
  if (n === 0) return "";
  return ` ${n === 1 ? "1 card" : `${n} cards`} held for a category now visible (category picked at onboarding).`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCultiveraCategoryReleaseCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: unknown, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  \u2717 cultivera-category-release-core: ${name}`);
    }
  };
  const card = (over: Partial<ReleaseCard> = {}): ReleaseCard => ({
    source_item_id: "K1",
    name: "Orangasm Cart",
    category: "cartridge",
    hidden: true,
    hidden_reason: "needs_category",
    ...over,
  });
  const marked = { websiteCategory: "human", [CATEGORY_HOLD_PICK_KEY]: CATEGORY_HOLD_PICK_VALUE };
  const draft = (over: Partial<ReleaseDraft> = {}): ReleaseDraft => ({
    pos_product_key: "K1",
    chosen_website_category: "cartridge",
    chosen_classification_provenance: marked,
    ...over,
  });
  const run = (items: ReleaseCard[], drafts: ReleaseDraft[], rebuilt: string[] = ["K1"], enabled = true) =>
    applyCategoryHoldReleases({ items, drafts, rebuiltKeys: new Set(rebuilt), enabled });

  // 1. switch
  ok(categoryReleaseEnabled(undefined) && categoryReleaseEnabled("") && categoryReleaseEnabled("on"), "switch: default on");
  ok(!categoryReleaseEnabled("off") && !categoryReleaseEnabled(" OFF ") && !categoryReleaseEnabled("0") && !categoryReleaseEnabled("false") && !categoryReleaseEnabled("no") && !categoryReleaseEnabled("disabled"), "switch: off words");
  // 2. marker
  ok(hasCategoryHoldPick(marked), "marker: present");
  ok(!hasCategoryHoldPick({ websiteCategory: "human" }), "marker: a plain human pick is not the marker");
  ok(!hasCategoryHoldPick({ [CATEGORY_HOLD_PICK_KEY]: "remembered" }), "marker: other value");
  ok(!hasCategoryHoldPick(null) && !hasCategoryHoldPick("x") && !hasCategoryHoldPick([marked]), "marker: malformed");
  ok(JSON.stringify(categoryHoldPickProvenance(true)) === JSON.stringify({ categoryHold: "human" }), "marker: written when held");
  ok(JSON.stringify(categoryHoldPickProvenance(false)) === "{}", "marker: nothing when not held");
  // 3. the happy path
  {
    const c = card();
    const p = run([c], [draft()]);
    ok(p.released.join() === "K1" && p.skipped.length === 0, "release: held + marker + rebuilt + same shelf");
    ok(c.hidden === false && c.hidden_reason === null, "release: card un-hidden, reason cleared");
    ok(c.category === "cartridge" && c.name === "Orangasm Cart", "release: nothing else changed");
  }
  // 4. switch off = untouched
  {
    const c = card();
    const p = run([c], [draft()], ["K1"], false);
    ok(p.released.length === 0 && c.hidden === true && c.hidden_reason === "needs_category", "off: stays hidden");
  }
  // 5. other hide reasons are never touched
  for (const reason of ["owner", "reviewer_rejected", "no_product_master", "no_inventory", null]) {
    const c = card({ hidden_reason: reason });
    const p = run([c], [draft()]);
    ok(p.released.length === 0 && p.skipped.length === 0 && c.hidden === true && c.hidden_reason === reason, `other reason kept: ${String(reason)}`);
  }
  // 6. already visible: untouched, not reported
  {
    const c = card({ hidden: false, hidden_reason: null });
    const p = run([c], [draft()]);
    ok(p.released.length === 0 && p.skipped.length === 0 && c.hidden === false, "visible: untouched");
  }
  // 7. no marker (approve all priced / remembered / pre-S17 approval)
  {
    const c = card();
    const p = run([c], [draft({ chosen_classification_provenance: { websiteCategory: "remembered" } })]);
    ok(p.released.length === 0 && p.skipped.length === 0 && c.hidden === true, "no marker: stays hidden");
  }
  // 8. blank category with marker
  {
    const c = card();
    const p = run([c], [draft({ chosen_website_category: "  " })]);
    ok(p.released.length === 0 && c.hidden === true, "blank pick: stays hidden");
  }
  // 9. not rebuilt (withheld for a fact)
  {
    const c = card();
    const p = run([c], [draft()], []);
    ok(p.released.length === 0 && p.skipped[0]?.reason === "not_rebuilt" && c.hidden === true, "withheld: stays hidden, reported");
  }
  // 10. card not on the shelf picked (placeholder survived)
  {
    const c = card({ category: "paraphernalia" });
    const p = run([c], [draft()]);
    ok(p.released.length === 0 && p.skipped[0]?.reason === "category_mismatch" && c.hidden === true, "placeholder shelf: stays hidden");
  }
  // 11. case/space-insensitive match on the shelf
  {
    const c = card({ category: "Cartridge" });
    ok(run([c], [draft({ chosen_website_category: " cartridge " })]).released.length === 1, "shelf compare is trimmed + case-insensitive");
  }
  // 12. two drafts disagree on the pick = not guessed
  {
    const c = card();
    const p = run([c], [draft(), draft({ chosen_website_category: "concentrate" })]);
    ok(p.released.length === 0 && p.skipped[0]?.reason === "category_mismatch" && c.hidden === true, "disagreeing picks: stays hidden");
    const c3 = card();
    const p3 = run([c3], [draft({ chosen_website_category: "concentrate" }), draft()]);
    ok(p3.released.length === 0 && c3.hidden === true, "disagreeing picks in either order: the last one never wins");
    const c2 = card();
    ok(run([c2], [draft(), draft()]).released.length === 1, "agreeing duplicate drafts: released once");
  }
  // 13. not on the live menu
  {
    const p = run([card({ source_item_id: "OTHER" })], [draft()]);
    ok(p.released.length === 0 && p.skipped[0]?.reason === "not_on_menu", "not on menu: reported");
  }
  // 14. only the marked key is released; output sorted
  {
    const a = card({ source_item_id: "B" });
    const b = card({ source_item_id: "A" });
    const other = card({ source_item_id: "C" });
    const p = run([a, b, other], [draft({ pos_product_key: "B" }), draft({ pos_product_key: "A" })], ["A", "B", "C"]);
    ok(p.released.join() === "A,B" && other.hidden === true && other.hidden_reason === "needs_category", "only marked keys, sorted");
  }
  // 15. blank / null key ignored
  ok(run([card()], [draft({ pos_product_key: null }), draft({ pos_product_key: " " })]).released.length === 0, "blank key ignored");
  // 16. copy
  ok(
    categoryReleaseNote({ released: 1, skipped: 0, published: true }) ===
      "1 product that was held for a category is now visible on the live menu, on the category you picked. Prices, sizes and stock did not change.",
    "note: one, published",
  );
  ok(categoryReleaseNote({ released: 3, skipped: 2, published: false }).startsWith("3 products that were held for a category are now visible in the staged menu"), "note: many, staged");
  ok(categoryReleaseNote({ released: 0, skipped: 2, published: true }).includes("2 picked products stay hidden"), "note: kept count");
  ok(categoryReleaseNotesSuffix(0) === "" && categoryReleaseNotesSuffix(1).includes("1 card held") && categoryReleaseNotesSuffix(2).includes("2 cards held"), "notes suffix");
  return { passed, failed };
}
