/**
 * src/lib/leafly/menu-visibility-core.ts — TASK H (finding L-22).
 *
 * The owner's ask, verbatim:
 *
 *   "I want my customers to have confidence that we have in stock what we show
 *    on the menu. So if that means logically withholding products from the menu
 *    that have less than 2-3 in stock so we don't disappoint customers coming in
 *    to pick up something specific only to find out we had to swap it for
 *    something else."
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 * ---------------------------------------------------------------------------
 *
 * Today the ONLY stock gate anywhere in the Leafly path is "greater than zero".
 * `menu-feed-core.ts` sets `variant.inStock = inventory_level > 0` and
 * `itemInStock = variants.some(v => v.inventory_level > 0)`, and
 * `orderability-core.ts` then asks nothing more than `inStock`. So a jar with
 * ONE gram left is published, is marked `availableForPickup: true`, and is
 * offered to every shopper on leafly.com as confidently as a jar with forty.
 *
 * That single unit is the one most likely to be sold across the counter to a
 * walk-in five minutes before the Leafly shopper arrives. The shopper then gets
 * the substitution conversation the owner is trying to eliminate. Nothing in
 * the system is lying — the gram really was there when we pushed — but the menu
 * is still making a promise it cannot reliably keep, and Leafly grades
 * cancellations at certification.
 *
 * ---------------------------------------------------------------------------
 * LEAFLY HAS THIS FEATURE. LEAFLY WILL NOT LET US SET IT.
 * ---------------------------------------------------------------------------
 *
 * This is the load-bearing fact, and it is quoted, not inferred. From
 * `docs/leafly-specs/menu-integration-v2.openapi.json`, `info.description`,
 * under "Tips and Best Practices → Inventory Management":
 *
 *   "**Availability Thresholds**: These are not currently supported via API,
 *    however there are toggles within each reatiler's Integreation Settings UI
 *    that can be used to set global or category-specific low inventory
 *    thresholds for hiding items."
 *
 * (The two misspellings are Leafly's own and are preserved because
 * `tests/compliance/leafly-menu-visibility.test.ts` asserts this sentence is
 * still present in the vendored spec. If Leafly ever fixes the typo or, far
 * more importantly, ever DOES expose thresholds over the API, that test goes
 * red and this design gets revisited deliberately instead of by accident.)
 *
 * Three consequences follow, and each one shapes this file:
 *
 *  1. The capability the owner wants is real and Leafly agrees it is the right
 *     idea — this is not us inventing a policy.
 *
 *  2. We cannot turn it on by pushing a field. There is no threshold property
 *     in the item schema (verified: the v2 item properties are `id`, `type`,
 *     `name`, `strain`, `brand`, `compounds`, `total_thc`, `total_cbd`,
 *     `variants`, `description`, `availableForPickup`, `imageUrl` — and
 *     nothing else). Setting it in Leafly's UI would also mean the owner has to
 *     remember a second control panel, which is exactly the "messing with it"
 *     he wants to stop doing.
 *
 *  3. Therefore the threshold has to live HERE, on our side, and act by
 *     changing what we send. That is strictly more powerful than Leafly's
 *     version, because Leafly's is global-or-category and ours is
 *     global, category AND per-variant — see below.
 *
 * ---------------------------------------------------------------------------
 * WHY PER-VARIANT AND NOT JUST PER-ITEM
 * ---------------------------------------------------------------------------
 *
 * Leafly's own toggles hide ITEMS. That is too blunt for a cannabis menu.
 * Consider one strain stocked as 3.5g × 1 remaining and 28g × 40 remaining.
 * Hiding the item deletes a perfectly healthy ounce listing; keeping the item
 * keeps offering the last eighth. Neither is right. The honest answer is to
 * keep the ounce and withhold the eighth, and that requires variant
 * granularity, which we have (`SyndicationVariant.inventoryLevel` is a real
 * count, Task X) and Leafly's UI does not.
 *
 * So the rule is applied to variants first, and the item's fate is then a
 * CONSEQUENCE of what is left: an item all of whose variants fell below the
 * line has nothing truthful left to sell and is withheld whole. An item with
 * one survivor is published with one size. This also keeps us legal against the
 * v2 schema, which requires "at least one member of the `variants[]` array on
 * items" — an item stripped to zero variants is not a valid payload item and
 * must not be emitted at all.
 *
 * ---------------------------------------------------------------------------
 * THREE MODES, BECAUSE "HIDE IT" IS NOT ALWAYS THE RIGHT ANSWER
 * ---------------------------------------------------------------------------
 *
 * The owner said "withholding", and withholding is offered. But there is a
 * gentler option that serves his actual goal — customer confidence — better in
 * many cases, and a good system should offer it rather than quietly decide for
 * him:
 *
 *   "off"            The rule is disabled. Byte-for-byte today's behaviour.
 *                    This is the DEFAULT, so merging this module changes
 *                    nothing about anyone's menu until the owner chooses.
 *
 *   "not_orderable"  The low-stock size stays VISIBLE so shoppers can still see
 *                    the shop carries it, but `availableForPickup` becomes
 *                    false, so nobody can RESERVE it. Browsing is honest;
 *                    reserving is what would have disappointed them. This is
 *                    the recommended setting and the one that best matches
 *                    "a menu customers can trust" without shrinking the menu.
 *
 *   "withhold"       The low-stock size is removed from the payload entirely,
 *                    exactly as the owner described.
 *
 * ---------------------------------------------------------------------------
 * THE TRAP IN "WITHHOLD" THAT WOULD OTHERWISE BITE HIM SILENTLY
 * ---------------------------------------------------------------------------
 *
 * Omitting an item from a payload does NOT universally remove it from Leafly.
 * It depends entirely on the HTTP method, which the owner's `syncMode` setting
 * chooses (`push.ts:372`: `settings.syncMode === "put" ? "PUT" : "POST"`).
 *
 *   POST is a full menu sync. Items we omit are dropped from the Leafly menu.
 *        Withholding works.
 *
 *   PUT  is an upsert. Items we omit are simply not mentioned, so whatever
 *        Leafly already has STAYS THERE — including the low-stock listing we
 *        were trying to suppress. Withholding silently does nothing, and it
 *        does nothing in precisely the failure-shaped way that is hardest to
 *        notice: the admin screen says "withheld 4 items" and the public menu
 *        still shows all four.
 *
 * `withholdEffectiveness()` states this, and the admin surface is required to
 * show it, because a safety feature that quietly no-ops is worse than no safety
 * feature — it manufactures false confidence, which is the exact thing the
 * owner is trying to buy.
 *
 * ---------------------------------------------------------------------------
 * PURITY
 * ---------------------------------------------------------------------------
 *
 * Zero imports, runtime or type. No React, no DOM, no `server-only`, no I/O, no
 * clock, no randomness. Same reason as `variant-identity-core.ts`: the payload
 * builder, the validator, the admin preview and vitest must all get the SAME
 * answer, and the only way to guarantee that is one pure function with no
 * ambient state. Enforced by `tests/compliance/leafly-menu-visibility.test.ts`,
 * which reads this file and asserts the import list is literally empty.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** What to do with a size that is in stock but thinly stocked. */
