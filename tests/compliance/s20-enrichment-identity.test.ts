/**
 * tests/compliance/s20-enrichment-identity.test.ts   (Round 20, slice S20)
 *
 * Bible S20: "Enrichment follows the product, not the lot key."
 * Acceptance S20.6: "Enriching a card once serves every future lot merged
 * into it."
 *
 * The pure rules live in enrichment-identity-core (85 embedded self-tests,
 * pinned below). This suite runs the REAL server modules through the REAL
 * @supabase/postgrest-js client against the in-memory PostgREST
 * (helpers/fake-postgrest), so the wire shape is what is proven: which
 * filters go out, that a pre-0234 database degrades to pre-S20 behaviour,
 * that writes are conditional (`identity_key IS NULL`), and that the flag
 * off makes NO identity request at all.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type FakeRequest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () =>
      new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});

import {
  ENRICHMENT_IDENTITY_ENV,
  __runEnrichmentIdentityCoreTests,
  enrichmentIdentityForItem,
} from "@/lib/enrichment/enrichment-identity-core";
import {
  identityForCardKey,
  loadPublishedEnrichmentsByIdentity,
  mergeColumns,
  runIdentityBackfill,
} from "@/lib/enrichment/enrichment-identity-server";
import { ensureEnrichment, getEnrichmentForItem, resolveEnrichmentsForItems } from "@/lib/enrichment/store";
import { resolveProductImagesBatch } from "@/lib/enrichment/image-resolver";
import { menuRowToGreenwayItem } from "@/lib/pos/live-menu";
import { toMenuGridItems } from "@/lib/menu/menu-grid-projection-core";
import { queryFor } from "@/lib/menu/product-knowledge-display";
import type { MenuItemRow } from "@/lib/pos/db-types";
import type { ProductEnrichment } from "@/lib/enrichment/types";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const ID = "grow-op-farms|flower|blue-dream";
const V = "11111111-0000-4000-8000-000000000001";
const prevEnv = process.env[ENRICHMENT_IDENTITY_ENV];

function menuRow(over: Partial<MenuItemRow> & { source_item_id: string }): Row {
  return {
    id: `mi-${over.source_item_id}`,
    menu_version_id: V,
    name: "Blue Dream 3.5g",
    product_name: "Blue Dream",
    brand_name: "Phat Panda",
    vendor_name: "Grow Op Farms",
    category: "Flower",
    description: "",
    ...over,
  };
}

function enrichment(over: Partial<ProductEnrichment> & { pos_product_key: string }): Row {
  return {
    id: `e-${over.pos_product_key}`,
    status: "published",
    updated_at: "2026-01-01T00:00:00Z",
    identity_key: null,
    description: null,
    short_description: null,
    display_name: null,
    image_media_ids: [],
    primary_media_id: null,
    tags: [],
    brand_id: null,
    ...over,
  };
}

const enrichmentGets = (db: FakePostgrest) => db.log.filter((r) => r.method === "GET" && r.table === "product_enrichments");
const identityReads = (db: FakePostgrest) =>
  enrichmentGets(db).filter((r) => (r.url.searchParams.get("identity_key") ?? "").startsWith("in."));
const patches = (db: FakePostgrest, table = "product_enrichments") => db.log.filter((r) => r.method === "PATCH" && r.table === table);

/** A PostgREST answer for a database without migration 0234. */
function pre0234(req: FakeRequest): { status: number; body: unknown } | void {
  const sel = req.url.searchParams.get("select") ?? "";
  const touchesIdentity =
    req.table === "product_enrichments" &&
    (sel.includes("identity_key") ||
      req.url.searchParams.has("identity_key") ||
      (req.body && typeof req.body === "object" && "identity_key" in (req.body as object)));
  if (touchesIdentity) {
    return { status: 400, body: { code: "42703", details: null, hint: null, message: "column product_enrichments.identity_key does not exist" } };
  }
}

beforeEach(() => {
  st.db = new FakePostgrest();
  st.db.rows("menu_versions").push({ id: V, status: "published" });
  delete process.env[ENRICHMENT_IDENTITY_ENV];
});
afterEach(() => {
  if (prevEnv === undefined) delete process.env[ENRICHMENT_IDENTITY_ENV];
  else process.env[ENRICHMENT_IDENTITY_ENV] = prevEnv;
  vi.restoreAllMocks();
});

