/**
 * R73 S4: SEO for greenwaymerch.com (PURE: no Next, no env, no fetch).
 *
 * Facts this follows (checked, not guessed):
 * - Google merchant listing docs: Product needs name, image and an Offer with
 *   price > 0 and priceCurrency. Variants go in a ProductGroup with hasVariant,
 *   variesBy and productGroupID. Offer url "can be omitted". A store-wide
 *   return policy can be given with only `merchantReturnLink` (Option B).
 *   https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
 *   https://developers.google.com/search/docs/appearance/structured-data/product-variants
 *   https://developers.google.com/search/docs/appearance/structured-data/return-policy
 * - Merchant Center spec: apparel needs gender and age_group; use
 *   identifier_exists "no" when there is no GTIN/MPN (print-on-demand).
 *   https://support.google.com/merchants/answer/7052112
 * - Google product taxonomy ids, from the official file
 *   https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt :
 *   212 = Clothing > Shirts & Tops, 5598 = Clothing > Outerwear > Coats & Jackets,
 *   173 = Clothing Accessories > Hats. The taxonomy has no hoodie or sweatshirt
 *   node, so those use Shirts & Tops (the nearest parent).
 * - "Unisex" is in Printful's own product titles for every garment we sell
 *   (catalog ids 586, 71, 753, 1543, 839, 943, 629). The hats' titles
 *   (99, 206, 422, 266) don't say it, so hats/beanies get no gender.
 *
 * Everything we only know from the owner's env (shipping price, contact) is
 * passed in; when missing, the field is left out rather than invented.
 */
import type { MerchProduct } from "./catalog-core";

export const BRAND_NAME = "Greenway";
export const TAXONOMY_URL = "https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt";

export interface GoogleCategory { id: string; path: string }
const SHIRTS: GoogleCategory = { id: "212", path: "Apparel & Accessories > Clothing > Shirts & Tops" };
const JACKETS: GoogleCategory = { id: "5598", path: "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets" };
const HATS: GoogleCategory = { id: "173", path: "Apparel & Accessories > Clothing Accessories > Hats" };

export const GOOGLE_CATEGORY: Readonly<Record<string, GoogleCategory>> = {
  tees: SHIRTS, "long-sleeves": SHIRTS, hoodies: SHIRTS, sweatshirts: SHIRTS, "zip-hoodies": SHIRTS,
  jackets: JACKETS, hats: HATS, beanies: HATS,
};

/** Categories whose Printful blank is titled "Unisex" (see header). */
export const UNISEX_CATEGORIES: ReadonlySet<string> = new Set(["tees", "long-sleeves", "hoodies", "sweatshirts", "zip-hoodies", "jackets"]);

export interface SeoSite { url: string; name: string; dba: string; legalName: string; email: string; phone: string; address: string }
/** From checkout-core's ShippingConfig. freeOverCents > 0 = free when ONE unit's price reaches it (same rule as checkout). */
export interface SeoShipping { rateCents: number; minDays: number; maxDays: number; freeOverCents?: number }
export const oneUnitShipCents = (ship: SeoShipping, priceCents: number) => ((ship.freeOverCents ?? 0) > 0 && priceCents >= (ship.freeOverCents ?? 0) ? 0 : ship.rateCents);

const dollars = (cents: number) => (Math.round(cents) / 100).toFixed(2);
/** Absolute https URL for a site path; already-absolute https stays; anything else -> "". */
export function absUrl(site: string, pathOrUrl: string): string {
  if (/^https:\/\//.test(pathOrUrl)) return pathOrUrl;
  if (/^\/(?!\/)/.test(pathOrUrl)) return `${site.replace(/\/+$/, "")}${pathOrUrl}`;
  return "";
}
const productUrl = (site: string, p: Pick<MerchProduct, "category" | "handle">) => absUrl(site, `/${p.category}/${p.handle}`);
const plain = (s: string) => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

/** Serialize for a <script type="application/ld+json">: "<" escaped so text can never close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/** Store-wide identity (OnlineStore is an Organization subtype) + return policy link. */
export function organizationJsonLd(s: SeoSite) {
  const org: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": `${s.url}/#store`,
    name: s.dba,
    alternateName: s.name,
    legalName: s.legalName,
    url: `${s.url}/`,
    hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", merchantReturnLink: `${s.url}/returns` },
  };
  if (s.email) org.email = s.email;
  if (s.phone) org.telephone = s.phone;
  if (s.address) org.address = s.address;
  return org;
}

