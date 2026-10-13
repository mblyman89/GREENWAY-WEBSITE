/**
 * src/lib/inventory/cultivera-card-refresh-core.ts  (R50 S3c, pure)
 *
 * WHAT. A product on a manifest REBUILT from Cultivera is already selling: its
 * menu card came from the Cultivera export, with Cultivera's name, type and
 * facts. When the owner approves its onboarding draft, the card should become
 * what our own receiving would have built ("treated like we received it",
 * owner follow-up #4), while it keeps selling.
 *
 * HOW (field-level survivorship, the MDM golden-record practice). The card OUR
 * pipeline would build (`buildDraftInjectionPlan`, the native builder, plus
 * the mastering display name) is overlaid onto the CARRIED live card:
 *   - catalogue fields our pipeline decides (name, product name, brand,
 *     vendor, category, filter categories, inventory type, type label, strain
 *     type, strain name) take our value when ours is not blank;
 *   - description only when ours is real copy (never the placeholder);
 *   - facts (potency, compounds, mg facts, net measures, the compliance
 *     flags, effects, aroma) take our value only when it is NOT null:
 *     null = "not verified", it never wipes a live value (S12 rule);
 *   - provenance merged (ours on top);
 *   - NEVER touched: source key, price, price label, variants (ids, prices,
 *     levels, medical), hidden + reason, stock status, sort order.
 *     "Sellable stays sellable."
 * A key that is NOT on the live menu is reported, never injected (no new
 * card from migration stock). Mastering merges never run on migration stock.
 *
 * Pure: no I/O. Self-tests at the bottom (run-pure-selftests.ts).
 */
import type { StagedSnapshotItem } from "@/lib/pos/intake-menu-staging-core";
import type { PlannedInjectedItem, InjectionDiagnostic } from "@/lib/pos/draft-injection-core";
import { boilerplateDescription, isBoilerplateDescription } from "@/lib/catalog/golden-record-core";

/** Kill switch: `off` restores the S3 behaviour (approval catalogues only, no card refresh). */
export const CARD_REFRESH_ENV = "CULTIVERA_CARD_REFRESH";
export function cardRefreshEnabled(raw: string | undefined | null): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "false" || v === "0" || v === "no");
}

/** The fields the refresh may write, by rule (exported so tests pin the list). */
export const CATALOGUE_TEXT_FIELDS = [
  "name",
  "product_name",
  "brand_name",
  "vendor_name",
  "category",
  "pos_inventory_type",
  "pos_inventory_category",
  "strain_name",
] as const;

export const FACT_FIELDS = [
  "thc",
  "cbd",
  "total_thc_json",
  "total_cbd_json",
  "servings_per_pack",
  "mg_per_serving",
  "package_thc_mg",
  "package_cbd_mg",
  "ratio_label",
  "net_weight_grams",
  "net_volume_ml",
  "low_thc_liquid",
  "unit_thc_mg",
  "otherwise_taken",
  "units_per_package",
  "effects",
  "aroma_notes",
] as const;

/** Never written by a refresh (pinned by tests). */
export const PROTECTED_FIELDS = [
  "source_item_id",
  "price_label",
  "price_minor_units",
  "variants",
  "hidden",
  "hidden_reason",
  "inventory_status",
  "sort_order",
  "origin",
] as const;

export const REFRESH_DIAG = {
  refreshed: "cultivera_card_refreshed",
  unchanged: "cultivera_card_unchanged",
  notLive: "cultivera_card_not_live",
} as const;

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** A strain type our pipeline did not decide ("unknown") never replaces a live one. */
const knownStrainType = (v: unknown) => typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "unknown";

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export type CardRefreshChange = { field: string; from: unknown; to: unknown };

/**
 * Overlay OUR card onto the live card (mutates `live`; returns the changes).
 * `displayName` = the mastering name (`intakeDisplayName`), or null to keep ours.
 */
