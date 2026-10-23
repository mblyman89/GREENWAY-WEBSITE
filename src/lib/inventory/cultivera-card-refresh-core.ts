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
 *   - description: ours when it is real copy, or when the live one is blank
 *     or a placeholder (real live copy is never replaced by the placeholder);
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
import {
  buildIntakeStagedVersionPlan,
  type CarryForwardItem,
  type IntakeStagingPlan,
  type StagedSnapshotItem,
} from "@/lib/pos/intake-menu-staging-core";
import {
  buildDraftInjectionPlan,
  type ApprovedDraftForInjection,
  type DraftEnrichment,
  type PlannedInjectedItem,
  type InjectionDiagnostic,
} from "@/lib/pos/draft-injection-core";
import { lotFactsFromInjected, masteredSingletonText } from "@/lib/pos/intake-mastering-core";
import { boilerplateDescription, isBoilerplateDescription } from "@/lib/catalog/golden-record-core";

/** Kill switch: `off` restores the S3 behaviour (approval catalogues only, no card refresh). */
export const CARD_REFRESH_ENV = "CULTIVERA_CARD_REFRESH";
export function cardRefreshEnabled(raw: string | undefined | null): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "false" || v === "0" || v === "no" || v === "disabled");
}

/**
 * Onboarding row copy beside Approve on a rebuilt draft. With the switch on,
 * approving rebuilds the live card from our onboarding (prices, sizes and
 * visibility stay). Off: the S3 rule (approval does not touch the menu).
 */
export function cultiveraApproveCopy(livePriceLabel: string, envRaw: string | undefined | null): string {
  return cardRefreshEnabled(envRaw)
    ? `Live price ${livePriceLabel}; approving keeps it and rebuilds the live card from this onboarding (sizes and visibility unchanged).`
    : `Live price ${livePriceLabel}; approving keeps it and does not change the menu.`;
}

/** The manifest kind whose approvals refresh live cards (the rebuilt Cultivera manifests only). */
export const REFRESH_MANIFEST_KIND = "cultivera-reconstructed";

/**
 * True when approving a draft on a manifest of `kind` should run the staging
 * pipeline in refresh mode. Only a manifest rebuilt from the Cultivera export,
 * and only while the switch is on. The POS-import migration manifest keeps the
 * S3 rule (catalogue only).
 */
export function refreshStagingForKind(kind: unknown, envRaw: string | undefined | null): boolean {
  return kind === REFRESH_MANIFEST_KIND && cardRefreshEnabled(envRaw);
}

/**
 * The native builder refuses a draft with no approved price (an ordinary
 * product cannot go live unpriced). A rebuilt draft may be approved with no
 * price, because its card's sizes have different live prices (S3 rule). The
 * refresh never reads a price: price, label and sizes are PROTECTED_FIELDS and
 * stay the live ones. So the builder is given this placeholder only to get
 * past its price check, and the placeholder can never reach a card.
 */
export const REFRESH_PRICE_PLACEHOLDER = 1;

export type RebuiltRefreshStagingPlan = IntakeStagingPlan & { refresh: CardRefreshPlan };

/**
 * The staging plan for a rebuilt manifest ("refresh, never inject"):
 *   1. carry the WHOLE live menu forward (the native carry step, no drafts);
 *   2. build our card for every approved draft with the native builder
 *      (`buildDraftInjectionPlan`, with no existing keys so every draft is
 *      built, and every diagnostic it raises passes through: fact flags,
 *      caps, unmapped category);
 *   3. overlay each built card onto its live card (`planRebuiltCardRefresh`).
 *      No new cards and no mastering merges;
 *   4. lot facts: the same golden-record bundle as mastering (`lotFactsFromInjected`).
 * hasChanges = at least one live card actually changed.
 */
