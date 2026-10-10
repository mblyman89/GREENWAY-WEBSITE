/**
 * R38 S1 — the inventory table's Website category, CONNECTED.
 *
 * Owner: "The inventory table has a blank for the website category column for
 * some reason. I want you to make sure all columns are properly connected."
 *
 * ROOT CAUSE (verified in code). The column read `onboarding_shelf`, which is
 * the approved draft's `chosen_website_category` and nothing else. That field
 * is only written when the approver PICKS a category on the onboarding card
 * (or recall supplies one because the resolver had no answer). Every lot
 * whose category was resolved automatically — by the type map or by a
 * published menu card — and every lot that was never onboarded (the Cultivera
 * import, manual adds) therefore showed an em-dash, even though the website
 * files it under a real category.
 *
 * THE FIX. Show the category the WEBSITE actually uses, with the source named,
 * in the same precedence the rest of the system already applies:
 *
 *   1. override       product_classification_overrides (owner re-filed it)
 *   2. menu_item      the published menu card's category (what shoppers see)
 *   3. onboarding     the approver's pick on the onboarding card
 *   4. inventory_type the owner's type map (Settings → Types / catalog)
 *   5. heuristic      read from the product name
 *   6. unmapped       no confident answer — flagged, never guessed
 *
 * Why the onboarding pick sits BELOW the menu and override: draft injection
 * (draft-injection-core.ts) writes the pick INTO menu_items at publish, so a
 * published card already carries it; and the resolver ranks the owner's
 * per-product override above everything. Why it sits ABOVE the type map and
 * heuristic: those are exactly the automatic answers a human pick exists to
 * correct (draft injection: `chosen_website_category ?? resolver`).
 *
 * PURE. No I/O. The page hands in the resolver's answer and the pick.
 */

export const EM_DASH = "\u2014";

export type LotWebsiteCategorySource =
  | "override"
  | "menu_item"
  | "onboarding"
  | "inventory_type"
  | "heuristic"
  | "unmapped";

/** The subset of WebsiteCategoryResolution this core reads. */
export type ResolverAnswer = {
  websiteCategory: string | null;
  label: string;
  raw: string | null;
  source: "override" | "menu_item" | "inventory_type" | "heuristic" | "unmapped";
  unmapped: boolean;
};

export type LotWebsiteCategory = {
  /** Website category value (taxonomy / owner-created), null when unmapped. */
  value: string | null;
  /** Display label, null when unmapped (the cell then says "Unmapped"). */
  label: string | null;
  source: LotWebsiteCategorySource;
  /** Short plain-English source chip shown under the value. */
  sourceText: string;
  /** Longer hover text: where the value came from and where to change it. */
  sourceTitle: string;
  unmapped: boolean;
  /** The raw LCB/POS inventory type the resolver started from (audit). */
  raw: string | null;
};

const SOURCE_TEXT: Record<LotWebsiteCategorySource, string> = {
  override: "your override",
  menu_item: "live menu",
  onboarding: "onboarding pick",
  inventory_type: "type map",
  heuristic: "product name",
  unmapped: "unmapped",
};

const SOURCE_TITLE: Record<LotWebsiteCategorySource, string> = {
  override: "You re-filed this product (Inventory detail → corrections). This beats every other source.",
  menu_item: "The category of this product's card on the published menu — what shoppers see.",
  onboarding: "Picked by the approver on the Product Onboarding card. It goes live with the next publish.",
  inventory_type: "From your inventory-type map (Settings → Types).",
  heuristic: "Read from the product name because no map entry covers this type. Map the type to make it certain.",
  unmapped: "No confident category. Map this inventory type in Settings → Types, or re-file the product.",
};

/** Plain-English chip for a source (exported for the export sheet). */
export function lotWebsiteCategorySourceText(s: LotWebsiteCategorySource): string {
  return SOURCE_TEXT[s];
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Decide the effective website category for one lot.
 *
 * @param resolved  the resolver's answer (null when it could not run — then
 *                  the onboarding pick is used if present, else unmapped).
 * @param pickValue the approved draft's chosen_website_category (raw value).
 * @param labelOf   value → label (taxonomy + owner-created categories).
 */
export function effectiveLotWebsiteCategory(
  resolved: ResolverAnswer | null | undefined,
  pickValue: string | null | undefined,
  labelOf: (value: string) => string,
): LotWebsiteCategory {
  const raw = resolved?.raw ?? null;
  const build = (value: string | null, label: string | null, source: LotWebsiteCategorySource): LotWebsiteCategory => ({
    value,
    label,
    source,
    sourceText: SOURCE_TEXT[source],
    sourceTitle: SOURCE_TITLE[source],
    unmapped: source === "unmapped",
    raw,
  });

  const resolvedValue = resolved && !resolved.unmapped ? clean(resolved.websiteCategory) : "";
  const resolvedLabel = resolvedValue ? clean(resolved?.label) || labelOf(resolvedValue) : "";

  // 1–2: an owner override or the live menu card is the truth on the website.
  if (resolvedValue && (resolved?.source === "override" || resolved?.source === "menu_item")) {
    return build(resolvedValue, resolvedLabel, resolved.source);
  }
  // 3: the human pick at onboarding outranks every automatic answer.
  const pick = clean(pickValue);
  if (pick) return build(pick, labelOf(pick), "onboarding");
  // 4–5: automatic answers.
  if (resolvedValue && (resolved?.source === "inventory_type" || resolved?.source === "heuristic")) {
    return build(resolvedValue, resolvedLabel, resolved.source);
  }
  // 6: never guess.
  return build(null, null, "unmapped");
}

