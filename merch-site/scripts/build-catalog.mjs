/**
 * R72 S5 - collect the Merch Studio listing packages into lib/catalog-data.json.
 *
 * Runs before `next dev` / `next build` (npm pre-scripts), so on Vercel every
 * deploy picks up whatever is in catalog/. Owner workflow:
 *   1. Merch Studio -> Publish & Ads -> "Download listing package".
 *   2. Put the .json in merch-site/catalog/ (file order = "Featured" order;
 *      prefix names 01-, 02- ... to choose it).
 *   3. Put the print PNGs from the Proof & Export ZIP in merch-site/public/print/
 *      (same filenames) and product photos in merch-site/public/products/
 *      named <product-handle>-1.jpg, <product-handle>-2.webp ...
 *   4. Commit + push. That's it.
 * Validation happens in lib/catalog-core.ts (shown by `npm run catalog`).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "catalog");
const photos = existsSync(join(root, "public/products")) ? readdirSync(join(root, "public/products")) : [];
const out = [];
for (const name of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []) {
  try {
    const data = JSON.parse(readFileSync(join(dir, name), "utf8"));
    const handle = data?.product?.handle;
    if (handle && !(data.merch && Array.isArray(data.merch.images) && data.merch.images.length)) {
      const mine = photos.filter((p) => p.startsWith(`${handle}-`) && /\.(jpe?g|png|webp)$/i.test(p)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (mine.length) data.merch = { ...(data.merch || {}), images: mine.map((p) => `/products/${p}`) };
    }
    out.push({ name, data });
  } catch (e) {
    console.error(`catalog: ${name} is not valid JSON - skipped (${e.message})`);
  }
}
writeFileSync(join(root, "lib/catalog-data.json"), JSON.stringify(out) + "\n");
console.log(`catalog: ${out.length} listing package(s) -> lib/catalog-data.json`);