export function websiteJsonLd(s: SeoSite) {
  return { "@context": "https://schema.org", "@type": "WebSite", "@id": `${s.url}/#website`, name: s.name, url: `${s.url}/`, publisher: { "@id": `${s.url}/#store` } };
}

export function breadcrumbJsonLd(site: string, items: readonly { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absUrl(site, it.path) })),
  };
}

function shippingDetails(ship: SeoShipping, priceCents: number) {
  const d: Record<string, unknown> = {
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: dollars(oneUnitShipCents(ship, priceCents)), currency: "USD" },
    // Washington-only selling (R73 S2): never advertise delivery elsewhere.
    shippingDestination: { "@type": "DefinedRegion", addressCountry: "US", addressRegion: ["WA"] },
  };
  if (ship.minDays > 0 && ship.maxDays >= ship.minDays) {
    d.deliveryTime = {
      "@type": "ShippingDeliveryTime",
      transitTime: { "@type": "QuantitativeValue", minValue: ship.minDays, maxValue: ship.maxDays, unitCode: "DAY" },
    };
  }
  return d;
}

/** ProductGroup + one Product per variant (price > 0 only), or null when nothing is sellable. */
export function productJsonLd(p: MerchProduct, site: string, ship: SeoShipping | null) {
  const images = p.images.map((i) => absUrl(site, i)).filter(Boolean);
  const variants = p.variants.filter((v) => v.priceCents > 0);
  if (!variants.length || !images.length) return null;
  const cat = GOOGLE_CATEGORY[p.category];
  const varies = [
    ...(new Set(variants.map((v) => v.size)).size > 1 ? ["https://schema.org/size"] : []),
    ...(new Set(variants.map((v) => v.color)).size > 1 ? ["https://schema.org/color"] : []),
  ];
  const group: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    name: p.title,
    url: productUrl(site, p),
    image: images,
    brand: { "@type": "Brand", name: BRAND_NAME },
    productGroupID: p.handle,
    hasVariant: variants.map((v) => {
      const offer: Record<string, unknown> = {
        "@type": "Offer",
        price: dollars(v.priceCents),
        priceCurrency: "USD",
        itemCondition: "https://schema.org/NewCondition",
        availability: v.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        seller: { "@id": `${site}/#store` },
      };
      if (ship) offer.shippingDetails = shippingDetails(ship, v.priceCents);
      return {
        "@type": "Product",
        sku: `${p.handle}-${v.id}`,
        name: `${p.title} - ${v.color} / ${v.size}`,
        image: images[0],
        color: v.color,
        size: v.size,
        offers: offer,
      };
    }),
  };
  if (varies.length) group.variesBy = varies;
  const desc = plain(p.description);
  if (desc) group.description = desc;
  if (p.fabric) group.material = p.fabric;
  if (cat) group.category = { "@type": "CategoryCode", inCodeSet: TAXONOMY_URL, codeValue: cat.id };
  if (UNISEX_CATEGORIES.has(p.category)) {
    group.audience = { "@type": "PeopleAudience", suggestedGender: "unisex", suggestedAge: { "@type": "QuantitativeValue", minValue: 13, unitCode: "ANN" } };
  }
  return group;
}

// ---------------------------------------------------------------------------
// Google Merchant Center product feed (RSS 2.0 + g: namespace), one item per variant.
// ---------------------------------------------------------------------------
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const tag = (name: string, value: string) => (value ? `<${name}>${xml(value)}</${name}>` : "");