describe("S20 pure core", () => {
  it("embedded self-tests: exactly 85 pass, 0 fail (pinned)", () => {
    expect(__runEnrichmentIdentityCoreTests()).toEqual({ passed: 85, failed: 0 });
  });
  it("the runner registers them with the exact floor", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(
      /assertRan\("enrichment-identity-core", __runEnrichmentIdentityCoreTests\(\), 85\)/,
    );
  });
  it("two lots of one product share ONE identity; the size/label does not split it", () => {
    const a = enrichmentIdentityForItem(menuRow({ source_item_id: "LOT-A" }) as unknown as MenuItemRow);
    const b = enrichmentIdentityForItem(menuRow({ source_item_id: "LOT-B", name: "Blue Dream 1g" }) as unknown as MenuItemRow);
    expect(a).toBe(ID);
    expect(b).toBe(ID);
  });
  it("mergeColumns keeps each column once, first wins", () => {
    expect(mergeColumns("pos_product_key, description", "id, pos_product_key, status")).toBe("pos_product_key, description, id, status");
  });
});

describe("loadPublishedEnrichmentsByIdentity (the one shared identity read)", () => {
  it("flag OFF: returns empty and sends NO request", async () => {
    process.env[ENRICHMENT_IDENTITY_ENV] = "off";
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "LOT-A", identity_key: ID, description: "x" }));
    const m = await loadPublishedEnrichmentsByIdentity([ID], "description");
    expect(m.size).toBe(0);
    expect(st.db.log).toEqual([]);
  });
  it("each off-word switches it off; anything else keeps it on", async () => {
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "LOT-A", identity_key: ID, description: "x" }));
    for (const w of ["off", "0", "false", "no", "disabled", "OFF", " Off "]) {
      process.env[ENRICHMENT_IDENTITY_ENV] = w;
      expect((await loadPublishedEnrichmentsByIdentity([ID], "description")).size, w).toBe(0);
    }
    for (const w of ["on", "yes", "1", "typo"]) {
      process.env[ENRICHMENT_IDENTITY_ENV] = w;
      expect((await loadPublishedEnrichmentsByIdentity([ID], "description")).size, w).toBe(1);
    }
  });
  it("no keys (or blank keys): no request", async () => {
    expect((await loadPublishedEnrichmentsByIdentity(["", "  "], "description")).size).toBe(0);
    expect(st.db.log).toEqual([]);
  });
  it("PUBLISHED only, newest wins, filters on the wire are identity_key=in + status=eq.published", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    st.db.rows("product_enrichments").push(
      enrichment({ pos_product_key: "OLD", identity_key: ID, description: "old", updated_at: "2026-01-01T00:00:00Z" }),
      enrichment({ pos_product_key: "NEW", identity_key: ID, description: "new", updated_at: "2026-03-01T00:00:00Z" }),
      enrichment({ pos_product_key: "DRAFT", identity_key: ID, description: "draft", status: "draft", updated_at: "2026-09-01T00:00:00Z" }),
    );
    const m = await loadPublishedEnrichmentsByIdentity<ProductEnrichment & { id: string }>([ID, ID], "description");
    expect(m.get(ID)?.pos_product_key).toBe("NEW");
    const req = identityReads(st.db)[0];
    expect(req.url.searchParams.get("status")).toBe("eq.published");
    // de-duplicated keys: ONE identity in the list
    expect(req.url.searchParams.get("identity_key")).toMatch(new RegExp(`^in\\.\\("?${ID.replace(/[|]/g, "\\|")}"?\\)$`));
    const cols = (req.url.searchParams.get("select") ?? "").split(",").map((c) => c.trim());
    for (const c of ["description", "id", "pos_product_key", "status", "updated_at", "identity_key"]) expect(cols).toContain(c);
    expect(new Set(cols).size).toBe(cols.length);
    // the duplicate is logged once as a merge suggestion (bible S20.8)
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("merge suggested");
  });
  it('"*" is passed through untouched (never "*, id, ...")', async () => {
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "A", identity_key: ID, description: "x" }));
    await loadPublishedEnrichmentsByIdentity([ID], "*");
    expect(identityReads(st.db)[0].url.searchParams.get("select")).toBe("*");
  });
  it("pre-0234 database (identity_key unknown): empty map, no throw", async () => {
    st.db.before = pre0234;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await loadPublishedEnrichmentsByIdentity([ID], "description")).size).toBe(0);
    expect(err).not.toHaveBeenCalled();
  });
  it("any OTHER error: empty map and a logged error (fail toward pre-S20)", async () => {
    st.db.before = (req) => (req.table === "product_enrichments" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await loadPublishedEnrichmentsByIdentity([ID], "description")).size).toBe(0);
    expect(err).toHaveBeenCalled();
  });
});

