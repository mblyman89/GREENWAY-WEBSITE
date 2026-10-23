/**
 * src/lib/inventory/cultivera-category-gate-core.ts   (R74 S15, pure)
 *
 * Owner, round 2 answer 3 (verbatim in the roadmap): "If Is Cannabis = true
 * but the category is non-cannabis, owner must pick a category before the
 * manifest can finish onboarding."
 *
 * R74 S1 already HOLDS such a card: the transform hides it with
 * hidden_reason "needs_category" and gives it a placeholder category (the best
 * hint, else "paraphernalia"). Only menu_items.hidden_reason persists the
 * hold. Because the placeholder is a real website category, the ordinary
 * classification gate (SLICE 64) saw the product as "resolved" and asked for
 * nothing - the gap this slice closes:
 *
 *   - approval: a draft whose LIVE card is held for a category needs a HUMAN
 *     category pick in that submission. The resolver's verdict (the
 *     placeholder) and a remembered pick never satisfy it. If the hold cannot
 *     be read, the approval is refused (fail closed). "Approve all priced"
 *     calls the same approval, so it refuses held rows too.
 *   - manifest: a rebuilt manifest is never "Done" while one of its products
 *     is held and not approved with a pick; the Cultivera section says how
 *     many still need a category.
 *
 * Pure: no I/O. Self-tests at the bottom (run-pure-selftests.ts).
 */

/** The hidden_reason the transform (R74 S1, holdForCategory) writes. */
export const NEEDS_CATEGORY_REASON = "needs_category";

/** Is this live card held until somebody picks its category? */
export function heldForCategory(hiddenReason: unknown): boolean {
  return typeof hiddenReason === "string" && hiddenReason.trim() === NEEDS_CATEGORY_REASON;
}

/** The keys (menu_items.source_item_id) held for a category, from live rows. */
export function categoryHoldKeys(rows: readonly { source_item_id?: unknown; hidden_reason?: unknown }[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (typeof r.source_item_id !== "string" || !r.source_item_id.trim()) continue;
    if (heldForCategory(r.hidden_reason)) out.add(r.source_item_id);
  }
  return out;
}

export type CategoryHoldRead = { ok: true; held: boolean } | { ok: false };

export type CategoryGateResult =
  | { ok: true; held: boolean }
  | { ok: false; code: "hold_unread" | "category_required"; error: string };

export const CATEGORY_HOLD_UNREAD_ERROR =
  "Could not check whether this product is waiting for a category, so it was not approved. Try again.";
export const CATEGORY_HOLD_REQUIRED_ERROR =
  "Cultivera's category for this product gives no product form, so its card is held hidden. Pick its website category, then approve.";

/**
 * The approval gate. `submittedCategory` is the category the person picked in
 * THIS submission (blank = none). The closed-vocabulary check stays with
 * validateClassificationChoice; this only decides whether a pick is required.
 */
export function categoryGate(read: CategoryHoldRead, submittedCategory: unknown): CategoryGateResult {
  if (!read.ok) return { ok: false, code: "hold_unread", error: CATEGORY_HOLD_UNREAD_ERROR };
  if (!read.held) return { ok: true, held: false };
  const pick = typeof submittedCategory === "string" ? submittedCategory.trim() : "";
  if (!pick || pick === "__new__") return { ok: false, code: "category_required", error: CATEGORY_HOLD_REQUIRED_ERROR };
  return { ok: true, held: true };
}

/** The line under the picker on a held row. */
export const CATEGORY_HOLD_ROW_NOTE =
  "Held: Cultivera's category gives no product form, so this card is hidden until you pick its website category. A remembered or automatic category does not count here.";

/**
 * Per manifest: how many products still need a category. A draft counts when
 * its key is held and it is not approved (open or dismissed - dismissing does
 * not pick a category, so the manifest cannot finish that way).
 */
export function tallyCategoryHolds(
  drafts: readonly { manifest_id?: unknown; status?: unknown; pos_product_key?: unknown }[],
  heldKeys: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Set<string>();
  for (const d of drafts) {
    if (typeof d.manifest_id !== "string" || !d.manifest_id) continue;
    if (typeof d.pos_product_key !== "string" || !heldKeys.has(d.pos_product_key)) continue;
    if (d.status === "approved") continue;
    const k = `${d.manifest_id}\u0000${d.pos_product_key}`;
    if (seen.has(k)) continue; // one product counted once per manifest
    seen.add(k);
    out.set(d.manifest_id, (out.get(d.manifest_id) ?? 0) + 1);
  }
  return out;
}

