/**
 * tests/compliance/r24-s12-approve-door.test.ts  (R24 follow-up: S12.2 + S12.6)
 *
 * Owner (R24, verbatim): "Please build S36 as one pr, then build the three
 * small follow ups, each as their own pr. ... Test it, test the tests."
 *
 * The approval now goes through the attach door (attachOnApproval) instead
 * of the private saveStrainTypeToKb. Proven here END TO END through the REAL
 * door, the REAL writeBackProductFacts (compliance gate, natural key, gap-fill
 * upsert) and the REAL postgrest-js client against FakePostgrest:
 *   A. pure core (embedded self-tests + spot checks);
 *   B. kb_products: created hidden at the lot's natural key, gap-filled with
 *      COUNTED attached facts only, populated slots never replaced, the
 *      placeholder never saved, a banned text stopped by the writer's gate;
 *   C. strain type: the SLICE 93 rules unchanged (create / set / human flip /
 *      machine never overrides / below-bar never written / unreadable library
 *      never written blind);
 *   D. links: fill-only on draft and lot; an existing link is never replaced;
 *      a database without 0234 is reported, never fatal;
 *   E. no key -> no guessed row; never throws;
 *   F. wiring: approveDraftWithPrice calls the door behind
 *      GOLDEN_RECORD_ON_APPROVE, keeps the rollback path, and the runner
 *      registers the core.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  audits: [] as Record<string, unknown>[],
  throwAdmin: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => {
      if (st.throwAdmin) throw new Error("client exploded");
      return new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch });
    },
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));
vi.mock("@/lib/ai/suggestions", () => ({ persistSuggestion: async () => ({}) }));
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => null, getItemBySourceKey: async () => null }));
vi.mock("@/lib/ai/kb/store", () => ({ listKbProductCategoriesAll: async () => [] }));

const { attachOnApproval, ATTACH_AUDIT_ACTION, APPROVAL_STRAIN_AUDIT_ACTION } = await import("@/lib/catalog/attach-facts");
const core = await import("@/lib/catalog/approve-attach-core");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const DRAFT = "00000000-0000-4000-8000-0000000000d1";
const LOT = "00000000-0000-4000-8000-0000000000a1";
const BRAND = "00000000-0000-4000-8000-0000000000b1";
const AT = "2026-10-01T00:00:00Z";

function seed(opts: { draft?: Row; lot?: Row | null; brand?: string | null } = {}) {
  const db = st.db;
  db.rows("catalog_product_drafts").push({
    id: DRAFT,
    name: "Blue Dream 3.5g",
    brand_name: "Phat Panda",
    vendor_name: "Phat Panda LLC",
    category: "Flower",
    chosen_website_category: "flower",
    strain_name: "Blue Dream",
    lot_id: LOT,
    pos_product_key: "LOT-1",
    restock_of_card_key: null,
    kb_product_id: null,
    attached_facts: null,
    attached_facts_provenance: null,
    ...(opts.draft ?? {}),
  });
  if (opts.lot !== null) {
    db.rows("inventory_lots").push({
      id: LOT,
      product_name: "Blue Dream 3.5g",
      strain_type: null,
      unit_weight: 3.5,
      unit_weight_uom: "g",
      brand_id: BRAND,
      vendor_id: null,
      pos_product_key: "LOT-1",
      lot_code: "LC-1",
      kb_product_id: null,
      ...(opts.lot ?? {}),
    });
  }
  if (opts.brand !== null) db.rows("brands").push({ id: BRAND, display_name: opts.brand ?? "Phat Panda" });
  db.rows("kb_banned_phrases").push({ phrase: "miracle", severity: "block", reason: "test", active: true });
}

const fact = (value: unknown, source: string, confidence: number | null) => ({ value, source, confidence, at: AT });
const kbRows = () => st.db.rows("kb_products");
const run = (pick: string | null = null) => attachOnApproval({ draftId: DRAFT, humanStrainPick: pick, productName: "Blue Dream 3.5g", actorId: ACTOR });

beforeEach(() => {
  st.db = new FakePostgrest();
  st.audits = [];
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
describe("A. approve-attach-core (pure)", () => {
  it("embedded self-tests pass at the exact floor", () => {
    expect(core.__runApproveAttachCoreTests()).toEqual({ passed: 40, failed: 0 });
  });
  it("a below-bar machine hint never becomes a verdict; a human pick always does", () => {
    expect(core.approvalStrainVerdict({ humanPick: null, kbStrainType: null, lotStrainType: null, productName: "Indica Sativa Blend" })).toBeNull();
    expect(core.approvalStrainVerdict({ humanPick: "sativa", kbStrainType: "indica", lotStrainType: null, productName: null })).toEqual({ value: "sativa", source: "human" });
  });
});

// ---------------------------------------------------------------------------
describe("B. kb_products at the lot's natural key (S12.6)", () => {
  it("creates the row hidden (draft/inactive) at brand+product+variant, with COUNTED facts only", async () => {
    seed({
      draft: {
        attached_facts: {
          description: fact("Sweet berry aroma with a smooth finish.", "gemini", 0.95),
          short_description: fact("Berry-forward.", "gemini", 0.85), // below the bar: not counted
          aroma: fact(["berry", "Berry"], "human", null),
          flavor: fact(["sweet"], "remembered", null), // pre-fill only: never decides
          effects: fact(["relaxed"], "gemini", 0.9),
        },
      },
    });
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.kb).toBe("written");
    expect(kbRows()).toHaveLength(1);
    const row = kbRows()[0];
    expect([row.brand_slug, row.product_slug, row.variant_label]).toEqual(["phat-panda", "blue-dream-3-5g", "3.5 g"]);
    expect(row.status).toBe("draft");
    expect(row.active).toBe(false);
    expect(row.description).toBe("Sweet berry aroma with a smooth finish.");
    expect(row.short_description).toBeNull();
    expect(row.aroma_notes).toEqual(["berry"]);
    expect(row.flavor_notes).toEqual([]);
    expect(row.effects).toEqual(["relaxed"]);
    expect(row.pos_product_key).toBe("LOT-1");
    expect(row.brand_id).toBe(BRAND);
    expect(r.kbProductId).toBe(row.id);
    expect(r.facts).toEqual(["description", "aroma", "effects"]);
  });

  it("no attached facts at all still makes the row (every approved product with identity gets one)", async () => {
    seed();
    const r = await run();
    expect(r.kb).toBe("written");
    expect(kbRows()).toHaveLength(1);
    expect(kbRows()[0].description).toBeNull();
    expect(r.facts).toEqual([]);
    expect(r.note).toContain("no attached facts to add yet");
  });

  it("an existing curated row is gap-filled only: a populated description and its status are kept", async () => {
    seed({ draft: { attached_facts: { description: fact("New AI text.", "gemini", 0.99), effects: fact(["happy"], "human", null) } } });
    kbRows().push({
      id: "00000000-0000-4000-8000-0000000000e1",
      brand_slug: "phat-panda",
      product_slug: "blue-dream-3-5g",
      variant_label: "3.5 g",
      description: "The owner's own words.",
      effects: ["relaxed"],
      status: "published",
      active: true,
      source: "manual",
    });
    const r = await run();
    expect(kbRows()).toHaveLength(1);
    const row = kbRows()[0];
    expect(row.description).toBe("The owner's own words.");
    expect(row.status).toBe("published");
    expect(row.active).toBe(true);
    expect(row.source).toBe("manual");
    expect(row.effects).toEqual(["relaxed", "happy"]);
    expect(r.kbProductId).toBe("00000000-0000-4000-8000-0000000000e1");
    // The description did not land, so it is not claimed - and the reason is recorded.
    expect(r.facts).toEqual(["effects"]);
    expect(r.failures.some((f) => f.fields.includes("description") && /kept/.test(f.reason))).toBe(true);
  });

  it("the writer's compliance gate stops banned prose; the receipt does not claim it", async () => {
    seed({ draft: { attached_facts: { description: fact("A miracle in a jar.", "human", null) } } });
    const r = await run();
    expect(kbRows()[0].description).toBeNull();
    expect(r.facts).toEqual([]);
    expect(r.failures.some((f) => /compliance/.test(f.reason))).toBe(true);
  });

  it("the placeholder sentence is never saved as copy", async () => {
    seed({
      draft: {
        attached_facts: {
          description: fact("Blue Dream from Phat Panda. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.", "human", null),
        },
      },
    });
    await run();
    expect(kbRows()[0].description).toBeNull();
  });

  it("no brand on the lot -> the writer's own 'unknown-brand' key (never vendor-as-brand)", async () => {
    seed({ lot: { brand_id: null }, brand: null });
    await run();
    expect(kbRows()[0].brand_slug).toBe("unknown-brand");
  });

  it("a second approval converges on the same row (idempotent)", async () => {
    seed();
    await run();
    await run();
    expect(kbRows()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("C. strain type into kb_strains (SLICE 93 rules unchanged)", () => {
  it("human pick + no row -> create the row exactly as before (active, typed), audited under the old action", async () => {
    seed();
    const r = await run("indica");
    expect(r.strainWritten).toBe(true);
    const s = st.db.rows("kb_strains");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ slug: "blue dream", name: "Blue Dream", strain_type: "indica", active: true, created_by: ACTOR, updated_by: ACTOR });
    const a = st.audits.find((x) => x.action === APPROVAL_STRAIN_AUDIT_ACTION)!;
    expect(a).toBeTruthy();
    expect(a.entityId).toBe("blue dream");
    expect((a.after as Row).decision).toBe("create");
    expect((a.after as Row).source).toBe("human");
  });

  it("the manifest's stated type (95) gap-fills a typeless row; source auto", async () => {
    seed({ lot: { strain_type: "Hybrid" } });
    st.db.rows("kb_strains").push({ id: "00000000-0000-4000-8000-00000000005a", slug: "blue dream", strain_type: null });
    // A bystander strain: the update is by id, so it must never be touched.
    st.db.rows("kb_strains").push({ id: "00000000-0000-4000-8000-00000000005b", slug: "gelato", strain_type: null });
    const r = await run();
    expect(r.strain?.action).toBe("set");
    expect(st.db.rows("kb_strains")[0].strain_type).toBe("hybrid");
    expect(st.db.rows("kb_strains")[1]).toEqual({ id: "00000000-0000-4000-8000-00000000005b", slug: "gelato", strain_type: null });
  });

  it("a person's pick flips a curated type; a machine verdict never does", async () => {
    seed({ lot: { strain_type: "indica" } });
    st.db.rows("kb_strains").push({ id: "00000000-0000-4000-8000-00000000005a", slug: "blue dream", strain_type: "sativa" });
    // The strain library's own value is the machine's verdict -> nothing to save.
    let r = await run();
    expect(r.strain?.action).toBe("skip");
    expect(st.db.rows("kb_strains")[0].strain_type).toBe("sativa");
    r = await run("indica");
    expect(r.strain?.action).toBe("flip");
    expect(st.db.rows("kb_strains")[0].strain_type).toBe("indica");
  });

  it("nothing known -> no strain write and no strain audit", async () => {
    seed();
    const r = await attachOnApproval({ draftId: DRAFT, humanStrainPick: null, productName: "Blue Dream", actorId: ACTOR });
    expect(r.strain?.action).toBe("skip");
    expect(st.db.rows("kb_strains")).toHaveLength(0);
    expect(st.audits.some((x) => x.action === APPROVAL_STRAIN_AUDIT_ACTION)).toBe(false);
  });

  it("no strain name on the draft -> no strain write", async () => {
    seed({ draft: { strain_name: null } });
    const r = await run("indica");
    expect(r.strain).toBeNull();
    expect(st.db.rows("kb_strains")).toHaveLength(0);
  });

  it("an unreadable strain library is never written blind", async () => {
    seed();
    st.db.before = (req) => (req.table === "kb_strains" && req.method === "GET" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
    const r = await run("indica");
    expect(r.strain?.action).toBe("skip");
    expect(st.db.log.some((q) => q.table === "kb_strains" && q.method !== "GET")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("D. fill-only kb_product_id links (0234)", () => {
  it("links the draft and the lot when both are empty", async () => {
    seed();
    const r = await run();
    const id = kbRows()[0].id;
    expect(st.db.rows("catalog_product_drafts")[0].kb_product_id).toBe(id);
    expect(st.db.rows("inventory_lots")[0].kb_product_id).toBe(id);
    expect(r.linked).toEqual({ draft: true, lot: true, preMigration: false });
  });

  it("never replaces an existing link", async () => {
    const other = "00000000-0000-4000-8000-0000000000ff";
    seed({ draft: { kb_product_id: other }, lot: { kb_product_id: other } });
    const r = await run();
    expect(st.db.rows("catalog_product_drafts")[0].kb_product_id).toBe(other);
    expect(st.db.rows("inventory_lots")[0].kb_product_id).toBe(other);
    expect(r.linked).toEqual({ draft: false, lot: false, preMigration: false });
  });

  it("before 0234 the links are reported as pending the migration; the row is still made", async () => {
    seed();
    st.db.before = (req) =>
      req.method === "PATCH" && req.table === "catalog_product_drafts" && req.body && typeof req.body === "object" && "kb_product_id" in (req.body as Row)
        ? { status: 400, body: { code: "PGRST204", message: "Could not find the 'kb_product_id' column of 'catalog_product_drafts' in the schema cache" } }
        : undefined;
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.kb).toBe("written");
    expect(r.linked.preMigration).toBe(true);
    expect(r.note).toContain("migration 0234");
    // The lot write is not attempted once the database says 0234 is missing.
    expect(st.db.log.some((q) => q.method === "PATCH" && q.table === "inventory_lots")).toBe(false);
  });

  it("the links are conditional UPDATEs (is null), so a racing linker is never overwritten", async () => {
    seed();
    await run();
    const patches = st.db.log.filter((q) => q.method === "PATCH" && (q.table === "catalog_product_drafts" || q.table === "inventory_lots"));
    expect(patches.length).toBe(2);
    for (const p of patches) expect(p.url.searchParams.get("kb_product_id")).toBe("is.null");
  });
});

// ---------------------------------------------------------------------------
describe("E. honesty and safety", () => {
  it("no lot -> no guessed product record, no links, still ok", async () => {
    seed({ draft: { lot_id: null }, lot: null });
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.kb).toBe("no_key");
    expect(kbRows()).toHaveLength(0);
    expect(r.note).toContain("was not guessed");
  });

  it("a lot with no product name -> no row", async () => {
    seed({ lot: { product_name: "  " } });
    const r = await run();
    expect(r.kb).toBe("no_key");
    expect(kbRows()).toHaveLength(0);
  });

  it("a missing draft is reported, never thrown", async () => {
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no longer exists/);
  });

  it("a throwing client is caught: ok false with a plain note, never an exception", async () => {
    seed();
    st.throwAdmin = true;
    try {
      const r = await run();
      expect(r.ok).toBe(false);
      expect(r.note).toContain("The approval itself is saved");
      expect(r.error).toContain("client exploded");
    } finally {
      st.throwAdmin = false;
    }
  });

  it("a failed draft read (500) is a plain refusal: no writes, no audit, no exception", async () => {
    seed();
    st.db.before = (req) =>
      req.table === "catalog_product_drafts" && req.method === "GET" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined;
    const r = await run("indica");
    expect(r.ok).toBe(false);
    expect(r.note.length).toBeGreaterThan(0);
    expect(kbRows()).toHaveLength(0);
    expect(st.audits).toHaveLength(0);
  });

  it("writes ONE door audit row marked as the approval", async () => {
    seed();
    await run("indica");
    const a = st.audits.filter((x) => x.action === ATTACH_AUDIT_ACTION);
    expect(a).toHaveLength(1);
    expect(a[0].entityId).toBe(DRAFT);
    expect((a[0].after as Row).via).toBe("approve");
    expect((a[0].after as Row).kbProductId).toBe(kbRows()[0].id);
  });

  it("a missing kb_products table is 'unavailable', not a crash", async () => {
    seed();
    st.db.missing.add("kb_products");
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.kb).toBe("unavailable");
    expect(r.kbProductId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("F. wiring", () => {
  const drafts = read("src/lib/inventory/catalog-drafts.ts");
  const fnBody = drafts.slice(drafts.indexOf("export async function approveDraftWithPrice"), drafts.indexOf("async function saveStrainTypeToKb("));

  it("approveDraftWithPrice routes through the door behind GOLDEN_RECORD_ON_APPROVE, rollback retained", () => {
    expect(fnBody).toContain('await import("@/lib/catalog/attach-facts")');
    expect(fnBody).toContain("if (goldenRecordOn()) {");
    expect(fnBody).toContain("attachOnApproval({");
    expect(fnBody).toContain("humanStrainPick: strainChoice.value,");
    // the rollback path is the ELSE branch, not a second unconditional write
    const doorAt = fnBody.indexOf("attachOnApproval({");
    const elseAt = fnBody.indexOf("} else {", doorAt);
    const legacyAt = fnBody.indexOf("await saveStrainTypeToKb(admin, {");
    expect(elseAt).toBeGreaterThan(doorAt);
    expect(legacyAt).toBeGreaterThan(elseAt);
    expect(fnBody.match(/await saveStrainTypeToKb\(/g)).toHaveLength(1);
  });

  it("the door step runs AFTER the authoritative update and BEFORE staging, inside a try", () => {
    const upd = fnBody.indexOf('.from("catalog_product_drafts")\n    .update(update)');
    const door = fnBody.indexOf("attachOnApproval({");
    const stage = fnBody.indexOf("stageIntakeMenuVersionForManifest(row.manifest_id");
    expect(upd).toBeGreaterThan(0);
    expect(door).toBeGreaterThan(upd);
    expect(stage).toBeGreaterThan(door);
    const tryAt = fnBody.lastIndexOf("try {", door);
    const catchAt = fnBody.indexOf("} catch (err) {", door);
    expect(tryAt).toBeGreaterThan(upd);
    expect(catchAt).toBeGreaterThan(door);
    expect(catchAt).toBeLessThan(stage);
  });

  it("the door reuses the SAME draft read, natural key and verifier (no second copy)", () => {
    const door = read("src/lib/catalog/attach-facts.ts");
    const fn = door.slice(door.indexOf("export async function attachOnApproval"));
    expect(fn).toContain("await readDraftFacts(admin, input.draftId)");
    expect(fn).toContain("kbNaturalKey({");
    expect(fn).toContain("verifyKbProductWrite(planned,");
    expect(fn).toContain("await writeBackProductFacts(");
    expect(fn).toContain('.is("kb_product_id", null)');
    expect(fn).toContain("strainName: null,");
  });

  it("the runner registers the core at its exact floor", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("approve-attach-core", __runApproveAttachCoreTests(), 40);');
  });
});
