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
    const thcPct = capped("THC", d.total_thc_pct ?? d.thc_pct);
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
      pos_inventory_type: null,
      pos_inventory_category: null,
      strain_type: enrich.strainType?.trim() || "unknown",
      strain_name: d.strain_name,
      thc: thcPct != null ? formatIntakePotency(thcPct, unit) : null,
      cbd: cbdPct != null ? formatIntakePotency(cbdPct, unit) : null,
      total_thc_json:
        thcPct != null ? { type: "thc", value: String(Number(thcPct.toFixed(2))), unit } : null,
      total_cbd_json:
        cbdPct != null ? { type: "cbd", value: String(Number(cbdPct.toFixed(2))), unit } : null,
      compounds_json: compounds,
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
  }

  return { passed };
}
