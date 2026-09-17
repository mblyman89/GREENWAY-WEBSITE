/**
 * src/lib/leafly/orderability-core.ts — SLICE L-3 (findings L-09 and L-11).
 *
 * The single, PURE decision: **may this item be offered for ordering on Leafly,
 * and may it be labelled medical?** No DB, no network, no React, no
 * `server-only` — so the payload builder, the validator, the admin preflight
 * and vitest all share ONE answer.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * `availableForPickup` is not a cosmetic menu field. It is the switch that
 * decides whether a stranger on the internet can place a real order that
 * Greenway has **fifteen minutes** to acknowledge before Leafly auto-cancels it
 * (`cancelReason: order_api_unacknowledged`). Publishing `true` is a promise to
 * fulfil. So the question "is this orderable?" deserves a named, tested,
 * fail-closed function rather than an inline `&&` buried in the mapper.
 *
 * The schema (`docs/leafly-specs/schemas/v2-items.json`, vendored live) says:
 *
 *   "availableForPickup": {
 *     "type": "boolean",
 *     "description": "Whether or not the item should be made available for
 *       Leafly pickup.\nThis field may be omitted to maintain the current item
 *       setting for updates. New items will default to false." }
 *
 * Three consequences, all load-bearing:
 *
 *  1. It is a PLAIN boolean. Not `["boolean","null"]`. Sending `null` is a
 *     schema violation, not a softer `false`.
 *
 *  2. Omission is a THIRD state, and it is not `false`. Omitted means "leave
 *     whatever Leafly already has for this item". That makes omission actively
 *     DANGEROUS for an item that just went out of stock: we would be silently
 *     leaving it orderable. So when we are syncing, we always say what we mean.
 *
 *  3. New items default to **false**. Because we have never sent this field, no
 *     item Greenway has ever pushed is orderable — which is exactly why the
 *     whole order integration (slices L-5/L-6) is unreachable today. That is
 *     finding L-09, and this module is its fix.
 *
 * ---------------------------------------------------------------------------
 * THE RULE: ORDERABILITY FAILS CLOSED
 * ---------------------------------------------------------------------------
 *
 * `true` is published only when EVERY condition holds. Any unknown, any missing
 * datum, any restriction — the answer is `false`. This is AGENTS rule 3 applied
 * to a field that creates legal obligations: we never invent availability, and
 * "we are not sure" is never allowed to render as "yes, come buy it".
 *
 * The conditions, each with its own reason:
 *
 *   A. The owner has turned Leafly ordering ON (`sendPickupAvailability`).
 *      Defaults OFF. Merging this slice must not, by itself, make real
 *      customers able to place real orders. The owner flips that switch
 *      deliberately, after the L-4 menu certification, with staff ready for the
 *      fifteen-minute clock.
 *
 *   B. The item is actually in stock. Leafly's own publishing rule is that
 *      items received WITH inventory are auto-published and items received
 *      WITHOUT inventory are imported but unpublished. Offering pickup on
 *      something with zero on hand is how a shop earns cancellations, and
 *      cancellation rate is graded at certification.
 *
 *   C. The product is not DOH-restricted (see below).
 *
 * ---------------------------------------------------------------------------
 * THE DOH GATE — WHY A MENU SLICE TOUCHES MEDICAL COMPLIANCE
 * ---------------------------------------------------------------------------
 *
 * WAC 246-70 defines three DOH product categories, and one of them is not like
 * the others. From `docs/MEDICAL_CANNABIS_COMPLIANCE.md`:
 *
 *   high_thc — ">10–50 mg THC/serving … ONLY registered patients 18+ / DPs with
 *   a valid recognition card … Endorsed stores only."
 *   "HARD GATE: a `high_thc` product may NEVER be sold to a non-cardholder.
 *   This is statutory — no manager override exists."
 *
 * The register already enforces exactly that (`medical-sale-core.ts`
 * `decideLineExemption` → `highThcBlocked`). But a Leafly pickup order is a
 * sale that STARTS on someone else's website, where no card can be checked and
 * no budtender is standing there. If a `high_thc` product were ever published
 * as orderable, a shopper could place an order Greenway is legally forbidden to
 * fulfil. The order then either gets cancelled (hurting certification) or,
 * worse, gets handed over.
 *
 * So `high_thc` is NEVER orderable on Leafly. Not "not yet" — never, under this
 * integration, because the card check cannot happen at the point of order.
 * Endorsement does not soften it; endorsement is what makes the product legal
 * to stock at all, not legal to sell uncarded.
 *
 * `general_use` and `high_cbd` carry no such restriction — `general_use` sells
 * to anyone 21+, and `high_cbd` is sales-tax-free for anyone by statute — so
 * being in the registry does not by itself block ordering. We gate on the
 * CATEGORY, not on mere registry presence, because blocking every DOH-verified
 * product would punish the owner for doing his compliance homework.
 *
 * ---------------------------------------------------------------------------
 * `variant.medical` — FINDING L-11
 * ---------------------------------------------------------------------------
 *
 * The owner answered this directly (L-1, Q5, verbatim):
 *
 *   "we are fully prepared, system wise, to manage a doh medical endorsement,
 *   we carry doh products, but we have not been certified yet. So we will only
 *   have regular non medical sales at the start until we get the endorsement."
 *
 * So the correct value today is `false`, and L-2 already stopped it being a
 * hardcoded literal by turning it into `variantMedicalFlag()`. What was still
 * missing is the GATE: nothing prevented a future edit from flipping medical on
 * while the licence is still unendorsed, which would advertise medical product
 * the shop cannot lawfully sell as such.
 *
 * `resolveVariantMedical()` supplies that gate. `medical: true` requires BOTH a
 * live endorsement AND a DOH category on the product. Absent either, it is
 * `false`. The default endorsement state is `false`, so the safe answer is what
 * you get when you pass nothing — the CCRS bible takes the identical posture
 * for `IsMedical` (`docs/ccrs-bible/01-standing-rules-and-handoff.md:15`).
 *
 * This mirrors `medical-sale-core.ts`'s structure on purpose: same vocabulary,
 * same fail-closed direction, so the menu and the register cannot drift.
 */
