/**
 * tests/compliance/s23-gap-vector.test.ts   (Round 20, slice S23)
 *
 * Bible S23: "Per-field gap vector; boilerplate counts as missing; 'loud'
 * missing fields."
 *   S23.5 test:       "Boilerplate template string -> hasDescription=false."
 *   S23.6 acceptance: "Intake products no longer appear 'described' when only
 *                      boilerplate exists."
 *   S23.4 copy:       "Still missing: terpenes, image. Attached at onboarding:
 *                      description (Gemini 94%), effects (KB), strain type (You)."
 *
 * The decisions live in gap-vector-core (92 embedded self-tests, pinned
 * below). Here we prove: (1) computeGaps - the function behind every list
 * counter and filter - treats EVERY writer's placeholder as missing, using
 * the writers' REAL template text read from source (not a copy that could
 * drift); (2) the one new read (product_fact_provenance) goes out bounded,
 * named and keyed exactly as documented, degrades to "not read" on a
 * pre-0235 database, and never throws; (3) rows read through that path
 * produce the bible's sentence verbatim; (4) the pages are wired.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type FakeRequest } from "./helpers/fake-postgrest";

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
  GAP_PROVENANCE_FIELDS,
  GAP_PROVENANCE_LIMIT,
  __runGapVectorCoreTests,
  buildGapVector,
  gapFootnote,
  gapHeadline,
} from "@/lib/enrichment/gap-vector-core";
import { gapProvenanceKeys, loadGapProvenance } from "@/lib/enrichment/gap-vector-server";
import { computeGaps } from "@/lib/enrichment/store";
import { BOILERPLATE_TAIL, boilerplateDescription } from "@/lib/catalog/golden-record-core";
import { PROVENANCE_TABLE } from "@/lib/catalog/attach-facts-core";
import type { MenuItemRow } from "@/lib/pos/db-types";
import type { ProductEnrichment } from "@/lib/enrichment/types";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const ID = "grow-op-farms|flower|blue-dream";
const REAL = "A bright, berry-forward sativa-leaning hybrid with a sweet finish.";

function item(over: Partial<MenuItemRow> = {}): MenuItemRow {
  return {
    id: "mi-1",
    menu_version_id: "v1",
    source_item_id: "LOT-1",
    name: "Blue Dream 3.5g",
    product_name: "Blue Dream",
    brand_name: "Fairwinds",
    vendor_name: "Grow Op Farms",
    category: "flower",
    strain_type: "hybrid",
    description: "",
    price_minor_units: 3000,
    inventory_status: "in-stock",
    ...over,
  } as MenuItemRow;
}

function enr(over: Partial<ProductEnrichment> = {}): ProductEnrichment {
  return {
    id: "e1",
    pos_product_key: "LOT-1",
    description: null,
    short_description: null,
    image_media_ids: [],
    primary_media_id: null,
    brand_id: null,
    tags: [],
    status: "published",
    ...over,
  } as ProductEnrichment;
}

/**
 * The transform.ts genericDescription placeholder. R24 S23 follow-up (updated
 * ON PURPOSE): transform.ts no longer has an inline template; it delegates to
 * golden-record-core boilerplateDescription(). Read the source to prove the
 * delegation is still the shape below, then instantiate through the shared
 * function - so a drifted copy reappearing in transform.ts fails here. The
 * byte-for-byte golden master against the legacy template, through the REAL
 * transformWorkbooks pipeline, lives in r24-s23-transform-boilerplate.test.ts.
 */
function transformGeneric(displayName: string, brand: string): string {
  const src = read("src/lib/pos/transform.ts");
  if (!src.includes("function genericDescription(group: ProductGroup) { return boilerplateDescription(group.displayName, group.brand); }")) {
    throw new Error("transform.ts genericDescription no longer delegates to boilerplateDescription - update this test with the new shape");
  }
  if (src.includes("Browse current availability")) throw new Error("transform.ts has an inline copy of the placeholder sentence again");
  return boilerplateDescription(displayName, brand);
}

