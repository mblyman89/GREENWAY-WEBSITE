/**
 * D244 R-7 — the product IDENTITY a person (and the AI) reads first (PURE, no I/O).
 *
 * Owner (round 3, verbatim): "Add more details about the product, like its
 * category and type and vendor assigned to it on the details page at the top
 * of the page with its name. Then use that to help the image recommendations
 * and drafting. If the ai knows the vendor and type/ category, it can make
 * more accurate guesses."
 *
 * One read of the facts already on the menu row (never a guess):
 *   - website category (menu_items.category, label from category-taxonomy)
 *   - its FORM (flower / pre-roll / vape / concentrate / edible / topical),
 *     FORM_OF_WEBSITE_CATEGORY (cultivera-type-from-category-core.ts)
 *   - the POS inventory type + POS category exactly as the POS sent them
 *   - the vendor the card resolves to (worklist-core resolveCardVendor) and
 *     HOW (own card / delivery / brand's vendor / POS vendor name)
 *   - brand, strain
 *
 * Used by: the detail page header, the photo recommender (type words +
 * a "different type" penalty: a vape photo is not a flower photo) and the
 * all-fields draft prompt ([pos] Product type lines).
 */
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";
import { FORM_OF_WEBSITE_CATEGORY } from "@/lib/pos/cultivera-type-from-category-core";
import { tokenize } from "@/lib/media/product-link-core";
import type { VendorVia } from "./worklist-core";

export type ProductForm = "flower" | "preroll" | "vape" | "concentrate" | "edible-solid" | "edible-liquid" | "topical";

export const FORM_LABEL: Readonly<Record<ProductForm, string>> = {
  flower: "flower",
  preroll: "pre-roll",
  vape: "vape",
  concentrate: "concentrate",
  "edible-solid": "edible",
  "edible-liquid": "drinkable edible",
  topical: "topical",
};

/**
 * Words that NAME a form on a picture's text (title, filename, label read,
 * caption). Only distinctive words: "resin" / "live" are on carts AND jars,
 * so they are not here.
 */
export const FORM_WORDS: Readonly<Record<ProductForm, readonly string[]>> = {
  flower: ["flower", "bud", "buds", "eighth", "nug", "nugs", "popcorn", "smalls"],
  preroll: ["preroll", "prerolls", "pre", "joint", "joints", "blunt", "blunts", "dogwalker", "dogwalkers"],
  vape: ["cart", "carts", "cartridge", "cartridges", "vape", "vapes", "disposable", "disposables", "pod", "pods", "510"],
  concentrate: ["wax", "shatter", "rosin", "badder", "budder", "crumble", "diamonds", "sauce", "dab", "dabs", "sugar", "hash", "kief"],
  "edible-solid": ["gummy", "gummies", "chocolate", "chocolates", "chew", "chews", "mint", "mints", "cookie", "cookies", "candy", "caramel", "caramels", "edible", "edibles"],
  "edible-liquid": ["drink", "drinks", "soda", "beverage", "beverages", "seltzer", "shot", "shots", "tincture", "syrup", "elixir"],
  topical: ["balm", "lotion", "salve", "topical", "topicals", "cream", "transdermal", "patch", "patches", "bath"],
};

const ALL_FORMS = Object.keys(FORM_WORDS) as ProductForm[];

/** The form of a website category value (null = not a cannabis form we know). */
export function formOfCategory(category: string | null | undefined): ProductForm | null {
  const v = (category ?? "").trim().toLowerCase();
  if (!v) return null;
  const f = FORM_OF_WEBSITE_CATEGORY[v];
  if (f) return f as ProductForm;
  // Taxonomy values outside the form map (packs, blunts, rso, tincture).
  if (v.includes("preroll") || v.includes("blunt")) return "preroll";
  if (v === "rso") return "concentrate";
  if (v === "tincture") return "edible-liquid";
  return null;
}

/** Forms a picture's words name (a "pre-roll" tokenises to "pre" + "roll"). */
export function formsNamedIn(words: ReadonlySet<string>): ProductForm[] {
  return ALL_FORMS.filter((f) => FORM_WORDS[f].some((w) => words.has(w)));
}

/**
 * Type evidence for one picture: "same" = its words name this product's
 * form; "other" = they name a DIFFERENT form and never this one (a cart
 * photo for a flower card); "unknown" = no form words or no product form.
 */
export function formMatch(form: ProductForm | null, words: ReadonlySet<string>): { kind: "same" | "other" | "unknown"; named: ProductForm[] } {
  const named = formsNamedIn(words);
  if (!form || named.length === 0) return { kind: "unknown", named };
  if (named.includes(form)) return { kind: "same", named };
  return { kind: "other", named };
}

