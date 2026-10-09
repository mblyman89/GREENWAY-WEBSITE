/**
 * src/lib/inventory/onboarding-recall-core.ts
 *
 * R32 (T-328) — ONBOARDING IDENTITY MEMORY ("golden record" survivorship for
 * the onboarding card's category, product type and strain type).
 *
 * OWNER'S REPORT: "I often see a yellow Needs type warning, even after I have
 * received the same product before and had it set before." Root cause
 * (verified, not assumed):
 *   1. pos_product_key is `sku ?? lot_code`, so without a vendor SKU every
 *      delivery is a brand-new key, and nothing on the card looked back.
 *   2. The SLICE 18F memory (listPriorClassifications) only carries the
 *      COMPLIANCE answers — it never read chosen_house_type or
 *      chosen_strain_type, so the type and strain picks were forgotten.
 *   3. deriveHouseType() deliberately returns "no signal" for a plain strain
 *      name on flower ("Blue Dream 3.5g"), so the most common product in the
 *      store always demanded a type pick even though the Flower category has
 *      exactly ONE product type.
 *
 * THE ENTERPRISE PATTERN (master-data management "survivorship"): each field
 * of a product's golden record is resolved independently, from an ordered
 * list of trusted sources, and every resolved value carries its provenance so
 * a reader can always tell a person's decision from a machine's inference:
 *
 *   product type   1. the approver's pick on this card               (human)
 *                  2. this product's last HUMAN pick (same identity)  (remembered)
 *                  3. the type labeler at >= 90%                       (auto — unchanged)
 *                  4. the category has exactly ONE product type        (category)
 *   strain type    1. the approver's pick                              (human)
 *                  2. this product's last HUMAN pick                   (remembered)
 *                  3. strain library > manifest > name (SLICE 93, unchanged)
 *   category       1. the approver's pick                              (human)
 *                  2. the resolver (unchanged)
 *                  3. when the resolver has NONE: this product's last human
 *                     shelf, only when exactly one shelf matches        (remembered)
 *
 * "Same product" = the S03 identity key (vendor | category axis | family) —
 * the same key the knowledge base, the classification memory and the
 * identity stamp use (classificationMemoryKey; one algorithm, never a fork).
 * An empty key is "unknown" and never matches anything.
 *
 * WHAT IS RECALLABLE (the 18F rule, applied to these fields): only values a
 * PERSON decided. A pre-R32 chosen_house_type / chosen_strain_type was only
 * ever written when a human picked (catalog-drafts.ts SLICE 64 / 93), so a
 * value with no provenance stamp is a human one. From R32 on every write is
 * stamped; a "category" (machine) value is never replayed — it is simply
 * re-derived, so a machine inference can never launder itself into memory.
 *
 * PURE: no I/O. Registered in scripts/compliance/run-pure-selftests.ts.
 */
import { classificationMemoryKey } from "@/lib/inventory/classification-memory-core";
import { INVENTORY_TYPE_CATALOG } from "@/lib/pos/inventory-type-catalog";
import { canonicalStrainType, strainTypeLabel } from "@/lib/menu/strain-taxonomy";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Per-field provenance written into catalog_product_drafts.
 * chosen_classification_provenance under the keys websiteCategory / houseType
 * / strainType (jsonb, no check constraint — documented in the Intake Pipeline Bible R32 section; no migration needed).
 * "human" and "remembered" are the SAME words SLICE 18F uses for
 * otherwiseTaken, so one reader understands every key.
 */
export const ONBOARDING_PICK_PROVENANCE = {
  /** The approver chose it on this card (fresh, or different from memory). */
  human: "human",
  /** This product's own earlier human decision, shown on the card and approved. */
  remembered: "remembered",
  /** Machine: the category has exactly one product type (deterministic). */
  category: "category",
} as const;
export type OnboardingPickProvenance =
  (typeof ONBOARDING_PICK_PROVENANCE)[keyof typeof ONBOARDING_PICK_PROVENANCE];

/** Provenance keys this core owns inside chosen_classification_provenance. */
export const ONBOARDING_PROVENANCE_KEYS = {
  websiteCategory: "websiteCategory",
  houseType: "houseType",
  strainType: "strainType",
} as const;

