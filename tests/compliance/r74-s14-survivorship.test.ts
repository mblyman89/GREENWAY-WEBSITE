/**
 * tests/compliance/r74-s14-survivorship.test.ts   (R74 S14)
 *
 * Owner, round 2 answer 3: "Manifest wins on name, type, cost; Cultivera wins
 * on category, quantity." Round 8: "Do each bullet point as its own slice."
 *
 * Behavioural, through the REAL postgrest-js client against FakePostgrest, the
 * real native parser and a fake storage bucket:
 *   A. transfer manifests: the kept Cultivera transfer file decides name, type
 *      and cost on the OPEN onboarding rows; category and quantity are never
 *      written; the lot is never written; facts + history say "manifest".
 *   B. emailed manifests: raw_payload.line_facts decides the same three.
 *   C. never guess: two disagreeing lines, a lot whose two barcodes point at
 *      different lines, a missing / unreadable file, an unreadable lots read.
 *   D. a person's value is kept; an approved row is never touched; re-running
 *      writes nothing.
 *   E. Start runs it (after seeding), notes it, audits it, and goes on when
 *      it fails; the onboarding page shows where each field came from.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  files: {} as Record<string, Buffer>,
  downloadFail: null as string | null,
  audits: [] as Record<string, unknown>[],
  calls: [] as string[],
  survThrow: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => {
      const client = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) as unknown as Record<string, unknown>;
      client.storage = {
        from(bucket: string) {
          return {
            async download(key: string) {
              if (bucket !== "pos-raw") return { data: null, error: { message: "wrong bucket" } };
              if (st.downloadFail) return { data: null, error: { message: st.downloadFail } };
              const b = st.files[key];
              return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "Object not found" } };
            },
          };
        },
      };
      return client;
    },
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));
// The rest of Start is S3's (tested there): spies that record the order.
vi.mock("@/lib/inventory/catalog-drafts", () => ({
  seedDraftsForManifest: async () => {
    st.calls.push("seed");
    return { draftsCreated: 0, draftsFailed: 0, firstError: null, lotIdentities: null, reonboard: { skippedOpen: 0, skippedOnboarded: 0, sameCard: 0 } };
  },
}));
vi.mock("@/lib/inventory/coa-archive", () => ({ archiveCoasForManifest: async () => void st.calls.push("archive") }));
vi.mock("@/lib/inventory/coa-extract", () => ({
  extractCoasForManifest: async () => ({ read: 0, ok: 0, partial: 0, failed: 0, deferred: 0, kbFilled: 0, errors: [] }),
}));
vi.mock("@/lib/inventory/manifest-kb-bridge", () => ({
  promoteManifestToKb: async () => ({ ok: true, outcome: { promoted: 0, skipped: 0, strainsEnriched: 0, vendorLicenseFilled: false } }),
}));
vi.mock("@/lib/inventory/kb-link-store", () => ({ linkKbProductsToDrafts: async () => ({ status: "skipped" }) }));
vi.mock("@/lib/catalog/lab-facts-attach", () => ({
  attachLabFactsToManifestDrafts: async () => {
    st.calls.push("labfacts");
    return { drafts: 0, attached: 0, facts: 0, noPanel: 0, kept: 0, strainsUpdated: 0, strainTerpenesAdded: 0, unmigrated: false, errors: [] };
  },
}));
vi.mock("@/lib/inventory/cultivera-survivorship", async (orig) => {
  const real = (await orig()) as typeof import("@/lib/inventory/cultivera-survivorship");
  return {
    ...real,
    applyManifestSurvivorship: (...a: Parameters<typeof real.applyManifestSurvivorship>) => {
      st.calls.push("survivorship");
      return st.survThrow ? Promise.reject(new Error("socket hang up")) : real.applyManifestSurvivorship(...a);
    },
  };
});

const { applyManifestSurvivorship } = await import("@/lib/inventory/cultivera-survivorship");
const { startCultiveraManifestOnboarding } = await import("@/lib/inventory/cultivera-onboarding");
const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
const core = await import("@/lib/inventory/cultivera-survivorship-core");
const onboardingCore = await import("@/lib/inventory/cultivera-onboarding-core");
const { DRAFT_FACT_COLUMNS, PROVENANCE_TABLE } = await import("@/lib/catalog/attach-facts-core");

const [FACTS, PROV] = DRAFT_FACT_COLUMNS;
const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const IMP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const M = "00000000-0000-4000-8000-00000000aa01";
const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const TID = 4355;
const lotId = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const draftId = (n: number) => `00000000-0000-4000-8000-00000000d${String(n).padStart(3, "0")}`;

/** A WCIA line: line_price / qty = the unit cost the native parser computes. */
function item(bc: string, name: string, type: string, linePrice: number, qty = 10): Record<string, unknown> {
  return { inventory_id: bc, product_name: name, inventory_type: type, inventory_category: "Flower", qty: String(qty), line_price: String(linePrice) };
}
const wciaDoc = (items: Record<string, unknown>[]) =>
  JSON.stringify({
    document_name: "WCIA Transfer Data",
    document_schema_version: "2.1.0",
    transfer_id: "MANIFEST-9",
    from_license_number: "412345",
    to_license_number: "423456",
    inventory_transfer_items: items,
  });