beforeEach(() => {
  st.db = new FakePostgrest();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("S23 pure core", () => {
  it("embedded self-tests: exactly 92 pass, 0 fail (pinned)", () => {
    expect(__runGapVectorCoreTests()).toEqual({ passed: 92, failed: 0 });
  });
  it("the runner registers them with the exact floor", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("gap-vector-core", __runGapVectorCoreTests\(\), 92\)/);
  });
  it("the core is pure: no environment, no server-only, no I/O imports", () => {
    const src = read("src/lib/enrichment/gap-vector-core.ts");
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/server-only|supabase|fetch\(/);
  });
});

describe("S23.5: boilerplate template string -> hasDescription=false (computeGaps)", () => {
  it("transform.ts genericDescription (Cultivera import), from its real source template", () => {
    const bp = transformGeneric("Blue Dream 3.5g", "Fairwinds");
    expect(bp).toBe("Blue Dream 3.5g from Fairwinds. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.");
    const g = computeGaps(item({ description: bp }), null);
    expect(g.hasDescription).toBe(false);
    expect(g.descriptionPlaceholder).toBe(true);
  });
  it("draft-injection / golden-record boilerplateDescription, with and without a brand", () => {
    for (const bp of [boilerplateDescription("Blue Dream 1g", "Fairwinds"), boilerplateDescription("Blue Dream 1g", "")]) {
      expect(computeGaps(item({ description: bp }), null).hasDescription).toBe(false);
    }
  });
  it("boilerplate on the ENRICHMENT row and the item -> still missing", () => {
    const bp = boilerplateDescription("Blue Dream", "Fairwinds");
    const g = computeGaps(item({ description: bp }), enr({ description: bp }));
    expect(g.hasDescription).toBe(false);
    expect(g.descriptionPlaceholder).toBe(true);
  });
  it("blank everywhere -> missing, and NOT flagged as a placeholder", () => {
    const g = computeGaps(item({ description: "   " }), enr({ description: "" }));
    expect(g.hasDescription).toBe(false);
    expect(g.descriptionPlaceholder).toBe(false);
  });
  it("real copy on the enrichment row wins over a placeholder item", () => {
    const g = computeGaps(item({ description: boilerplateDescription("Blue Dream", "Fairwinds") }), enr({ description: REAL }));
    expect(g.hasDescription).toBe(true);
    expect(g.descriptionPlaceholder).toBe(false);
  });
  it("real copy on the menu row counts even when the enrichment row has the placeholder", () => {
    expect(computeGaps(item({ description: REAL }), enr({ description: boilerplateDescription("x", "y") })).hasDescription).toBe(true);
  });
  it("a real description that merely QUOTES the tail mid-text is real copy", () => {
    expect(computeGaps(item({ description: `${boilerplateDescription("x", "y")} Grown indoors in Kitsap.` }), null).hasDescription).toBe(true);
  });
  it("every src writer of the placeholder sentence carries the exact BOILERPLATE_TAIL (no drifted copy)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n)) {
          const s = readFileSync(p, "utf8");
          for (const line of s.split("\n")) if (line.includes("Browse current availability")) hits.push(`${path.relative(ROOT, p)}: ${line.trim()}`);
        }
      }
    };
    walk(path.join(ROOT, "src"));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      if (h.startsWith("src/lib/catalog/golden-record-core.ts")) continue; // the definition itself
      expect(h, h).toContain(BOILERPLATE_TAIL.trim().slice(2)); // "Browse current ... Port Orchard."
    }
  });
});