export function merchantFeedXml(products: readonly MerchProduct[], s: SeoSite, ship: SeoShipping | null): string {
  const items: string[] = [];
  for (const p of products) {
    const images = p.images.map((i) => absUrl(s.url, i)).filter(Boolean);
    if (!images.length) continue;
    const cat = GOOGLE_CATEGORY[p.category];
    const desc = plain(p.description) || p.title;
    for (const v of p.variants) {
      if (v.priceCents <= 0) continue;
      const shipXml = ship
        ? `<g:shipping><g:country>US</g:country><g:region>WA</g:region><g:price>${dollars(oneUnitShipCents(ship, v.priceCents))} USD</g:price>${ship.minDays > 0 && ship.maxDays >= ship.minDays ? `<g:min_transit_time>${ship.minDays}</g:min_transit_time><g:max_transit_time>${ship.maxDays}</g:max_transit_time>` : ""}</g:shipping>`
        : "";
      items.push(
        "<item>" +
          tag("g:id", `${p.handle}-${v.id}`) +
          tag("g:item_group_id", p.handle) +
          tag("g:title", `${p.title} - ${v.color} / ${v.size}`) +
          tag("g:description", desc) +
          tag("g:link", productUrl(s.url, p)) +
          tag("g:image_link", images[0]) +
          images.slice(1, 11).map((i) => tag("g:additional_image_link", i)).join("") +
          tag("g:availability", v.inStock ? "in_stock" : "out_of_stock") +
          tag("g:price", `${dollars(v.priceCents)} USD`) +
          tag("g:condition", "new") +
          tag("g:brand", BRAND_NAME) +
          tag("g:identifier_exists", "no") +
          (cat ? tag("g:google_product_category", cat.id) : "") +
          tag("g:product_type", cat ? cat.path : "") +
          tag("g:color", v.color) +
          tag("g:size", v.size) +
          tag("g:age_group", "adult") +
          (UNISEX_CATEGORIES.has(p.category) ? tag("g:gender", "unisex") : "") +
          (p.fabric ? tag("g:material", p.fabric.slice(0, 200)) : "") +
          shipXml +
          "</item>",
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>${tag("title", s.name)}${tag("link", `${s.url}/`)}${tag("description", `${s.dba} - Washington-only apparel`)}${items.join("")}</channel></rss>\n`;
}

// ---------------------------------------------------------------------------
export function __runSeoCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error("  FAIL seo-core:", m); } };
  const site: SeoSite = { url: "https://greenwaymerch.com", name: "Greenway Merch", dba: "Greenway Glass & Goods", legalName: "Greenway Merchandising LLC", email: "", phone: "", address: "" };
  const p: MerchProduct = {
    handle: "logo-tee", title: "Logo Tee", description: "Heavy <b>tee</b>.", category: "tees", blankLabel: "", fabric: "100% cotton",
    images: ["/products/a.jpg", "https://cdn.x/b.jpg"], colors: ["Black", "White"], sizes: ["S", "M"],
    variants: [
      { id: 1, color: "Black", size: "S", priceCents: 3500, inStock: true },
      { id: 2, color: "White", size: "M", priceCents: 3700, inStock: false },
      { id: 3, color: "White", size: "S", priceCents: 0, inStock: true },
    ],
    minPriceCents: 3500, maxPriceCents: 3700, orderItem: { files: [], options: [] }, designId: "d", order: 0,
  };
  ok(absUrl(site.url, "/x.jpg") === "https://greenwaymerch.com/x.jpg" && absUrl(site.url, "//evil.com/x") === "" && absUrl(site.url, "http://x") === "", "absUrl only site paths or https");
  ok(!jsonLdString({ a: "</script><x>" }).includes("<"), "JSON-LD cannot close the script tag");
  const g = productJsonLd(p, site.url, null) as Record<string, unknown>;
  const vs = g.hasVariant as Record<string, unknown>[];
  ok(g["@type"] === "ProductGroup" && g.productGroupID === "logo-tee", "ProductGroup with group id");
  ok(vs.length === 2, "zero-price variant dropped (Google needs price > 0)");
  ok((vs[0].offers as Record<string, unknown>).price === "35.00" && (vs[1].offers as Record<string, unknown>).availability === "https://schema.org/OutOfStock", "price + availability");
  ok(JSON.stringify(g.variesBy) === JSON.stringify(["https://schema.org/size", "https://schema.org/color"]), "variesBy only when values differ");
  ok(g.description === "Heavy tee." && (g.image as string[])[0] === "https://greenwaymerch.com/products/a.jpg", "plain description + absolute images");
  ok((g.category as Record<string, string>).codeValue === "212" && (g.audience as Record<string, string>).suggestedGender === "unisex", "tee: taxonomy 212 + unisex");
  ok(!("shippingDetails" in (vs[0].offers as object)), "no shipping env -> no shipping claim");
  const gs = productJsonLd(p, site.url, { rateCents: 599, minDays: 3, maxDays: 8 }) as Record<string, unknown>;
  const sd = ((gs.hasVariant as Record<string, Record<string, Record<string, unknown>>>[])[0].offers.shippingDetails);
  ok(JSON.stringify(sd.shippingDestination) === JSON.stringify({ "@type": "DefinedRegion", addressCountry: "US", addressRegion: ["WA"] }), "shipping limited to WA");
  const free = productJsonLd(p, site.url, { rateCents: 599, minDays: 0, maxDays: 0, freeOverCents: 3600 }) as Record<string, unknown>;
  const rates = (free.hasVariant as Record<string, Record<string, Record<string, Record<string, string>>>>[]).map((v) => v.offers.shippingDetails.shippingRate.value);
  ok(JSON.stringify(rates) === JSON.stringify(["5.99", "0.00"]) && !("deliveryTime" in (free.hasVariant as Record<string, Record<string, Record<string, unknown>>>[])[0].offers.shippingDetails), "free-shipping threshold matches checkout; no window -> no deliveryTime");
  const hat = productJsonLd({ ...p, category: "hats" }, site.url, null) as Record<string, unknown>;
  ok(!("audience" in hat) && (hat.category as Record<string, string>).codeValue === "173", "hats: 173, no gender claimed");
  ok(productJsonLd({ ...p, variants: [p.variants[2]] }, site.url, null) === null, "nothing sellable -> no Product markup");
  const org = organizationJsonLd(site);
  ok(!("email" in org) && (org.hasMerchantReturnPolicy as Record<string, string>).merchantReturnLink === "https://greenwaymerch.com/returns", "org: no blank contact, return link");
  const feed = merchantFeedXml([p], site, { rateCents: 599, minDays: 0, maxDays: 0 });
  ok((feed.match(/<item>/g) ?? []).length === 2 && feed.includes("<g:id>logo-tee-1</g:id>") && feed.includes("<g:item_group_id>logo-tee</g:item_group_id>"), "feed: one item per sellable variant");
  ok(feed.includes("<g:price>35.00 USD</g:price>") && feed.includes("<g:availability>out_of_stock</g:availability>") && feed.includes("<g:identifier_exists>no</g:identifier_exists>"), "feed: price, availability, identifier_exists");
  ok(feed.includes("<g:region>WA</g:region>") && !feed.includes("min_transit_time") && feed.includes("<g:gender>unisex</g:gender>") && feed.includes("<g:age_group>adult</g:age_group>"), "feed: WA shipping, apparel gender/age");
  ok(merchantFeedXml([{ ...p, title: "A & <B>" }], site, null).includes("A &amp; &lt;B&gt;") && !merchantFeedXml([p], site, null).includes("<g:shipping>"), "feed: XML escaped, no shipping without env");
  ok(merchantFeedXml([], site, null).includes("<channel>") && !merchantFeedXml([], site, null).includes("<item>"), "empty catalogue -> valid empty feed");
  console.log(`seo-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
