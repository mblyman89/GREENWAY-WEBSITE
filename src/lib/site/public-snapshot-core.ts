/**
 * public-snapshot-core.ts - DB HEALTH round, slice A (owner 2026-11-06: "Every few hours the
 * database will become unhealthy ... This has to be something we are doing ... I want a healthy
 * db always.")
 *
 * PURE. The shapes and lookups behind the PUBLIC-SITE READ SNAPSHOTS.
 *
 * WHAT WAS WRONG (measured on production, 2026-11-05/06): the database runs on Supabase's Micro
 * compute (1 GB RAM, shared CPU). Twice in six hours it stopped answering and restarted with
 * crash recovery (21:07 and 02:24 UTC). Each time, the minutes before were a burst of 2,000 to
 * 7,000 API requests a minute from our own website server (user agent "node"): about 1,600 a
 * minute of the SAME eight content_blocks lookups (footer warning, footer hours image, business
 * hours, social links, brand kit, fonts...) and about 800 a minute of whole-menu
 * product_enrichments chunks, plus overrides and DOH registry chunks. Every public page render
 * (home, shop, every category, every one of ~800 product pages a crawler walks) asked the
 * database those same questions again, because these overlays had no cross-request cache.
 *
 * WHAT THIS DOES: each of those small, rarely-changing tables is read ONCE per
 * PUBLIC_SNAPSHOT_TTL_SECONDS into a snapshot shared by every render, and the per-render work is
 * an in-memory lookup. The functions here are the lookups, so they are unit-tested without a
 * database. A snapshot that is too big (row count over its cap) is refused and the caller uses
 * the original keyed read, so growth makes the site slower, never wrong.
 *
 * NEVER MONEY: these snapshots feed DISPLAY only (words on the page, product photos, the
 * category a card is filed under, the DOH pill). Prices, stock, carts, sales, taxes and CCRS never
 * read them. ("Cache the display. Never cache the money.")
 */

/** Same floor as the menu cache: a change shows on the site within a minute at the latest. */
export const PUBLIC_SNAPSHOT_TTL_SECONDS = 60;

/** Cache tag for the content-block snapshot. Content saves clear it (plus the layout path). */
export const PUBLIC_CONTENT_TAG = "public-content";

/** Row caps: a bigger table is not snapshotted (the keyed read is used instead). */
export const SNAPSHOT_CAPS = {
  contentBlocks: 5000,
  enrichments: 8000,
  overrides: 20000,
  medicalRegistry: 20000,
} as const;

export type ContentBlockRow = {
  block_key: string;
  published_value: string | null;
  draft_value: string | null;
  status: string;
};

/** True when a snapshot of `rows` rows is within `cap` (and the count is sane). */
export function withinCap(rows: number, cap: number): boolean {
  return Number.isFinite(rows) && rows >= 0 && rows <= cap;
}

/**
 * The value a PUBLIC (non-preview) visitor sees for one block: the published value when the
 * block is published, else the seed fallback. Identical to render-content's original rule.
 */
export function publicContentValue(row: ContentBlockRow | null | undefined, fallback: string): string {
  if (!row) return fallback;
  if (row.status === "published" && row.published_value != null) return row.published_value;
  return fallback;
}

/** Index rows by block_key (first row wins; keys are unique in the table). */
export function indexContentBlocks(rows: readonly ContentBlockRow[]): Map<string, ContentBlockRow> {
  const m = new Map<string, ContentBlockRow>();
  for (const r of rows) {
    if (r && typeof r.block_key === "string" && !m.has(r.block_key)) m.set(r.block_key, r);
  }
  return m;
}