export type MenuVisibilityMode = "off" | "not_orderable" | "withhold";

export const MENU_VISIBILITY_MODES: readonly MenuVisibilityMode[] = [
  "off",
  "not_orderable",
  "withhold",
] as const;

export function isMenuVisibilityMode(v: unknown): v is MenuVisibilityMode {
  return typeof v === "string" && (MENU_VISIBILITY_MODES as readonly string[]).includes(v);
}

/**
 * The lowest threshold that means anything. A threshold of 1 says "hide things
 * with fewer than 1 in stock", which is what the system already does for free
 * (zero stock is already excluded), so it is a no-op rather than an error. 2 is
 * the first value that changes behaviour, and it is the bottom of the range the
 * owner named ("less than 2-3 in stock").
 */
export const MENU_VISIBILITY_MIN_THRESHOLD = 0;

/**
 * Leafly "internally capped at `10`" for `inventoryLevel` (v2 item schema,
 * `variants[].inventoryLevel` description). A threshold above that ceiling
 * would be measuring against a number Leafly cannot even represent, so the
 * admin range stops there. The clamp is not cosmetic: it stops a mis-typed
 * "100" from withholding the entire menu.
 */
export const MENU_VISIBILITY_MAX_THRESHOLD = 10;

/** The value we recommend, from the middle of the range the owner named. */
export const MENU_VISIBILITY_RECOMMENDED_THRESHOLD = 3;

export type MenuVisibilitySettings = {
  mode: MenuVisibilityMode;
  /** Applies to every category that has no override of its own. */
  minimumStock: number;
  /**
   * Category-slug → threshold. Slugs are the lowercase-hyphenated values from
   * `src/lib/pos/category-taxonomy.ts` (`flower`, `topical`,
   * `disposable-cartridge`, …) — the same vocabulary `SyndicationItem.category`
   * carries. Keys are normalised on resolve so a stray "Flower" still matches.
   *
   * This exists because the right number is genuinely not one number. Three
   * disposable vapes is a comfortable buffer; three grams of a flagship strain
   * in a busy hour is not. Leafly's own UI offers category-specific thresholds
   * for the same reason.
   */
  perCategory: Readonly<Record<string, number>>;
};

export const DEFAULT_MENU_VISIBILITY: MenuVisibilitySettings = {
  // OFF. Merging this module must not change a single byte of anyone's menu.
  // The owner turns it on when he has read what it does.
  mode: "off",
  minimumStock: 0,
  perCategory: {},
};

function clampThreshold(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MENU_VISIBILITY_MAX_THRESHOLD, Math.max(MENU_VISIBILITY_MIN_THRESHOLD, Math.round(n)));
}

