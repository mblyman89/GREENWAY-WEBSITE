/**
 * src/lib/inventory/lot-strain-propagation-core.ts  (R33, T-329)
 *
 * WHY THIS EXISTS. Correcting a lot's strain type on Inventory Detail wrote
 * inventory_lots.strain_type and nothing else. The website, the register and
 * the next delivery's onboarding card never read that column:
 *
 *   - the customer menu + register read menu_items.strain_type (per menu
 *     version: the published one and any intake-staged one);
 *   - the onboarding memory (R32 onboarding-recall-core) reads the APPROVED
 *     draft's chosen_strain_type + chosen_classification_provenance.strainType;
 *   - and at render time attachStrainProfile replaced the card's type with the
 *     strain library's type for the strain NAME, so even a correct card was
 *     overwritten unless a person's answer is marked as such.
 *
 * This PURE planner decides, from rows the store has already read, exactly
 * which rows change and how. The store (lot-strain-propagation-store.ts) only
 * reads and writes. Nothing here guesses:
 *
 *   1. The lot gets the value with fact_provenance.strain_type = "reviewer"
 *      (a named human answer, the same word every other human fact uses).
 *      Clearing to Unknown removes the reviewer stamp, so the library may fill.
 *   2. A menu card is changed only when it belongs to THIS lot: its
 *      source_item_id is the lot's pos_product_key, or one of its variants is
 *      the lot's own "<key>-onboarded" variant. Strain type is a CARD-level
 *      fact, so on a mastered card that also sells OTHER lots we change it
 *      only when every other lot on the card agrees with the new value or has
 *      no value. Otherwise the card is left alone and reported by name - never
 *      a silent overwrite of a sibling lot's answer.
 *   3. Every APPROVED onboarding draft linked to this lot gets the new pick
 *      with strainType provenance "human", so the next delivery of this
 *      product recalls the corrected answer instead of the old one.
 *
 * Pure: plain data in, plain data out; self-tests run in the pure runner.
 */
import { canonicalStrainType, strainTypeLabel } from "@/lib/menu/strain-taxonomy";
import { lotKeyFromVariantId, ONBOARDED_VARIANT_SUFFIX } from "@/lib/pos/variant-lot-core";

/** fact_provenance.strain_type for a person's answer (same word as Product facts). */
export const LOT_STRAIN_REVIEWER = "reviewer" as const;
/** chosen_classification_provenance.strainType for a person's answer (onboarding-recall-core). */
export const DRAFT_STRAIN_HUMAN = "human" as const;
/** Audit action for the propagation (one row per save that changed anything). */
export const LOT_STRAIN_PROPAGATED_AUDIT = "inventory_lot.strain_type_propagated";

export type PropagationCard = {
  id: string;
  versionId: string;
  versionStatus: string;
  sourceItemId: string;
  name: string;
  strainType: string | null;
  factProvenance: unknown;
  /** Every variant's source_variant_id on this card. */
  variantSourceIds: readonly string[];
};

export type PropagationDraft = {
  id: string;
  chosenStrainType: string | null;
  chosenClassificationProvenance: unknown;
};

export type PropagationInput = {
  lotId: string;
  posProductKey: string | null;
  /** The value just saved (lot-edit-core already validated it). null = Unknown. */
  newType: string | null;
  lot: { strainType: string | null; factProvenance: unknown };
  cards: readonly PropagationCard[];
  /** Strain types of the OTHER lots that sell on these cards, by pos_product_key. */
  siblingLotTypes: ReadonlyMap<string, string | null>;
  drafts: readonly PropagationDraft[];
};

export type CardPatch = {
  id: string;
  versionStatus: string;
  name: string;
  patch: { strain_type: string; fact_provenance: Record<string, unknown> };
};

export type CardSkip = { id: string; versionStatus: string; name: string; reason: string };