export function buildRebuiltRefreshStagingPlan(inputs: {
  publishedItems: CarryForwardItem[];
  approvedDrafts: ApprovedDraftForInjection[];
  enrichmentByDraftId: Map<string, DraftEnrichment>;
}): RebuiltRefreshStagingPlan {
  const base = buildIntakeStagedVersionPlan({
    publishedItems: inputs.publishedItems,
    approvedDrafts: [],
    enrichmentByDraftId: inputs.enrichmentByDraftId,
  });
  const injection = buildDraftInjectionPlan({
    drafts: inputs.approvedDrafts.map((d) =>
      d.price_minor_units != null && d.price_minor_units > 0 ? d : { ...d, price_minor_units: REFRESH_PRICE_PLACEHOLDER },
    ),
    existingKeys: new Set<string>(),
    enrichmentByDraftId: inputs.enrichmentByDraftId,
    baseSortOrder: 0,
  });
  // Mastering's singleton text (display name + placeholder rebuilt with it),
  // so the rebuilt card reads exactly like a received one.
  const ours = injection.items.map((it) => ({ ...it, ...masteredSingletonText(it) }));
  const refresh = planRebuiltCardRefresh({
    items: base.items,
    ours,
    displayNameOf: (it) => it.name,
  });
  return {
    items: base.items,
    carriedCount: base.carriedCount,
    addedCount: 0,
    mergedCount: 0,
    hasChanges: refresh.refreshed.length > 0,
    diagnostics: [...injection.diagnostics, ...refresh.diagnostics],
    lotFactsByKey: lotFactsFromInjected(injection.items),
    // R50 A1: a refresh never adds or merges a card, so no alias can apply.
    unmatchedIdentities: [],
    refresh,
  };
}

/** manifest_events.event_type when approvals rebuilt live Cultivera cards. */
export const REFRESH_EVENT = "cultivera_cards_refreshed";

/** The timeline note for a refresh (what changed, what did not, plainly). */
export function refreshEventNote(p: { refreshed: number; notLive: number; published: boolean; released?: number }): string {
  const n = Math.max(0, Math.floor(p.refreshed));
  const what = n === 1 ? "1 live card was" : `${n} live cards were`;
  const where = p.published ? "The update is live." : "The update is waiting on Admin \u2192 Publish Menu.";
  const missing =
    p.notLive > 0
      ? ` ${p.notLive === 1 ? "1 approved product is" : `${p.notLive} approved products are`} not on the live menu, so nothing was added for ${p.notLive === 1 ? "it" : "them"}.`
      : "";
  // R74 S17: when a held card was released in the same update, visibility DID change (said in its own note).
  const unchanged = (p.released ?? 0) > 0 ? "Prices, sizes and stock did not change." : "Prices, sizes, stock and visibility did not change.";
  return `${what} rebuilt from your onboarding (received via Cultivera): name, type, strain and verified facts now come from our records. ${unchanged} ${where}${missing}`;
}

/**
 * The timeline note when a product's refresh was withheld. Unlike a received
 * delivery (where the product is kept OFF the menu), a Cultivera card is
 * already selling, so it simply keeps its current card.
 */
export function refreshWithheldNote(n: number, published: boolean): string {
  const count = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  const what = count === 1 ? "1 product from Cultivera keeps" : `${count} products from Cultivera keep`;
  const lead = published ? "The menu update published. " : "No menu update was needed. ";
  return `${lead}${what} its current card (still on sale) because a fact could not be verified \u2014 set the facts on Product Onboarding \u2192 Approved and the card is rebuilt.`;
}

/** The lot fact columns the staging writes (LotFactBundle, minus provenance). */
export const LOT_FACT_COLUMNS = [
  "servings_per_pack",
  "mg_per_serving",
  "package_thc_mg",
  "package_cbd_mg",
  "ratio_label",
  "net_weight_grams",
  "net_volume_ml",
] as const;

/**
 * The inventory_lots update for a rebuilt lot, by the same survivorship rule
 * as the card: only NON-null facts are written (a null never wipes a fact the
 * import, a COA or a person set), minors only when present, and provenance is
 * merged onto the lot's existing provenance (ours on top). Returns null when
 * there is nothing to write. Never names status, qty, cost or CCRS columns.
 */
