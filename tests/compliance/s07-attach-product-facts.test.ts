/**
 * tests/compliance/s07-attach-product-facts.test.ts  (Round 17, SLICE S07)
 *
 * Owner (verbatim): "All intake data needs to be properly saved to the kb so
 * it can properly be reused when needed. So products attach automatically.
 * Enrichment is a huge deal for me. It needs to work perfectly."
 *
 * Three layers:
 *   A. the pure planner (attach-plan-core) - survivorship rules;
 *   B. the REAL server door (attach-facts.ts attachProductFacts) run against an
 *      in-memory database, so the order of writes, the read-back and the
 *      receipt are proven end to end (no network, no Supabase);
 *   C. source wiring - both Save selected actions route through the door
 *      behind ATTACH_FACTS_V2, the legacy path is retained, both panels show
 *      the receipt, the runner registers the self-tests.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATTACH_FIELDS,
  attachReceiptSentence,
  buildAttachIncoming,
  planAttach,
  reconcileReceipt,
  verifyKbProductWrite,
  __runAttachPlanCoreTests,
  type AttachIncoming,
  type PlanInput,
} from "@/lib/catalog/attach-plan-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

// ---------------------------------------------------------------------------
// In-memory database + mocks for the server door
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type DbError = { code?: string; message: string } | null;

const db = {
  tables: {} as Record<string, Row[]>,
  /** "table:op" -> error to return. op = select | insert | update | select:<cols> */
  fail: {} as Record<string, DbError>,
  log: [] as string[],
};

function resetDb() {
  db.tables = {
    catalog_product_drafts: [],
    inventory_lots: [],
    brands: [],
    kb_strains: [],
    kb_products: [],
    ai_suggestions: [],
    product_fact_provenance: [],
  };
  db.fail = {};
  db.log = [];
}

function builder(table: string) {
  let op: "select" | "insert" | "update" = "select";
  let cols = "*";
  let payload: Row | Row[] | null = null;
  const filters: [string, unknown][] = [];
  const rows = () => (db.tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
  const pick = (r: Row): Row => {
    if (cols === "*") return { ...r };
    const out: Row = {};
    for (const c of cols.split(",").map((x) => x.trim())) out[c] = r[c] ?? null;
    return out;
  };
  const errFor = (): DbError => db.fail[`${table}:${op}:${cols}`] ?? db.fail[`${table}:${op}`] ?? null;
  const run = (): { data: unknown; error: DbError } => {
    const e = errFor();
    if (e) return { data: null, error: e };
    if (op === "insert") {
      const list = Array.isArray(payload) ? payload : [payload as Row];
      if (table === "kb_strains" && list.some((r) => (db.tables.kb_strains ?? []).some((x) => x.slug === r.slug))) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      db.tables[table] = [...(db.tables[table] ?? []), ...list.map((r) => ({ ...r }))];
      return { data: null, error: null };
    }
    if (op === "update") {
      for (const r of rows()) Object.assign(r, payload);
      return { data: null, error: null };
    }
    return { data: rows().map(pick), error: null };
  };
  const b = {
    select(c?: string) {
      op = "select";
      cols = c ?? "*";
      return b;
    },
    insert(p: Row | Row[]) {
      op = "insert";
      payload = p;
      db.log.push(`${table}:insert`);
      return b;
    },
    update(p: Row) {
      op = "update";
      payload = p;
      db.log.push(`${table}:update`);
      return b;
    },
    eq(k: string, v: unknown) {
      filters.push([k, v]);
      return b;
    },
    async maybeSingle() {
      const r = run();
      if (r.error) return r;
      const list = r.data as Row[];
      return { data: list[0] ?? null, error: null };
    },
    then(res: (v: { data: unknown; error: DbError }) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(res, rej);
    },
  };
  return b;
}

const fake = { from: (t: string) => builder(t) };

const spies = {
  audit: vi.fn(async (entry: unknown) => void entry),
  suggestion: vi.fn(async (input: Row) => {
    db.log.push("ai_suggestions:persist");
    db.tables.ai_suggestions.push({ ...input, status: "pending" });
    return input;
  }),
  writeback: vi.fn(),
  ring: 2 as 0 | 1 | 2 | 3,
  v2: true,
  published: { id: "v1" } as { id: string } | null,
  menuItem: null as Row | null,
};

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fake }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: (e: unknown) => spies.audit(e) }));
vi.mock("@/lib/ai/suggestions", () => ({ persistSuggestion: (i: Row) => spies.suggestion(i) }));
vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => spies.published,
  getItemBySourceKey: async () => spies.menuItem,
}));
vi.mock("@/lib/catalog/fact-attach-policy-server", () => ({
  currentAttachPolicyRing: () => spies.ring,
  attachFactsV2Enabled: () => spies.v2,
}));
/**
 * A faithful-in-spirit stand-in for writeBackProductFacts: gap-fill at the
 * natural key (prose only into blank slots, lists unioned). The real writer's
 * compliance gate is simulated by the word "cures".
 */
