/**
 * src/lib/products/mastered-menu-core.ts   (bible S35 — Data-rich Product Masters page)
 *
 * PURE. Answers "what is actually mastered on my live menu?" from the
 * PUBLISHED version's cards and sizes (menu_items + menu_variants), which is
 * what customers see. No I/O, no clock: the store hands in rows, this file
 * shapes them.
 *
 * HONESTY RULES (F-128, standing rule "never guess"):
 *   - Hidden cards are excluded: they are not on the menu.
 *   - Money stays in cents (minor units) until the page formats it.
 *   - menu_variants.inventory_level is `int not null default 0` (0001), so a
 *     stored 0 is a real stored value and is shown as 0. A size whose level
 *     is not a finite number is UNKNOWN (null) and is never summed as 0: a
 *     card total is null as soon as one size is unknown.
 *   - identity_key is NOT fetched by the full-menu loaders
 *     (MENU_ITEM_DROPPED_COLUMNS); it is null here unless the store read it
 *     opt-in, and the page says "not available" rather than inventing one.
 *   - "Lots feeding this card" are the `<lotKey>-onboarded` size ids that
 *     intake mastering writes (enrichment-manifest-core.ts:24). A size
 *     without that suffix came from the POS import. Nothing is inferred
 *     beyond that encoding.
 *   - Intake mastering joins restocks by vendor + category + product family
 *     and does NOT read product_masters (F-096); MANUAL_MASTER_RULE says so.
 */
import { sortVariantsBySize } from "@/lib/menu/variant-sort";

/** The intake-mastering rule in one sentence (bible S35.4). */
export const MANUAL_MASTER_RULE =
  "Receiving already joins restocks to the live card with the same vendor, category and product family. Manual masters on this page do not change that rule.";

/** Page subtitle (bible S35.4). */
export const MASTERS_SUBTITLE = "What is mastered on your live menu today, and suggestions for what should be.";

/** Size-id suffix intake mastering writes for a restock lot (= lot-link-core SIZE_ID_SUFFIX). */
export const ONBOARDED_SUFFIX = "-onboarded";

/** Rows per page on the Live cards tab (ListPager; never an unbounded table). */
export const LIVE_CARDS_PAGE_SIZE = 50;

export type MasteredItemInput = {
  source_item_id: string;
  name: string;
  product_name: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  hidden: boolean;
  identity_key?: string | null;
  variants: readonly {
    source_variant_id: string;
    label: string;
    price_minor_units: number;
    inventory_level: number | null;
    medical: boolean;
  }[];
};

export type MasteredSize = {
  label: string;
  priceMinor: number;
  /** Stored on-hand for this size; null only when the stored value is not a number. */
  onHand: number | null;
  medical: boolean;
  /** The restock lot key when this size came from intake mastering, else null (POS import). */
  lotKey: string | null;
};

export type Market = "adult" | "medical" | "both";

export type MasteredCard = {
  key: string;
  name: string;
  vendor: string | null;
  brand: string | null;
  category: string | null;
  /** null when the card has no sizes (nothing to read the market from). */
  market: Market | null;
  identityKey: string | null;
  sizes: MasteredSize[];
  /** [min, max] cents across sizes; null when the card has no sizes. */
  priceRangeMinor: [number, number] | null;
  /** Sum of size stock; null when any size's stock is unknown or there are no sizes. */
  totalOnHand: number | null;
  /** Restock lot keys feeding this card (from `-onboarded` size ids), de-duplicated, sorted. */
  lotKeys: string[];
};

export type MasteredStats = {
  cards: number;
  multiSize: number;
  singleSize: number;
  noSize: number;
  sizes: number;
  medicalOnly: number;
};

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

function stockOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The restock lot key encoded in a size id, or null. A bare suffix is not a key. */
export function lotKeyFromSizeId(sizeId: string | null | undefined): string | null {
  const s = (sizeId ?? "").trim();
  if (!s.endsWith(ONBOARDED_SUFFIX)) return null;
  return clean(s.slice(0, -ONBOARDED_SUFFIX.length));
}