/** "N products need a category before this manifest can finish." */
export function categoryHoldNote(n: number): string {
  if (!Number.isInteger(n) || n <= 0) return "";
  return `${n} product${n === 1 ? " needs" : "s need"} a category before this manifest can finish`;
}

export const CATEGORY_HOLD_UNREAD_NOTE = "Category holds could not be read";

export function __runCultiveraCategoryGateCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: unknown, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  \u2717 cultivera-category-gate-core: ${name}`);
    }
  };

  // 1. heldForCategory
  ok(heldForCategory("needs_category"), "held: exact reason");
  ok(heldForCategory(" needs_category "), "held: trimmed");
  ok(!heldForCategory("owner"), "held: another hide reason is not a category hold");
  ok(!heldForCategory(null) && !heldForCategory(undefined) && !heldForCategory(1), "held: non-strings are not holds");
  ok(!heldForCategory("NEEDS_CATEGORY"), "held: case is not guessed");

  // 2. categoryHoldKeys
  const keys = categoryHoldKeys([
    { source_item_id: "a", hidden_reason: "needs_category" },
    { source_item_id: "b", hidden_reason: "owner" },
    { source_item_id: "c", hidden_reason: null },
    { source_item_id: "", hidden_reason: "needs_category" },
    { source_item_id: null, hidden_reason: "needs_category" },
  ]);
  ok(keys.size === 1 && keys.has("a"), "keys: only held, keyed rows");

  // 3. categoryGate
  const unread = categoryGate({ ok: false }, "flower");
  ok(!unread.ok && unread.code === "hold_unread", "gate: unreadable hold refuses even with a pick (fail closed)");
  ok(!unread.ok && unread.error === CATEGORY_HOLD_UNREAD_ERROR, "gate: unread error text");
  const free = categoryGate({ ok: true, held: false }, null);
  ok(free.ok && free.held === false, "gate: not held needs nothing");
  const need = categoryGate({ ok: true, held: true }, null);
  ok(!need.ok && need.code === "category_required" && need.error === CATEGORY_HOLD_REQUIRED_ERROR, "gate: held + no pick refuses");
  const blank = categoryGate({ ok: true, held: true }, "   ");
  ok(!blank.ok && blank.code === "category_required", "gate: a blank pick is no pick");
  const create = categoryGate({ ok: true, held: true }, "__new__");
  ok(!create.ok && create.code === "category_required", "gate: the unresolved create-new sentinel is no pick");
  const nonStr = categoryGate({ ok: true, held: true }, 5);
  ok(!nonStr.ok, "gate: a non-string pick is no pick");
  const picked = categoryGate({ ok: true, held: true }, " edibles ");
  ok(picked.ok && picked.held === true, "gate: held + a pick passes (vocabulary checked elsewhere)");

  // 4. tallyCategoryHolds
  const held = new Set(["k1", "k2", "k3"]);
  const t = tallyCategoryHolds(
    [
      { manifest_id: "m1", status: "draft", pos_product_key: "k1" },
      { manifest_id: "m1", status: "draft", pos_product_key: "k1" }, // duplicate product
      { manifest_id: "m1", status: "dismissed", pos_product_key: "k2" },
      { manifest_id: "m1", status: "approved", pos_product_key: "k3" },
      { manifest_id: "m1", status: "draft", pos_product_key: "free" },
      { manifest_id: "m2", status: "draft", pos_product_key: "k3" },
      { manifest_id: null, status: "draft", pos_product_key: "k1" },
      { manifest_id: "m3", status: "draft", pos_product_key: null },
    ],
    held,
  );
  ok(t.get("m1") === 2, "tally: open + dismissed held count, approved does not, a product once");
  ok(t.get("m2") === 1, "tally: per manifest");
  ok(!t.has("m3"), "tally: keyless never counts");
  ok(t.size === 2, "tally: manifest-less rows skipped");

  // 5. notes
  ok(categoryHoldNote(1) === "1 product needs a category before this manifest can finish", "note: singular");
  ok(categoryHoldNote(3) === "3 products need a category before this manifest can finish", "note: plural");
  ok(categoryHoldNote(0) === "" && categoryHoldNote(-1) === "" && categoryHoldNote(1.5) === "", "note: nothing to say");
  ok(CATEGORY_HOLD_ROW_NOTE.includes("pick its website category"), "row note says what to do");

  return { passed, failed };
}