vi.mock("@/lib/ai/kb/writeback", async () => {
  const { kbNaturalKey } = await import("@/lib/catalog/product-identity-core");
  return {
    writeBackProductFacts: async (facts: Row, actor: string | null) => {
      spies.writeback(facts, actor);
      db.log.push("kb_products:writeback");
      if (db.fail["kb_products:writeback"]) return { ok: false, wroteProduct: false, skippedReason: "simulated" };
      const k = kbNaturalKey({
        brandName: facts.brandName as string | null,
        productName: facts.productName as string,
        variantLabel: facts.variantLabel as string,
      });
      let row = db.tables.kb_products.find(
        (r) => r.brand_slug === k.brand_slug && r.product_slug === k.product_slug && r.variant_label === k.variant_label,
      );
      if (!row) {
        row = { id: "00000000-0000-4000-8000-0000000000aa", ...k, description: null, short_description: null, aroma_notes: [], flavor_notes: [], effects: [], status: "draft", active: false };
        db.tables.kb_products.push(row);
      }
      const banned = (s: unknown) => typeof s === "string" && /cures/i.test(s);
      for (const f of ["description", "short_description"]) {
        const v = facts[f];
        if (typeof v === "string" && v && !banned(v) && !(row[f] as string | null)) row[f] = v;
      }
      for (const f of ["aroma_notes", "flavor_notes", "effects"]) {
        const cur = (row[f] as string[]) ?? [];
        const inc = (facts[f] as string[]) ?? [];
        row[f] = [...cur, ...inc.filter((x) => !cur.some((c) => c.toLowerCase() === x.toLowerCase()))];
      }
      return { ok: true, wroteProduct: true, wroteStrain: false };
    },
  };
});

const { attachProductFacts, ATTACH_AUDIT_ACTION } = await import("@/lib/catalog/attach-facts");
const { postProcessLookup } = await import("@/lib/inventory/product-lookup-core");

const ACTOR = { userId: "00000000-0000-4000-8000-000000000001", email: "owner@greenway.test" };
const DRAFT_ID = "00000000-0000-4000-8000-0000000000d1";
const LOT_ID = "00000000-0000-4000-8000-0000000000a1";
const BRAND_ID = "00000000-0000-4000-8000-0000000000b1";

function seedDraft(over: Row = {}) {
  db.tables.catalog_product_drafts.push({
    id: DRAFT_ID,
    name: "Blue Dream 3.5g",
    brand_name: "Phat Panda",
    vendor_name: "Phat Panda LLC",
    category: "Flower",
    chosen_website_category: "flower",
    strain_name: "Blue Dream",
    lot_id: LOT_ID,
    pos_product_key: "LOT-1",
    ...over,
  });
  db.tables.inventory_lots.push({
    id: LOT_ID,
    product_name: "Blue Dream 3.5g",
    strain_type: "hybrid",
    unit_weight: 3.5,
    unit_weight_uom: "g",
    brand_id: BRAND_ID,
    vendor_id: null,
    pos_product_key: "LOT-1",
    lot_code: "LC-1",
  });
  db.tables.brands.push({ id: BRAND_ID, display_name: "Phat Panda" });
}

function safeLookup(over: Record<string, unknown> = {}) {
  return postProcessLookup({
    strain_type: "hybrid",
    strain_type_confidence: 0.97,
    summary: "A classic berry-forward cross.",
    effects: ["relaxed"],
    aroma_notes: ["berry"],
    flavor_notes: ["sweet"],
    lineage: "Blueberry x Haze",
    found: true,
    description: "Sweet berry aroma with a smooth finish.",
    short_description: "Berry-forward classic.",
    category: "flower",
    potency_ratio: "",
    size: "3.5g",
    image_candidates: [],
    ...over,
  } as Parameters<typeof postProcessLookup>[0]);
}

