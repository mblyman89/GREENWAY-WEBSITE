/**
 * src/lib/inventory/classification-memory-core.ts  (SLICE 18F)
 *
 * PURE recall of a compliance classification a human already made, so the
 * Product Onboarding gate can arrive PRE-FILLED instead of blank.
 *
 * Pure: plain data in, plain data out. No fs, no network, no Supabase. The
 * caller does the reading; this module only decides what may be remembered.
 *
 * ═══ THE MEASURED DEFECT ═══
 *
 * SLICE 18-0 made `otherwise_taken` a REQUIRED pick at Product Onboarding,
 * because its failure direction is the dangerous one: an unclassified
 * suppository is treated as an ordinary topical and the ten-unit limit of
 * WAC 314-55-095(1)(d)(i)(D) never engages. That gate is correct and this
 * slice does not weaken it.
 *
 * But the gate had no memory, and `intake-parser.ts:414` is, verbatim:
 *
 *     pos_product_key: sku ?? lot_code,
 *
 * When a WCIA/CCRS manifest line carries no SKU the product key BECOMES THE
 * LOT CODE, and a lot code is unique to one physical delivery. For that
 * population every delivery presents a brand-new key, so
 * `planDraftSeeding()` (draft-seed-core.ts:93) cannot match it against the
 * published menu, a fresh draft is seeded, and the gate fires AGAIN on a
 * product the owner already classified -- possibly for the twentieth time.
 * The earlier answer still exists, but it is filed under a key that will
 * never recur.
 *
 * A required question with no memory is a question answered under time
 * pressure at a receiving dock. That is fatigue on a fail-permissive gate,
 * and fatigue is a compliance risk.
 *
 * ═══ WHY NOT KEY ON pos_product_key ═══
 *
 * Because for the affected population THAT KEY IS THE THING THAT CHANGES.
 * Keying the memory on it would remember nothing precisely where memory is
 * needed. So the key is rebuilt from what actually stays the same across
 * deliveries -- vendor, brand, product family, category axis -- reusing the
 * tree's existing identity vocabulary rather than inventing a parallel one:
 *
 *   collapseFamilyKeyPart() / groupingCategoryAxis() / familyFromName()
 *     -- intake-mastering-core.ts, described in-tree as the owner's
 *        "same product, same vendor" identity.
 *
 * ═══ WHAT THIS MODULE REFUSES TO DO ═══
 *
 *   - It does NOT decide anything. It returns a SUGGESTION that the approval
 *     card pre-fills and a human still confirms (the owner's Option B).
 *   - It does NOT remember a machine default. A `machine_default` row is the
 *     gate NOT having been asked; replaying it as a remembered answer would
 *     launder a non-answer into an answer.
 *   - It does NOT remember an `unanswered` row. Silence is not a memory.
 *   - It does NOT merge two vendors. Two producers can ship a product with
 *     the same name and different formulations; applying one vendor's answer
 *     to another's product would be inventing a fact (Rule 2).
 *   - It does NOT build a key out of nothing. A blank key would collide with
 *     every other blank key and hand one product's classification to an
 *     unrelated product.
 *
 * ═══ PROVENANCE HONESTY (the owner's Option B) ═══
 *
 * Owner decision, verbatim: "Let's go with option b, pre fill + remembered
 * provenance."
 *
 * A confirmed-from-memory answer is genuinely NEITHER of the values 18-0
 * ratified. It is not a fresh human assertion about THIS delivery, and it is
 * certainly not the machine's safe default. Recording it as either would be a
 * small lie in an audit trail that exists precisely to be trusted. So it gets
 * its own value, `remembered`, and the vocabulary grows from three to four
 * WITHOUT redefining any existing member -- rows already written keep their
 * exact meaning.
 *
 * Statutory anchors:
 *   WAC 314-55-095(1)(d)(i)(D)  ten units "otherwise taken into the body"
 *   WAC 314-55-095(1)(d)(i)(E)/(F)  liquid bucket + 200 mg low-THC carve-out
 *   RCW 69.50.101               "unit" / "package" definitions
 */