import type { DohCategory } from "@/lib/medical/medical-sale-core";
import { isDohCategory } from "@/lib/medical/medical-sale-core";

/**
 * DOH categories that may never be offered for ordering on a public
 * marketplace, because the statutory buyer check cannot happen at order time.
 *
 * Declared as a table rather than an `=== "high_thc"` so that if DOH ever adds
 * another card-only category, there is one obvious place to add it — and the
 * self-tests below assert the table's CONTENT, so a silent emptying fails.
 */
export const DOH_CATEGORIES_BLOCKED_FROM_PICKUP: readonly DohCategory[] = ["high_thc"] as const;

/**
 * True when a DOH category may never be sold through an unattended order flow.
 * Unknown / absent categories are NOT blocked: a product with no registry entry
 * is an ordinary recreational product, which is the overwhelmingly common case.
 * (Blocking on "unknown" would block the entire menu.)
 */
export function isDohCategoryBlockedFromPickup(
  category: DohCategory | null | undefined,
): boolean {
  if (!category || !isDohCategory(category)) return false;
  return DOH_CATEGORIES_BLOCKED_FROM_PICKUP.includes(category);
}

/** Everything the orderability decision is allowed to look at. */
export type OrderabilityInput = {
  /** Does the shop have stock on hand? */
  inStock: boolean;
  /** The product's verified WAC 246-70 category, when it has one. */
  dohCategory?: DohCategory | null;
  /** The owner's Leafly "offer pickup ordering" toggle. Defaults OFF. */
  pickupEnabled: boolean;
};

/** Why an item is not orderable — surfaced to a human, never swallowed. */
export type OrderabilityReason =
  | "pickup_disabled"
  | "out_of_stock"
  | "doh_restricted";

export type OrderabilityDecision = {
  /** The literal value to publish in `availableForPickup`. */
  availableForPickup: boolean;
  /** Present only when the answer is `false`. */
  reason: OrderabilityReason | null;
};

/**
 * The decision. Ordered so the reason returned is the one a human most needs:
 * a globally-disabled integration explains itself before per-item detail, and a
 * statutory block outranks a transient stock problem.
 */
