/**
 * R71 S4 - "Listing package" for the SEPARATE Greenway Goods website (PURE).
 *
 * Owner direction (R71): design everything in the back-office studio, publish
 * to a brand-new separate domain (not a subdomain), take cards with Stripe,
 * and let NO product details reach the cannabis site. "We will build the merch
 * site later."
 *
 * So the studio's publish step produces a self-contained, versioned JSON file
 * the merch site (Slice 5) will import. It is DOWNLOADED by the owner. It is
 * never written to the cannabis database, never rendered by the cannabis
 * site, never sent anywhere by this code. Everything here is plain data.
 *
 * Contents:
 *  - product: title, handle, description, the blank (Printful catalog ids).
 *  - printFiles: one per Printful file type, filenames identical to the
 *    Proof & Export ZIP, with the exact Printful `position` box.
 *  - variants: every chosen colour x size that Printful makes, its catalog
 *    variant id, stock flag, estimated Printful cost, retail price, card fee,
 *    profit and margin (same maths as the Fulfillment tab).
 *  - printfulSyncProduct: the body for Printful's POST /store/products. Sync
 *    variant files take {type, url} ONLY - Printful's sync-product file schema
 *    has no `position` field (position exists only on ORDER items). So a
 *    product created that way would print with Printful's default placement.
 *    The merch site must therefore order with printfulOrderItem (below),
 *    which carries position. This is why the studio does NOT auto-create
 *    Printful store products. Documented in R71 section 4.
 *  - printfulOrderItem: files + options for an order item (the same object
 *    the Proof tab shows), to be combined with a variant id per sale.
 *  - seller / payments: Greenway Merchandising LLC, Stripe under the LLC.
 *
 * Money is integer CENTS; Printful wants retail_price as a "12.34" string.
 */
import { basePriceCents, colorsFor, getBlank, sizesFor, PRINTFUL_SNAPSHOT_DATE, type Blank, type UsedPlacement } from "./garment-catalog-core";
import { usedPlacements, type MerchDesign } from "./merch-design-core";
import { planPrintFiles, printfulItemDraft, slug, variantFor, type PrintFilePlan, type PrintfulItemDraft, type PrintfulPosition } from "./print-export-core";
import { unitEconomics } from "./fulfillment-core";
import type { Issue } from "./print-rules-core";

export const LISTING_FORMAT = "greenway-goods-listing";
export const LISTING_VERSION = 1;
/** Printful: a sync product holds at most 100 sync variants. */
export const PRINTFUL_MAX_SYNC_VARIANTS = 100;
export const LISTING_SELLER = "Greenway Merchandising LLC (dba Greenway Glass & Goods)";
export const LISTING_LIMITS = { title: 80, description: 1000 } as const;

export interface ListingInput {
  design: MerchDesign;
  title: string;
  description: string;
  colors: readonly string[];
  sizes: readonly string[];
  /** Retail price of the smallest chosen size, cents. */
  retailCents: number;
  /** Add Printful's bigger-size upcharge (e.g. 2XL +$2) on top of retail. */
  passSizeUpcharge: boolean;
  /** Hosted print-file URLs by plan key (from Proof & Export uploads); may be empty. */
  urls?: Readonly<Record<string, string>>;
  generatedAt: string;
}

export interface ListingVariant {
  color: string;
  size: string;
  printfulVariantId: number;
  inStock: boolean;
  printfulCents: number;
  retailCents: number;
  cardFeeCents: number;
  profitCents: number;
  marginBps: number;
}

export interface ListingPrintFile {
  key: string;
  fileType: string;
  method: string;
  filename: string;
  dpi: number;
  pxW: number;
  pxH: number;
  position: PrintfulPosition;
  url: string;
}

export interface ListingPackage {
  format: typeof LISTING_FORMAT;
  v: typeof LISTING_VERSION;
  generatedAt: string;
  catalogSnapshot: string;
  seller: string;
  payments: string;
  designId: string;
  product: {
    title: string;
    handle: string;
    description: string;
    blank: { id: string; printfulProductId: number; brand: string; model: string; title: string; fabric: string };
  };
  printFiles: ListingPrintFile[];
  variants: ListingVariant[];
  printfulSyncProduct: {
    sync_product: { name: string };
    sync_variants: { variant_id: number; retail_price: string; files: { type: string; url: string }[]; options: { id: string; value: unknown }[] }[];
  };
  printfulOrderItem: PrintfulItemDraft;
  notes: string[];
}