const keyFor = (t: number) => `rehome/${IMP}/wcia/${t}.json`;
const putDoc = (items: Record<string, unknown>[]) => (st.files[keyFor(TID)] = Buffer.from(wciaDoc(items), "utf8"));

function lot(n: number, bc: string | null, extra: Row = {}): Row {
  return {
    id: lotId(n),
    manifest_id: M,
    lot_code: bc,
    ccrs_inventory_external_id: bc,
    product_name: `CV NAME ${n}`,
    inventory_type: "Usable Marijuana",
    category: "Flower",
    status: "active",
    qty_on_hand: 10,
    received_qty: 10,
    unit_cost_minor_units: 800,
    ...extra,
  };
}
function draft(n: number, extra: Row = {}): Row {
  return {
    id: draftId(n),
    manifest_id: M,
    lot_id: lotId(n),
    pos_product_key: `pos-${n}`,
    status: "draft",
    name: `CV NAME ${n}`,
    brand_name: "Phat Panda",
    vendor_name: "Phat Panda",
    category: "Flower",
    chosen_website_category: null,
    strain_name: "Blue Dream",
    inventory_type: "Usable Marijuana",
    unit_cost_minor_units: 800,
    [FACTS]: null,
    [PROV]: null,
    ...extra,
  };
}

const transferLineage = { import_id: IMP, cultivera_transfer_id: String(TID) };
const emailLineage = { group_kind: "email", import_id: IMP };
const admin = () => createSupabaseAdminClient();
const d = (n: number) => st.db.rows("catalog_product_drafts").find((r) => r.id === draftId(n))!;
const lotsJson = () => JSON.stringify(st.db.rows("inventory_lots"));

function setManifest(rawPayload: Record<string, unknown>): void {
  st.db.rows("inbound_manifests").length = 0;
  st.db.rows("inbound_manifests").push({ id: M, status: "accepted", raw_payload: { kind: "cultivera-reconstructed", ...rawPayload } });
}

