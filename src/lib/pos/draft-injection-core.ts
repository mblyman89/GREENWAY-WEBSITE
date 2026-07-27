/**
 * src/lib/pos/draft-injection-core.ts
 *
 * W7 (Decision B — owner-approved) — PURE planner for injecting APPROVED
 * onboarding drafts (catalog_product_drafts) into a freshly-staged menu
 * version, so an approved product truly reaches the next menu publish without
 * the hidden "manually add it to the POS first" hop (audit gap G2).
 *
 * DRAFTS-ONLY IS PRESERVED: injection targets the *staged* version only — a
 * human still reviews the diagnostics/diff and presses Publish. Nothing here
 * ever goes live on its own.
 *
 * POS REMAINS THE SOURCE OF TRUTH (audit hard rule): when the POS export
 * already contains the draft's pos_product_key, we SKIP injection — the POS
 * row wins, and the diagnostic tells the human the POS has caught up. The
 * draft only fills the gap until then.
 *
 * NEVER GUESS: a draft with no POS key (no stable menu identity) or no
 * resolvable website category or no approved price is SKIPPED with a warning
 * diagnostic — never injected with invented data.
 */
import { formatMoney } from "@/lib/pos/format";
import {
  intakePotencyUnit,
  capIntakePotency,
  formatIntakePotency,
  type PotencyUnit,
} from "@/lib/pos/intake-potency-core";
import { crossExamineRow, MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";
import { deriveHouseType, HOUSE_TYPE_MIN_AUTO_CONFIDENCE } from "@/lib/inventory/house-type-core";

/** The approved draft columns injection needs (from catalog_product_drafts). */
export type ApprovedDraftForInjection = {
  id: string;
  pos_product_key: string | null;
  name: string;
  brand_name: string | null;
  vendor_name: string | null;
  strain_name: string | null;
  thc_pct: number | null;
  cbd_pct: number | null;
  total_thc_pct: number | null;
  potency_json: Record<string, number> | null;
  price_minor_units: number | null;
  updated_at: string;
  /**
   * SLICE 61: the lot's LCB inventory type ("Solid Edible", "Topical
   * Ointment", …) — one of the two signals that decide whether potency
   * displays in mg or %. Optional so historical callers/tests keep compiling;
   * both server callers already SELECT it.
   */
  inventory_type?: string | null;
};

/** Per-draft enrichment the SERVER gathers (resolver / kb / lot lookups). */
export type DraftEnrichment = {
  /** Resolved website category (category-taxonomy value) or null = unmapped. */
  websiteCategory: string | null;
  /** kb_strains.strain_type when the strain is curated; else null. */
  strainType: string | null;
  /** Lot on-hand for the inventory badge; null when unknown. */
  onHandQty: number | null;
  /** Package label like "3.5g" from the lot's unit weight; null when unknown. */
  packageLabel: string | null;
};

export type DraftInjectionInputs = {
  drafts: ApprovedDraftForInjection[];
  /** source_item_ids already present in the staged version (POS truth). */
  existingKeys: Set<string>;
  enrichmentByDraftId: Map<string, DraftEnrichment>;
  /** Injected items are appended after the POS items (item_count so far). */
  baseSortOrder: number;
};

/** A menu_items row (sans menu_version_id) + its optional single variant. */
export type PlannedInjectedItem = {
  source_item_id: string;
  name: string;
  product_name: string | null;
  brand_name: string;
  vendor_name: string | null;
  category: string;
  filter_categories: string[];
  pos_inventory_type: string | null;
  pos_inventory_category: string | null;
  strain_type: string;
  strain_name: string | null;
  thc: string | null;
  cbd: string | null;
  total_thc_json: { type: "thc"; value: string; unit: PotencyUnit } | null;
  total_cbd_json: { type: "cbd"; value: string; unit: PotencyUnit } | null;
  compounds_json: { type: string; value: string; unit: PotencyUnit }[];
  /**
   * SLICE 62: structured facts (migration 0138 columns on menu_items) from
   * the SLICE 55 word-by-word extraction engine, VERIFIED-only — null means
   * "not verified", never "zero". Same rule as the Cultivera import path.
   */
  servings_per_pack: number | null;
  mg_per_serving: number | null;
  package_thc_mg: number | null;
  package_cbd_mg: number | null;
  ratio_label: string | null;
  fact_provenance: Record<string, string>;
  description: string;
  price_label: string;
  price_minor_units: number;
  inventory_status: "in-stock" | "low-stock" | "unavailable";
  hidden: boolean;
  hidden_reason: string | null;
  sort_order: number;
  variant: {
    source_variant_id: string;
    label: string;
    price_minor_units: number;
    inventory_level: number;
    medical: boolean;
    sort_order: number;
  } | null;
};

export type InjectionDiagnostic = {
  severity: "info" | "warning";
  code: string;
  message: string;
  context?: Record<string, unknown>;
};

export type DraftInjectionPlan = {
  items: PlannedInjectedItem[];
  diagnostics: InjectionDiagnostic[];
};

/** Same thresholds as transform.ts statusForInventory (verified :580-584). */
export function statusForOnHand(level: number | null): "in-stock" | "low-stock" | "unavailable" {
  if (level == null) return "in-stock"; // just accepted from a manifest
  if (level <= 0) return "unavailable";
  if (level <= 3) return "low-stock";
  return "in-stock";
}

const COMPOUND_TYPES = new Set(["thc", "thca", "cbd", "cbda", "cbg", "cbn", "cbc", "cbdv"]);

/**
 * Plan the injection. Deterministic and pure: dedupes approved drafts by POS
 * key (newest updated_at wins), skips anything that can't be injected
 * honestly, and emits a diagnostic for every decision so the import review
 * screen shows exactly what happened before the human publishes.
 */
export function buildDraftInjectionPlan(inputs: DraftInjectionInputs): DraftInjectionPlan {
  const items: PlannedInjectedItem[] = [];
  const diagnostics: InjectionDiagnostic[] = [];

  // Dedupe by POS key — the open-draft unique index only guards status='draft',
  // so historical approved rows can repeat a key. Newest wins.
  const byKey = new Map<string, ApprovedDraftForInjection>();
  const keyless: ApprovedDraftForInjection[] = [];
  for (const d of inputs.drafts) {
    const key = d.pos_product_key?.trim() || null;
    if (!key) {
      keyless.push(d);
      continue;
    }
    const prev = byKey.get(key);
    if (!prev || d.updated_at > prev.updated_at) byKey.set(key, d);
  }

  for (const d of keyless) {
    diagnostics.push({
      severity: "warning",
      code: "draft_inject_no_pos_key",
      message: `Approved product “${d.name}” has no POS key, so it cannot be placed on the menu automatically. Add it in the POS so the next export carries it.`,
      context: { draft_id: d.id },
    });
  }

  let idx = 0;
  for (const [key, d] of byKey) {
    // POS truth wins: the export already carries this product.
    if (inputs.existingKeys.has(key)) {
      diagnostics.push({
        severity: "info",
        code: "draft_superseded_by_pos",
        message: `Approved product “${d.name}” is now in the POS export — the POS row is used (no injection needed).`,
        context: { draft_id: d.id, pos_product_key: key },
      });
      continue;
    }

    const enrich = inputs.enrichmentByDraftId.get(d.id) ?? {
      websiteCategory: null,
      strainType: null,
      onHandQty: null,
      packageLabel: null,
    };

    // Never guess a category — unmapped means SKIP + tell the human where to fix it.
    if (!enrich.websiteCategory) {
      diagnostics.push({
        severity: "warning",
        code: "draft_inject_unmapped_category",
        message: `Approved product “${d.name}” was NOT added: its inventory type doesn't map to a website category yet. Map it under Settings → Types, then re-import.`,
        context: { draft_id: d.id, pos_product_key: key },
      });
      continue;
    }

    // Approval enforces a priced draft (2× cost floor), but refuse honestly if
    // an old row slipped through without one.
    if (d.price_minor_units == null || d.price_minor_units <= 0) {
      diagnostics.push({
        severity: "warning",
        code: "draft_inject_no_price",
        message: `Approved product “${d.name}” was NOT added: it has no approved price. Re-approve it with a price.`,
        context: { draft_id: d.id, pos_product_key: key },
      });
      continue;
    }

    // SLICE 61 (owner bug: "THC: 3000%" on topicals/edibles): the display unit
    // is DERIVED from the resolved website category + LCB inventory type —
    // never hard-coded. mg-dosed products (edibles/drinks/topicals/tinctures)
    // carry unit "mg"; flower/concentrates stay "%". Values get the same
    // sanity caps as the Cultivera import path (percent hard-capped at 100;
    // per-category mg ceilings), with a diagnostic whenever a cap fires so
    // the human sees exactly what was reined in.
    const unit = intakePotencyUnit(enrich.websiteCategory, d.inventory_type ?? null);
    const capNote = (kind: string, rejected: number, used: number) => {
      diagnostics.push({
        severity: "warning",
        code: "draft_inject_potency_capped",
        message: `“${d.name}”: the source ${kind} value ${rejected} exceeded the ${unit === "%" ? "100% sanity cap" : "mg sanity ceiling"} and was capped at ${used}. Verify the true potency on the COA and enrich the product.`,
        context: { draft_id: d.id, pos_product_key: key, kind, rejected, used, unit },
      });
    };
    const capped = (kind: string, raw: number | null): number | null => {
      if (raw == null || !Number.isFinite(raw) || raw <= 0) return raw == null ? null : raw;
      const r = capIntakePotency(raw, unit, enrich.websiteCategory);
      if (r.capped) capNote(kind, raw, r.value);
      return r.value;
    };
    let thcPct = capped("THC", d.total_thc_pct ?? d.thc_pct);
    const cbdPct = capped("CBD", d.cbd_pct);
    const compounds: PlannedInjectedItem["compounds_json"] = [];
    for (const [k, v] of Object.entries(d.potency_json ?? {})) {
      const type = k.trim().toLowerCase();
      if (COMPOUND_TYPES.has(type) && typeof v === "number" && Number.isFinite(v)) {
        const cv = capIntakePotency(v, unit, enrich.websiteCategory);
        if (cv.capped) capNote(type.toUpperCase(), v, cv.value);
        compounds.push({ type, value: String(Number(cv.value.toFixed(2))), unit });
      }
    }

    // SLICE 62: run the SLICE 55 word-by-word extraction engine on every
    // mg-dosed manifest line — the SAME engine the Cultivera workbook path
    // uses (transform.ts SLICE 56). The raw manifest name is cross-examined
    // against the lab THC/CBD numbers; only arithmetic-VERIFIED facts are
    // used, and anything the engine could not verify feeds the exception
    // queue via a fact_extraction_review diagnostic (Rule 3.1: uncertain
    // facts go to a human, never to customers).
    const factProvenance: Record<string, string> = {};
    let servingsPerPack: number | null = null;
    let mgPerServing: number | null = null;
    let packageThcMg: number | null = null;
    let packageCbdMg: number | null = null;
    let ratioLabel: string | null = null;
    const invType = (d.inventory_type ?? "").trim();
    const exam = MG_FACT_TYPES.has(invType)
      ? crossExamineRow({
          productText: d.name,
          inventoryType: invType,
          thcColumn: d.total_thc_pct ?? d.thc_pct,
          cbdColumn: d.cbd_pct,
        })
      : null;
    if (exam) {
      if (exam.needsReview) {
        diagnostics.push({
          severity: "warning",
          code: "fact_extraction_review",
          message: exam.reviewReasons[0] ?? "Extraction needs review.",
          context: {
            draft_id: d.id,
            pos_product_key: key,
            productName: d.name,
            displayName: d.name,
            inventoryType: invType,
            reasons: exam.reviewReasons,
          },
        });
      }
      if (unit === "mg") {
        // PACKAGE-TOTAL-FIRST (same policy as transform.ts): a VERIFIED
        // package total outranks the raw column value.
        if (exam.packageThcMg?.confidence === "verified") {
          const cv = capIntakePotency(exam.packageThcMg.value, unit, enrich.websiteCategory);
          if (cv.capped) capNote("THC", exam.packageThcMg.value, cv.value);
          packageThcMg = cv.value;
          factProvenance.package_thc_mg = exam.packageThcMg.source;
          if (thcPct !== null && thcPct !== cv.value) {
            diagnostics.push({
              severity: "info",
              code: "thc_package_total_override",
              message:
                "Displayed THC now uses the verified package total; the inconsistent source value was set aside.",
              context: {
                draft_id: d.id,
                pos_product_key: key,
                productName: d.name,
                inventoryType: invType,
                totalColumnDisplay: formatIntakePotency(thcPct, unit),
                verifiedPackageTotal: formatIntakePotency(cv.value, unit),
                how: exam.packageThcMg.note,
              },
            });
          }
          thcPct = cv.value;
        }
        if (exam.packageCbdMg?.confidence === "verified") {
          const cv = capIntakePotency(exam.packageCbdMg.value, unit, enrich.websiteCategory);
          packageCbdMg = cv.value;
          factProvenance.package_cbd_mg = exam.packageCbdMg.source;
        }
        if (exam.servingsPerPack?.confidence === "verified") {
          servingsPerPack = exam.servingsPerPack.value;
          factProvenance.servings_per_pack = exam.servingsPerPack.source;
        }
        if (exam.mgPerServing?.confidence === "verified") {
          mgPerServing = exam.mgPerServing.value;
          factProvenance.mg_per_serving = exam.mgPerServing.source;
        }
        // Minor cannabinoids (CBG/CBN/CBC/CBDV) live ONLY in product names —
        // no manifest columns exist for them. VERIFIED-only, never duplicated.
        for (const minor of exam.minorCannabinoids) {
          if (minor.confidence !== "verified" || minor.mg === null) continue;
          const type = minor.cannabinoid.toLowerCase();
          if (type !== "cbg" && type !== "cbn" && type !== "cbc" && type !== "cbdv") continue;
          if (compounds.some((c) => c.type === type)) continue;
          compounds.push({ type, value: String(Number(minor.mg.toFixed(2))), unit: "mg" });
        }
      }
      if (exam.ratioLabel?.value) {
        ratioLabel = exam.ratioLabel.value;
        factProvenance.ratio_label = exam.ratioLabel.source;
      }
    }

    // SLICE 63 (owner bugs B2/E1): derive OUR house type ("Live Resin
    // Cartridge", "Gummies") from the LCB inventory type + product NAME so
    // the website card's type line shows a real product type instead of the
    // generic website-category alias. AUTO-ASSIGN ONLY at ≥90 % confidence —
    // below that the fields stay null (cardTypeLabel falls back honestly, and
    // SLICE 64 puts a human picker on the approval card). The raw LCB values
    // stay untouched on the draft/lot rows (CCRS under the hood).
    const house = deriveHouseType({
      productName: d.name,
      inventoryType: d.inventory_type ?? null,
      websiteCategory: enrich.websiteCategory,
    });
    const houseType =
      house.houseType && house.confidence >= HOUSE_TYPE_MIN_AUTO_CONFIDENCE
        ? house.houseType
        : null;
    if (houseType) {
      diagnostics.push({
        severity: "info",
        code: "draft_inject_house_type",
        message: `“${d.name}” typed as “${houseType}” (${house.confidence}% via ${house.source}).`,
        context: { draft_id: d.id, pos_product_key: key, house_type: houseType, confidence: house.confidence, source: house.source },
      });
    } else if (house.houseType) {
      diagnostics.push({
        severity: "warning",
        code: "draft_inject_house_type_low_confidence",
        message: `“${d.name}”: the type labeler read “${house.houseType}” from the name but its category disagrees with the resolved website category (${house.confidence}% < ${HOUSE_TYPE_MIN_AUTO_CONFIDENCE}%). No type was auto-assigned — set it manually.`,
        context: { draft_id: d.id, pos_product_key: key, house_type: house.houseType, confidence: house.confidence, source: house.source },
      });
    }

    const brand = d.brand_name?.trim() || "";
    const priceLabel = [formatMoney(d.price_minor_units), enrich.packageLabel ?? ""]
      .filter(Boolean)
      .join(" ");

    items.push({
      source_item_id: key,
      name: d.name,
      product_name: d.name,
      brand_name: brand,
      vendor_name: d.vendor_name,
      category: enrich.websiteCategory,
      filter_categories: [enrich.websiteCategory],
      // SLICE 63: pos_inventory_category is what cardTypeLabel reads for the
      // card's type line (same column the Cultivera path fills from the POS
      // "Category" column). pos_inventory_type carries the raw LCB type for
      // CCRS/reporting parity. Null when confidence <90% — never guessed.
      pos_inventory_type: d.inventory_type?.trim() || null,
      pos_inventory_category: houseType,
      strain_type: enrich.strainType?.trim() || "unknown",
      strain_name: d.strain_name,
      thc: thcPct != null ? formatIntakePotency(thcPct, unit) : null,
      cbd: cbdPct != null ? formatIntakePotency(cbdPct, unit) : null,
      total_thc_json:
        thcPct != null ? { type: "thc", value: String(Number(thcPct.toFixed(2))), unit } : null,
      total_cbd_json:
        cbdPct != null ? { type: "cbd", value: String(Number(cbdPct.toFixed(2))), unit } : null,
      compounds_json: compounds,
      servings_per_pack: servingsPerPack,
      mg_per_serving: mgPerServing,
      package_thc_mg: packageThcMg,
      package_cbd_mg: packageCbdMg,
      ratio_label: ratioLabel,
      fact_provenance: factProvenance,
      // Same copy shape as transform.ts genericDescription (verified :586).
      description: `${d.name}${brand ? ` from ${brand}` : ""}. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.`,
      price_label: priceLabel,
      price_minor_units: d.price_minor_units,
      inventory_status: statusForOnHand(enrich.onHandQty),
      hidden: false,
      hidden_reason: null,
      sort_order: inputs.baseSortOrder + idx,
      variant: {
        source_variant_id: `${key}-onboarded`,
        label: enrich.packageLabel ?? "each",
        price_minor_units: d.price_minor_units,
        inventory_level: enrich.onHandQty ?? 1,
        medical: false,
        sort_order: 0,
      },
    });
    diagnostics.push({
      severity: "info",
      code: "draft_injected",
      message: `Approved onboarding product “${d.name}” was added to this staged version (${formatMoney(d.price_minor_units)}). It goes live when you publish.`,
      context: { draft_id: d.id, pos_product_key: key },
    });
    idx += 1;
  }

  return { items, diagnostics };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runDraftInjectionCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL draft-injection-core: " + msg);
    passed += 1;
  };

  const draft = (over: Partial<ApprovedDraftForInjection>): ApprovedDraftForInjection => ({
    id: "d1",
    pos_product_key: "KEY-1",
    name: "Blue Dream 1g",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds LLC",
    strain_name: "Blue Dream",
    thc_pct: 21.5,
    cbd_pct: 0.4,
    total_thc_pct: 24.113,
    potency_json: { thc: 21.5, thca: 2.9, weird: 1 },
    price_minor_units: 3500,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  });
  const enrich = (over: Partial<DraftEnrichment>): DraftEnrichment => ({
    websiteCategory: "flower",
    strainType: "hybrid",
    onHandQty: 24,
    packageLabel: "1g",
    ...over,
  });
  const plan = (
    drafts: ApprovedDraftForInjection[],
    e: Map<string, DraftEnrichment>,
    existing: string[] = [],
  ) =>
    buildDraftInjectionPlan({
      drafts,
      existingKeys: new Set(existing),
      enrichmentByDraftId: e,
      baseSortOrder: 100,
    });

  // Happy path: injected with resolved category, price label, potency strings.
  {
    const p = plan([draft({})], new Map([["d1", enrich({})]]));
    assert(p.items.length === 1, "injects one item");
    const it = p.items[0];
    assert(it.source_item_id === "KEY-1", "source_item_id is the POS key");
    assert(it.category === "flower" && it.filter_categories[0] === "flower", "resolved category");
    assert(it.thc === "24.11%", "total THC preferred and rounded");
    assert(it.price_label === "$35.00 1g", "price label with package");
    assert(it.sort_order === 100, "appended after POS items");
    assert(it.variant?.label === "1g" && it.variant.inventory_level === 24, "variant from lot");
    assert(it.compounds_json.length === 2, "only known compound keys kept");
    assert(!it.hidden, "injected item is visible once published");
    assert(p.diagnostics.some((d) => d.code === "draft_injected"), "injected diagnostic");
  }

  // POS truth wins: key already staged → skip with info diagnostic.
  {
    const p = plan([draft({})], new Map([["d1", enrich({})]]), ["KEY-1"]);
    assert(p.items.length === 0, "no injection when POS carries the key");
    assert(p.diagnostics.some((d) => d.code === "draft_superseded_by_pos"), "superseded diagnostic");
  }

  // Never guess: unmapped category → skipped + warning.
  {
    const p = plan([draft({})], new Map([["d1", enrich({ websiteCategory: null })]]));
    assert(p.items.length === 0, "unmapped category not injected");
    assert(
      p.diagnostics.some((d) => d.code === "draft_inject_unmapped_category" && d.severity === "warning"),
      "unmapped warning",
    );
  }

  // No POS key → skipped + warning.
  {
    const p = plan([draft({ pos_product_key: null })], new Map([["d1", enrich({})]]));
    assert(p.items.length === 0, "keyless draft not injected");
    assert(p.diagnostics.some((d) => d.code === "draft_inject_no_pos_key"), "keyless warning");
  }

  // No price → skipped + warning.
  {
    const p = plan([draft({ price_minor_units: null })], new Map([["d1", enrich({})]]));
    assert(p.items.length === 0, "unpriced draft not injected");
    assert(p.diagnostics.some((d) => d.code === "draft_inject_no_price"), "unpriced warning");
  }

  // Duplicate approved rows for one key: newest updated_at wins.
  {
    const p = plan(
      [
        draft({ id: "old", price_minor_units: 1000, updated_at: "2025-01-01T00:00:00Z" }),
        draft({ id: "new", price_minor_units: 2000, updated_at: "2026-01-01T00:00:00Z" }),
      ],
      new Map([
        ["old", enrich({})],
        ["new", enrich({})],
      ]),
    );
    assert(p.items.length === 1 && p.items[0].price_minor_units === 2000, "newest duplicate wins");
  }

  // Unknown strain: strain_type falls back to "unknown"; no package → "each".
  {
    const p = plan(
      [draft({})],
      new Map([["d1", enrich({ strainType: null, packageLabel: null, onHandQty: null })]]),
    );
    assert(p.items[0].strain_type === "unknown", "unknown strain type");
    assert(p.items[0].variant?.label === "each", "each fallback label");
    assert(p.items[0].inventory_status === "in-stock", "null on-hand defaults in-stock");
  }

  // On-hand thresholds mirror transform.ts.
  {
    assert(statusForOnHand(0) === "unavailable", "0 unavailable");
    assert(statusForOnHand(3) === "low-stock", "3 low-stock");
    assert(statusForOnHand(4) === "in-stock", "4 in-stock");
  }

  // --- SLICE 61: mg-aware potency (owner bug "THC: 3000%" on topicals) ---

  // A 100 mg drink: unit derives from the edible-liquid category → "100mg".
  {
    const p = plan(
      [draft({ total_thc_pct: 100, thc_pct: null, cbd_pct: null, potency_json: { thc: 100 }, inventory_type: "Liquid Edible" })],
      new Map([["d1", enrich({ websiteCategory: "edible-liquid" })]]),
    );
    const it = p.items[0];
    assert(it.thc === "100mg", "mg drink displays 100mg (not 100%)");
    assert(it.total_thc_json?.unit === "mg", "total_thc_json carries mg unit");
    assert(it.compounds_json[0]?.unit === "mg", "compounds carry mg unit");
    assert(it.cbd === null, "no CBD value -> no CBD display");
  }

  // A 3000 mg topical: under the 5000 mg topical ceiling → shown as mg, uncapped.
  {
    const p = plan(
      [draft({ total_thc_pct: 3000, thc_pct: null, potency_json: null, inventory_type: "Topical Ointment" })],
      new Map([["d1", enrich({ websiteCategory: "topical" })]]),
    );
    assert(p.items[0].thc === "3000mg", "3000mg topical honest (was 3000%)");
    assert(!p.diagnostics.some((d) => d.code === "draft_inject_potency_capped"), "sane mg not capped");
  }

  // The LCB inventory type alone flips to mg when the category is dose-blind.
  {
    const p = plan(
      [draft({ total_thc_pct: 10, thc_pct: null, potency_json: null, inventory_type: "Solid Edible" })],
      new Map([["d1", enrich({ websiteCategory: "edible-solid" })]]),
    );
    assert(p.items[0].total_thc_json?.unit === "mg", "Solid Edible type -> mg");
  }

  // A corrupt 3000 "%" on flower is hard-capped at 100 with a warning.
  {
    const p = plan(
      [draft({ total_thc_pct: 3000, thc_pct: null, potency_json: null, inventory_type: "Usable Marijuana" })],
      new Map([["d1", enrich({ websiteCategory: "flower" })]]),
    );
    assert(p.items[0].thc === "100%", "3000% flower capped at 100%");
    assert(
      p.diagnostics.some((d) => d.code === "draft_inject_potency_capped" && d.severity === "warning"),
      "cap emits warning diagnostic",
    );
  }

  // Flower stays percent (no mg invented) — same output as before this slice.
  {
    const p = plan([draft({})], new Map([["d1", enrich({})]]));
    assert(p.items[0].thc === "24.11%", "flower percent output unchanged");
    assert(p.items[0].total_thc_json?.unit === "%", "flower unit stays %");
    assert(p.items[0].package_thc_mg === null, "flower carries no mg facts");
    assert(Object.keys(p.items[0].fact_provenance).length === 0, "flower provenance empty");
  }

  // --- SLICE 62: word-by-word fact extraction at intake ---

  // A fully reconcilable edible: name facts verified by column arithmetic —
  // package total, servings, per-serving dose, minor cannabinoid — and the
  // verified package total OVERRIDES the raw per-serving column value.
  {
    const p = plan(
      [
        draft({
          name: "Const HRG CBN 1:1:1 Blueberry 10 Pack 300mg",
          total_thc_pct: 10,
          thc_pct: null,
          cbd_pct: 9.1,
          potency_json: null,
          inventory_type: "Solid Edible",
        }),
      ],
      new Map([["d1", enrich({ websiteCategory: "edible-solid" })]]),
    );
    const it = p.items[0];
    assert(it.package_thc_mg === 100, "verified package THC 100mg persisted");
    assert(it.servings_per_pack === 10, "verified servings 10 persisted");
    assert(it.mg_per_serving === 10, "verified 10mg per serving persisted");
    assert(it.package_cbd_mg === 100, "verified package CBD 100mg persisted");
    assert(it.ratio_label === "1:1:1", "ratio label extracted from the name");
    assert(it.thc === "100mg", "verified package total overrides the 10 column value");
    assert(typeof it.fact_provenance.package_thc_mg === "string", "provenance recorded");
    assert(
      it.compounds_json.some((c) => c.type === "cbn" && c.value === "100" && c.unit === "mg"),
      "verified minor cannabinoid CBN 100mg surfaced",
    );
    assert(
      p.diagnostics.some((d) => d.code === "thc_package_total_override"),
      "override disclosed via diagnostic",
    );
    assert(
      !p.diagnostics.some((d) => d.code === "fact_extraction_review"),
      "fully reconciled row does NOT feed the review queue",
    );
  }

  // An UNVERIFIABLE row (zero potency columns): the stated 100mg is only
  // single-source, so it is NOT persisted as a verified fact and the row
  // feeds the fact-review exception queue (Rule 3.1).
  {
    const p = plan(
      [
        draft({
          name: "Kelly's Sweet Hash Edibles - Kellys - 10pk Cookie Dough - 100mg THC - Peanut Butter",
          total_thc_pct: null,
          thc_pct: null,
          cbd_pct: null,
          potency_json: null,
          inventory_type: "Solid Edible",
        }),
      ],
      new Map([["d1", enrich({ websiteCategory: "edible-solid" })]]),
    );
    const it = p.items[0];
    assert(it.package_thc_mg === null, "single-source THC never persisted as verified");
    assert(it.servings_per_pack === 10, "pack count stated in the name IS verified");
    assert(
      p.diagnostics.some(
        (d) => d.code === "fact_extraction_review" && d.severity === "warning",
      ),
      "unverifiable row feeds the exception queue",
    );
  }

  // Percent-mode types never run mg extraction — flower stays fact-free even
  // when its name happens to carry an mg token.
  {
    const p = plan(
      [draft({ name: "Blue Dream 100mg Special 1g", inventory_type: "Usable Marijuana" })],
      new Map([["d1", enrich({})]]),
    );
    assert(p.items[0].package_thc_mg === null, "percent-mode: no mg facts invented");
    assert(
      !p.diagnostics.some((d) => d.code === "fact_extraction_review"),
      "percent-mode rows never flagged by the mg examiner",
    );
  }

  // SLICE 63 (owner bugs B2/B4/E1): the house type labeler fills
  // pos_inventory_category so cardTypeLabel shows a REAL type ("Live Resin
  // Cartridge") instead of the generic website-category alias — auto-assigned
  // only at ≥90% confidence, disclosed via diagnostic.
  {
    const p = plan(
      [
        draft({
          name: "2727 - Live Resin Cart - GG4 1g",
          inventory_type: "Concentrate for Inhalation",
        }),
      ],
      new Map([["d1", enrich({ websiteCategory: "cartridge" })]]),
    );
    const it = p.items[0];
    assert(it.pos_inventory_category === "Live Resin Cartridge", "house type composed from the name (B2/B4)");
    assert(it.pos_inventory_type === "Concentrate for Inhalation", "raw LCB type kept under the hood (E1)");
    assert(
      p.diagnostics.some((d) => d.code === "draft_inject_house_type"),
      "auto-assignment disclosed via info diagnostic",
    );
  }

  // Below the 90% threshold (name signal disagrees with the resolved website
  // category): NOTHING auto-assigned, a warning tells the human to pick.
  {
    const p = plan(
      [draft({ name: "Lemon Balm Kush 3.5g", inventory_type: "Usable Marijuana" })],
      new Map([["d1", enrich({ websiteCategory: "flower" })]]),
    );
    assert(p.items[0].pos_inventory_category === null, "low confidence never auto-assigns");
    assert(
      p.diagnostics.some((d) => d.code === "draft_inject_house_type_low_confidence" && d.severity === "warning"),
      "low-confidence read disclosed as a warning",
    );
  }

  // No signal at all (plain strain name, coarse LCB type): null, no noise.
  {
    const p = plan(
      [draft({ name: "Blue Dream 3.5g", inventory_type: "Usable Marijuana" })],
      new Map([["d1", enrich({ websiteCategory: "flower" })]]),
    );
    assert(p.items[0].pos_inventory_category === null, "no signal = null, never guessed");
    assert(
      !p.diagnostics.some((d) => d.code.startsWith("draft_inject_house_type")),
      "no house-type diagnostics when there is no signal",
    );
  }

  return { passed };
}
