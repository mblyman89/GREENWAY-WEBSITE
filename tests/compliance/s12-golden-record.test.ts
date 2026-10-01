/**
 * tests/compliance/s12-golden-record.test.ts  (SLICE S12 + the R19 staging-read fix)
 *
 * Owner request (Round 19, verbatim): "Please fix those two things while
 * building the next two slices." S12 = "Approve materializes the golden record
 * onto the menu item (no more boilerplate description)".
 *
 * What this file proves, by EXECUTING code (not grepping it) wherever the
 * code can run without a database:
 *   1. the pure core (golden-record-core) runs green from the runner;
 *   2. the server half (golden-record-server.loadGoldenInputs) reads ONLY the
 *      planned drafts' attached_facts, lints prose with the REAL compliance
 *      linter + the owner's banned phrases, drops blocked copy, tolerates a
 *      database without migration 0235, and does nothing when the flag is off;
 *   3. both menu producers feed the golden inputs into the planner, and the
 *      FULL staging planner (buildIntakeStagedVersionPlan) puts the attached
 *      copy and strain type on the row that gets INSERTed;
 *   4. R19 defect: the approve path (intake-menu-staging.ts) now reads the
 *      approver's compliance answers (0218) and measured volume (0224) with
 *      the same graduated fallback as draft-injection.ts, and the planner
 *      carries them to the row.
 */
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const banned: { phrase: string; severity: "block" | "warn"; reason: string | null }[] = [];
vi.mock("@/lib/ai/kb/retrieval", () => ({ loadBannedPhrases: async () => banned }));

type Call = { table: string; select: string; ids: string[] };
const db: { calls: Call[]; rows: { id: string; attached_facts: unknown }[]; error: { code: string; message: string } | null } = {
  calls: [],
  rows: [],
  error: null,
};
function fakeAdmin() {
  return {
    from(table: string) {
      const call: Call = { table, select: "", ids: [] };
      const q = {
        select(cols: string) {
          call.select = cols;
          return q;
        },
        in(_col: string, ids: string[]) {
          call.ids = ids;
          return q;
        },
        order() {
          return q;
        },
        async range(from: number, to: number) {
          db.calls.push(call);
          if (db.error) return { data: null, error: db.error };
          const rows = db.rows.filter((r) => call.ids.includes(r.id)).slice(from, to + 1);
          return { data: rows, error: null };
        },
      };
      return q;
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fakeAdmin() }));

import { __runGoldenRecordCoreTests, GOLDEN_RECORD_ENV } from "@/lib/catalog/golden-record-core";
import { loadGoldenInputs } from "@/lib/catalog/golden-record-server";
import { buildIntakeStagedVersionPlan } from "@/lib/pos/intake-menu-staging-core";
import type { ApprovedDraftForInjection, DraftEnrichment } from "@/lib/pos/draft-injection-core";

const read = (p: string) => readFileSync(p, "utf8");
const at = "2026-01-01T00:00:00Z";
const saved = process.env[GOLDEN_RECORD_ENV];
beforeEach(() => {
  db.calls = [];
  db.rows = [];
  db.error = null;
  banned.length = 0;
  delete process.env[GOLDEN_RECORD_ENV];
});
afterEach(() => {
  if (saved === undefined) delete process.env[GOLDEN_RECORD_ENV];
  else process.env[GOLDEN_RECORD_ENV] = saved;
});

describe("S12 pure core", () => {
  it("runs its embedded self-tests green (57 assertions)", () => {
    const r = __runGoldenRecordCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(57);
  });
  it("is registered in the pure runner", () => {
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toMatch(/__runGoldenRecordCoreTests\(\); if \(r\.failed > 0 \|\| r\.passed < 57\)/);
  });
  it("imports nothing server-only (pure)", () => {
    const src = read("src/lib/catalog/golden-record-core.ts");
    const imports = src.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
    expect(imports).not.toMatch(/server-only|@\/lib\/ai\/compliance|supabase/);
    expect(imports).toMatch(/attach-facts-core/);
    expect(src).not.toMatch(/process\.env/);
  });
});

