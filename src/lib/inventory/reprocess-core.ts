/**
 * src/lib/inventory/reprocess-core.ts  (SLICE 67 — re-run intelligence)
 *
 * The owner's lots and published menu items received BEFORE slices 61-66
 * shipped never met the intelligence engines: the word-by-word fact
 * extractor (SLICE 62), the house-type labeler (SLICE 63), and the
 * display-name builder (SLICE 65). This module plans a REPROCESS pass over
 * those existing rows so they benefit without deleting and re-importing.
 *
 * FILL-ONLY, NEVER-OVERWRITE (governance Rule 3.1 — never guess, and never
 * clobber a human):
 *   - Structured fact columns (migration 0138) are written ONLY when the
 *     current value is NULL and the extraction engine returned an
 *     arithmetic-VERIFIED fact. single-source and conflict facts are never
 *     written — same bar as the import pipelines.
 *   - A fact column whose fact_provenance key already exists is NEVER
 *     touched, even when the column reads NULL — a reviewer's decision
 *     (provenance "reviewer", SLICE 57) always outranks the machine.
 *   - The house type fills pos_inventory_category ONLY when it is currently
 *     empty and the labeler is >= 90 % confident (HOUSE_TYPE_MIN_AUTO_CONFIDENCE).
 *   - The display name is rebuilt ONLY while name === product_name (the raw
 *     manifest name is still what customers see). Rows whose name was
 *     already built by the naming engine or edited by a human differ from
 *     product_name and are left alone. product_name itself is never changed
 *     (compliance under the hood).
 *   - strain_type fills ONLY from an explicit "(I)"/"(S)"/"(H)" marker
 *     written in the product name — never inferred from the strain name.
 *   - Displayed THC is corrected ONLY to a VERIFIED package total on an
 *     mg-dosed row (package-total-first, the same policy transform.ts and
 *     draft-injection-core apply to new imports), with the same per-category
 *     sanity caps.
 *
 * PURE: no I/O, no React — every decision is planned here and unit-tested;
 * the server store (reprocess-store.ts) only reads rows and writes patches.
 * Registered in scripts/compliance/run-pure-selftests.ts.
 */
import {
  crossExamineRow,
  extractNameFacts,
  MG_FACT_TYPES,
  type CrossExamResult,
} from "@/lib/inventory/fact-extraction-core";
import {
  deriveHouseType,
  HOUSE_TYPE_MIN_AUTO_CONFIDENCE,
} from "@/lib/inventory/house-type-core";
import {
  capIntakePotency,
  formatIntakePotency,
} from "@/lib/pos/intake-potency-core";
import { intakeDisplayName } from "@/lib/pos/intake-mastering-core";
import { nameRatioParts } from "@/lib/inventory/coa-facts-core";
import { canonicalRatioFromName } from "@/lib/menu/cannabinoid-profile-core";

/** A planned row patch: SQL column -> new value, plus plain-English notes. */
export type ReprocessPatch = {
  update: Record<string, unknown>;
  notes: string[];
};

/** The inventory_lots fields the lot planner reads (0138 columns + lab numbers). */
export type LotReprocessInput = {
  id: string;
  product_name: string | null;
  inventory_type: string | null;
  strain_type: string | null;
  servings_per_pack: number | null;
  mg_per_serving: number | null;
  package_thc_mg: number | null;
  package_cbd_mg: number | null;
  ratio_label: string | null;
  minor_cannabinoids_json: unknown;
  fact_provenance: unknown;
  /** Lab columns joined from lab_results — the exam's cross-check numbers. */
  lab_total_thc_pct: number | null;
  lab_thc_pct: number | null;
  lab_cbd_pct: number | null;
};

