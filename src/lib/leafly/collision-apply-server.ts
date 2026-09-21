import "server-only";

/**
 * src/lib/leafly/collision-apply-server.ts
 *
 * Join the source labels back onto a built Leafly payload and apply the
 * blanket size repair.
 *
 * WHY A JOIN IS NEEDED AT ALL. Leafly v2 removed `variant.label` (finding
 * L-03) -- the wire variant carries only `amount` + `unit`. So by the time a
 * payload exists, the very information needed to repair it ("this one said
 * 3g") has already been thrown away. The labels still exist upstream in the
 * syndication feed, keyed by variant id, so this module re-attaches them,
 * runs the pure repair, and hands back a payload that no longer collides.
 *
 * WHY THE REPAIR IS NOT SIMPLY DONE INSIDE `variantAmountAndUnit()`. That
 * function is called per-variant and cannot see its siblings. "1 each" is
 * perfectly correct for a lone topical; it is only wrong when a SECOND size
 * of the same item also says "1 each". Collision is a property of the set,
 * so it can only be resolved once the whole item is built. Repairing it
 * per-variant would mean changing correct output for products that have no
 * problem.
 *
 * ---------------------------------------------------------------------------
 * HOW THE JOIN KEY WAS ESTABLISHED (proof, not assumption)
 * ---------------------------------------------------------------------------
 * An earlier draft of this file paired source and built variants BY POSITION,
 * on the stated belief that the built id was a re-derived hash and therefore
 * unusable as a key. That belief was tested against the real exported
 * functions and BOTH halves of it turned out to be false:
 *
 *   1. `toLeaflyVariant()` (payload-core.ts:520) emits `id: String(v.id)` --
 *      the SOURCE variant id, copied verbatim. The `${itemId}-${stableId(...)}`
 *      shape is minted far upstream in `toMenuItem()` (pos/transform.ts:1044)
 *      and simply travels through unchanged. So a direct id lookup HITS.
 *
 *   2. Position is NOT stable. `variantsFor()` has two `continue` statements:
 *      a variant is dropped when the low-stock rule withholds it
 *      (payload-core.ts:~566) and when no weight can be read from its label
 *      for a weight-only type (~605). Either drop shifts every later index.
 *
 * The consequence of (2) was measured rather than reasoned about. For a Flower
 * item with labels ["1g", "MYSTERY BAG", "5g"], the middle variant is rejected,
 * and positional pairing then reports the surviving 5g variant's label as
 * "MYSTERY BAG". A repair driven by that would write a wrong weight onto
 * cannabis. Joining by id yields ["1g", "5g"], which is correct.
 *
 * Hence: JOIN BY ID ONLY. There is deliberately no positional fallback -- a
 * fallback here would be a silent guess, and a silently guessed weight is the
 * single worst failure this module could produce. A variant whose label cannot
 * be found keeps `label: null`, which the pure core treats as "unknown", and
 * an unknown label can only ever produce an honest `unrepaired` refusal.
 *
 * The one legitimate miss is the SYNTHESIZED DEFAULT variant
 * (`${item.id}-default`, payload-core.ts:647), created for items that have no
 * source variants at all. It has no source row and therefore no label. It also
 * cannot collide, because it is by construction the item's only variant.
 *
 * All four of these facts are pinned by tests in
 * `tests/compliance/leafly-collision-apply.test.ts` so that a future change to
 * `variantsFor()` or `toMenuItem()` breaks a test instead of corrupting a menu.
 *
 * SAFETY. Everything here is additive and reversible: the repair returns new
 * objects, the caller keeps the original, and the result carries a full
 * before/after change list plus an explicit list of what could NOT be fixed.
 * Nothing is dropped, nothing is invented, no price or stock is touched.
 */

import {
  applyCollisionRepairs,
  describeApplyResult,
  type ApplyItem,
  type ApplyResult,
  type ItemRepair,
} from "./collision-apply-core";
import {
  applyCollisionSplits,
  describeSplitResult,
  type ItemSplit,
  type SplitItem,
  type SplitRefusal,
} from "./collision-split-core";
import type { LeaflyItem } from "./payload-core";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

