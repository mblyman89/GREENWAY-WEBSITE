/**
 * S-17b (CCRS Bible Part 17 §C.4 defect 1, Part 12 U-60): which lots name a
 * product that Product.csv cannot carry, and WHY — computed from product KEYS,
 * never from the Product file's ExternalIdentifier column.
 *
 * The defect this replaces (ccrs-batch.ts before S-17b): the "Inventory lots
 * reference products not present in the published menu" warning compared each
 * lot's sanitized POS product key with Product column 6. After applyProductPlan
 * that column holds the CCRS id the row is filed under (an assigned GWP- id or
 * a filed id), so every lot whose product WAS emitted looked orphaned. The
 * 2026-10-19 production screenshot said "(38)" for a manifest of 38 lots while
 * Product.csv carried their products (Part 17 §K.3).
 *
 * The truth used here is the ledger plan: `plan.products` has one entry per
 * product key of the published menu (emit / skip / withhold). A lot whose key
 * has no entry is the only lot whose product is genuinely not in the menu.
 * Withheld products are already a blocking E41 error with rows; they are not
 * repeated as "not in the menu".
 *
 * Inventory.Product must name a product "already submitted … on the
 * product.CSV" in "the same format and spelling" [G L0579-L0583].
 *
 * PURE: no I/O. Embedded self-tests are registered in run-pure-selftests.ts.
 */
import { hiddenReasonText } from "@/lib/pos/fact-review-core";

/** The planner's reason for a lot whose product key has no product plan. */
export const LOT_PRODUCT_NOT_IN_MENU_REASON = "its product is not in the published menu";

/** What the menu tables say about product keys that are not visible in the published version. */
export type MenuPresence =
  | { readable: false; error: string }
  | {
      readable: true;
      /** false when there is no published menu version at all. */
      publishedVersionExists: boolean;
      /**
       * trimmed keys VISIBLE in the published version. A visible key with no
       * product plan was dropped by buildProductFile because its cleaned-up id
       * is empty or equals an earlier item's (ccrs-batch.ts `seen.has(ext)`).
       */
      visibleInPublished: ReadonlySet<string>;
      /** trimmed key → hidden_reason, for items HIDDEN in the published version. */
      hiddenInPublished: ReadonlyMap<string, string | null>;
      /** trimmed keys present in any STAGED (not yet published) version. */
      inStaged: ReadonlySet<string>;
    };

export const MISSING_PRODUCT_CLASSES = [
  "blank-key",
  "no-published-menu",
  "hidden-in-published",
  "visible-id-collision",
  "staged-only",
  "no-menu-item",
  "menu-unreadable",
] as const;
export type MissingProductClass = (typeof MISSING_PRODUCT_CLASSES)[number];

/**
 * Why a product key is not in Product.csv. The order of the checks matters:
 * a key that is hidden in the published version AND in a staged version is
 * reported as hidden (publishing the staged version may or may not show it;
 * the published fact is the one we can prove).
 */
export function explainMissingProduct(key: string, presence: MenuPresence): { cls: MissingProductClass; detail: string } {
  const k = key.trim();
  if (!k) return { cls: "blank-key", detail: "the lot has no POS product key, so no product can be named" };
  if (!presence.readable) return { cls: "menu-unreadable", detail: `the menu could not be read to say why (${presence.error})` };
  if (!presence.publishedVersionExists) return { cls: "no-published-menu", detail: "there is no published menu version" };
  if (presence.visibleInPublished.has(k)) {
    return {
      cls: "visible-id-collision",
      detail: "a visible published item, but its cleaned-up CCRS id is empty or the same as another item's, so Product.csv carries only the other item",
    };
  }
  if (presence.hiddenInPublished.has(k)) {
    return { cls: "hidden-in-published", detail: `hidden in the published menu: ${hiddenReasonText(presence.hiddenInPublished.get(k) ?? null)}` };
  }
  if (presence.inStaged.has(k)) return { cls: "staged-only", detail: "only in a staged menu version that is not published yet" };
  return { cls: "no-menu-item", detail: `no menu item has POS product key "${k}"` };
}

/** The E41 lot detail, enriched with the reason when the planner said "not in the published menu". */
export function enrichLotWithholdReason(reason: string, productKey: string, presence: MenuPresence | null): string {
  if (reason !== LOT_PRODUCT_NOT_IN_MENU_REASON || !presence) return reason;
  return `${reason} (${explainMissingProduct(productKey, presence).detail})`;
}