/** The menu_items fields the item planner reads. */
export type MenuItemReprocessInput = {
  id: string;
  name: string;
  product_name: string | null;
  brand_name: string;
  vendor_name: string | null;
  category: string;
  strain_type: string;
  strain_name: string | null;
  pos_inventory_type: string | null;
  pos_inventory_category: string | null;
  thc: string | null;
  servings_per_pack: number | null;
  mg_per_serving: number | null;
  package_thc_mg: number | null;
  package_cbd_mg: number | null;
  ratio_label: string | null;
  compounds_json: unknown;
  fact_provenance: unknown;
  /**
   * R29: the row's CBD display and the THC/CBD JSON, plus the lab PERCENTS of
   * the lot it was made from (joined by pos_product_key in the store). When a
   * displayed mg figure is EXACTLY the lab percent, it is the pre-R29 intake
   * bug ("0.12mg" on a 55 mg gummy pack) and is cleared - evidence, not a
   * guess. All optional: absent = nothing to compare = nothing cleared.
   */
  cbd?: string | null;
  total_thc_json?: unknown;
  total_cbd_json?: unknown;
  /** Every THC lab percent (total + delta-9) of every lot with this source_item_id. */
  lab_thc_pcts?: readonly (number | null)[];
  /** Every CBD lab percent (cbd + total) of every lot with this source_item_id. */
  lab_cbd_pcts?: readonly (number | null)[];
};

/**
 * R29: true when `display` ("0.12mg") is exactly one of the lab percents
 * printed with an mg unit (compared at the 2 decimals formatIntakePotency
 * writes). Zero / missing values never match.
 */
export function isLabPercentAsMg(display: string | null | undefined, labPcts: readonly (number | null | undefined)[]): boolean {
  const mg = parseMgDisplay(display);
  if (mg === null || mg <= 0) return false;
  return labPcts.some((p) => typeof p === "number" && Number.isFinite(p) && p > 0 && Number(p.toFixed(2)) === mg);
}

/** fact_provenance as a plain record ({} when malformed — never crash on data). */
function provenanceRecord(raw: unknown): Record<string, string> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  return {};
}

/** compounds_json/minor_cannabinoids_json as an array of {type,value,unit}. */
function compoundArray(raw: unknown): { type: string; value: string; unit: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { type: string; value: string; unit: string }[] = [];
  for (const c of raw) {
    if (c && typeof c === "object") {
      const o = c as Record<string, unknown>;
      if (typeof o.type === "string") {
        out.push({
          type: o.type,
          value: o.value == null ? "" : String(o.value),
          unit: typeof o.unit === "string" ? o.unit : "",
        });
      }
    }
  }
  return out;
}

/** "100mg" -> 100; anything else (null, "22%", "~21%") -> null. */
export function parseMgDisplay(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)mg$/.exec(String(s).trim());
  return m ? Number(m[1]) : null;
}

/** Minor cannabinoid types that may be appended (same closed set as draft-injection). */
const MINOR_TYPES = new Set(["cbg", "cbn", "cbc", "cbdv"]);

type FactCarrier = {
  servings_per_pack: number | null;
  mg_per_serving: number | null;
  package_thc_mg: number | null;
  package_cbd_mg: number | null;
  ratio_label: string | null;
};

/**
 * Shared fill-only fact application: for each 0138 fact column, write the
 * VERIFIED exam value only when the current column is NULL and no provenance
 * key exists for it yet (a reviewer's decision is never second-guessed).
 * package totals get the same per-category mg sanity caps as the import path.
 */
function applyVerifiedFacts(
  row: FactCarrier,
  provenance: Record<string, string>,
  exam: CrossExamResult,
  websiteCategory: string | null,
  update: Record<string, unknown>,
  provenancePatch: Record<string, string>,
  notes: string[],
  productText: string,
): void {
  const canFill = (column: keyof FactCarrier): boolean =>
    row[column] === null && !(column in provenance);

  if (exam.packageThcMg?.confidence === "verified" && canFill("package_thc_mg")) {
    const cv = capIntakePotency(exam.packageThcMg.value, "mg", websiteCategory);
    update.package_thc_mg = cv.value;
    provenancePatch.package_thc_mg = exam.packageThcMg.source;
    notes.push(`package THC ${cv.value}mg (${exam.packageThcMg.source})`);
  }
  if (exam.packageCbdMg?.confidence === "verified" && canFill("package_cbd_mg")) {
    const cv = capIntakePotency(exam.packageCbdMg.value, "mg", websiteCategory);
    update.package_cbd_mg = cv.value;
    provenancePatch.package_cbd_mg = exam.packageCbdMg.source;
    notes.push(`package CBD ${cv.value}mg (${exam.packageCbdMg.source})`);
  }
  if (exam.servingsPerPack?.confidence === "verified" && canFill("servings_per_pack")) {
    update.servings_per_pack = exam.servingsPerPack.value;
    provenancePatch.servings_per_pack = exam.servingsPerPack.source;
    notes.push(`servings ${exam.servingsPerPack.value} (${exam.servingsPerPack.source})`);
  }
  if (exam.mgPerServing?.confidence === "verified" && canFill("mg_per_serving")) {
    update.mg_per_serving = exam.mgPerServing.value;
    provenancePatch.mg_per_serving = exam.mgPerServing.source;
    notes.push(`per-serving ${exam.mgPerServing.value}mg (${exam.mgPerServing.source})`);
  }
  if (exam.ratioLabel?.value && canFill("ratio_label")) {
    // R29: the same canonical text intake writes ("2:2:2:1 CBG:CBC:CBD:THC").
    const label = canonicalRatioFromName(exam.ratioLabel.value, nameRatioParts(productText, exam.ratioLabel.value));
    update.ratio_label = label;
    provenancePatch.ratio_label = exam.ratioLabel.source;
    notes.push(`ratio ${label}`);
  }
}