export function decideOrderability(input: OrderabilityInput): OrderabilityDecision {
  if (!input.pickupEnabled) {
    return { availableForPickup: false, reason: "pickup_disabled" };
  }
  if (isDohCategoryBlockedFromPickup(input.dohCategory)) {
    return { availableForPickup: false, reason: "doh_restricted" };
  }
  if (!input.inStock) {
    return { availableForPickup: false, reason: "out_of_stock" };
  }
  return { availableForPickup: true, reason: null };
}

/** Plain-English explanation for the admin preflight / push report. */
export function orderabilityReasonLabel(reason: OrderabilityReason): string {
  switch (reason) {
    case "pickup_disabled":
      return "Leafly pickup ordering is turned off in your Leafly settings.";
    case "out_of_stock":
      return "The item has no inventory on hand, so it cannot be offered for pickup.";
    case "doh_restricted":
      return (
        "This is a DOH High-THC product. By WAC 246-70 it may be sold only to a " +
        "registered patient with a valid recognition card, and that card cannot be " +
        "checked when an order is placed on Leafly, so it is never offered for pickup."
      );
  }
}

// ---------------------------------------------------------------------------
// Owner-facing explanation of the whole menu
// ---------------------------------------------------------------------------

/**
 * The minimum an item must expose to be counted. Deliberately structural rather
 * than `SyndicationItem`, so this module keeps its zero-runtime-import rule and
 * so the register or a report can reuse it without dragging the feed types in.
 */
export type OrderabilityCountable = {
  id: string;
  name?: string | null;
  inStock: boolean;
  dohCategory?: DohCategory | null;
};

export type OrderabilityBlockGroup = {
  reason: OrderabilityReason;
  /** Plain-English, from `orderabilityReasonLabel`. */
  label: string;
  count: number;
  /**
   * A handful of real item names, so the answer is "these three products" and
   * not "some products". Capped because a 400-item menu with ordering switched
   * off must not render 400 names into the admin page.
   */
  examples: string[];
};

export type OrderabilitySummary = {
  total: number;
  /** How many items Leafly will be told it can take orders for. */
  orderable: number;
  /** Groups are ordered most-blocked first, so the biggest cause reads first. */
  blocked: OrderabilityBlockGroup[];
};

/** How many example names each block group carries. */
export const ORDERABILITY_SUMMARY_EXAMPLE_LIMIT = 5;

/**
 * Explain the orderability of a whole menu, grouped by cause.
 *
 * This exists because `availableForPickup` is otherwise invisible. Before this,
 * the owner could switch ordering on, push, and see Leafly accept 400 items
 * while quietly refusing to sell any of them -- and the only way to find out
 * why would be to read the JSON. "391 orderable; 6 out of stock; 3 are DOH
 * High-THC and can never be ordered online" is the answer he actually needs,
 * and it is the same computation the wire uses, not a second guess at it.
 *
 * It calls `decideOrderability` rather than re-deriving anything, so the summary
 * cannot drift from the payload (house rule 11).
 */
export function summarizeOrderability(
  items: readonly OrderabilityCountable[],
  opts: { pickupEnabled: boolean },
): OrderabilitySummary {
  let orderable = 0;
  // Insertion-ordered map keyed by reason, so grouping is deterministic before
  // the sort and the sort itself is the only thing deciding display order.
  const groups = new Map<OrderabilityReason, { count: number; examples: string[] }>();

  for (const item of items) {
    const decision = decideOrderability({
      inStock: item.inStock,
      dohCategory: item.dohCategory ?? null,
      pickupEnabled: opts.pickupEnabled === true,
    });

    if (decision.availableForPickup) {
      orderable += 1;
      continue;
    }

    // Unreachable by construction -- a false decision always carries a reason --
    // but a summary that silently miscounts is worse than one that is defensive.
    if (decision.reason === null) continue;

    const bucket = groups.get(decision.reason) ?? { count: 0, examples: [] };
    bucket.count += 1;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (bucket.examples.length < ORDERABILITY_SUMMARY_EXAMPLE_LIMIT) {
      // Fall back to the id so an unnamed item is still identifiable rather than blank.
      bucket.examples.push(name !== "" ? name : item.id);
    }
    groups.set(decision.reason, bucket);
  }

  const blocked: OrderabilityBlockGroup[] = [...groups.entries()]
    .map(([reason, bucket]) => ({
      reason,
      label: orderabilityReasonLabel(reason),
      count: bucket.count,
      examples: bucket.examples,
    }))
    // Biggest cause first; ties broken by reason name so the order is stable
    // across runs and the admin page does not reshuffle between refreshes.
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return { total: items.length, orderable, blocked };
}

