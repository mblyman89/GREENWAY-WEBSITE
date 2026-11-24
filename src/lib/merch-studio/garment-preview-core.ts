/**
 * D266 - Merch Studio garment preview (PURE).
 *
 * Owner (verbatim, D266): "please help me make the garment selection tab more
 * graphical so it is easier to work with and visualize what you are about to
 * customize. if there are dual colors available, I want them added in as well."
 *
 * Grounded in Printful's public catalog API v1 (GET https://api.printful.com/products
 * and /products/{id}, no auth, read 2026-11-23): every variant carries `color`,
 * `color_code`, `color_code2` (second colour of a two-tone item, else null) and
 * `image` (Printful's photo of that colour). The generator stores them in
 * PRINTFUL_COLOR_INFO / PRINTFUL_PRODUCT_IMAGE (garment-colors-data.ts).
 *
 * Display only: nothing here changes a price, a variant id or an order.
 */
import { PRINTFUL_COLOR_INFO, PRINTFUL_PRODUCT_IMAGE, type ColorInfoRow } from "./garment-colors-data";

export type ColorInfo = { name: string; hex: string; hex2: string | null; image: string };

const HEX_RE = /^#[0-9a-f]{6}$/i;
const IMG_RE = /^https:\/\/files\.cdn\.printful\.com\//;

/** Only Printful CDN photos are shown; anything else falls back to the swatch tint. */
export function safeImage(url: unknown): string {
  return typeof url === "string" && IMG_RE.test(url) ? url : "";
}

export function toColorInfo(r: ColorInfoRow): ColorInfo {
  const hex = HEX_RE.test(r[1]) ? r[1].toLowerCase() : "#cccccc";
  const hex2 = r[2] && HEX_RE.test(r[2]) && r[2].toLowerCase() !== hex ? r[2].toLowerCase() : null;
  return { name: r[0], hex, hex2, image: safeImage(r[3]) };
}

export function colorInfoFor(printfulId: number): ColorInfo[] {
  return (PRINTFUL_COLOR_INFO[printfulId] ?? []).map(toColorInfo);
}

export function productImageFor(printfulId: number): string {
  return safeImage(PRINTFUL_PRODUCT_IMAGE[printfulId]);
}

/** Two-tone: Printful gave a second colour code, or the name is "A / B" style. */
export function isTwoTone(c: Pick<ColorInfo, "name" | "hex2">): boolean {
  return c.hex2 !== null || /\S\s*\/\s*\S/.test(c.name);
}

/** CSS background for a swatch: a diagonal split for two-tone, a flat colour otherwise. */
export function swatchBackground(hex: string, hex2: string | null): string {
  return hex2 ? `linear-gradient(135deg, ${hex} 0 50%, ${hex2} 50% 100%)` : hex;
}

/** Multi-select toggle that keeps catalog order (so the list reads like Printful's). */
export function toggleColor(selected: readonly string[], name: string, catalogOrder: readonly string[]): string[] {
  const set = new Set(selected);
  if (set.has(name)) set.delete(name); else set.add(name);
  return catalogOrder.filter((n) => set.has(n));
}

/** Keep only names this garment really has (after a blank switch or a catalog refresh). */
export function validColors(selected: readonly unknown[], catalogOrder: readonly string[]): string[] {
  const set = new Set(selected.filter((x): x is string => typeof x === "string"));
  return catalogOrder.filter((n) => set.has(n));
}

// --- Printful catalog browser (GET /products) ---------------------------------
export type CatalogItem = { id: number; title: string; brand: string; model: string; type: string; image: string; variants: number };

export function toCatalogItems(raw: unknown): CatalogItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CatalogItem[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    if (!p || typeof p.id !== "number" || p.is_discontinued === true) continue;
    out.push({
      id: p.id, title: String(p.title ?? ""), brand: String(p.brand ?? ""), model: String(p.model ?? ""),
      type: String(p.type_name ?? p.type ?? ""), image: safeImage(p.image), variants: Number(p.variant_count) || 0,
    });
  }
  return out;
}

/** Apparel / headwear first: Printful `type` codes that are garments. */
const GARMENT_TYPES = new Set(["T-SHIRT", "EMBROIDERY", "CUT-SEW", "DTFILM", "KNITWEAR", "DIRECT-TO-FABRIC"]);
export function isGarmentType(rawType: unknown): boolean { return typeof rawType === "string" && GARMENT_TYPES.has(rawType); }