/** Resolve many keys at once (public view), starting from the seed defaults. */
export function publicContentValues(
  index: ReadonlyMap<string, ContentBlockRow>,
  keys: readonly string[],
  seed: (key: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = publicContentValue(index.get(k), seed(k));
  return out;
}

// ---------------------------------------------------------------------------
// Published enrichment images (exact + S20 identity borrow)
// ---------------------------------------------------------------------------

export type EnrichmentImageRow = {
  id: string;
  pos_product_key: string;
  status: string;
  updated_at: string | null;
  identity_key: string | null;
  primary_media_id: string | null;
  image_media_ids: string[] | null;
};

export type EnrichmentImageSnapshot = {
  rows: EnrichmentImageRow[];
  /** [media id, public URL] pairs for every media id the rows point at. */
  mediaUrls: Array<[string, string]>;
};

/** The media id a published row shows: primary, else the first gallery image. */
export function mediaIdOf(r: Pick<EnrichmentImageRow, "primary_media_id" | "image_media_ids">): string | null {
  return r.primary_media_id || (r.image_media_ids ?? [])[0] || null;
}

/** Every media id the snapshot must resolve to a URL. */
export function neededMediaIds(rows: readonly EnrichmentImageRow[]): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    if (r.status !== "published") continue;
    const m = mediaIdOf(r);
    if (m) s.add(m);
  }
  return [...s];
}

/**
 * posKey -> URL of the card's OWN published image. Same rule as image-resolver's
 * batchExactImages: a published row for that key, with a media id that resolves to a URL.
 */
export function exactImagesFromSnapshot(snap: EnrichmentImageSnapshot, posKeys: readonly string[]): Map<string, string> {
  const urls = new Map(snap.mediaUrls);
  const byKey = new Map<string, string>();
  for (const r of snap.rows) {
    if (r.status !== "published") continue;
    const m = mediaIdOf(r);
    if (m && !byKey.has(r.pos_product_key)) byKey.set(r.pos_product_key, m);
  }
  const out = new Map<string, string>();
  for (const k of new Set(posKeys)) {
    if (!k) continue;
    const m = byKey.get(k);
    const url = m ? urls.get(m) : undefined;
    if (url) out.set(k, url);
  }
  return out;
}

/**
 * posKey -> URL borrowed from the product's published SURVIVOR row (S20). `survivorOf` is the
 * identity index (enrichment-identity-core indexPublishedByIdentity) so the pick rule is shared,
 * never re-implemented. A survivor that IS the card's own row is skipped, exactly like
 * batchIdentityImages.
 */
export function identityImagesFromSnapshot(
  snap: EnrichmentImageSnapshot,
  items: ReadonlyArray<{ posKey: string; identityKey?: string | null }>,
  survivorOf: (rows: readonly EnrichmentImageRow[]) => ReadonlyMap<string, { row: EnrichmentImageRow }>,
): Map<string, string> {
  const out = new Map<string, string>();
  const withId = items.filter((i) => Boolean(i.identityKey?.trim()));
  if (withId.length === 0) return out;
  const survivors = survivorOf(snap.rows.filter((r) => r.status === "published"));
  const urls = new Map(snap.mediaUrls);
  for (const it of withId) {
    const hit = survivors.get(it.identityKey!.trim());
    if (!hit || hit.row.pos_product_key === it.posKey) continue;
    const m = mediaIdOf(hit.row);
    const url = m ? urls.get(m) : undefined;
    if (url) out.set(it.posKey, url);
  }
  return out;
}