describe("identityForCardKey (stamping source: the RAW published menu row)", () => {
  it("computes the identity from the published version's row", async () => {
    st.db.rows("menu_items").push(menuRow({ source_item_id: "LOT-A" }));
    expect(await identityForCardKey("LOT-A")).toBe(ID);
    const mi = st.db.log.find((r) => r.table === "menu_items")!;
    expect(mi.url.searchParams.get("menu_version_id")).toBe(`eq.${V}`);
    expect(mi.url.searchParams.get("source_item_id")).toBe("eq.LOT-A");
  });
  it("no card / no vendor+brand / two disagreeing rows -> null", async () => {
    expect(await identityForCardKey("NOPE")).toBeNull();
    st.db.rows("menu_items").push(menuRow({ source_item_id: "BARE", brand_name: "", vendor_name: null }));
    expect(await identityForCardKey("BARE")).toBeNull();
    st.db.rows("menu_items").push(menuRow({ source_item_id: "TWO" }), menuRow({ source_item_id: "TWO", product_name: "Other" }));
    expect(await identityForCardKey("TWO")).toBeNull();
  });
  it("flag off: null and no request", async () => {
    process.env[ENRICHMENT_IDENTITY_ENV] = "off";
    st.db.rows("menu_items").push(menuRow({ source_item_id: "LOT-A" }));
    expect(await identityForCardKey("LOT-A")).toBeNull();
    expect(st.db.log).toEqual([]);
  });
});

describe("ensureEnrichment: new rows are born linked to their product", () => {
  it("insert carries identity_key from the raw menu row", async () => {
    st.db.rows("menu_items").push(menuRow({ source_item_id: "LOT-A" }));
    const row = await ensureEnrichment("LOT-A", { name: "Blue Dream 3.5g" }, null);
    expect(row.identity_key).toBe(ID);
    expect(st.db.rows("product_enrichments")[0].identity_key).toBe(ID);
  });
  it("an existing UNSTAMPED row is gap-filled with a conditional update (identity_key IS NULL)", async () => {
    st.db.rows("menu_items").push(menuRow({ source_item_id: "LOT-A" }));
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "LOT-A", status: "draft" }));
    const row = await ensureEnrichment("LOT-A", {}, null);
    expect(row.identity_key).toBe(ID);
    const p = patches(st.db)[0];
    expect(p.url.searchParams.get("identity_key")).toBe("is.null");
    expect(p.url.searchParams.get("id")).toBe("eq.e-LOT-A");
    expect(p.body).toEqual({ identity_key: ID });
  });
  it("an already-stamped row is never touched (no update request at all)", async () => {
    st.db.rows("menu_items").push(menuRow({ source_item_id: "LOT-A" }));
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "LOT-A", identity_key: "someone|else|set-this" }));
    const row = await ensureEnrichment("LOT-A", {}, null);
    expect(row.identity_key).toBe("someone|else|set-this");
    expect(patches(st.db)).toEqual([]);
  });
  it("a racing writer that stamps first wins (the conditional update matches nothing)", async () => {
    st.db.rows("menu_items").push(menuRow({ source_item_id: "LOT-A" }));
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "LOT-A" }));
    st.db.before = (req) => {
      if (req.method === "PATCH") st.db.rows("product_enrichments")[0].identity_key = "racer|flower|won";
    };
    await ensureEnrichment("LOT-A", {}, null);
    expect(st.db.rows("product_enrichments")[0].identity_key).toBe("racer|flower|won");
  });
  it("pre-0234: the insert is retried WITHOUT identity_key and succeeds", async () => {
    st.db.rows("menu_items").push(menuRow({ source_item_id: "LOT-A" }));
    st.db.before = (req) => (req.method === "POST" ? pre0234(req) : undefined);
    const row = await ensureEnrichment("LOT-A", { name: "n" }, null);
    expect(row.pos_product_key).toBe("LOT-A");
    const posts = st.db.log.filter((r) => r.method === "POST");
    expect(posts.length).toBe(2);
    expect(posts[1].body).not.toHaveProperty("identity_key");
  });
  it("flag off: the insert is exactly pre-S20 (no identity_key, no menu read)", async () => {
    process.env[ENRICHMENT_IDENTITY_ENV] = "off";
    st.db.rows("menu_items").push(menuRow({ source_item_id: "LOT-A" }));
    await ensureEnrichment("LOT-A", {}, null);
    expect(st.db.log.some((r) => r.table === "menu_items")).toBe(false);
    expect(st.db.log.find((r) => r.method === "POST")!.body).not.toHaveProperty("identity_key");
  });
});

