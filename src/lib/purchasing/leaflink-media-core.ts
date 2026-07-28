/**
 * src/lib/purchasing/leaflink-media-core.ts
 *
 * SLICE 84 — PURE label helpers for saving LeafLink menu media (product
 * images + COA documents) into the media library, plus the PO hand-off
 * banner copy. Only imports other pure cores — no I/O, deterministic,
 * self-tested in the pure runner.
 *
 * Mirrors growflow-media-core.ts one-for-one. The PLANNING machinery
 * (planMediaSaves / remainingMediaCount / isHttpUrl / bulkSaveSummary) lives
 * in cultivera-media-core and is STRUCTURAL (MediaItemLike) — LeafLink rows
 * carry the same media columns, so those helpers are reused as-is. Same for
 * the PO mappers in cultivera-po-core (parseMenuItemIds / buildMenuPrefills
 * over MenuPrefillItemLike). This file only adds what actually differs:
 * platform-branded tags, titles, alt text, and banner copy.
 */

import { vendorTag, type MediaItemLike, type MediaSaveKind } from "./cultivera-media-core";

/**
 * Tags for a saved LeafLink asset: "leaflink", the kind ("product-image" |
 * "coa"), and the brand's kebab tag when known. Unique, empty-free —
 * mirrors growflowMediaTags so the library stays searchable per platform.
 */
export function leaflinkMediaTags(vendorLabel: string, kind: MediaSaveKind): string[] {
  const tags = ["leaflink", kind === "coa" ? "coa" : "product-image"];
  const v = vendorTag(vendorLabel);
  if (v && !tags.includes(v)) tags.push(v);
  return tags;
}

/** "Blue Dream — Acme (LeafLink)" / "Blue Dream COA (LeafLink)". */
export function leaflinkMediaTitleForItem(
  item: Pick<MediaItemLike, "name" | "brand">,
  kind: MediaSaveKind,
): string {
  const name = (item.name ?? "").trim() || "LeafLink menu item";
  if (kind === "coa") return `${name} COA (LeafLink)`;
  const brand = (item.brand ?? "").trim();
  return brand ? `${name} — ${brand} (LeafLink)` : `${name} (LeafLink)`;
}

/** Alt text for a saved product image (COA docs don't need alt prose). */
export function leaflinkMediaAltForItem(
  item: Pick<MediaItemLike, "name" | "brand">,
  vendorLabel: string,
): string {
  const name = (item.name ?? "").trim() || "LeafLink menu item";
  const vendor = vendorLabel.trim();
  return vendor ? `${name} product image from ${vendor}` : `${name} product image`;
}

/** Banner copy for the PO builder when a LeafLink hand-off prefilled lines. */
export function leaflinkMenuPrefillBanner(count: number, vendorLabel: string | null): string {
  const items = `${count} item${count === 1 ? "" : "s"}`;
  const from = vendorLabel ? ` from ${vendorLabel}` : "";
  return `Started from a LeafLink menu: ${items}${from} pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.`;
}

/* ------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`leaflink-media-core self-test failed: ${msg}`);
}

export function __runLeaflinkMediaCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // leaflinkMediaTags
  const imgTags = leaflinkMediaTags("Fairwinds Manufacturing", "image");
  ok(imgTags.join(",") === "leaflink,product-image,fairwinds-manufacturing", `image tags (got ${imgTags.join(",")})`);
  const coaTags = leaflinkMediaTags("Fairwinds Manufacturing", "coa");
  ok(coaTags.join(",") === "leaflink,coa,fairwinds-manufacturing", `coa tags (got ${coaTags.join(",")})`);
  ok(leaflinkMediaTags("", "image").join(",") === "leaflink,product-image", "no vendor tag when unknown");
  ok(leaflinkMediaTags("COA", "coa").join(",") === "leaflink,coa", "duplicate vendor tag not repeated");
  ok(leaflinkMediaTags("LeafLink", "image").join(",") === "leaflink,product-image", "platform-named vendor not repeated");

  // leaflinkMediaTitleForItem
  ok(
    leaflinkMediaTitleForItem({ name: "Deep Sleep Tincture", brand: "Fairwinds" }, "image") ===
      "Deep Sleep Tincture — Fairwinds (LeafLink)",
    "image title with brand",
  );
  ok(
    leaflinkMediaTitleForItem({ name: "Deep Sleep Tincture", brand: null }, "image") ===
      "Deep Sleep Tincture (LeafLink)",
    "image title no brand",
  );
  ok(
    leaflinkMediaTitleForItem({ name: "Deep Sleep Tincture", brand: "Fairwinds" }, "coa") ===
      "Deep Sleep Tincture COA (LeafLink)",
    "coa title ignores brand",
  );
  ok(
    leaflinkMediaTitleForItem({ name: null, brand: null }, "image") === "LeafLink menu item (LeafLink)",
    "fallback name",
  );
  ok(
    leaflinkMediaTitleForItem({ name: "  ", brand: "Fairwinds" }, "coa") ===
      "LeafLink menu item COA (LeafLink)",
    "whitespace name falls back",
  );

  // leaflinkMediaAltForItem
  ok(
    leaflinkMediaAltForItem({ name: "Deep Sleep Tincture", brand: "Fairwinds" }, "Fairwinds Manufacturing") ===
      "Deep Sleep Tincture product image from Fairwinds Manufacturing",
    "alt with vendor",
  );
  ok(
    leaflinkMediaAltForItem({ name: "Deep Sleep Tincture", brand: null }, "") ===
      "Deep Sleep Tincture product image",
    "alt without vendor",
  );
  ok(
    leaflinkMediaAltForItem({ name: null, brand: null }, "  ") === "LeafLink menu item product image",
    "alt fallback name, whitespace vendor",
  );

  // leaflinkMenuPrefillBanner
  ok(
    leaflinkMenuPrefillBanner(3, "Fairwinds Manufacturing") ===
      "Started from a LeafLink menu: 3 items from Fairwinds Manufacturing pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
    "plural banner with vendor",
  );
  ok(
    leaflinkMenuPrefillBanner(1, null) ===
      "Started from a LeafLink menu: 1 item pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
    "singular banner without vendor",
  );

  console.log(`leaflink-media-core: ${n} self-tests passed`);
}
