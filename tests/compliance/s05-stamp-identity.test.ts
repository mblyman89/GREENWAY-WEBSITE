/**
 * S05 - stamp identity at the door (lot -> draft -> kb_products link).
 *
 * Behavioural proof with a recording fake Supabase client (no network):
 *   A. finalize runs the KB link step AFTER BOTH the draft seed and the KB
 *      write-back have settled (the roadmap's integration test);
 *   B. KB write-back failures land on the manifest timeline (F-077);
 *   C. linkKbProductsToDrafts: natural-key match, grouped writes, never
 *      destructive, honest pre-migration skip;
 *   D. seedDraftsForManifest: copies identity + lot facts + restock hint,
 *      retries once without the 0234 columns pre-migration, rollback switch;
 *   E. stageManifest: stamps inventory_lots.identity_key, retries without it
 *      pre-migration, never blocks staging.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

// ─── Recording fake admin ───────────────────────────────────────────────────

type Op = {
  table: string;
  kind: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
  filters: Array<[string, ...unknown[]]>;
  columns?: string;
};
type Resp = { data?: unknown; error?: { code?: string; message: string } | null; count?: number };
type Responder = (op: Op) => Resp | undefined;

const log: string[] = [];
let ops: Op[] = [];
let responder: Responder = () => undefined;

function makeBuilder(table: string) {
  const op: Op = { table, kind: "select", filters: [] };
  const settle = (): Resp => {
    ops.push(op);
    log.push(`db:${op.kind}:${table}`);
    return responder(op) ?? { data: op.kind === "select" ? [] : null, error: null };
  };
  const b: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    op.filters.push([name, ...args]);
    return b;
  };
  for (const f of ["eq", "neq", "in", "is", "not", "ilike", "order", "range", "limit", "gte", "lte", "or"]) {
    b[f] = chain(f);
  }
  b.select = (cols?: string) => {
    if (op.kind === "select") op.columns = cols;
    return b;
  };
  b.insert = (payload: unknown) => {
    op.kind = "insert";
    op.payload = payload;
    return b;
  };
  b.update = (payload: unknown) => {
    op.kind = "update";
    op.payload = payload;
    return b;
  };
  b.upsert = (payload: unknown) => {
    op.kind = "upsert";
    op.payload = payload;
    return b;
  };
  b.maybeSingle = () => {
    const r = settle();
    const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data ?? null;
    return Promise.resolve({ ...r, data: d });
  };
  b.single = b.maybeSingle;
  b.then = (res: (v: Resp) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(settle()).then(res, rej);
  return b;
}
const fakeAdmin = { from: (t: string) => makeBuilder(t) };

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fakeAdmin }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));

// Website categories: deterministic, no DB.
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async (lots: unknown[]) =>
    lots.map(() => ({ websiteCategory: "flower", label: "Flower", raw: null, source: "heuristic", unmapped: false })),
  resolveWebsiteCategoryForLot: async () => ({
    websiteCategory: "flower",
    label: "Flower",
    raw: null,
    source: "heuristic",
    unmapped: false,
  }),
}));
const published = { current: { id: "V1" } as { id: string } | null };
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => published.current }));
vi.mock("@/lib/inventory/pricing", () => ({
  getPricingSettings: async () => ({}),
  getVelocityForProduct: async () => null,
  suggestPrice: () => ({ floorMinor: 100, suggestedMinor: 200, rationale: "test" }),
  validatePrice: () => ({ ok: true }),
}));

const { seedDraftsForManifest, SEED_LOT_COLUMNS } = await import("@/lib/inventory/catalog-drafts");
const { linkKbProductsToDrafts, KB_LINK_COLUMNS } = await import("@/lib/inventory/kb-link-store");
const { identityForLot } = await import("@/lib/catalog/product-identity-core");

beforeEach(() => {
  ops = [];
  log.length = 0;
  responder = () => undefined;
  published.current = { id: "V1" };
  delete process.env.INTAKE_IDENTITY_STAMP;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.INTAKE_IDENTITY_STAMP;
});

const LOT = {
  id: "lot-1",
  pos_product_key: "LOT-NEW-KEY",
  product_name: "Blue Dream",
  brand_id: "b1",
  vendor_id: "v1",
  category: "Usable Marijuana",
  inventory_type: "Usable Marijuana",
  strain_name: "Blue Dream",
  lab_result_id: null,
  unit_cost_minor_units: 500,
  lot_code: "LC-1",
  strain_type: "hybrid",
  unit_weight: 3.5,
  unit_weight_uom: "g",
  status: "active",
  disposition: "accepted",
};
const EXPECTED_IDENTITY = identityForLot(LOT, {
  vendorName: "Acme Farms",
  brandName: "Acme",
  websiteCategory: "flower",
}).identityKey;

/** Standard world for seeding: one lot, names, a live card of the same product under another key. */
function seedWorld(over: { lots?: unknown[]; liveCards?: unknown[]; draftInsert?: (op: Op) => Resp | undefined } = {}): Responder {
  return (op) => {
    if (op.table === "inventory_lots" && op.kind === "select") return { data: over.lots ?? [LOT], error: null };
    if (op.table === "vendors" && op.kind === "select") return { data: [{ id: "v1", display_name: "Acme Farms" }], error: null };
    if (op.table === "brands" && op.kind === "select") return { data: [{ id: "b1", display_name: "Acme" }], error: null };
    if (op.table === "menu_items" && op.kind === "select") {
      if (op.columns === "source_item_id") return { data: [], error: null }; // published-key check
      return {
        data: over.liveCards ?? [
          {
            source_item_id: "CARD-BD",
            name: "Blue Dream",
            product_name: "Blue Dream",
            brand_name: "Acme",
            vendor_name: "Acme Farms",
            category: "flower",
            hidden: false,
          },
        ],
        error: null,
      };
    }
    if (op.table === "catalog_product_drafts" && op.kind === "insert") return over.draftInsert?.(op);
    return undefined;
  };
}