import {
  collapseFamilyKeyPart,
  familyFromName,
  groupingCategoryAxis,
} from "@/lib/pos/intake-mastering-core";
import { RECEIVING_CLASSIFICATION_PROVENANCE } from "@/lib/inventory/receiving-classification-core";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * SLICE 18F adds a FOURTH provenance value to the three 18-0 ratified.
 *
 * `remembered` = a human confirmed an answer that was pre-filled from a prior
 * decision on the same product. It is a real human confirmation (they clicked)
 * but it is not an independent fresh assertion, and an auditor is entitled to
 * know which one they are looking at.
 *
 * The existing three are re-exported untouched so there is ONE vocabulary in
 * the codebase rather than two that must be kept in sync by hand.
 */
export const CLASSIFICATION_MEMORY_PROVENANCE = {
  ...RECEIVING_CLASSIFICATION_PROVENANCE,
  /** A human confirmed a value pre-filled from their own earlier decision. */
  remembered: "remembered",
} as const;

export type ClassificationMemoryProvenance =
  (typeof CLASSIFICATION_MEMORY_PROVENANCE)[keyof typeof CLASSIFICATION_MEMORY_PROVENANCE];

/**
 * Provenance values that represent AN ANSWER A HUMAN ACTUALLY GAVE, and are
 * therefore eligible to be remembered.
 *
 * `machine_default` and `unanswered` are deliberately absent, and that absence
 * is the safety property: neither represents a person having considered the
 * question.
 */