export type RepairedPayload = {
  items: LeaflyItem[];
  repairs: ItemRepair[];
  unrepaired: ItemRepair[];
  repairedItemCount: number;
  repairedVariantCount: number;
  /** True when no size collision remains anywhere in the payload. */
  clean: boolean;
  /** Owner-facing sentence. */
  narrative: string;
  /**
   * Built variants whose source label could not be found. Expected to contain
   * only synthesized defaults; anything else is a real upstream drift signal
   * and is surfaced rather than swallowed.
   */
  unmatchedVariantIds: string[];
};

/** The id `variantsFor()` gives a variant it had to synthesize. */
function synthesizedDefaultIdFor(itemId: string): string {
  return `${itemId}-default`;
}

/**
 * Apply the blanket repair to a built payload, using the source feed for
 * the labels Leafly's wire format no longer carries.
 *
 * Pure with respect to its arguments: neither `built` nor `source` is mutated.
 */
export function repairBuiltPayload(
  built: readonly LeaflyItem[],
  source: readonly SyndicationItem[],
): RepairedPayload {
  // variantId -> label, from the source of truth. Built once; a per-item scan
  // would be O(n*m) across a 2,500-product menu.
  //
  // Variant ids are documented as "Unique to all items in the menu", so one
  // flat map is sound. Should that ever stop being true, the duplicate would
  // be a menu-wide `variant.id` collision -- a hard Leafly schema violation
  // that the validator already rejects long before this code runs.
  const labelByVariantId = new Map<string, string>();
  for (const item of source ?? []) {
    for (const v of item.variants ?? []) {
      const id = String(v.id ?? "").trim();
      if (id.length > 0) labelByVariantId.set(id, v.label);
    }
  }

  const unmatchedVariantIds: string[] = [];

  const withLabels: ApplyItem[] = (built ?? []).map((item) => ({
    id: item.id,
    type: item.type,
    name: item.name,
    variants: (item.variants ?? []).map((v) => {
      const label = labelByVariantId.get(v.id);
      // Join by id ONLY. A miss stays a miss -- see the header note on why a
      // positional fallback is unsafe. Synthesized defaults are an expected,
      // harmless miss and are not reported as drift.
      if (label === undefined && v.id !== synthesizedDefaultIdFor(item.id)) {
        unmatchedVariantIds.push(v.id);
      }
      return {
        id: v.id,
        amount: v.amount,
        unit: v.unit,
        label: label ?? null,
        price: v.price,
        medical: v.medical,
        inventoryLevel: v.inventoryLevel,
      };
    }),
  }));

  const result: ApplyResult<ApplyItem> = applyCollisionRepairs(withLabels);

  // Rebuild wire items: copy the ORIGINAL item and overwrite only amount and
  // unit. This guarantees the repair cannot accidentally add `label` (not a v2
  // field) or lose an optional field like `imageUrl` or `compounds`.
  const repairedById = new Map<string, ApplyItem>();
  for (const i of result.items) repairedById.set(i.id, i);

  const items: LeaflyItem[] = (built ?? []).map((item) => {
    const fixed = repairedById.get(item.id);
    if (fixed === undefined) return item;
    const byId = new Map(fixed.variants.map((v) => [v.id, v]));
    return {
      ...item,
      variants: (item.variants ?? []).map((v) => {
        const f = byId.get(v.id);
        if (f === undefined) return v;
        if (f.amount === v.amount && f.unit === v.unit) return v;
        return { ...v, amount: f.amount, unit: f.unit as typeof v.unit };
      }),
    };
  });

  return {
    items,
    repairs: result.repairs,
    unrepaired: result.unrepaired,
    repairedItemCount: result.repairedItemCount,
    repairedVariantCount: result.repairedVariantCount,
    clean: result.clean,
    narrative: describeApplyResult(result),
    unmatchedVariantIds,
  };
}

/* ========================================================================== */
/* Stage 2 -- split what stage 1 honestly refused                             */
/* ========================================================================== */