// ─── D. seedDraftsForManifest ───────────────────────────────────────────────

describe("S05 seedDraftsForManifest - identity + lot facts + restock hint", () => {
  it("fixture identity is real (not refused)", () => {
    expect(EXPECTED_IDENTITY).not.toBe("");
  });

  it("copies identity_key, brand/vendor ids, lot_code, strain_type and the restock hint onto the draft", async () => {
    responder = seedWorld();
    const res = await seedDraftsForManifest("m1", "u1");
    expect(res.draftsCreated).toBe(1);
    const ins = ops.filter((o) => o.table === "catalog_product_drafts" && o.kind === "insert");
    expect(ins).toHaveLength(1);
    const row = ins[0].payload as Record<string, unknown>;
    expect(row.identity_key).toBe(EXPECTED_IDENTITY);
    expect(row.brand_id).toBe("b1");
    expect(row.vendor_id).toBe("v1");
    expect(row.lot_code).toBe("LC-1");
    expect(row.strain_type).toBe("hybrid");
    expect(row.restock_of_card_key).toBe("CARD-BD");
    // Unchanged draft facts still there.
    expect(row.pos_product_key).toBe("LOT-NEW-KEY");
    expect(row.brand_name).toBe("Acme");
    expect(row.vendor_name).toBe("Acme Farms");
    // Never invented / never set here.
    expect("sku" in row).toBe(false);
    expect("kb_product_id" in row).toBe(false);
    expect(res.restockHints).toBe(1);
    expect(res.identityColumnsMissing).toBe(false);
    expect(res.lotIdentities?.[0]).toMatchObject({ lotId: "lot-1", identityKey: EXPECTED_IDENTITY, promotable: true });
    expect(res.lotIdentities?.[0].kb).toEqual({ brand_slug: "acme", product_slug: "blue-dream", variant_label: "3.5 g" });
  });

  it("hint annotates, never suppresses: exactly one draft even though the live card is the same product", async () => {
    responder = seedWorld();
    const res = await seedDraftsForManifest("m1", "u1");
    expect(res.unmatched).toBe(1);
    expect(res.matched).toBe(0);
    expect(ops.filter((o) => o.table === "catalog_product_drafts" && o.kind === "insert")).toHaveLength(1);
  });

  it("two live cards with the same identity -> no hint (never a coin flip), counted as ambiguous", async () => {
    const card = (k: string) => ({
      source_item_id: k,
      name: "Blue Dream",
      product_name: "Blue Dream",
      brand_name: "Acme",
      vendor_name: "Acme Farms",
      category: "flower",
      hidden: false,
    });
    responder = seedWorld({ liveCards: [card("C1"), card("C2")] });
    const res = await seedDraftsForManifest("m1", "u1");
    const row = ops.find((o) => o.table === "catalog_product_drafts" && o.kind === "insert")!.payload as Record<string, unknown>;
    expect(row.restock_of_card_key).toBeNull();
    expect(res.restockHints).toBe(0);
    expect(res.restockAmbiguous).toBe(1);
  });

  it("the live-menu read is bounded: named 0002 columns, this vendor only, capped range", async () => {
    responder = seedWorld();
    await seedDraftsForManifest("m1", "u1");
    const live = ops.find((o) => o.table === "menu_items" && o.columns !== "source_item_id")!;
    expect(live.columns).toBe("source_item_id, name, product_name, brand_name, vendor_name, category, hidden");
    expect(live.filters).toContainEqual(["eq", "menu_version_id", "V1"]);
    expect(live.filters).toContainEqual(["in", "vendor_name", ["Acme Farms"]]);
    expect(live.filters).toContainEqual(["range", 0, 999]);
  });

  it("a full (possibly truncated) live page -> no hints at all, never a guess", async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      source_item_id: `X${i}`,
      name: `Other ${i}`,
      product_name: `Other ${i}`,
      brand_name: "Acme",
      vendor_name: "Acme Farms",
      category: "flower",
      hidden: false,
    }));
    many[500] = { ...many[500], source_item_id: "CARD-BD", name: "Blue Dream", product_name: "Blue Dream" };
    responder = seedWorld({ liveCards: many });
    const res = await seedDraftsForManifest("m1", "u1");
    expect(res.restockHints).toBe(0);
    const row = ops.find((o) => o.table === "catalog_product_drafts" && o.kind === "insert")!.payload as Record<string, unknown>;
    expect(row.restock_of_card_key).toBeNull();
  });

  it("vendor + brand names are fetched in ONE .in() read each (was one read per id)", async () => {
    responder = seedWorld({ lots: [LOT, { ...LOT, id: "lot-2", pos_product_key: "K2", product_name: "Gelato" }] });
    await seedDraftsForManifest("m1", "u1");
    expect(ops.filter((o) => o.table === "vendors")).toHaveLength(1);
    expect(ops.filter((o) => o.table === "brands")).toHaveLength(1);
    expect(ops.find((o) => o.table === "vendors")!.filters).toContainEqual(["in", "id", ["v1"]]);
  });

  it("PRE-MIGRATION: one retry without exactly the 0234 columns; later lots skip them (no wasted trips)", async () => {
    let calls = 0;
    responder = seedWorld({
      lots: [LOT, { ...LOT, id: "lot-2", pos_product_key: "K2", product_name: "Gelato" }],
      draftInsert: (op) => {
        calls += 1;
        const row = op.payload as Record<string, unknown>;
        if ("identity_key" in row) {
          return { data: null, error: { code: "PGRST204", message: "Could not find the 'identity_key' column of 'catalog_product_drafts' in the schema cache" } };
        }
        return { data: null, error: null };
      },
    });
    const res = await seedDraftsForManifest("m1", "u1");
    expect(res.draftsCreated).toBe(2);
    expect(res.draftsFailed).toBe(0);
    expect(calls).toBe(3); // fail, retry, then lot-2 goes straight through
    const ins = ops.filter((o) => o.table === "catalog_product_drafts" && o.kind === "insert");
    for (const k of ["identity_key", "brand_id", "vendor_id", "lot_code", "strain_type", "restock_of_card_key"]) {
      expect(k in (ins[1].payload as object)).toBe(false);
      expect(k in (ins[2].payload as object)).toBe(false);
    }
    expect((ins[1].payload as Record<string, unknown>).name).toBe("Blue Dream");
    expect(res.identityColumnsMissing).toBe(true);
    expect(res.restockHints).toBe(0); // no hint was actually stored
  });

  it("a DIFFERENT error is never retried away - it still counts as a failure", async () => {
    responder = seedWorld({
      draftInsert: () => ({ data: null, error: { code: "23502", message: 'null value in column "name" violates not-null constraint' } }),
    });
    const res = await seedDraftsForManifest("m1", "u1");
    expect(res.draftsFailed).toBe(1);
    expect(res.firstError).toContain("not-null");
    expect(ops.filter((o) => o.table === "catalog_product_drafts" && o.kind === "insert")).toHaveLength(1);
  });

  it("ROLLBACK: INTAKE_IDENTITY_STAMP=off -> no 0234 columns, no live read, no lotIdentities", async () => {
    process.env.INTAKE_IDENTITY_STAMP = "off";
    responder = seedWorld();
    const res = await seedDraftsForManifest("m1", "u1");
    const row = ops.find((o) => o.table === "catalog_product_drafts" && o.kind === "insert")!.payload as Record<string, unknown>;
    for (const k of ["identity_key", "brand_id", "vendor_id", "lot_code", "strain_type", "restock_of_card_key"]) {
      expect(k in row).toBe(false);
    }
    expect(ops.some((o) => o.table === "menu_items" && o.columns !== "source_item_id")).toBe(false);
    expect(res.lotIdentities).toBeUndefined();
    expect(res.draftsCreated).toBe(1);
  });

  it("no published menu -> no live read, draft still seeded with identity", async () => {
    published.current = null;
    responder = seedWorld();
    const res = await seedDraftsForManifest("m1", "u1");
    expect(ops.some((o) => o.table === "menu_items")).toBe(false);
    const row = ops.find((o) => o.table === "catalog_product_drafts" && o.kind === "insert")!.payload as Record<string, unknown>;
    expect(row.identity_key).toBe(EXPECTED_IDENTITY);
    expect(row.restock_of_card_key).toBeNull();
    expect(res.draftsCreated).toBe(1);
  });

  it("a lot with no vendor or brand -> identity_key NULL (never ''), draft still seeded", async () => {
    responder = seedWorld({ lots: [{ ...LOT, vendor_id: null, brand_id: null }] });
    const res = await seedDraftsForManifest("m1", "u1");
    const row = ops.find((o) => o.table === "catalog_product_drafts" && o.kind === "insert")!.payload as Record<string, unknown>;
    expect(row.identity_key).toBeNull();
    expect(res.draftsCreated).toBe(1);
  });

  it("the lot read names only pre-0234 columns", () => {
    expect(SEED_LOT_COLUMNS).not.toMatch(/identity_key|kb_product_id|restock_of_card_key|\*/);
    expect(SEED_LOT_COLUMNS).toContain("lot_code");
    expect(SEED_LOT_COLUMNS).toContain("strain_type");
  });
});