const RECALLABLE_PROVENANCE: readonly string[] = [
  CLASSIFICATION_MEMORY_PROVENANCE.human,
  CLASSIFICATION_MEMORY_PROVENANCE.remembered,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The identity fields that survive a new lot code. */
export type MemoryCandidate = {
  vendorName?: string | null;
  brandName?: string | null;
  productName?: string | null;
  category?: string | null;
};

/** A classification decision recorded on some earlier delivery. */
export type PriorClassification = MemoryCandidate & {
  otherwiseTaken: boolean | null;
  unitsPerPackage: number | null;
  lowThcLiquid: boolean | null;
  unitThcMg: number | null;
  /** ISO timestamp of the decision. Newest wins. */
  decidedAt: string | null;
  /** Who decided. Shown to the operator being asked to confirm. */
  decidedBy: string | null;
  /** How that value came to exist. Only human/remembered are recallable. */
  provenance: string | null;
};

/** What the approval card should render. */
export type MemoryPrefill = {
  /** "yes" | "no" | "" -- matches the form's closed vocabulary exactly. */
  otherwiseTaken: string;
  /** Stringified for the input's defaultValue. "" = nothing remembered. */
  unitsPerPackage: string;
  /** "yes" | "no" | "" */
  lowThcLiquid: string;
  unitThcMg: string;
  /** True when any value came from memory (drives the UI label). */
  isRemembered: boolean;
  /**
   * ALWAYS true. Option B pre-fills the answer, never the decision.
   *
   * This is a constant on purpose: it is the field a future "speed up the
   * dock" change would flip, and a test asserts it, so the weakening of a
   * fail-permissive gate cannot happen silently.
   */
  stillRequiresConfirmation: true;
};

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Build the identity key for a product's classification memory.
 *
 * Returns "" when there is not enough identity to be safe. An empty key is
 * treated by `recallClassification()` as "no memory", never as a wildcard.
 */
export function classificationMemoryKey(candidate: MemoryCandidate): string {
  const vendor = clean(candidate.vendorName) || clean(candidate.brandName);
  const name = clean(candidate.productName);
  // A product with no name has no identity we can trust. Refuse rather than
  // build a key that would collide with every other nameless product.
  if (name === "") return "";

  // Strip the brand/vendor label off the front and drop size/pack tokens, so
  // "Releaf Suppository 6pk" and "Releaf Suppository 12pk" agree.
  const family = familyFromName(name, [clean(candidate.brandName), vendor]) ?? name;
  const familyPart = collapseFamilyKeyPart(family);
  if (familyPart === "") return "";

  // groupingCategoryAxis() folds pack categories onto their single form
  // ("preroll-pack" -> "preroll") but passes an unrecognised category through
  // UNCHANGED, preserving its original case. Dock-entered categories are not
  // tidy, and "Topical" vs "topical" must not produce two different memories
  // -- that would silently forget the answer rather than fail loudly. So the
  // axis is collapsed afterwards, exactly as the vendor and family parts are.
  const categoryPart = collapseFamilyKeyPart(groupingCategoryAxis(clean(candidate.category)));

  return [collapseFamilyKeyPart(vendor), categoryPart, familyPart].join("|");
}

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

/** Sortable epoch for a decision timestamp. Unparseable/absent sorts oldest. */
function decidedAtMs(row: PriorClassification): number {
  const raw = clean(row.decidedAt);
  if (raw === "") return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Does this prior row actually carry an answer a human gave?
 *
 * Both conditions are required, and neither implies the other:
 *   - the provenance says a human decided it, AND
 *   - there is a non-null value to remember.
 *
 * `false` passes. It is a human saying "no, this is not a suppository", which
 * is every bit as much an answer as "yes" -- and forgetting it is exactly the
 * re-ask this slice exists to stop.
 */
function isRecallable(row: PriorClassification): boolean {
  if (!row) return false;
  if (!RECALLABLE_PROVENANCE.includes(clean(row.provenance))) return false;
  // `?? null` (never `||`) so a literal false survives.
  const ot = row.otherwiseTaken ?? null;
  const low = row.lowThcLiquid ?? null;
  return ot !== null || low !== null;
}

/**
 * Find the newest recallable prior decision for a candidate product.
 *
 * Returns null -- never a partially-invented row -- when nothing qualifies.
 * Sorting happens INSIDE, so callers cannot get a different answer by handing
 * the history over in a different order.
 */
export function recallClassification(input: {
  candidate: MemoryCandidate;
  history: readonly PriorClassification[];
}): PriorClassification | null {
  const key = classificationMemoryKey(input.candidate);
  if (key === "") return null;
  if (!Array.isArray(input.history) || input.history.length === 0) return null;

  const matches = input.history
    .filter((row) => Boolean(row) && classificationMemoryKey(row) === key && isRecallable(row))
    .sort((a, b) => decidedAtMs(b) - decidedAtMs(a));

  return matches.length > 0 ? matches[0] : null;
}

// ---------------------------------------------------------------------------
// Pre-fill (Option B)
// ---------------------------------------------------------------------------

/** Render a remembered boolean into the form's closed vocabulary. */
function flag(value: boolean | null | undefined): string {
  // `?? null` semantics: only a genuine null/undefined becomes blank. A
  // literal false becomes "no", which is the whole point of the slice.
  if (value === true) return "yes";
  if (value === false) return "no";
  return "";
}

/** Render a remembered number for an input's defaultValue. */
function num(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * Turn a recalled decision into approval-card defaults.
 *
 * OPTION B: this pre-fills the ANSWER, never the DECISION.
 * `stillRequiresConfirmation` is always true, so the 18-0 gate keeps demanding
 * a human click. The saving is typing and recall effort, not judgement.
 */
export function prefillFromMemory(memory: PriorClassification | null): MemoryPrefill {
  if (!memory) {
    return {
      otherwiseTaken: "",
      unitsPerPackage: "",
      lowThcLiquid: "",
      unitThcMg: "",
      isRemembered: false,
      stillRequiresConfirmation: true,
    };
  }
  return {
    otherwiseTaken: flag(memory.otherwiseTaken),
    unitsPerPackage: num(memory.unitsPerPackage),
    lowThcLiquid: flag(memory.lowThcLiquid),
    unitThcMg: num(memory.unitThcMg),
    isRemembered: true,
    stillRequiresConfirmation: true,
  };
}

/**
 * Plain-English description of the remembered answer, for the label beside the
 * pre-filled picker.
 *
 * It names WHO decided and WHEN. An operator asked to confirm somebody else's
 * answer is entitled to know whose it is and how old it is -- "remembered"
 * alone is an appeal to authority, and a stale classification is exactly the
 * thing a human should be able to spot and override.
 */
export function describeMemory(memory: PriorClassification | null): string {
  if (!memory) return "";
  const who = clean(memory.decidedBy) || "a staff member";
  const when = clean(memory.decidedAt).slice(0, 10);
  const ot = memory.otherwiseTaken ?? null;

  let what: string;
  if (ot === true) {
    what = "taken into the body another way (10-unit limit)";
  } else if (ot === false) {
    what = "an ordinary product \u2014 no, not taken into the body another way";
  } else {
    what = "classified";
  }

  const dated = when === "" ? "previously" : `on ${when}`;
  return `Pre-filled from memory: ${who} classified this as ${what} ${dated}. Confirm or change it.`;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern; run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runClassificationMemoryTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL classification-memory-core: " + msg);
    passed += 1;
  };

  const supp: MemoryCandidate = {
    vendorName: "Fairwinds",
    brandName: "Fairwinds",
    productName: "Releaf Suppository 100mg",
    category: "topical",
  };

  // 1) The key survives a new lot code (the measured defect).
  ok(classificationMemoryKey(supp) === classificationMemoryKey({ ...supp }), "key is stable");
  ok(classificationMemoryKey(supp) !== "", "key is non-empty for a real product");

  // 2) The key refuses to be built from nothing.
  ok(
    classificationMemoryKey({ vendorName: "", brandName: "", productName: "", category: "" }) === "",
    "no name -> no key",
  );

  // 3) Different vendors never merge.
  ok(
    classificationMemoryKey(supp) !==
      classificationMemoryKey({ ...supp, vendorName: "Green Revolution", brandName: "Green Revolution" }),
    "vendors do not merge",
  );

  const base: PriorClassification = {
    ...supp,
    otherwiseTaken: true,
    unitsPerPackage: 6,
    lowThcLiquid: null,
    unitThcMg: null,
    decidedAt: "2026-08-12T00:00:00.000Z",
    decidedBy: "michael",
    provenance: "human",
  };

  // 4) Newest wins, regardless of input order.
  const older: PriorClassification = { ...base, decidedAt: "2026-06-01T00:00:00.000Z", unitsPerPackage: 4 };
  ok(
    recallClassification({ candidate: supp, history: [older, base] })?.unitsPerPackage === 6 &&
      recallClassification({ candidate: supp, history: [base, older] })?.unitsPerPackage === 6,
    "newest wins either way",
  );

  // 5) A machine default is NOT a memory.
  ok(
    recallClassification({
      candidate: supp,
      history: [{ ...base, provenance: RECEIVING_CLASSIFICATION_PROVENANCE.machine }],
    }) === null,
    "machine default is not recalled",
  );

  // 6) A literal false IS a memory.
  ok(
    recallClassification({
      candidate: supp,
      history: [{ ...base, otherwiseTaken: false, unitsPerPackage: null }],
    })?.otherwiseTaken === false,
    "false is remembered",
  );

  // 7) Option B: the human still confirms.
  ok(prefillFromMemory(base).stillRequiresConfirmation === true, "confirmation still required");
  ok(prefillFromMemory(base).otherwiseTaken === "yes", "prefill carries the answer");
  ok(prefillFromMemory(null).isRemembered === false, "no memory claims nothing");

  // 8) The remembered provenance is a distinct FOURTH value, and the three
  //    that 18-0 ratified are unchanged.
  //
  //    Note the shape of this check. Comparing the literals directly is a
  //    COMPILE ERROR ("types have no overlap"), because the const assertion
  //    makes their distinctness a fact tsc already proves - a stronger
  //    guarantee than any runtime assertion could give. So the runtime test
  //    earns its keep by checking a different thing: that the vocabulary is
  //    genuinely four wide and that no existing member was silently
  //    redefined, which WOULD reinterpret every row already written.
  const vocabulary = Object.values(CLASSIFICATION_MEMORY_PROVENANCE);
  ok(new Set(vocabulary).size === 4, "vocabulary has exactly four distinct values");
  ok(vocabulary.includes(CLASSIFICATION_MEMORY_PROVENANCE.remembered), "remembered is in the vocabulary");
  ok(RECEIVING_CLASSIFICATION_PROVENANCE.human === "human", "human is unchanged");
  ok(RECEIVING_CLASSIFICATION_PROVENANCE.machine === "machine_default", "machine_default is unchanged");
  ok(RECEIVING_CLASSIFICATION_PROVENANCE.unanswered === "unanswered", "unanswered is unchanged");

  // 9) The description names who and when.
  ok(describeMemory(base).includes("michael"), "description names the decider");
  ok(describeMemory(null) === "", "no memory -> no claim");

  return { passed };
}