const RECALLABLE = new Set<string>([ONBOARDING_PICK_PROVENANCE.human, ONBOARDING_PICK_PROVENANCE.remembered]);

/** Confidence shown for a remembered human decision (above manifest 95, below a curated 100). */
export const REMEMBERED_PICK_CONFIDENCE = 97;
/** Confidence shown for a category with exactly one product type. */
export const CATEGORY_IMPLIED_TYPE_CONFIDENCE = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One APPROVED draft's onboarding picks (listPriorOnboardingPicks row). */
export type PriorOnboardingPick = {
  draftId: string;
  vendorName: string | null;
  brandName: string | null;
  productName: string | null;
  /** Raw draft category (LCB) — used only when no shelf was chosen. */
  category: string | null;
  chosenWebsiteCategory: string | null;
  chosenHouseType: string | null;
  chosenStrainType: string | null;
  /** chosen_classification_provenance (any shape; read defensively). */
  provenance: unknown;
  decidedAt: string | null;
  decidedBy: string | null;
};

export type RecalledValue = {
  value: string;
  provenance: OnboardingPickProvenance;
  confidence: number;
  /** Plain-English source for the card ("your pick on the 2026-02-01 intake"). */
  sourceText: string;
  /** The approved draft the memory came from (null for category-implied). */
  fromDraftId: string | null;
  decidedAt: string | null;
};

export type OnboardingRecall = {
  identityKey: string;
  websiteCategory: RecalledValue | null;
  houseType: RecalledValue | null;
  strainType: RecalledValue | null;
};

/** A product type the picker allows (catalog ∪ owner registry). */
export type AllowedType = { label: string; websiteCategory: string | null };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(v: string | null | undefined): string {
  return String(v ?? "").trim();
}

function provOf(raw: unknown, key: string): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

/** Pre-R32 rows carry no stamp for these keys; those values were human-only writes. */
function isRecallableValue(raw: unknown, key: string): boolean {
  const p = provOf(raw, key);
  return p === null || RECALLABLE.has(p);
}

function ms(iso: string | null): number {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : 0;
}

function day(iso: string | null): string | null {
  const t = ms(iso);
  return t ? new Date(t).toISOString().slice(0, 10) : null;
}

function rememberedText(iso: string | null): string {
  const d = day(iso);
  return d ? `your pick on the ${d} intake` : "your pick on an earlier intake";
}

function newestFirst(a: PriorOnboardingPick, b: PriorOnboardingPick): number {
  return ms(b.decidedAt) - ms(a.decidedAt);
}

/** The shelf a prior decision was recorded against (human shelf first). */
function priorShelf(p: PriorOnboardingPick): string | null {
  return clean(p.chosenWebsiteCategory) || clean(p.category) || null;
}

/** Identity key of a candidate on a given shelf ("" = unknown, never matches). */
export function onboardingIdentityKey(c: {
  vendorName: string | null | undefined;
  brandName: string | null | undefined;
  productName: string | null | undefined;
  category: string | null | undefined;
}): string {
  const key = classificationMemoryKey({
    vendorName: c.vendorName ?? null,
    brandName: c.brandName ?? null,
    productName: c.productName ?? null,
    category: c.category ?? null,
  });
  // Same refusal rule as productIdentityKey: no vendor/brand part → unknown.
  if (key === "" || key.startsWith("|")) return "";
  return key;
}

// ---------------------------------------------------------------------------
// Category-implied product type
// ---------------------------------------------------------------------------

/**
 * The ONE product type a website category allows, or null when it allows
 * none or several. Built from the hardcoded catalog PLUS the owner's own
 * registry types (an owner who created "Smalls" under Flower makes Flower a
 * two-type category, so nothing is implied any more — never guess).
 */
export function singleTypeForCategory(
  websiteCategory: string | null | undefined,
  ownerTypes: readonly AllowedType[] = [],
): string | null {
  const cat = clean(websiteCategory);
  if (!cat) return null;
  const labels = new Set<string>();
  for (const e of INVENTORY_TYPE_CATALOG) if (e.websiteCategory === cat) labels.add(e.label);
  for (const t of ownerTypes) if (clean(t.websiteCategory) === cat && clean(t.label)) labels.add(clean(t.label));
  return labels.size === 1 ? Array.from(labels)[0] : null;
}

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