const ALL_HIGH = { summary: 95, effects: 95, aroma: 95, flavor: 95, lineage: 95, strain_type: 97 };
const HIGH_PROSE = { description: 95, short_description: 95 };

async function runDraft(opts: { factConfidence?: Record<string, number>; suggestion?: Record<string, number>; safe?: ReturnType<typeof safeLookup> } = {}) {
  return attachProductFacts({
    context: { kind: "draft", draftId: DRAFT_ID },
    safe: opts.safe ?? safeLookup(),
    sources: ["https://example.test/a"],
    factConfidence: opts.factConfidence ?? ALL_HIGH,
    suggestionConfidence: opts.suggestion ?? HIGH_PROSE,
    suggestionSource: "model:onboarding-lookup",
    actor: ACTOR,
  });
}

beforeEach(() => {
  resetDb();
  spies.audit.mockClear();
  spies.suggestion.mockClear();
  spies.writeback.mockClear();
  spies.ring = 2;
  spies.v2 = true;
  spies.published = { id: "v1" };
  spies.menuItem = null;
});

// ---------------------------------------------------------------------------
// A. Pure planner
// ---------------------------------------------------------------------------
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  mode: "act",
  productLabel: "Blue Dream 3.5g",
  brandLabel: "Phat Panda",
  identityKey: "phat panda|flower|blue dream 3.5g",
  strainName: "Blue Dream",
  posProductKey: "LOT-1",
  kbProductKeyKnown: true,
  existingStrain: null,
  manifestStrainType: null,
  pending: [],
  strainTypeConfidence: 0,
  incoming: [],
  ...over,
});
const inc = (field: AttachIncoming["field"], value: unknown, confidence: number | null): AttachIncoming => ({ field, value, confidence });
const allFields = (p: ReturnType<typeof planAttach>) => [
  ...p.receipt.attached.map((x) => x.field),
  ...p.receipt.queued.map((x) => x.field),
  ...p.receipt.skipped.map((x) => x.field),
];

