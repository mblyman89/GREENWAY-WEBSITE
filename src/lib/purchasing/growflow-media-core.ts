/**
 * src/lib/purchasing/growflow-media-core.ts
 *
 * GF-6 — PURE label helpers for saving GrowFlow menu media (product images +
 * COA documents) into the media library, plus the PO hand-off banner copy.
 * Only imports other pure cores — no I/O, deterministic, self-tested in the
 * pure runner.
 *
 * The PLANNING machinery (planMediaSaves / remainingMediaCount / isHttpUrl /
 * bulkSaveSummary) lives in cultivera-media-core and is STRUCTURAL
 * (MediaItemLike) — GrowFlow rows carry the same media columns, so those
 * helpers are reused as-is. Same for the PO mappers in cultivera-po-core
 * (parseMenuItemIds / buildMenuPrefills over MenuPrefillItemLike). This file
 * only adds what actually differs: platform-branded tags, titles, alt text,
 * and banner copy.
 */

import { vendorTag, type MediaItemLike, type MediaSaveKind } from "./cultivera-media-core";

/**
 * Tags for a saved GrowFlow asset: "growflow", the kind ("product-image" |
 * "coa"), and the vendor's kebab tag when known. Unique, empty-free —
 * mirrors cultiveraMediaTags so the library stays searchable per platform.
 */
export function growflowMediaTags(vendorLabel: string, kind: MediaSaveKind): string[] {
  const tags = ["growflow", kind === "coa" ? "coa" : "product-image"];
  const v = vendorTag(vendorLabel);
  if (v && !tags.includes(v)) tags.push(v);
  return tags;
}

/** "Blue Dream — Acme (GrowFlow)" / "Blue Dream COA (GrowFlow)". */
export function growflowMediaTitleForItem(
  item: Pick<MediaItemLike, "name" | "brand">,
  kind: MediaSaveKind,
): string {
  const name = (item.name ?? "").trim() || "GrowFlow menu item";
  if (kind === "coa") return `${name} COA (GrowFlow)`;
  const brand = (item.brand ?? "").trim();
  return brand ? `${name} — ${brand} (GrowFlow)` : `${name} (GrowFlow)`;
}

/** Alt text for a saved product image (COA docs don't need alt prose). */
export function growflowMediaAltForItem(
  item: Pick<MediaItemLike, "name" | "brand">,
  vendorLabel: string,
): string {
  const name = (item.name ?? "").trim() || "GrowFlow menu item";
  const vendor = vendorLabel.trim();
  return vendor ? `${name} product image from ${vendor}` : `${name} product image`;
}

/** Banner copy for the PO builder when a GrowFlow hand-off prefilled lines. */
export function growflowMenuPrefillBanner(count: number, vendorLabel: string | null): string {
  const items = `${count} item${count === 1 ? "" : "s"}`;
  const from = vendorLabel ? ` from ${vendorLabel}` : "";
  return `Started from a GrowFlow menu: ${items}${from} pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.`;
}

/* ------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`growflow-media-core self-test failed: ${msg}`);
}

export function __runGrowflowMediaCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // growflowMediaTags
  const imgTags = growflowMediaTags("Acme Farms", "image");
  ok(imgTags.join(",") === "growflow,product-image,acme-farms", `image tags (got ${imgTags.join(",")})`);
  const coaTags = growflowMediaTags("Acme Farms", "coa");
  ok(coaTags.join(",") === "growflow,coa,acme-farms", `coa tags (got ${coaTags.join(",")})`);
  ok(growflowMediaTags("", "image").join(",") === "growflow,product-image", "no vendor tag when unknown");
  ok(growflowMediaTags("COA", "coa").join(",") === "growflow,coa", "duplicate vendor tag not repeated");
  ok(growflowMediaTags("GrowFlow", "image").join(",") === "growflow,product-image", "platform-named vendor not repeated");

  // growflowMediaTitleForItem
  ok(
    growflowMediaTitleForItem({ name: "Blue Dream", brand: "Acme" }, "image") === "Blue Dream — Acme (GrowFlow)",
    "image title with brand",
  );
  ok(
    growflowMediaTitleForItem({ name: "Blue Dream", brand: null }, "image") === "Blue Dream (GrowFlow)",
    "image title no brand",
  );
  ok(
    growflowMediaTitleForItem({ name: "Blue Dream", brand: "Acme" }, "coa") === "Blue Dream COA (GrowFlow)",
    "coa title ignores brand",
  );
  ok(
    growflowMediaTitleForItem({ name: null, brand: null }, "image") === "GrowFlow menu item (GrowFlow)",
    "fallback name",
  );
  ok(
    growflowMediaTitleForItem({ name: "  ", brand: "Acme" }, "coa") === "GrowFlow menu item COA (GrowFlow)",
    "whitespace name falls back",
  );

  // growflowMediaAltForItem
  ok(
    growflowMediaAltForItem({ name: "Blue Dream", brand: "Acme" }, "Acme Farms") ===
      "Blue Dream product image from Acme Farms",
    "alt with vendor",
  );
  ok(
    growflowMediaAltForItem({ name: "Blue Dream", brand: null }, "") === "Blue Dream product image",
    "alt without vendor",
  );
  ok(
    growflowMediaAltForItem({ name: null, brand: null }, "  ") === "GrowFlow menu item product image",
    "alt fallback name, whitespace vendor",
  );

  // growflowMenuPrefillBanner
  ok(
    growflowMenuPrefillBanner(3, "Acme Farms") ===
      "Started from a GrowFlow menu: 3 items from Acme Farms pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
    "plural banner with vendor",
  );
  ok(
    growflowMenuPrefillBanner(1, null) ===
      "Started from a GrowFlow menu: 1 item pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
    "singular banner without vendor",
  );

  console.log(`growflow-media-core: ${n} self-tests passed`);
}