// ─── C. linkKbProductsToDrafts ──────────────────────────────────────────────

const kbA = { brand_slug: "acme", product_slug: "blue-dream", variant_label: "3.5 g" };
const kbB = { brand_slug: "acme", product_slug: "gelato", variant_label: "1 g" };

describe("S05 linkKbProductsToDrafts", () => {
  it("links by the full natural key, one statement per group, draft fill-only-empty, one timeline event", async () => {
    responder = (op) => {
      if (op.table === "kb_products") return { data: [{ id: "K-A", ...kbA }], error: null };
      return undefined;
    };
    const res = await linkKbProductsToDrafts(
      "m1",
      [
        { lotId: "l1", identityKey: "i-bd", kb: kbA, promotable: true },
        { lotId: "l2", identityKey: "i-bd", kb: kbA, promotable: true },
        { lotId: "l3", identityKey: "i-g", kb: kbB, promotable: true },
        { lotId: "l4", identityKey: "i-x", kb: kbA, promotable: false },
      ],
      "u1",
      { restockHints: 1 },
    );
    expect(res).toMatchObject({ status: "linked", products: 2, linkedProducts: 1, linkedLots: 2, failedWrites: 0 });
    const kbRead = ops.find((o) => o.table === "kb_products")!;
    expect(kbRead.columns).toBe(KB_LINK_COLUMNS);
    expect(kbRead.filters).toContainEqual(["in", "product_slug", ["blue-dream", "gelato"]]);

    const lotUpdates = ops.filter((o) => o.table === "inventory_lots" && o.kind === "update");
    expect(lotUpdates).toHaveLength(2);
    expect(lotUpdates[0].payload).toEqual({ updated_by: "u1", identity_key: "i-bd", kb_product_id: "K-A" });
    expect(lotUpdates[0].filters).toContainEqual(["in", "id", ["l1", "l2"]]);
    expect(lotUpdates[0].filters).toContainEqual(["eq", "manifest_id", "m1"]);
    // No KB row -> kb_product_id is OMITTED, never nulled.
    expect(lotUpdates[1].payload).toEqual({ updated_by: "u1", identity_key: "i-g" });
    expect(lotUpdates.some((u) => (u.filters.find((f) => f[0] === "in")?.[2] as string[]).includes("l4"))).toBe(false);

    const draftUpdates = ops.filter((o) => o.table === "catalog_product_drafts" && o.kind === "update");
    expect(draftUpdates).toHaveLength(1);
    expect(draftUpdates[0].payload).toEqual({ kb_product_id: "K-A", updated_by: "u1" });
    expect(draftUpdates[0].filters).toContainEqual(["is", "kb_product_id", null]);
    expect(draftUpdates[0].filters).toContainEqual(["in", "lot_id", ["l1", "l2"]]);

    const ev = ops.filter((o) => o.table === "manifest_events");
    expect(ev).toHaveLength(1);
    const evRow = ev[0].payload as Record<string, unknown>;
    expect(evRow.event_type).toBe("kb_link");
    expect(evRow.note).toContain("Knowledge base link: 1 of 2 products linked to a known product record");
    expect(evRow.note).toContain("1 has no knowledge base record yet");
    expect(evRow.note).toContain("1 new onboarding draft looks like a restock");
  });

  it("PRE-MIGRATION: stops at the first missing-0234 error with an honest timeline note", async () => {
    responder = (op) => {
      if (op.table === "kb_products") return { data: [{ id: "K-A", ...kbA }], error: null };
      if (op.table === "inventory_lots" && op.kind === "update") {
        return { data: null, error: { code: "42703", message: 'column "identity_key" of relation "inventory_lots" does not exist' } };
      }
      return undefined;
    };
    const res = await linkKbProductsToDrafts("m1", [{ lotId: "l1", identityKey: "i", kb: kbA, promotable: true }], "u1");
    expect(res.status).toBe("pre-migration");
    expect(ops.filter((o) => o.table === "catalog_product_drafts")).toHaveLength(0);
    const ev = ops.filter((o) => o.table === "manifest_events");
    expect(ev).toHaveLength(1);
    expect((ev[0].payload as Record<string, unknown>).note).toContain("0234_product_identity.sql has not been applied");
  });

  it("an unrelated write error is counted (not mistaken for pre-migration) and the step continues", async () => {
    responder = (op) => {
      if (op.table === "kb_products") return { data: [{ id: "K-A", ...kbA }], error: null };
      if (op.table === "inventory_lots" && op.kind === "update") return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
      return undefined;
    };
    const res = await linkKbProductsToDrafts("m1", [{ lotId: "l1", identityKey: "i", kb: kbA, promotable: true }], "u1");
    expect(res).toMatchObject({ status: "linked", failedWrites: 1 });
    expect((ops.find((o) => o.table === "manifest_events")!.payload as Record<string, unknown>).note).toContain("1 link write FAILED");
  });

  it("a KB read failure -> status error + timeline note; never throws", async () => {
    responder = (op) => (op.table === "kb_products" ? { data: null, error: { message: "boom" } } : undefined);
    const res = await linkKbProductsToDrafts("m1", [{ lotId: "l1", identityKey: "i", kb: kbA, promotable: true }], "u1");
    expect(res.status).toBe("error");
    expect(ops.some((o) => o.table === "inventory_lots")).toBe(false);
    expect((ops.find((o) => o.table === "manifest_events")!.payload as Record<string, unknown>).note).toContain("Knowledge base link FAILED: knowledge base read failed: boom");
  });

  it("no promotable lots -> zero queries", async () => {
    const res = await linkKbProductsToDrafts("m1", [{ lotId: "l1", identityKey: "i", kb: kbA, promotable: false }], "u1");
    expect(res).toEqual({ status: "skipped", reason: "no-lots" });
    expect(ops).toHaveLength(0);
    expect(await linkKbProductsToDrafts("m1", undefined, "u1")).toEqual({ status: "skipped", reason: "no-lots" });
  });
});