/** A different-type picture drops this much (below High, like a logo drops ROLE_PENALTY). */
export const FORM_MISMATCH_PENALTY = 20;
/** A same-type picture (its text names this product's type) is lifted a little. */
export const FORM_MATCH_BOOST = 4;

export type IdentityInput = {
  category: string | null | undefined;
  posInventoryType?: string | null;
  posInventoryCategory?: string | null;
  brand?: string | null;
  strainType?: string | null;
  strainName?: string | null;
  posVendorName?: string | null;
  vendorId?: string | null;
  vendorVia?: VendorVia | null;
  vendorLabel?: string | null;
};

export type IdentityRow = { key: "category" | "type" | "pos-category" | "vendor" | "brand" | "strain"; label: string; value: string; hint: string | null; missing: boolean };

export const VIA_TEXT: Readonly<Record<VendorVia, string>> = {
  enrichment: "set on this card",
  delivery: "from a delivery of this product",
  brand: "the brand's vendor",
  pos: "matched from the POS vendor name",
};

const clean = (v: string | null | undefined) => (typeof v === "string" ? v.trim() : "");

/** "Cartridge · vape" (the category label and its plain form). */
export function categoryText(category: string | null | undefined): string {
  const c = clean(category);
  if (!c) return "";
  const label = formatWebsiteCategory(c);
  const form = formOfCategory(c);
  const formLabel = form ? FORM_LABEL[form] : "";
  return formLabel && formLabel.toLowerCase() !== label.toLowerCase() ? `${label} · ${formLabel}` : label;
}

/** The identity header rows, in reading order. Always 6 rows (missing ones say so). */
export function productIdentityRows(p: IdentityInput): IdentityRow[] {
  const cat = categoryText(p.category);
  const type = clean(p.posInventoryType);
  const posCat = clean(p.posInventoryCategory);
  const vLabel = clean(p.vendorLabel);
  const posVendor = clean(p.posVendorName);
  const brand = clean(p.brand);
  const strainName = clean(p.strainName);
  const strainType = clean(p.strainType).toLowerCase();
  const strain = [strainName, strainType && strainType !== "unknown" ? strainType : ""].filter(Boolean).join(" · ");
  const vendorValue = vLabel || (p.vendorId ? "Vendor card on file" : posVendor ? `${posVendor} (POS text, not linked)` : "");
  const vendorHint = p.vendorId && p.vendorVia ? VIA_TEXT[p.vendorVia] : !p.vendorId && posVendor ? "No vendor card matches this name yet" : null;
  return [
    { key: "category", label: "Category", value: cat || "Not set", hint: null, missing: !cat },
    { key: "type", label: "Inventory type (POS)", value: type || "Not sent by the POS", hint: null, missing: !type },
    { key: "pos-category", label: "POS category", value: posCat || "Not sent by the POS", hint: null, missing: !posCat },
    { key: "vendor", label: "Vendor", value: vendorValue || "Not linked", hint: vendorHint, missing: !p.vendorId },
    { key: "brand", label: "Brand", value: brand || "Not set", hint: null, missing: !brand },
    { key: "strain", label: "Strain", value: strain || "Not set", hint: null, missing: !strain },
  ];
}

/**
 * The type words the recommender adds to its category match and the
 * semantic question ("cartridge vape cart"): the category label, its form
 * and the POS type / category words. Lower case, de-duplicated.
 */
export function identityTypeWords(p: Pick<IdentityInput, "category" | "posInventoryType" | "posInventoryCategory">): string[] {
  const form = formOfCategory(p.category);
  const text = `${formatWebsiteCategory(clean(p.category))} ${form ? FORM_LABEL[form] : ""} ${clean(p.posInventoryType)} ${clean(p.posInventoryCategory)}`;
  return [...new Set(tokenize(text))];
}

/** "Cartridge vape" — the category phrase the semantic search asks about. */
export function identitySemanticCategory(p: Pick<IdentityInput, "category" | "posInventoryType">): string {
  const cat = clean(p.category);
  if (!cat) return clean(p.posInventoryType);
  const label = formatWebsiteCategory(cat);
  const form = formOfCategory(cat);
  const extra = form && FORM_LABEL[form].toLowerCase() !== label.toLowerCase() ? ` ${FORM_LABEL[form]}` : "";
  return `${label}${extra}`;
}