export function refreshLotFactPatch(
  bundle: {
    servings_per_pack: number | null;
    mg_per_serving: number | null;
    package_thc_mg: number | null;
    package_cbd_mg: number | null;
    ratio_label: string | null;
    net_weight_grams: number | null;
    net_volume_ml: number | null;
    fact_provenance: Record<string, string>;
    minor_cannabinoids_json?: unknown[];
  },
  existingProvenance: unknown,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const src = bundle as unknown as Record<string, unknown>;
  for (const c of LOT_FACT_COLUMNS) {
    if (src[c] !== null && src[c] !== undefined) patch[c] = src[c];
  }
  if (Array.isArray(bundle.minor_cannabinoids_json) && bundle.minor_cannabinoids_json.length > 0) {
    patch.minor_cannabinoids_json = bundle.minor_cannabinoids_json;
  }
  if (Object.keys(patch).length === 0) return null;
  const prior =
    existingProvenance && typeof existingProvenance === "object" && !Array.isArray(existingProvenance)
      ? (existingProvenance as Record<string, unknown>)
      : {};
  const ours: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    if (bundle.fact_provenance && bundle.fact_provenance[k] !== undefined) ours[k] = bundle.fact_provenance[k];
  }
  patch.fact_provenance = { ...prior, ...ours };
  return patch;
}

/** The version-notes suffix: how many live cards were rebuilt. */
export function refreshNotesSuffix(refreshed: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(refreshed) ? refreshed : 0));
  if (n === 0) return "";
  return ` ${n === 1 ? "1 live card" : `${n} live cards`} rebuilt from onboarding (received via Cultivera); prices, sizes and visibility unchanged.`;
}

/** The fields the refresh may write, by rule (exported so tests pin the list). */
export const CATALOGUE_TEXT_FIELDS = [
  "name",
  "product_name",
  "brand_name",
  "vendor_name",
  "category",
  "pos_inventory_type",
  "strain_name",
] as const;

/** Catalogue fields OUR rule decides even when the answer is "none" (null is a decision here). */
export const DECIDED_NULLABLE_FIELDS = ["pos_inventory_category"] as const;

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