/**
 * Plan the reprocess patch for ONE inventory lot. Returns null when nothing
 * verified is missing — running twice is a no-op by construction.
 */
export function planLotReprocess(lot: LotReprocessInput): ReprocessPatch | null {
  const update: Record<string, unknown> = {};
  const provenancePatch: Record<string, string> = {};
  const notes: string[] = [];
  const provenance = provenanceRecord(lot.fact_provenance);
  const productText = (lot.product_name ?? "").trim();
  const invType = (lot.inventory_type ?? "").trim();

  // Fact extraction — mg-dosed LCB types only (same gate as both import paths).
  if (productText && MG_FACT_TYPES.has(invType)) {
    const exam = crossExamineRow({
      productText,
      inventoryType: invType,
      // R29: lab_results numbers are PERCENT of weight (WCIA uom "pct"),
      // never the per-serving / per-package mg column the engine
      // corroborates against - the same rule draft-injection-core applies.
      // The fields stay on the input (the store still joins them) so this
      // can never silently start reading them again without a test failing.
      thcColumn: null,
      cbdColumn: null,
    });
    applyVerifiedFacts(lot, provenance, exam, null, update, provenancePatch, notes, productText);
    // Minor cannabinoids (CBG/CBN/CBC/CBDV) — VERIFIED-only, fill-only when
    // the lot has none recorded yet (0138 minor_cannabinoids_json).
    if (compoundArray(lot.minor_cannabinoids_json).length === 0) {
      const minors = exam.minorCannabinoids
        .filter((m) => m.confidence === "verified" && m.mg !== null && MINOR_TYPES.has(m.cannabinoid.toLowerCase()))
        .map((m) => ({
          type: m.cannabinoid.toLowerCase(),
          value: String(Number((m.mg as number).toFixed(2))),
          unit: "mg",
        }));
      if (minors.length > 0) {
        update.minor_cannabinoids_json = minors;
        notes.push(`minor cannabinoids ${minors.map((m) => `${m.type.toUpperCase()} ${m.value}mg`).join(", ")}`);
      }
    }
  }

  // strain_type — ONLY an explicit "(I)"/"(S)"/"(H)" marker in the name.
  if (!lot.strain_type?.trim() && productText) {
    const marker = extractNameFacts(productText).strainType;
    if (marker) {
      update.strain_type = marker;
      notes.push(`strain type ${marker} (name marker)`);
    }
  }

  if (Object.keys(provenancePatch).length > 0) {
    update.fact_provenance = { ...provenance, ...provenancePatch };
  }
  return Object.keys(update).length > 0 ? { update, notes } : null;
}

/**
 * Plan the reprocess patch for ONE published menu item. Returns null when
 * nothing improvable was found — running twice is a no-op by construction.
 */
