// Does the published menu FIT in Vercel's Data Cache?
// Vercel docs (verified): Data Cache / Runtime Cache item size = 2 MB,
// "items larger won't be cached". unstable_cache writes to that cache.
//
// If the menu exceeds 2 MB, every write is silently dropped and EVERY request
// re-runs the full DB read. That would explain why Slice A changed nothing.
import { gzipSync, gunzipSync } from "node:zlib";

const LIMIT = 2 * 1024 * 1024;
const PRODUCTS = 4500;

function makeItem(i) {
  return {
    id: `POS-KEY-${i}-0000-1111-2222`,
    name: `Product Name ${i} - Premium Cannabis Flower 3.5g`,
    productName: `Product Name ${i}`,
    brand: `Brand Name ${i % 120}`,
    vendor: `Vendor Company Name ${i % 90}`,
    category: "flower",
    filterCategories: ["flower", "prerolls"],
    posInventoryType: "Usable Cannabis",
    posInventoryCategory: "Flower Lot",
    strainType: "hybrid",
    strainName: `Strain Name ${i % 300}`,
    terpenes: ["myrcene", "limonene", "caryophyllene"],
    thc: "24.5",
    cbd: "0.12",
    totalThc: { name: "THC", value: 24.5, unit: "%" },
    totalCbd: { name: "CBD", value: 0.12, unit: "%" },
    compounds: [
      { name: "THC", value: 24.5, unit: "%" },
      { name: "CBD", value: 0.12, unit: "%" },
      { name: "CBG", value: 0.8, unit: "%" },
    ],
    description:
      "A curated description of this cannabis product written for the storefront. It usually runs a couple of sentences and describes aroma and appearance in sensory terms only.",
    priceLabel: "$45.00",
    priceMinorUnits: 4500,
    inventoryStatus: "in-stock",
    hidden: false,
    variants: [
      { id: `${i}-v1`, label: "1g", priceMinorUnits: 1500, inventoryLevel: 12, medical: false },
      { id: `${i}-v2`, label: "3.5g", priceMinorUnits: 4500, inventoryLevel: 8, medical: false },
      { id: `${i}-v3`, label: "7g", priceMinorUnits: 8500, inventoryLevel: 3, medical: false },
    ],
    imageUrl: `https://example.supabase.co/storage/v1/object/public/media/products/product-${i}-image.webp`,
    imageIsFallback: false,
    dohCompliant: false,
  };
}

const items = Array.from({ length: PRODUCTS }, (_, i) => makeItem(i));
const json = JSON.stringify(items);
const raw = Buffer.byteLength(json, "utf8");

const mb = (n) => (n / 1024 / 1024).toFixed(2);
const kb = (n) => (n / 1024).toFixed(0);

console.log(`Data Cache item limit: ${mb(LIMIT)} MB`);
console.log(`published menu (raw):  ${mb(raw)} MB`);
console.log(
  raw > LIMIT
    ? `>>> OVER THE LIMIT by ${mb(raw - LIMIT)} MB - THE CACHE WRITE IS DROPPED <<<`
    : `fits`,
);

// Fix under test: store the menu COMPRESSED in the cache entry.
const gz = gzipSync(json);
console.log(`\ngzipped cache entry:   ${kb(gz.length)} KB  (${(raw / gz.length).toFixed(0)}x smaller)`);
console.log(gz.length < LIMIT ? `>>> FITS with ${mb(LIMIT - gz.length)} MB to spare <<<` : `still too big`);

// Base64 is what a JSON-serializable cache value would actually store.
const b64 = gz.toString("base64");
const b64Bytes = Buffer.byteLength(b64, "utf8");
console.log(`as base64 (stored):    ${kb(b64Bytes)} KB`);
console.log(b64Bytes < LIMIT ? `>>> STILL FITS <<<` : `too big`);

// Read cost paid per request on a cache HIT.
let t = process.hrtime.bigint();
for (let n = 0; n < 5; n++) JSON.parse(gunzipSync(Buffer.from(b64, "base64")).toString("utf8"));
const readMs = Number(process.hrtime.bigint() - t) / 1e6 / 5;

t = process.hrtime.bigint();
for (let n = 0; n < 5; n++) gzipSync(json);
const writeMs = Number(process.hrtime.bigint() - t) / 1e6 / 5;

console.log(`\ndecode on cache HIT:   ${readMs.toFixed(0)} ms  (vs seconds of DB round trips)`);
console.log(`encode on cache MISS:  ${writeMs.toFixed(0)} ms  (once per 60s window)`);

// Headroom: at what catalog size does the compressed entry hit 2 MB?
console.log(`\nheadroom: ~${Math.floor((LIMIT / b64Bytes) * PRODUCTS).toLocaleString()} products before the compressed entry hits the limit`);