export type FullyRepairedPayload = {
  items: LeaflyItem[];
  /** Stage 1: sizes whose amount/unit were corrected in place. */
  repairs: ItemRepair[];
  /** Stage 2: products listed as several products, one per size. */
  splits: ItemSplit[];
  /** Still broken after BOTH stages. Never hidden. */
  refusals: SplitRefusal[];
  repairedItemCount: number;
  repairedVariantCount: number;
  splitItemCount: number;
  createdItemCount: number;
  /** Verified against the OUTPUT of both stages. */
  clean: boolean;
  narrative: string;
  unmatchedVariantIds: string[];
};

/**
 * The whole blanket fix, in the only order that is correct.
 *
 * WHY REPAIR BEFORE SPLIT, AND NEVER THE REVERSE. Splitting is the heavier
 * remedy: it changes how the menu LOOKS to a shopper, turning one product
 * into several. Correcting an amount does not. So the cheap, invisible fix
 * must be exhausted first, and only what genuinely cannot be expressed on a
 * single product is split.
 *
 * Run the other way round, a Flower item with 1g/3g/5g labels -- which stage 1
 * fixes perfectly by restoring the real weights -- would instead be shattered
 * into three separate products for no reason at all.
 *
 * Measured on a generated menu spanning all ten funnel types, this order
 * drives `variant_size_indistinguishable` to zero while stage 1 alone leaves
 * the each-only-with-weight-labels case outstanding. Both facts are pinned by
 * tests in `tests/compliance/leafly-collision-apply.test.ts`.
 */
export function repairAndSplitBuiltPayload(
  built: readonly LeaflyItem[],
  source: readonly SyndicationItem[],
): FullyRepairedPayload {
  const stage1 = repairBuiltPayload(built, source);

  // Re-attach labels for stage 2. Splitting names each product after its size,
  // so it needs the same label join stage 1 used -- by id only, never by
  // position (see the header note).
  const labelByVariantId = new Map<string, string>();
  for (const item of source ?? []) {
    for (const v of item.variants ?? []) {
      const id = String(v.id ?? "").trim();
      if (id.length > 0) labelByVariantId.set(id, v.label);
    }
  }

  const asSplit: SplitItem[] = stage1.items.map((item) => ({
    id: item.id,
    type: item.type,
    name: item.name,
    variants: (item.variants ?? []).map((v) => ({
      id: v.id,
      amount: v.amount,
      unit: v.unit,
      label: labelByVariantId.get(v.id) ?? null,
      price: v.price,
      medical: v.medical,
      inventoryLevel: v.inventoryLevel,
    })),
  }));

  const stage2 = applyCollisionSplits(asSplit);

  // Rebuild wire items from the ORIGINAL stage-1 items so no non-v2 field
  // (`label`) can leak onto the wire and no optional field is lost.
  const parentByVariantId = new Map<string, LeaflyItem>();
  for (const item of stage1.items) {
    for (const v of item.variants ?? []) parentByVariantId.set(v.id, item);
  }

  const items: LeaflyItem[] = stage2.items.map((s) => {
    const firstVariantId = s.variants[0]?.id ?? "";
    const parent = parentByVariantId.get(firstVariantId);
    if (parent === undefined) {
      // Unreachable for any payload produced above, but a silent `!` here
      // would be exactly the kind of assumption this work exists to remove.
      throw new Error(`repairAndSplitBuiltPayload: no parent item for variant "${firstVariantId}"`);
    }
    const keep = new Set(s.variants.map((v) => v.id));
    return {
      ...parent,
      id: s.id,
      name: s.name,
      variants: (parent.variants ?? []).filter((v) => keep.has(v.id)),
    };
  });

  const narrative = [stage1.narrative, describeSplitResult(stage2)]
    .filter((t) => t.length > 0 && !t.startsWith("No products needed splitting"))
    .join(" ");

  return {
    items,
    repairs: stage1.repairs,
    splits: stage2.splits,
    refusals: stage2.refusals,
    repairedItemCount: stage1.repairedItemCount,
    repairedVariantCount: stage1.repairedVariantCount,
    splitItemCount: stage2.splitItemCount,
    createdItemCount: stage2.createdItemCount,
    clean: stage2.clean,
    narrative: narrative.length > 0 ? narrative : stage1.narrative,
    unmatchedVariantIds: stage1.unmatchedVariantIds,
  };
}
