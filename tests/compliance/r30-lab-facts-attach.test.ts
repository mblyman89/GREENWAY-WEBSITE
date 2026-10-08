/**
 * tests/compliance/r30-lab-facts-attach.test.ts
 *
 * R30 - onboarding marries every fact we can get, on the FIRST pass:
 *
 *   1. The pure planner over the REAL owner certificates (tests/fixtures/coa):
 *      flower terpenes + potency + cannabinoids; a concentrate's terpenes
 *      attach to the PRODUCT but never teach the strain; edible mg facts are
 *      attached and the WAC 10 mg/serving limit is still reported (item 13).
 *   2. The server orchestrator (attachLabFactsToManifestDrafts) against an
 *      in-memory database: draft facts written with source "coa", one
 *      provenance row per written fact, a person's value never replaced, the
 *      strain library learns flower terpenes fill-only (existing, non-archived
 *      rows only, never created), a missing 0235 writes nothing, a missing
 *      0252 is "nothing to attach", one audit row, idempotent re-run.
 *   3. Survivorship across sources (MDM source priority): a web lookup never
 *      replaces a lab value on the row; a newer lab read or a person may.
 *   4. The Product facts panel: lab rows shown, empty mg inputs pre-filled
 *      (labelled data-prefill="coa"), a saved value never pre-filled over.
 *   5. Gemini terpenes: cleaned to KB slugs at the door, carried through the
 *      save payload and into the attach (product fill-only; strain flower-
 *      only and lab-first), end-to-end through attachProductFacts.
 *   6. Wiring pins: finalize runs the attach AFTER the draft seed and the
 *      certificate read; Re-read runs it before the re-stage; the page loads
 *      lab views only when rows are open; terpenes are the tenth fact.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { r28MakeExtract } from "../../scripts/r28/coa-fixture-extract";
import {
  LAB_FACTS_ATTACH_EVENT,
  STRAIN_COA_SOURCE_TAG,
  labFactsAttachNote,
  labPanelView,
  labRowInputs,
  planLabFactsAttach,
  planStrainTerpeneWrite,
  strainLearnsFromType,
  __runLabFactsAttachCoreTests,
} from "@/lib/catalog/lab-facts-attach-core";
import { mergeDraftAttachedFacts } from "@/lib/catalog/attach-facts-core";
import { ROW_FACT_FIELDS, ROW_FACT_LABEL } from "@/lib/catalog/fact-chips-core";
import { kbTerpeneSlug } from "@/lib/inventory/coa-facts-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const FXDIR = join(ROOT, "tests", "fixtures", "coa");
const stems: Record<string, string> = {};
for (const f of readdirSync(FXDIR)) {
  const m = f.match(/^(item\d\d\.(?:unpdf|layout|wcia)|transfer)\.(?:txt|json)$/);
  if (m) stems[m[1]] = readFileSync(join(FXDIR, f), "utf8");
}
const makeExtract = r28MakeExtract(stems);
type Item = { product_name: string; inventory_type: string; strain_name: string };
const items = (JSON.parse(stems["transfer"]) as { inventory_transfer_items: Item[] }).inventory_transfer_items;
const planFor = (i: number) =>
  planLabFactsAttach({
    extract: makeExtract(i, "unpdf"),
    product: { name: items[i].product_name, inventoryType: items[i].inventory_type, strainName: items[i].strain_name },
    lab: { totalThcPct: null, totalCbdPct: null },
  });
const factOf = (p: ReturnType<typeof planFor>, field: string) => p.facts.find((f) => f.field === field)?.value;

// ---------------------------------------------------------------------------
// In-memory database (same shape as the S07 test's) + mocks
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type DbError = { code?: string; message: string } | null;
const db = {
  tables: {} as Record<string, Row[]>,
  /** "table:op" or "table:op:cols" -> error. */
  fail: {} as Record<string, DbError>,
  log: [] as string[],
};
function resetDb() {
  db.tables = { catalog_product_drafts: [], inventory_lots: [], lab_results: [], kb_strains: [], kb_products: [], brands: [], ai_suggestions: [], product_fact_provenance: [] };
  db.fail = {};
  db.log = [];
}
function builder(table: string) {
  let op: "select" | "insert" | "update" = "select";
  let cols = "*";
  let payload: Row | Row[] | null = null;
  const filters: ((r: Row) => boolean)[] = [];
  let range: [number, number] | null = null;
  const rows = () => (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const pick = (r: Row): Row => {
    if (cols === "*") return { ...r };
    const out: Row = {};
    for (const c of cols.split(",").map((x) => x.trim())) out[c] = r[c] ?? null;
    return out;
  };
  const run = (): { data: unknown; error: DbError } => {
    const e = db.fail[`${table}:${op}:${cols}`] ?? db.fail[`${table}:${op}`] ?? null;
    if (e) return { data: null, error: e };
    if (op === "insert") {
      const list = Array.isArray(payload) ? payload : [payload as Row];
      db.tables[table] = [...(db.tables[table] ?? []), ...list.map((r) => ({ ...r }))];
      return { data: null, error: null };
    }
    if (op === "update") {
      for (const r of rows()) Object.assign(r, JSON.parse(JSON.stringify(payload)));
      return { data: null, error: null };
    }
    let out = rows().map(pick);
    if (range) out = out.slice(range[0], range[1] + 1);
    return { data: out, error: null };
  };
  const b = {
    select(c?: string) { op = "select"; cols = c ?? "*"; return b; },
    insert(p: Row | Row[]) { op = "insert"; payload = p; db.log.push(`${table}:insert`); return b; },
    update(p: Row) { op = "update"; payload = p; db.log.push(`${table}:update`); return b; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return b; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return b; },
    order() { return b; },
    range(a: number, z: number) { range = [a, z]; return b; },
    async maybeSingle() { const r = run(); if (r.error) return r; return { data: (r.data as Row[])[0] ?? null, error: null }; },
    then(res: (v: { data: unknown; error: DbError }) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}
const fake = { from: (t: string) => builder(t) };
const spies = { audit: vi.fn(async (e: unknown) => void e), ring: 2 as 0 | 1 | 2 | 3 };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fake }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: (e: unknown) => spies.audit(e) }));
vi.mock("@/lib/ai/suggestions", () => ({ persistSuggestion: async (i: Row) => { db.tables.ai_suggestions.push({ ...i, status: "pending" }); return i; } }));
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => null, getItemBySourceKey: async () => null }));
vi.mock("@/lib/catalog/fact-attach-policy-server", () => ({ currentAttachPolicyRing: () => spies.ring, attachFactsV2Enabled: () => true }));
/** Gap-fill stand-in for writeBackProductFacts (lists unioned, terpenes included). */
vi.mock("@/lib/ai/kb/writeback", async () => {
  const { kbNaturalKey } = await import("@/lib/catalog/product-identity-core");
  return {
    writeBackProductFacts: async (facts: Row) => {
      const k = kbNaturalKey({ brandName: facts.brandName as string | null, productName: facts.productName as string, variantLabel: facts.variantLabel as string });
      let row = db.tables.kb_products.find((r) => r.brand_slug === k.brand_slug && r.product_slug === k.product_slug && r.variant_label === k.variant_label);
      if (!row) {
        row = { id: "00000000-0000-4000-8000-0000000000aa", ...k, description: null, short_description: null, aroma_notes: [], flavor_notes: [], effects: [], terpenes: [] };
        db.tables.kb_products.push(row);
      }
      for (const f of ["description", "short_description"]) if (typeof facts[f] === "string" && facts[f] && !row[f]) row[f] = facts[f];
      for (const f of ["aroma_notes", "flavor_notes", "effects", "terpenes"]) {
        const cur = (row[f] as string[]) ?? [];
        const inc = (facts[f] as string[]) ?? [];
        row[f] = [...cur, ...inc.filter((x) => !cur.some((c) => c.toLowerCase() === x.toLowerCase()))];
      }
      return { ok: true, wroteProduct: true, wroteStrain: false };
    },
  };
});