export function planMenuItemReprocess(item: MenuItemReprocessInput): ReprocessPatch | null {
  const update: Record<string, unknown> = {};
  const provenancePatch: Record<string, string> = {};
  const notes: string[] = [];
  const provenance = provenanceRecord(item.fact_provenance);
  const rawName = (item.product_name ?? "").trim();
  const invType = (item.pos_inventory_type ?? "").trim();
  const examText = rawName || item.name;

  // Fact extraction — mg-dosed LCB types only. The row's own displayed THC/CBD
  // mg numbers stand in for the potency columns (they came from those columns).
  if (examText && MG_FACT_TYPES.has(invType)) {
    // R29: a displayed THC/CBD that is exactly the lot's lab PERCENT was
    // printed by the pre-R29 intake with an mg unit. It is cleared (with the
    // JSON and compound rows carrying the same number) and is never used as
    // a corroborating mg column.
    const thcPcts = item.lab_thc_pcts ?? [];
    const cbdPcts = item.lab_cbd_pcts ?? [];
    const thcIsPct = isLabPercentAsMg(item.thc, thcPcts);
    const cbdIsPct = isLabPercentAsMg(item.cbd, cbdPcts);
    let compoundsNow = compoundArray(item.compounds_json);
    if (thcIsPct || cbdIsPct) {
      if (thcIsPct) {
        update.thc = null;
        update.total_thc_json = null;
        notes.push(`displayed THC ${item.thc} was the lab percent printed as mg - cleared`);
      }
      if (cbdIsPct) {
        update.cbd = null;
        update.total_cbd_json = null;
        notes.push(`displayed CBD ${item.cbd} was the lab percent printed as mg - cleared`);
      }
      const kept = compoundsNow.filter((c) => {
        if (c.unit !== "mg") return true;
        const pcts = c.type === "thc" ? thcPcts : c.type === "cbd" ? cbdPcts : [];
        return !isLabPercentAsMg(`${c.value}mg`, pcts);
      });
      if (kept.length !== compoundsNow.length) {
        update.compounds_json = kept;
        compoundsNow = kept;
      }
    }
    const exam = crossExamineRow({
      productText: examText,
      inventoryType: invType,
      thcColumn: thcIsPct ? null : parseMgDisplay(item.thc),
      cbdColumn: null,
    });
    applyVerifiedFacts(item, provenance, exam, item.category, update, provenancePatch, notes, examText);

    // Package-total-first: a VERIFIED package total corrects the displayed
    // THC (same policy as transform.ts and draft-injection-core for new rows).
    if (exam.packageThcMg?.confidence === "verified") {
      const cv = capIntakePotency(exam.packageThcMg.value, "mg", item.category);
      const current = thcIsPct ? null : parseMgDisplay(item.thc);
      if (current !== cv.value) {
        update.thc = formatIntakePotency(cv.value, "mg");
        update.total_thc_json = {
          type: "thc",
          value: String(Number(cv.value.toFixed(2))),
          unit: "mg",
        };
        notes.push(`displayed THC ${item.thc ?? "(none)"} -> ${formatIntakePotency(cv.value, "mg")} (verified package total)`);
      }
    }

    // R29: a cleared (percent-as-mg) CBD display is refilled only by a
    // VERIFIED package CBD total - the same package-total-first rule.
    if (cbdIsPct && exam.packageCbdMg?.confidence === "verified") {
      const cv = capIntakePotency(exam.packageCbdMg.value, "mg", item.category);
      update.cbd = formatIntakePotency(cv.value, "mg");
      update.total_cbd_json = { type: "cbd", value: String(Number(cv.value.toFixed(2))), unit: "mg" };
      notes.push(`displayed CBD -> ${formatIntakePotency(cv.value, "mg")} (verified package total)`);
    }

    // Minor cannabinoids — VERIFIED-only, appended to compounds_json when the
    // compound type is not already present (same closed set as draft-injection).
    const compounds = compoundsNow;
    const appended = exam.minorCannabinoids
      .filter(
        (m) =>
          m.confidence === "verified" &&
          m.mg !== null &&
          MINOR_TYPES.has(m.cannabinoid.toLowerCase()) &&
          !compounds.some((c) => c.type === m.cannabinoid.toLowerCase()),
      )
      .map((m) => ({
        type: m.cannabinoid.toLowerCase(),
        value: String(Number((m.mg as number).toFixed(2))),
        unit: "mg",
      }));
    if (appended.length > 0) {
      update.compounds_json = [...compounds, ...appended];
      notes.push(`compounds + ${appended.map((m) => `${m.type.toUpperCase()} ${m.value}mg`).join(", ")}`);
    }
  }

  // House type — fill pos_inventory_category ONLY when empty and >= 90 % sure.
  if (!item.pos_inventory_category?.trim()) {
    const house = deriveHouseType({
      productName: examText || null,
      inventoryType: invType || null,
      websiteCategory: item.category || null,
    });
    if (house.houseType && house.confidence >= HOUSE_TYPE_MIN_AUTO_CONFIDENCE) {
      update.pos_inventory_category = house.houseType;
      notes.push(`house type ${house.houseType} (${house.confidence}% via ${house.source})`);
    }
  }

  // Display name — ONLY while the raw manifest name is still on screen
  // (name === product_name). NULL from the builder means "not confident":
  // the raw name stays, never guessed. product_name is never changed.
  if (rawName && item.name === rawName) {
    const built = intakeDisplayName({
      name: item.name,
      product_name: item.product_name,
      brand_name: item.brand_name,
      vendor_name: item.vendor_name,
      category: item.category,
      strain_name: item.strain_name,
    });
    if (built && built !== item.name) {
      update.name = built;
      notes.push(`display name "${item.name}" -> "${built}"`);
    }
  }

  // strain_type — ONLY an explicit "(I)"/"(S)"/"(H)" marker in the name.
  const st = (item.strain_type ?? "").trim().toLowerCase();
  if ((st === "" || st === "unknown") && examText) {
    const marker = extractNameFacts(examText).strainType;
    if (marker) {
      update.strain_type = marker;
      notes.push(`strain type ${marker} (name marker)`);
    }
  }

  if (Object.keys(provenancePatch).length > 0) {
    update.fact_provenance = { ...provenance, ...provenancePatch };
  }
  return Object.keys(update).length > 0 ? { update, notes } : null;
}