describe("S23.6 acceptance: intake products no longer appear 'described' when only boilerplate exists", () => {
  it("the list counters (computeGaps) count placeholder-only cards as missing", () => {
    const items = [
      item({ source_item_id: "A", description: transformGeneric("Alpha", "Fairwinds") }),
      item({ source_item_id: "B", description: boilerplateDescription("Bravo", "Fairwinds") }),
      item({ source_item_id: "C", description: REAL }),
      item({ source_item_id: "D", description: "" }),
    ];
    const gaps = items.map((i) => computeGaps(i, null));
    expect(gaps.filter((g) => !g.hasDescription).map((g) => g.posKey)).toEqual(["A", "B", "D"]);
    expect(gaps.filter((g) => g.descriptionPlaceholder === true).map((g) => g.posKey)).toEqual(["A", "B"]);
  });
  it("the list page filters, counters and table use computeGaps' flags, plus the placeholder hint", () => {
    const page = read("src/app/admin/products/page.tsx");
    expect(page).toContain('if (gap === "description") filtered = filtered.filter((g) => !g.hasDescription);');
    expect(page).toContain("const missingDesc = gaps.filter((g) => !g.hasDescription).length;");
    expect(page).toContain("const placeholderDesc = gaps.filter((g) => g.descriptionPlaceholder === true).length;");
    expect(page).toContain("only have the placeholder sentence");
    expect(page).toContain("descriptionPlaceholder: g.descriptionPlaceholder === true,");
    expect(read("src/components/admin/products/ProductGrid.tsx")).toContain('why={c.descriptionPlaceholder ? "only the placeholder sentence" : undefined}');
  });
  it("computeGaps uses the core's describedBy (one rule for the list and the header)", () => {
    const store = read("src/lib/enrichment/store.ts");
    expect(store).toContain("const describedFrom = describedBy(enrichment?.description, item.description);");
    expect(store).toContain("const hasDescription = describedFrom !== null;");
    expect(store).not.toMatch(/Boolean\(enrichment\?\.description \|\| \(item\.description/);
  });
});

describe("loadGapProvenance (the one S23 read)", () => {
  const prov = (over: Record<string, unknown>) => ({
    id: st.db.nextId(),
    identity_key: ID,
    kb_product_id: null,
    draft_id: null,
    lot_id: null,
    pos_product_key: "LOT-1",
    field: "description",
    value_json: REAL,
    source: "gemini",
    confidence: 0.94,
    source_urls: null,
    actor_id: null,
    created_at: "2026-02-01T00:00:00Z",
    ...over,
  });
  const gets = () => st.db.log.filter((r) => r.method === "GET" && r.table === PROVENANCE_TABLE);

  it("no keys -> null and NO request", async () => {
    expect(await loadGapProvenance({ identityKeys: [null, "  "], posKeys: [] })).toBeNull();
    expect(gets()).toHaveLength(0);
  });
  it("keys are trimmed and de-duplicated", () => {
    expect(gapProvenanceKeys([" a ", "a", null, "", "b"])).toEqual(["a", "b"]);
    expect(gapProvenanceKeys(null)).toEqual([]);
  });
  it("two bounded, named, keyed reads: identity_key and pos_product_key; only gap fields; newest first", async () => {
    await loadGapProvenance({ identityKeys: [ID], posKeys: ["LOT-1", "LOT-2"] });
    const g = gets();
    expect(g).toHaveLength(2);
    for (const r of g) {
      const sel = r.url.searchParams.get("select") ?? "";
      expect(sel).not.toContain("*");
      expect(sel.split(",").map((c) => c.trim())).toEqual(["id", "field", "value_json", "source", "confidence", "created_at"]);
      expect(r.url.searchParams.get("field")).toBe(`in.(${GAP_PROVENANCE_FIELDS.join(",")})`);
      expect(r.url.searchParams.get("order")).toBe("created_at.desc");
      expect(r.url.searchParams.get("limit")).toBe(String(GAP_PROVENANCE_LIMIT));
    }
    expect(g.map((r) => r.url.searchParams.get("identity_key")).filter(Boolean)).toEqual([`in.(${ID})`]);
    expect(g.map((r) => r.url.searchParams.get("pos_product_key")).filter(Boolean)).toEqual(["in.(LOT-1,LOT-2)"]);
  });
  it("only identity keys -> one read (no empty IN)", async () => {
    await loadGapProvenance({ identityKeys: [ID] });
    expect(gets()).toHaveLength(1);
    expect(gets()[0]!.url.searchParams.get("identity_key")).toBe(`in.(${ID})`);
  });
  it("a row found by BOTH keys is returned once; other products' rows and non-gap fields are not returned", async () => {
    st.db.rows(PROVENANCE_TABLE).push(
      prov({ field: "description" }),
      prov({ field: "effects", value_json: ["calm"], source: "kb_published", confidence: null, pos_product_key: "OTHER" }),
      prov({ field: "strain_type", value_json: "hybrid", source: "human", confidence: null, identity_key: "other|flower|x" }),
      prov({ field: "thc_pct", value_json: 22 }),
      prov({ field: "description", identity_key: "other|flower|x", pos_product_key: "OTHER" }),
    );
    const rows = await loadGapProvenance({ identityKeys: [ID], posKeys: ["LOT-1"] });
    expect(rows).not.toBeNull();
    expect(rows!.map((r) => r.field).sort()).toEqual(["description", "effects", "strain_type"]);
  });
  it("pre-0235 (table missing) -> null, quietly", async () => {
    st.db.missing.add(PROVENANCE_TABLE);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadGapProvenance({ identityKeys: [ID], posKeys: ["LOT-1"] })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
  it("any other error on EITHER read -> null (never a half history), logged", async () => {
    st.db.before = (req: FakeRequest) => {
      if (req.url.searchParams.has("pos_product_key")) return { status: 500, body: { code: "XX000", message: "boom", details: null, hint: null } };
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadGapProvenance({ identityKeys: [ID], posKeys: ["LOT-1"] })).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("a thrown fetch -> null, never throws", async () => {
    // postgrest-js (2.108) retries a thrown GET with 1s/2s/4s backoff and then
    // RETURNS {error}; an AbortError skips the retries and takes the same
    // return-an-error path, so the test is fast and models the real client.
    st.db.before = () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadGapProvenance({ identityKeys: [ID] })).resolves.toBeNull();
    expect(spy).toHaveBeenCalled();
  });
  it("a client that THROWS synchronously -> null, never throws (the page still renders)", async () => {
    const throwing = {
      from() {
        throw new Error("boom");
      },
    } as unknown as Parameters<typeof loadGapProvenance>[1];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadGapProvenance({ identityKeys: [ID], posKeys: ["LOT-1"] }, throwing)).resolves.toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[gap-vector] fact history read threw"), expect.stringContaining("boom"));
  });
});

describe("S23.4: the detail header sentence, end to end through the read", () => {
  it("rows read back from product_fact_provenance produce the bible copy verbatim", async () => {
    const base = { identity_key: ID, kb_product_id: null, draft_id: null, lot_id: null, pos_product_key: "LOT-1", source_urls: null, actor_id: null };
    st.db.rows(PROVENANCE_TABLE).push(
      { id: st.db.nextId(), ...base, field: "description", value_json: "older", source: "gemini", confidence: 0.71, created_at: "2026-01-01T00:00:00Z" },
      { id: st.db.nextId(), ...base, field: "description", value_json: REAL, source: "gemini", confidence: 0.94, created_at: "2026-02-01T00:00:00Z" },
      { id: st.db.nextId(), ...base, field: "effects", value_json: ["calm"], source: "kb_published", confidence: null, created_at: "2026-02-01T00:00:00Z" },
      { id: st.db.nextId(), ...base, field: "strain_type", value_json: "hybrid", source: "human", confidence: null, created_at: "2026-02-01T00:00:00Z" },
    );
    const provenance = await loadGapProvenance({ identityKeys: [ID], posKeys: ["LOT-1"] });
    const v = buildGapVector({
      item: { description: boilerplateDescription("Blue Dream", "Fairwinds"), strain_type: "Hybrid", category: "flower" },
      enrichment: { description: REAL, short_description: "Berry hybrid.", primary_media_id: null, image_media_ids: [], brand_id: "b1", tags: ["local"] },
      knowledge: { source: "kb-exact", effects: ["calm"], terpenes: [], aromaNotes: ["berry"], flavorNotes: ["sweet"] },
      provenance,
    });
    expect(gapHeadline(v)).toBe(
      "Still missing: terpenes, image. Attached at onboarding: description (Gemini 94%), effects (KB), strain type (You).",
    );
  });
  it("a pre-0235 database: no chips, and the header says the history could not be read", async () => {
    st.db.missing.add(PROVENANCE_TABLE);
    const provenance = await loadGapProvenance({ identityKeys: [ID] });
    const v = buildGapVector({
      item: { description: REAL, strain_type: "Hybrid", category: "flower" },
      enrichment: null,
      knowledge: null,
      provenance,
    });
    expect(v.entries.every((e) => e.attachedBy === null)).toBe(true);
    expect(gapFootnote(v)).toContain("The onboarding history could not be read");
  });
});

describe("S23 wiring", () => {
  const cc = read("src/lib/enrichment/command-center.ts");
  const detail = read("src/app/admin/products/[key]/page.tsx");
  it("the command center builds the vector from the SERVED row, the KB result and the history", () => {
    expect(cc).toContain("gapVector: GapVector;");
    expect(cc).toMatch(/const gapVector = buildGapVector\(\{\s*item: \{ description: item\.description, strain_type: item\.strain_type, category: item\.category \},\s*enrichment,\s*knowledge: \{ \.\.\.filledKnowledge, sensoryOrigins: filled\.origins \},\s*provenance,\s*\}\);/);
    // R23: the vector reads the GAP-FILLED knowledge (ladder lists kept, empty ones filled).
    expect(cc).toContain("const filled = fillSensory(");
    expect(cc).toContain("loadGapProvenance({ identityKeys: [identityKey], posKeys: lotKeys }).catch(() => null)");
    expect(cc).toMatch(/\n    gapVector,\n/);
  });
  it("the history read runs CONCURRENTLY with the other command-center reads (no extra round trip)", () => {
    const all = cc.slice(cc.indexOf("await Promise.all(["), cc.indexOf("const enrichment = served.row;"));
    expect(all).toContain("loadGapProvenance(");
    expect(cc).toMatch(/const \[served, knowledge, kbRows, mediaRows, vendorRows, liveImage, substitute, provenance\] =/);
  });
  it("the detail page renders the header sentence, red missing chips, attached chips and the footnote", () => {
    expect(detail).toContain('import { gapHeadline, gapFootnote } from "@/lib/enrichment/gap-vector-core";');
    expect(detail).toContain('data-testid="gap-header"');
    expect(detail).toContain("{gapHeadline(center.gapVector)}");
    expect(detail).toContain('.filter((g) => g.state === "missing")');
    expect(detail).toContain("Missing: {g.label}");
    expect(detail).toContain(".filter((g) => g.attachedBy !== null)");
    expect(detail).toContain("{gapFootnote(center.gapVector)}");
    expect(detail).toContain("--admin-danger");
  });
  it("the server file is server-only and reads nothing from the environment", () => {
    const srv = read("src/lib/enrichment/gap-vector-server.ts");
    expect(srv).toContain('import "server-only";');
    expect(srv).not.toMatch(/process\.env/);
    expect(srv).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it("GapFlags.descriptionPlaceholder is OPTIONAL (literal GapFlags-shaped rows elsewhere predate it)", () => {
    expect(read("src/lib/enrichment/store.ts")).toContain("descriptionPlaceholder?: boolean;");
  });
  it("no schema: S23 adds no migration", () => {
    const migs = readdirSync(path.join(ROOT, "supabase/migrations"));
    expect(migs.some((m) => /gap|s23/i.test(m))).toBe(false);
  });
});