describe("the read ladder: own row with content first, then the PRODUCT's published row", () => {
  const card = (key: string) => menuRow({ source_item_id: key }) as unknown as MenuItemRow;

  it("S20.6: a NEW lot with no row of its own is served the product's published record", async () => {
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "LOT-OLD", identity_key: ID, description: "Written once." }));
    const r = await getEnrichmentForItem(card("LOT-NEW"));
    expect(r.via).toBe("identity");
    expect(r.row?.description).toBe("Written once.");
    expect(r.own).toBeNull();
  });
  it("own row WITH content wins (Q-03) and no identity read is made", async () => {
    st.db.rows("product_enrichments").push(
      enrichment({ pos_product_key: "LOT-OLD", identity_key: ID, description: "product copy" }),
      enrichment({ pos_product_key: "LOT-NEW", description: "this card's own copy", status: "draft" }),
    );
    const r = await getEnrichmentForItem(card("LOT-NEW"));
    expect(r.via).toBe("pos_key");
    expect(r.row?.description).toBe("this card's own copy");
    expect(identityReads(st.db)).toEqual([]);
  });
  it("own row that is BLANK (lazy-init) does not block borrowing; own is still returned for writes", async () => {
    st.db.rows("product_enrichments").push(
      enrichment({ pos_product_key: "LOT-OLD", identity_key: ID, description: "product copy" }),
      enrichment({ pos_product_key: "LOT-NEW", status: "draft" }),
    );
    const r = await getEnrichmentForItem(card("LOT-NEW"));
    expect(r.via).toBe("identity");
    expect(r.row?.pos_product_key).toBe("LOT-OLD");
    expect(r.own?.pos_product_key).toBe("LOT-NEW");
  });
  it("a DRAFT record of the product is never borrowed", async () => {
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "LOT-OLD", identity_key: ID, description: "x", status: "draft" }));
    const r = await getEnrichmentForItem(card("LOT-NEW"));
    expect(r.via).toBe("none");
    expect(r.row).toBeNull();
  });
  it("flag off: exactly the own-key read", async () => {
    process.env[ENRICHMENT_IDENTITY_ENV] = "off";
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "LOT-OLD", identity_key: ID, description: "x" }));
    const r = await getEnrichmentForItem(card("LOT-NEW"));
    expect(r.row).toBeNull();
    expect(identityReads(st.db)).toEqual([]);
  });
  it("list page batch: ONE identity read for all cards that need it; own-content cards are not asked about", async () => {
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "LOT-OLD", identity_key: ID, description: "copy" }));
    const own = new Map<string, ProductEnrichment>([
      ["LOT-OLD", st.db.rows("product_enrichments")[0] as unknown as ProductEnrichment],
    ]);
    const items = [card("LOT-OLD"), card("LOT-N1"), card("LOT-N2"), menuRow({ source_item_id: "BARE", brand_name: "", vendor_name: null }) as unknown as MenuItemRow];
    const { byKey, viaIdentity } = await resolveEnrichmentsForItems(items, own);
    expect(identityReads(st.db).length).toBe(1);
    expect([...viaIdentity].sort()).toEqual(["LOT-N1", "LOT-N2"]);
    expect(byKey.get("LOT-N1")?.description).toBe("copy");
    expect(byKey.has("BARE")).toBe(false);
    expect(byKey.get("LOT-OLD")?.pos_product_key).toBe("LOT-OLD");
  });
});

