/**
 * OI-ACC S5 - PURE. Turns the type registry (0371) + ACTIVE Other Inventory
 * rows into the shop's accessory cards and a per-type detail list.
 *
 * Owner verbatim: "move all of the other inventory that is sitting at the very
 * bottom of the shop menu page into the product cards for their respective
 * types ... I just want customers to be able to see we have a stock of bongs or
 * whatever and the price range for that type." Q2: a type with zero stock is
 * HIDDEN. Merch types have their own home and never become a card here.
 *
 * Public fields only: name, brand, shelf price (cents). Never cost, quantity,
 * SKU or barcode.
 */
import type { NcTypeRow } from "@/lib/noncannabis/types-core";

export type NcShopRow = {
  id: string;
  name: string;
  brand: string | null;
  type: string;
  price_minor_units: number;
  qty_on_hand: number;
  status: string;
};

export const NC_SHOP_COLUMNS = "id, name, brand, type, price_minor_units, qty_on_hand, status";

export type AccessoryShopCard = {
  key: string;
  label: string;
  description: string;
  imageUrl: string;
  href: string;
  minPriceMinor: number;
  maxPriceMinor: number;
};

/** `maxQty` is capped at 10 so the page never reveals the real On hand. */
export type AccessoryShopItem = { id: string; name: string; brand: string | null; priceMinor: number; maxQty: number };
export const ONLINE_QTY_CAP = 10;

export const ACCESSORY_FALLBACK_IMAGE = "/accessories/bongs.webp";

export function accessoryTypeHref(value: string): string {
  return `/accessories/${encodeURIComponent(value)}`;
}

/** Sellable on the website list: active, priced, in stock. */
export function isShownRow(r: NcShopRow): boolean {
  return (
    r.status === "active" &&
    Number.isFinite(r.price_minor_units) &&
    r.price_minor_units > 0 &&
    Math.floor(Number(r.qty_on_hand) || 0) > 0
  );
}

/** "$12.00" or "$12.00 - $40.00". */
export function formatPriceRange(min: number, max: number): string {
  const m = (n: number) => `$${(n / 100).toFixed(2)}`;
  return min === max ? m(min) : `${m(min)} - ${m(max)}`;
}

/** Live, non-merch types that have at least one shown row, in registry order. */
export function buildAccessoryShopCards(types: readonly NcTypeRow[], rows: readonly NcShopRow[]): AccessoryShopCard[] {
  const byType = new Map<string, { min: number; max: number }>();
  for (const r of rows) {
    if (!isShownRow(r)) continue;
    const cur = byType.get(r.type);
    const p = r.price_minor_units;
    byType.set(r.type, cur ? { min: Math.min(cur.min, p), max: Math.max(cur.max, p) } : { min: p, max: p });
  }
  return types
    .filter((t) => !t.archived_at && t.menu_group !== "merch" && byType.has(t.value))
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map((t) => {
      const range = byType.get(t.value)!;
      return {
        key: t.value,
        label: (t.card_label || "").trim() || t.label,
        description: (t.card_text || "").trim(),
        imageUrl: (t.card_image || "").trim() || ACCESSORY_FALLBACK_IMAGE,
        href: accessoryTypeHref(t.value),
        minPriceMinor: range.min,
        maxPriceMinor: range.max,
      };
    });
}

/** The detail list for one type: shown rows only, public fields only. */
export function accessoryTypeItems(rows: readonly NcShopRow[], value: string): AccessoryShopItem[] {
  return rows
    .filter((r) => r.type === value && isShownRow(r))
    .map((r) => ({
      id: r.id,
      name: r.name,
      brand: (r.brand ?? "").trim() || null,
      priceMinor: r.price_minor_units,
      maxQty: Math.min(ONLINE_QTY_CAP, Math.floor(Number(r.qty_on_hand) || 0)),
    }))
    .sort((a, b) => a.priceMinor - b.priceMinor || a.name.localeCompare(b.name));
}

export function __runNcShopCardsTests(): number {
  let n = 0;
  const ok = (c: boolean, msg: string) => {
    if (!c) throw new Error(`FAIL: nc-shop-cards: ${msg}`);
    n += 1;
  };
  const t = (value: string, extra: Partial<NcTypeRow> = {}): NcTypeRow => ({
    value, label: value.toUpperCase(), sku_prefix: "XX", menu_group: "accessories", sort: 10, archived_at: null,
    draft_label: "", draft_text: "", draft_image: "", card_label: "", card_text: "", card_image: "", card_published_at: null,
    ...extra,
  });
  const r = (id: string, type: string, price: number, qty: number, status = "active"): NcShopRow => ({
    id, name: `N${id}`, brand: null, type, price_minor_units: price, qty_on_hand: qty, status,
  });
  const types = [t("bong", { card_label: "Bongs", sort: 20 }), t("pipe", { sort: 10 }), t("apparel", { menu_group: "merch" }), t("torch", { archived_at: "2026-01-01" }), t("tray")];
  const rows = [r("1", "bong", 4000, 1), r("2", "bong", 1200, 3), r("3", "pipe", 900, 2), r("4", "apparel", 2000, 5), r("5", "torch", 500, 5), r("6", "tray", 800, 0), r("7", "pipe", 100, 4, "inactive")];
  const cards = buildAccessoryShopCards(types, rows);
  ok(cards.length === 2, "only in-stock live non-merch types");
  ok(cards[0].key === "pipe" && cards[1].key === "bong", "registry sort order");
  ok(cards[1].label === "Bongs" && cards[0].label === "PIPE", "card label falls back to type label");
  ok(cards[1].minPriceMinor === 1200 && cards[1].maxPriceMinor === 4000, "price range");
  ok(cards[0].minPriceMinor === 900, "inactive row ignored");
  ok(cards[0].imageUrl === ACCESSORY_FALLBACK_IMAGE, "image fallback");
  ok(cards[1].href === "/accessories/bong", "href");
  ok(formatPriceRange(1200, 4000) === "$12.00 - $40.00" && formatPriceRange(900, 900) === "$9.00", "format");
  const items = accessoryTypeItems(rows, "bong");
  ok(items.length === 2 && items[0].priceMinor === 1200, "detail list sorted by price");
  ok(!("qty_on_hand" in items[0]) && !("cost" in items[0]), "public fields only");
  ok(accessoryTypeItems(rows, "tray").length === 0, "zero stock -> empty");
  ok(accessoryTypeItems([r("9", "bong", 100, 400)], "bong")[0].maxQty === 10, "qty capped, never the real count");
  return n;
}