beforeEach(() => {
  st.db = new FakePostgrest();
  st.files = {};
  st.downloadFail = null;
  st.audits = [];
  st.calls = [];
  st.survThrow = false;
  setManifest({ import_id: IMP, cultivera_transfer_id: TID, group_kind: "transfer" });
  st.db.rows("inventory_lots").push(lot(1, "BC1"), lot(2, "BC2"), lot(3, "BC3"));
  st.db.rows("catalog_product_drafts").push(draft(1), draft(2), draft(3));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("A. a transfer manifest: the vendor's transfer file wins on name, type, cost", () => {
  it("writes name / type / cost on the open rows, never category or quantity, never a lot", async () => {
    putDoc([item("BC1", "Blue Dream 3.5g", "Usable Marijuana", 50), item("bc2", "Gelato Cart 1g", "Marijuana Extract for Inhalation", 120)]);
    const before = lotsJson();
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.source).toBe("transfer_file");
    expect(r.errors).toEqual([]);
    expect(r.updated).toBe(2);
    expect(r.noLine).toBe(1);
    expect(d(1)).toEqual(expect.objectContaining({ name: "Blue Dream 3.5g", inventory_type: "Usable Marijuana", unit_cost_minor_units: 500, category: "Flower" }));
    expect(d(2)).toEqual(expect.objectContaining({ name: "Gelato Cart 1g", inventory_type: "Marijuana Extract for Inhalation", unit_cost_minor_units: 1200, category: "Flower" }));
    expect(d(3)).toEqual(expect.objectContaining({ name: "CV NAME 3", unit_cost_minor_units: 800 }));
    expect(r.changedByField).toEqual({ product_name: 2, inventory_type: 1, unit_cost: 2 });
    const f1 = d(1)[FACTS] as Record<string, { source: string; value: unknown }>;
    expect(f1.product_name).toEqual(expect.objectContaining({ source: "manifest", value: "Blue Dream 3.5g" }));
    expect(f1.unit_cost).toEqual(expect.objectContaining({ source: "manifest", value: 500 }));
    expect((d(1)[PROV] as Record<string, { source: string; by: string }>).inventory_type).toEqual(expect.objectContaining({ source: "manifest", by: ACTOR }));
    const hist = st.db.rows(PROVENANCE_TABLE);
    expect(hist).toHaveLength(6);
    expect(hist.every((h) => h.source === "manifest")).toBe(true);
    expect(hist.map((h) => h.field).sort()).toEqual(["inventory_type", "inventory_type", "product_name", "product_name", "unit_cost", "unit_cost"]);
    // Cultivera keeps category and quantity; stock is never written.
    const updates = st.db.log.filter((q) => q.table === "catalog_product_drafts" && q.method === "PATCH");
    expect(updates).toHaveLength(2);
    expect(lotsJson()).toBe(before);
    expect(st.db.log.some((q) => q.table === "inventory_lots" && q.method !== "GET")).toBe(false);
    expect(st.db.log.some((q) => q.table.startsWith("menu_"))).toBe(false);
  });

  it("matches a lot by its CCRS barcode when its lot_code is blank", async () => {
    st.db.rows("inventory_lots")[0].lot_code = null;
    putDoc([item("BC1", "Blue Dream 3.5g", "Usable Marijuana", 50)]);
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.updated).toBe(1);
    expect(d(1).name).toBe("Blue Dream 3.5g");
  });

  it("a manifest grouped by receive date (no transfer) has no line source: nothing read, nothing written", async () => {
    const r = await applyManifestSurvivorship(admin(), M, { import_id: IMP, cultivera_transfer_id: null }, ACTOR);
    expect(r).toEqual(core.emptySurvivorshipRun(null));
    expect(st.db.log.some((q) => q.table === "catalog_product_drafts")).toBe(false);
  });

  it("no kept transfer file: nothing changes, no error (the file is optional)", async () => {
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.source).toBeNull();
    expect(r.errors).toEqual([]);
    expect(d(1).name).toBe("CV NAME 1");
  });
});

describe("B. an emailed manifest: its line facts win on name, type, cost", () => {
  it("reads raw_payload.line_facts and writes the three fields", async () => {
    setManifest({
      import_id: IMP,
      group_kind: "email",
      line_facts: {
        BC1: { productName: "Wedding Cake 1g Pre-roll", inventoryType: "Usable Marijuana", unitCostCents: 275, qty: 4 },
        BC3: { productName: "", inventoryType: null, unitCostCents: 990, qty: 1 },
      },
    });
    const r = await applyManifestSurvivorship(admin(), M, emailLineage, ACTOR);
    expect(r.source).toBe("emailed_manifest");
    expect(r.updated).toBe(2);
    expect(r.noLine).toBe(1);
    expect(d(1)).toEqual(expect.objectContaining({ name: "Wedding Cake 1g Pre-roll", unit_cost_minor_units: 275 }));
    // a blank name on the manifest leaves Cultivera's; the cost still lands
    expect(d(3)).toEqual(expect.objectContaining({ name: "CV NAME 3", unit_cost_minor_units: 990 }));
    expect(Object.keys(d(3)[FACTS] as object)).toEqual(["unit_cost"]);
    expect(st.files).toEqual({});
  });

  it("an emailed manifest with no line facts on file says so", async () => {
    setManifest({ import_id: IMP, group_kind: "email" });
    const r = await applyManifestSurvivorship(admin(), M, emailLineage, ACTOR);
    expect(r.source).toBe("emailed_manifest");
    expect(r.errors[0]).toContain("no line facts");
    expect(d(1).name).toBe("CV NAME 1");
  });
});