export function recallOnboardingPicks(input: {
  candidate: {
    vendorName: string | null | undefined;
    brandName: string | null | undefined;
    productName: string | null | undefined;
  };
  /** The resolver's shelf for THIS draft (null = unmapped). */
  resolvedWebsiteCategory: string | null | undefined;
  history: readonly PriorOnboardingPick[] | null | undefined;
  /** Every type label the picker allows (catalog ∪ registry); a memory outside it is dropped. */
  allowedTypeLabels?: ReadonlySet<string> | null;
}): OnboardingRecall {
  const history = (input.history ?? []).filter(Boolean).slice().sort(newestFirst);
  const resolved = clean(input.resolvedWebsiteCategory) || null;

  // 1) Category memory — ONLY when the resolver has no shelf. For each prior
  //    shelf, ask "would THIS draft be that same product on that shelf?".
  //    Exactly one distinct shelf may match; two = ambiguous = no recall.
  let websiteCategory: RecalledValue | null = null;
  if (!resolved) {
    const shelves = new Map<string, PriorOnboardingPick>();
    for (const p of history) {
      const shelf = clean(p.chosenWebsiteCategory);
      if (!shelf) continue;
      if (!isRecallableValue(p.provenance, ONBOARDING_PROVENANCE_KEYS.websiteCategory)) continue;
      const k = onboardingIdentityKey({ ...input.candidate, category: shelf });
      if (k === "" || k !== onboardingIdentityKey({ ...p, category: shelf })) continue;
      if (!shelves.has(shelf)) shelves.set(shelf, p); // newest per shelf (history is sorted)
    }
    if (shelves.size === 1) {
      const [shelf, p] = Array.from(shelves.entries())[0];
      websiteCategory = {
        value: shelf,
        provenance: ONBOARDING_PICK_PROVENANCE.remembered,
        confidence: REMEMBERED_PICK_CONFIDENCE,
        sourceText: rememberedText(p.decidedAt),
        fromDraftId: p.draftId,
        decidedAt: p.decidedAt,
      };
    }
  }

  const shelf = resolved ?? websiteCategory?.value ?? null;
  const identityKey = onboardingIdentityKey({ ...input.candidate, category: shelf });
  const same = identityKey === ""
    ? []
    : history.filter((p) => onboardingIdentityKey({ ...p, category: priorShelf(p) }) === identityKey);

  // 2) Product type — newest recallable human pick that is still a legal type.
  let houseType: RecalledValue | null = null;
  for (const p of same) {
    const t = clean(p.chosenHouseType);
    if (!t) continue;
    if (!isRecallableValue(p.provenance, ONBOARDING_PROVENANCE_KEYS.houseType)) continue;
    if (input.allowedTypeLabels && !input.allowedTypeLabels.has(t)) continue;
    houseType = {
      value: t,
      provenance: ONBOARDING_PICK_PROVENANCE.remembered,
      confidence: REMEMBERED_PICK_CONFIDENCE,
      sourceText: rememberedText(p.decidedAt),
      fromDraftId: p.draftId,
      decidedAt: p.decidedAt,
    };
    break;
  }

  // 3) Strain type — newest recallable human pick that canonicalises.
  let strainType: RecalledValue | null = null;
  for (const p of same) {
    const s = canonicalStrainType(clean(p.chosenStrainType));
    if (s === "unknown") continue;
    if (!isRecallableValue(p.provenance, ONBOARDING_PROVENANCE_KEYS.strainType)) continue;
    strainType = {
      value: s,
      provenance: ONBOARDING_PICK_PROVENANCE.remembered,
      confidence: REMEMBERED_PICK_CONFIDENCE,
      sourceText: rememberedText(p.decidedAt),
      fromDraftId: p.draftId,
      decidedAt: p.decidedAt,
    };
    break;
  }

  return { identityKey, websiteCategory, houseType, strainType };
}

// ---------------------------------------------------------------------------
// The effective product type (card + server gate share THIS function)
// ---------------------------------------------------------------------------

export type EffectiveTypeSource = "remembered" | "auto" | "category" | "none";

