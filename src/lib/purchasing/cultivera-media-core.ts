/**
 * src/lib/purchasing/cultivera-media-core.ts
 *
 * CV-5 — PURE planning/label helpers for saving Cultivera menu media
 * (product images + COA documents) into the media library. No imports, no
 * I/O — deterministic and self-tested in the pure runner.
 *
 * The server side (menus actions + cultivera-media.ts) uses these to decide
 * WHAT to save (planMediaSaves over saved rows), and how to title/tag each
 * asset so the library stays searchable ("cultivera" + vendor tag + kind).
 */

/** The subset of a saved menu-item row the media planner needs (structural). */
export type MediaItemLike = {
  id: string;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  coa_url: string | null;
  media_asset_id: string | null;
  coa_media_asset_id: string | null;
};

export type MediaSaveKind = "image" | "coa";

export type MediaSaveTask = {
  itemId: string;
  kind: MediaSaveKind;
  url: string;
};

/** True for a fetchable http(s) URL — anything else is skipped, never fetched. */
export function isHttpUrl(url: string | null): boolean {
  if (!url) return false;
  const u = url.trim().toLowerCase();
  return u.startsWith("http://") || u.startsWith("https://");
}

/**
 * Plan which downloads a bulk save should run: every item image / COA that
 * has a fetchable URL and is NOT already linked to a media asset. Items keep
 * menu order; each item's image comes before its COA. `limit` caps one run
 * (bulk saves are chunked so a big menu can't blow the action timeout);
 * limit <= 0 plans nothing.
 */
export function planMediaSaves(items: MediaItemLike[], limit: number): MediaSaveTask[] {
  const out: MediaSaveTask[] = [];
  if (limit <= 0) return out;
  for (const it of items) {
    if (out.length >= limit) break;
    if (!it.media_asset_id && isHttpUrl(it.image_url)) {
      out.push({ itemId: it.id, kind: "image", url: (it.image_url as string).trim() });
    }
    if (out.length >= limit) break;
    if (!it.coa_media_asset_id && isHttpUrl(it.coa_url)) {
      out.push({ itemId: it.id, kind: "coa", url: (it.coa_url as string).trim() });
    }
  }
  return out;
}

/** How many saves remain across the whole snapshot (no limit applied). */
export function remainingMediaCount(items: MediaItemLike[]): number {
  return planMediaSaves(items, Number.MAX_SAFE_INTEGER).length;
}