describe("C. never guess", () => {
  it("two disagreeing lines for one barcode: neither is used, counted as ambiguous", async () => {
    putDoc([item("BC1", "One", "Usable Marijuana", 50), item("BC1", "Two", "Usable Marijuana", 50), item("BC2", "Gelato", "Usable Marijuana", 10)]);
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.ambiguous).toBe(1);
    expect(r.updated).toBe(1);
    expect(d(1).name).toBe("CV NAME 1");
    expect(core.survivorshipNote(r)).toContain("not guessed");
  });

  it("a lot whose lot_code and CCRS barcode point at different lines is ambiguous", async () => {
    st.db.rows("inventory_lots")[0].ccrs_inventory_external_id = "BC9";
    putDoc([item("BC1", "One", "Usable Marijuana", 50), item("BC9", "Nine", "Usable Marijuana", 50)]);
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.ambiguous).toBe(1);
    expect(d(1).name).toBe("CV NAME 1");
  });

  it("an unreadable transfer file is reported and nothing is written", async () => {
    st.downloadFail = "permission denied";
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.source).toBe("transfer_file");
    expect(r.errors[0]).toContain("vendor transfer file: permission denied");
    expect(st.db.log.some((q) => q.table === "catalog_product_drafts")).toBe(false);
  });

  it("a file that is not a transfer document is reported", async () => {
    st.files[keyFor(TID)] = Buffer.from("<html>nope</html>", "utf8");
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.errors[0]).toContain("not a WCIA transfer document");
  });

  it("a failed barcode read applies nothing at all (never a partial pass)", async () => {
    putDoc([item("BC1", "One", "Usable Marijuana", 50)]);
    st.db.before = (req) =>
      req.table === "inventory_lots" ? { status: 500, body: { code: "XX000", message: "down", details: null, hint: null } } : undefined;
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.errors[0]).toContain("barcodes could not be read");
    expect(r.updated).toBe(0);
    expect(d(1).name).toBe("CV NAME 1");
  });

  it("a failed onboarding-rows read is reported", async () => {
    putDoc([item("BC1", "One", "Usable Marijuana", 50)]);
    st.db.before = (req) =>
      req.table === "catalog_product_drafts" ? { status: 500, body: { code: "XX000", message: "down", details: null, hint: null } } : undefined;
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.errors[0]).toContain("onboarding rows could not be read");
  });

  it("one row's failed write is reported; the others still land", async () => {
    putDoc([item("BC1", "One", "Usable Marijuana", 50), item("BC2", "Two", "Usable Marijuana", 50)]);
    st.db.before = (req) =>
      req.table === "catalog_product_drafts" && req.method === "PATCH" && req.url.href.includes(draftId(1))
        ? { status: 500, body: { code: "XX000", message: "row locked", details: null, hint: null } }
        : undefined;
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.updated).toBe(1);
    expect(r.errors[0]).toContain("row locked");
    expect(d(2).name).toBe("Two");
  });
});