/** The [pos] lines the all-fields draft adds (Product type + the POS's own words). */
export function identityPromptLines(p: Pick<IdentityInput, "category" | "posInventoryType" | "posInventoryCategory">): string[] {
  const form = formOfCategory(p.category);
  const label = clean(p.category) ? formatWebsiteCategory(clean(p.category)) : "";
  return [
    label ? `Product type: ${label}${form ? ` (a ${FORM_LABEL[form]} product — write for this type only)` : ""}` : "",
    clean(p.posInventoryType) ? `Inventory type (POS): ${clean(p.posInventoryType)}` : "",
    clean(p.posInventoryCategory) ? `POS category: ${clean(p.posInventoryCategory)}` : "",
  ].filter(Boolean);
}

export function __runProductIdentityTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`product-identity-core FAIL: ${label}`);
    }
  };
  ok(formOfCategory("cartridge") === "vape", "cartridge → vape");
  ok(formOfCategory("popcorn-bud") === "flower", "popcorn → flower");
  ok(formOfCategory("preroll-pack") === "preroll", "packs → preroll");
  ok(formOfCategory("tincture") === "edible-liquid", "tincture → liquid");
  ok(formOfCategory("accessories") === null && formOfCategory("") === null, "non-cannabis / blank → null");
  const w = (s: string) => new Set(tokenize(s));
  ok(formMatch("flower", w("Blue Dream 1g Cartridge")).kind === "other", "cart photo on a flower card = other");
  ok(formMatch("vape", w("Blue Dream 1g Cartridge")).kind === "same", "cart photo on a cart card = same");
  ok(formMatch("vape", w("Rosin cartridge")).kind === "same", "rosin cart still names vape");
  ok(formMatch("concentrate", w("Rosin cartridge")).kind === "same", "rosin cart names concentrate too");
  ok(formMatch("flower", w("Blue Dream")).kind === "unknown", "no form words = unknown");
  ok(formMatch(null, w("cartridge")).kind === "unknown", "no product form = unknown");
  ok(formMatch("preroll", w("Pre-Roll 5pk")).kind === "same", "pre-roll tokenises to pre");
  ok(categoryText("cartridge") === "Cartridge · vape", "category text with form");
  ok(categoryText("flower") === "Flower", "category text without repeating");
  ok(categoryText("edible-solid") === "Edible (Solid) · edible", "edible label");
  const rows = productIdentityRows({
    category: "cartridge", posInventoryType: "Concentrate for Inhalation", posInventoryCategory: "Live Resin Cart",
    brand: "Phat Panda", strainType: "hybrid", strainName: "Blue Dream", posVendorName: "Grow Op", vendorId: "v1", vendorVia: "brand", vendorLabel: "Grow Op Farms",
  });
  ok(rows.length === 6 && rows.map((r) => r.key).join(",") === "category,type,pos-category,vendor,brand,strain", "6 rows in order");
  ok(rows[3]!.value === "Grow Op Farms" && rows[3]!.hint === "the brand's vendor" && !rows[3]!.missing, "vendor + via");
  ok(rows[5]!.value === "Blue Dream · hybrid", "strain line");
  const bare = productIdentityRows({ category: "", posVendorName: "Acme" });
  ok(bare[0]!.missing && bare[1]!.value === "Not sent by the POS", "missing rows say so");
  ok(bare[3]!.value === "Acme (POS text, not linked)" && bare[3]!.missing && bare[3]!.hint !== null, "unlinked POS vendor");
  ok(productIdentityRows({ category: "flower", strainType: "unknown" })[5]!.value === "Not set", "unknown strain type hidden");
  const tw = identityTypeWords({ category: "cartridge", posInventoryType: "Concentrate for Inhalation", posInventoryCategory: "Cart" });
  ok(tw.includes("cartridge") && tw.includes("vape") && tw.includes("inhalation") && tw.includes("cart"), "type words");
  ok(identitySemanticCategory({ category: "cartridge" }) === "Cartridge vape", "semantic category");
  ok(identitySemanticCategory({ category: "", posInventoryType: "Usable Marijuana" }) === "Usable Marijuana", "semantic falls back to POS type");
  const pl = identityPromptLines({ category: "preroll", posInventoryType: "Usable Marijuana", posInventoryCategory: null });
  ok(pl.length === 2 && pl[0]!.startsWith("Product type: Preroll (a pre-roll product") && pl[1] === "Inventory type (POS): Usable Marijuana", "prompt lines");
  ok(identityPromptLines({ category: null }).length === 0, "no lines when blank");
  return { passed, failed };
}