/** kebab-case tag from a free-text label (mirrors media taxonomy convention). */
export function vendorTag(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Tags for a saved asset: "cultivera", the kind ("product-image" | "coa"),
 * and the vendor's kebab tag when known. Unique, empty-free.
 */
export function cultiveraMediaTags(vendorLabel: string, kind: MediaSaveKind): string[] {
  const tags = ["cultivera", kind === "coa" ? "coa" : "product-image"];
  const v = vendorTag(vendorLabel);
  if (v && !tags.includes(v)) tags.push(v);
  return tags;
}

/** "Blue Dream — Acme (Cultivera)" / "Blue Dream COA (Cultivera)". */
export function mediaTitleForItem(
  item: Pick<MediaItemLike, "name" | "brand">,
  kind: MediaSaveKind,
): string {
  const name = (item.name ?? "").trim() || "Cultivera menu item";
  if (kind === "coa") return `${name} COA (Cultivera)`;
  const brand = (item.brand ?? "").trim();
  return brand ? `${name} — ${brand} (Cultivera)` : `${name} (Cultivera)`;
}

/** Alt text for a saved product image (COA docs don't need alt prose). */
export function mediaAltForItem(
  item: Pick<MediaItemLike, "name" | "brand">,
  vendorLabel: string,
): string {
  const name = (item.name ?? "").trim() || "Cultivera menu item";
  const vendor = vendorLabel.trim();
  return vendor ? `${name} product image from ${vendor}` : `${name} product image`;
}

/** "Saved 3 images and 2 COAs · 1 duplicate reused · 4 more to go" */
export function bulkSaveSummary(counts: {
  images: number;
  coas: number;
  deduped: number;
  failed: number;
  remaining: number;
}): string {
  const parts: string[] = [];
  const saved: string[] = [];
  if (counts.images > 0) saved.push(`${counts.images} image${counts.images === 1 ? "" : "s"}`);
  if (counts.coas > 0) saved.push(`${counts.coas} COA${counts.coas === 1 ? "" : "s"}`);
  parts.push(saved.length > 0 ? `Saved ${saved.join(" and ")}` : "Nothing new to save");
  if (counts.deduped > 0) parts.push(`${counts.deduped} duplicate${counts.deduped === 1 ? "" : "s"} reused`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (counts.remaining > 0) parts.push(`${counts.remaining} more to go — run again`);
  return parts.join(" · ");
}

/* ------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`cultivera-media-core self-test failed: ${msg}`);
}

function mk(over: Partial<MediaItemLike>): MediaItemLike {
  return {
    id: "i1",
    name: "Blue Dream",
    brand: "Acme",
    image_url: null,
    coa_url: null,
    media_asset_id: null,
    coa_media_asset_id: null,
    ...over,
  };
}

export function __runCultiveraMediaCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // isHttpUrl
  ok(isHttpUrl("https://cdn.example.com/a.png"), "https ok");
  ok(isHttpUrl("http://cdn.example.com/a.png"), "http ok");
  ok(isHttpUrl("  https://x.y/a.pdf  ") === true, "trims before checking");
  ok(!isHttpUrl(null), "null rejected");
  ok(!isHttpUrl(""), "empty rejected");
  ok(!isHttpUrl("ftp://x.y/a"), "ftp rejected");
  ok(!isHttpUrl("data:image/png;base64,xx"), "data uri rejected");
  ok(!isHttpUrl("/relative/path.png"), "relative rejected");

  // planMediaSaves
  const items: MediaItemLike[] = [
    mk({ id: "a", image_url: "https://c/a.png", coa_url: "https://c/a.pdf" }),
    mk({ id: "b", image_url: "https://c/b.png", media_asset_id: "already" }),
    mk({ id: "c", coa_url: "https://c/c.pdf", coa_media_asset_id: "already" }),
    mk({ id: "d", image_url: "not-a-url", coa_url: "https://c/d.pdf" }),
    mk({ id: "e" }),
  ];
  const plan = planMediaSaves(items, 100);
  ok(plan.length === 3, `plan finds 3 tasks (got ${plan.length})`);
  ok(plan[0].itemId === "a" && plan[0].kind === "image", "a image first");
  ok(plan[1].itemId === "a" && plan[1].kind === "coa", "a coa second");
  ok(plan[2].itemId === "d" && plan[2].kind === "coa", "d coa (bad image url skipped)");
  ok(planMediaSaves(items, 2).length === 2, "limit caps the plan");
  ok(planMediaSaves(items, 0).length === 0, "limit 0 plans nothing");
  ok(planMediaSaves(items, -5).length === 0, "negative limit plans nothing");
  ok(planMediaSaves([], 10).length === 0, "no items, no plan");
  ok(planMediaSaves(items, 100)[0].url === "https://c/a.png", "url passed through");

  // linked items are skipped entirely
  const allLinked = [mk({ id: "z", image_url: "https://c/z.png", media_asset_id: "m", coa_url: "https://c/z.pdf", coa_media_asset_id: "c" })];
  ok(planMediaSaves(allLinked, 10).length === 0, "fully linked item planned nothing");

  // remainingMediaCount
  ok(remainingMediaCount(items) === 3, "remaining counts all unlinked");
  ok(remainingMediaCount([]) === 0, "remaining 0 for empty");

  // vendorTag
  ok(vendorTag("Acme Farms LLC") === "acme-farms-llc", "kebab-cases");
  ok(vendorTag("  Fine & Dandy!  ") === "fine-dandy", "strips punctuation + trims dashes");
  ok(vendorTag("") === "", "empty stays empty");
  ok(vendorTag("A".repeat(60)).length === 40, "caps at 40 chars");

  // cultiveraMediaTags
  const imgTags = cultiveraMediaTags("Acme Farms", "image");
  ok(imgTags.join(",") === "cultivera,product-image,acme-farms", `image tags (got ${imgTags.join(",")})`);
  const coaTags = cultiveraMediaTags("Acme Farms", "coa");
  ok(coaTags.join(",") === "cultivera,coa,acme-farms", `coa tags (got ${coaTags.join(",")})`);
  ok(cultiveraMediaTags("", "image").join(",") === "cultivera,product-image", "no vendor tag when unknown");
  ok(cultiveraMediaTags("COA", "coa").join(",") === "cultivera,coa", "duplicate vendor tag not repeated");

  // mediaTitleForItem
  ok(mediaTitleForItem({ name: "Blue Dream", brand: "Acme" }, "image") === "Blue Dream — Acme (Cultivera)", "image title with brand");
  ok(mediaTitleForItem({ name: "Blue Dream", brand: null }, "image") === "Blue Dream (Cultivera)", "image title no brand");
  ok(mediaTitleForItem({ name: "Blue Dream", brand: "Acme" }, "coa") === "Blue Dream COA (Cultivera)", "coa title");
  ok(mediaTitleForItem({ name: null, brand: null }, "image") === "Cultivera menu item (Cultivera)", "fallback name");

  // mediaAltForItem
  ok(mediaAltForItem({ name: "Blue Dream", brand: "Acme" }, "Acme Farms") === "Blue Dream product image from Acme Farms", "alt with vendor");
  ok(mediaAltForItem({ name: "Blue Dream", brand: null }, "") === "Blue Dream product image", "alt without vendor");

  // bulkSaveSummary
  ok(
    bulkSaveSummary({ images: 3, coas: 2, deduped: 1, failed: 0, remaining: 4 }) ===
      "Saved 3 images and 2 COAs · 1 duplicate reused · 4 more to go — run again",
    "full summary",
  );
  ok(bulkSaveSummary({ images: 1, coas: 0, deduped: 0, failed: 0, remaining: 0 }) === "Saved 1 image", "singular image only");
  ok(bulkSaveSummary({ images: 0, coas: 1, deduped: 0, failed: 0, remaining: 0 }) === "Saved 1 COA", "singular coa only");
  ok(
    bulkSaveSummary({ images: 0, coas: 0, deduped: 0, failed: 2, remaining: 0 }) === "Nothing new to save · 2 failed",
    "failures reported",
  );
  ok(bulkSaveSummary({ images: 0, coas: 0, deduped: 3, failed: 0, remaining: 0 }) === "Nothing new to save · 3 duplicates reused", "dedupe-only run");

  console.log(`cultivera-media-core: ${n} self-tests passed`);
}