/** Keep only the entries whose key is in `keys` (for keyed overlays served from a full snapshot). */
export function pickKeys<V>(all: ReadonlyArray<[string, V]>, keys: readonly string[]): Map<string, V> {
  const want = new Set(keys.filter((k) => typeof k === "string" && k.trim().length > 0));
  const out = new Map<string, V>();
  for (const [k, v] of all) if (want.has(k)) out.set(k, v);
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPublicSnapshotTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  x public-snapshot-core: ${name}`);
    }
  };

  // caps
  ok(withinCap(0, 10) && withinCap(10, 10), "within cap at 0 and at the cap");
  ok(!withinCap(11, 10), "over the cap is refused");
  ok(!withinCap(-1, 10) && !withinCap(Number.NaN, 10), "nonsense counts are refused");
  ok(PUBLIC_SNAPSHOT_TTL_SECONDS === 60, "ttl is one minute (same floor as the menu)");

  // content
  const rows: ContentBlockRow[] = [
    { block_key: "a", published_value: "A!", draft_value: "a-draft", status: "published" },
    { block_key: "b", published_value: null, draft_value: "b-draft", status: "published" },
    { block_key: "c", published_value: "C!", draft_value: null, status: "draft" },
    { block_key: "a", published_value: "dup", draft_value: null, status: "published" },
  ];
  const idx = indexContentBlocks(rows);
  ok(idx.size === 3 && idx.get("a")!.published_value === "A!", "index: first row wins, keys unique");
  ok(publicContentValue(idx.get("a"), "seed") === "A!", "published value shown");
  ok(publicContentValue(idx.get("b"), "seed") === "seed", "published with null value falls back to seed");
  ok(publicContentValue(idx.get("c"), "seed") === "seed", "unpublished block shows the seed, never the draft");
  ok(publicContentValue(undefined, "seed") === "seed", "missing row shows the seed");
  const many = publicContentValues(idx, ["a", "c", "zz"], (k) => `seed-${k}`);
  ok(many.a === "A!" && many.c === "seed-c" && many.zz === "seed-zz", "many keys resolve with per-key seeds");
  ok(!JSON.stringify(many).includes("draft"), "public view never leaks a draft value");

  // enrichment images
  const snap: EnrichmentImageSnapshot = {
    rows: [
      { id: "e1", pos_product_key: "OWN", status: "published", updated_at: "2026-01-02", identity_key: "x|f|own", primary_media_id: "m2", image_media_ids: [] },
      { id: "e2", pos_product_key: "LOT-OLD", status: "published", updated_at: "2026-01-01", identity_key: "id|f|bd", primary_media_id: null, image_media_ids: ["m1"] },
      { id: "e3", pos_product_key: "DRAFTY", status: "draft", updated_at: "2026-01-01", identity_key: null, primary_media_id: "m9", image_media_ids: [] },
      { id: "e4", pos_product_key: "GONE", status: "published", updated_at: "2026-01-01", identity_key: null, primary_media_id: "m-gone", image_media_ids: [] },
    ],
    mediaUrls: [
      ["m1", "https://cdn/1.jpg"],
      ["m2", "https://cdn/2.jpg"],
      ["m9", "https://cdn/9.jpg"],
    ],
  };
  ok(mediaIdOf({ primary_media_id: null, image_media_ids: ["g1", "g2"] }) === "g1", "gallery first image when no primary");
  ok(mediaIdOf({ primary_media_id: null, image_media_ids: null }) === null, "no media -> null");
  const need = neededMediaIds(snap.rows);
  ok(need.includes("m1") && need.includes("m2") && !need.includes("m9"), "only published rows need media");
  const exact = exactImagesFromSnapshot(snap, ["OWN", "LOT-OLD", "DRAFTY", "GONE", "NOPE", "OWN"]);
  ok(exact.get("OWN") === "https://cdn/2.jpg", "own published primary image");
  ok(exact.get("LOT-OLD") === "https://cdn/1.jpg", "own published gallery image");
  ok(!exact.has("DRAFTY"), "a draft row never shows on the public site");
  ok(!exact.has("GONE"), "a media id with no URL shows nothing (resolver moves down the ladder)");
  ok(!exact.has("NOPE") && exact.size === 2, "unknown keys absent");

  const survivorOf = (rs: readonly EnrichmentImageRow[]) => {
    const m = new Map<string, { row: EnrichmentImageRow }>();
    for (const r of rs) if (r.identity_key && !m.has(r.identity_key)) m.set(r.identity_key, { row: r });
    return m;
  };
  const borrowed = identityImagesFromSnapshot(
    snap,
    [
      { posKey: "LOT-NEW", identityKey: "id|f|bd" },
      { posKey: "LOT-OLD", identityKey: "id|f|bd" },
      { posKey: "NOID" },
      { posKey: "BLANK", identityKey: "   " },
    ],
    survivorOf,
  );
  ok(borrowed.get("LOT-NEW") === "https://cdn/1.jpg", "new lot borrows its product's published photo");
  ok(!borrowed.has("LOT-OLD"), "a card never borrows from its OWN row");
  ok(!borrowed.has("NOID") && !borrowed.has("BLANK"), "no identity -> no borrow");

  // keyed pick
  const picked = pickKeys([["k1", 1], ["k2", 2], ["k3", 3]], ["k1", "k3", "", "zz"]);
  ok(picked.size === 2 && picked.get("k1") === 1 && picked.get("k3") === 3, "pickKeys keeps only asked-for keys");
  ok(pickKeys([["k1", 1]], []).size === 0, "pickKeys with no keys is empty");

  return { passed, failed };
}