/* ------------------------------------------------------------------ *
 * Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */
export function __runReprocessCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`reprocess-core self-test failed: ${msg}`);
    passed += 1;
  };

  const blankLot: LotReprocessInput = {
    id: "L1",
    product_name: null,
    inventory_type: null,
    strain_type: null,
    servings_per_pack: null,
    mg_per_serving: null,
    package_thc_mg: null,
    package_cbd_mg: null,
    ratio_label: null,
    minor_cannabinoids_json: [],
    fact_provenance: {},
    lab_total_thc_pct: null,
    lab_thc_pct: null,
    lab_cbd_pct: null,
  };

  // Moxey lot (real row, engine outputs pinned by fact-extraction self-tests):
  // Thc column 4.7 is garbage; the written 3:1 ratio verifies THC 100 + CBG 300.
  const moxey = planLotReprocess({
    ...blankLot,
    product_name: "M-MT-400BAL - Moxey Balance 3:1 Peppermints (300mg CBG/100mg THC)",
    inventory_type: "Solid Edible",
    lab_total_thc_pct: 4.7,
    lab_cbd_pct: 0.37,
  });
  ok(moxey !== null, "Moxey lot produces a patch");
  ok(moxey!.update.package_thc_mg === 100, "Moxey verified package THC 100 filled");
  ok(
    Array.isArray(moxey!.update.minor_cannabinoids_json) &&
      (moxey!.update.minor_cannabinoids_json as { type: string; value: string }[]).some(
        (m) => m.type === "cbg" && m.value === "300",
      ),
    "Moxey verified CBG 300 filled into minor_cannabinoids_json",
  );
  ok(moxey!.update.ratio_label === "3:1", "Moxey ratio 3:1 filled");
  ok(
    (moxey!.update.fact_provenance as Record<string, string>).package_thc_mg === "name-internal",
    "Moxey provenance records the exam source",
  );

  // Fill-only: the same lot with facts already present is a NO-OP.
  const again = planLotReprocess({
    ...blankLot,
    product_name: "M-MT-400BAL - Moxey Balance 3:1 Peppermints (300mg CBG/100mg THC)",
    inventory_type: "Solid Edible",
    lab_total_thc_pct: 4.7,
    lab_cbd_pct: 0.37,
    package_thc_mg: 100,
    ratio_label: "3:1",
    minor_cannabinoids_json: [{ type: "cbg", value: "300", unit: "mg" }],
    fact_provenance: { package_thc_mg: "name-internal", ratio_label: "name" },
  });
  ok(again === null, "already-filled lot is a no-op (idempotent)");

  // Reviewer supremacy: a provenance key blocks the fill even when the column is NULL.
  const reviewed = planLotReprocess({
    ...blankLot,
    product_name: "M-MT-400BAL - Moxey Balance 3:1 Peppermints (300mg CBG/100mg THC)",
    inventory_type: "Solid Edible",
    lab_total_thc_pct: 4.7,
    minor_cannabinoids_json: [{ type: "cbg", value: "300", unit: "mg" }],
    fact_provenance: { package_thc_mg: "reviewer", ratio_label: "reviewer" },
  });
  ok(
    reviewed === null || !("package_thc_mg" in reviewed.update),
    "reviewer-set provenance is never overwritten",
  );

  // Single-source facts are NEVER written (Kelly's: all potency columns zero),
  // but the pack count stated in the name IS verified and fills.
  const kelly = planLotReprocess({
    ...blankLot,
    product_name: "Kelly's Sweet Hash Edibles - Kellys - 10pk Cookie Dough - 100mg THC - Peanut Butter",
    inventory_type: "Solid Edible",
    lab_total_thc_pct: 0,
    lab_cbd_pct: 0,
  });
  ok(kelly !== null && !("package_thc_mg" in kelly.update), "Kelly's single-source THC not written");
  ok(kelly!.update.servings_per_pack === 10, "Kelly's stated 10pk verified and filled");

  // Percent-mode lot (flower): no mg facts invented; the "(I)" marker fills strain_type.
  const gelato = planLotReprocess({
    ...blankLot,
    product_name: "A.C. Flower - Gelato Cake - 3.5g (I)",
    inventory_type: "Usable Marijuana",
    lab_total_thc_pct: 28.94,
  });
  ok(gelato !== null && gelato.update.strain_type === "indica", "flower (I) marker fills strain_type");
  ok(!("package_thc_mg" in gelato!.update), "percent-mode: no mg facts invented");

  // No marker, no facts, nothing missing -> null (never guess).
  const noSignal = planLotReprocess({
    ...blankLot,
    product_name: "Blue Dream 3.5g",
    inventory_type: "Usable Marijuana",
  });
  ok(noSignal === null, "no signal lot is a no-op");

  // ---- menu items ------------------------------------------------------

  const blankItem: MenuItemReprocessInput = {
    id: "M1",
    name: "",
    product_name: null,
    brand_name: "",
    vendor_name: null,
    category: "edible-solid",
    strain_type: "unknown",
    strain_name: null,
    pos_inventory_type: null,
    pos_inventory_category: null,
    thc: null,
    servings_per_pack: null,
    mg_per_serving: null,
    package_thc_mg: null,
    package_cbd_mg: null,
    ratio_label: null,
    compounds_json: [],
    fact_provenance: {},
  };

  // Rainbow gummy (real row): "10 x 10mg - 100mg THC" verifies everything;
  // the wrong per-serving 10mg display corrects to the 100mg package total;
  // the labeler types it Gummies (95); SLICE 65 rebuilds the display name.
  const rainbowRaw = "Gummy - Rainbow (Variety) - 10 x 10mg - 100mg THC";
  const rainbow = planMenuItemReprocess({
    ...blankItem,
    name: rainbowRaw,
    product_name: rainbowRaw,
    vendor_name: "Journeyman",
    pos_inventory_type: "Solid Edible",
    thc: "10mg",
  });
  ok(rainbow !== null, "Rainbow produces a patch");
  ok(rainbow!.update.package_thc_mg === 100, "Rainbow package THC 100 filled");
  ok(rainbow!.update.servings_per_pack === 10 && rainbow!.update.mg_per_serving === 10, "Rainbow servings + per-serving filled");
  ok(rainbow!.update.thc === "100mg", "Rainbow displayed THC corrected to the verified package total");
  ok(
    (rainbow!.update.total_thc_json as { value: string }).value === "100",
    "Rainbow total_thc_json mirrors the corrected display",
  );
  ok(rainbow!.update.pos_inventory_category === "Gummies", "Rainbow typed Gummies (95%)");
  ok(rainbow!.update.name === "Gummy Rainbow Variety 10 X 10mg 100mg THC", "Rainbow display name rebuilt (raw stays in product_name)");
  ok(!("product_name" in rainbow!.update), "product_name is never changed");

  // Name gate: a row whose name was ALREADY built (name !== product_name) is never renamed.
  const alreadyNamed = planMenuItemReprocess({
    ...blankItem,
    name: "Rainbow Gummies 100mg",
    product_name: rainbowRaw,
    vendor_name: "Journeyman",
    pos_inventory_type: "Solid Edible",
    thc: "100mg",
    package_thc_mg: 100,
    servings_per_pack: 10,
    mg_per_serving: 10,
    pos_inventory_category: "Gummies",
    fact_provenance: { package_thc_mg: "name-internal", servings_per_pack: "name", mg_per_serving: "name" },
  });
  ok(alreadyNamed === null, "engine-named row with facts filled is a no-op");

  // Percent flower item: no mg facts; house type Flower (95) fills; (I) marker
  // fills strain_type; the confident strain-led name replaces the raw name.
  const flowerRaw = "A.C. Flower - Gelato Cake - 3.5g (I)";
  const flower = planMenuItemReprocess({
    ...blankItem,
    name: flowerRaw,
    product_name: flowerRaw,
    vendor_name: "Artizen",
    category: "flower",
    strain_name: "Gelato Cake",
    pos_inventory_type: "Usable Marijuana",
    thc: "28.94%",
  });
  ok(flower !== null, "flower item produces a patch");
  ok(!("package_thc_mg" in flower!.update) && !("thc" in flower!.update), "percent row: no mg facts, display untouched");
  ok(flower!.update.pos_inventory_category === "Flower", "flower typed Flower (95%)");
  ok(flower!.update.strain_type === "indica", "flower (I) marker fills strain_type");
  ok(flower!.update.name === "Gelato Cake", "strain-led display name rebuilt");

  // No vendor -> the name builder returns null -> raw name kept (never guess).
  const noVendor = planMenuItemReprocess({
    ...blankItem,
    name: "Blue Dream 1g",
    product_name: "Blue Dream 1g",
    category: "flower",
    strain_name: "Blue Dream",
    pos_inventory_type: "Usable Marijuana",
    pos_inventory_category: "Flower",
    strain_type: "hybrid",
  });
  ok(noVendor === null, "blank vendor: no rename, no guess, no-op");

  // parseMgDisplay honesty.
  ok(parseMgDisplay("100mg") === 100, "parseMgDisplay reads 100mg");
  ok(parseMgDisplay("22%") === null, "parseMgDisplay rejects percent");
  ok(parseMgDisplay("~21%") === null, "parseMgDisplay rejects estimates");
  ok(parseMgDisplay(null) === null, "parseMgDisplay null-safe");

  // ---- R29: lab percents printed as mg (the pre-R29 intake bug) ----------
  ok(isLabPercentAsMg("0.12mg", [0.1206, null]), "0.12mg == lab 0.1206 % (2 dp)");
  ok(!isLabPercentAsMg("55mg", [0.1206]), "a real package total never matches");
  ok(!isLabPercentAsMg("0.12mg", [0.13]), "a different percent never matches");
  ok(!isLabPercentAsMg("0.12%", [0.12]) && !isLabPercentAsMg(null, [0.12]), "percent / null displays never match");
  ok(!isLabPercentAsMg("0mg", [0]) && !isLabPercentAsMg("1mg", [null, undefined]), "zero / missing never match");

  const sourMandarin = "bytes - CBG:CBC:CBD:THC (2:2:2:1) - 10pk - Sour Mandarin - 50g";
  const bug = planMenuItemReprocess({
    ...blankItem,
    name: "Bytes Sour Mandarin",
    product_name: sourMandarin,
    category: "edible-solid",
    pos_inventory_type: "Solid Edible",
    pos_inventory_category: "Gummies",
    thc: "0.12mg",
    cbd: "0.22mg",
    total_thc_json: { type: "thc", value: "0.12", unit: "mg" },
    total_cbd_json: { type: "cbd", value: "0.22", unit: "mg" },
    compounds_json: [
      { type: "thc", value: "0.12", unit: "mg" },
      { type: "cbd", value: "0.22", unit: "mg" },
      { type: "cbg", value: "100", unit: "mg" },
    ],
    lab_thc_pcts: [0.1206, 0.1206],
    lab_cbd_pcts: [0.2219, null],
  });
  ok(bug !== null && bug.update.thc === null && bug.update.total_thc_json === null, "R29: percent-as-mg THC cleared");
  ok(bug!.update.cbd === null && bug!.update.total_cbd_json === null, "R29: percent-as-mg CBD cleared");
  ok(JSON.stringify(bug!.update.compounds_json) === JSON.stringify([{ type: "cbg", value: "100", unit: "mg" }]), "R29: only the percent compound rows dropped; real CBG kept");
  ok(bug!.update.ratio_label === "2:2:2:1 CBG:CBC:CBD:THC", "R29: canonical ratio filled");
  ok(bug!.notes.some((n) => n.includes("lab percent printed as mg")), "R29: clean-up explained");
  // Idempotent: after the patch the row has nothing left to clear.
  const bugAgain = planMenuItemReprocess({
    ...blankItem,
    name: "Bytes Sour Mandarin",
    product_name: sourMandarin,
    category: "edible-solid",
    pos_inventory_type: "Solid Edible",
    pos_inventory_category: "Gummies",
    thc: null,
    cbd: null,
    compounds_json: [{ type: "cbg", value: "100", unit: "mg" }],
    ratio_label: "2:2:2:1 CBG:CBC:CBD:THC",
    servings_per_pack: 10,
    fact_provenance: { ratio_label: "name", servings_per_pack: "name" },
    lab_thc_pcts: [0.1206],
    lab_cbd_pcts: [0.2219],
  });
  ok(bugAgain === null, "R29: clean-up is idempotent");
  // A real mg display that is NOT the lab percent is never touched.
  const real = planMenuItemReprocess({
    ...blankItem,
    name: "Bytes Sour Mandarin",
    product_name: sourMandarin,
    category: "edible-solid",
    pos_inventory_type: "Solid Edible",
    pos_inventory_category: "Gummies",
    thc: "55mg",
    cbd: "100mg",
    ratio_label: "2:2:2:1 CBG:CBC:CBD:THC",
    servings_per_pack: 10,
    fact_provenance: { ratio_label: "name", servings_per_pack: "name" },
    lab_thc_pcts: [0.1206],
    lab_cbd_pcts: [0.2219],
  });
  ok(real === null, "R29: real mg figures are left alone");
  // Without the lab join (older callers) nothing is cleared - no evidence, no change.
  const noLab = planMenuItemReprocess({
    ...blankItem,
    name: "Bytes Sour Mandarin",
    product_name: sourMandarin,
    category: "edible-solid",
    pos_inventory_type: "Solid Edible",
    pos_inventory_category: "Gummies",
    thc: "0.12mg",
    ratio_label: "x",
    servings_per_pack: 10,
    fact_provenance: { ratio_label: "reviewer", servings_per_pack: "name" },
  });
  ok(noLab === null, "R29: no lab percent to compare -> nothing cleared");
  // Lots: the lab percent no longer verifies an mg fact (Gummies 100mg + 0.5 %
  // used to verify "0.5 mg x 200 servings").
  const pctLot = planLotReprocess({
    ...blankLot,
    product_name: "Brand - Gummies - 100mg THC - Mango",
    inventory_type: "Solid Edible",
    lab_total_thc_pct: 0.5,
  });
  ok(pctLot === null || (!("package_thc_mg" in pctLot.update) && !("servings_per_pack" in pctLot.update) && !("mg_per_serving" in pctLot.update)), "R29: lab percent never verifies lot mg facts");
  const listLot = planLotReprocess({ ...blankLot, product_name: sourMandarin, inventory_type: "Solid Edible" });
  ok(listLot!.update.ratio_label === "2:2:2:1 CBG:CBC:CBD:THC", "R29: lot ratio canonical");

  console.log(`reprocess-core self-tests: ${passed} assertions passed`);
}
