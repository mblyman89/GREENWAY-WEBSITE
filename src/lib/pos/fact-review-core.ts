/**
 * src/lib/pos/fact-review-core.ts  (PROGRAM 3 / SLICE 57)
 *
 * PURE dry-run report builder for the golden-record import
 * (docs/data-governance.md Rules 3.1-3.3): it partitions every staged menu
 * item into exactly one of three buckets --
 *
 *   auto-accepted : visible items with NO open fact flags. Confidence is
 *                   "verified" when the extraction engine cross-checked at
 *                   least one fact by independent arithmetic (fact_provenance
 *                   carries entries), otherwise "single-source" (the values
 *                   were read straight from the Cultivera columns with no
 *                   second witness -- honest, but uncorroborated).
 *   needs-review  : visible items carrying at least one review-feeding
 *                   diagnostic (the exception queue -- Rule 3.1: never
 *                   auto-commit uncertain data). Each row lists every
 *                   plain-English reason the cross-examiner produced.
 *   rejected      : hidden items -- rows that will NOT reach the public menu,
 *                   each with its documented reject reason (Rule 3.3:
 *                   documented rejects, never silent drops).
 *
 * The partition is exhaustive and disjoint: every input item lands in exactly
 * one bucket, so totals always reconcile (items = auto + review + rejected).
 * Review-feeding diagnostics that cannot be matched to any staged item are
 * NEVER dropped -- they surface as standalone needs-review rows with a
 * synthetic id (never guess, never lose a flag).
 *
 * Pure: plain data in, plain data out. No fs, no network, no Supabase -- the
 * server page/route adapt DB rows via the type-only adapters below, and the
 * self-tests run in the compliance pure-runner on every PR.
 */

import type { MenuItemRow, PosImportDiagnostic } from "@/lib/pos/db-types";
// SLICE 16: the 4 mg per-container statutory bound. sales-limits-core is PURE
// (no server-only, no DB), so importing it keeps this core pure too. Importing
// rather than retyping means this screen's guard and the register's
// qualifiesAsLowThcLiquid() can never disagree about what "low-THC" means.
import { LOW_THC_UNIT_MAX_MG } from "@/lib/compliance/sales-limits-core";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Diagnostic codes that put a row into the needs-review bucket. Scope is the
 * golden-record FACT program (extraction + potency + package measures):
 *   fact_extraction_review  -- the SLICE 55 cross-examiner could not verify
 *                              every name-fact by independent arithmetic.
 *   package_size_mg_garbage -- Package Size column carries an absurd mg
 *                              figure (potency unit, not a physical measure).
 *   cannabinoid_value_capped -- a source potency value exceeded the sanity
 *                              cap and was substituted/clamped.
 *   cannabinoid_missing     -- no source THC potency at all; the THC box
 *                              stays hidden until the product is enriched.
 */
export const REVIEW_DIAGNOSTIC_CODES = new Set([
  "fact_extraction_review",
  "package_size_mg_garbage",
  "cannabinoid_value_capped",
  "cannabinoid_missing",
]);

/**
 * Informational codes attached as notes WITHOUT forcing review: the override
 * is itself the product of a VERIFIED cross-check (package-total-first
 * policy), so the row stays auto-accepted but the correction is disclosed.
 */
export const NOTE_DIAGNOSTIC_CODES = new Set(["thc_package_total_override"]);

export type FactReviewBucketName = "auto-accepted" | "needs-review" | "rejected";

/**
 * Row-level confidence (distinct from the per-fact FactConfidence of
 * fact-extraction-core, but built on the same idea):
 *   verified      -- at least one fact carries cross-checked provenance.
 *   single-source -- column values only; nothing independently corroborated.
 *   needs-review  -- at least one open flag; a human must decide.
 *   rejected      -- hidden from the public menu with a documented reason.
 */
export type FactReviewConfidence = "verified" | "single-source" | "needs-review" | "rejected";

export type FactResolutionAction = "approve" | "fix" | "reject";

export type FactReviewFacts = {
  thc: string | null;
  cbd: string | null;
  servingsPerPack: number | null;
  mgPerServing: number | null;
  packageThcMg: number | null;
  packageCbdMg: number | null;
  ratioLabel: string | null;
  netWeightGrams: number | null;
  netVolumeMl: number | null;
  /**
   * SLICE 16 — does this liquid qualify for the 200 mg low-THC beverage
   * allowance (WAC 314-55-095(1)(d)(i)(E)-(F))?
   *
   * NULL is NOT "no" in the sense of "we checked and it doesn't" — it means
   * NOBODY HAS CLASSIFIED IT YET, and the register treats it as an ordinary
   * 72 oz liquid. That is the safe direction and it is Michael's explicit
   * instruction: "A product with no flag should be treated as a normal liquid."
   */
  lowThcLiquid: boolean | null;
  /**
   * SLICE 17 — "otherwise taken into the body" (WAC 314-55-010(40)): a route
   * of administration that is neither inhaled, swallowed, nor applied to the
   * skin. In practice a suppository. true routes the line to the ten-unit
   * limit of WAC 314-55-095(1)(d)(i)(D).
   *
   * null means NOT YET REVIEWED, and is deliberately distinct from false.
   * Because an unflagged suppository buckets as a 2016 g liquid (effectively
   * unlimited), null is the PERMISSIVE state — the opposite of lowThcLiquid.
   * That is precisely why this is an explicit review field.
   */
  otherwiseTaken: boolean | null;
  /**
   * SLICE 17 — individual consumable items in one package (RCW 69.50.101):
   * "an individual consumable item within a package of one or more consumable
   * items". A box of six suppositories is 6, and rings as six units. NOT the
   * same as servings_per_pack, which divides ONE container by dose.
   */
  unitsPerPackage: number | null;
  /**
   * SLICE 16 — milligrams of active delta-9 THC in ONE SEALED CONTAINER.
   *
   * Per the container, NOT per the serving printed on the label. A 16 mg
   * bottle sold as "4 servings x 4 mg" has unitThcMg = 16 and does not
   * qualify. One can is one unit; a 4-pack is four units.
   */
  unitThcMg: number | null;
};