export type PropagationPlan = {
  /** Canonical value written (null = cleared to Unknown). */
  value: string | null;
  lotPatch: { strain_type: string | null; fact_provenance: Record<string, unknown> } | null;
  cardPatches: CardPatch[];
  cardsSkipped: CardSkip[];
  /** Cards already carrying the value from a person (nothing to write). */
  cardsAlready: number;
  draftPatches: { id: string; patch: { chosen_strain_type: string | null; chosen_classification_provenance: Record<string, unknown> } }[];
};

function obj(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

function canon(raw: string | null | undefined): string | null {
  const c = canonicalStrainType(raw ?? "");
  return c === "unknown" ? null : c;
}

/** Provenance with the strain_type key set (value) or removed (cleared). */
function withStamp(prov: Record<string, unknown>, key: string, stamp: string | null): Record<string, unknown> {
  const next = { ...prov };
  if (stamp === null) delete next[key];
  else next[key] = stamp;
  return next;
}

/** Does this card sell THIS lot? (its own key, or the lot's onboarded variant) */
export function cardBelongsToLot(card: Pick<PropagationCard, "sourceItemId" | "variantSourceIds">, key: string): boolean {
  if (!key) return false;
  if (card.sourceItemId === key) return true;
  return card.variantSourceIds.some((v) => v === `${key}${ONBOARDED_VARIANT_SUFFIX}`);
}

/** The OTHER lot keys that sell on a card (from "<key>-onboarded" variant ids). */
export function siblingLotKeys(card: Pick<PropagationCard, "sourceItemId" | "variantSourceIds">, key: string): string[] {
  const out = new Set<string>();
  for (const v of card.variantSourceIds) {
    const k = lotKeyFromVariantId(v);
    if (k && k !== key) out.add(k);
  }
  // A mastered card's own key may be another lot (this lot joined it).
  if (card.sourceItemId !== key && card.sourceItemId) out.add(card.sourceItemId);
  return [...out];
}

export function planLotStrainPropagation(input: PropagationInput): PropagationPlan {
  const value = canon(input.newType);
  const key = String(input.posProductKey ?? "").trim();
  const plan: PropagationPlan = { value, lotPatch: null, cardPatches: [], cardsSkipped: [], cardsAlready: 0, draftPatches: [] };

  // 1. The lot itself.
  const lotProv = obj(input.lot.factProvenance);
  const lotNow = canon(input.lot.strainType);
  const lotStamp = lotProv.strain_type;
  if (value !== null) {
    if (lotNow !== value || lotStamp !== LOT_STRAIN_REVIEWER) {
      plan.lotPatch = { strain_type: value, fact_provenance: withStamp(lotProv, "strain_type", LOT_STRAIN_REVIEWER) };
    }
  } else if (lotNow !== null || "strain_type" in lotProv) {
    plan.lotPatch = { strain_type: null, fact_provenance: withStamp(lotProv, "strain_type", null) };
  }

  // 2. The menu cards that sell this lot.
  if (key) {
    for (const card of input.cards) {
      if (!cardBelongsToLot(card, key)) continue;
      const prov = obj(card.factProvenance);
      const current = canon(card.strainType);
      const target = value ?? "unknown";
      if (value !== null && current === value && prov.strain_type === LOT_STRAIN_REVIEWER) {
        plan.cardsAlready += 1;
        continue;
      }
      if (value === null && current === null && !("strain_type" in prov)) {
        plan.cardsAlready += 1;
        continue;
      }
      const disagree = siblingLotKeys(card, key).filter((k) => {
        if (!input.siblingLotTypes.has(k)) return false; // not a lot we know of: no answer to protect
        const t = canon(input.siblingLotTypes.get(k) ?? null);
        return t !== null && t !== value;
      });
      if (disagree.length > 0) {
        const theirs = [...new Set(disagree.map((k) => strainTypeLabel(canon(input.siblingLotTypes.get(k) ?? null) ?? "unknown")))];
        plan.cardsSkipped.push({
          id: card.id,
          versionStatus: card.versionStatus,
          name: card.name,
          reason: `this card also sells ${disagree.length} other lot(s) marked ${theirs.join(" / ")}; fix those lots too, or the card keeps its current type`,
        });
        continue;
      }
      plan.cardPatches.push({
        id: card.id,
        versionStatus: card.versionStatus,
        name: card.name,
        patch: { strain_type: target, fact_provenance: withStamp(prov, "strain_type", value === null ? null : LOT_STRAIN_REVIEWER) },
      });
    }
  }

  // 3. Onboarding memory: every approved draft linked to this lot.
  for (const d of input.drafts) {
    const prov = obj(d.chosenClassificationProvenance);
    const now = canon(d.chosenStrainType);
    if (value !== null && now === value && prov.strainType === DRAFT_STRAIN_HUMAN) continue;
    if (value === null && now === null && !("strainType" in prov)) continue;
    plan.draftPatches.push({
      id: d.id,
      patch: { chosen_strain_type: value, chosen_classification_provenance: withStamp(prov, "strainType", value === null ? null : DRAFT_STRAIN_HUMAN) },
    });
  }
  return plan;
}

export type PropagationResult = {
  value: string | null;
  lotWritten: boolean;
  cardsUpdated: { published: number; staged: number };
  cardsAlready: number;
  cardsSkipped: CardSkip[];
  draftsUpdated: number;
  /** The lot has no POS product key, so no menu card can be found for it. */
  noKey: boolean;
  errors: string[];
};

/** One plain sentence for the Inventory Detail banner after a save. */
export function strainPropagationBanner(r: PropagationResult): string {
  const label = r.value === null ? "Unknown" : strainTypeLabel(r.value);
  const parts: string[] = [`Strain type is now ${label}.`];
  const live = r.cardsUpdated.published;
  const staged = r.cardsUpdated.staged;
  if (live > 0 || staged > 0) {
    const bits: string[] = [];
    if (live > 0) bits.push(`${live} live website card${live === 1 ? "" : "s"}`);
    if (staged > 0) bits.push(`${staged} staged card${staged === 1 ? "" : "s"}`);
    parts.push(`Updated ${bits.join(" and ")} (the website refreshes now).`);
  } else if (r.cardsAlready > 0) {
    parts.push("The website already shows it.");
  } else if (r.noKey) {
    parts.push("This lot has no POS product key, so it is not on the website menu.");
  } else {
    parts.push("This lot is not on the website menu yet; it will carry this type when it is published.");
  }
  if (r.draftsUpdated > 0) parts.push("Onboarding will remember it for the next delivery of this product.");
  for (const s of r.cardsSkipped.slice(0, 2)) parts.push(`Not changed: "${s.name}" - ${s.reason}.`);
  if (r.errors.length > 0) parts.push(`Some updates failed: ${r.errors.slice(0, 2).join("; ")}.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runLotStrainPropagationCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL lot-strain-propagation-core: " + msg);
    }
  };
  const card = (over: Partial<PropagationCard>): PropagationCard => ({
    id: "c1",
    versionId: "v1",
    versionStatus: "published",
    sourceItemId: "K",
    name: "Blue Dream 3.5g",
    strainType: "hybrid",
    factProvenance: {},
    variantSourceIds: ["K-abc"],
    ...over,
  });
  const base = (over: Partial<PropagationInput>): PropagationInput => ({
    lotId: "L1",
    posProductKey: "K",
    newType: "indica",
    lot: { strainType: "indica", factProvenance: { package_thc_mg: "coa" } },
    cards: [card({})],
    siblingLotTypes: new Map(),
    drafts: [{ id: "d1", chosenStrainType: "hybrid", chosenClassificationProvenance: { houseType: "remembered" } }],
    ...over,
  });

  // Single-lot card, lot already saved (the "save did not stick" case).
  const p1 = planLotStrainPropagation(base({}));
  ok(p1.value === "indica", "value canonical");
  ok(p1.lotPatch?.fact_provenance.strain_type === "reviewer", "lot stamped reviewer");
  ok(p1.lotPatch?.fact_provenance.package_thc_mg === "coa", "other lot provenance kept");
  ok(p1.cardPatches.length === 1 && p1.cardPatches[0].patch.strain_type === "indica", "own card updated");
  ok(p1.cardPatches[0].patch.fact_provenance.strain_type === "reviewer", "card stamped reviewer");
  ok(p1.draftPatches.length === 1 && p1.draftPatches[0].patch.chosen_strain_type === "indica", "draft memory updated");
  ok(p1.draftPatches[0].patch.chosen_classification_provenance.strainType === "human", "draft provenance human");
  ok(p1.draftPatches[0].patch.chosen_classification_provenance.houseType === "remembered", "draft other provenance kept");

  // Idempotent: everything already says indica from a person.
  const p2 = planLotStrainPropagation(
    base({
      lot: { strainType: "indica", factProvenance: { strain_type: "reviewer" } },
      cards: [card({ strainType: "indica", factProvenance: { strain_type: "reviewer" } })],
      drafts: [{ id: "d1", chosenStrainType: "indica", chosenClassificationProvenance: { strainType: "human" } }],
    }),
  );
  ok(p2.lotPatch === null && p2.cardPatches.length === 0 && p2.draftPatches.length === 0, "no-op when already set");
  ok(p2.cardsAlready === 1, "already-set card counted");

  // Same value but from the library (no stamp) -> stamp it so the overlay cannot revert it.
  const p3 = planLotStrainPropagation(base({ cards: [card({ strainType: "indica", factProvenance: { strain_type: "kb" } })] }));
  ok(p3.cardPatches.length === 1 && p3.cardPatches[0].patch.fact_provenance.strain_type === "reviewer", "library value restamped as reviewer");

  // Not this lot's card -> untouched.
  const p4 = planLotStrainPropagation(base({ cards: [card({ sourceItemId: "OTHER", variantSourceIds: ["OTHER-x"] })] }));
  ok(p4.cardPatches.length === 0 && p4.cardsSkipped.length === 0, "foreign card never touched");

  // Mastered card that holds this lot's onboarded variant; sibling agrees/unknown -> updated.
  const mastered = card({ sourceItemId: "S", variantSourceIds: ["S-onboarded", "K-onboarded"] });
  const p5 = planLotStrainPropagation(base({ cards: [mastered], siblingLotTypes: new Map([["S", null]]) }));
  ok(p5.cardPatches.length === 1, "mastered card updated when sibling has no value");
  const p5b = planLotStrainPropagation(base({ cards: [mastered], siblingLotTypes: new Map([["S", "Indica"]]) }));
  ok(p5b.cardPatches.length === 1, "mastered card updated when sibling agrees");

  // Sibling disagrees -> skipped with a reason, never overwritten.
  const p6 = planLotStrainPropagation(base({ cards: [mastered], siblingLotTypes: new Map([["S", "sativa"]]) }));
  ok(p6.cardPatches.length === 0 && p6.cardsSkipped.length === 1, "disagreeing sibling blocks the card");
  ok(p6.cardsSkipped[0].reason.includes("Sativa"), "skip reason names the sibling's type");
  ok(p6.lotPatch !== null && p6.draftPatches.length === 1, "lot + memory still update when a card is skipped");

  // Card keyed by this lot but carrying another lot's onboarded variant.
  const own = card({ sourceItemId: "K", variantSourceIds: ["K-onboarded", "Z-onboarded"] });
  const p7 = planLotStrainPropagation(base({ cards: [own], siblingLotTypes: new Map([["Z", "sativa"]]) }));
  ok(p7.cardsSkipped.length === 1, "own-key card with disagreeing sibling skipped");
  ok(siblingLotKeys(own, "K").join(",") === "Z", "sibling keys exclude self");
  ok(siblingLotKeys(mastered, "K").join(",") === "S", "sibling keys include the card owner");

  // Clearing to Unknown.
  const p8 = planLotStrainPropagation(
    base({
      newType: null,
      lot: { strainType: "indica", factProvenance: { strain_type: "reviewer", x: "y" } },
      cards: [card({ strainType: "indica", factProvenance: { strain_type: "reviewer" } })],
      drafts: [{ id: "d1", chosenStrainType: "indica", chosenClassificationProvenance: { strainType: "human" } }],
    }),
  );
  ok(p8.value === null && p8.lotPatch?.strain_type === null, "clear lot");
  ok(p8.lotPatch !== null && !("strain_type" in p8.lotPatch.fact_provenance) && p8.lotPatch.fact_provenance.x === "y", "clear removes only the stamp");
  ok(p8.cardPatches[0]?.patch.strain_type === "unknown", "card cleared to unknown (NOT NULL column)");
  ok(!("strain_type" in (p8.cardPatches[0]?.patch.fact_provenance ?? { strain_type: 1 })), "card stamp removed so the library may fill");
  ok(p8.draftPatches[0]?.patch.chosen_strain_type === null && !("strainType" in p8.draftPatches[0].patch.chosen_classification_provenance), "draft memory forgotten");
  const p9 = planLotStrainPropagation(base({ newType: null, lot: { strainType: null, factProvenance: {} }, cards: [card({ strainType: "unknown" })], drafts: [] }));
  ok(p9.lotPatch === null && p9.cardPatches.length === 0 && p9.cardsAlready === 1, "clear is a no-op when nothing is set");

  // No key -> lot + drafts only.
  const p10 = planLotStrainPropagation(base({ posProductKey: null }));
  ok(p10.cardPatches.length === 0 && p10.lotPatch !== null && p10.draftPatches.length === 1, "no key: lot + drafts only");
  ok(!cardBelongsToLot(card({}), ""), "blank key never matches");

  // Malformed provenance never crashes.
  const p11 = planLotStrainPropagation(base({ lot: { strainType: null, factProvenance: [1, 2] }, cards: [card({ factProvenance: "x" })] }));
  ok(p11.lotPatch?.fact_provenance.strain_type === "reviewer" && Object.keys(p11.lotPatch.fact_provenance).length === 1, "array provenance treated as empty");
  ok(planLotStrainPropagation(base({ newType: "Indica Hybrid" })).value === "indica-hybrid", "free-text canonicalised");

  // Banner copy.
  const r = (over: Partial<PropagationResult>): PropagationResult => ({
    value: "indica",
    lotWritten: true,
    cardsUpdated: { published: 0, staged: 0 },
    cardsAlready: 0,
    cardsSkipped: [],
    draftsUpdated: 0,
    noKey: false,
    errors: [],
    ...over,
  });
  ok(strainPropagationBanner(r({ cardsUpdated: { published: 1, staged: 1 } })).includes("1 live website card and 1 staged card"), "banner counts");
  ok(strainPropagationBanner(r({ cardsUpdated: { published: 2, staged: 0 } })).includes("2 live website cards"), "banner plural");
  ok(strainPropagationBanner(r({ cardsAlready: 1 })).includes("already shows"), "banner already");
  ok(strainPropagationBanner(r({ noKey: true })).includes("no POS product key"), "banner no key");
  ok(strainPropagationBanner(r({})).includes("not on the website menu yet"), "banner not on menu");
  ok(strainPropagationBanner(r({ draftsUpdated: 1 })).includes("remember"), "banner memory");
  ok(strainPropagationBanner(r({ value: null })).startsWith("Strain type is now Unknown."), "banner unknown");
  ok(strainPropagationBanner(r({ errors: ["boom"] })).includes("boom"), "banner errors");
  ok(strainPropagationBanner(r({ cardsSkipped: [{ id: "c", versionStatus: "published", name: "GG4", reason: "why" }] })).includes('Not changed: "GG4" - why.'), "banner skip");

  console.log(`lot-strain-propagation-core self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