const cleanText = (v: string, max: number) => v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max);
export const centsToPrice = (c: number) => `${Math.floor(Math.max(0, Math.round(c)) / 100)}.${String(Math.max(0, Math.round(c)) % 100).padStart(2, "0")}`;

function usedList(d: MerchDesign, b: Blank): { used: UsedPlacement[]; puff: boolean } {
  const used: UsedPlacement[] = [];
  let puff = false;
  for (const p of usedPlacements(d, b)) {
    const s = d.sides[p.id];
    if (!s || !p.methods.includes(s.method)) continue;
    used.push({ placementId: p.id, method: s.method });
    if (s.puff) puff = true;
  }
  return { used, puff };
}

const issue = (id: string, level: Issue["level"], title: string, why: string, fix: string): Issue => ({ id, level, title, why, fix, source: "studio" });

/** Build the package + every problem found. Blockers mean "do not import this yet". */
export function buildListingPackage(i: ListingInput): { pkg: ListingPackage | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const b = getBlank(i.design.blankId);
  if (!b) return { pkg: null, issues: [issue("listing-blank", "blocker", "Unknown garment", "This design points at a garment that is no longer in the catalog.", "Open it in Design and pick a garment.")] };
  const { plans, issues: planIssues } = planPrintFiles(i.design);
  issues.push(...planIssues);
  if (plans.length === 0) issues.push(issue("listing-empty", "blocker", "Nothing to print", "The design has no visible artwork on any placement.", "Add artwork in Design first."));

  const title = cleanText(i.title, LISTING_LIMITS.title);
  const description = cleanText(i.description, LISTING_LIMITS.description);
  if (!title) issues.push(issue("listing-title", "blocker", "Add a product title", "The merch site needs a name to list the product under.", "Type a title."));

  const knownColors = new Set(colorsFor(b).map((c) => c[0]));
  const knownSizes = sizesFor(b).map((s) => s[0]);
  const colors = [...new Set(i.colors)].filter((c) => knownColors.has(c));
  const sizes = knownSizes.filter((s) => i.sizes.includes(s)); // catalog order
  if (!colors.length) issues.push(issue("listing-colors", "blocker", "Pick at least one colour", "A listing needs at least one garment colour.", "Tick a colour."));
  if (!sizes.length) issues.push(issue("listing-sizes", "blocker", "Pick at least one size", "A listing needs at least one size.", "Tick a size."));

  const { used, puff } = usedList(i.design, b);
  const sizeBase = new Map(sizesFor(b).map((s) => [s[0], s[1]] as const));
  const minBase = sizes.length ? Math.min(...sizes.map((s) => sizeBase.get(s) ?? 0)) : 0;
  const retail = Math.max(0, Math.round(i.retailCents || 0));
  if (retail <= 0) issues.push(issue("listing-retail", "blocker", "Set a retail price", "The merch site needs a price to charge.", "Enter a retail price."));

  const variants: ListingVariant[] = [];
  const missing: string[] = [];
  for (const color of colors) {
    for (const size of sizes) {
      const v = variantFor(b, color, size);
      if (!v) { missing.push(`${color} ${size}`); continue; }
      const est = basePriceCents(b, size, used, puff);
      if (!est) { missing.push(`${color} ${size}`); continue; }
      const r = retail + (i.passSizeUpcharge ? Math.max(0, (sizeBase.get(size) ?? minBase) - minBase) : 0);
      const e = unitEconomics({ retailCents: r, printfulCents: est.cents, shippingChargedCents: 0, shippingCostCents: 0 });
      variants.push({ color, size, printfulVariantId: v[2], inStock: v[4], printfulCents: est.cents, retailCents: r, cardFeeCents: e.cardFeeCents, profitCents: e.profitCents, marginBps: e.marginBps });
    }
  }
  if (missing.length) issues.push(issue("listing-missing", "warning", `${missing.length} colour/size combination${missing.length === 1 ? "" : "s"} Printful doesn't make`, `Skipped: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "..." : ""}.`, "Nothing to do - they are left out of the package."));
  const out = variants.filter((v) => !v.inStock);
  if (out.length) issues.push(issue("listing-oos", "warning", `${out.length} variant${out.length === 1 ? " is" : "s are"} out of stock at Printful (catalog snapshot ${PRINTFUL_SNAPSHOT_DATE})`, "Printful can't make them until restocked.", "Leave them in (the merch site should hide them) or untick that colour/size."));
  if (variants.length > PRINTFUL_MAX_SYNC_VARIANTS) issues.push(issue("listing-too-many", "blocker", `${variants.length} variants - Printful allows ${PRINTFUL_MAX_SYNC_VARIANTS} per product`, "Printful's sync-product API caps a product at 100 variants.", "Untick some colours or sizes, or split into two listings."));
  const loss = variants.filter((v) => v.profitCents <= 0);
  if (loss.length) issues.push(issue("listing-loss", "blocker", `${loss.length} variant${loss.length === 1 ? " sells" : "s sell"} at a loss`, "Retail is below the Printful estimate plus the Stripe fee.", "Raise the retail price (see Fulfillment & Pricing for a suggested price)."));
  else if (variants.some((v) => v.marginBps < 3000)) issues.push(issue("listing-thin", "warning", "Some variants earn under 30% margin", "Before shipping, returns and reprints.", "Consider a higher price."));

  const urls = i.urls ?? {};
  const noUrl = plans.filter((p) => !urls[p.key]);
  if (plans.length && noUrl.length) issues.push(issue("listing-urls", "warning", "Print-file links are empty", "The files aren't hosted yet, so Printful can't fetch them from this package.", "Fine for now: the merch site (Slice 5) uploads the PNGs from the Proof & Export ZIP - the filenames match."));

  const blocker = issues.some((x) => x.level === "blocker");
  if (blocker && (!title || !colors.length || !sizes.length || plans.length === 0)) return { pkg: null, issues };

  const printFiles: ListingPrintFile[] = plans.map((p: PrintFilePlan) => ({ key: p.key, fileType: p.fileType, method: p.method, filename: p.filename, dpi: p.dpi, pxW: p.pxW, pxH: p.pxH, position: p.position, url: urls[p.key] ?? "" }));
  const orderItem = printfulItemDraft(b, plans, urls);
  const pkg: ListingPackage = {
    format: LISTING_FORMAT,
    v: LISTING_VERSION,
    generatedAt: i.generatedAt,
    catalogSnapshot: PRINTFUL_SNAPSHOT_DATE,
    seller: LISTING_SELLER,
    payments: "Stripe account of Greenway Merchandising LLC (its own EIN, bank account and statement descriptor) on the separate Greenway Goods domain. Never the cannabis store's processor, never cannabis or paraphernalia.",
    designId: i.design.id,
    product: {
      title,
      handle: slug(title, 60),
      description,
      blank: { id: b.id, printfulProductId: b.printfulId, brand: b.brand, model: b.model, title: b.title, fabric: b.fabric },
    },
    printFiles,
    variants,
    printfulSyncProduct: {
      sync_product: { name: title },
      sync_variants: variants.map((v) => ({ variant_id: v.printfulVariantId, retail_price: centsToPrice(v.retailCents), files: printFiles.map((f) => ({ type: f.fileType, url: f.url })), options: orderItem.options })),
    },
    printfulOrderItem: orderItem,
    notes: [
      "Import into the separate Greenway Goods website only. Never upload this to the cannabis website or its database.",
      "printfulSyncProduct has NO print position (Printful's sync-variant files don't accept one). Order with printfulOrderItem + the variant id so the art prints exactly where it was designed.",
      "Printful costs are the catalog-snapshot ESTIMATE (blank + placement upcharges). Printful's order estimate is the final word. Shipping and sales tax are excluded.",
      "Print-file filenames match the Proof & Export ZIP for this design.",
    ],
  };
  return { pkg, issues };
}

