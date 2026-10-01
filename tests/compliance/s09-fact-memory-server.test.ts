/**
 * SLICE S09 -- the server side of recall (src/lib/catalog/fact-memory.ts),
 * against a recording fake Supabase. Proves:
 *   - '' identity is never recalled and costs zero queries (bible S09.5);
 *   - ONE ladder load + ONE history read for a whole page, keyed by every
 *     identity key the history may have been stamped under;
 *   - a missing 0235 is tolerated silently; any other error is logged and
 *     recall falls back to the KB only; nothing ever throws;
 *   - only the S09 target fields are read, newest first, named columns;
 *   - recallForDraft derives identity SERVER-SIDE from the draft row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Call = { table: string; select?: string; ins: Array<[string, unknown[]]>; eqs: Array<[string, unknown]>; order?: [string, unknown]; range?: [number, number] };
const db = vi.hoisted(() => ({
  calls: [] as Call[],
  historyRows: [] as Array<Record<string, unknown>>,
  historyError: null as null | { code: string; message: string },
  draftRow: null as null | Record<string, unknown>,
  configured: true,
  ladderQueries: [] as unknown[][],
  ladderThrows: false,
  knowledge: new Map<string, unknown>(),
  resolverCalls: [] as unknown[],
}));

vi.mock("@/lib/supabase/env", () => ({
  get isSupabaseServiceConfigured() {
    return db.configured;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      const call: Call = { table, ins: [], eqs: [] };
      db.calls.push(call);
      const q = {
        select(cols: string) {
          call.select = cols;
          return q;
        },
        in(col: string, vals: unknown[]) {
          call.ins.push([col, vals]);
          return q;
        },
        eq(col: string, val: unknown) {
          call.eqs.push([col, val]);
          return q;
        },
        order(col: string, opts: unknown) {
          call.order = [col, opts];
          return q;
        },
        async range(from: number, to: number) {
          call.range = [from, to];
          if (db.historyError) return { data: null, error: db.historyError };
          const keys = (call.ins.find((i) => i[0] === "identity_key")?.[1] ?? []) as string[];
          const rows = db.historyRows.filter((r) => keys.includes(String(r.identity_key)));
          return { data: rows.slice(from, to + 1), error: null };
        },
        async maybeSingle() {
          return { data: db.draftRow, error: null };
        },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/ai/kb/product-knowledge-batch", () => ({
  loadKnowledgeIndexes: async (queries: unknown[]) => {
    db.ladderQueries.push(queries);
    if (db.ladderThrows) throw new Error("boom");
    return { tag: "indexes" };
  },
}));
vi.mock("@/lib/ai/kb/product-knowledge-batch-core", () => ({
  resolveKnowledgeFromIndexes: (q: { productName: string }) => db.knowledge.get(q.productName) ?? { source: "none", displayName: null, description: null, shortDescription: null, aromaNotes: [], flavorNotes: [], terpenes: [], effects: [], imageMediaIds: [], primaryMediaId: null, imageHint: "online", needsOnline: true },
}));
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategoryForLot: async (lot: unknown) => {
    db.resolverCalls.push(lot);
    return { websiteCategory: "flower", label: "Flower", raw: null, source: "inventory_type" };
  },
}));

import {
  RECALL_PROVENANCE_SELECT,
  historyKeysFor,
  knowledgeQueryForDraft,
  loadFactHistory,
  recallForDraft,
  recallProductMemories,
} from "@/lib/catalog/fact-memory";
import { PROVENANCE_TABLE } from "@/lib/catalog/attach-facts-core";
import { identityForDraft } from "@/lib/catalog/product-identity-core";

const KB = {
  source: "kb-exact",
  displayName: "Blue Dream",
  description: "Bright berry flower.",
  shortDescription: "Berry and pine.",
  aromaNotes: ["berry"],
  flavorNotes: ["sweet"],
  terpenes: [],
  effects: ["relaxed"],
  imageMediaIds: [],
  primaryMediaId: null,
  imageHint: "substitute",
  needsOnline: false,
};
const hist = (identity_key: string, field: string, value_json: unknown, created_at = "2026-03-12T18:00:00Z", confidence: number | null = 0.95) => ({
  identity_key,
  field,
  value_json,
  source: "gemini",
  confidence,
  created_at,
});

beforeEach(() => {
  db.calls.length = 0;
  db.historyRows = [];
  db.historyError = null;
  db.draftRow = null;
  db.configured = true;
  db.ladderQueries.length = 0;
  db.ladderThrows = false;
  db.knowledge = new Map();
  db.resolverCalls.length = 0;
});

describe("knowledgeQueryForDraft / historyKeysFor", () => {
  it("mirrors queryFor(): trimmed name, brand, POS key, strain, own lot key", () => {
    expect(knowledgeQueryForDraft({ name: " Blue Dream 3.5g ", brand_name: " Acme ", pos_product_key: " pk1 ", strain_name: "" })).toEqual({
      productName: "Blue Dream 3.5g",
      brandName: "Acme",
      posProductKey: "pk1",
      strainName: null,
      lotKeys: ["pk1"],
    });
    expect(knowledgeQueryForDraft({ name: null, brand_name: null, pos_product_key: null, strain_name: null }).lotKeys).toEqual([]);
  });

  it("historyKeysFor: identity first, de-duplicated, blanks dropped", () => {
    expect(historyKeysFor({ identityKey: " a ", historyKeys: ["b", "a", "", "  ", "b"] })).toEqual(["a", "b"]);
    expect(historyKeysFor({ identityKey: "", historyKeys: [] })).toEqual([]);
  });
});

describe("loadFactHistory", () => {
  it("no keys / not configured -> zero queries", async () => {
    expect((await loadFactHistory(["", "  "])).size).toBe(0);
    db.configured = false;
    expect((await loadFactHistory(["k"])).size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it("reads the core's table, named columns, target fields only, newest first, grouped by key", async () => {
    db.historyRows = [hist("k1", "description", "A"), hist("k2", "aroma", ["pine"]), hist("k9", "description", "nope")];
    const m = await loadFactHistory(["k1", "k2", "k1"]);
    expect(db.calls).toHaveLength(1);
    const c = db.calls[0];
    expect(c.table).toBe(PROVENANCE_TABLE);
    expect(c.select).toBe(RECALL_PROVENANCE_SELECT);
    expect(c.select).not.toContain("*");
    expect(c.ins).toEqual([
      ["identity_key", ["k1", "k2"]],
      ["field", ["description", "short_description", "effects", "aroma", "flavor"]],
    ]);
    expect(c.order).toEqual(["created_at", { ascending: false }]);
    expect(m.get("k1")?.[0]).toEqual({ field: "description", value_json: "A", source: "gemini", confidence: 0.95, created_at: "2026-03-12T18:00:00Z" });
    expect(m.get("k2")).toHaveLength(1);
    expect(m.has("k9")).toBe(false);
  });

  it("0235 not applied -> empty, silent (no console.error)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.historyError = { code: "42P01", message: 'relation "public.product_fact_provenance" does not exist' };
    expect((await loadFactHistory(["k1"])).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("any other error -> empty AND logged (never hidden)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.historyError = { code: "57014", message: "canceling statement due to statement timeout" };
    expect((await loadFactHistory(["k1"])).size).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("recallProductMemories", () => {
  it("'' identity -> null and zero reads", async () => {
    const m = await recallProductMemories([{ id: "d1", identityKey: "", query: { productName: "Blue Dream" } }]);
    expect(m.get("d1")).toBeNull();
    expect(db.ladderQueries).toHaveLength(0);
    expect(db.calls).toHaveLength(0);
  });

  it("ONE ladder load + ONE history read for the whole page; history under any stamped key is found", async () => {
    db.knowledge.set("Blue Dream", KB);
    db.historyRows = [hist("raw-key", "description", "Older Gemini copy.", "2026-01-01T00:00:00Z")];
    const m = await recallProductMemories(
      [
        { id: "d1", identityKey: "resolved-key", query: { productName: "Blue Dream" }, historyKeys: ["raw-key"] },
        { id: "d2", identityKey: "other", query: { productName: "Mystery" } },
        { id: "d3", identityKey: "", query: { productName: "Nameless" } },
      ],
      [{ vendorName: "Acme", brandName: null, productName: "x", category: "flower", decidedAt: "2026-03-12T00:00:00Z" }],
    );
    expect(db.ladderQueries).toHaveLength(1);
    expect(db.ladderQueries[0]).toHaveLength(2); // d3 ('' identity) never queried
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].ins[0]).toEqual(["identity_key", ["resolved-key", "raw-key", "other"]]);
    const d1 = m.get("d1")!;
    expect(d1.complete).toBe(true);
    // The approved KB record beats older history (golden record).
    expect(d1.facts.find((f) => f.field === "description")?.origin).toBe("kb-exact");
    expect(m.get("d2")).toBeNull(); // nothing known, never seen
    expect(m.get("d3")).toBeNull();
  });

  it("history alone covers a field at >= 90 and dates the chip as 'recorded'", async () => {
    db.historyRows = [hist("k", "aroma", ["pine"], "2026-03-12T18:00:00Z", 0.93), hist("k", "flavor", ["lime"], "2026-03-11T00:00:00Z", 0.7)];
    const m = await recallProductMemories([{ id: "d1", identityKey: "k", query: { productName: "Nothing in KB" } }]);
    const d1 = m.get("d1")!;
    expect(d1.covered).toEqual(["aroma"]);
    expect(d1.facts.find((f) => f.field === "flavor")?.covered).toBe(false);
    expect(d1.lastSeen).toEqual({ at: "2026-03-12T18:00:00Z", from: null, kind: "recorded" });
  });

  it("a throwing ladder never throws out of recall (rows render without memory)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.ladderThrows = true;
    const m = await recallProductMemories([{ id: "d1", identityKey: "k", query: { productName: "Blue Dream" } }]);
    expect(m.get("d1")).toBeNull();
    spy.mockRestore();
  });
});

describe("recallForDraft", () => {
  it("blank id / unconfigured / missing row -> null, no throw", async () => {
    expect(await recallForDraft("  ")).toBeNull();
    db.configured = false;
    expect(await recallForDraft("d1")).toBeNull();
    db.configured = true;
    db.draftRow = null;
    expect(await recallForDraft("d1")).toBeNull();
  });

  it("derives identity from the DRAFT ROW + resolver (never client text) and reads every stamped key", async () => {
    db.draftRow = {
      id: "d1",
      name: "Blue Dream 3.5g",
      brand_name: "Acme",
      vendor_name: "Acme Farms",
      category: "Usable Marijuana",
      chosen_website_category: null,
      inventory_type: "Usable Cannabis",
      strain_name: "Blue Dream",
      pos_product_key: "pk1",
      identity_key: "stamped-at-seeding",
    };
    db.knowledge.set("Blue Dream 3.5g", KB);
    const mem = await recallForDraft("d1");
    expect(db.calls[0]).toMatchObject({ table: "catalog_product_drafts", eqs: [["id", "d1"]] });
    expect(db.resolverCalls).toEqual([{ posProductKey: "pk1", productName: "Blue Dream 3.5g", inventoryType: "Usable Cannabis", category: "Usable Marijuana" }]);
    const resolved = identityForDraft(db.draftRow as never, { websiteCategory: "flower" }).identityKey;
    const raw = identityForDraft(db.draftRow as never).identityKey;
    expect(resolved).not.toBe("");
    expect(mem?.identityKey).toBe(resolved);
    expect(mem?.complete).toBe(true);
    const histCall = db.calls.find((c) => c.table === PROVENANCE_TABLE)!;
    expect(histCall.ins[0][1]).toEqual([...new Set([resolved, raw, "stamped-at-seeding"])]);
  });

  it("pre-0234 row (no identity_key column) still recalls", async () => {
    db.draftRow = { id: "d1", name: "Blue Dream", brand_name: null, vendor_name: "Acme Farms", category: null, chosen_website_category: null, inventory_type: null, strain_name: null, pos_product_key: null };
    db.knowledge.set("Blue Dream", KB);
    expect((await recallForDraft("d1"))?.complete).toBe(true);
  });

  it("no vendor and no brand -> '' identity -> null, history never read", async () => {
    db.draftRow = { id: "d1", name: "Blue Dream", brand_name: null, vendor_name: null, category: null, chosen_website_category: null, inventory_type: null, strain_name: null, pos_product_key: null };
    db.knowledge.set("Blue Dream", KB);
    expect(await recallForDraft("d1")).toBeNull();
    expect(db.calls.some((c) => c.table === PROVENANCE_TABLE)).toBe(false);
  });
});