export type EffectiveType = {
  /** The type the product will carry when the approver keeps auto. */
  value: string | null;
  source: EffectiveTypeSource;
  confidence: number;
  /** True when a person must pick (nothing trustworthy at >= 90%). */
  needsTypePick: boolean;
  /** Placeholder text for the picker's empty option. */
  placeholder: string;
  /** Short chip text for the row ("remembered", "auto 95%", "Flower is the only type"). */
  basis: string;
  /** Provenance to stamp when this value is PERSISTED (null = not persisted; the menu re-derives it). */
  persistProvenance: OnboardingPickProvenance | null;
};

/**
 * Resolve the type a draft carries when the approver does not pick one.
 * `labeler` is assessDraftClassification()'s verdict (unchanged SLICE 63/64).
 */
export function effectiveHouseType(input: {
  labeler: { houseType: string | null; confidence: number; autoAssigned: boolean };
  recalled: RecalledValue | null;
  websiteCategory: string | null | undefined;
  ownerTypes?: readonly AllowedType[];
}): EffectiveType {
  if (input.recalled) {
    return {
      value: input.recalled.value,
      source: "remembered",
      confidence: input.recalled.confidence,
      needsTypePick: false,
      placeholder: `Keep: ${input.recalled.value} (${input.recalled.sourceText})`,
      basis: `remembered — ${input.recalled.sourceText}`,
      persistProvenance: ONBOARDING_PICK_PROVENANCE.remembered,
    };
  }
  if (input.labeler.autoAssigned && input.labeler.houseType) {
    return {
      value: input.labeler.houseType,
      source: "auto",
      confidence: input.labeler.confidence,
      needsTypePick: false,
      placeholder: `Keep auto: ${input.labeler.houseType} (${input.labeler.confidence}% confident)`,
      basis: `${input.labeler.confidence}% confident`,
      persistProvenance: null,
    };
  }
  // A name signal that DISAGREES with the shelf (the SLICE 63 60% clash) is a
  // real conflict: a person decides. The category is never allowed to paper
  // over it.
  const implied = input.labeler.houseType ? null : singleTypeForCategory(input.websiteCategory, input.ownerTypes ?? []);
  if (implied) {
    return {
      value: implied,
      source: "category",
      confidence: CATEGORY_IMPLIED_TYPE_CONFIDENCE,
      needsTypePick: false,
      placeholder: `Keep auto: ${implied} (the only type in this category)`,
      basis: "only type in this category",
      persistProvenance: ONBOARDING_PICK_PROVENANCE.category,
    };
  }
  return {
    value: null,
    source: "none",
    confidence: input.labeler.confidence,
    needsTypePick: true,
    placeholder: "Pick a product type\u2026",
    basis: "needs a pick",
    persistProvenance: null,
  };
}

/**
 * Provenance for a type the approver SUBMITTED. Matching this product's own
 * remembered answer = "remembered" (a confirmation); anything else = "human".
 * Server-side only — the form never asserts its own provenance.
 */
export function submittedPickProvenance(submitted: string, recalled: RecalledValue | null): OnboardingPickProvenance {
  return recalled && clean(recalled.value) === clean(submitted)
    ? ONBOARDING_PICK_PROVENANCE.remembered
    : ONBOARDING_PICK_PROVENANCE.human;
}

// ---------------------------------------------------------------------------
// The effective strain type (card + server share THIS function)
// ---------------------------------------------------------------------------

/** The machine strain suggestion shape (strain-type-intel-core StrainTypeSuggestion). */
export type StrainSuggestionLike = {
  value: string;
  confidence: number;
  source: "strain library" | "manifest" | "product name";
} | null;

/** The auto bar for strain type (mirrors STRAIN_TYPE_AUTO_MIN_CONFIDENCE = 90). */
export const STRAIN_AUTO_BAR = 90;

export type EffectiveStrain = {
  /** Canonical value the product carries when nobody picks (null = blank). */
  value: string | null;
  source: "remembered" | "strain library" | "manifest" | "product name" | "none";
  confidence: number;
  /** Persist on the draft as chosen_strain_type (only a remembered human decision). */
  persistOnDraft: boolean;
  /** fact_provenance.strain_type to stamp when FILLING an empty lot (null = never fill). */
  lotProvenance: "remembered" | "kb" | "manifest" | "name" | null;
  /** Plain-English conflict note (memory vs strain library), or null. */
  conflict: string | null;
};