export type FactReviewRow = {
  /** menu source id ("pos-..."), or a synthetic "flag:<code>:<name>" for standalone flags. */
  sourceItemId: string;
  name: string;
  brand: string;
  category: string;
  inventoryType: string;
  bucket: FactReviewBucketName;
  facts: FactReviewFacts;
  /** "package_thc_mg: name+column; servings_per_pack: name+column" -- per-fact provenance. */
  sources: string;
  confidence: FactReviewConfidence;
  /** Plain-English explanations (deduped) -- conflict reasons, corrections, reject reasons. */
  notes: string[];
  /** Human decision recorded for this row (needs-review bucket only), if any. */
  resolution: FactResolutionAction | null;
  resolutionNote: string | null;
};

export type FactReviewBuckets = {
  autoAccepted: FactReviewRow[];
  needsReview: FactReviewRow[];
  rejected: FactReviewRow[];
  totals: {
    /** Staged items fed in (excludes standalone flags). */
    items: number;
    autoAccepted: number;
    needsReview: number;
    rejected: number;
    /** Review flags that matched no staged item and became standalone rows. */
    standaloneFlags: number;
    /** needs-review rows with no recorded human decision yet. */
    pendingReview: number;
  };
};

export type FactReviewItemInput = {
  sourceItemId: string;
  name: string;
  productName: string | null;
  brand: string;
  category: string;
  inventoryType: string | null;
  hidden: boolean;
  hiddenReason: string | null;
  thc: string | null;
  cbd: string | null;
  servingsPerPack: number | null;
  mgPerServing: number | null;
  packageThcMg: number | null;
  packageCbdMg: number | null;
  ratioLabel: string | null;
  netWeightGrams: number | null;
  netVolumeMl: number | null;
  /** SLICE 16 — see FactReviewFacts for the container-not-serving rule. */
  lowThcLiquid: boolean | null;
  unitThcMg: number | null;
  otherwiseTaken: boolean | null;
  unitsPerPackage: number | null;
  factProvenance: Record<string, string>;
};

export type FactReviewDiagnosticInput = {
  severity: string;
  code: string;
  message: string;
  context: Record<string, unknown> | null;
};

export type FactResolutionInput = {
  sourceItemId: string;
  action: FactResolutionAction;
  note: string | null;
  /**
   * Inline-fix values (action="fix"). Only the fields the reviewer actually
   * typed are present; each one overrides the row's fact and its provenance
   * becomes "reviewer" -- a human is a legitimate, named source (Rule 2.2).
   */
  correctedFacts?: Partial<FactReviewFacts> | null;
};

// ---------------------------------------------------------------------------
// Type-only adapters (DB row shapes -> pure inputs)
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function menuItemRowToFactReviewItem(row: MenuItemRow): FactReviewItemInput {
  const provenance =
    row.fact_provenance && typeof row.fact_provenance === "object" && !Array.isArray(row.fact_provenance)
      ? (row.fact_provenance as Record<string, string>)
      : {};
  return {
    sourceItemId: row.source_item_id,
    name: row.name,
    productName: row.product_name,
    brand: row.brand_name,
    category: row.category,
    inventoryType: row.pos_inventory_type,
    hidden: row.hidden,
    hiddenReason: row.hidden_reason,
    thc: row.thc,
    cbd: row.cbd,
    // numeric columns arrive as strings from PostgREST for `numeric` -- coerce.
    servingsPerPack: num(row.servings_per_pack),
    mgPerServing: num(row.mg_per_serving),
    packageThcMg: num(row.package_thc_mg),
    packageCbdMg: num(row.package_cbd_mg),
    ratioLabel: row.ratio_label,
    netWeightGrams: num(row.net_weight_grams),
    netVolumeMl: num(row.net_volume_ml),
    // SLICE 16. `low_thc_liquid` is a real boolean column so it needs no
    // coercion, but it IS nullable and null must survive as null (unclassified),
    // never collapse to false — the two are different states to the reviewer
    // even though the register treats them identically.
    lowThcLiquid: row.low_thc_liquid,
    unitThcMg: num(row.unit_thc_mg),
    otherwiseTaken: row.otherwise_taken,
    unitsPerPackage: num(row.units_per_package),
    factProvenance: provenance,
  };
}

