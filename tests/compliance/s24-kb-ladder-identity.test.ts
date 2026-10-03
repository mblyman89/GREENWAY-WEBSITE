/**
 * tests/compliance/s24-kb-ladder-identity.test.ts
 *
 * S24 (bible F-065, F-083; requests R-KB-FIRST, R-IDENTITY): the KB ladder
 * reads kb_products with the SAME identity the manifest bridge wrote, so the
 * rows it creates are finally reachable from the public menu, the product
 * detail page and the enrichment command center.
 *
 *   1. Pure core: exact self-test count (a deleted check turns this red).
 *   2. THE BIBLE FIXTURE (S24.5) end to end on the real functions against a
 *      fake PostgREST: a bridged kb_products row (variant '3.5 g', raw-name
 *      slug) is found for a menu item whose display name was mastered - on
 *      the menu grid (batched) AND the detail page (per item).
 *   3. The S05 link rung, the pre-0234 retry, every failure soft, blank
 *      drafts never masking today's copy, an unresolved brand never guessed.
 *   4. No lot keys / no variant -> exactly the pre-S24 reads (no new I/O).
 *   5. Wiring (queryFor, command-center, product-lookup) + env ledger.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  __runProductKnowledgeBatchTests,
  resolveKnowledgeFromIndexes,
} from "../../src/lib/ai/kb/product-knowledge-batch-core";
import {
  loadKbKnowledgeIndexes,
  loadKnowledgeIndexes,
  loadLotsForKnowledge,
} from "../../src/lib/ai/kb/product-knowledge-batch";
import { hasWriterIdentityInputs, lookupProductKnowledge } from "../../src/lib/ai/kb/product-lookup";
import {
  queryFor,
  resolveDisplayKnowledge,
  resolveDisplayKnowledgeMap,
} from "../../src/lib/menu/product-knowledge-display";
import type { GreenwayMenuItem } from "../../src/lib/leafly/types";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true, supabaseUrl: "https://x.supabase.co" }));

// --- Fake PostgREST (select / in / eq / order / range / maybeSingle / await) ---
type Row = Record<string, unknown>;
type Call = { table: string; ops: Array<[string, unknown[]]> };
const calls: Call[] = [];
let db: Record<string, Row[]> = {};
let fail: { table: string; message: string; code?: string; onlyWith?: string; onlyIn?: string } | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const result = (single: boolean) => {
        const sel = String(call.ops.find(([m]) => m === "select")?.[1][0] ?? "");
        const inArg = (call.ops.find(([m]) => m === "in")?.[1][1] as unknown[] | undefined) ?? [];
        if (
          fail &&
          fail.table === table &&
          (!fail.onlyWith || sel.includes(fail.onlyWith)) &&
          (!fail.onlyIn || inArg.includes(fail.onlyIn))
        ) {
          return { data: null, error: { message: fail.message, code: fail.code } };
        }
        let rows = [...(db[table] ?? [])];
        for (const [m, args] of call.ops) {
          if (m === "in") rows = rows.filter((r) => (args[1] as unknown[]).includes(r[args[0] as string]));
          if (m === "eq") rows = rows.filter((r) => r[args[0] as string] === args[1]);
        }
        if (call.ops.some(([m]) => m === "order")) {
          rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        }
        const range = call.ops.find(([m]) => m === "range");
        if (range) rows = rows.slice(range[1][0] as number, (range[1][1] as number) + 1);
        return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
      };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "in", "eq", "order", "is"]) {
        b[m] = (...args: unknown[]) => {
          call.ops.push([m, args]);
          return b;
        };
      }
      b.range = (from: number, to: number) => {
        call.ops.push(["range", [from, to]]);
        return Promise.resolve(result(false));
      };
      b.maybeSingle = () => Promise.resolve(result(true));
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(result(false)).then(res, rej);
      return b;
    },
  }),
}));

// --- Fixtures -------------------------------------------------------------------
const BRAND = "b0000000-0000-4000-8000-000000000001";
const KB_BRIDGED = "k0000000-0000-4000-8000-00000000000b";
const KB_LINKED = "k0000000-0000-4000-8000-00000000000l";

function kb(o: Row): Row {
  return {
    id: KB_BRIDGED,
    brand_slug: "greenway",
    product_slug: "gw-blue-dream-flower-3-5g",
    variant_label: "3.5 g",
    display_name: "GW - Blue Dream Flower 3.5g",
    category: "Usable Marijuana",
    aroma_notes: [],
    flavor_notes: [],
    terpenes: [],
    effects: [],
    description: "Bridged copy.",
    short_description: null,
    image_media_ids: [],
    primary_media_id: null,
    status: "draft",
    active: true,
    ...o,
  };
}
function lot(o: Row = {}): Row {
  return {
    id: "l0000000-0000-4000-8000-000000000001",
    pos_product_key: "LOT-1",
    // The RAW manifest name - what promoteManifestToKb handed the writer.
    product_name: "GW - Blue Dream Flower 3.5g",
    unit_weight: 3.5,
    unit_weight_uom: "g",
    brand_id: BRAND,
    kb_product_id: null,
    status: "received",
    disposition: null,
    ...o,
  };
}
// A mastered card: the DISPLAY name differs from the raw manifest name.
function card(o: Partial<GreenwayMenuItem> = {}): GreenwayMenuItem {
  return {
    id: "LOT-1",
    name: "Blue Dream",
    productName: "Blue Dream",
    brand: "Greenway",
    category: "flower",
    strainName: "",
    variants: [{ id: "LOT-1", label: "3.5g", priceMinorUnits: 2500, inventoryLevel: 4, medical: false }],
    ...o,
  } as unknown as GreenwayMenuItem;
}
const selectOf = (c: Call) => String(c.ops.find(([m]) => m === "select")?.[1][0] ?? "");
const callsTo = (t: string) => calls.filter((c) => c.table === t);

beforeEach(() => {
  calls.length = 0;
  fail = null;
  db = {
    kb_products: [kb({})],
    inventory_lots: [lot()],
    brands: [{ id: BRAND, display_name: "Greenway" }],
    product_enrichments: [],
    kb_strains: [],
    kb_banned_phrases: [],
  };
});

// === 1. Pure core ================================================================
describe("S24 pure core", () => {
  it("self-tests pass with the exact count", () => {
    expect(__runProductKnowledgeBatchTests()).toEqual({ passed: 145, failed: 0 });
  });
});

// === 2. The bible fixture, end to end =============================================
describe("S24.5 - a bridged row is found for a mastered display-name item", () => {
  it("queryFor carries the card's lots and first variant label", () => {
    const q = queryFor(
      card({
        variants: [
          { id: "LOT-1", label: "3.5g", priceMinorUnits: 1, inventoryLevel: 1, medical: false },
          { id: "LOT-9-onboarded", label: "7g", priceMinorUnits: 1, inventoryLevel: 1, medical: false },
        ],
      }),
    );
    expect(q.menuVariantLabel).toBe("3.5g");
    expect(q.lotKeys).toEqual(["LOT-1", "LOT-9"]);
    expect(q.productName).toBe("Blue Dream");
    expect(q.posProductKey).toBe("LOT-1");
    expect(queryFor(card({ variants: [] })).menuVariantLabel).toBeNull();
  });

  it("the menu grid (batched) shows the bridged kb_products copy", async () => {
    const map = await resolveDisplayKnowledgeMap([card()]);
    expect(map.get("LOT-1")?.description).toBe("Bridged copy.");
    expect(map.get("LOT-1")?.source).toBe("kb-draft");
  });

  it("the public product page (per item) shows the bridged kb_products copy", async () => {
    const d = await resolveDisplayKnowledge(card());
    expect(d.description).toBe("Bridged copy.");
    expect(d.source).toBe("kb-draft");
  });

  it("the command-center query shape (same inputs) finds it too", async () => {
    const k = await lookupProductKnowledge({
      productName: "Blue Dream",
      brandName: "Greenway",
      posProductKey: "LOT-1",
      strainName: null,
      menuVariantLabel: "3.5g",
      lotKeys: ["LOT-1"],
    });
    expect(k.description).toBe("Bridged copy.");
  });

  it("before S24 the same data was unreachable (the F-065 miss, proved)", async () => {
    const k = await lookupProductKnowledge({ productName: "Blue Dream", brandName: "Greenway", posProductKey: "LOT-1" });
    expect(k.source).toBe("none");
    const idx = await loadKnowledgeIndexes([{ productName: "Blue Dream", brandName: "Greenway" }]);
    expect(resolveKnowledgeFromIndexes({ productName: "Blue Dream", brandName: "Greenway" }, idx).source).toBe("none");
  });

  it("an onboarded variant's lot resolves the card", async () => {
    db.inventory_lots = [lot({ pos_product_key: "LOT-7" })];
    const map = await resolveDisplayKnowledgeMap([
      card({ variants: [{ id: "LOT-7-onboarded", label: "3.5g", priceMinorUnits: 1, inventoryLevel: 1, medical: false }] }),
    ]);
    expect(map.get("LOT-1")?.description).toBe("Bridged copy.");
  });
});

// === 3. Rungs, fallbacks, safety ==================================================
describe("S24 rungs and safety", () => {
  it("lot-link: inventory_lots.kb_product_id (S05) reads kb_products by id", async () => {
    db.inventory_lots = [lot({ kb_product_id: KB_LINKED, product_name: "Renamed Later" })];
    db.kb_products = [kb({ id: KB_LINKED, product_slug: "something-else", description: "Linked copy." })];
    const d = await resolveDisplayKnowledge(card());
    expect(d.description).toBe("Linked copy.");
    const byId = callsTo("kb_products").find((c) => c.ops.some(([m, a]) => m === "in" && a[0] === "id"));
    expect(byId?.ops.find(([m]) => m === "in")?.[1][1]).toEqual([KB_LINKED]);
  });

  it("pre-0234: kb_product_id missing -> retried without it; lot-identity still works", async () => {
    fail = {
      table: "inventory_lots",
      code: "42703",
      message: "column inventory_lots.kb_product_id does not exist",
      onlyWith: "kb_product_id",
    };
    const d = await resolveDisplayKnowledge(card());
    expect(d.description).toBe("Bridged copy.");
    const sels = callsTo("inventory_lots").map(selectOf);
    expect(sels).toEqual([
      "id, pos_product_key, product_name, unit_weight, unit_weight_uom, brand_id, kb_product_id, status, disposition",
      "id, pos_product_key, product_name, unit_weight, unit_weight_uom, brand_id, status, disposition",
    ]);
  });

  it("any other lot error: no lot rungs, never throws, legacy rung intact", async () => {
    fail = { table: "inventory_lots", message: "permission denied", code: "42501" };
    expect(await loadLotsForKnowledge((await import("@/lib/supabase/admin")).createSupabaseAdminClient(), ["LOT-1"])).toEqual([]);
    expect(callsTo("inventory_lots")).toHaveLength(1); // no retry for a non-0234 error
    calls.length = 0;
    db.kb_products.push(kb({ id: "k-legacy", product_slug: "blue-dream", variant_label: "", description: "Legacy copy." }));
    const d = await resolveDisplayKnowledge(card());
    expect(d.description).toBe("Legacy copy.");
    expect(callsTo("inventory_lots")).toHaveLength(1); // no retry for a non-0234 error
  });

  it("a partial lot-read failure drops ALL lots (no half-read card)", async () => {
    // 301 keys = two chunks of 300; only the second chunk errors.
    const keys = ["LOT-1", ...Array.from({ length: 299 }, (_, i) => `PAD-${i}`), "LOT-FAIL"];
    fail = { table: "inventory_lots", message: "statement timeout", code: "57014", onlyIn: "LOT-FAIL" };
    const admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
    expect(await loadLotsForKnowledge(admin, keys)).toEqual([]);
    fail = null;
    expect((await loadLotsForKnowledge(admin, keys)).map((r) => r.pos_product_key)).toEqual(["LOT-1"]);
  });

  it("a linked row already loaded by the slug read is still reachable by id", async () => {
    // Same product_slug as the display name, but a variant no key asks for:
    // only the S05 link can reach it, and it is NOT re-read by id.
    db.inventory_lots = [lot({ kb_product_id: KB_LINKED, product_name: "Renamed Later" })];
    db.kb_products = [kb({ id: KB_LINKED, product_slug: "blue-dream", variant_label: "1 g", description: "Linked copy." })];
    expect((await resolveDisplayKnowledge(card())).description).toBe("Linked copy.");
    expect(callsTo("kb_products").some((c) => c.ops.some(([m, a]) => m === "in" && a[0] === "id"))).toBe(false);
  });

  it("an unresolved brand is skipped, never read as 'unknown-brand'", async () => {
    fail = { table: "brands", message: "boom" };
    db.kb_products.push(kb({ id: "k-unk", brand_slug: "unknown-brand", description: "Wrong product." }));
    const d = await resolveDisplayKnowledge(card());
    expect(d.source).toBe("none");
  });

  it("a refused lot never reads (mirrors isPromotableLot)", async () => {
    db.inventory_lots = [lot({ disposition: "rejected_at_dock" })];
    expect((await resolveDisplayKnowledge(card())).source).toBe("none");
    expect(callsTo("brands")).toHaveLength(0);
  });

  it("a blank bridged draft never masks today's enrichment copy", async () => {
    db.kb_products = [kb({ description: null })];
    db.product_enrichments = [
      {
        id: "e1",
        pos_product_key: "LOT-1",
        display_name: "E",
        description: "Enrichment copy.",
        short_description: null,
        image_media_ids: [],
        primary_media_id: null,
      },
    ];
    expect((await resolveDisplayKnowledgeMap([card()])).get("LOT-1")?.description).toBe("Enrichment copy.");
    expect((await resolveDisplayKnowledge(card())).description).toBe("Enrichment copy.");
  });

  it("published beats a draft; per-item and batched agree", async () => {
    db.kb_products.push(kb({ id: "k-pub", product_slug: "blue-dream", variant_label: "3.5 g", status: "published", description: "Published copy." }));
    const one = await resolveDisplayKnowledge(card());
    const many = (await resolveDisplayKnowledgeMap([card()])).get("LOT-1");
    expect(one.description).toBe("Published copy.");
    expect(one.source).toBe("kb-exact");
    expect(many).toEqual(one);
  });

  it("every read is named-column, id-ordered and paged", async () => {
    db.inventory_lots = [lot({ kb_product_id: KB_LINKED })];
    await loadKbKnowledgeIndexes(queryFor(card()));
    for (const t of ["inventory_lots", "brands", "kb_products"]) {
      const cs = callsTo(t);
      expect(cs.length, t).toBeGreaterThan(0);
      for (const c of cs) {
        expect(selectOf(c)).not.toContain("*");
        expect(c.ops.find(([m]) => m === "order")?.[1]).toEqual(["id", { ascending: true }]);
        expect(c.ops.some(([m]) => m === "range")).toBe(true);
      }
    }
    expect(selectOf(callsTo("brands")[0])).toBe("id, display_name");
    expect(callsTo("inventory_lots")[0].ops.find(([m]) => m === "in")?.[1]).toEqual(["pos_product_key", ["LOT-1"]]);
  });

  it("the raw-name slug is read only when not already loaded", async () => {
    await loadKbKnowledgeIndexes(queryFor(card()));
    const slugReads = callsTo("kb_products")
      .map((c) => c.ops.find(([m, a]) => m === "in" && a[0] === "product_slug")?.[1][1])
      .filter(Boolean);
    expect(slugReads).toEqual([["blue-dream"], ["gw-blue-dream-flower-3-5g"]]);
  });
});

// === 4. No new I/O when there is nothing to use ====================================
describe("S24 costs nothing without writer-identity inputs", () => {
  it("no lot keys -> the pre-S24 three reads, no inventory_lots/brands", async () => {
    await loadKnowledgeIndexes([{ productName: "Blue Dream", brandName: "Greenway", posProductKey: "LOT-1" }]);
    expect(calls.map((c) => c.table).sort()).toEqual(["kb_products", "product_enrichments"]);
  });

  it("no inputs -> the per-item path is still checkProductKnown's exact read", async () => {
    expect(hasWriterIdentityInputs({ productName: "x" })).toBe(false);
    expect(hasWriterIdentityInputs({ productName: "x", lotKeys: [] })).toBe(false);
    expect(hasWriterIdentityInputs({ productName: "x", menuVariantLabel: "  " })).toBe(false);
    expect(hasWriterIdentityInputs({ productName: "x", menuVariantLabel: "3.5g" })).toBe(true);
    expect(hasWriterIdentityInputs({ productName: "x", lotKeys: ["L"] })).toBe(true);
    await lookupProductKnowledge({ productName: "Blue Dream", brandName: "Greenway" });
    const kbc = callsTo("kb_products");
    expect(kbc).toHaveLength(1);
    expect(kbc[0].ops.filter(([m]) => m === "eq").map(([, a]) => a)).toEqual([
      ["brand_slug", "greenway"],
      ["product_slug", "blue-dream"],
      ["variant_label", ""],
    ]);
    expect(callsTo("inventory_lots")).toHaveLength(0);
  });

  it("a variant label alone reaches the writer's '3.5 g' via the menu-variant rung", async () => {
    db.inventory_lots = [];
    db.kb_products = [kb({ id: "k-mv", product_slug: "blue-dream", description: "MV copy." })];
    const k = await lookupProductKnowledge({ productName: "Blue Dream", brandName: "Greenway", menuVariantLabel: "3.5g" });
    expect(k.description).toBe("MV copy.");
    expect(callsTo("inventory_lots")).toHaveLength(0);
  });
});

// === 5. Wiring + ledger ============================================================
describe("S24 wiring", () => {
  it("queryFor passes menuVariantLabel + cardLotKeys", () => {
    const src = stripComments(read("src/lib/menu/product-knowledge-display.ts"));
    expect(src).toMatch(/menuVariantLabel: variants\[0\]\?\.label \?\? null/);
    expect(src).toMatch(/lotKeys: cardLotKeys\(\{/);
    expect(src).toMatch(/source_variant_id: v\.id/);
  });

  it("command-center passes the same inputs (F-083)", () => {
    const src = stripComments(read("src/lib/enrichment/command-center.ts"));
    const call = src.slice(src.indexOf("lookupProductKnowledge({"), src.indexOf("}).catch("));
    expect(call).toMatch(/menuVariantLabel: item\.variants\?\.\[0\]\?\.label \?\? null/);
    // S23 hoisted the lot keys into ONE constant so the KB ladder and the
    // gap header's fact-history read use the identical keys.
    expect(call).toMatch(/\blotKeys,\n/);
    const decl = src.slice(src.indexOf("const lotKeys = cardLotKeys({"), src.indexOf("lookupProductKnowledge({"));
    expect(decl.length).toBeGreaterThan(0);
    expect(decl).toMatch(/source_item_id: posKey \?\? ""/);
    expect(decl).toMatch(/source_variant_id: v\.source_variant_id/);
    expect(src).toMatch(/loadGapProvenance\(\{ identityKeys: \[identityKey\], posKeys: lotKeys \}\)/);
  });

  it("the admin page hands command-center the item WITH its variants", () => {
    const page = read("src/app/admin/products/[key]/page.tsx");
    expect(page).toContain("const item = await getItemBySourceKey(published.id, key);");
    expect(page).toContain("getEnrichmentCommandCenter({ item })");
    expect(read("src/lib/pos/menu-version.ts")).toMatch(/getItemBySourceKey\([\s\S]*?\): Promise<MenuItemWithVariants \| null>/);
  });

  it("product-lookup resolves rungs 1&2 through the shared pure picker", () => {
    const src = stripComments(read("src/lib/ai/kb/product-lookup.ts"));
    expect(src).toContain("resolveKbFromIndexes(query, kbIndexes)");
    expect(src).toContain("loadKbKnowledgeIndexes(query)");
    // R24 S20 (F-053): the spaced kb_strains slug now comes from slug-core
    // (updated on purpose; the rule's body is pinned in r24-s20-slug-core-brand).
    expect(src).toContain("const slug = strainSlug(query.strainName);");
    expect(src).toContain('import { strainSlug } from "@/lib/catalog/slug-core";');
  });

  it("the loader keeps chunkedIn + MENU_READ_CONCURRENCY on every S24 read", () => {
    const src = stripComments(read("src/lib/ai/kb/product-knowledge-batch.ts"));
    expect(src.match(/chunkedIn</g)?.length).toBeGreaterThanOrEqual(6);
    expect(src.match(/concurrency: MENU_READ_CONCURRENCY/g)?.length).toBeGreaterThanOrEqual(6);
    expect(src).toContain('isMissingIdentityColumnError("inventory_lots", res.error)');
    expect(src).not.toMatch(/\.select\("\*"\)/);
  });

  it("no S24 file reads the environment or writes", () => {
    for (const f of [
      "src/lib/ai/kb/product-knowledge-batch-core.ts",
      "src/lib/ai/kb/product-knowledge-batch.ts",
      "src/lib/ai/kb/product-lookup.ts",
      "src/lib/menu/product-knowledge-display.ts",
    ]) {
      const src = stripComments(read(f));
      expect(src, f).not.toMatch(/process\.env/);
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    }
  });

  it("env ledger records S24 as no-variable, 'Revert.'", () => {
    const ledger = read("docs/INTAKE_PIPELINE_ENV_LEDGER.md");
    // Later slices move the "As of" marker forward; S24 must stay in its no-variable list.
    expect(ledger).toMatch(/As of \*\*S\d+\*\* it reads \([^)]*\bS24\b[^)]*added no variable/);
    expect(ledger).toMatch(/Slices that added \*\*no\*\* variable:[^\n]*\bS24\b/);
    expect(ledger).toMatch(/"Revert\." \(S16, S21, S22, S23, S24\)/); // S23 joined in Round 20
    expect(ledger).toContain("S24 needs nothing set");
  });
});