const { attachLabFactsToManifestDrafts, LAB_FACTS_ATTACH_AUDIT_ACTION } = await import("@/lib/catalog/lab-facts-attach");
const { attachProductFacts } = await import("@/lib/catalog/attach-facts");
const { postProcessLookup, cleanTerpenes } = await import("@/lib/inventory/product-lookup-core");

const M = "00000000-0000-4000-8000-00000000ee01";
const ACTOR = "00000000-0000-4000-8000-000000000001";
const LAB = (i: number) => `00000000-0000-4000-8000-0000000c00${String(i).padStart(2, "0")}`;
const LOT = (i: number) => `00000000-0000-4000-8000-0000000a00${String(i).padStart(2, "0")}`;
const DRAFT = (i: number) => `00000000-0000-4000-8000-0000000d00${String(i).padStart(2, "0")}`;

/** Seed fixture item i as a draft + lot + lab row holding the stored read. */
function seedItem(i: number, over: Row = {}) {
  const it = items[i];
  db.tables.catalog_product_drafts.push({
    id: DRAFT(i),
    name: it.product_name,
    brand_name: "Torus",
    vendor_name: "Torus LLC",
    category: "Flower",
    chosen_website_category: "flower",
    strain_name: it.strain_name,
    lot_id: LOT(i),
    pos_product_key: `LOT-${i}`,
    inventory_type: it.inventory_type,
    manifest_id: M,
    status: "draft",
    attached_facts: null,
    attached_facts_provenance: null,
    ...over,
  });
  db.tables.inventory_lots.push({ id: LOT(i), lab_result_id: LAB(i) });
  db.tables.lab_results.push({ id: LAB(i), coa_extract_json: JSON.parse(JSON.stringify(makeExtract(i, "unpdf"))), total_thc_pct: null, total_cbd_pct: null, cbd_pct: null });
}
const draftRow = (i: number) => db.tables.catalog_product_drafts.find((d) => d.id === DRAFT(i))!;
const facts = (i: number) => (draftRow(i).attached_facts ?? {}) as Record<string, { value: unknown; source: string }>;