/**
 * SLICE 16 — parse a reviewer's low-THC beverage decision from raw form input.
 *
 * PURE so it can be tested without a server, a session, or a redirect. The
 * server action is a thin translator: `error` becomes a redirect, `facts`
 * becomes part of the corrected-facts patch.
 *
 * The rules, and why each exists:
 *
 *  - `lowThc` is TRI-STATE ("" | "yes" | "no"). Blank means LEAVE ALONE, which
 *    is different from "no". A checkbox cannot express that, and cannot take a
 *    flag back off either.
 *
 *  - Flagging "yes" REQUIRES a per-container figure. Without one the register
 *    would qualify the line (flag present) but count 0 mg toward the cap,
 *    letting an unbounded number of cans through.
 *
 *  - The figure must be > 0 and <= LOW_THC_UNIT_MAX_MG. This is the statutory
 *    test from WAC 314-55-095(1)(d)(i)(E)-(F), applied to the SEALED CONTAINER
 *    and not to a serving printed on the label.
 *
 *  - The bound is IMPORTED, never retyped, so this guard, the DB CHECK
 *    constraint in migration 0216, and the register's `qualifiesAsLowThcLiquid`
 *    can never disagree.
 */
export type LowThcClassificationResult =
  | { ok: true; facts: Partial<FactReviewFacts> }
  | { ok: false; error: string };

export function parseLowThcClassification(
  lowThcRaw: string,
  unitThcRaw: string,
): LowThcClassificationResult {
  const lowThc = lowThcRaw.trim();
  const unitRaw = unitThcRaw.trim();

  if (lowThc !== "" && lowThc !== "yes" && lowThc !== "no") {
    return { ok: false, error: "Low-THC beverage must be yes, no, or left blank." };
  }

  const facts: Partial<FactReviewFacts> = {};

  if (unitRaw !== "") {
    const mg = Number(unitRaw);
    // Refuse rather than coerce. "4mg", "four" and "" are all reviewer errors
    // worth surfacing, not values worth guessing at.
    if (!Number.isFinite(mg) || mg <= 0) {
      return { ok: false, error: `"${unitRaw}" is not a valid THC-per-container figure.` };
    }
    facts.unitThcMg = mg;
  }

  if (lowThc === "yes") {
    const mg = facts.unitThcMg;
    if (typeof mg !== "number") {
      return {
        ok: false,
        error:
          "To flag a low-THC beverage you must also enter the THC milligrams in ONE SEALED CONTAINER.",
      };
    }
    if (mg > LOW_THC_UNIT_MAX_MG) {
      return {
        ok: false,
        error:
          `${mg} mg per container is above the ${LOW_THC_UNIT_MAX_MG} mg limit, so this product does NOT ` +
          `qualify for the low-THC beverage allowance. Enter the milligrams in the whole sealed ` +
          `container, not one serving — a 16 mg bottle labelled "4 servings x 4 mg" is 16 mg and ` +
          `stays under the regular 72 oz liquid limit.`,
      };
    }
    facts.lowThcLiquid = true;
  } else if (lowThc === "no") {
    facts.lowThcLiquid = false;
  }

  return { ok: true, facts };
}

/**
 * SLICE 17 — parse the "otherwise taken into the body" classification from the
 * fact-review form. Pure, so the rules are unit-testable away from Next.js.
 *
 * WHY EACH RULE EXISTS
 * --------------------
 *  - The value must be exactly "yes", "no", or blank. Blank means the reviewer
 *    did not touch the row, and must leave the stored value ALONE — which is
 *    why blank returns no facts at all rather than null or false.
 *
 *  - Flagging "yes" REQUIRES a units-per-package count. Without one the engine
 *    would qualify the line but multiply by a default of 1, counting a box of
 *    six suppositories as ONE unit and under-counting the statutory limit by a
 *    factor of six.
 *
 *  - The count must be a WHOLE number greater than zero. RCW 69.50.101 defines
 *    a unit as "an individual consumable item"; half an item is not one.
 *
 *  - A count ABOVE ten is accepted, not refused. A 12-count box is a lawful
 *    PRODUCT that simply cannot be sold in a single transaction. Refusing to
 *    classify it would leave it unflagged, and because an unflagged suppository
 *    falls into the 2016 g liquid bucket, "unflagged" is the PERMISSIVE state.
 *    Refusing here would therefore make us less compliant, not more.
 *
 *  - A malformed count is refused even when the flag is blank, so a reviewer
 *    never sees a typo silently discarded.
 *
 * NOTE the asymmetry with parseLowThcClassification above: that parser enforces
 * a statutory CEILING on the per-container figure, because (E)/(F) turn on a
 * 4 mg test. WAC 314-55-095(1)(d)(i)(D) states no potency condition whatsoever
 * — it counts items. Inventing a potency rule here would be adding law that
 * does not exist, so this parser deliberately has no equivalent bound.
 */
export type OtherwiseTakenClassificationResult =
  | { ok: true; facts: Partial<FactReviewFacts> }
  | { ok: false; error: string };

export function parseOtherwiseTakenClassification(
  otherwiseTakenRaw: string,
  unitsPerPackageRaw: string,
): OtherwiseTakenClassificationResult {
  const flag = otherwiseTakenRaw.trim();
  const countRaw = unitsPerPackageRaw.trim();

  if (flag !== "" && flag !== "yes" && flag !== "no") {
    return {
      ok: false,
      error: "Otherwise taken into the body must be yes, no, or left blank.",
    };
  }

  const facts: Partial<FactReviewFacts> = {};

  if (countRaw !== "") {
    const n = Number(countRaw);
    // Refuse rather than coerce, exactly as the low-THC parser does.
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, error: `"${countRaw}" is not a valid units-per-package count.` };
    }
    if (!Number.isInteger(n)) {
      return {
        ok: false,
        error:
          `Units per package must be a whole number — "${countRaw}" is not. A unit is ` +
          `"an individual consumable item" (RCW 69.50.101); half an item is not a unit.`,
      };
    }
    facts.unitsPerPackage = n;
  }

  if (flag === "yes") {
    if (typeof facts.unitsPerPackage !== "number") {
      return {
        ok: false,
        error:
          "To flag a product as otherwise taken into the body you must also enter how many " +
          "individual units are in one package (a box of six suppositories is 6).",
      };
    }
    facts.otherwiseTaken = true;
  } else if (flag === "no") {
    facts.otherwiseTaken = false;
  }

  return { ok: true, facts };
}