export function refreshLiveCard(live: StagedSnapshotItem, ours: PlannedInjectedItem, displayName: string | null): CardRefreshChange[] {
  const changes: CardRefreshChange[] = [];
  const target = live as unknown as Record<string, unknown>;
  const src = ours as unknown as Record<string, unknown>;
  const set = (field: string, value: unknown) => {
    if (sameValue(target[field], value)) return;
    changes.push({ field, from: target[field] ?? null, to: value });
    target[field] = value;
  };

  for (const f of CATALOGUE_TEXT_FIELDS) {
    const v = f === "name" ? (displayName ?? ours.name) : src[f];
    if (!blank(v)) set(f, typeof v === "string" ? v.trim() : v);
  }
  if (Array.isArray(ours.filter_categories) && ours.filter_categories.length > 0 && !blank(ours.category)) {
    // Keep any extra shelf the live card already had (e.g. a merged pack size), ours first.
    const merged = [...ours.filter_categories];
    for (const c of live.filter_categories ?? []) if (c && c !== live.category && !merged.includes(c)) merged.push(c);
    set("filter_categories", merged);
  }
  if (knownStrainType(ours.strain_type)) set("strain_type", ours.strain_type);
  if (!isBoilerplateDescription(ours.description)) set("description", ours.description.trim());
  for (const f of FACT_FIELDS) {
    const v = src[f];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    set(f, v);
  }
  if (Array.isArray(ours.compounds_json) && ours.compounds_json.length > 0) set("compounds_json", ours.compounds_json);
  const prov = { ...(live.fact_provenance ?? {}), ...(ours.fact_provenance ?? {}) };
  if (!sameValue(prov, live.fact_provenance ?? {})) set("fact_provenance", prov);
  return changes;
}

export type CardRefreshPlan = {
  /** Keys whose live card changed. */
  refreshed: string[];
  /** Keys on the menu where our card matched already. */
  unchanged: string[];
  /** Keys not on the live menu: reported, never injected. */
  notLive: string[];
  changesByKey: Map<string, CardRefreshChange[]>;
  diagnostics: InjectionDiagnostic[];
};

/**
 * Refresh every live card an approved rebuilt draft names. `items` is the
 * carried snapshot (mutated in place); `ours` the native builder's items;
 * `displayNameOf` the mastering name rule.
 */