describe("S12 server half - loadGoldenInputs", () => {
  const admin = () => fakeAdmin() as never;

  it("reads only the named column for exactly the planned drafts", async () => {
    db.rows = [{ id: "d1", attached_facts: { description: { value: "Bright citrus aroma.", source: "gemini", confidence: 0.95, at } } }];
    const m = await loadGoldenInputs(admin(), ["d1", "d2"]);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].table).toBe("catalog_product_drafts");
    expect(db.calls[0].select).toBe("id, attached_facts");
    expect(db.calls[0].ids).toEqual(["d1", "d2"]);
    expect(m.get("d1")?.goldenDescription?.text).toBe("Bright citrus aroma.");
    expect(m.has("d2")).toBe(false);
  });

  it("drops copy the REAL compliance linter blocks (medical claim), keeps the strain", async () => {
    db.rows = [
      {
        id: "d1",
        attached_facts: {
          description: { value: "This strain treats anxiety and cures insomnia.", source: "human", confidence: null, at },
          strain_type: { value: "Indica", source: "gemini", confidence: 0.92, at },
        },
      },
    ];
    const m = await loadGoldenInputs(admin(), ["d1"]);
    expect(m.get("d1")?.goldenDescription).toBeNull();
    expect(m.get("d1")?.attachedStrainType?.value).toBe("indica");
  });

  it("layers the owner's banned phrases (block) on top", async () => {
    banned.push({ phrase: "best in town", severity: "block", reason: null });
    db.rows = [{ id: "d1", attached_facts: { description: { value: "The best in town flower.", source: "human", confidence: null, at } } }];
    const m = await loadGoldenInputs(admin(), ["d1"]);
    expect(m.has("d1")).toBe(false);
  });

  it("keeps warn-only copy (owner's warn-only rule for borderline copy)", async () => {
    banned.push({ phrase: "smooth", severity: "warn", reason: null });
    db.rows = [{ id: "d1", attached_facts: { description: { value: "A smooth, sweet smoke.", source: "human", confidence: null, at } } }];
    const m = await loadGoldenInputs(admin(), ["d1"]);
    expect(m.get("d1")?.goldenDescription?.text).toBe("A smooth, sweet smoke.");
  });

  it("never lets a sub-90 machine fact through", async () => {
    db.rows = [{ id: "d1", attached_facts: { description: { value: "Maybe citrus.", source: "gemini", confidence: 0.8, at } } }];
    expect((await loadGoldenInputs(admin(), ["d1"])).size).toBe(0);
  });

  it("a database without 0235 returns nothing (placeholder, as before)", async () => {
    db.error = { code: "42703", message: 'column catalog_product_drafts.attached_facts does not exist' };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await loadGoldenInputs(admin(), ["d1"])).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("any other failed read returns nothing and logs it (never a guess)", async () => {
    db.error = { code: "57014", message: "statement timeout" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await loadGoldenInputs(admin(), ["d1"])).size).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("GOLDEN_RECORD_ON_APPROVE=off makes no read at all (rollback)", async () => {
    process.env[GOLDEN_RECORD_ENV] = "off";
    db.rows = [{ id: "d1", attached_facts: { description: { value: "Real.", source: "human", confidence: null, at } } }];
    expect((await loadGoldenInputs(admin(), ["d1"])).size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it("no drafts = no read", async () => {
    await loadGoldenInputs(admin(), []);
    expect(db.calls).toHaveLength(0);
  });
});

describe("S12 wiring - both producers feed the planner", () => {
  for (const f of ["src/lib/pos/draft-injection.ts", "src/lib/pos/intake-menu-staging.ts"]) {
    it(`${f} loads the golden inputs and spreads them into the enrichment`, () => {
      const src = read(f);
      expect(src).toMatch(/const goldenByDraftId = await loadGoldenInputs\(admin, drafts\.map\(\(d\) => d\.id\)\);/);
      expect(src).toMatch(/\.\.\.\(goldenByDraftId\.get\(d\.id\) \?\? \{\}\),/);
    });
  }
  it("the planner no longer hard-codes the placeholder", () => {
    const src = read("src/lib/pos/draft-injection-core.ts");
    expect(src).toMatch(/description: goldenCopy \?\? boilerplateDescription\(d\.name, brand\),/);
    expect(src).toMatch(/strain_type: golden\.value,/);
  });
  it("mastering only rebuilds the placeholder", () => {
    const src = read("src/lib/pos/intake-mastering-core.ts");
    expect(src).toMatch(/if \(isBoilerplateDescription\(single\.description\)\) \{/);
    expect(src).toMatch(/sortedItems\.map\(\(gi\) => gi\.description\)\.find\(\(t\) => !isBoilerplateDescription\(t\)\)/);
  });
});

const draft = (over: Partial<ApprovedDraftForInjection> = {}): ApprovedDraftForInjection => ({
  id: "d1",
  pos_product_key: "LOT-A",
  name: "Blue Dream 1g",
  brand_name: "Fairwinds",
  vendor_name: "Fairwinds LLC",
  strain_name: "Blue Dream",
  thc_pct: 21,
  cbd_pct: null,
  total_thc_pct: 22,
  potency_json: null,
  price_minor_units: 1200,
  updated_at: at,
  inventory_type: "Usable Marijuana",
  ...over,
});
const enrich = (over: Partial<DraftEnrichment> = {}): DraftEnrichment => ({
  websiteCategory: "flower",
  strainType: null,
  onHandQty: 5,
  packageLabel: "1g",
  ...over,
});

describe("S12 end to end through the staging planner (the row that gets INSERTed)", () => {
  it("attached copy + strain reach the staged row", () => {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [],
      approvedDrafts: [draft()],
      enrichmentByDraftId: new Map([
        [
          "d1",
          enrich({
            goldenDescription: { text: "Sweet berry, calm finish.", field: "description", source: "gemini", confidence: 0.95 },
            attachedStrainType: { value: "sativa", source: "gemini", confidence: 0.95 },
          }),
        ],
      ]),
    });
    const row = plan.items.find((i) => i.source_item_id === "LOT-A");
    expect(row?.description).toBe("Sweet berry, calm finish.");
    expect(row?.strain_type).toBe("sativa");
    expect(row?.origin).toBe("intake");
  });

  it("no golden inputs = the placeholder exactly as before S12", () => {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [],
      approvedDrafts: [draft()],
      enrichmentByDraftId: new Map([["d1", enrich()]]),
    });
    const row = plan.items.find((i) => i.source_item_id === "LOT-A");
    expect(row?.description).toBe(
      "Blue Dream from Fairwinds. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.",
    );
    expect(row?.strain_type).toBe("unknown");
  });
});