export function marketOf(sizes: readonly { medical: boolean }[]): Market | null {
  if (sizes.length === 0) return null;
  const med = sizes.filter((s) => s.medical).length;
  if (med === 0) return "adult";
  if (med === sizes.length) return "medical";
  return "both";
}

export function marketLabel(m: Market | null): string {
  if (m === "medical") return "Medical only";
  if (m === "both") return "Adult + medical";
  if (m === "adult") return "Adult use";
  return "No sizes";
}

/** One live card → its summary row. */
export function summarizeCard(item: MasteredItemInput): MasteredCard {
  const ordered = sortVariantsBySize(
    item.variants.map((v) => ({ v, label: v.label, priceMinorUnits: v.price_minor_units })),
  );
  const sizes: MasteredSize[] = ordered.map(({ v }) => ({
    label: v.label,
    priceMinor: v.price_minor_units,
    onHand: stockOf(v.inventory_level),
    medical: v.medical === true,
    lotKey: lotKeyFromSizeId(v.source_variant_id),
  }));
  const prices = sizes.map((s) => s.priceMinor);
  const priceRangeMinor: [number, number] | null =
    prices.length > 0 ? [Math.min(...prices), Math.max(...prices)] : null;
  const totalOnHand =
    sizes.length > 0 && sizes.every((s) => s.onHand !== null)
      ? sizes.reduce((sum, s) => sum + (s.onHand as number), 0)
      : null;
  const lotKeys = [...new Set(sizes.map((s) => s.lotKey).filter((k): k is string => k !== null))].sort();
  return {
    key: item.source_item_id,
    name: clean(item.product_name) ?? clean(item.name) ?? item.source_item_id,
    vendor: clean(item.vendor_name),
    brand: clean(item.brand_name),
    category: clean(item.category),
    market: marketOf(sizes),
    identityKey: clean(item.identity_key ?? null),
    sizes,
    priceRangeMinor,
    totalOnHand,
    lotKeys,
  };
}

/**
 * Every VISIBLE live card, summarised, most sizes first, then name
 * (case-insensitive), then key (a stable total order).
 */
export function summarizeMasteredCards(items: readonly MasteredItemInput[]): MasteredCard[] {
  return items
    .filter((i) => i.hidden !== true)
    .map(summarizeCard)
    .sort(
      (a, b) =>
        b.sizes.length - a.sizes.length ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
        a.key.localeCompare(b.key),
    );
}

export function masteredStats(rows: readonly MasteredCard[]): MasteredStats {
  let multiSize = 0;
  let singleSize = 0;
  let noSize = 0;
  let sizes = 0;
  let medicalOnly = 0;
  for (const r of rows) {
    sizes += r.sizes.length;
    if (r.sizes.length >= 2) multiSize += 1;
    else if (r.sizes.length === 1) singleSize += 1;
    else noSize += 1;
    if (r.market === "medical") medicalOnly += 1;
  }
  return { cards: rows.length, multiSize, singleSize, noSize, sizes, medicalOnly };
}

// ---------------------------------------------------------------------------
// Live cards filter (?show=) — default "all" so nothing is hidden by default.
// ---------------------------------------------------------------------------
export type LiveCardsFilter = "all" | "multi" | "single";

export const LIVE_CARD_FILTERS: readonly { key: LiveCardsFilter; label: string }[] = [
  { key: "all", label: "All cards" },
  { key: "multi", label: "Multi-size" },
  { key: "single", label: "Single size" },
];

export function parseLiveCardsFilter(raw: unknown): LiveCardsFilter {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return s === "multi" || s === "single" ? s : "all";
}

export function filterCards(rows: readonly MasteredCard[], f: LiveCardsFilter): MasteredCard[] {
  if (f === "multi") return rows.filter((r) => r.sizes.length >= 2);
  if (f === "single") return rows.filter((r) => r.sizes.length === 1);
  return [...rows];
}