export function planRebuiltCardRefresh(input: {
  items: StagedSnapshotItem[];
  ours: readonly PlannedInjectedItem[];
  displayNameOf: (it: PlannedInjectedItem) => string | null;
}): CardRefreshPlan {
  const byKey = new Map<string, StagedSnapshotItem>();
  for (const it of input.items) if (!byKey.has(it.source_item_id)) byKey.set(it.source_item_id, it);
  const plan: CardRefreshPlan = { refreshed: [], unchanged: [], notLive: [], changesByKey: new Map(), diagnostics: [] };
  for (const o of input.ours) {
    const key = o.source_item_id;
    const live = byKey.get(key);
    if (!live) {
      plan.notLive.push(key);
      plan.diagnostics.push({
        severity: "warning",
        code: REFRESH_DIAG.notLive,
        message: `\u201c${o.name}\u201d is not on the live menu, so nothing was added (a product from Cultivera never gets a new card here).`,
        context: { pos_product_key: key },
      });
      continue;
    }
    const changes = refreshLiveCard(live, o, input.displayNameOf(o));
    if (changes.length === 0) {
      plan.unchanged.push(key);
      plan.diagnostics.push({ severity: "info", code: REFRESH_DIAG.unchanged, message: `\u201c${live.name}\u201d already matches.`, context: { pos_product_key: key } });
    } else {
      plan.refreshed.push(key);
      plan.changesByKey.set(key, changes);
      plan.diagnostics.push({
        severity: "info",
        code: REFRESH_DIAG.refreshed,
        message: `\u201c${live.name}\u201d rebuilt from your onboarding (${changes.map((c) => c.field).join(", ")}); price, sizes and visibility unchanged.`,
        context: { pos_product_key: key, fields: changes.map((c) => c.field) },
      });
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCultiveraCardRefreshCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL cultivera-card-refresh-core: " + msg);
    }
  };
  const live = (over: Partial<StagedSnapshotItem> = {}): StagedSnapshotItem => ({
    origin: "carried",
    source_item_id: "K1",
    name: "BLUE DREAM 3.5G FW",
    product_name: "BLUE DREAM 3.5G FW",
    brand_name: "FW",
    vendor_name: "Fairwinds",
    category: "flower",
    filter_categories: [],
    pos_inventory_type: "Usable Marijuana",
    pos_inventory_category: null,
    strain_type: "unknown",
    strain_name: null,
    thc: "22%",
    cbd: null,
    total_thc_json: { type: "thc", value: "22", unit: "%" },
    total_cbd_json: null,
    compounds_json: [],
    servings_per_pack: null,
    mg_per_serving: null,
    package_thc_mg: null,
    package_cbd_mg: null,
    ratio_label: null,
    net_weight_grams: 3.5,
    net_volume_ml: null,
    fact_provenance: { thc: "cultivera" },
    low_thc_liquid: null,
    unit_thc_mg: null,
    otherwise_taken: false,
    units_per_package: null,
    effects: ["relaxed"],
    aroma_notes: null,
    description: "Old Cultivera text",
    price_label: "$35",
    price_minor_units: 3500,
    inventory_status: "in-stock",
    hidden: true,
    hidden_reason: "owner",
    sort_order: 7,
    variants: [{ source_variant_id: "K1-v", label: "3.5g", price_minor_units: 3500, inventory_level: 4, medical: false, sort_order: 0 }],
    ...over,
  });
  const ours = (over: Partial<PlannedInjectedItem> = {}): PlannedInjectedItem => ({
    source_item_id: "K1",
    name: "Blue Dream 3.5g",
    product_name: "Blue Dream 3.5g",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds",
    category: "flower",
    filter_categories: ["flower"],
    pos_inventory_type: "Usable Marijuana",
    pos_inventory_category: "Flower",
    strain_type: "hybrid",
    strain_name: "Blue Dream",
    thc: "24.1%",
    cbd: null,
    total_thc_json: { type: "thc", value: "24.1", unit: "%" },
    total_cbd_json: null,
    compounds_json: [{ type: "thc", value: "24.1", unit: "%" }],
    servings_per_pack: null,
    mg_per_serving: null,
    package_thc_mg: null,
    package_cbd_mg: null,
    ratio_label: null,
    net_weight_grams: null,
    net_volume_ml: null,
    fact_provenance: { thc: "coa" },
    low_thc_liquid: null,
    unit_thc_mg: null,
    otherwise_taken: null,
    units_per_package: null,
    effects: null,
    aroma_notes: null,
    description: boilerplateDescription("Blue Dream", "Fairwinds"),
    price_label: "$99",
    price_minor_units: 9900,
    inventory_status: "unavailable",
    hidden: false,
    hidden_reason: null,
    sort_order: 0,
    variant: { source_variant_id: "K1-onboarded", label: "each", price_minor_units: 9900, inventory_level: 1, medical: true, sort_order: 0 },
    ...over,
  });

  // Kill switch
  ok(cardRefreshEnabled(undefined) && cardRefreshEnabled("on") && cardRefreshEnabled(""), "on by default");
  ok(!cardRefreshEnabled("off") && !cardRefreshEnabled(" OFF ") && !cardRefreshEnabled("0") && !cardRefreshEnabled("false") && !cardRefreshEnabled("no"), "off words");

  // Catalogue fields, mastering name
  const l1 = live();
  const before = JSON.parse(JSON.stringify(l1)) as StagedSnapshotItem;
  const ch = refreshLiveCard(l1, ours(), "Blue Dream");
  ok(l1.name === "Blue Dream", "mastering display name wins");
  ok(l1.product_name === "Blue Dream 3.5g" && l1.brand_name === "Fairwinds", "product name + brand ours");
  ok(l1.pos_inventory_category === "Flower" && l1.strain_name === "Blue Dream" && l1.strain_type === "hybrid", "type label, strain, strain type ours");
  ok(JSON.stringify(l1.filter_categories) === '["flower"]', "filter categories ours");
  // Facts: non-null ours wins; null never wipes
  ok(l1.thc === "24.1%" && (l1.total_thc_json as { value: string }).value === "24.1", "verified potency replaces Cultivera's");
  ok(l1.net_weight_grams === 3.5, "null net weight never wipes the live value");
  ok(l1.otherwise_taken === false, "null compliance answer never wipes a person's false");
  ok(JSON.stringify(l1.effects) === '["relaxed"]', "null effects never wipe");
  ok(l1.fact_provenance.thc === "coa", "provenance ours on top");
  // Description: placeholder never replaces real copy
  ok(l1.description === "Old Cultivera text", "placeholder description never replaces");
  // Protected
  for (const f of PROTECTED_FIELDS) {
    ok(JSON.stringify((l1 as unknown as Record<string, unknown>)[f]) === JSON.stringify((before as unknown as Record<string, unknown>)[f]), `protected ${f} untouched`);
  }
  ok(ch.some((c) => c.field === "name" && c.from === "BLUE DREAM 3.5G FW") && !ch.some((c) => c.field === "net_weight_grams"), "change list honest");

  // Name falls back to ours when the mastering rule is unsure
  const l2 = live();
  refreshLiveCard(l2, ours(), null);
  ok(l2.name === "Blue Dream 3.5g", "unsure mastering name -> our draft name");
  // Blank ours never blanks live
  const l3 = live();
  refreshLiveCard(l3, ours({ brand_name: "  ", strain_name: null, pos_inventory_category: null }), null);
  ok(l3.brand_name === "FW" && l3.pos_inventory_category === null && l3.strain_name === null, "blank ours keeps live");
  ok(l3.brand_name === "FW", "blank brand kept");
  // unknown strain type never replaces
  const l4 = live({ strain_type: "indica" });
  refreshLiveCard(l4, ours({ strain_type: "unknown" }), null);
  ok(l4.strain_type === "indica", "unknown never replaces a known strain type");
  // Real description replaces
  const l5 = live();
  refreshLiveCard(l5, ours({ description: "  Sweet berry, calm finish.  " }), null);
  ok(l5.description === "Sweet berry, calm finish.", "real copy replaces (trimmed)");
  // Extra live shelf kept
  const l6 = live({ category: "preroll", filter_categories: ["preroll", "preroll-pack"] });
  refreshLiveCard(l6, ours({ category: "preroll", filter_categories: ["preroll"] }), null);
  ok(JSON.stringify(l6.filter_categories) === '["preroll","preroll-pack"]', "extra live shelf kept");
  // Empty compounds never wipe
  const l7 = live({ compounds_json: [{ type: "cbg", value: "2", unit: "mg" }] });
  refreshLiveCard(l7, ours({ compounds_json: [] }), null);
  ok((l7.compounds_json as unknown[]).length === 1, "empty compounds never wipe");
  // Empty effects list never wipes
  const l8 = live();
  refreshLiveCard(l8, ours({ effects: [] }), null);
  ok(JSON.stringify(l8.effects) === '["relaxed"]', "empty effects never wipe");
  // Our non-null false compliance answer applies
  const l9 = live({ otherwise_taken: null });
  refreshLiveCard(l9, ours({ otherwise_taken: true, units_per_package: 10 }), null);
  ok(l9.otherwise_taken === true && l9.units_per_package === 10, "our answered compliance flags apply");
  // Idempotent: second refresh changes nothing
  const l10 = live();
  refreshLiveCard(l10, ours(), "Blue Dream");
  ok(refreshLiveCard(l10, ours(), "Blue Dream").length === 0, "idempotent");

  // Plan
  const items = [live(), live({ source_item_id: "K2", name: "Other" })];
  const snapshotBefore = JSON.stringify(items[1]);
  const p = planRebuiltCardRefresh({
    items,
    ours: [ours(), ours({ source_item_id: "GONE", name: "Gone 1g" })],
    displayNameOf: () => "Blue Dream",
  });
  ok(p.refreshed.length === 1 && p.refreshed[0] === "K1", "refreshed listed");
  ok(p.notLive.length === 1 && p.notLive[0] === "GONE", "not-live listed");
  ok(items.length === 2 && !items.some((i) => i.source_item_id === "GONE"), "never injects a card");
  ok(JSON.stringify(items[1]) === snapshotBefore, "other cards untouched");
  ok(p.diagnostics.some((d) => d.code === REFRESH_DIAG.notLive && d.severity === "warning"), "not-live warned");
  ok(p.diagnostics.some((d) => d.code === REFRESH_DIAG.refreshed && /price, sizes and visibility unchanged/.test(d.message)), "refresh note says what stays");
  ok((p.changesByKey.get("K1") ?? []).length > 0, "changes kept per key");
  const p2 = planRebuiltCardRefresh({ items, ours: [ours()], displayNameOf: () => "Blue Dream" });
  ok(p2.unchanged[0] === "K1" && p2.refreshed.length === 0, "second plan: unchanged");
  // First duplicate key wins (a published version is unique per key; never trust)
  const dupItems = [live({ name: "first" }), live({ name: "second" })];
  planRebuiltCardRefresh({ items: dupItems, ours: [ours()], displayNameOf: () => "X" });
  ok(dupItems[0].name === "X" && dupItems[1].name === "second", "first duplicate refreshed only");

  return { passed, failed };
}