describe("R19 defect - the approve path reads the approver's compliance answers", () => {
  const src = read("src/lib/pos/intake-menu-staging.ts");
  it("selects 0218 + 0224 in the widest tier with a graduated fallback", () => {
    expect(src).toMatch(/", chosen_otherwise_taken, chosen_units_per_package, chosen_low_thc_liquid, chosen_unit_thc_mg" \+\s*\n\s*", chosen_net_volume_ml";/);
    expect(src).toMatch(/const firstTry = missingCol\(withCompliance\.error\)/);
  });
  it("never turns a null count / dose / volume into zero", () => {
    expect(src).toMatch(/r\.chosen_units_per_package != null \? Number\(r\.chosen_units_per_package\) : null/);
    expect(src).toMatch(/chosen_unit_thc_mg: r\.chosen_unit_thc_mg != null \? Number\(r\.chosen_unit_thc_mg\) : null/);
    expect(src).toMatch(/chosen_net_volume_ml: r\.chosen_net_volume_ml != null \? Number\(r\.chosen_net_volume_ml\) : null/);
  });
  it("the staging planner carries the answers to the row (executed)", () => {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [],
      approvedDrafts: [
        draft({
          name: "Relief Suppository 6-pack",
          strain_name: null,
          inventory_type: "Topical Ointment",
          chosen_website_category: "topical",
          chosen_otherwise_taken: true,
          chosen_units_per_package: 6,
          chosen_low_thc_liquid: false,
          chosen_unit_thc_mg: 10,
        }),
      ],
      enrichmentByDraftId: new Map([["d1", enrich({ websiteCategory: "topical" })]]),
    });
    const row = plan.items.find((i) => i.source_item_id === "LOT-A");
    expect(row?.otherwise_taken).toBe(true);
    expect(row?.units_per_package).toBe(6);
    expect(row?.low_thc_liquid).toBe(false);
    expect(row?.unit_thc_mg).toBe(10);
  });
  it("the measured volume reaches the row with human provenance (executed)", () => {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [],
      approvedDrafts: [draft({ name: "Mystery Drink", strain_name: null, inventory_type: "Liquid Edible", chosen_website_category: "edible-liquid", chosen_net_volume_ml: 355 })],
      enrichmentByDraftId: new Map([["d1", enrich({ websiteCategory: "edible-liquid" })]]),
    });
    const row = plan.items.find((i) => i.source_item_id === "LOT-A");
    expect(row?.net_volume_ml).toBe(355);
    expect(row?.fact_provenance?.net_volume_ml).toBe("human");
  });
});