/**
 * Survivorship for strain type when the approver does not pick:
 * remembered human decision for THIS product > machine verdict >= 90
 * (strain library > manifest > name). A remembered pick that disagrees with
 * the strain library still wins (a person decided for this exact product),
 * but the disagreement is surfaced, never hidden.
 */
export function effectiveStrainType(input: {
  recalled: RecalledValue | null;
  suggestion: StrainSuggestionLike;
}): EffectiveStrain {
  const s = input.suggestion;
  const sVal = s ? canonicalStrainType(s.value) : "unknown";
  if (input.recalled) {
    const conflict =
      s && s.source === "strain library" && sVal !== "unknown" && sVal !== input.recalled.value
        ? `The strain library says ${strainTypeLabel(sVal)}; your earlier pick for this product (${strainTypeLabel(input.recalled.value)}) is kept.`
        : null;
    return {
      value: input.recalled.value,
      source: "remembered",
      confidence: input.recalled.confidence,
      persistOnDraft: true,
      lotProvenance: "remembered",
      conflict,
    };
  }
  if (s && sVal !== "unknown" && s.confidence >= STRAIN_AUTO_BAR) {
    const lotProvenance = s.source === "strain library" ? "kb" : s.source === "manifest" ? "manifest" : "name";
    return { value: sVal, source: s.source, confidence: s.confidence, persistOnDraft: false, lotProvenance, conflict: null };
  }
  return { value: null, source: "none", confidence: s?.confidence ?? 0, persistOnDraft: false, lotProvenance: null, conflict: null };
}

export type LotStrainFillPlan =
  | { write: true; lotId: string; patch: { strain_type: string; fact_provenance: Record<string, unknown> } }
  | { write: false; code: "no_lot" | "no_value" | "lot_has_value"; reason: string };

/**
 * R32: fill an EMPTY lot strain type with the approval's effective machine /
 * remembered value, so the inventory table never shows a blank for a product
 * whose type is known. FILL-ONLY: a lot that already carries any value (a
 * person's "reviewer" answer, or the manifest's stated fact) is never
 * overwritten by the machine. Pure.
 */
export function planLotStrainFill(input: {
  lotId: string | null | undefined;
  effective: Pick<EffectiveStrain, "value" | "lotProvenance">;
  lotStrainType: string | null | undefined;
  lotFactProvenance: unknown;
}): LotStrainFillPlan {
  const lotId = clean(input.lotId);
  if (!lotId) return { write: false, code: "no_lot", reason: "This draft is not linked to an inventory lot." };
  const v = canonicalStrainType(clean(input.effective.value));
  if (v === "unknown" || !input.effective.lotProvenance) {
    return { write: false, code: "no_value", reason: "No strain type is known at 90% or better; the lot stays blank." };
  }
  const before = canonicalStrainType(clean(input.lotStrainType));
  if (before !== "unknown") {
    return { write: false, code: "lot_has_value", reason: `The lot already carries ${before}; the machine never overwrites it.` };
  }
  const prov =
    input.lotFactProvenance && typeof input.lotFactProvenance === "object" && !Array.isArray(input.lotFactProvenance)
      ? (input.lotFactProvenance as Record<string, unknown>)
      : {};
  return { write: true, lotId, patch: { strain_type: v, fact_provenance: { ...prov, strain_type: input.effective.lotProvenance } } };
}