/**
 * `/admin/products/masters?tab=live&show=…&page=…` keeping back=. Defaults
 * are omitted. `back` is carried verbatim, exactly as the tab strip carries
 * it (PageTabs keep={{ back }}): on this page it is the query string the
 * BackLink restores, and BackLink's backHref() is what sanitises it.
 */
export function liveCardsHref(base: string, f: LiveCardsFilter, page: number, back?: string | null): string {
  const qs = new URLSearchParams({ tab: "live" });
  if (f !== "all") qs.set("show", f);
  if (page > 1) qs.set("page", String(page));
  const b = (back ?? "").trim();
  if (b) qs.set("back", b);
  return `${base}?${qs.toString()}`;
}

// ---------------------------------------------------------------------------
// Manual masters: each member shown with the live card's columns.
// ---------------------------------------------------------------------------
export type MasterMemberInput = { master_id: string; pos_product_key: string; variant_label: string | null; sort_order: number };

export type MasterMemberView = {
  key: string;
  variantLabel: string | null;
  /** The live card for this key, or null when the key is not on the published menu. */
  card: MasteredCard | null;
};

/** Group members by master, in sort_order then key, each joined to its live card (or null). */
export function masterMemberViews(
  members: readonly MasterMemberInput[],
  cardsByKey: ReadonlyMap<string, MasteredCard>,
): Map<string, MasterMemberView[]> {
  const out = new Map<string, MasterMemberView[]>();
  const sorted = [...members].sort((a, b) => a.sort_order - b.sort_order || a.pos_product_key.localeCompare(b.pos_product_key));
  for (const m of sorted) {
    const list = out.get(m.master_id) ?? [];
    list.push({ key: m.pos_product_key, variantLabel: clean(m.variant_label), card: cardsByKey.get(m.pos_product_key) ?? null });
    out.set(m.master_id, list);
  }
  return out;
}

/** Which manual master (if any) lists each live key — shown on the card, never used to group. */
export function manualMasterByKey(
  members: readonly MasterMemberInput[],
  masterNames: ReadonlyMap<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of members) {
    const name = masterNames.get(m.master_id);
    if (name) out.set(m.pos_product_key, name);
  }
  return out;
}

/** The inventory search for a restock lot key (store.ts listLots matches pos_product_key). */
export function lotSearchHref(lotKey: string): string {
  return `/admin/inventory?q=${encodeURIComponent(lotKey.trim())}`;
}

/** "$12.00" or "$12.00–$40.00"; "—" when no sizes. `fmt` is the page's money formatter. */
export function priceRangeLabel(r: [number, number] | null, fmt: (minor: number) => string): string {
  if (!r) return "—";
  return r[0] === r[1] ? fmt(r[0]) : `${fmt(r[0])}–${fmt(r[1])}`;
}

/** "12 on hand" / "Stock unknown" — never shows an unknown as 0. */
export function stockLabel(n: number | null): string {
  return n === null ? "Stock unknown" : `${n} on hand`;
}