function sortedKeys(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

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

  // The live card's OLD primary shelf (Cultivera's guess) is never kept as an "extra".
  const oldCategory = live.category;
  for (const f of CATALOGUE_TEXT_FIELDS) {
    const v = f === "name" ? (displayName ?? ours.name) : src[f];
    if (!blank(v)) set(f, typeof v === "string" ? v.trim() : v);
  }
  if (Array.isArray(ours.filter_categories) && ours.filter_categories.length > 0 && !blank(ours.category)) {
    // Keep any extra shelf the live card already had (e.g. a merged pack size), ours first.
    const merged = [...ours.filter_categories];
    for (const c of live.filter_categories ?? []) if (c && c !== live.category && c !== oldCategory && !merged.includes(c)) merged.push(c);
    set("filter_categories", merged);
  }
  // The type label is OUR house-type decision (labeler >= its confidence bar,
  // or the approver's pick). When we decided "no confident type", the received
  // card shows our category label (cardTypeLabel's fallback), so the rebuilt
  // card must too: Cultivera's raw label is cleared, never kept as if verified.
  for (const f of DECIDED_NULLABLE_FIELDS) {
    const v = src[f];
    set(f, blank(v) ? null : typeof v === "string" ? v.trim() : v);
  }
  if (knownStrainType(ours.strain_type)) set("strain_type", ours.strain_type);
  // Description: our real copy always wins; our placeholder sentence wins only
  // over a live description that is itself blank or a placeholder (a received
  // card prints the placeholder too). Real live copy is never replaced by it.
  if (!isBoilerplateDescription(ours.description) || isBoilerplateDescription(live.description)) {
    if (!blank(ours.description)) set("description", ours.description.trim());
  }
  for (const f of FACT_FIELDS) {
    const v = src[f];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    set(f, v);
  }
  if (Array.isArray(ours.compounds_json) && ours.compounds_json.length > 0) set("compounds_json", ours.compounds_json);
  // Provenance: a field we just rewrote no longer comes from where the live
  // card said it did, so its old provenance is dropped; ours goes on top.
  const rewritten = new Set(changes.map((c) => c.field));
  const prov: Record<string, string> = {};
  for (const [k, v] of Object.entries(live.fact_provenance ?? {})) if (!rewritten.has(k)) prov[k] = v;
  Object.assign(prov, ours.fact_provenance ?? {});
  if (!sameValue(sortedKeys(prov), sortedKeys(live.fact_provenance ?? {}))) set("fact_provenance", prov);
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
  ok(!cardRefreshEnabled("disabled") && !cardRefreshEnabled(" Disabled "), "off word disabled (ledger convention)");

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
  // Type label: our "no confident type" clears Cultivera's raw label (the menu then shows our category label)
  const l3b = live({ pos_inventory_category: "EDIBLE" });
  refreshLiveCard(l3b, ours({ pos_inventory_category: null }), null);
  ok(l3b.pos_inventory_category === null, "type label: our null decision clears Cultivera's raw label");
  const l3c = live({ pos_inventory_category: "EDIBLE" });
  refreshLiveCard(l3c, ours({ pos_inventory_category: "  Gummies " }), null);
  ok(l3c.pos_inventory_category === "Gummies", "type label: ours, trimmed");
  // Provenance of a rewritten field is dropped (it described the old value); others kept
  const l3d = live({ fact_provenance: { thc: "cultivera", net_weight_grams: "human" } });
  refreshLiveCard(l3d, ours({ fact_provenance: {} }), null);
  ok(l3d.fact_provenance.thc === undefined && l3d.fact_provenance.net_weight_grams === "human", "provenance: stale entry dropped, untouched field kept");
  ok(l3.brand_name === "FW", "blank brand kept");
  // unknown strain type never replaces
  const l4 = live({ strain_type: "indica" });
  refreshLiveCard(l4, ours({ strain_type: "unknown" }), null);
  ok(l4.strain_type === "indica", "unknown never replaces a known strain type");
  // Real description replaces
  const l5 = live();
  refreshLiveCard(l5, ours({ description: "  Sweet berry, calm finish.  " }), null);
  ok(l5.description === "Sweet berry, calm finish.", "real copy replaces (trimmed)");
  const l5b = live({ description: "" });
  refreshLiveCard(l5b, ours(), null);
  ok(l5b.description === boilerplateDescription("Blue Dream", "Fairwinds"), "blank live description takes our placeholder (as a received card)");
  const l5c = live({ description: boilerplateDescription("BLUE DREAM 3.5G FW", "FW") });
  refreshLiveCard(l5c, ours(), null);
  ok(l5c.description === boilerplateDescription("Blue Dream", "Fairwinds"), "an old placeholder is replaced by ours");
  const l5d = live({ description: "" });
  refreshLiveCard(l5d, ours({ description: "   " }), null);
  ok(l5d.description === "", "blank ours never writes");
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

  // Old Cultivera primary shelf is never kept as an extra
  const l11 = live({ category: "preroll", filter_categories: ["preroll", "preroll-pack"] });
  refreshLiveCard(l11, ours({ category: "flower", filter_categories: ["flower"] }), null);
  ok(JSON.stringify(l11.filter_categories) === '["flower","preroll-pack"]', "old primary shelf dropped, extra shelf kept");

  // Kind + switch
  ok(refreshStagingForKind("cultivera-reconstructed", undefined), "rebuilt manifest refreshes by default");
  ok(!refreshStagingForKind("cultivera-reconstructed", "off"), "switch off = S3 behaviour");
  ok(!refreshStagingForKind("pos-import-migration", undefined), "POS-import migration manifest keeps S3 rule");
  ok(!refreshStagingForKind("wcia", undefined) && !refreshStagingForKind(null, undefined), "ordinary kinds never refresh");
  ok(refreshNotesSuffix(0) === "" && /^ 2 live cards rebuilt/.test(refreshNotesSuffix(2)) && /^ 1 live card rebuilt/.test(refreshNotesSuffix(1)), "notes suffix");

  // End to end through the NATIVE builder (no mocks)
  const carried = (key: string, over: Partial<CarryForwardItem> = {}): CarryForwardItem => ({
    source_item_id: key,
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
    thc: "19%",
    cbd: null,
    total_thc_json: { type: "thc", value: "19", unit: "%" },
    total_cbd_json: null,
    compounds_json: [],
    description: "Cultivera text",
    price_label: "$30",
    price_minor_units: 3000,
    inventory_status: "available",
    hidden: false,
    hidden_reason: null,
    variants: [{ source_variant_id: `${key}-v1`, label: "3.5g", price_minor_units: 3000, inventory_level: 12, medical: false }],
    ...over,
  });
  const draft = (key: string | null, over: Partial<ApprovedDraftForInjection> = {}): ApprovedDraftForInjection => ({
    id: `d-${key}`,
    pos_product_key: key,
    name: "Blue Dream 3.5g",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds",
    strain_name: "Blue Dream",
    thc_pct: 24.1,
    cbd_pct: null,
    total_thc_pct: 24.1,
    potency_json: null,
    price_minor_units: null,
    updated_at: "2026-10-13T00:00:00Z",
    inventory_type: "Usable Marijuana",
    ...over,
  });
  const enrich = new Map<string, DraftEnrichment>([
    ["d-A", { websiteCategory: "flower", strainType: "hybrid", onHandQty: 12, packageLabel: "3.5g" }],
    ["d-NEW", { websiteCategory: "flower", strainType: null, onHandQty: 5, packageLabel: "1g" }],
    ["d-null", { websiteCategory: "flower", strainType: null, onHandQty: 1, packageLabel: null }],
  ]);
  const pub = [carried("A"), carried("B", { name: "Other card" })];
  const pubBefore = JSON.stringify(pub);
  const e2e = buildRebuiltRefreshStagingPlan({
    publishedItems: pub,
    approvedDrafts: [draft("A"), draft("NEW"), draft(null)],
    enrichmentByDraftId: enrich,
  });
  ok(JSON.stringify(pub) === pubBefore, "e2e: published input never mutated");
  ok(e2e.items.length === 2 && e2e.carriedCount === 2 && e2e.addedCount === 0 && e2e.mergedCount === 0, "e2e: no new cards, no merges");
  ok(e2e.hasChanges && e2e.refresh.refreshed[0] === "A", "e2e: the approved card refreshed");
  const a = e2e.items.find((i) => i.source_item_id === "A")!;
  ok(a.thc !== "19%" && a.thc !== null && /24/.test(String(a.thc)), "e2e: our potency replaces Cultivera's");
  ok(a.strain_type === "hybrid" && a.strain_name === "Blue Dream", "e2e: strain facts ours");
  ok(a.vendor_name === "Fairwinds" && a.brand_name === "Fairwinds", "e2e: brand ours");
  ok(a.description === "Cultivera text", "e2e: boilerplate never replaces copy");
  ok(a.price_minor_units === 3000 && a.price_label === "$30", "e2e: live price kept (placeholder never reaches the card)");
  ok(JSON.stringify(a.variants) === JSON.stringify([{ source_variant_id: "A-v1", label: "3.5g", price_minor_units: 3000, inventory_level: 12, medical: false, sort_order: 0 }]), "e2e: sizes untouched");
  ok(a.hidden === false && a.inventory_status === "available" && a.origin === "carried" && a.sort_order === 0, "e2e: visibility, stock, order, origin untouched");
  ok(JSON.stringify(e2e.items[1]) === JSON.stringify(buildIntakeStagedVersionPlan({ publishedItems: [pub[1]], approvedDrafts: [], enrichmentByDraftId: new Map() }).items[0]).replace('"sort_order":0,"variants"', '"sort_order":1,"variants"'), "e2e: other card identical to a plain carry");
  ok(e2e.refresh.notLive.includes("NEW"), "e2e: a key not live is reported");
  ok(e2e.diagnostics.some((d) => d.code === "draft_inject_no_pos_key"), "e2e: native diagnostics pass through");
  ok(!e2e.items.some((i) => i.price_minor_units === REFRESH_PRICE_PLACEHOLDER), "e2e: placeholder price on no card");
  const none = buildRebuiltRefreshStagingPlan({ publishedItems: e2e.items as unknown as CarryForwardItem[], approvedDrafts: [draft("A")], enrichmentByDraftId: enrich });
  ok(!none.hasChanges && none.refresh.unchanged[0] === "A", "e2e: re-staging an already refreshed card = no changes");
  const priced = buildRebuiltRefreshStagingPlan({ publishedItems: pub, approvedDrafts: [draft("A", { price_minor_units: 9999 })], enrichmentByDraftId: enrich });
  ok(priced.items[0].price_minor_units === 3000, "e2e: a recorded price never re-prices the live card");

  // Lot fact patch (survivorship on the golden record)
  const bundle = {
    servings_per_pack: 10,
    mg_per_serving: null,
    package_thc_mg: 100,
    package_cbd_mg: null,
    ratio_label: null,
    net_weight_grams: null,
    net_volume_ml: null,
    fact_provenance: { servings_per_pack: "manifest", package_thc_mg: "coa", mg_per_serving: "engine" },
  };
  const lp = refreshLotFactPatch(bundle, { net_weight_grams: "cultivera", package_thc_mg: "old" })!;
  ok(lp.servings_per_pack === 10 && lp.package_thc_mg === 100, "lot patch: verified facts written");
  ok(!("mg_per_serving" in lp) && !("net_weight_grams" in lp) && !("ratio_label" in lp), "lot patch: null never wipes");
  const lprov = lp.fact_provenance as Record<string, string>;
  ok(lprov.net_weight_grams === "cultivera" && lprov.package_thc_mg === "coa" && lprov.servings_per_pack === "manifest", "lot patch: provenance merged, ours on top");
  ok(!("mg_per_serving" in lprov), "lot patch: no provenance for an unwritten field");
  ok(!Object.keys(lp).some((k) => /status|qty|cost|ccrs/.test(k)), "lot patch: never stock, cost or CCRS");
  ok(refreshLotFactPatch({ ...bundle, servings_per_pack: null, package_thc_mg: null }, null) === null, "lot patch: nothing to write = null");
  const lm = refreshLotFactPatch({ ...bundle, servings_per_pack: null, package_thc_mg: null, minor_cannabinoids_json: [{ type: "cbg", value: "5", unit: "mg" }] }, "garbage")!;
  ok(Array.isArray(lm.minor_cannabinoids_json) && JSON.stringify(lm.fact_provenance) === "{}", "lot patch: minors alone; bad prior provenance ignored");

  // Notes
  ok(/^1 live card was rebuilt/.test(refreshEventNote({ refreshed: 1, notLive: 0, published: true })) && /Prices, sizes, stock and visibility did not change/.test(refreshEventNote({ refreshed: 1, notLive: 0, published: true })), "event note");
  ok(
    !/visibility/.test(refreshEventNote({ refreshed: 1, notLive: 0, published: true, released: 1 })) &&
      /Prices, sizes and stock did not change/.test(refreshEventNote({ refreshed: 1, notLive: 0, published: true, released: 1 })),
    "event note: R74 S17 a released card means visibility DID change",
  );
  ok(/waiting on Admin/.test(refreshEventNote({ refreshed: 2, notLive: 1, published: false })) && /1 approved product is not on the live menu/.test(refreshEventNote({ refreshed: 2, notLive: 1, published: false })), "event note: waiting + not live");
  ok(/still on sale/.test(refreshWithheldNote(1, true)) && !/kept off/.test(refreshWithheldNote(3, true)), "withheld note never says kept off");
  ok(/^The menu update published\. 1 product/.test(refreshWithheldNote(1, true)) && /^No menu update was needed\. 2 products/.test(refreshWithheldNote(2, false)), "withheld note: published vs nothing staged");

  ok(cultiveraApproveCopy("$30.00", undefined).includes("rebuilds the live card"), "approve copy: on by default");
  ok(cultiveraApproveCopy("$30.00", "off") === "Live price $30.00; approving keeps it and does not change the menu.", "approve copy: switch off keeps S3 wording");
  return { passed, failed };
}