describe("A. planner survivorship", () => {
  it("embedded self-tests pass (>= 125 checks)", () => {
    const r = __runAttachPlanCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(125);
  });

  it("strain row is keyed by the REAL strain name, never the product name (F-012)", () => {
    const p = planAttach(base({ incoming: [inc("summary", "Classic.", 95)] }));
    expect(p.strain?.slug).toBe("blue dream");
    expect(p.strain?.action === "create" && p.strain.row.name).toBe("Blue Dream");
  });

  it("a new strain is always a draft from enrichment; status/active on an existing strain are never touched", () => {
    const p = planAttach(base({ incoming: [inc("summary", "Classic.", 95)] }));
    expect(p.strain?.action === "create" && p.strain.row.status).toBe("draft");
    expect(p.strain?.action === "create" && p.strain.row.source).toBe("enrichment");
    const q = planAttach(base({
      existingStrain: { strain_type: "indica", summary: null, lineage: null, aroma_notes: [], flavor_notes: [], effects: [], status: "published", active: true },
      incoming: [inc("summary", "Gap.", 99), inc("strain_type", "sativa", 99)],
    }));
    expect(q.strain?.action).toBe("update");
    const patch = q.strain?.action === "update" ? q.strain.patch : {};
    expect(patch).toEqual({ summary: "Gap." });
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("active");
    expect(patch).not.toHaveProperty("strain_type");
  });

  it("a person's value is never overwritten: populated prose and summary stay, lists only grow", () => {
    const p = planAttach(base({
      existingStrain: { strain_type: null, summary: "Owner summary.", lineage: null, aroma_notes: ["Pine"], flavor_notes: [], effects: [], status: "published", active: true },
      existingProduct: { description: "Owner copy.", short_description: null, aroma_notes: ["Pine"], flavor_notes: [], effects: [] },
      incoming: [inc("description", "AI copy.", 99), inc("summary", "AI summary.", 99), inc("aroma", ["pine", "citrus"], 99)],
    }));
    expect(p.kbProduct?.description).toBeUndefined();
    const patch = p.strain?.action === "update" ? p.strain.patch : {};
    expect(patch).not.toHaveProperty("summary");
    expect(patch.aroma_notes).toEqual(["Pine", "citrus"]);
    expect(p.suggestions.find((s) => s.field_key === "description")?.suggested_value).toBe("AI copy.");
  });

  it("review-band (<90) fields become suggestions, never live writes", () => {
    const p = planAttach(base({ incoming: [inc("description", "Copy.", 89), inc("effects", ["relaxed"], 70)] }));
    expect(p.kbProduct).toBeNull();
    expect(p.suggestions.map((s) => s.field_key).sort()).toEqual(["description", "effects"]);
    expect(p.receipt.attached).toEqual([]);
  });

  it("shadow mode attaches nothing live", () => {
    const p = planAttach(base({ mode: "shadow", incoming: [inc("description", "Copy.", 99), inc("effects", ["relaxed"], 99), inc("strain_type", "hybrid", 99)] }));
    expect(p.kbProduct).toBeNull();
    expect(p.receipt.attached).toEqual([]);
    expect(p.provenance).toEqual([]);
    expect(p.strain?.action === "create" && p.strain.row.active).toBe(false);
  });

  it("every incoming field appears in the receipt exactly once", () => {
    const p = planAttach(base({
      incoming: ATTACH_FIELDS.map((f) =>
        inc(f, ["effects", "aroma", "flavor", "images"].includes(f) ? ["x"] : f === "strain_type" ? "hybrid" : "value", 95),
      ),
    }));
    const seen = allFields(p);
    expect(seen.sort()).toEqual([...ATTACH_FIELDS].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("re-running the same save produces zero duplicate suggestions and no writes", () => {
    const first = planAttach(base({ incoming: [inc("description", "Copy.", 80), inc("effects", ["relaxed"], 80)] }));
    const second = planAttach(base({
      existingStrain: { strain_type: null, summary: null, lineage: null, aroma_notes: [], flavor_notes: [], effects: ["relaxed"], status: "draft", active: false },
      pending: first.suggestions.map((s) => ({ field_key: s.field_key, suggested_value: s.suggested_value })),
      incoming: [inc("description", "Copy.", 80), inc("effects", ["relaxed"], 80)],
    }));
    expect(second.suggestions).toEqual([]);
    expect(second.strain).toBeNull();
  });

  it("category, size and potency are never written from a lookup", () => {
    const p = planAttach(base({ incoming: [inc("category", "flower", 99), inc("size", "3.5g", 99), inc("cannabinoids", "1:1", 99)] }));
    expect(p.receipt.skipped.map((s) => s.field).sort()).toEqual(["cannabinoids", "category", "size"]);
    expect(p.kbProduct).toBeNull();
    expect(p.strain).toBeNull();
  });

  it("an unchecked 'save strain' box gives its own reason and no strain write", () => {
    const p = planAttach(base({ strainWriteDisabled: true, incoming: [inc("summary", "S.", 99)] }));
    expect(p.strain).toBeNull();
    expect(p.receipt.skipped[0].reason).toContain("was left unchecked");
  });

  it("buildAttachIncoming gives category/size/ratio NO confidence and rejects junk numbers", () => {
    const rows = buildAttachIncoming(safeLookup(), [], { summary: 950, effects: "95" as unknown as number }, { description: 95 });
    const by = Object.fromEntries(rows.map((r) => [r.field, r.confidence]));
    expect(by.category).toBeNull();
    expect(by.size).toBeNull();
    expect(by.cannabinoids).toBeNull();
    expect(by.summary).toBeNull();
    expect(by.effects).toBeNull();
    expect(by.description).toBe(95);
  });

  it("verifyKbProductWrite: blank = compliance, different = kept, null row = all failed", () => {
    expect(verifyKbProductWrite({ description: "D" }, { description: "" })[0].reason).toContain("compliance");
    expect(verifyKbProductWrite({ description: "D" }, { description: "Other" })[0].reason).toContain("nothing overwritten");
    expect(verifyKbProductWrite({ description: "D", effects: ["a"] }, null)[0].fields).toEqual(["description", "effects"]);
    expect(verifyKbProductWrite({ effects: ["Relaxed"] }, { effects: ["relaxed"] })).toEqual([]);
  });

  it("reconcileReceipt moves a failed live field out of 'attached'", () => {
    const p = planAttach(base({ strainName: null, incoming: [inc("description", "D", 99)] }));
    const r = reconcileReceipt(p.receipt, [{ target: "product record", fields: ["description"], reason: "boom" }]);
    expect(r.attached).toEqual([]);
    expect(r.skipped.find((s) => s.field === "description")?.reason).toBe("boom");
    expect(attachReceiptSentence(r, base())).not.toContain("Married");
  });
});

// ---------------------------------------------------------------------------
// B. The real server door against an in-memory database
// ---------------------------------------------------------------------------
describe("B. attachProductFacts end to end", () => {
  it("act mode: writes kb_products, then the strain, then provenance, then audit, and the receipt matches the database", async () => {
    seedDraft();
    const res = await runDraft();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe("act");
    // Order of writes.
    const order = db.log.filter((x) => !x.startsWith("ai_suggestions:persist"));
    expect(order).toEqual(["kb_products:writeback", "kb_strains:insert", "product_fact_provenance:insert"]);
    expect(spies.audit).toHaveBeenCalledTimes(1);
    expect((spies.audit.mock.calls[0][0] as Row).action).toBe(ATTACH_AUDIT_ACTION);
    // kb_products row really has the facts.
    const kp = db.tables.kb_products[0];
    expect(kp.description).toBe("Sweet berry aroma with a smooth finish.");
    expect(kp.effects).toEqual(["relaxed"]);
    expect(kp.variant_label).toBe("3.5 g");
    expect(kp.brand_slug).toBe("phat-panda");
    // The writer never writes a strain; strain written once, by name.
    expect((spies.writeback.mock.calls[0][0] as Row).strainName).toBeNull();
    expect((spies.writeback.mock.calls[0][0] as Row).confidence).toBeNull();
    const ks = db.tables.kb_strains;
    expect(ks).toHaveLength(1);
    expect(ks[0].slug).toBe("blue dream");
    expect(ks[0].status).toBe("draft");
    expect(ks[0].created_by).toBe(ACTOR.userId);
    // strain_type agrees with the manifest at 97% -> attached.
    expect(ks[0].strain_type).toBe("hybrid");
    // Receipt claims only what landed.
    const attached = res.receipt.attached.map((a) => a.field);
    expect(attached).toEqual(expect.arrayContaining(["description", "short_description", "effects", "strain_type"]));
    expect(res.sentence).toContain("Married");
    // Provenance rows: one per live (field, target).
    expect(db.tables.product_fact_provenance.length).toBe(res.receipt.attached.reduce((n, a) => n + a.to.filter((t) => t !== "Enrichment suggestions").length, 0));
    expect(db.tables.product_fact_provenance.every((r) => r.source === "gemini")).toBe(true);
  });

  it("second identical save writes nothing new: no new suggestions, no strain insert, nothing claimed", async () => {
    seedDraft();
    await runDraft({ factConfidence: { ...ALL_HIGH, aroma: 70 } });
    const suggestionsAfterFirst = db.tables.ai_suggestions.length;
    const strainsAfterFirst = JSON.stringify(db.tables.kb_strains);
    db.log = [];
    const again = await runDraft({ factConfidence: { ...ALL_HIGH, aroma: 70 } });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(db.tables.ai_suggestions.length).toBe(suggestionsAfterFirst);
    expect(db.log).not.toContain("kb_strains:insert");
    expect(db.log).not.toContain("kb_products:writeback");
    expect(again.receipt.attached).toEqual([]);
    const withoutStamp = (rows: Row[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "updated_by")));
    expect(withoutStamp(db.tables.kb_strains)).toEqual(withoutStamp(JSON.parse(strainsAfterFirst) as Row[]));
  });

  it("shadow (ring 1): nothing live; review items go to suggestions; no provenance", async () => {
    spies.ring = 1;
    seedDraft();
    const res = await runDraft();
    expect(res.ok && res.mode).toBe("shadow");
    if (!res.ok) return;
    expect(db.log).not.toContain("kb_products:writeback");
    expect(res.receipt.attached).toEqual([]);
    expect(db.tables.product_fact_provenance).toEqual([]);
    expect(db.tables.ai_suggestions.map((s) => s.field_key)).toEqual(expect.arrayContaining(["description", "short_description"]));
    // F-018 on the S07 path: each suggestion carries its OWN field confidence.
    const conf = (k: string) => db.tables.ai_suggestions.find((x) => x.field_key === k)?.confidence;
    expect(conf("description")).toBe(0.95);
    expect(conf("short_description")).toBe(0.95);
    expect(db.tables.ai_suggestions.every((x) => x.source === "model:onboarding-lookup")).toBe(true);
    // The hidden strain draft never carries a machine strain type.
    expect(db.tables.kb_strains[0]?.active).toBe(false);
    expect(db.tables.kb_strains[0]).not.toHaveProperty("strain_type");
  });

  it("a curated strain is never lowered: status, active and strain type survive", async () => {
    seedDraft();
    db.tables.kb_strains.push({ slug: "blue dream", name: "Blue Dream", strain_type: "sativa", summary: "Curated.", lineage: null, aroma_notes: ["Pine"], flavor_notes: [], effects: [], active: true, status: "published", source: "steward" });
    const res = await runDraft();
    expect(res.ok).toBe(true);
    const s = db.tables.kb_strains[0];
    expect(s.status).toBe("published");
    expect(s.active).toBe(true);
    expect(s.strain_type).toBe("sativa");
    expect(s.summary).toBe("Curated.");
    expect(s.lineage).toBe("Blueberry x Haze");
    expect(s.aroma_notes).toEqual(["Pine", "berry"]);
    expect(db.log).not.toContain("kb_strains:insert");
  });

  it("compliance strip on the product record is reported, never claimed (read-your-write)", async () => {
    seedDraft();
    const res = await runDraft({ safe: { ...safeLookup(), description: "This cures everything nicely." } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.attached.some((a) => a.field === "description" && a.to.includes("product record"))).toBe(false);
    expect(res.receipt.skipped.find((s) => s.field === "description")?.reason ?? res.receipt.queued.find((q) => q.field === "description")?.reason).toContain("compliance");
  });

  it("a failed writer is reported and no provenance is written for it", async () => {
    seedDraft();
    db.fail["kb_products:writeback"] = { message: "x" };
    const res = await runDraft();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.attached.some((a) => a.to.includes("product record"))).toBe(false);
    // The writer's own reason reaches the receipt (not just the read-back's).
    expect(res.receipt.skipped.find((s) => s.field === "description")?.reason).toBe("The product record was not saved (simulated).");
    // Provenance only for what really landed: the strain-library rows, never the product record.
    expect(db.tables.product_fact_provenance.some((r) => r.field === "description")).toBe(false);
    expect(db.tables.product_fact_provenance.length).toBeGreaterThan(0);
    expect(db.tables.product_fact_provenance.length).toBe(
      res.receipt.attached.reduce((n, a) => n + a.to.filter((t) => t !== "Enrichment suggestions").length, 0),
    );
  });

  it("strain library unreadable -> strain untouched with a plain reason", async () => {
    seedDraft();
    db.fail["kb_strains:select"] = { message: "timeout" };
    const res = await runDraft();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(db.log).not.toContain("kb_strains:insert");
    expect(db.log).not.toContain("kb_strains:update");
    expect(res.receipt.skipped.find((s) => s.field === "summary")?.reason).toContain("could not be read");
  });

  it("missing 0085 columns and no existing row -> no strain created (never a default 'published')", async () => {
    seedDraft();
    db.fail["kb_strains:select:status, source"] = { code: "42703", message: "column kb_strains.status does not exist" };
    const res = await runDraft();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(db.tables.kb_strains).toEqual([]);
    expect(res.receipt.skipped.find((s) => s.field === "summary")?.reason).toContain("0085");
  });

  it("pending-suggestions read fails -> nothing listed (no duplicates) and the receipt says so", async () => {
    spies.ring = 1;
    seedDraft();
    db.fail["ai_suggestions:select"] = { message: "down" };
    const res = await runDraft();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(spies.suggestion).not.toHaveBeenCalled();
    expect(res.receipt.queued.some((q) => q.to.includes("Enrichment suggestions"))).toBe(false);
    expect(res.receipt.skipped.find((s) => s.field === "description")?.reason).toContain("to avoid duplicates");
  });

  it("strain insert race (23505) is reported, nothing overwritten", async () => {
    seedDraft();
    // The read sees no row; a concurrent save inserts before ours.
    const origFrom = fake.from;
    let reads = 0;
    fake.from = (t: string) => {
      const b = origFrom(t);
      if (t === "kb_strains") {
        const ins = b.insert.bind(b);
        b.insert = (p: Row | Row[]) => {
          if (reads++ === 0) db.tables.kb_strains.push({ slug: "blue dream", name: "Someone" });
          return ins(p);
        };
      }
      return b;
    };
    try {
      const res = await runDraft();
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(db.tables.kb_strains).toHaveLength(1);
      expect(db.tables.kb_strains[0].name).toBe("Someone");
      expect(JSON.stringify(res.receipt)).toContain("Someone saved this strain a moment ago");
    } finally {
      fake.from = origFrom;
    }
  });

  it("product context with 'save strain' unchecked never touches kb_strains", async () => {
    spies.menuItem = { name: "Blue Dream 3.5g", product_name: "Blue Dream 3.5g", brand_name: "Phat Panda", vendor_name: "Phat Panda LLC", category: "flower", strain_name: "Blue Dream", variants: [{ label: "3.5g" }] };
    const res = await attachProductFacts({
      context: { kind: "product", posProductKey: "LOT-1", saveStrain: false },
      safe: safeLookup(),
      sources: [],
      factConfidence: ALL_HIGH,
      suggestionConfidence: HIGH_PROSE,
      suggestionSource: "model:enrichment-lookup",
      actor: ACTOR,
      fallbackLabel: "Blue Dream",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(db.log.some((x) => x.startsWith("kb_strains"))).toBe(false);
    expect(res.receipt.skipped.find((s) => s.field === "summary")?.reason).toContain("left unchecked");
    // The product record is still keyed the reader's way (first variant label).
    expect(db.tables.kb_products[0]?.variant_label).toBe("3.5 g");
  });

  it("a missing draft is a clean error, with no writes", async () => {
    const res = await runDraft();
    expect(res.ok).toBe(false);
    expect(db.log).toEqual([]);
    expect(spies.audit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C. Source wiring
// ---------------------------------------------------------------------------
describe("C. wiring", () => {
  const door = read("src/lib/catalog/attach-facts.ts");
  const onboarding = read("src/app/admin/inventory/drafts/ai-lookup-actions.ts");
  const enrichment = read("src/app/admin/products/ai-lookup-actions.ts");

  it("the door is server-only and never uses the full-row strain upsert (F-055)", () => {
    expect(door).toMatch(/^import "server-only";/m);
    expect(door).not.toMatch(/upsertKbStrain\s*\(/);
  });

  it("both Save selected actions route through the door behind ATTACH_FACTS_V2 and keep the legacy path", () => {
    for (const [src, ctx] of [[onboarding, 'kind: "draft"'], [enrichment, 'kind: "product"']] as const) {
      const save = src.slice(src.indexOf("if (attachFactsV2Enabled()) {"));
      expect(save).toMatch(/^if \(attachFactsV2Enabled\(\)\) \{[\s\S]*?await attachProductFacts\(/);
      expect(save.slice(0, 1500)).toContain(ctx);
      expect(save.slice(0, 2000)).toContain("unstable_rethrow(err);");
      expect(src).toContain("// ATTACH_FACTS_V2=off: the previous save path, unchanged.");
      // The door is called only after the server-side re-sanitize.
      expect(src.indexOf("const safe = postProcessLookup(raw, banned);")).toBeLessThan(src.indexOf("await attachProductFacts("));
    }
  });

  it("both panels render the receipt", () => {
    for (const f of ["src/app/admin/inventory/drafts/AiLookupPanel.tsx", "src/app/admin/products/[key]/EnrichmentAiLookupPanel.tsx"]) {
      const s = read(f);
      expect(s).toContain('import { AttachReceiptView } from "@/components/admin/AttachReceiptView";');
      expect(s).toContain("<AttachReceiptView");
    }
  });

  it("the receipt view shows the three groups", async () => {
    const { AttachReceiptView } = await import("@/components/admin/AttachReceiptView");
    const html = renderToStaticMarkup(
      createElement(AttachReceiptView, {
        receipt: {
          attached: [{ field: "description", to: ["product record"], confidence: 95 }],
          queued: [{ field: "effects", to: ["Enrichment suggestions"], confidence: 70, reason: "Only 70%." }],
          skipped: [{ field: "size", reason: "Decided elsewhere." }],
        },
        sentence: "Done.",
        notes: ["A note."],
      }),
    );
    expect(html).toContain('data-testid="attach-receipt-attached"');
    expect(html).toContain('data-testid="attach-receipt-queued"');
    expect(html).toContain('data-testid="attach-receipt-skipped"');
    expect(html).toContain("Waiting for you (not live yet)");
    expect(html).toContain("description (95%)");
    expect(html).toContain("A note.");
  });

  it("the pure runner registers the planner self-tests", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("attach-plan-core", __runAttachPlanCoreTests\(\), \d+\)/);
  });
});