// ─── A + B. finalize ordering and F-077 (source-pinned + behavioural) ───────

describe("S05 finalize wiring (intake-store.ts)", () => {
  const src = readFileSync(path.resolve(__dirname, "../../src/lib/inventory/intake-store.ts"), "utf8");
  const fin = src.slice(src.indexOf("export async function finalizeManifestDispositions"));
  const fanOut = fin.indexOf("await Promise.allSettled([");
  const fanOutEnd = fin.indexOf("]);", fanOut);
  const link = fin.indexOf("await linkKbProductsToDrafts(");

  it("the link step is NOT inside the concurrent fan-out (it would race the KB write-back)", () => {
    expect(fanOut).toBeGreaterThan(0);
    expect(link).toBeGreaterThan(fanOutEnd);
    expect(fin.slice(fanOut, fanOutEnd)).not.toContain("linkKbProductsToDrafts");
  });

  it("the link step runs before menu auto-carry and only with seeded identities", () => {
    expect(link).toBeLessThan(fin.indexOf("stageIntakeMenuVersionForManifest(manifestId, actorId)"));
    expect(fin).toContain('if (draftsRes.status === "fulfilled" && draftsRes.value.lotIdentities) {');
  });

  it("F-077: rejected AND ok:false KB write-backs both reach the timeline", () => {
    expect(fin).toContain("await logManifestEvent(manifestId, KB_WRITEBACK_ERROR_EVENT, kbWritebackErrorNote(kbRes.reason), actorId);");
    expect(fin).toContain("} else if (!kbRes.value.ok) {");
    expect(fin).toContain("kbWritebackErrorNote(kbRes.value.error)");
  });
});