/**
 * `variant.medical`, gated on the endorsement (finding L-11).
 *
 * `true` requires BOTH a live DOH endorsement AND a verified DOH category on
 * the product. Either one missing → `false`, which is both the lawful answer
 * today and the honest one: without an endorsement there is no such thing as a
 * medical sale at this store.
 *
 * Note this is deliberately NOT "is it in the registry". The registry records
 * that staff verified a DOH logo on the package. That verification is true
 * regardless of the licence. What makes the product sellable AS MEDICAL is the
 * endorsement, which is a property of the store, not of the product — so both
 * are required, and they are separate arguments.
 */
export type VariantMedicalInput = {
  /** Does the store currently hold an LCB medical endorsement (RCW 69.50.375)? */
  endorsed: boolean;
  /** The product's verified WAC 246-70 category, when it has one. */
  dohCategory?: DohCategory | null;
};

export function resolveVariantMedical(input?: VariantMedicalInput): boolean {
  if (!input) return false;
  if (!input.endorsed) return false;
  const c = input.dohCategory;
  return !!c && isDohCategory(c);
}

// ---------------------------------------------------------------------------
// Pure self-tests
// ---------------------------------------------------------------------------

export function __runLeaflyOrderabilityTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: orderability-core: ${label}`);
    }
  };

  // --- the blocked table itself -------------------------------------------
  ok(
    "high_thc is in the pickup-blocked table",
    DOH_CATEGORIES_BLOCKED_FROM_PICKUP.includes("high_thc"),
  );
  ok(
    "general_use is NOT blocked (sells to anyone 21+)",
    !DOH_CATEGORIES_BLOCKED_FROM_PICKUP.includes("general_use"),
  );
  ok(
    "high_cbd is NOT blocked (sales-tax-free for anyone by statute)",
    !DOH_CATEGORIES_BLOCKED_FROM_PICKUP.includes("high_cbd"),
  );
  ok("exactly one blocked category today", DOH_CATEGORIES_BLOCKED_FROM_PICKUP.length === 1);

  // --- isDohCategoryBlockedFromPickup -------------------------------------
  ok("high_thc blocked", isDohCategoryBlockedFromPickup("high_thc"));
  ok("general_use not blocked", !isDohCategoryBlockedFromPickup("general_use"));
  ok("high_cbd not blocked", !isDohCategoryBlockedFromPickup("high_cbd"));
  ok("null category not blocked", !isDohCategoryBlockedFromPickup(null));
  ok("undefined category not blocked", !isDohCategoryBlockedFromPickup(undefined));
  ok(
    "junk category not blocked (guarded by isDohCategory)",
    !isDohCategoryBlockedFromPickup("bogus" as DohCategory),
  );

  // --- decideOrderability: the happy path ---------------------------------
  const live = decideOrderability({ inStock: true, pickupEnabled: true });
  ok("in stock + enabled + no DOH category => orderable", live.availableForPickup === true);
  ok("an orderable item carries no reason", live.reason === null);

  const general = decideOrderability({
    inStock: true,
    pickupEnabled: true,
    dohCategory: "general_use",
  });
  ok("general_use is orderable", general.availableForPickup === true);

  const cbd = decideOrderability({
    inStock: true,
    pickupEnabled: true,
    dohCategory: "high_cbd",
  });
  ok("high_cbd is orderable", cbd.availableForPickup === true);

  // --- decideOrderability: every refusal ----------------------------------
  const off = decideOrderability({ inStock: true, pickupEnabled: false });
  ok("toggle off => NOT orderable", off.availableForPickup === false);
  ok("toggle off reason", off.reason === "pickup_disabled");

  const oos = decideOrderability({ inStock: false, pickupEnabled: true });
  ok("out of stock => NOT orderable", oos.availableForPickup === false);
  ok("out of stock reason", oos.reason === "out_of_stock");

  const restricted = decideOrderability({
    inStock: true,
    pickupEnabled: true,
    dohCategory: "high_thc",
  });
  ok("high_thc => NEVER orderable", restricted.availableForPickup === false);
  ok("high_thc reason", restricted.reason === "doh_restricted");

  // The statutory block must not depend on stock. A restocked high-THC product
  // is still card-only, so "back in stock" must never make it orderable.
  const restockedHighThc = decideOrderability({
    inStock: true,
    pickupEnabled: true,
    dohCategory: "high_thc",
  });
  ok(
    "high_thc stays blocked even when in stock and enabled",
    restockedHighThc.availableForPickup === false,
  );

  // Precedence: the DOH block outranks a stock problem, because the statutory
  // reason is the one that must be reported.
  const bothWrong = decideOrderability({
    inStock: false,
    pickupEnabled: true,
    dohCategory: "high_thc",
  });
  ok("DOH block outranks out-of-stock", bothWrong.reason === "doh_restricted");

  // And the global toggle outranks everything, because "you turned it off" is
  // the actionable answer when nothing is orderable.
  const allWrong = decideOrderability({
    inStock: false,
    pickupEnabled: false,
    dohCategory: "high_thc",
  });
  ok("toggle off outranks all", allWrong.reason === "pickup_disabled");

  // --- fail-closed shape --------------------------------------------------
  ok(
    "availableForPickup is always a real boolean, never null/undefined",
    typeof live.availableForPickup === "boolean" &&
      typeof off.availableForPickup === "boolean" &&
      typeof oos.availableForPickup === "boolean" &&
      typeof restricted.availableForPickup === "boolean",
  );

  // --- reason labels ------------------------------------------------------
  ok("pickup_disabled label is non-empty", orderabilityReasonLabel("pickup_disabled").length > 0);
  ok("out_of_stock label is non-empty", orderabilityReasonLabel("out_of_stock").length > 0);
  ok(
    "doh_restricted label cites the rule, not a vague refusal",
    orderabilityReasonLabel("doh_restricted").includes("246-70"),
  );
  ok(
    "doh_restricted label explains WHY the card cannot be checked",
    orderabilityReasonLabel("doh_restricted").includes("recognition card"),
  );

  // --- resolveVariantMedical: the endorsement gate ------------------------
  ok("no input => medical false", resolveVariantMedical() === false);
  ok("undefined input => medical false", resolveVariantMedical(undefined) === false);
  ok(
    "unendorsed + DOH product => medical FALSE (owner Q5, today's state)",
    resolveVariantMedical({ endorsed: false, dohCategory: "general_use" }) === false,
  );
  ok(
    "unendorsed + high_thc => still medical FALSE",
    resolveVariantMedical({ endorsed: false, dohCategory: "high_thc" }) === false,
  );
  ok(
    "endorsed but NOT a DOH product => medical false",
    resolveVariantMedical({ endorsed: true, dohCategory: null }) === false,
  );
  ok(
    "endorsed + no category field at all => medical false",
    resolveVariantMedical({ endorsed: true }) === false,
  );
  ok(
    "endorsed + junk category => medical false (guarded)",
    resolveVariantMedical({ endorsed: true, dohCategory: "bogus" as DohCategory }) === false,
  );
  ok(
    "endorsed + general_use => medical true (the future state)",
    resolveVariantMedical({ endorsed: true, dohCategory: "general_use" }) === true,
  );
  ok(
    "endorsed + high_cbd => medical true",
    resolveVariantMedical({ endorsed: true, dohCategory: "high_cbd" }) === true,
  );
  ok(
    "endorsed + high_thc => medical true (it IS medical; it is just not orderable)",
    resolveVariantMedical({ endorsed: true, dohCategory: "high_thc" }) === true,
  );

  // The two gates are INDEPENDENT, and that independence is the point: a
  // high-THC product at an endorsed store is genuinely a medical product
  // (medical: true) AND is genuinely not orderable online (false). Collapsing
  // them into one flag would either mislabel it or leak it into ordering.
  const endorsedHighThcMedical = resolveVariantMedical({
    endorsed: true,
    dohCategory: "high_thc",
  });
  const endorsedHighThcOrderable = decideOrderability({
    inStock: true,
    pickupEnabled: true,
    dohCategory: "high_thc",
  }).availableForPickup;
  ok(
    "endorsed high_thc is medical:true AND orderable:false simultaneously",
    endorsedHighThcMedical === true && endorsedHighThcOrderable === false,
  );

  // --- summarizeOrderability: the owner-facing explanation ------------------
  const menu: OrderabilityCountable[] = [
    { id: "a", name: "Blue Dream 3.5g", inStock: true, dohCategory: null },
    { id: "b", name: "Gelato 7g", inStock: true, dohCategory: "general_use" },
    { id: "c", name: "CBD Tincture", inStock: true, dohCategory: "high_cbd" },
    { id: "d", name: "Sold Out Shatter", inStock: false, dohCategory: null },
    { id: "e", name: "RSO High-THC", inStock: true, dohCategory: "high_thc" },
  ];

  const sumOn = summarizeOrderability(menu, { pickupEnabled: true });
  ok("summary counts every item", sumOn.total === 5);
  ok("summary counts the three orderable items", sumOn.orderable === 3);
  ok("summary groups the two blocks", sumOn.blocked.length === 2);
  ok(
    "summary totals reconcile (orderable + blocked === total)",
    sumOn.orderable + sumOn.blocked.reduce((n, g) => n + g.count, 0) === sumOn.total,
  );
  ok(
    "summary reports the DOH block",
    sumOn.blocked.some((g) => g.reason === "doh_restricted" && g.count === 1),
  );
  ok(
    "summary reports the stock block",
    sumOn.blocked.some((g) => g.reason === "out_of_stock" && g.count === 1),
  );
  ok(
    "summary names the actual blocked product, not a count alone",
    sumOn.blocked.some((g) => g.examples.includes("RSO High-THC")),
  );
  ok(
    "every group carries a plain-English label",
    sumOn.blocked.every((g) => g.label.length > 20),
  );
  ok(
    "the DOH group's label cites the statute",
    sumOn.blocked.some((g) => g.reason === "doh_restricted" && g.label.includes("246-70")),
  );

  // Toggle off: EVERY item must be blocked, under one heading, because
  // "you turned it off" is the one fact that explains the whole menu.
  const sumOff = summarizeOrderability(menu, { pickupEnabled: false });
  ok("toggle off => nothing orderable", sumOff.orderable === 0);
  ok("toggle off => a single explanation", sumOff.blocked.length === 1);
  ok(
    "toggle off => that explanation is the toggle",
    sumOff.blocked[0]?.reason === "pickup_disabled" && sumOff.blocked[0]?.count === 5,
  );

  // Ordering and capping.
  const many: OrderabilityCountable[] = Array.from({ length: 9 }, (_, i) => ({
    id: `oos-${i}`,
    name: `Sold Out ${i}`,
    inStock: false,
    dohCategory: null,
  }));
  const sumMany = summarizeOrderability(
    [...many, { id: "z", name: "High THC", inStock: true, dohCategory: "high_thc" }],
    { pickupEnabled: true },
  );
  ok(
    "biggest cause is listed first",
    sumMany.blocked[0]?.reason === "out_of_stock" && sumMany.blocked[0]?.count === 9,
  );
  ok(
    "examples are capped so a whole menu is never rendered",
    sumMany.blocked[0]?.examples.length === ORDERABILITY_SUMMARY_EXAMPLE_LIMIT,
  );

  // Degenerate inputs.
  const sumEmpty = summarizeOrderability([], { pickupEnabled: true });
  ok(
    "empty menu summarises cleanly rather than throwing",
    sumEmpty.total === 0 && sumEmpty.orderable === 0 && sumEmpty.blocked.length === 0,
  );
  const sumUnnamed = summarizeOrderability([{ id: "no-name-1", inStock: false }], {
    pickupEnabled: true,
  });
  ok(
    "an unnamed item falls back to its id so it stays identifiable",
    sumUnnamed.blocked[0]?.examples[0] === "no-name-1",
  );

  // The summary must agree with the wire, always. This is the anti-drift check.
  const wireOrderable = menu.filter(
    (m) =>
      decideOrderability({
        inStock: m.inStock,
        dohCategory: m.dohCategory ?? null,
        pickupEnabled: true,
      }).availableForPickup,
  ).length;
  ok("summary never disagrees with the payload decision", sumOn.orderable === wireOrderable);

  if (failed === 0) {
    console.log(`orderability-core: ${passed} assertions passed`);
  }
  return { passed, failed };
}