/** The fields joined onto each lot (FilterableLot's optional keys). */
export type LotWebsiteCategoryFields = {
  website_category: string | null;
  website_category_value: string | null;
  website_category_source: LotWebsiteCategorySource;
  website_category_info: LotWebsiteCategory;
};

/** Attach the effective category to each lot (pure; input never mutated). */
export function attachLotWebsiteCategory<L extends object>(
  lots: readonly L[],
  resolutions: ReadonlyArray<ResolverAnswer | null | undefined>,
  picks: ReadonlyArray<string | null | undefined>,
  labelOf: (value: string) => string,
): Array<L & LotWebsiteCategoryFields> {
  return lots.map((lot, i) => {
    const info = effectiveLotWebsiteCategory(resolutions[i] ?? null, picks[i] ?? null, labelOf);
    return {
      ...lot,
      website_category: info.label,
      website_category_value: info.value,
      website_category_source: info.source,
      website_category_info: info,
    };
  });
}

// ---------------------------------------------------------------------------
// Self-tests (pure). Registered in scripts/compliance/run-pure-selftests.ts.
// ---------------------------------------------------------------------------
export function __runLotWebsiteCategoryTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL lot-website-category-core: " + msg);
    }
  };
  const L = (v: string) => ({ flower: "Flower", vape: "Vape", edible: "Edible" } as Record<string, string>)[v] ?? v;
  const r = (source: ResolverAnswer["source"], v: string | null): ResolverAnswer => ({
    websiteCategory: v,
    label: v ? L(v) : "Usable Marijuana",
    raw: "Usable Marijuana",
    source,
    unmapped: source === "unmapped",
  });

  // Override and menu beat the pick.
  const ov = effectiveLotWebsiteCategory(r("override", "vape"), "flower", L);
  ok(ov.value === "vape" && ov.source === "override" && ov.sourceText === "your override", "override beats pick");
  const mi = effectiveLotWebsiteCategory(r("menu_item", "edible"), "flower", L);
  ok(mi.value === "edible" && mi.label === "Edible" && mi.source === "menu_item", "menu beats pick");
  // Pick beats automatic answers.
  const pt = effectiveLotWebsiteCategory(r("inventory_type", "vape"), "flower", L);
  ok(pt.value === "flower" && pt.label === "Flower" && pt.source === "onboarding", "pick beats type map");
  const ph = effectiveLotWebsiteCategory(r("heuristic", "vape"), " flower ", L);
  ok(ph.value === "flower" && ph.source === "onboarding", "pick beats heuristic (trimmed)");
  const pu = effectiveLotWebsiteCategory(r("unmapped", null), "flower", L);
  ok(pu.value === "flower" && !pu.unmapped, "pick rescues unmapped");
  // Automatic answers when there is no pick.
  const t = effectiveLotWebsiteCategory(r("inventory_type", "vape"), null, L);
  ok(t.value === "vape" && t.source === "inventory_type" && t.sourceText === "type map", "type map");
  const h = effectiveLotWebsiteCategory(r("heuristic", "edible"), "", L);
  ok(h.value === "edible" && h.source === "heuristic", "blank pick ignored → heuristic");
  // Unmapped: never guessed, raw kept.
  const u = effectiveLotWebsiteCategory(r("unmapped", null), null, L);
  ok(u.value === null && u.label === null && u.unmapped && u.source === "unmapped" && u.raw === "Usable Marijuana", "unmapped");
  // Resolver absent → pick or unmapped.
  ok(effectiveLotWebsiteCategory(null, "vape", L).source === "onboarding", "no resolver → pick");
  ok(effectiveLotWebsiteCategory(undefined, null, L).source === "unmapped", "no resolver, no pick → unmapped");
  // A resolver answer marked unmapped is never used even if it names a value.
  const bad = { ...r("menu_item", "vape"), unmapped: true };
  ok(effectiveLotWebsiteCategory(bad, null, L).source === "unmapped", "unmapped flag wins");
  // Label falls back to labelOf when the resolver label is blank.
  const nolab = { ...r("inventory_type", "edible"), label: "" };
  ok(effectiveLotWebsiteCategory(nolab, null, L).label === "Edible", "labelOf fallback");
  // Every source has a title.
  for (const s of ["override", "menu_item", "onboarding", "inventory_type", "heuristic", "unmapped"] as const) {
    ok(lotWebsiteCategorySourceText(s).length > 0, `source text ${s}`);
  }
  // attach: aligned by index, pure.
  const lots = [{ id: "a" }, { id: "b" }];
  const joined = attachLotWebsiteCategory(lots, [r("menu_item", "vape"), null], [null, "flower"], L);
  ok(joined[0].website_category === "Vape" && joined[0].website_category_source === "menu_item", "attach row 0");
  ok(joined[1].website_category === "Flower" && joined[1].website_category_value === "flower", "attach row 1");
  ok(!("website_category" in lots[0]), "input not mutated");
  return { passed, failed };
}