export function filterCatalog(items: readonly CatalogItem[], query: string, limit = 60): CatalogItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? items.filter((i) => { const h = `${i.title} ${i.brand} ${i.model} ${i.type} ${i.id}`.toLowerCase(); return words.every((w) => h.includes(w)); }) : items;
  return hits.slice(0, limit);
}

/** Colours of one catalog product (GET /products/{id} variants), first variant per colour. */
export function colorsFromVariants(raw: unknown): ColorInfo[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<string, ColorInfo>();
  for (const v of raw as Record<string, unknown>[]) {
    const name = typeof v?.color === "string" ? v.color : "";
    if (!name || seen.has(name)) continue;
    seen.set(name, toColorInfo([name, String(v.color_code ?? ""), typeof v.color_code2 === "string" ? v.color_code2 : null, String(v.image ?? "")]));
  }
  return [...seen.values()];
}

// Self-tests ----------------------------------------------------------------------
export function __runGarmentPreviewTests(): { passed: number; failed: number } {
  let passed = 0, failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL garment-preview-core: ${m}`); } };

  for (const id of [586, 71, 753, 1543, 839, 943, 629, 99, 206, 422, 266]) {
    const cs = colorInfoFor(id);
    ok(cs.length > 0, `${id} has colour info`);
    ok(cs.every((c) => HEX_RE.test(c.hex)), `${id} hex valid`);
    ok(cs.filter((c) => c.image).length / cs.length > 0.9, `${id} colour photos present`);
    ok(productImageFor(id) !== "", `${id} product photo`);
  }
  // Snapback 6089M: Printful lists "Black/ Neon Pink" as #2a2a2a + #e74787.
  const pink = colorInfoFor(99).find((c) => c.name === "Black/ Neon Pink");
  ok(!!pink && pink.hex2 === "#e74787" && isTwoTone(pink), "snapback two-tone second colour");
  ok(colorInfoFor(99).filter((c) => c.hex2).length >= 10, "snapback has its two-tones");
  ok(!isTwoTone({ name: "Black", hex2: null }) && isTwoTone({ name: "Heather Grey / Black", hex2: null }), "two-tone by name");
  ok(toColorInfo(["X", "#ABCDEF", "#abcdef", ""]).hex2 === null, "same second colour is not two-tone");
  ok(toColorInfo(["X", "nope", "bad", "http://evil/x.jpg"]).hex === "#cccccc" && toColorInfo(["X", "nope", "bad", "http://evil/x.jpg"]).image === "", "bad data sanitised");
  ok(swatchBackground("#000000", null) === "#000000" && swatchBackground("#000000", "#ffffff").includes("linear-gradient"), "swatch background");
  const order = ["A", "B", "C"];
  ok(toggleColor(["C"], "A", order).join() === "A,C", "toggle adds in catalog order");
  ok(toggleColor(["A", "C"], "A", order).join() === "C", "toggle removes");
  ok(validColors(["Z", "B", 3, "A"], order).join() === "A,B", "validColors drops unknown");
  const items = toCatalogItems([{ id: 1, title: "Heavy Tee", brand: "Gildan", model: "5000", type_name: "T-Shirt", image: "https://files.cdn.printful.com/a.jpg", variant_count: 9 }, { id: 2, title: "Old", is_discontinued: true }, { title: "no id" }]);
  ok(items.length === 1 && items[0].image !== "", "catalog parse skips discontinued/bad");
  ok(filterCatalog(items, "gildan tee").length === 1 && filterCatalog(items, "hoodie").length === 0, "catalog search all words");
  ok(isGarmentType("T-SHIRT") && !isGarmentType("MUG"), "garment types");
  const vc = colorsFromVariants([{ color: "Red", color_code: "#ff0000", image: "https://files.cdn.printful.com/r.jpg" }, { color: "Red", color_code: "#ff0000" }, { color: "Navy/White", color_code: "#000080", color_code2: "#ffffff" }]);
  ok(vc.length === 2 && vc[1].hex2 === "#ffffff", "variant colours dedupe + two-tone");
  return { passed, failed };
}