describe("images: a new lot shows its product's published photo (still 'exact')", () => {
  it("batch: borrowed when the lot has no own image; own image wins; flag off borrows nothing", async () => {
    st.db.rows("product_enrichments").push(
      enrichment({ pos_product_key: "LOT-OLD", identity_key: ID, primary_media_id: "m-1" }),
      enrichment({ pos_product_key: "OWN", identity_key: "x|flower|own", primary_media_id: "m-2" }),
    );
    st.db.rows("media_assets").push(
      { id: "m-1", storage_key: "k1", public_url: "https://cdn.test/1.jpg" },
      { id: "m-2", storage_key: "k2", public_url: "https://cdn.test/2.jpg" },
    );
    const q = [
      { posKey: "LOT-NEW", identityKey: ID },
      { posKey: "OWN", identityKey: ID },
      { posKey: "NOID" },
    ];
    const r = await resolveProductImagesBatch(q);
    expect(r.get("LOT-NEW")?.source).toBe("exact");
    expect(r.get("LOT-NEW")?.isFallback).toBe(false);
    expect(r.get("LOT-NEW")?.url).toMatch(/1\.jpg$|\/k1$/);
    expect(r.get("OWN")?.url).toMatch(/2\.jpg$|\/k2$/);
    expect(r.has("NOID")).toBe(false);

    st.db = new FakePostgrest();
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "LOT-OLD", identity_key: ID, primary_media_id: "m-1" }));
    st.db.rows("media_assets").push({ id: "m-1", storage_key: "k1", public_url: "https://cdn.test/1.jpg" });
    process.env[ENRICHMENT_IDENTITY_ENV] = "off";
    const off = await resolveProductImagesBatch([{ posKey: "LOT-NEW", identityKey: ID }]);
    expect(off.has("LOT-NEW")).toBe(false);
    expect(identityReads(st.db)).toEqual([]);
  });
});

describe("identity rides on the menu item from the RAW row, and never reaches the client grid", () => {
  it("menuRowToGreenwayItem computes it; the grid projection strips it; queryFor passes it to the ladder", () => {
    const item = menuRowToGreenwayItem({
      ...(menuRow({ source_item_id: "LOT-A" }) as unknown as MenuItemRow),
      filter_categories: [],
      variants: [],
      price_minor_units: 1000,
      inventory_status: "in-stock",
      hidden: false,
    } as unknown as Parameters<typeof menuRowToGreenwayItem>[0]);
    expect(item.identityKey).toBe(ID);
    expect(queryFor(item).identityKey).toBe(ID);
    // a display overlay that rewrites brand/vendor does not change the identity
    expect(queryFor({ ...item, brand: "PP", vendor: "GOF" }).identityKey).toBe(ID);
    const [grid] = toMenuGridItems([item]);
    expect(grid).not.toHaveProperty("identityKey");
  });
});