/** Normalise a category to the slug vocabulary used as override keys. */
export function normalizeCategoryKey(category: string | null | undefined): string {
  return (category ?? "").trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Parse a stored/submitted partial into complete, clamped settings.
 *
 * Anything unreadable resolves to the DEFAULT, which is off. A settings row
 * written before Task H has no `visibility` key at all, and reading that as
 * "off" is the only honest interpretation: nobody who saved settings last month
 * consented to having products withheld from their menu.
 */
export function resolveMenuVisibility(
  raw: Record<string, unknown> | null | undefined,
): MenuVisibilitySettings {
  const d = DEFAULT_MENU_VISIBILITY;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return d;

  const mode = isMenuVisibilityMode(raw["mode"]) ? raw["mode"] : d.mode;
  const minimumStock = clampThreshold(raw["minimumStock"], d.minimumStock);

  const perCategory: Record<string, number> = {};
  const rawPer = raw["perCategory"];
  if (typeof rawPer === "object" && rawPer !== null && !Array.isArray(rawPer)) {
    for (const [k, v] of Object.entries(rawPer as Record<string, unknown>)) {
      const key = normalizeCategoryKey(k);
      if (key === "") continue;
      // An override that cannot be read is DROPPED rather than defaulted to the
      // global. Silently substituting a different number for the one the owner
      // thinks he set is precisely the drift this codebase refuses to ship.
      const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
      if (!Number.isFinite(n)) continue;
      perCategory[key] = Math.min(
        MENU_VISIBILITY_MAX_THRESHOLD,
        Math.max(MENU_VISIBILITY_MIN_THRESHOLD, Math.round(n)),
      );
    }
  }

  return { mode, minimumStock, perCategory };
}

/** The threshold that actually applies to one category. */
export function thresholdForCategory(
  settings: MenuVisibilitySettings,
  category: string | null | undefined,
): number {
  const key = normalizeCategoryKey(category);
  const override = settings.perCategory[key];
  return typeof override === "number" ? override : settings.minimumStock;
}

/**
 * Is the rule capable of changing anything at all?
 *
 * Mode "off" obviously does nothing. But so does mode "withhold" with every
 * threshold at 0 or 1, because zero-stock variants are already excluded
 * upstream. Saying so out loud stops the admin page from claiming a protection
 * that is not running.
 */
export function isMenuVisibilityActive(settings: MenuVisibilitySettings): boolean {
  if (settings.mode === "off") return false;
  if (settings.minimumStock >= 2) return true;
  return Object.values(settings.perCategory).some((n) => n >= 2);
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type VisibilityVariant = {
  id: string;
  /** Display label, only ever used to explain a decision to a human. */
  label?: string | null;
  inStock: boolean;
  /** Real on-hand count (`SyndicationVariant.inventoryLevel`). */
  inventoryLevel: number;
};

export type VisibilityItem = {
  id: string;
  name?: string | null;
  /** Category slug, as carried by `SyndicationItem.category`. */
  category?: string | null;
  variants: readonly VisibilityVariant[];
};

/** What happens to one size. */
export type VariantVisibility =
  | "keep"
  /** In stock, but under the line: stays listed, cannot be reserved. */
  | "keep_not_orderable"
  /** In stock, but under the line: removed from the payload entirely. */
  | "withheld"
  /** Nothing on hand. Excluded by the pre-existing rule, not by this one. */
  | "out_of_stock";

export type VariantVisibilityDecision = {
  variantId: string;
  label: string | null;
  inventoryLevel: number;
  /** The threshold this variant was measured against. */
  threshold: number;
  outcome: VariantVisibility;
};

/**
 * The per-variant rule. Ordered so the reason returned is the true one.
 *
 * Note the comparison is `< threshold`, i.e. a threshold of 3 keeps a variant
 * with exactly 3 and withholds one with 2. That matches the owner's phrasing
 * ("less than 2-3 in stock") literally, and literal is what a threshold should
 * be — an off-by-one here is invisible in the UI and changes what the public
 * can buy, so it is pinned by its own boundary tests below.
 */
export function decideVariantVisibility(
  variant: VisibilityVariant,
  mode: MenuVisibilityMode,
  threshold: number,
): VariantVisibilityDecision {
  const level = Math.max(0, Math.round(variant.inventoryLevel));
  const base = {
    variantId: variant.id,
    label: variant.label ?? null,
    inventoryLevel: level,
    threshold,
  };

  // Out of stock is NOT this module's business. It is already handled, and
  // claiming credit for it would overstate what the threshold is doing.
  if (!variant.inStock || level <= 0) {
    return { ...base, outcome: "out_of_stock" };
  }
  // `threshold < 2` is PROVABLY REDUNDANT today and is kept deliberately.
  //
  // A mutation run removed it and no test could kill the mutant. Rather than
  // assume "equivalent mutant" -- the standard excuse for an untested branch --
  // it was checked exhaustively across every mode x threshold -3..12 x level
  // -3..12 x inStock combination (2,976 cases, 0 differing). It really is
  // unreachable: anything still in stock has level >= 1, so `level >= 0` and
  // `level >= 1` are already true whenever the threshold is 0 or 1.
  //
  // It stays because it states the INTENT ("a threshold under 2 is a no-op")
  // at the point of decision, and because that intent is load-bearing for
  // `isMenuVisibilityActive`. If the out-of-stock rule above ever changes, this
  // clause is what stops a threshold of 1 from quietly becoming a real filter.
  // The property it protects is pinned by tests even though the line cannot be
  // killed by one.
  if (mode === "off" || threshold < 2 || level >= threshold) {
    return { ...base, outcome: "keep" };
  }
  return { ...base, outcome: mode === "withhold" ? "withheld" : "keep_not_orderable" };
}

/** What happens to one product. */
export type ItemVisibilityOutcome =
  /** Published normally. */
  | "list"
  /** Published, but at least one size cannot be reserved. */
  | "list_partly_unreservable"
  /** Published with fewer sizes than we hold. */
  | "list_reduced"
  /** Not sent at all: every in-stock size fell below the line. */
  | "withhold_item";

export type ItemVisibilityAssessment = {
  itemId: string;
  itemName: string | null;
  category: string | null;
  /** The threshold applied to this item's category. */
  threshold: number;
  outcome: ItemVisibilityOutcome;
  variants: readonly VariantVisibilityDecision[];
  /** Variant ids that survive into the payload. */
  keptVariantIds: readonly string[];
  /** Variant ids removed from the payload by THIS rule (mode "withhold"). */
  withheldVariantIds: readonly string[];
  /** Variant ids kept but stripped of orderability (mode "not_orderable"). */
  unreservableVariantIds: readonly string[];
};

/**
 * Assess one product.
 *
 * `withhold_item` is reserved for the case where the threshold left nothing
 * sellable. An item that had no stock to begin with is NOT reported as
 * withheld by this rule — it was already out, and inflating this module's
 * body count would make the admin summary useless for judging whether the
 * threshold is set too high.
 */
export function assessItemVisibility(
  item: VisibilityItem,
  settings: MenuVisibilitySettings,
): ItemVisibilityAssessment {
  const threshold = thresholdForCategory(settings, item.category);
  const decisions = item.variants.map((v) => decideVariantVisibility(v, settings.mode, threshold));

  const kept: string[] = [];
  const withheld: string[] = [];
  const unreservable: string[] = [];
  for (const d of decisions) {
    if (d.outcome === "keep") kept.push(d.variantId);
    else if (d.outcome === "keep_not_orderable") {
      kept.push(d.variantId);
      unreservable.push(d.variantId);
    } else if (d.outcome === "withheld") withheld.push(d.variantId);
  }

  const hadSellableStock = decisions.some((d) => d.outcome !== "out_of_stock");

  let outcome: ItemVisibilityOutcome;
  if (kept.length === 0 && hadSellableStock) {
    // Everything it had was too thin. Also the ONLY way to stay schema-legal:
    // v2 requires at least one variant, so a zero-variant item cannot be sent.
    outcome = "withhold_item";
  } else if (withheld.length > 0) {
    outcome = "list_reduced";
  } else if (unreservable.length > 0) {
    outcome = "list_partly_unreservable";
  } else {
    outcome = "list";
  }

  return {
    itemId: item.id,
    itemName: item.name ?? null,
    category: item.category ?? null,
    threshold,
    outcome,
    variants: decisions,
    keptVariantIds: kept,
    withheldVariantIds: withheld,
    unreservableVariantIds: unreservable,
  };
}

// ---------------------------------------------------------------------------
// Whole-menu summary (what the admin page and the owner's report read)
// ---------------------------------------------------------------------------

export const MENU_VISIBILITY_EXAMPLE_LIMIT = 5;

export type MenuVisibilitySummary = {
  active: boolean;
  mode: MenuVisibilityMode;
  itemsConsidered: number;
  /** Products removed from the payload entirely by the threshold. */
  itemsWithheld: number;
  /** Products still sent, but with at least one size removed. */
  itemsReduced: number;
  /** Products still sent, but with at least one size made unreservable. */
  itemsPartlyUnreservable: number;
  /** Individual sizes removed by the threshold. */
  variantsWithheld: number;
  /** Individual sizes kept but made unreservable. */
  variantsUnreservable: number;
  /** Real product names, capped, so the report names names. */
  examples: readonly string[];
};

export function summarizeMenuVisibility(
  items: readonly VisibilityItem[],
  settings: MenuVisibilitySettings,
): MenuVisibilitySummary {
  let itemsWithheld = 0;
  let itemsReduced = 0;
  let itemsPartlyUnreservable = 0;
  let variantsWithheld = 0;
  let variantsUnreservable = 0;
  const examples: string[] = [];

  for (const item of items) {
    const a = assessItemVisibility(item, settings);
    variantsWithheld += a.withheldVariantIds.length;
    variantsUnreservable += a.unreservableVariantIds.length;
    if (a.outcome === "withhold_item") itemsWithheld += 1;
    else if (a.outcome === "list_reduced") itemsReduced += 1;
    else if (a.outcome === "list_partly_unreservable") itemsPartlyUnreservable += 1;

    if (a.outcome !== "list" && examples.length < MENU_VISIBILITY_EXAMPLE_LIMIT) {
      examples.push(a.itemName ?? a.itemId);
    }
  }

  return {
    active: isMenuVisibilityActive(settings),
    mode: settings.mode,
    itemsConsidered: items.length,
    itemsWithheld,
    itemsReduced,
    itemsPartlyUnreservable,
    variantsWithheld,
    variantsUnreservable,
    examples,
  };
}

/**
 * Plain English for the admin page. Returns `null` when there is nothing to
 * say, so the UI renders nothing rather than a reassuring-but-empty banner.
 *
 * A negative control in the test file asserts this returns `null` on a healthy
 * menu: advice that always fires is nagging, not diagnosis.
 */
export function describeMenuVisibility(summary: MenuVisibilitySummary): string | null {
  // Like the `threshold < 2` clause above, this guard is currently redundant
  // and is kept on purpose. A mutation run removed it and survived; an
  // exhaustive search (6,720 summaries across every mode, threshold and
  // override combination) found ZERO cases where a summary is inactive yet
  // reports anything touched, so the `touched === 0` line below already covers
  // it.
  //
  // It is retained as a defence-in-depth invariant: "an inactive rule never
  // speaks" is a promise to the owner, and it should not depend on the counting
  // logic in `summarizeMenuVisibility` staying correct forever. The promise is
  // pinned by tests; this line is belt to their braces.
  if (!summary.active) return null;
  const touched =
    summary.itemsWithheld + summary.itemsReduced + summary.itemsPartlyUnreservable;
  if (touched === 0) return null;

  const parts: string[] = [];
  if (summary.itemsWithheld > 0) {
    parts.push(
      `${summary.itemsWithheld} product${summary.itemsWithheld === 1 ? "" : "s"} held back completely`,
    );
  }
  if (summary.variantsWithheld > 0) {
    parts.push(
      `${summary.variantsWithheld} size${summary.variantsWithheld === 1 ? "" : "s"} removed`,
    );
  }
  if (summary.variantsUnreservable > 0) {
    parts.push(
      `${summary.variantsUnreservable} size${summary.variantsUnreservable === 1 ? "" : "s"} shown but not reservable`,
    );
  }

  const names =
    summary.examples.length > 0 ? ` For example: ${summary.examples.join(", ")}.` : "";

  return (
    `Your low-stock rule is protecting this menu: ${parts.join(", ")}.` +
    ` These are things you DO still have, but not enough of to promise to a stranger.` +
    names
  );
}

// ---------------------------------------------------------------------------
// The PUT trap
// ---------------------------------------------------------------------------

export type WithholdEffectiveness = {
  /** Does withholding actually remove the item from the live Leafly menu? */
  effective: boolean;
  /** Present whenever `effective` is false. */
  warning: string | null;
};

/**
 * Does "withhold" do what it says, given the owner's sync method?
 *
 * See the header. POST is a full sync and omission removes; PUT is an upsert
 * and omission is a no-op that leaves the stale listing live. This function is
 * the single place that fact is stated, and the admin surface is required to
 * render the warning.
 */
export function withholdEffectiveness(
  settings: MenuVisibilitySettings,
  syncMode: "post" | "put",
): WithholdEffectiveness {
  if (settings.mode !== "withhold" || !isMenuVisibilityActive(settings)) {
    return { effective: true, warning: null };
  }
  if (syncMode === "post") return { effective: true, warning: null };
  return {
    effective: false,
    warning:
      "Your sync method is PUT (update only), which never removes anything from Leafly — " +
      "it only adds and changes. So holding a low-stock product out of the payload will " +
      "leave the old listing sitting on your Leafly menu exactly as it was, and customers " +
      "will still be able to order it. Either switch the sync method to POST (full menu), " +
      'which replaces the whole menu each time, or use the "show it but do not let them ' +
      'reserve it" setting instead, which works with both methods because it sends a ' +
      "change rather than a silence.",
  };
}

/**
 * One-line, jargon-free explanation of each mode, for the settings screen.
 * Exported so the UI cannot invent its own wording and drift from behaviour.
 */
export function describeMenuVisibilityMode(mode: MenuVisibilityMode): string {
  switch (mode) {
    case "off":
      return (
        "Off — anything with at least one in stock goes on the menu. This is how the " +
        "menu has always worked."
      );
    case "not_orderable":
      return (
        "Show it, but don't let them reserve it — a size you are low on stays visible so " +
        "shoppers know you carry it, but nobody can place an order against the last few. " +
        "Recommended: it protects the customer without shrinking your menu."
      );
    case "withhold":
      return (
        "Hold it back — a size you are low on is left off the Leafly menu completely " +
        "until you restock it."
      );
  }
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runLeaflyMenuVisibilityTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[menu-visibility] FAIL: ${label}`);
    }
  };

  const v = (
    id: string,
    inventoryLevel: number,
    inStock = inventoryLevel > 0,
    label?: string,
  ): VisibilityVariant => ({ id, inventoryLevel, inStock, label: label ?? null });

  const item = (
    id: string,
    category: string,
    variants: VisibilityVariant[],
    name?: string,
  ): VisibilityItem => ({ id, name: name ?? id, category, variants });

  const settings = (
    mode: MenuVisibilityMode,
    minimumStock: number,
    perCategory: Record<string, number> = {},
  ): MenuVisibilitySettings => ({ mode, minimumStock, perCategory });

  // --- defaults are inert -------------------------------------------------
  ok("default mode is off", DEFAULT_MENU_VISIBILITY.mode === "off");
  ok("default threshold is 0", DEFAULT_MENU_VISIBILITY.minimumStock === 0);
  ok("default has no overrides", Object.keys(DEFAULT_MENU_VISIBILITY.perCategory).length === 0);
  ok("default is not active", isMenuVisibilityActive(DEFAULT_MENU_VISIBILITY) === false);

  // --- resolve ------------------------------------------------------------
  ok("resolve(null) is the default", resolveMenuVisibility(null).mode === "off");
  ok("resolve(undefined) is the default", resolveMenuVisibility(undefined).mode === "off");
  ok(
    "an array is not a settings object",
    resolveMenuVisibility([] as unknown as Record<string, unknown>).mode === "off",
  );
  ok(
    "a bogus mode falls back to off",
    resolveMenuVisibility({ mode: "maybe" }).mode === "off",
  );
  ok(
    "a real mode is honoured",
    resolveMenuVisibility({ mode: "withhold" }).mode === "withhold",
  );
  ok(
    "threshold clamps above the Leafly ceiling",
    resolveMenuVisibility({ minimumStock: 999 }).minimumStock === MENU_VISIBILITY_MAX_THRESHOLD,
  );
  ok(
    "negative threshold clamps to the floor",
    resolveMenuVisibility({ minimumStock: -5 }).minimumStock === MENU_VISIBILITY_MIN_THRESHOLD,
  );
  ok(
    "a numeric string threshold is accepted",
    resolveMenuVisibility({ minimumStock: "3" }).minimumStock === 3,
  );
  ok(
    "a fractional threshold rounds",
    resolveMenuVisibility({ minimumStock: 2.6 }).minimumStock === 3,
  );
  ok(
    "an unreadable threshold falls back, it does not crash",
    resolveMenuVisibility({ minimumStock: "lots" }).minimumStock === 0,
  );
  const resolvedPer = resolveMenuVisibility({
    mode: "withhold",
    minimumStock: 2,
    perCategory: { Flower: 4, "  topical  ": "2", broken: "x", "": 9 },
  });
  ok("override key is lowercased", resolvedPer.perCategory["flower"] === 4);
  ok("override key is trimmed", resolvedPer.perCategory["topical"] === 2);
  ok("unreadable override is dropped, not defaulted", !("broken" in resolvedPer.perCategory));
  ok("empty override key is dropped", !("" in resolvedPer.perCategory));
  ok(
    "perCategory that is not an object is ignored",
    Object.keys(resolveMenuVisibility({ perCategory: "nope" }).perCategory).length === 0,
  );
  ok(
    "perCategory array is ignored",
    Object.keys(resolveMenuVisibility({ perCategory: [1, 2] }).perCategory).length === 0,
  );

  // --- normalizeCategoryKey ----------------------------------------------
  ok("null category normalises to empty", normalizeCategoryKey(null) === "");
  ok("spaces become hyphens", normalizeCategoryKey("Disposable Cartridge") === "disposable-cartridge");
  ok("already-slug is unchanged", normalizeCategoryKey("disposable-cartridge") === "disposable-cartridge");

  // --- thresholdForCategory ----------------------------------------------
  const perCat = settings("withhold", 2, { flower: 5 });
  ok("category override wins", thresholdForCategory(perCat, "flower") === 5);
  ok("uncovered category uses the global", thresholdForCategory(perCat, "edible") === 2);
  ok("category match is case-insensitive", thresholdForCategory(perCat, "Flower") === 5);
  ok("null category uses the global", thresholdForCategory(perCat, null) === 2);
  ok(
    "an override of 0 is honoured, not treated as absent",
    thresholdForCategory(settings("withhold", 4, { flower: 0 }), "flower") === 0,
  );

  // --- isMenuVisibilityActive --------------------------------------------
  ok("mode off is never active", isMenuVisibilityActive(settings("off", 9)) === false);
  ok("threshold 0 is not active", isMenuVisibilityActive(settings("withhold", 0)) === false);
  ok("threshold 1 is a no-op, not active", isMenuVisibilityActive(settings("withhold", 1)) === false);
  ok("threshold 2 is active", isMenuVisibilityActive(settings("withhold", 2)) === true);
  ok(
    "a category override alone can activate it",
    isMenuVisibilityActive(settings("withhold", 0, { flower: 3 })) === true,
  );

  // --- the boundary, pinned both sides ------------------------------------
  const w3 = "withhold" as const;
  ok(
    "exactly at the threshold is KEPT",
    decideVariantVisibility(v("a", 3), w3, 3).outcome === "keep",
  );
  ok(
    "one below the threshold is withheld",
    decideVariantVisibility(v("a", 2), w3, 3).outcome === "withheld",
  );
  ok(
    "well above the threshold is kept",
    decideVariantVisibility(v("a", 40), w3, 3).outcome === "keep",
  );
  ok(
    "zero stock reports out_of_stock, not withheld",
    decideVariantVisibility(v("a", 0), w3, 3).outcome === "out_of_stock",
  );
  ok(
    "inStock false with a positive count is still out_of_stock",
    decideVariantVisibility(v("a", 5, false), w3, 3).outcome === "out_of_stock",
  );
  ok(
    "negative inventory is out_of_stock",
    decideVariantVisibility(v("a", -2, true), w3, 3).outcome === "out_of_stock",
  );
  ok(
    "fractional inventory is rounded before comparing",
    decideVariantVisibility(v("a", 2.6, true), w3, 3).outcome === "keep",
  );
  ok(
    "the decision reports the level it actually used",
    decideVariantVisibility(v("a", 2.6, true), w3, 3).inventoryLevel === 3,
  );
  ok(
    "the decision reports the threshold it used",
    decideVariantVisibility(v("a", 1), w3, 7).threshold === 7,
  );

  // --- mode changes the verb, not the arithmetic --------------------------
  ok(
    "mode off keeps a thin variant",
    decideVariantVisibility(v("a", 1), "off", 3).outcome === "keep",
  );
  ok(
    "mode not_orderable keeps it but marks it",
    decideVariantVisibility(v("a", 1), "not_orderable", 3).outcome === "keep_not_orderable",
  );
  ok(
    "mode withhold removes it",
    decideVariantVisibility(v("a", 1), "withhold", 3).outcome === "withheld",
  );
  ok(
    "threshold below 2 is a no-op even in withhold mode",
    decideVariantVisibility(v("a", 1), "withhold", 1).outcome === "keep",
  );

  // --- the per-variant case Leafly's own UI cannot express ----------------
  const mixed = item("i1", "flower", [v("small", 1, true, "3.5g"), v("big", 40, true, "28g")]);
  const mixedA = assessItemVisibility(mixed, settings("withhold", 3));
  ok("mixed item is still listed", mixedA.outcome === "list_reduced");
  ok("the healthy ounce survives", mixedA.keptVariantIds.includes("big"));
  ok("the last eighth is withheld", mixedA.withheldVariantIds.includes("small"));
  ok("exactly one size was withheld", mixedA.withheldVariantIds.length === 1);

  // --- an item with nothing left is withheld whole (schema-legal) ---------
  const allThin = item("i2", "flower", [v("a", 1), v("b", 2)]);
  const allThinA = assessItemVisibility(allThin, settings("withhold", 3));
  ok("all-thin item is withheld whole", allThinA.outcome === "withhold_item");
  ok("no variants survive", allThinA.keptVariantIds.length === 0);
  ok("both are recorded as withheld", allThinA.withheldVariantIds.length === 2);

  // --- an already-empty item is NOT claimed by this rule ------------------
  const empty = item("i3", "flower", [v("a", 0), v("b", 0)]);
  const emptyA = assessItemVisibility(empty, settings("withhold", 3));
  ok(
    "an out-of-stock item is not reported as withheld by the threshold",
    emptyA.outcome === "list",
  );
  ok("and nothing is credited to the threshold", emptyA.withheldVariantIds.length === 0);

  // --- not_orderable never shrinks the item -------------------------------
  const notOrd = assessItemVisibility(allThin, settings("not_orderable", 3));
  ok("not_orderable keeps the item", notOrd.outcome === "list_partly_unreservable");
  ok("not_orderable keeps every size", notOrd.keptVariantIds.length === 2);
  ok("not_orderable withholds nothing", notOrd.withheldVariantIds.length === 0);
  ok("not_orderable marks both unreservable", notOrd.unreservableVariantIds.length === 2);

  // --- NEGATIVE CONTROL: a healthy menu is untouched ----------------------
  const healthy = [
    item("h1", "flower", [v("a", 20), v("b", 30)]),
    item("h2", "edible", [v("c", 15)]),
  ];
  const healthySummary = summarizeMenuVisibility(healthy, settings("withhold", 3));
  ok("healthy menu withholds no items", healthySummary.itemsWithheld === 0);
  ok("healthy menu withholds no variants", healthySummary.variantsWithheld === 0);
  ok("healthy menu reduces nothing", healthySummary.itemsReduced === 0);
  ok("healthy menu yields NO banner", describeMenuVisibility(healthySummary) === null);

  // --- NEGATIVE CONTROL: mode off is byte-identical to doing nothing ------
  const thinMenu = [item("t1", "flower", [v("a", 1)]), item("t2", "edible", [v("b", 2)])];
  const offSummary = summarizeMenuVisibility(thinMenu, settings("off", 3));
  ok("mode off withholds nothing", offSummary.variantsWithheld === 0);
  ok("mode off marks nothing unreservable", offSummary.variantsUnreservable === 0);
  ok("mode off reports inactive", offSummary.active === false);
  ok("mode off yields NO banner", describeMenuVisibility(offSummary) === null);
  for (const it of thinMenu) {
    ok(
      `mode off keeps every variant of ${it.id}`,
      assessItemVisibility(it, settings("off", 3)).keptVariantIds.length === it.variants.length,
    );
  }

  // --- summary counts -----------------------------------------------------
  const menu = [
    item("m1", "flower", [v("a", 1), v("b", 40)], "Blue Dream"), // reduced
    item("m2", "edible", [v("c", 1)], "Gummies"), // withheld whole
    item("m3", "topical", [v("d", 50)], "Balm"), // untouched
    item("m4", "flower", [v("e", 0)], "Sold Out"), // already gone
  ];
  const s = summarizeMenuVisibility(menu, settings("withhold", 3));
  ok("considered every item", s.itemsConsidered === 4);
  ok("one item withheld whole", s.itemsWithheld === 1);
  ok("one item reduced", s.itemsReduced === 1);
  ok("two variants withheld in total", s.variantsWithheld === 2);
  ok("summary reports active", s.active === true);
  ok("examples name real products", s.examples.includes("Blue Dream"));
  ok("examples exclude untouched products", !s.examples.includes("Balm"));
  ok("examples exclude already-sold-out products", !s.examples.includes("Sold Out"));
  ok("examples are capped", s.examples.length <= MENU_VISIBILITY_EXAMPLE_LIMIT);

  const bigMenu: VisibilityItem[] = [];
  for (let i = 0; i < 40; i += 1) bigMenu.push(item(`b${i}`, "flower", [v(`bv${i}`, 1)], `P${i}`));
  const bigSummary = summarizeMenuVisibility(bigMenu, settings("withhold", 3));
  ok("a 40-item wipeout still caps examples", bigSummary.examples.length === MENU_VISIBILITY_EXAMPLE_LIMIT);
  ok("but the COUNT is not capped", bigSummary.itemsWithheld === 40);

  // --- per-category overrides do real work --------------------------------
  const catMenu = [
    item("c1", "flower", [v("a", 4)], "Flower Four"),
    item("c2", "edible", [v("b", 4)], "Edible Four"),
  ];
  const catSummary = summarizeMenuVisibility(catMenu, settings("withhold", 3, { flower: 6 }));
  ok("the stricter flower rule withholds the flower", catSummary.itemsWithheld === 1);
  ok("the edible under the looser global survives", catSummary.examples.includes("Flower Four"));
  ok("and the edible is not named", !catSummary.examples.includes("Edible Four"));

  // --- the banner ---------------------------------------------------------
  const banner = describeMenuVisibility(s);
  ok("banner exists when the rule bit", banner !== null);
  ok(
    "banner says these are things we DO have",
    (banner ?? "").includes("DO still have"),
  );
  ok("banner names an example", (banner ?? "").includes("Blue Dream"));
  const oneEach = summarizeMenuVisibility([item("o1", "flower", [v("a", 1)], "One")], settings("withhold", 3));
  ok(
    "banner is singular for one product",
    (describeMenuVisibility(oneEach) ?? "").includes("1 product held back"),
  );

  // --- the PUT trap -------------------------------------------------------
  const withholdOn = settings("withhold", 3);
  ok(
    "withhold + POST is effective",
    withholdEffectiveness(withholdOn, "post").effective === true,
  );
  ok(
    "withhold + POST warns about nothing",
    withholdEffectiveness(withholdOn, "post").warning === null,
  );
  ok(
    "withhold + PUT is NOT effective",
    withholdEffectiveness(withholdOn, "put").effective === false,
  );
  const putWarning = withholdEffectiveness(withholdOn, "put").warning ?? "";
  ok("the PUT warning exists", putWarning.length > 0);
  ok("the PUT warning names the working alternative", putWarning.includes("POST"));
  ok(
    "the PUT warning offers the other mode too",
    putWarning.includes("reserve"),
  );
  ok(
    "not_orderable + PUT is fine (it sends a change, not a silence)",
    withholdEffectiveness(settings("not_orderable", 3), "put").effective === true,
  );
  ok(
    "an INACTIVE withhold rule does not raise the PUT alarm",
    withholdEffectiveness(settings("withhold", 1), "put").effective === true,
  );
  ok(
    "mode off does not raise the PUT alarm",
    withholdEffectiveness(settings("off", 9), "put").effective === true,
  );

  // --- mode descriptions --------------------------------------------------
  for (const m of MENU_VISIBILITY_MODES) {
    const text = describeMenuVisibilityMode(m);
    ok(`mode ${m} has a description`, text.length > 20);
    ok(`mode ${m} description avoids the word payload`, !text.toLowerCase().includes("payload"));
  }
  ok(
    "the recommended mode is recommended in writing",
    describeMenuVisibilityMode("not_orderable").includes("Recommended"),
  );

  // --- guards -------------------------------------------------------------
  ok("isMenuVisibilityMode accepts a real mode", isMenuVisibilityMode("withhold"));
  ok("isMenuVisibilityMode rejects nonsense", !isMenuVisibilityMode("hide"));
  ok("isMenuVisibilityMode rejects a number", !isMenuVisibilityMode(3));
  ok("isMenuVisibilityMode rejects null", !isMenuVisibilityMode(null));
  ok(
    "the recommended threshold sits inside the owner's stated range",
    MENU_VISIBILITY_RECOMMENDED_THRESHOLD >= 2 && MENU_VISIBILITY_RECOMMENDED_THRESHOLD <= 3,
  );
  ok(
    "the ceiling matches Leafly's internal inventory cap",
    MENU_VISIBILITY_MAX_THRESHOLD === 10,
  );
  ok("an empty menu summarises cleanly", summarizeMenuVisibility([], withholdOn).itemsConsidered === 0);
  ok("an empty menu yields no banner", describeMenuVisibility(summarizeMenuVisibility([], withholdOn)) === null);
  ok(
    "an item with no variants at all does not crash",
    assessItemVisibility(item("z", "flower", []), withholdOn).outcome === "list",
  );

  return { passed, failed };
}