export function listingFilename(pkg: ListingPackage): string {
  return `greenway-goods-${pkg.product.handle}-${pkg.generatedAt.slice(0, 10)}.json`;
}

// ---------------------------------------------------------------------------
export function __runListingPackageTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error("FAIL listing-package-core:", m); } };
  const tee = getBlank("cc-1717")!;
  const d: MerchDesign = {
    v: 1, id: "ds-t", name: "Logo Tee", blankId: tee.id, colorHex: "#1b1b1c", ack: [], updatedAt: "2026-10-17T00:00:00.000Z",
    sides: { front: { method: "dtg", elements: [{ id: "e1", kind: "shape", shape: "rect", x: 1, y: 1, w: 4, h: 4, rotate: 0, opacity: 100, fill: "#FFFFFF", strokeIn: 0, strokeColor: "#000000" }] } },
  };
  const color = colorsFor(tee)[0][0];
  const base: ListingInput = { design: d, title: "Logo Tee", description: "Heavyweight tee.", colors: [color], sizes: ["S", "M", "2XL"], retailCents: 3500, passSizeUpcharge: true, generatedAt: "2026-10-18T00:00:00.000Z" };
  const r = buildListingPackage(base);
  ok(!!r.pkg, "package built");
  ok(!r.issues.some((x) => x.level === "blocker"), "no blockers on a sane listing");
  const p = r.pkg!;
  ok(p.format === LISTING_FORMAT && p.v === 1 && p.seller === LISTING_SELLER, "header");
  ok(p.product.handle === "logo-tee", "handle");
  ok(p.variants.length === 3 && p.variants.map((v) => v.size).join() === "S,M,2XL", "catalog order sizes");
  const s = p.variants.find((v) => v.size === "S")!; const xx = p.variants.find((v) => v.size === "2XL")!;
  ok(s.retailCents === 3500, "smallest size = retail");
  const sb = new Map(sizesFor(tee).map((x) => [x[0], x[1]] as const));
  ok(xx.retailCents === 3500 + (sb.get("2XL")! - sb.get("S")!), "2XL passes the size upcharge");
  ok(s.printfulVariantId === variantFor(tee, color, "S")![2], "real variant id");
  ok(s.printfulCents === basePriceCents(tee, "S", [{ placementId: "front", method: "dtg" }])!.cents, "same estimate as Fulfillment tab");
  ok(s.profitCents === unitEconomics({ retailCents: 3500, printfulCents: s.printfulCents, shippingChargedCents: 0, shippingCostCents: 0 }).profitCents, "same economics");
  ok(p.printfulSyncProduct.sync_variants.length === 3 && p.printfulSyncProduct.sync_variants[0].retail_price === "35.00", "sync variants + price string");
  ok(p.printfulSyncProduct.sync_variants.every((v) => v.files.every((f) => !("position" in f))), "sync files carry NO position");
  ok(p.printfulOrderItem.files.length === 1 && "position" in p.printfulOrderItem.files[0], "order item carries position");
  ok(p.printFiles[0].filename.endsWith(".png") && p.printFiles[0].url === "", "print file without url");
  ok(r.issues.some((x) => x.id === "listing-urls" && x.level === "warning"), "empty urls warned, not blocked");
  ok(buildListingPackage({ ...base, urls: { [p.printFiles[0].key]: "https://x.example/a.png" } }).pkg!.printFiles[0].url === "https://x.example/a.png", "urls applied");
  ok(buildListingPackage({ ...base, passSizeUpcharge: false }).pkg!.variants.every((v) => v.retailCents === 3500), "flat price");
  ok(centsToPrice(3599) === "35.99" && centsToPrice(5) === "0.05" && centsToPrice(-1) === "0.00", "price strings");
  ok(buildListingPackage({ ...base, retailCents: 500 }).issues.some((x) => x.id === "listing-loss" && x.level === "blocker"), "loss blocks");
  ok(buildListingPackage({ ...base, retailCents: 0 }).issues.some((x) => x.id === "listing-retail"), "zero retail blocks");
  ok(buildListingPackage({ ...base, title: "  " }).pkg === null, "no title -> no package");
  ok(buildListingPackage({ ...base, colors: ["Not A Colour"] }).pkg === null, "unknown colour dropped -> no package");
  ok(buildListingPackage({ ...base, sizes: ["XXXXL"] }).pkg === null, "unknown size dropped -> no package");
  ok(buildListingPackage({ ...base, title: "<b>Tee</b>" }).pkg!.product.title === "b Tee /b", "angle brackets stripped");
  ok(buildListingPackage({ ...base, design: { ...d, sides: {} } }).pkg === null, "empty design -> no package");
  ok(buildListingPackage({ ...base, design: { ...d, blankId: "nope" } }).issues[0].id === "listing-blank", "unknown blank");
  const all = buildListingPackage({ ...base, colors: colorsFor(tee).map((c) => c[0]), sizes: sizesFor(tee).map((x) => x[0]) });
  ok(all.pkg!.variants.length > PRINTFUL_MAX_SYNC_VARIANTS === all.issues.some((x) => x.id === "listing-too-many"), "100-variant cap flagged exactly when exceeded");
  ok(listingFilename(p) === "greenway-goods-logo-tee-2026-10-18.json", "filename");
  ok(!JSON.stringify(p).includes("greenwaymarijuana"), "no cannabis host in the package");
  return { passed, failed };
}