beforeEach(() => {
  resetDb();
  spies.audit.mockClear();
  spies.ring = 2;
});

// ---------------------------------------------------------------------------
describe("1. pure planner over the real owner certificates", () => {
  it("embedded self-tests: exact count, registered with that floor", () => {
    const r = __runLabFactsAttachCoreTests(stems, makeExtract);
    expect(r).toEqual({ passed: 102, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("lab-facts-attach-core", __runLabFactsAttachCoreTests(r28CoaStems(), r28MakeExtract(r28CoaStems())), 102);');
  });

  it("item 0 (plain flower): six terpenes strongest first, total, potency, cannabinoids; teaches the strain", () => {
    const p = planFor(0);
    expect(items[0].inventory_type).toBe("Usable Marijuana");
    expect(factOf(p, "terpenes")).toEqual(["limonene 0.51%", "myrcene 0.44%", "linalool 0.35%", "caryophyllene 0.34%", "humulene 0.11%", "beta-pinene 0.1%"]);
    expect(factOf(p, "total_terpenes_pct")).toBe(2.45);
    expect(factOf(p, "potency")).toBe("26.68% THC");
    expect((factOf(p, "lab_cannabinoids") as string[])[0]).toBe("THCA 30.12%");
    expect(p.strainTerpenes.slice(0, 6)).toEqual(["limonene", "myrcene", "linalool", "caryophyllene", "humulene", "pinene"]);
    expect(p.strainSkip).toBeNull();
  });

  it("item 2 (concentrate): terpenes attach to the product but never teach the strain", () => {
    const p = planFor(2);
    expect(items[2].inventory_type).toBe("Concentrate for Inhalation");
    expect((factOf(p, "terpenes") as string[])[0]).toBe("myrcene 1.73%");
    expect(p.strainTerpenes).toEqual([]);
    expect(p.strainSkip).toMatch(/only plain flower teaches the strain library/);
  });

  it("item 4 (infused pre-roll): never teaches the strain (added terpenes, Abstrax)", () => {
    expect(items[4].inventory_type).toBe("Marijuana Mix Infused");
    expect(planFor(4).strainTerpenes).toEqual([]);
  });

  it("item 1 (concentrate, no terpene panel): says so, still attaches potency", () => {
    const p = planFor(1);
    expect(p.noTerpenePanel).toBe(true);
    expect(factOf(p, "terpenes")).toBeUndefined();
    expect(factOf(p, "potency")).toBe("77% THC");
  });

  it("item 12 (Solid Edible): mg facts attached from the certificate - no longer withheld", () => {
    const p = planFor(12);
    expect(items[12].inventory_type).toBe("Solid Edible");
    expect(factOf(p, "potency")).toBe("55 mg THC per package (5.5 mg per serving)");
    expect(factOf(p, "servings_per_pack")).toBe(10);
    expect(factOf(p, "mg_per_serving")).toBe(5.5);
    expect(factOf(p, "package_thc_mg")).toBe(55);
    expect(factOf(p, "package_cbd_mg")).toBe(100);
    expect(factOf(p, "package_cbg_mg")).toBe(100);
    expect(factOf(p, "package_cbc_mg")).toBe(95);
    expect(p.noTerpenePanel).toBe(true);
  });

  it("item 13 (Solid Edible, 11 mg/serving): facts attached AND the WAC 10 mg limit still reported", () => {
    const p = planFor(13);
    expect(factOf(p, "potency")).toBe("110 mg THC per package (11 mg per serving)");
    expect(factOf(p, "cbd_not_detected")).toBe(true);
    expect(factOf(p, "package_cbg_mg")).toBe(300);
    const view = labPanelView(p, null)!;
    expect(view.reasons.join(" ")).toMatch(/10 ?mg/);
  });

  it("only plain flower inventory types teach the strain library", () => {
    expect(strainLearnsFromType("Usable Marijuana")).toBe(true);
    expect(strainLearnsFromType(" usable cannabis ")).toBe(true);
    for (const t of ["Marijuana Mix Infused", "Concentrate for Inhalation", "Solid Edible", "", null, undefined]) expect(strainLearnsFromType(t)).toBe(false);
  });

  it("strain write: fill-only union, never creates, never archived, source tag once", () => {
    expect(planStrainTerpeneWrite(null, ["myrcene"], { withSources: true }).action).toBe("skip");
    expect(planStrainTerpeneWrite({ id: "s", terpenes: [], status: "archived" }, ["myrcene"], { withSources: true }).action).toBe("skip");
    const w = planStrainTerpeneWrite({ id: "s", terpenes: ["Linalool"], sources: [STRAIN_COA_SOURCE_TAG] }, ["myrcene", "linalool"], { withSources: true });
    expect(w).toEqual({ action: "update", id: "s", patch: { terpenes: ["Linalool", "myrcene"], sources: [STRAIN_COA_SOURCE_TAG] }, added: ["myrcene"] });
    expect(planStrainTerpeneWrite({ id: "s", terpenes: ["myrcene"] }, ["myrcene"], { withSources: false }).action).toBe("skip");
  });

  it("row inputs: an unread or failed read gives no terpenes and coaRead false", () => {
    expect(labRowInputs(null)).toEqual({ coaTerpenes: [], coaRead: false });
    const r = labRowInputs(makeExtract(0, "unpdf"));
    expect(r.coaRead).toBe(true);
    expect(r.coaTerpenes[0].name).toBe("limonene");
  });

  it("kbTerpeneSlug maps lab / web spellings to the strain library vocabulary, never guesses", () => {
    expect(kbTerpeneSlug("β-Caryophyllene")).toBe("caryophyllene");
    expect(kbTerpeneSlug("a-Pinene")).toBe("pinene");
    expect(kbTerpeneSlug("d-Limonene")).toBe("limonene");
    expect(kbTerpeneSlug("alpha-bulnesene")).toBeNull();
    expect(kbTerpeneSlug(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("2. first-pass server attach (attachLabFactsToManifestDrafts)", () => {
  it("writes every lab fact with source coa, one provenance row each, one audit row", async () => {
    seedItem(0);
    seedItem(12);
    const run = await attachLabFactsToManifestDrafts(M, ACTOR);
    expect(run.errors).toEqual([]);
    expect(run.drafts).toBe(2);
    expect(run.attached).toBe(2);
    const f0 = facts(0);
    expect(f0.terpenes.value).toEqual(["limonene 0.51%", "myrcene 0.44%", "linalool 0.35%", "caryophyllene 0.34%", "humulene 0.11%", "beta-pinene 0.1%"]);
    expect(f0.terpenes.source).toBe("coa");
    expect(f0.potency.value).toBe("26.68% THC");
    const f12 = facts(12);
    expect(f12.package_thc_mg.value).toBe(55);
    expect(f12.mg_per_serving.value).toBe(5.5);
    expect(run.facts).toBe(Object.keys(f0).length + Object.keys(f12).length);
    expect(db.tables.product_fact_provenance.length).toBe(run.facts);
    expect(db.tables.product_fact_provenance.every((r) => r.source === "coa")).toBe(true);
    expect(spies.audit).toHaveBeenCalledTimes(1);
    expect((spies.audit.mock.calls[0][0] as Row).action).toBe(LAB_FACTS_ATTACH_AUDIT_ACTION);
    expect(LAB_FACTS_ATTACH_EVENT).toBe("lab_facts_attach");
  });

  it("a person's value is never replaced", async () => {
    seedItem(0, { attached_facts: { potency: { value: "my own", source: "human", confidence: null, at: "2026-01-01T00:00:00Z" } } });
    const run = await attachLabFactsToManifestDrafts(M, ACTOR);
    expect(facts(0).potency).toMatchObject({ value: "my own", source: "human" });
    expect(facts(0).terpenes.source).toBe("coa");
    expect(run.kept).toBe(1);
  });

  it("the strain library learns flower terpenes: existing row, fill-only, source tag; concentrates never", async () => {
    seedItem(0);
    seedItem(2);
    db.tables.kb_strains.push({ id: "st-0", slug: "la kush cake", terpenes: ["linalool"], status: "published", sources: [] });
    db.tables.kb_strains.push({ id: "st-2", slug: "pillow talk", terpenes: [], status: "published", sources: [] });
    const run = await attachLabFactsToManifestDrafts(M, ACTOR);
    const s0 = db.tables.kb_strains.find((s) => s.id === "st-0")!;
    expect((s0.terpenes as string[])[0]).toBe("linalool");
    expect(s0.terpenes).toEqual(expect.arrayContaining(["limonene", "myrcene", "caryophyllene", "humulene", "pinene"]));
    expect(s0.sources).toEqual([STRAIN_COA_SOURCE_TAG]);
    expect(db.tables.kb_strains.find((s) => s.id === "st-2")!.terpenes).toEqual([]);
    expect(run.strainsUpdated).toBe(1);
    expect(run.strainTerpenesAdded).toBe((s0.terpenes as string[]).length - 1);
  });

  it("never creates a strain row, never touches an archived one", async () => {
    seedItem(0);
    db.tables.kb_strains.push({ id: "st-x", slug: "la kush cake", terpenes: [], status: "archived", sources: [] });
    const run = await attachLabFactsToManifestDrafts(M, ACTOR);
    expect(db.tables.kb_strains.length).toBe(1);
    expect(db.tables.kb_strains[0].terpenes).toEqual([]);
    expect(run.strainsUpdated).toBe(0);
    resetDb();
    seedItem(0);
    await attachLabFactsToManifestDrafts(M, ACTOR);
    expect(db.tables.kb_strains).toEqual([]);
  });

  it("idempotent: a second run writes nothing new and records no audit", async () => {
    seedItem(0);
    await attachLabFactsToManifestDrafts(M, ACTOR);
    const prov = db.tables.product_fact_provenance.length;
    spies.audit.mockClear();
    const again = await attachLabFactsToManifestDrafts(M, ACTOR);
    expect(again.attached).toBe(0);
    expect(db.tables.product_fact_provenance.length).toBe(prov);
    expect(spies.audit).not.toHaveBeenCalled();
  });

  it("a corrected certificate re-lands only the changed fact (one provenance row, one audit)", async () => {
    seedItem(0);
    await attachLabFactsToManifestDrafts(M, ACTOR);
    const prov = db.tables.product_fact_provenance.length;
    const lab = db.tables.lab_results.find((l) => l.id === LAB(0))!;
    const j = lab.coa_extract_json as { json: { totals: Record<string, number> } | null };
    expect(j.json).not.toBeNull();
    j.json!.totals["total-thc"] = 25.01;
    spies.audit.mockClear();
    const again = await attachLabFactsToManifestDrafts(M, ACTOR);
    expect(again.attached).toBe(1);
    expect(again.facts).toBe(1);
    expect(facts(0).potency.value).toBe("25.01% THC");
    expect(db.tables.product_fact_provenance.length).toBe(prov + 1);
    expect(spies.audit).toHaveBeenCalledTimes(1);
  });

  it("a database without 0235 writes nothing and says unmigrated", async () => {
    seedItem(0);
    db.fail["catalog_product_drafts:select"] = { code: "42703", message: "column catalog_product_drafts.attached_facts does not exist" };
    const run = await attachLabFactsToManifestDrafts(M, ACTOR);
    expect(run.unmigrated).toBe(true);
    expect(db.log.filter((l) => l.endsWith(":update") || l.endsWith(":insert"))).toEqual([]);
    expect(labFactsAttachNote(run)).toMatch(/0235/);
  });

  it("a database without 0252 is simply nothing to attach (no error)", async () => {
    seedItem(0);
    db.fail["lab_results:select"] = { code: "42703", message: "column lab_results.coa_extract_json does not exist" };
    const run = await attachLabFactsToManifestDrafts(M, ACTOR);
    expect(run.errors).toEqual([]);
    expect(run.attached).toBe(0);
    expect(facts(0)).toEqual({});
  });

  it("an unrelated read error is reported, never thrown", async () => {
    seedItem(0);
    db.fail["catalog_product_drafts:select"] = { code: "57014", message: "statement timeout" };
    const run = await attachLabFactsToManifestDrafts(M, ACTOR);
    expect(run.errors[0]).toMatch(/statement timeout/);
    expect(run.unmigrated).toBe(false);
  });

  it("only this manifest's draft/approved rows", async () => {
    seedItem(0, { status: "dismissed" });
    seedItem(7, { manifest_id: "00000000-0000-4000-8000-00000000ee02" });
    const run = await attachLabFactsToManifestDrafts(M, ACTOR);
    expect(run.drafts).toBe(0);
    expect(facts(0)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
describe("3. survivorship across sources (lab outranks the web)", () => {
  const labFacts = { terpenes: { value: ["limonene 0.51%"], source: "coa", confidence: null, at: "2026-04-01T00:00:00Z" } };
  it("a web lookup never replaces a lab value; it still fills empty slots", () => {
    const m = mergeDraftAttachedFacts({ existingFacts: labFacts, existingProvenance: null, landed: [{ field: "terpenes", value: ["myrcene"], source: "gemini", confidence: 0.99 }, { field: "aroma", value: ["citrus"], source: "gemini", confidence: 0.95 }], at: "2026-05-01T00:00:00Z", by: null, urls: [] });
    expect(m.keptLab).toEqual(["terpenes"]);
    expect(m.written).toEqual(["aroma"]);
  });
  it("a newer lab read or a person may replace it", () => {
    for (const source of ["coa", "human"] as const) {
      const m = mergeDraftAttachedFacts({ existingFacts: labFacts, existingProvenance: null, landed: [{ field: "terpenes", value: ["x"], source, confidence: null }], at: "2026-05-01T00:00:00Z", by: null, urls: [] });
      expect(m.written).toEqual(["terpenes"]);
      expect(m.keptLab).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
describe("4. Product facts panel pre-fill", () => {
  it("renders the lab block and pre-fills only EMPTY inputs, labelled", async () => {
    const { ProductFactsPanel } = await import("@/app/admin/inventory/drafts/ProductFactsPanel");
    const view = labPanelView(planFor(12), { servingsPerPack: 12 })!;
    expect(view.keptSaved).toEqual(["servingsPerPack"]);
    expect(view.prefill).toEqual({ mgPerServing: "5.5", packageThcMg: "55", packageCbdMg: "100", packageCbgMg: "100", packageCbcMg: "95" });
    const saved = { key: "LOT-12", facts: { servingsPerPack: 12 }, note: "", updatedAt: "2026-02-01T00:00:00Z", owner: true };
    const html = renderToStaticMarkup(
      createElement(ProductFactsPanel, { draftId: DRAFT(12), manifestId: M, productKey: "LOT-12", saved, readOk: true, returnManifest: M, returnView: "draft", lab: view } as never),
    );
    expect(html).toContain('data-testid="product-facts-lab"');
    expect(html).toContain("From the lab certificate (attached automatically)");
    expect(html).toContain("55 mg THC per package (5.5 mg per serving)");
    expect(html).toMatch(/name="servingsPerPack" value="12"/);
    expect(html).not.toMatch(/name="servingsPerPack" value="10"/);
    expect(html).toMatch(/data-prefill="coa" name="packageThcMg" value="55"/);
    expect(html).toMatch(/data-prefill="coa" name="mgPerServing" value="5.5"/);
    expect(html).toContain("from the lab certificate");
  });

  it("no plan / empty plan -> null view (panel unchanged)", () => {
    expect(labPanelView(null, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("5. Gemini terpenes: door -> save -> attach", () => {
  it("cleanTerpenes: KB slugs, deduped, lint-blocked dropped, capped", () => {
    expect(cleanTerpenes(["Myrcene", "β-Caryophyllene", { name: "a-Pinene" }, "myrcene", "unobtainium"])).toEqual(["myrcene", "caryophyllene", "pinene"]);
    expect(cleanTerpenes(["myrcene cures cancer", "limonene"])).toEqual(["limonene"]);
    expect(cleanTerpenes("myrcene")).toEqual([]);
    // The owner's own banned-phrase list (block tier) is honoured even for a
    // valid KB name: the vocabulary alone would let "myrcene" through.
    expect(cleanTerpenes(["Myrcene", "Limonene"], [{ phrase: "myrcene", severity: "block" }])).toEqual(["limonene"]);
    expect(cleanTerpenes(["Myrcene", "Limonene"], [{ phrase: "myrcene", severity: "warn" }])).toEqual(["myrcene", "limonene"]);
  });

  it("postProcessLookup carries terpenes; the save actions rebuild them from the payload (server re-clean)", () => {
    const r = postProcessLookup({ strain_type: "unknown", strain_type_confidence: 0, summary: "", effects: [], aroma_notes: [], flavor_notes: [], lineage: "", found: true, terpenes: ["Limonene"] });
    expect(r.terpenes).toEqual(["limonene"]);
    for (const f of ["src/app/admin/inventory/drafts/ai-lookup-actions.ts", "src/app/admin/products/ai-lookup-actions.ts"]) {
      const src = read(f);
      expect(src).toMatch(/terpenes: Array\.isArray\(payload\.terpenes\) \? payload\.terpenes\.filter\(\(x\): x is string => typeof x === "string"\) : \[\],/);
      expect(src).toMatch(/terpenes: r\.terpenes,/);
    }
    for (const f of ["src/app/admin/inventory/drafts/AiLookupPanel.tsx", "src/app/admin/products/[key]/EnrichmentAiLookupPanel.tsx"]) {
      const src = read(f);
      expect(src).toContain('label="Terpenes"');
      expect(src).toContain("terpenes: draft.keepTerpenes ? splitList(draft.terpenes) : [],");
    }
  });

  const seedFlowerDraft = (inventoryType: string, strainTerps: string[] | null, productTerps: string[] = []) => {
    db.tables.catalog_product_drafts.push({ id: DRAFT(0), name: "Blue Dream 3.5g", brand_name: "Phat Panda", vendor_name: "Phat Panda LLC", category: "Flower", chosen_website_category: "flower", strain_name: "Blue Dream", lot_id: LOT(0), pos_product_key: "LOT-1", inventory_type: inventoryType, attached_facts: null, attached_facts_provenance: null });
    db.tables.inventory_lots.push({ id: LOT(0), product_name: "Blue Dream 3.5g", strain_type: "hybrid", unit_weight: 3.5, unit_weight_uom: "g", brand_id: "b1", vendor_id: null, pos_product_key: "LOT-1", lot_code: "LC-1" });
    db.tables.brands.push({ id: "b1", display_name: "Phat Panda" });
    if (strainTerps) db.tables.kb_strains.push({ slug: "blue dream", strain_type: "hybrid", summary: "S", lineage: "L", aroma_notes: [], flavor_notes: [], terpenes: strainTerps, active: true, effects: [], status: "published", source: "manual" });
    db.tables.kb_products.push({ id: "00000000-0000-4000-8000-0000000000aa", brand_slug: "phat-panda", product_slug: "blue-dream-3-5g", variant_label: "3.5 g", description: null, short_description: null, aroma_notes: [], flavor_notes: [], effects: [], terpenes: productTerps });
  };
  const runAttach = (terps: string[], conf: number) =>
    attachProductFacts({
      context: { kind: "draft", draftId: DRAFT(0) },
      safe: postProcessLookup({ strain_type: "unknown", strain_type_confidence: 0, summary: "", effects: [], aroma_notes: [], flavor_notes: [], lineage: "", found: true, terpenes: terps }),
      sources: ["https://example.test/a"],
      factConfidence: { terpenes: conf },
      suggestionConfidence: {},
      suggestionSource: "model:onboarding-lookup",
      actor: { userId: ACTOR, email: null },
    });

  it("flower, >= 90%: fills the empty strain list AND the empty product list; the row shows it", async () => {
    seedFlowerDraft("Usable Marijuana", []);
    const res = await runAttach(["Myrcene", "Limonene"], 95);
    expect(res.ok).toBe(true);
    expect(db.tables.kb_strains[0].terpenes).toEqual(["myrcene", "limonene"]);
    const kbp = db.tables.kb_products.find((r) => r.product_slug === "blue-dream-3-5g");
    expect(kbp?.terpenes).toEqual(["myrcene", "limonene"]);
    expect(db.tables.kb_products.length).toBe(1);
    expect((draftRow(0).attached_facts as Record<string, { value: unknown; source: string }>).terpenes).toMatchObject({ value: ["myrcene", "limonene"], source: "gemini" });
  });

  it("lab first: a strain that already lists terpenes is never mixed with the web's", async () => {
    seedFlowerDraft("Usable Marijuana", ["linalool"]);
    const res = await runAttach(["Myrcene"], 99);
    expect(res.ok).toBe(true);
    expect(db.tables.kb_strains[0].terpenes).toEqual(["linalool"]);
  });

  it("infused / concentrate: the strain is never taught", async () => {
    seedFlowerDraft("Marijuana Mix Infused", []);
    await runAttach(["Myrcene"], 99);
    expect(db.tables.kb_strains[0].terpenes).toEqual([]);
  });

  it("a populated product terpene list (e.g. from the lab) is never replaced", async () => {
    seedFlowerDraft("Marijuana Mix Infused", null, ["caryophyllene"]);
    await runAttach(["Myrcene"], 99);
    expect(db.tables.kb_products.length).toBe(1); // the seed IS the row the door read (no vacuous pass)
    expect(db.tables.kb_products.find((r) => r.product_slug === "blue-dream-3-5g")?.terpenes).toEqual(["caryophyllene"]);
  });

  it("a lab terpene value on the row survives a web lookup (keptLab note)", async () => {
    seedFlowerDraft("Marijuana Mix Infused", null);
    draftRow(0).attached_facts = { terpenes: { value: ["limonene 0.51%"], source: "coa", confidence: null, at: "2026-04-01T00:00:00Z" } };
    const res = await runAttach(["Myrcene"], 99);
    expect(res.ok && res.notes.join(" ")).toMatch(/Kept the lab certificate's terpenes/);
    expect((draftRow(0).attached_facts as Record<string, { value: unknown }>).terpenes.value).toEqual(["limonene 0.51%"]);
  });
});

// ---------------------------------------------------------------------------
describe("6. wiring pins", () => {
  it("terpenes are the tenth onboarding fact", () => {
    expect(ROW_FACT_FIELDS.length).toBe(10);
    expect(ROW_FACT_FIELDS[9]).toBe("terpenes");
    expect(ROW_FACT_LABEL.terpenes).toBe("terpenes");
  });

  it("finalize: the lab attach runs after the KB link, only when the draft seed settled, and logs to the timeline", () => {
    const src = read("src/lib/inventory/intake-store.ts");
    const link = src.indexOf("await linkKbProductsToDrafts(manifestId");
    const attach = src.indexOf("await attachLabFactsToManifestDrafts(manifestId, actorId)");
    expect(link).toBeGreaterThan(0);
    expect(attach).toBeGreaterThan(link);
    expect(src.slice(attach - 200, attach)).toContain('if (draftsRes.status === "fulfilled") {');
    expect(src.slice(attach, attach + 500)).toContain("logManifestEvent(manifestId, LAB_FACTS_ATTACH_EVENT, labNote, actorId)");
  });

  it("Re-read lab certificate runs the attach before the re-stage", () => {
    const src = read("src/app/admin/inventory/actions.ts");
    const a = src.indexOf("await attachLabFactsToManifestDrafts(run.manifestId, session.userId)");
    expect(a).toBeGreaterThan(0);
    expect(src.slice(a - 600, a)).toContain("if (run.read > 0 && run.manifestId)");
  });

  it("the onboarding page loads lab views only when rows are open and passes them to the row + panel", () => {
    const src = read("src/app/admin/inventory/drafts/page.tsx");
    expect(src).toContain("rowsOpen ? loadLabViewsForDrafts(drafts) : Promise.resolve(null)");
    expect(src).toMatch(/lab=\{labPanelView\(/);
    expect(src).toContain("coaTerpenes");
    expect(src).toContain("strainTerpenes");
  });

  it("the attach door reads strain + product terpenes (never writes blind) and the draft inventory type", () => {
    const src = read("src/lib/catalog/attach-facts.ts");
    expect(src).toContain('const STRAIN_BASE = "strain_type, summary, lineage, aroma_notes, flavor_notes, terpenes, active";');
    expect(src).toContain('.select("description, short_description, aroma_notes, flavor_notes, effects, terpenes")');
    expect(src).toContain("strainLearnsTerpenes: strainLearnsFromType(sf.inventoryType),");
    expect(src).toContain("terpenes: plan.kbProduct.terpenes ?? [],");
  });
});