// ---------------------------------------------------------------------------
// Self-tests — run via scripts/compliance/run-pure-selftests.ts
// ---------------------------------------------------------------------------
export function __runMasteredMenuCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      throw new Error(`mastered-menu-core: ${msg}`);
    }
  };
  const v = (id: string, label: string, price: number, level: number | null, medical = false) => ({
    source_variant_id: id,
    label,
    price_minor_units: price,
    inventory_level: level,
    medical,
  });
  const item = (over: Partial<MasteredItemInput> & { source_item_id: string }): MasteredItemInput => ({
    name: over.source_item_id,
    product_name: null,
    brand_name: "Brand",
    vendor_name: "Vendor",
    category: "flower",
    hidden: false,
    variants: [],
    ...over,
  });

  // lotKeyFromSizeId
  ok(lotKeyFromSizeId("LOT-1-onboarded") === "LOT-1", "lot key from onboarded size id");
  ok(lotKeyFromSizeId("pos-77") === null, "POS size id is not a lot");
  ok(lotKeyFromSizeId("-onboarded") === null, "bare suffix is not a key");
  ok(lotKeyFromSizeId(" LOT-2-onboarded ") === "LOT-2", "trimmed");
  ok(lotKeyFromSizeId(null) === null, "null size id");

  // sizes ordered by the ladder, not by input order
  const multi = summarizeCard(
    item({
      source_item_id: "K1",
      product_name: "Gelato",
      variants: [v("a", "7g", 4000, 3), v("LOT-9-onboarded", "1g", 1000, 5), v("c", "3.5g", 2500, 0)],
    }),
  );
  ok(multi.sizes.map((s) => s.label).join(",") === "1g,3.5g,7g", "sizes ordered by ladder");
  ok(multi.priceRangeMinor !== null && multi.priceRangeMinor[0] === 1000 && multi.priceRangeMinor[1] === 4000, "price range from sizes");
  ok(multi.totalOnHand === 8, "stored 0 is a real value and sums");
  ok(multi.sizes[1].onHand === 0, "stored 0 stays 0");
  ok(multi.lotKeys.length === 1 && multi.lotKeys[0] === "LOT-9", "lot keys from onboarded sizes");
  ok(multi.sizes[0].lotKey === "LOT-9" && multi.sizes[2].lotKey === null, "per-size lot key");
  ok(multi.name === "Gelato", "product_name preferred");
  ok(multi.market === "adult", "no medical sizes = adult");
  ok(multi.identityKey === null, "identity null when not read");

  // unknown stock is never summed as 0
  const unknown = summarizeCard(item({ source_item_id: "K2", variants: [v("a", "1g", 1000, 4), v("b", "2g", 1800, null)] }));
  ok(unknown.totalOnHand === null, "one unknown size → total unknown");
  ok(unknown.sizes[1].onHand === null, "unknown size stays null");
  const nan = summarizeCard(item({ source_item_id: "K2b", variants: [v("a", "1g", 1000, Number.NaN)] }));
  ok(nan.totalOnHand === null && nan.sizes[0].onHand === null, "NaN level is unknown, not 0");

  // no sizes
  const empty = summarizeCard(item({ source_item_id: "K3", name: "  ", product_name: null }));
  ok(empty.priceRangeMinor === null, "no sizes → no price range");
  ok(empty.totalOnHand === null, "no sizes → stock unknown");
  ok(empty.market === null, "no sizes → no market");
  ok(empty.name === "K3", "blank name falls back to key");

  // market
  ok(marketOf([{ medical: true }, { medical: true }]) === "medical", "all medical");
  ok(marketOf([{ medical: true }, { medical: false }]) === "both", "mixed market");
  ok(marketLabel("both") === "Adult + medical" && marketLabel(null) === "No sizes", "market labels");

  // identity read opt-in, blank vendor/brand cleaned
  const ident = summarizeCard(item({ source_item_id: "K4", identity_key: " v|flower|gelato ", vendor_name: " ", brand_name: null }));
  ok(ident.identityKey === "v|flower|gelato", "identity trimmed when present");
  ok(ident.vendor === null && ident.brand === null, "blank vendor/brand → null");

  // summarizeMasteredCards: hidden excluded, sort sizes desc → name → key
  const rows = summarizeMasteredCards([
    item({ source_item_id: "S1", name: "beta", variants: [v("a", "1g", 1, 1)] }),
    item({ source_item_id: "H1", name: "Hidden", hidden: true, variants: [v("a", "1g", 1, 1), v("b", "2g", 2, 1), v("c", "3g", 3, 1)] }),
    item({ source_item_id: "M1", name: "Zeta", variants: [v("a", "1g", 1, 1), v("b", "2g", 2, 1)] }),
    item({ source_item_id: "S0", name: "Alpha", variants: [v("a", "1g", 1, 1, true)] }),
    item({ source_item_id: "S2", name: "alpha", variants: [v("a", "1g", 1, 1)] }),
    item({ source_item_id: "N1", name: "None" }),
  ]);
  ok(!rows.some((r) => r.key === "H1"), "hidden excluded");
  ok(rows.map((r) => r.key).join(",") === "M1,S0,S2,S1,N1", `sort order (got ${rows.map((r) => r.key).join(",")})`);

  // stats count exactly
  const s = masteredStats(rows);
  ok(s.cards === 5, "stats cards");
  ok(s.multiSize === 1, "stats multi");
  ok(s.singleSize === 3, "stats single");
  ok(s.noSize === 1, "stats no-size");
  ok(s.sizes === 5, "stats sizes");
  ok(s.medicalOnly === 1, "stats medical only");
  const zero = masteredStats([]);
  ok(zero.cards === 0 && zero.sizes === 0 && zero.multiSize === 0, "empty stats");

  // filter
  ok(parseLiveCardsFilter("MULTI") === "multi" && parseLiveCardsFilter("single") === "single", "filter parse");
  ok(parseLiveCardsFilter("bogus") === "all" && parseLiveCardsFilter(["multi"]) === "all", "filter default all");
  ok(filterCards(rows, "multi").map((r) => r.key).join(",") === "M1", "multi filter");
  ok(filterCards(rows, "single").length === 3, "single filter");
  ok(filterCards(rows, "all").length === 5, "all filter");

  // href
  ok(liveCardsHref("/b", "all", 1) === "/b?tab=live", "href defaults omitted");
  ok(liveCardsHref("/b", "multi", 3, "status=new") === "/b?tab=live&show=multi&page=3&back=status%3Dnew", "href full, back carried");
  ok(liveCardsHref("/b", "all", 1, "   ") === "/b?tab=live", "href drops blank back");
  ok(liveCardsHref("/b", "single", 0, null) === "/b?tab=live&show=single", "page < 2 omitted");

  // manual master members
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const mv = masterMemberViews(
    [
      { master_id: "m1", pos_product_key: "S1", variant_label: "1g", sort_order: 2 },
      { master_id: "m1", pos_product_key: "M1", variant_label: " ", sort_order: 1 },
      { master_id: "m1", pos_product_key: "GONE", variant_label: null, sort_order: 3 },
      { master_id: "m2", pos_product_key: "S0", variant_label: null, sort_order: 0 },
    ],
    byKey,
  );
  const m1 = mv.get("m1") ?? [];
  ok(m1.map((m) => m.key).join(",") === "M1,S1,GONE", "members in sort order");
  ok(m1[0].card?.key === "M1" && m1[0].variantLabel === null, "member joined to live card; blank label null");
  ok(m1[2].card === null, "member not on menu → null card");
  ok((mv.get("m2") ?? []).length === 1, "second master grouped");
  const mm = manualMasterByKey(
    [
      { master_id: "m1", pos_product_key: "S1", variant_label: null, sort_order: 0 },
      { master_id: "mX", pos_product_key: "S2", variant_label: null, sort_order: 0 },
    ],
    new Map([["m1", "Acme OG"]]),
  );
  ok(mm.get("S1") === "Acme OG" && !mm.has("S2"), "manual master by key (unknown master skipped)");

  ok(lotSearchHref(" LOT 9 ") === "/admin/inventory?q=LOT%209", "lot search href");

  // labels
  const fmt = (n: number) => `$${(n / 100).toFixed(2)}`;
  ok(priceRangeLabel([1000, 1000], fmt) === "$10.00", "single price");
  ok(priceRangeLabel([1000, 4000], fmt) === "$10.00–$40.00", "price range label");
  ok(priceRangeLabel(null, fmt) === "—", "no price");
  ok(stockLabel(null) === "Stock unknown" && stockLabel(0) === "0 on hand", "stock labels");
  ok(MANUAL_MASTER_RULE.includes("vendor, category and product family"), "rule names the join keys");

  return { passed, failed };
}