/**
 * Behavioural ordering proof: run the REAL finalize with the six chores and
 * the link step mocked as deferred promises, and record when each settles.
 */
describe("S05 finalize integration - link runs after BOTH seeds", () => {
  it("awaits seedDrafts + promoteManifestToKb before linking, and logs a KB failure", async () => {
    vi.resetModules();
    const order: string[] = [];
    const deferred = <T,>() => {
      let resolve!: (v: T) => void;
      const p = new Promise<T>((r) => (resolve = r));
      return { p, resolve };
    };
    const seed = deferred<unknown>();
    const kb = deferred<unknown>();
    vi.doMock("@/lib/inventory/catalog-drafts", () => ({
      seedDraftsForManifest: () => seed.p.then((v) => (order.push("seed:settled"), v)),
    }));
    vi.doMock("@/lib/inventory/manifest-kb-bridge", () => ({
      promoteManifestToKb: () => kb.p.then((v) => (order.push("kb:settled"), v)),
    }));
    vi.doMock("@/lib/inventory/coa-archive", () => ({ archiveCoasForManifest: async () => undefined }));
    vi.doMock("@/lib/inventory/po-receive-store", () => ({ autoReceiveManifestPo: async () => ({ attempted: false, note: "" }) }));
    vi.doMock("@/lib/pos/intake-menu-staging", () => ({
      stageIntakeMenuVersionForManifest: async () => (order.push("menu:carry"), { staged: false }),
    }));
    const linkSpy = vi.fn(async () => (order.push("link"), { status: "linked" }));
    vi.doMock("@/lib/inventory/kb-link-store", () => ({ linkKbProductsToDrafts: linkSpy }));

    responder = (op) => {
      if (op.table === "inbound_manifests" && op.kind === "select") return { data: [{ vendor_id: "v1", vendor_label: "Acme" }], error: null };
      if (op.table === "inventory_lots" && op.kind === "select" && String(op.columns).includes("lab_results")) {
        return {
          data: [
            {
              id: "lot-1",
              product_name: "Blue Dream",
              lot_code: "LC-1",
              received_qty: 10,
              status: "quarantine",
              disposition: "accepted",
              ccrs_inventory_external_id: "X1",
              lab_result_id: "lab1",
              lab_results: { passed: true },
            },
          ],
          error: null,
        };
      }
      return undefined;
    };

    const { finalizeManifestDispositions } = await import("@/lib/inventory/intake-store");
    const run = finalizeManifestDispositions("m1", "u1");

    // Let finalize reach the fan-out, then settle the seed FIRST: the link
    // must still wait for the KB write-back.
    await new Promise((r) => setTimeout(r, 20));
    seed.resolve({
      matched: 0,
      unmatched: 1,
      hasPublishedMenu: true,
      draftsCreated: 1,
      draftsFailed: 0,
      firstError: null,
      lotIdentities: [{ lotId: "lot-1", identityKey: "i", kb: kbA, promotable: true }],
      restockHints: 1,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(order).not.toContain("link");
    kb.resolve({ ok: false, error: "kb table locked" });
    const res = await run;

    expect(res.ok).toBe(true);
    expect(order.indexOf("link")).toBeGreaterThan(order.indexOf("seed:settled"));
    expect(order.indexOf("link")).toBeGreaterThan(order.indexOf("kb:settled"));
    expect(order.indexOf("link")).toBeLessThan(order.indexOf("menu:carry"));
    expect(linkSpy).toHaveBeenCalledWith(
      "m1",
      [{ lotId: "lot-1", identityKey: "i", kb: kbA, promotable: true }],
      "u1",
      { restockHints: 1 },
    );
    const kbErr = ops.find(
      (o) => o.table === "manifest_events" && (o.payload as Record<string, unknown>).event_type === "kb_writeback_error",
    );
    expect(kbErr).toBeTruthy();
    expect((kbErr!.payload as Record<string, unknown>).note).toContain("Knowledge base write-back FAILED: kb table locked.");
    vi.resetModules();
  });

  it("a REJECTED KB promise is also logged, and a missing lotIdentities (stamp off) skips the link", async () => {
    vi.resetModules();
    vi.doMock("@/lib/inventory/catalog-drafts", () => ({
      seedDraftsForManifest: async () => ({ matched: 0, unmatched: 1, hasPublishedMenu: true, draftsCreated: 1, draftsFailed: 0, firstError: null }),
    }));
    vi.doMock("@/lib/inventory/manifest-kb-bridge", () => ({
      promoteManifestToKb: async () => {
        throw new Error("network down");
      },
    }));
    vi.doMock("@/lib/inventory/coa-archive", () => ({ archiveCoasForManifest: async () => undefined }));
    vi.doMock("@/lib/inventory/po-receive-store", () => ({ autoReceiveManifestPo: async () => ({ attempted: false, note: "" }) }));
    vi.doMock("@/lib/pos/intake-menu-staging", () => ({ stageIntakeMenuVersionForManifest: async () => ({ staged: false }) }));
    const linkSpy = vi.fn(async () => ({ status: "linked" }));
    vi.doMock("@/lib/inventory/kb-link-store", () => ({ linkKbProductsToDrafts: linkSpy }));
    responder = (op) => {
      if (op.table === "inventory_lots" && op.kind === "select" && String(op.columns).includes("lab_results")) {
        return {
          data: [{ id: "lot-1", product_name: "BD", lot_code: "LC", received_qty: 1, status: "quarantine", disposition: "accepted", ccrs_inventory_external_id: "X", lab_result_id: "l", lab_results: { passed: true } }],
          error: null,
        };
      }
      return undefined;
    };
    const { finalizeManifestDispositions } = await import("@/lib/inventory/intake-store");
    const res = await finalizeManifestDispositions("m1", "u1");
    expect(res.ok).toBe(true);
    expect(linkSpy).not.toHaveBeenCalled();
    const kbErr = ops.find(
      (o) => o.table === "manifest_events" && (o.payload as Record<string, unknown>).event_type === "kb_writeback_error",
    );
    expect((kbErr!.payload as Record<string, unknown>).note).toContain("FAILED: network down.");
    vi.resetModules();
  });
});

// ─── E. stageManifest ───────────────────────────────────────────────────────

describe("S05 stageManifest - identity stamped on the lot at the door", () => {
  const parsed = {
    manifest_number: null,
    vendor_label: "Acme Farms",
    vendor_license: null,
    transfer_date: null,
    source_format: "generic",
    lines: [
      {
        lot_code: "LC-1",
        pos_product_key: "LOT-NEW-KEY",
        product_name: "Blue Dream",
        brand_name: "Acme",
        strain_name: "Blue Dream",
        strain_type: "hybrid",
        category: "Usable Marijuana",
        inventory_type: "Usable Marijuana",
        unit_weight: 3.5,
        unit_weight_uom: "g",
        is_sample: false,
        is_medical: false,
        received_qty: 10,
        unit: "each",
        unit_cost_minor_units: 500,
        expires_on: null,
        lab: null,
        low_thc_liquid: null,
        unit_thc_mg: null,
        otherwise_taken: null,
        units_per_package: null,
      },
    ],
  };

  async function loadStage() {
    vi.resetModules();
    const { stageManifest } = await import("@/lib/inventory/intake-store");
    return stageManifest;
  }
  const world = (lotInsert?: (op: Op) => Resp | undefined): Responder => (op) => {
    if (op.table === "vendors" && op.kind === "select") {
      if (op.columns === "display_name") return { data: [{ display_name: "Acme Farms" }], error: null };
      return { data: [{ id: "v1", display_name: "Acme Farms", license_number: null }], error: null };
    }
    if (op.table === "brands" && op.kind === "select") return { data: [{ id: "b1", display_name: "Acme", vendor_id: "v1" }], error: null };
    if (op.table === "inbound_manifests" && op.kind === "insert") return { data: [{ id: "m-new" }], error: null };
    if (op.table === "inventory_lots" && op.kind === "insert") return lotInsert?.(op);
    return undefined;
  };

  it("writes identity_key computed from vendor display name + resolved brand + website category", async () => {
    const stageManifest = await loadStage();
    responder = world();
    const res = await stageManifest(parsed as never, {}, "u1");
    expect(res).toEqual({ ok: true, manifestId: "m-new" });
    const ins = ops.filter((o) => o.table === "inventory_lots" && o.kind === "insert");
    expect(ins).toHaveLength(1);
    const row = ins[0].payload as Record<string, unknown>;
    expect(row.identity_key).toBe(EXPECTED_IDENTITY);
    expect(row.brand_id).toBe("b1");
    expect(row.status).toBe("quarantine");
  });

  it("vendor display name missing -> identity falls back to the RESOLVED brand name (not refused)", async () => {
    const stageManifest = await loadStage();
    const base = world();
    responder = (op) =>
      op.table === "vendors" && op.kind === "select" && op.columns === "display_name"
        ? { data: { display_name: null }, error: null }
        : base(op);
    await stageManifest(parsed as never, {}, "u1");
    const row = ops.find((o) => o.table === "inventory_lots" && o.kind === "insert")!.payload as Record<string, unknown>;
    const expected = identityForLot(LOT, { vendorName: null, brandName: "Acme", websiteCategory: "flower" }).identityKey;
    expect(expected).not.toBe(""); // the brand alone carries the identity
    expect(row.identity_key).toBe(expected);
  });

  it("PRE-MIGRATION: retries once without identity_key; staging still succeeds", async () => {
    const stageManifest = await loadStage();
    responder = world((op) =>
      "identity_key" in (op.payload as object)
        ? { data: null, error: { code: "PGRST204", message: "Could not find the 'identity_key' column of 'inventory_lots' in the schema cache" } }
        : { data: null, error: null },
    );
    const res = await stageManifest(parsed as never, {}, "u1");
    expect(res.ok).toBe(true);
    const ins = ops.filter((o) => o.table === "inventory_lots" && o.kind === "insert");
    expect(ins).toHaveLength(2);
    expect("identity_key" in (ins[1].payload as object)).toBe(false);
    expect((ins[1].payload as Record<string, unknown>).lot_code).toBe("LC-1");
  });

  it("ROLLBACK: INTAKE_IDENTITY_STAMP=off -> no identity_key key and no extra vendor read", async () => {
    process.env.INTAKE_IDENTITY_STAMP = "off";
    const stageManifest = await loadStage();
    responder = world();
    await stageManifest(parsed as never, {}, "u1");
    const row = ops.find((o) => o.table === "inventory_lots" && o.kind === "insert")!.payload as object;
    expect("identity_key" in row).toBe(false);
    expect(ops.some((o) => o.table === "vendors" && o.columns === "display_name")).toBe(false);
  });

  it("an unrelated lot insert error is logged (no longer silent) and never retried", async () => {
    const stageManifest = await loadStage();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    responder = world(() => ({ data: null, error: { code: "23503", message: "fk violation" } }));
    const res = await stageManifest(parsed as never, {}, "u1");
    expect(res.ok).toBe(true);
    expect(ops.filter((o) => o.table === "inventory_lots" && o.kind === "insert")).toHaveLength(1);
    expect(err.mock.calls.some((c) => String(c[1] ?? "").includes("fk violation"))).toBe(true);
  });
});

// ─── Embedded self-tests are registered with honest floors ──────────────────

describe("S05 embedded self-tests", () => {
  it("identity-stamp-core and draft-seed-core pass and are floored in run-pure-selftests", async () => {
    const { __runIdentityStampCoreTests } = await import("@/lib/inventory/identity-stamp-core");
    const { __runDraftSeedCoreTests } = await import("@/lib/inventory/draft-seed-core");
    const a = __runIdentityStampCoreTests();
    const b = __runDraftSeedCoreTests();
    expect(a.failed).toBe(0);
    expect(a.passed).toBeGreaterThanOrEqual(48);
    expect(b.failed).toBe(0);
    expect(b.passed).toBeGreaterThanOrEqual(38);
    const runner = readFileSync(path.resolve(__dirname, "../../scripts/compliance/run-pure-selftests.ts"), "utf8");
    expect(runner).toContain('assertRan("identity-stamp-core", __runIdentityStampCoreTests(), 47);');
    expect(runner).toContain('assertRan("draft-seed-core", __runDraftSeedCoreTests(), 37);');
  });
});