/** Strain picker placeholder when a remembered pick exists (else SLICE 93's text). */
export function rememberedStrainPlaceholder(recalled: RecalledValue): string {
  return `Keep: ${strainTypeLabel(recalled.value)} (${recalled.sourceText})`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runOnboardingRecallCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ onboarding-recall-core: ${name}`);
    }
  };

  const prior = (over: Partial<PriorOnboardingPick>): PriorOnboardingPick => ({
    draftId: "d-old",
    vendorName: "Northwest Farms",
    brandName: "NWF",
    productName: "Blue Dream 3.5g",
    category: "Usable Marijuana",
    chosenWebsiteCategory: "flower",
    chosenHouseType: null,
    chosenStrainType: null,
    provenance: { otherwiseTaken: "machine_default" },
    decidedAt: "2026-02-01T18:00:00Z",
    decidedBy: "u1",
    ...over,
  });
  const cand = { vendorName: "Northwest Farms", brandName: "NWF", productName: "Blue Dream 3.5g" };

  // Single-type categories (catalog).
  ok(singleTypeForCategory("flower") === "Flower", "flower → Flower");
  ok(singleTypeForCategory("popcorn-bud") === "Popcorn Bud", "popcorn-bud → Popcorn Bud");
  ok(singleTypeForCategory("trim") === "Trim", "trim → Trim");
  ok(singleTypeForCategory("disposable-cartridge") === "Disposable Cartridge", "disposable → Disposable Cartridge");
  ok(singleTypeForCategory("preroll") === null, "preroll has two types → none");
  ok(singleTypeForCategory("concentrate") === null, "concentrate many → none");
  ok(singleTypeForCategory(null) === null && singleTypeForCategory("") === null, "no category → none");
  ok(singleTypeForCategory("not-a-shelf") === null, "unknown shelf → none");
  ok(singleTypeForCategory("flower", [{ label: "Smalls", websiteCategory: "flower" }]) === null, "owner type makes flower two-type");
  ok(singleTypeForCategory("flower", [{ label: "Flower", websiteCategory: "flower" }]) === "Flower", "owner duplicate of catalog label stays single");
  ok(singleTypeForCategory("flower", [{ label: "Smalls", websiteCategory: "trim" }]) === "Flower", "owner type on another shelf ignored");

  // Type + strain recall by identity, across a NEW lot code / pos key.
  const h1 = [
    prior({ draftId: "a", chosenHouseType: "Popcorn Bud", chosenStrainType: "indica", decidedAt: "2026-01-01T00:00:00Z" }),
    prior({ draftId: "b", chosenHouseType: "Flower", chosenStrainType: "indica-hybrid", decidedAt: "2026-02-01T00:00:00Z" }),
  ];
  const r1 = recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: "flower", history: h1 });
  ok(r1.houseType?.value === "Flower" && r1.houseType.fromDraftId === "b", "newest human type wins");
  ok(r1.strainType?.value === "indica-hybrid" && r1.strainType.fromDraftId === "b", "newest human strain wins");
  ok(r1.houseType?.sourceText === "your pick on the 2026-02-01 intake", "source text names the intake day");
  ok(r1.websiteCategory === null, "resolved shelf → no category recall");
  ok(r1.identityKey !== "", "identity key built");

  // Field-level survivorship: newest row without a strain pick does not erase an older strain pick.
  const h2 = [
    prior({ draftId: "old", chosenStrainType: "sativa", decidedAt: "2026-01-01T00:00:00Z" }),
    prior({ draftId: "new", chosenHouseType: "Flower", chosenStrainType: null, decidedAt: "2026-03-01T00:00:00Z" }),
  ];
  const r2 = recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: "flower", history: h2 });
  ok(r2.houseType?.fromDraftId === "new" && r2.strainType?.fromDraftId === "old", "each field survives independently");

  // A different product never matches; a different vendor never matches.
  const r3 = recallOnboardingPicks({ candidate: { ...cand, productName: "Sour Diesel 3.5g" }, resolvedWebsiteCategory: "flower", history: h1 });
  ok(r3.houseType === null && r3.strainType === null, "different product → nothing");
  const r4 = recallOnboardingPicks({ candidate: { vendorName: "Other Co", brandName: "Other", productName: "Blue Dream 3.5g" }, resolvedWebsiteCategory: "flower", history: h1 });
  ok(r4.houseType === null, "different vendor → nothing");
  // Size differences are the same product (identity carries no size).
  const r5 = recallOnboardingPicks({ candidate: { ...cand, productName: "Blue Dream 7g" }, resolvedWebsiteCategory: "flower", history: h1 });
  ok(r5.houseType?.value === "Flower", "another size of the same product recalls");
  // Different shelf (category axis) = different product.
  const r6 = recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: "preroll", history: h1 });
  ok(r6.houseType === null, "different shelf → nothing");

  // No vendor/brand → unknown identity → never matches.
  const r7 = recallOnboardingPicks({ candidate: { vendorName: null, brandName: null, productName: "Blue Dream 3.5g" }, resolvedWebsiteCategory: "flower", history: [prior({ vendorName: null, brandName: null, chosenHouseType: "Flower" })] });
  ok(r7.identityKey === "" && r7.houseType === null, "unknown identity never matches");

  // Machine-stamped values are not replayed; legacy (unstamped) are.
  const r8 = recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: "flower", history: [prior({ chosenHouseType: "Flower", provenance: { houseType: "category" } })] });
  ok(r8.houseType === null, "category-implied (machine) type is never recalled");
  const r9 = recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: "flower", history: [prior({ chosenHouseType: "Flower", provenance: null })] });
  ok(r9.houseType?.value === "Flower", "legacy unstamped (human-only write) is recalled");
  const r10 = recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: "flower", history: [prior({ chosenHouseType: "Flower", provenance: { houseType: "remembered" } })] });
  ok(r10.houseType?.value === "Flower", "remembered is recalled");
  const r10b = recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: "flower", history: [prior({ chosenStrainType: "indica", provenance: { strainType: "weird" } })] });
  ok(r10b.strainType === null, "unknown provenance value is not recalled");

  // Type outside the allowed set (deactivated owner type) is dropped.
  const r11 = recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: "flower", history: [prior({ chosenHouseType: "Retired Type" })], allowedTypeLabels: new Set(["Flower"]) });
  ok(r11.houseType === null, "no-longer-legal type dropped");
  // Junk strain never recalled.
  const r12 = recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: "flower", history: [prior({ chosenStrainType: "purple" })] });
  ok(r12.strainType === null, "junk strain not recalled");
  ok(recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: "flower", history: null }).houseType === null, "null history safe");

  // Category recall only when unmapped, and only when exactly one shelf matches.
  const r13 = recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: null, history: [prior({ chosenWebsiteCategory: "flower", chosenHouseType: "Flower" })] });
  ok(r13.websiteCategory?.value === "flower" && r13.houseType?.value === "Flower", "unmapped → remembered shelf → remembered type");
  const r14 = recallOnboardingPicks({
    candidate: cand,
    resolvedWebsiteCategory: null,
    history: [prior({ chosenWebsiteCategory: "flower" }), prior({ draftId: "x", chosenWebsiteCategory: "popcorn-bud" })],
  });
  ok(r14.websiteCategory === null, "two remembered shelves → ambiguous → none");
  const r15 = recallOnboardingPicks({ candidate: cand, resolvedWebsiteCategory: null, history: [prior({ chosenWebsiteCategory: null })] });
  ok(r15.websiteCategory === null, "no human shelf → none");

  // Effective type precedence.
  const lab0 = { houseType: null, confidence: 0, autoAssigned: false };
  const e1 = effectiveHouseType({ labeler: lab0, recalled: r1.houseType, websiteCategory: "flower" });
  ok(e1.source === "remembered" && !e1.needsTypePick && e1.value === "Flower" && e1.persistProvenance === "remembered", "memory first");
  ok(e1.placeholder === "Keep: Flower (your pick on the 2026-02-01 intake)", "remembered placeholder");
  const e2 = effectiveHouseType({ labeler: { houseType: "Gummies", confidence: 95, autoAssigned: true }, recalled: null, websiteCategory: "edible-solid" });
  ok(e2.source === "auto" && e2.value === "Gummies" && e2.persistProvenance === null, "labeler auto next, not persisted");
  ok(e2.placeholder === "Keep auto: Gummies (95% confident)", "auto placeholder unchanged wording");
  const e3 = effectiveHouseType({ labeler: lab0, recalled: null, websiteCategory: "flower" });
  ok(e3.source === "category" && e3.value === "Flower" && !e3.needsTypePick && e3.persistProvenance === "category", "Blue Dream on flower → Flower (category)");
  const e4 = effectiveHouseType({ labeler: { houseType: "Topical", confidence: 60, autoAssigned: false }, recalled: null, websiteCategory: "flower" });
  ok(e4.source === "none" && e4.needsTypePick, "name/shelf clash still asks a person");
  const e5 = effectiveHouseType({ labeler: lab0, recalled: null, websiteCategory: "concentrate" });
  ok(e5.needsTypePick && e5.placeholder === "Pick a product type\u2026", "multi-type shelf with no signal asks");
  const e6 = effectiveHouseType({ labeler: lab0, recalled: null, websiteCategory: "flower", ownerTypes: [{ label: "Smalls", websiteCategory: "flower" }] });
  ok(e6.needsTypePick, "owner registry type on flower disables implication");
  const e7 = effectiveHouseType({ labeler: { houseType: "Topical", confidence: 60, autoAssigned: false }, recalled: r1.houseType, websiteCategory: "flower" });
  ok(e7.source === "remembered", "memory resolves even a clash (a person already decided this product)");

  // Submitted provenance.
  ok(submittedPickProvenance("Flower", r1.houseType) === "remembered", "matching memory → remembered");
  ok(submittedPickProvenance("Popcorn Bud", r1.houseType) === "human", "changed answer → human");
  ok(submittedPickProvenance("Flower", null) === "human", "no memory → human");

  ok(rememberedStrainPlaceholder(r1.strainType!) === "Keep: Indica-Hybrid (your pick on the 2026-02-01 intake)", "strain placeholder");
  ok(Object.values(ONBOARDING_PICK_PROVENANCE).join(",") === "human,remembered,category", "closed provenance vocabulary");

  // effectiveStrainType survivorship.
  const rs = r1.strainType!;
  const s1 = effectiveStrainType({ recalled: rs, suggestion: { value: "sativa", confidence: 100, source: "strain library" } });
  ok(s1.value === "indica-hybrid" && s1.source === "remembered" && s1.persistOnDraft && s1.lotProvenance === "remembered", "memory beats the strain library");
  ok(s1.conflict !== null && s1.conflict.includes("Sativa") && s1.conflict.includes("Indica-Hybrid"), "conflict with library is surfaced");
  const s1b = effectiveStrainType({ recalled: rs, suggestion: { value: "indica-hybrid", confidence: 100, source: "strain library" } });
  ok(s1b.conflict === null, "agreement → no conflict note");
  const s2 = effectiveStrainType({ recalled: null, suggestion: { value: "hybrid", confidence: 95, source: "manifest" } });
  ok(s2.value === "hybrid" && !s2.persistOnDraft && s2.lotProvenance === "manifest", "manifest ≥90 → auto, lot provenance manifest");
  const s3 = effectiveStrainType({ recalled: null, suggestion: { value: "indica", confidence: 89, source: "product name" } });
  ok(s3.value === null && s3.source === "none" && s3.lotProvenance === null && s3.confidence === 89, "below the bar → blank");
  const s3b = effectiveStrainType({ recalled: null, suggestion: { value: "indica", confidence: 90, source: "product name" } });
  ok(s3b.value === "indica" && s3b.lotProvenance === "name", "exactly 90 → auto (name)");
  const s4 = effectiveStrainType({ recalled: null, suggestion: { value: "sativa", confidence: 100, source: "strain library" } });
  ok(s4.lotProvenance === "kb", "library → kb provenance");
  ok(effectiveStrainType({ recalled: null, suggestion: null }).value === null, "nothing known → null");

  // planLotStrainFill — fill-only.
  const f1 = planLotStrainFill({ lotId: "L1", effective: s2, lotStrainType: null, lotFactProvenance: { package_thc_mg: "name" } });
  ok(f1.write && f1.patch.strain_type === "hybrid" && (f1.patch.fact_provenance as Record<string, unknown>).strain_type === "manifest" && (f1.patch.fact_provenance as Record<string, unknown>).package_thc_mg === "name", "fills an empty lot, keeps other provenance");
  const f2 = planLotStrainFill({ lotId: "L1", effective: s2, lotStrainType: "Indica", lotFactProvenance: { strain_type: "manifest" } });
  ok(!f2.write && f2.code === "lot_has_value", "never overwrites a lot value");
  const f2b = planLotStrainFill({ lotId: "L1", effective: s2, lotStrainType: "unknown", lotFactProvenance: null });
  ok(f2b.write, "'unknown' on the lot counts as empty");
  ok(!planLotStrainFill({ lotId: "", effective: s2, lotStrainType: null, lotFactProvenance: null }).write, "no lot → no write");
  const f3 = planLotStrainFill({ lotId: "L1", effective: s3, lotStrainType: null, lotFactProvenance: null });
  ok(!f3.write && f3.code === "no_value", "no value → no write");

  return { passed, failed };
}