describe("backfill: 'set identity_key on existing product_enrichments from menu_items'", () => {
  function seed() {
    st.db.rows("menu_items").push(
      menuRow({ source_item_id: "A" }),
      menuRow({ source_item_id: "B", name: "Blue Dream 1g" }),
      menuRow({ source_item_id: "C", product_name: "Gelato", name: "Gelato 3.5g" }),
      menuRow({ source_item_id: "BARE", brand_name: "", vendor_name: null }),
    );
    st.db.rows("product_enrichments").push(
      enrichment({ pos_product_key: "A", description: "a" }),
      enrichment({ pos_product_key: "B", description: "b", updated_at: "2026-02-01T00:00:00Z" }),
      enrichment({ pos_product_key: "C", identity_key: "someone|flower|kept" }),
      enrichment({ pos_product_key: "BARE" }),
      enrichment({ pos_product_key: "GONE" }),
    );
  }

  it("stamps only blank links, reports conflicts/no-card/no-identity/duplicates, and every write is conditional", async () => {
    seed();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await runIdentityBackfill();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ planned: 2, stamped: 2, failed: 0, alreadyStamped: 1, noCard: 1, noIdentity: 1, conflicts: 1, duplicates: 1 });
    const rows = st.db.rows("product_enrichments");
    expect(rows.find((x) => x.pos_product_key === "A")!.identity_key).toBe(ID);
    expect(rows.find((x) => x.pos_product_key === "B")!.identity_key).toBe(ID);
    expect(rows.find((x) => x.pos_product_key === "C")!.identity_key).toBe("someone|flower|kept");
    for (const p of patches(st.db)) expect(p.url.searchParams.get("identity_key")).toBe("is.null");
    expect(r.summary).toContain("Linked 2 of 2");
    expect(r.duplicateLines[0]).toContain(ID);
    expect(warn).toHaveBeenCalled();
    // the reads are named-column (never select *) and only the published version
    const mi = st.db.log.find((x) => x.table === "menu_items")!;
    expect(mi.url.searchParams.get("select")).not.toBe("*");
    expect(mi.url.searchParams.get("menu_version_id")).toBe(`eq.${V}`);
  });
  it("idempotent: a second run plans nothing and writes nothing", async () => {
    seed();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await runIdentityBackfill();
    const before = patches(st.db).length;
    const again = await runIdentityBackfill();
    expect(again.ok && again.planned).toBe(0);
    expect(patches(st.db).length).toBe(before);
  });
  it("a racer that stamps first is not counted as ours and not overwritten", async () => {
    seed();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    st.db.before = (req) => {
      if (req.method === "PATCH" && req.url.searchParams.get("id") === "eq.e-A") {
        st.db.rows("product_enrichments").find((x) => x.pos_product_key === "A")!.identity_key = "racer|x|y";
      }
    };
    const r = await runIdentityBackfill();
    expect(r.ok && r.stamped).toBe(1);
    expect(st.db.rows("product_enrichments").find((x) => x.pos_product_key === "A")!.identity_key).toBe("racer|x|y");
  });
  it("a failed menu read REFUSES (no plan on a short list) and writes nothing", async () => {
    seed();
    st.db.before = (req) => (req.table === "menu_items" ? { status: 500, body: { code: "XX000", message: "down" } } : undefined);
    const r = await runIdentityBackfill();
    expect(r.ok).toBe(false);
    expect(patches(st.db)).toEqual([]);
  });
  it("pre-0234: a plain-English refusal naming the migration, nothing written", async () => {
    seed();
    st.db.before = pre0234;
    const r = await runIdentityBackfill();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("0234");
    expect(patches(st.db)).toEqual([]);
  });
  it("no published menu: a refusal, nothing read from enrichments", async () => {
    st.db.rows("menu_versions").length = 0;
    const r = await runIdentityBackfill();
    expect(r.ok).toBe(false);
    expect(enrichmentGets(st.db)).toEqual([]);
  });
});

describe("wiring (source)", () => {
  it("the products page has the owner-pressed backfill button, behind products.enrich, audited", () => {
    const actions = read("src/app/admin/products/actions.ts");
    const fn = actions.slice(actions.indexOf("export async function linkEnrichmentsToProducts"));
    expect(fn.slice(0, 400)).toContain('requirePermission("products.enrich")');
    expect(fn).toContain("runIdentityBackfill()");
    expect(fn).toContain('action: "product.enrichment_identity_backfill"');
    const page = read("src/app/admin/products/page.tsx");
    expect(page).toContain("action={linkEnrichmentsToProducts}");
    expect(page).toContain("Link records to products");
    expect(page).toContain("resolveEnrichmentsForItems(items, ownEnrichments)");
  });
  it("the detail page says when the card is served from the product's record", () => {
    const page = read("src/app/admin/products/[key]/page.tsx");
    expect(page).toContain('center.enrichmentVia === "identity"');
    expect(page).toContain("Served from this product&apos;s record.");
  });
  it("command center: served row via getEnrichmentForItem; identity passed to the KB ladder and the image resolver", () => {
    const cc = read("src/lib/enrichment/command-center.ts");
    expect(cc).toContain("getEnrichmentForItem(item)");
    expect(cc).toContain("const identityKey = enrichmentIdentityForItem(item);");
    expect((cc.match(/\bidentityKey,\n/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("every public image surface passes the identity (menu grid, product page, register photo, syndication)", () => {
    expect(read("src/lib/enrichment/image-resolver.ts")).toContain("identityKey: it.identityKey ?? null,");
    expect(read("src/app/api/pos/product-image/route.ts")).toContain("identityKey: item.identityKey ?? null");
    expect(read("src/lib/syndication/feed-source.ts")).toContain("identityKey: enrichmentIdentityForItem(row)");
  });
  it("S20 adds no migration (0234 already has both columns)", () => {
    const m = read("supabase/migrations/0234_product_identity.sql");
    expect(m).toMatch(/product_enrichments[\s\S]*identity_key/);
    expect(m).toContain("restock_of_card_key");
    expect(m).toContain("idx_prod_enrich_identity");
  });
});