export function posDiagnosticToFactReviewDiagnostic(d: PosImportDiagnostic): FactReviewDiagnosticInput {
  const context =
    d.context_json && typeof d.context_json === "object" && !Array.isArray(d.context_json)
      ? (d.context_json as Record<string, unknown>)
      : null;
  return { severity: d.severity, code: d.code, message: d.message, context };
}

// ---------------------------------------------------------------------------
// Plain-English note builders
// ---------------------------------------------------------------------------

/** Documented reject reasons in owner language (Rule 3.3). */
const HIDDEN_REASON_TEXT: Record<string, string> = {
  no_product_master:
    "In the inventory file but missing from the products file -- kept hidden until the product master row exists.",
  no_inventory: "In the products file but has no inventory rows -- nothing to sell yet.",
  reviewer_rejected: "Rejected by a reviewer in the fact-review queue -- will not reach the public menu.",
};

export function hiddenReasonText(reason: string | null): string {
  if (!reason) return "Hidden from the public menu (no reason recorded).";
  return HIDDEN_REASON_TEXT[reason] ?? `Hidden from the public menu (reason: ${reason}).`;
}

function str(context: Record<string, unknown> | null, key: string): string | null {
  const v = context?.[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Turn one diagnostic into its plain-English note lines. */
export function diagnosticNotes(d: FactReviewDiagnosticInput): string[] {
  if (d.code === "fact_extraction_review") {
    const reasons = d.context?.reasons;
    if (Array.isArray(reasons)) {
      const lines = reasons.filter((r): r is string => typeof r === "string" && r.trim() !== "");
      if (lines.length > 0) return lines;
    }
    return [d.message];
  }
  if (d.code === "package_size_mg_garbage") {
    const raw = str(d.context, "rawPackage");
    return [
      raw
        ? `Package Size column says "${raw}" -- a milligram figure beyond any sane potency; not a real physical measure.`
        : d.message,
    ];
  }
  if (d.code === "cannabinoid_missing") {
    return ["No THC potency in the source columns -- the THC box stays hidden until this product is enriched."];
  }
  if (d.code === "thc_package_total_override") {
    const to = str(d.context, "verifiedPackageTotal");
    const from = str(d.context, "totalColumnDisplay");
    return [
      to && from
        ? `Displayed THC corrected to the verified package total ${to} (the inconsistent Total column said ${from}).`
        : d.message,
    ];
  }
  return [d.message];
}

// ---------------------------------------------------------------------------
// Bucket builder
// ---------------------------------------------------------------------------

function normKey(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function sourcesLabel(provenance: Record<string, string>): string {
  const keys = Object.keys(provenance).sort();
  return keys.map((k) => `${k}: ${provenance[k]}`).join("; ");
}

function factsOf(item: FactReviewItemInput): FactReviewFacts {
  return {
    thc: item.thc,
    cbd: item.cbd,
    servingsPerPack: item.servingsPerPack,
    mgPerServing: item.mgPerServing,
    packageThcMg: item.packageThcMg,
    packageCbdMg: item.packageCbdMg,
    ratioLabel: item.ratioLabel,
    netWeightGrams: item.netWeightGrams,
    netVolumeMl: item.netVolumeMl,
    lowThcLiquid: item.lowThcLiquid,
    unitThcMg: item.unitThcMg,
    otherwiseTaken: item.otherwiseTaken,
    unitsPerPackage: item.unitsPerPackage,
  };
}

const EMPTY_FACTS: FactReviewFacts = {
  thc: null,
  cbd: null,
  servingsPerPack: null,
  mgPerServing: null,
  packageThcMg: null,
  packageCbdMg: null,
  ratioLabel: null,
  netWeightGrams: null,
  netVolumeMl: null,
  lowThcLiquid: null,
  unitThcMg: null,
  otherwiseTaken: null,
  unitsPerPackage: null,
};

export function buildFactReviewBuckets(
  items: FactReviewItemInput[],
  diagnostics: FactReviewDiagnosticInput[],
  resolutions: FactResolutionInput[] = [],
): FactReviewBuckets {
  // Index items by display name AND product name (lowercased). The transform
  // emits fact_extraction_review with the card's displayName (always matches
  // item.name) and per-row codes with the raw product name (matches when the
  // raw name is the card's chosen productName; otherwise the flag surfaces as
  // a standalone row rather than being guessed onto a card).
  const byKey = new Map<string, FactReviewItemInput[]>();
  const add = (key: string, item: FactReviewItemInput) => {
    if (!key) return;
    const list = byKey.get(key) ?? [];
    if (!list.includes(item)) list.push(item);
    byKey.set(key, list);
  };
  for (const item of items) {
    add(normKey(item.name), item);
    add(normKey(item.productName), item);
  }

  const notesByItem = new Map<FactReviewItemInput, string[]>();
  const flaggedItems = new Set<FactReviewItemInput>();
  const standalone: FactReviewRow[] = [];
  const pushNotes = (item: FactReviewItemInput, lines: string[]) => {
    const list = notesByItem.get(item) ?? [];
    for (const line of lines) if (!list.includes(line)) list.push(line);
    notesByItem.set(item, list);
  };

  for (const d of diagnostics) {
    const isReview = REVIEW_DIAGNOSTIC_CODES.has(d.code);
    const isNote = NOTE_DIAGNOSTIC_CODES.has(d.code);
    if (!isReview && !isNote) continue;
    const matches =
      byKey.get(normKey(str(d.context, "displayName"))) ??
      byKey.get(normKey(str(d.context, "productName"))) ??
      null;
    const lines = diagnosticNotes(d);
    if (matches && matches.length > 0) {
      for (const item of matches) {
        pushNotes(item, lines);
        if (isReview) flaggedItems.add(item);
      }
    } else if (isReview) {
      // Never lose a flag: unmatched review diagnostics become standalone
      // needs-review rows with a synthetic, stable id.
      const name = str(d.context, "productName") ?? str(d.context, "displayName") ?? "(unknown product)";
      const sourceItemId = `flag:${d.code}:${normKey(name)}`;
      const existing = standalone.find((row) => row.sourceItemId === sourceItemId);
      if (existing) {
        for (const line of lines) if (!existing.notes.includes(line)) existing.notes.push(line);
      } else {
        standalone.push({
          sourceItemId,
          name,
          brand: "",
          category: "",
          inventoryType: str(d.context, "inventoryType") ?? "",
          bucket: "needs-review",
          facts: { ...EMPTY_FACTS },
          sources: "",
          confidence: "needs-review",
          notes: [...lines],
          resolution: null,
          resolutionNote: null,
        });
      }
    }
    // Unmatched pure NOTE codes concern an already-verified correction on a
    // card we could not locate -- nothing actionable; intentionally dropped.
  }

  const resolutionById = new Map<string, FactResolutionInput>();
  for (const r of resolutions) resolutionById.set(r.sourceItemId, r);

  const autoAccepted: FactReviewRow[] = [];
  const needsReview: FactReviewRow[] = [];
  const rejected: FactReviewRow[] = [];

  for (const item of items) {
    const notes = notesByItem.get(item) ?? [];
    // Bucket precedence: rejected (hidden) > needs-review > auto-accepted.
    // A hidden item with open flags stays rejected -- it is not going live,
    // so the reject reason leads and the flags ride along as notes.
    let bucket: FactReviewBucketName;
    let confidence: FactReviewConfidence;
    if (item.hidden) {
      bucket = "rejected";
      confidence = "rejected";
      notes.unshift(hiddenReasonText(item.hiddenReason));
    } else if (flaggedItems.has(item)) {
      bucket = "needs-review";
      confidence = "needs-review";
    } else {
      bucket = "auto-accepted";
      confidence = Object.keys(item.factProvenance).length > 0 ? "verified" : "single-source";
    }
    const resolution = bucket === "needs-review" ? resolutionById.get(item.sourceItemId) ?? null : null;
    // Inline fixes overlay the displayed facts; corrected fields get
    // provenance "reviewer" (a named human source -- Rule 2.2).
    let facts = factsOf(item);
    let provenance = item.factProvenance;
    if (resolution?.action === "fix" && resolution.correctedFacts) {
      const corrected: Record<string, string> = { ...provenance };
      for (const [key, value] of Object.entries(resolution.correctedFacts)) {
        if (value === undefined) continue;
        facts = { ...facts, [key]: value };
        corrected[camelToSnake(key)] = "reviewer";
      }
      provenance = corrected;
    }
    const row: FactReviewRow = {
      sourceItemId: item.sourceItemId,
      name: item.name,
      brand: item.brand,
      category: item.category,
      inventoryType: item.inventoryType ?? "",
      bucket,
      facts,
      sources: sourcesLabel(provenance),
      confidence,
      notes,
      resolution: resolution?.action ?? null,
      resolutionNote: resolution?.note ?? null,
    };
    if (bucket === "rejected") rejected.push(row);
    else if (bucket === "needs-review") needsReview.push(row);
    else autoAccepted.push(row);
  }

  // Standalone flags join the review queue (resolvable via their synthetic id).
  for (const row of standalone) {
    const resolution = resolutionById.get(row.sourceItemId) ?? null;
    row.resolution = resolution?.action ?? null;
    row.resolutionNote = resolution?.note ?? null;
    needsReview.push(row);
  }

  const byName = (a: FactReviewRow, b: FactReviewRow) => a.name.localeCompare(b.name);
  autoAccepted.sort(byName);
  needsReview.sort(byName);
  rejected.sort(byName);

  return {
    autoAccepted,
    needsReview,
    rejected,
    totals: {
      items: items.length,
      autoAccepted: autoAccepted.length,
      needsReview: needsReview.length,
      rejected: rejected.length,
      standaloneFlags: standalone.length,
      pendingReview: needsReview.filter((r) => r.resolution === null).length,
    },
  };
}

// ---------------------------------------------------------------------------
// CSV export ("clean and simple" spreadsheet -- owner requirement)
// ---------------------------------------------------------------------------

export const FACT_REVIEW_CSV_HEADER = [
  "Bucket",
  "Status",
  "Product",
  "Brand",
  "Category",
  "Inventory Type",
  "THC",
  "CBD",
  "Servings Per Pack",
  "Mg Per Serving",
  "Package THC (mg)",
  "Package CBD (mg)",
  "Ratio",
  "Net Weight (g)",
  "Net Volume (ml)",
  "Low-THC Beverage",
  "THC mg per container",
  "Confidence",
  "Sources",
  "Notes",
];

export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function cell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  return escapeCsvField(String(value));
}

export function buildFactReviewCsv(buckets: FactReviewBuckets): string {
  const rows = [...buckets.needsReview, ...buckets.autoAccepted, ...buckets.rejected];
  const lines = [FACT_REVIEW_CSV_HEADER.map(escapeCsvField).join(",")];
  for (const row of rows) {
    const status = row.bucket === "needs-review" ? row.resolution ?? "pending" : "";
    lines.push(
      [
        cell(row.bucket),
        cell(status),
        cell(row.name),
        cell(row.brand),
        cell(row.category),
        cell(row.inventoryType),
        cell(row.facts.thc),
        cell(row.facts.cbd),
        cell(row.facts.servingsPerPack),
        cell(row.facts.mgPerServing),
        cell(row.facts.packageThcMg),
        cell(row.facts.packageCbdMg),
        cell(row.facts.ratioLabel),
        cell(row.facts.netWeightGrams),
        cell(row.facts.netVolumeMl),
        // Spell the tri-state out. A blank here means UNCLASSIFIED, which is a
        // different (and actionable) fact from a reviewed "no".
        cell(row.facts.lowThcLiquid === null ? "unclassified" : row.facts.lowThcLiquid ? "yes" : "no"),
        cell(row.facts.unitThcMg),
        cell(
          row.facts.otherwiseTaken === null
            ? "unclassified"
            : row.facts.otherwiseTaken
              ? "yes"
              : "no",
        ),
        cell(row.facts.unitsPerPackage),
        cell(row.confidence),
        cell(row.sources),
        cell(row.notes.join(" | ")),
      ].join(","),
    );
  }
  // CRLF line endings: RFC 4180 + friendliest for Excel double-click opens.
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runFactReviewCoreTests(): void {
  let failures = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      failures += 1;
      console.error(`  FACT-REVIEW FAIL: ${msg}`);
    }
  };

  const item = (over: Partial<FactReviewItemInput>): FactReviewItemInput => ({
    sourceItemId: "pos-x",
    name: "X",
    productName: null,
    brand: "B",
    category: "edible-solid",
    inventoryType: "Solid Edible",
    hidden: false,
    hiddenReason: null,
    thc: null,
    cbd: null,
    servingsPerPack: null,
    mgPerServing: null,
    packageThcMg: null,
    packageCbdMg: null,
    ratioLabel: null,
    netWeightGrams: null,
    netVolumeMl: null,
    lowThcLiquid: null,
    unitThcMg: null,
    otherwiseTaken: null,
    unitsPerPackage: null,
    factProvenance: {},
    ...over,
  });

  // -- Fixture mirrors the real corpus shapes ------------------------------
  const verified = item({
    sourceItemId: "pos-verified",
    name: "Const HRG Blueberry Gummy",
    productName: "Const HRG Blueberry 10 x 10mg Gummies",
    thc: "100mg",
    cbd: "100mg",
    servingsPerPack: 10,
    mgPerServing: 10,
    packageThcMg: 100,
    packageCbdMg: 100,
    ratioLabel: "1:1:1",
    factProvenance: { package_thc_mg: "name+column", servings_per_pack: "name+column" },
  });
  const flagged = item({
    sourceItemId: "pos-flagged",
    name: "Moxey Mints Energizing",
    productName: "Moxey's Mints - Energizing 100mg",
    thc: "100mg",
  });
  const flower = item({
    sourceItemId: "pos-flower",
    name: "Gorilla Glue #4",
    category: "flower",
    inventoryType: "Usable Marijuana",
    thc: "24.5%",
  });
  const hiddenFlagged = item({
    sourceItemId: "pos-hidden",
    name: "Mystery Topical",
    inventoryType: "Topical Ointment",
    hidden: true,
    hiddenReason: "no_product_master",
  });
  const enrichMe = item({
    sourceItemId: "pos-enrich",
    name: "Kellys Karamels",
    productName: "Kelly's Karamels Sea Salt",
  });

  const diags: FactReviewDiagnosticInput[] = [
    {
      severity: "info",
      code: "fact_extraction_review",
      message: "Extraction needs review.",
      context: {
        displayName: "Moxey Mints Energizing",
        productName: "Moxey's Mints - Energizing 100mg",
        inventoryType: "Solid Edible",
        reasons: ["Thc column value 4.7 could not be explained by any reading of the name."],
      },
    },
    // Hidden item also flagged: must STAY rejected (bucket precedence).
    {
      severity: "info",
      code: "fact_extraction_review",
      message: "Extraction needs review.",
      context: { displayName: "Mystery Topical", reasons: ["No potency columns at all."] },
    },
    {
      severity: "info",
      code: "cannabinoid_missing",
      message: "No source THC/Total potency value; product will show no THC box until enriched.",
      context: { productName: "Kellys Karamels" },
    },
    {
      severity: "info",
      code: "thc_package_total_override",
      message: "Displayed THC now uses the verified package total.",
      context: {
        productName: "Const HRG Blueberry 10 x 10mg Gummies",
        totalColumnDisplay: "10mg",
        verifiedPackageTotal: "100mg",
      },
    },
    // Raw-row flag whose product name matches NO card -> standalone row.
    {
      severity: "warning",
      code: "package_size_mg_garbage",
      message: "Package Size column carries a milligram figure beyond any sane potency.",
      context: { productName: "Jelly Gems Watermelon 25000mg", rawPackage: "25000.00 Milligrams", mg: 25000 },
    },
    // Same standalone flag twice -> merged into ONE row, note deduped.
    {
      severity: "warning",
      code: "package_size_mg_garbage",
      message: "Package Size column carries a milligram figure beyond any sane potency.",
      context: { productName: "Jelly Gems Watermelon 25000mg", rawPackage: "25000.00 Milligrams", mg: 25000 },
    },
    // Non-review code: ignored entirely.
    { severity: "info", code: "inventory_batch_collapse", message: "collapsed", context: null },
  ];

  const items = [verified, flagged, flower, hiddenFlagged, enrichMe];
  const buckets = buildFactReviewBuckets(items, diags);

  // -- Partition arithmetic (Rule 3.3 groundwork) ---------------------------
  ok(buckets.totals.items === 5, "totals.items counts staged items");
  ok(
    buckets.totals.autoAccepted + buckets.totals.needsReview + buckets.totals.rejected ===
      buckets.totals.items + buckets.totals.standaloneFlags,
    "exhaustive partition: buckets sum to items + standalone flags",
  );
  ok(buckets.totals.autoAccepted === 2, "two auto-accepted (verified gummy + flower)");
  ok(buckets.totals.needsReview === 3, "three needs-review (Moxey + Kelly's + standalone Jelly Gems)");
  ok(buckets.totals.rejected === 1, "one rejected (hidden topical)");
  ok(buckets.totals.standaloneFlags === 1, "duplicate unmatched flags merged into ONE standalone row");
  ok(buckets.totals.pendingReview === 3, "all review rows pending before any resolution");

  // -- Bucket assignment + confidence ---------------------------------------
  const vRow = buckets.autoAccepted.find((r) => r.sourceItemId === "pos-verified");
  ok(vRow?.confidence === "verified", "provenance-backed row is confidence=verified");
  ok(vRow?.sources === "package_thc_mg: name+column; servings_per_pack: name+column", "sources string lists per-fact provenance sorted");
  ok(
    vRow?.notes.some((n) => n.includes("corrected to the verified package total 100mg")) === true,
    "override note attached to auto-accepted row (disclosed, not hidden)",
  );
  const fRow = buckets.autoAccepted.find((r) => r.sourceItemId === "pos-flower");
  ok(fRow?.confidence === "single-source", "column-only row is confidence=single-source");
  ok(fRow?.notes.length === 0, "clean flower row carries no notes");

  const mRow = buckets.needsReview.find((r) => r.sourceItemId === "pos-flagged");
  ok(mRow?.confidence === "needs-review", "flagged row is confidence=needs-review");
  ok(
    mRow?.notes[0] === "Thc column value 4.7 could not be explained by any reading of the name.",
    "cross-examiner reasons pass through verbatim as plain English",
  );
  const kRow = buckets.needsReview.find((r) => r.sourceItemId === "pos-enrich");
  ok(
    kRow?.notes[0]?.includes("No THC potency in the source columns") === true,
    "cannabinoid_missing rewritten as a plain-English enrichment note",
  );

  const hRow = buckets.rejected.find((r) => r.sourceItemId === "pos-hidden");
  ok(hRow !== undefined, "hidden+flagged item stays in rejected (precedence)");
  ok(
    hRow?.notes[0]?.includes("missing from the products file") === true,
    "documented reject reason leads the notes",
  );
  ok(hRow?.notes.some((n) => n === "No potency columns at all.") === true, "flag reason rides along on rejected row");

  const sRow = buckets.needsReview.find((r) => r.sourceItemId.startsWith("flag:package_size_mg_garbage:"));
  ok(sRow !== undefined, "unmatched review flag surfaces as standalone row (never lost)");
  ok(sRow?.name === "Jelly Gems Watermelon 25000mg", "standalone row named from the diagnostic context");
  ok(sRow?.notes.length === 1, "standalone duplicate notes deduped");
  ok(
    sRow?.notes[0] === 'Package Size column says "25000.00 Milligrams" -- a milligram figure beyond any sane potency; not a real physical measure.',
    "garbage package size explained in plain English",
  );

  // -- Sorting ----------------------------------------------------------------
  ok(
    buckets.needsReview.map((r) => r.name).join("|") ===
      ["Jelly Gems Watermelon 25000mg", "Kellys Karamels", "Moxey Mints Energizing"].join("|"),
    "needs-review sorted by product name",
  );

  // -- Resolutions overlay -----------------------------------------------------
  const resolved = buildFactReviewBuckets(items, diags, [
    {
      sourceItemId: "pos-flagged",
      action: "fix",
      note: "Set package total to 100mg after checking the jar.",
      correctedFacts: { packageThcMg: 100, servingsPerPack: 20 },
    },
    { sourceItemId: sRow!.sourceItemId, action: "reject", note: null },
  ]);
  ok(resolved.totals.pendingReview === 1, "resolutions reduce the pending count");
  const mResolved = resolved.needsReview.find((r) => r.sourceItemId === "pos-flagged");
  ok(mResolved?.resolution === "fix" && mResolved?.resolutionNote?.includes("checking the jar") === true, "resolution + note attached to the row");
  ok(
    mResolved?.facts.packageThcMg === 100 && mResolved?.facts.servingsPerPack === 20,
    "inline-fix values overlay the displayed facts",
  );
  ok(
    mResolved?.sources.includes("package_thc_mg: reviewer") === true &&
      mResolved?.sources.includes("servings_per_pack: reviewer") === true,
    "corrected facts get provenance 'reviewer' (named human source)",
  );
  ok(mResolved?.facts.thc === "100mg", "untouched facts survive an inline fix");
  const sResolved = resolved.needsReview.find((r) => r.sourceItemId === sRow!.sourceItemId);
  ok(sResolved?.resolution === "reject", "standalone flags are resolvable via their synthetic id");
  ok(
    resolved.autoAccepted.find((r) => r.sourceItemId === "pos-verified")?.resolution === null,
    "resolutions never leak onto auto-accepted rows",
  );

  // -- Adapters ---------------------------------------------------------------
  const adapted = menuItemRowToFactReviewItem({
    id: "row-1",
    menu_version_id: "v1",
    source_item_id: "pos-adapted",
    name: "Adapted",
    product_name: "Adapted Raw",
    brand_name: "B",
    vendor_name: null,
    category: "edible-solid",
    filter_categories: [],
    pos_inventory_type: "Solid Edible",
    pos_inventory_category: "Edible",
    strain_type: "unknown",
    strain_name: null,
    thc: "100mg",
    cbd: null,
    total_thc_json: null,
    total_cbd_json: null,
    compounds_json: [],
    // numeric columns come back as STRINGS from PostgREST -- adapter coerces.
    servings_per_pack: "10" as unknown as number,
    mg_per_serving: "10" as unknown as number,
    package_thc_mg: "100" as unknown as number,
    package_cbd_mg: null,
    // SLICE 16 (migration 0216): a solid edible is never a low-THC beverage.
    // Present here because MenuItemRow now requires the fields; the adapter
    // does not read them.
    low_thc_liquid: null,
    unit_thc_mg: null,
    otherwise_taken: null,
    units_per_package: null,
    ratio_label: "1:1:1",
    net_weight_grams: null,
    net_volume_ml: null,
    fact_provenance: { package_thc_mg: "name+column" },
    description: "",
    price_label: "",
    price_minor_units: 0,
    inventory_status: "in-stock",
    hidden: false,
    hidden_reason: null,
    sort_order: 0,
    created_at: "2026-07-01T00:00:00Z",
  });
  ok(adapted.servingsPerPack === 10 && adapted.packageThcMg === 100, "adapter coerces PostgREST numeric strings to numbers");
  ok(adapted.factProvenance.package_thc_mg === "name+column", "adapter passes provenance through");
  const adaptedDiag = posDiagnosticToFactReviewDiagnostic({
    id: "d1",
    import_id: "i1",
    severity: "info",
    code: "fact_extraction_review",
    message: "m",
    context_json: { displayName: "Adapted", reasons: ["r1"] },
    created_at: "2026-07-01T00:00:00Z",
  });
  ok(adaptedDiag.context?.displayName === "Adapted", "diagnostic adapter surfaces context object");
  ok(
    posDiagnosticToFactReviewDiagnostic({
      id: "d2",
      import_id: "i1",
      severity: "info",
      code: "x",
      message: "m",
      context_json: ["not-an-object"],
      created_at: "2026-07-01T00:00:00Z",
    }).context === null,
    "diagnostic adapter rejects non-object context safely",
  );

  // -- CSV ---------------------------------------------------------------------
  ok(escapeCsvField('He said "10, maybe"') === '"He said ""10, maybe"""', "CSV escaping doubles quotes and wraps");
  ok(escapeCsvField("plain") === "plain", "CSV leaves plain fields unquoted");
  const csv = buildFactReviewCsv(resolved);
  const lines = csv.split("\r\n").filter((l) => l !== "");
  ok(lines.length === 1 + 6, "CSV = header + one line per row across all buckets");
  ok(lines[0].startsWith("Bucket,Status,Product,Brand"), "CSV header order pinned");
  ok(csv.endsWith("\r\n"), "CSV ends with CRLF (RFC 4180)");
  const moxeyLine = lines.find((l) => l.includes("Moxey Mints Energizing"));
  ok(moxeyLine?.startsWith("needs-review,fix,") === true, "resolved review row shows its decision in Status");
  const kellyLine = lines.find((l) => l.includes("Kellys Karamels"));
  ok(kellyLine?.startsWith("needs-review,pending,") === true, "unresolved review row shows pending");
  const flowerLine = lines.find((l) => l.includes("Gorilla Glue #4"));
  ok(flowerLine?.startsWith("auto-accepted,,") === true, "auto-accepted rows have empty Status");
  const verifiedLine = lines.find((l) => l.includes("Const HRG"));
  ok(verifiedLine?.includes("100,100,1:1:1") === true, "fact columns serialize package totals + ratio");
  // Semicolon-separated sources contain no comma -> must NOT be over-quoted.
  ok(
    verifiedLine?.includes("package_thc_mg: name+column; servings_per_pack: name+column") === true &&
      verifiedLine?.includes('"package_thc_mg') === false,
    "sources column serialized unquoted (no commas -- never over-quote)",
  );

  if (failures > 0) throw new Error(`fact-review-core self-tests: ${failures} failed`);
  console.log("fact-review-core self-tests passed (44 assertions)");
}