describe("D. people and history win; re-running is quiet", () => {
  it("a name a person set is kept; the type and cost still land", async () => {
    d(1)[FACTS] = { product_name: { value: "My Name", source: "human", confidence: null, at: "2026-10-01T00:00:00Z" } };
    d(1).name = "My Name";
    putDoc([item("BC1", "Blue Dream 3.5g", "Usable Marijuana", 50)]);
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.keptHuman).toBe(1);
    expect(d(1)).toEqual(expect.objectContaining({ name: "My Name", unit_cost_minor_units: 500 }));
    expect((d(1)[FACTS] as Record<string, { source: string }>).product_name.source).toBe("human");
  });

  it("an approved row is never touched", async () => {
    d(1).status = "approved";
    d(3).status = "approved";
    putDoc([item("BC1", "Blue Dream 3.5g", "Usable Marijuana", 50)]);
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(d(1).name).toBe("CV NAME 1");
    expect(r.updated).toBe(0);
    expect(r.noLine).toBe(1); // only the open row 2 is looked at
    expect(st.db.rows(PROVENANCE_TABLE)).toHaveLength(0);
  });

  it("a row approved between the read and the write is not counted and gets no history", async () => {
    putDoc([item("BC1", "Blue Dream 3.5g", "Usable Marijuana", 50)]);
    st.db.before = (req) => {
      if (req.table === "catalog_product_drafts" && req.method === "PATCH") d(1).status = "approved";
    };
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.updated).toBe(0);
    expect(d(1).name).toBe("CV NAME 1");
    expect(st.db.rows(PROVENANCE_TABLE)).toHaveLength(0);
  });

  it("re-running writes nothing new (no row update, no history)", async () => {
    putDoc([item("BC1", "Blue Dream 3.5g", "Usable Marijuana", 50)]);
    await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    const hist = st.db.rows(PROVENANCE_TABLE).length;
    const patches = st.db.log.filter((q) => q.method === "PATCH").length;
    const r = await applyManifestSurvivorship(admin(), M, transferLineage, ACTOR);
    expect(r.updated).toBe(0);
    expect(r.unchanged).toBe(1);
    expect(st.db.rows(PROVENANCE_TABLE).length).toBe(hist);
    expect(st.db.log.filter((q) => q.method === "PATCH").length).toBe(patches);
  });
});

describe("E. Start runs it, records it, and survives it failing", () => {
  it("runs after seeding and lab facts; timeline event, Start note and audit carry it", async () => {
    putDoc([item("BC1", "Blue Dream 3.5g", "Usable Marijuana", 50)]);
    const r = await startCultiveraManifestOnboarding(M, ACTOR);
    expect(r.ok).toBe(true);
    expect(st.calls.indexOf("survivorship")).toBeGreaterThan(st.calls.indexOf("labfacts"));
    expect(st.calls.indexOf("labfacts")).toBeGreaterThan(st.calls.indexOf("seed"));
    expect(d(1).name).toBe("Blue Dream 3.5g");
    const ev = st.db.rows("manifest_events").find((e) => e.event_type === core.SURVIVORSHIP_EVENT);
    expect(ev?.note).toContain("1 product took the name, type and cost from the vendor's Cultivera transfer file");
    expect(ev?.note).toContain("Stock was not changed.");
    if (r.ok) expect(r.note).toContain("1 took the name, type and cost from the vendor's manifest");
    const audit = st.audits.find((a) => a.action === onboardingCore.CULTIVERA_ONBOARDING_AUDIT);
    expect((audit?.after as Record<string, unknown>).manifest_values).toEqual(
      expect.objectContaining({ source: "transfer_file", updated: 1, no_line: 2, changed: { product_name: 1, inventory_type: 0, unit_cost: 1 } }),
    );
    expect(st.db.log.some((q) => q.table === "inventory_lots" && q.method !== "GET")).toBe(false);
  });

  it("Start passes the emailed manifest's group kind through", async () => {
    setManifest({ import_id: IMP, group_kind: "email", line_facts: { BC2: { productName: "Mailed", inventoryType: "Usable Marijuana", unitCostCents: 100, qty: 1 } } });
    const r = await startCultiveraManifestOnboarding(M, ACTOR);
    expect(r.ok).toBe(true);
    expect(d(2).name).toBe("Mailed");
  });

  it("a survivorship crash is a reported problem; Start still finishes", async () => {
    st.survThrow = true;
    const r = await startCultiveraManifestOnboarding(M, ACTOR);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.note).toContain("manifest values: socket hang up");
  });

  it("the onboarding page shows where each field came from on a rebuilt row", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain('data-testid="cultivera-field-sources"');
    expect(page).toContain("fieldSourcesLine(");
    expect(core.fieldSourcesLine({ product_name: { source: "manifest" } })).toContain("Name: vendor's manifest");
  });

  it("the core self-tests are registered with their count", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("cultivera-survivorship-core", __runCultiveraSurvivorshipCoreTests(), 36)');
    expect(core.__runCultiveraSurvivorshipCoreTests()).toEqual({ passed: 36, failed: 0 });
  });
});