export type CoverageLot = { id: string; label: string; productKey: string };
export type CoverageRow = { id: string; label: string; detail: string };

/**
 * Distinct product keys named by lots that have NO product plan entry (the
 * product is not a visible item of the published menu). One row per key; the
 * detail says why and lists every lot (never capped). Sorted by key.
 * `plannedKeys` = the keys of `plan.products` (every visible published item).
 */
export function lotsWithProductNotInMenu(
  lots: readonly CoverageLot[],
  plannedKeys: ReadonlySet<string>,
  presence: MenuPresence,
): CoverageRow[] {
  const byKey = new Map<string, string[]>();
  for (const l of lots) {
    const k = l.productKey.trim();
    if (plannedKeys.has(k) && k !== "") continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(l.label || l.id);
  }
  return [...byKey]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, labels]) => ({
      id: k || "(blank)",
      label: k || "(no product key)",
      detail: `${explainMissingProduct(k, presence).detail}; ${labels.length} lot(s): ${labels.join(", ")}`,
    }));
}

/**
 * The lots E47 may speak about: exactly those the ledger planner WITHHELD with
 * the reason "its product is not in the published menu". Taken from the plan's
 * own decision, never re-derived, so the warning and Inventory.csv cannot
 * disagree. Excluded on purpose:
 *  - a lot CCRS already holds whose product left the menu: the planner emits it
 *    as an Update under its FILED product name (CCRS holds that product), so it
 *    is NOT left out and is not a problem;
 *  - a lot with no CCRS id (E3) or refused by routing (E41 with another reason):
 *    already reported with its own reason.
 * `planned` is plan.lots (lot id → decision); a lot with no plan is skipped.
 */
export function lotsWithheldForMissingProduct<L extends { id: string }>(
  lots: readonly L[],
  planned: ReadonlyMap<string, { action: string; reason?: string }>,
): L[] {
  return lots.filter((l) => {
    const p = planned.get(l.id);
    return !!p && p.action === "withhold" && p.reason === LOT_PRODUCT_NOT_IN_MENU_REASON;
  });
}

/**
 * Legacy mode (no ledger view: the planner emits every lot as an Insert and
 * withholds none). A lot that has a plan but whose product key has no product
 * plan is WRITTEN with a blank Product cell. CCRS rejects that row: "Product
 * is required" [G L0578]. These are the lots E47 speaks about in legacy mode.
 */
export function legacyLotsWithBlankProduct<L extends { id: string; pos_product_key?: string | null }>(
  lots: readonly L[],
  planned: ReadonlyMap<string, { action: string }>,
  plannedKeys: ReadonlySet<string>,
): L[] {
  return lots.filter((l) => {
    const p = planned.get(l.id);
    const k = (l.pos_product_key ?? "").trim();
    return !!p && p.action === "emit" && !(k && plannedKeys.has(k));
  });
}

/** E47 message, honest about what happens to the lots in each mode. */
export function e47Message(count: number, legacy: boolean): string {
  return legacy
    ? `${count} product(s) named by inventory lots are not visible items of the published menu, so Product.csv cannot carry them. The ledger is not loaded (legacy mode), so their lots are still WRITTEN to Inventory.csv with a blank Product, and CCRS rejects such a row ("Product is required" [G L0578]; Inventory must name a product "already submitted \u2026 on the product.CSV" [G L0579-L0583]). Each row says why and lists its lots. Fix it in Menu review, publish, then rebuild.`
    : `${count} product(s) named by inventory lots are not visible items of the published menu, so Product.csv cannot carry them and their lots are left out of Inventory.csv (Inventory must name a product "already submitted \u2026 on the product.CSV" [G L0579-L0583]). Each row says why and lists its lots. Fix it in Menu review, publish, then rebuild.`;
}

/** The keys whose lots need the extra menu read (blank keys need none). */
export function keysNeedingMenuLookup(lots: readonly CoverageLot[], plannedKeys: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const l of lots) {
    const k = l.productKey.trim();
    if (k && !plannedKeys.has(k)) out.add(k);
  }
  return [...out].sort();
}

/** Build a readable MenuPresence from raw rows (keys trimmed here, once). */
export function menuPresenceFromRows(
  publishedVersionExists: boolean,
  visiblePublishedKeys: Iterable<string>,
  hiddenPublishedRows: readonly { source_item_id: string | null; hidden_reason: string | null }[],
  stagedRows: readonly { source_item_id: string | null }[],
): MenuPresence {
  const hidden = new Map<string, string | null>();
  for (const r of hiddenPublishedRows) {
    const k = (r.source_item_id ?? "").trim();
    if (k && !hidden.has(k)) hidden.set(k, r.hidden_reason);
  }
  const staged = new Set<string>();
  for (const r of stagedRows) {
    const k = (r.source_item_id ?? "").trim();
    if (k) staged.add(k);
  }
  const visible = new Set<string>();
  for (const v of visiblePublishedKeys) {
    const k = v.trim();
    if (k) visible.add(k);
  }
  return { readable: true, publishedVersionExists, visibleInPublished: visible, hiddenInPublished: hidden, inStaged: staged };
}

/* ------------------------------------------------------------------ *
 * Embedded pure self-tests (registered in run-pure-selftests.ts).
 * ------------------------------------------------------------------ */
export function __runCcrsLotProductTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", name);
    }
  };
  const p = menuPresenceFromRows(true, [" V1 "], [{ source_item_id: " H1 ", hidden_reason: "no_product_master" }], [{ source_item_id: "S1" }, { source_item_id: "H1" }]);
  ok(explainMissingProduct("", p).cls === "blank-key", "blank key");
  ok(explainMissingProduct("H1", p).cls === "hidden-in-published", "hidden wins over staged");
  ok(explainMissingProduct("H1", p).detail.includes("missing from the products file"), "hidden reason text");
  ok(explainMissingProduct("S1", p).cls === "staged-only", "staged only");
  ok(explainMissingProduct("X", p).cls === "no-menu-item", "no item");
  ok(explainMissingProduct("X", { readable: false, error: "boom" }).cls === "menu-unreadable", "unreadable");
  ok(explainMissingProduct("V1", p).cls === "visible-id-collision", "visible but not planned");
  ok(explainMissingProduct("X", menuPresenceFromRows(false, [], [], [])).cls === "no-published-menu", "no published");
  const rows = lotsWithProductNotInMenu(
    [
      { id: "1", label: "A", productKey: "K" },
      { id: "2", label: "B", productKey: "X" },
      { id: "3", label: "C", productKey: "X" },
      { id: "4", label: "D", productKey: "" },
    ],
    new Set(["K"]),
    p,
  );
  ok(rows.length === 2 && rows[0].id === "(blank)" && rows[1].id === "X", "one row per missing key, sorted");
  ok(rows[1].detail.endsWith("2 lot(s): B, C"), "lists every lot");
  ok(enrichLotWithholdReason("other", "X", p) === "other", "other reasons untouched");
  ok(enrichLotWithholdReason(LOT_PRODUCT_NOT_IN_MENU_REASON, "S1", p).startsWith(`${LOT_PRODUCT_NOT_IN_MENU_REASON} (only in a staged`), "enriched");
  ok(keysNeedingMenuLookup([{ id: "1", label: "", productKey: " X " }, { id: "2", label: "", productKey: "" }], new Set()).join() === "X", "lookup keys");
  const pl = new Map<string, { action: string; reason?: string }>([
    ["a", { action: "withhold", reason: LOT_PRODUCT_NOT_IN_MENU_REASON }],
    ["b", { action: "emit" }],
    ["c", { action: "withhold", reason: "uncertain" }],
  ]);
  ok(lotsWithheldForMissingProduct([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], pl).map((l) => l.id).join() === "a", "only plan-withheld-not-in-menu lots");
  const em = new Map<string, { action: string }>([["e1", { action: "emit" }], ["e2", { action: "emit" }], ["w", { action: "withhold" }]]);
  ok(
    legacyLotsWithBlankProduct([{ id: "e1", pos_product_key: " K " }, { id: "e2", pos_product_key: "X" }, { id: "w", pos_product_key: "X" }, { id: "n", pos_product_key: "X" }], em, new Set(["K"]))
      .map((l) => l.id)
      .join() === "e2",
    "legacy: only emitted lots whose key has no product plan",
  );
  ok(e47Message(2, true).includes("[G L0578]") && !e47Message(2, false).includes("[G L0578]"), "legacy message cites Product is required");
  if (failed === 0) console.log(`ccrs-lot-product-core: all ${passed} tests passed`);
  return { passed, failed };
}
