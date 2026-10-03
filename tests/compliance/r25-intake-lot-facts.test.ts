/**
 * tests/compliance/r25-intake-lot-facts.test.ts  (R25 A)
 *
 * Owner (R25, verbatim): "the strain type and receive date is not getting
 * recorded to the inventory table. ... The receive date should be the date the
 * manifest was accepted into the system via receiving. Also, the strain type
 * did not get saved to the inventory page, or it is unaware of them."
 *
 * Proven here through the REAL finalizeManifestDispositions and the REAL
 * mirrorStrainTypePickToLot over the REAL postgrest-js client against
 * FakePostgrest:
 *   A. pure core floor;
 *   B. finalize stamps received_on (Pacific day of the accept instant, source
 *      "manifest", set_by null) on ACTIVATED and HELD lots, never on refused
 *      ones, never over an existing date; a missing 0214 column / write error
 *      lands on the manifest timeline and never fails the accept;
 *   C. the strain-type mirror writes the human pick with "reviewer"
 *      provenance, skips no-pick / unknown / already-set, never writes blind
 *      on a read failure, never throws, always audits;
 *   D. wiring + migration 0244 text pins; the public card hides an unknown
 *      strain type (no "Hybrid" label fallback).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";
import { PostgrestClient } from "@supabase/postgrest-js";

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
// The finalize's follow-up chores are out of scope here (each has its own
// suite); stub them so this suite isolates the lot writes.
vi.mock("@/lib/inventory/catalog-drafts", async (orig) => ({
  ...((await orig()) as object),
  seedDraftsForManifest: async () => ({ draftsCreated: 0, draftsFailed: 0, firstError: null, lotIdentities: null }),
}));
vi.mock("@/lib/inventory/coa-archive", () => ({ archiveCoasForManifest: async () => ({}) }));
vi.mock("@/lib/inventory/manifest-kb-bridge", () => ({ promoteManifestToKb: async () => ({ ok: true }) }));
vi.mock("@/lib/inventory/po-receive-store", () => ({ autoReceiveManifestPo: async () => ({ attempted: false, note: "" }) }));
vi.mock("@/lib/pos/intake-menu-staging", () => ({ stageIntakeMenuVersionForManifest: async () => ({ staged: false }) }));
vi.mock("@/lib/inventory/kb-link-store", () => ({ linkKbProductsToDrafts: async () => ({}) }));

const { finalizeManifestDispositions } = await import("@/lib/inventory/intake-store");
const { mirrorStrainTypePickToLot, LOT_STRAIN_TYPE_MIRROR_AUDIT_ACTION } = await import("@/lib/inventory/catalog-drafts");
const core = await import("@/lib/inventory/intake-lot-facts-core");
const { pacificDayKey } = await import("@/lib/reports/timezone");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const M = "00000000-0000-4000-8000-0000000000e1";
const VENDOR = "00000000-0000-4000-8000-0000000000f1";
const LAB = "00000000-0000-4000-8000-0000000000c1";

function lot(id: string, over: Row = {}): Row {
  return {
    id,
    manifest_id: M,
    product_name: `Product ${id.slice(-2)}`,
    lot_code: `LC-${id.slice(-2)}`,
    received_qty: 10,
    status: "quarantine",
    disposition: "accepted",
    ccrs_inventory_external_id: `CCRS-${id.slice(-2)}`,
    lab_result_id: LAB,
    received_on: null,
    received_on_source: null,
    received_on_set_by: null,
    received_on_set_at: null,
    strain_type: null,
    fact_provenance: {},
    ...over,
  };
}
const L = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

function seedManifest(lots: Row[]) {
  st.db.rows("inbound_manifests").push({
    id: M,
    manifest_number: "0425",
    status: "received",
    vendor_id: VENDOR,
    vendor_label: "Vendor",
    accepted_at: null,
    raw_payload: {},
  });
  st.db.rows("inventory_lots").push(...lots);
}
const lotById = (id: string) => st.db.rows("inventory_lots").find((r) => r.id === id)!;
const events = (type: string) => st.db.rows("manifest_events").filter((e) => e.event_type === type);

beforeEach(() => {
  st.db = new FakePostgrest();
  st.audits = [];
  st.throwAdmin = false;
});

// ─── A. pure core ───────────────────────────────────────────────────────────
describe("R25 A - intake-lot-facts-core", () => {
  it("embedded self-tests pass at the exact floor", () => {
    const r = core.__runIntakeLotFactsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(44);
  });
  it("the stamp is the PACIFIC day of the instant (late-night UTC is still yesterday in WA)", () => {
    const p = core.planReceivedOnStamp({ acceptedAtIso: "2026-07-16T06:30:00Z", todayPacific: "2026-07-16", lotIds: ["a"] });
    expect(p.write && p.patch.received_on).toBe("2026-07-15");
    expect(p.write && p.patch.received_on_source).toBe("manifest");
    expect(p.write && p.patch.received_on_set_by).toBeNull();
  });
});

// ─── B. finalize stamps received_on ─────────────────────────────────────────
describe("R25 A - finalize stamps the received date", () => {
  it("activated + held lots get the Pacific accept day; refused and pre-dated lots do not", async () => {
    seedManifest([
      lot(L(1)), // clean -> activated
      lot(L(2), { ccrs_inventory_external_id: null }), // dirty -> held in quarantine
      lot(L(3), { disposition: "rejected_at_dock" }), // refused at dock
      lot(L(4), { received_on: "2026-07-01", received_on_source: "owner_entered", received_on_set_by: ACTOR }), // typed date
    ]);
    const res = await finalizeManifestDispositions(M, ACTOR, { partialNote: "Lot 2 has no CCRS id; lot 3 arrived damaged." });
    expect(res.ok).toBe(true);
    const m = st.db.rows("inbound_manifests")[0];
    const acceptedAt = String(m.accepted_at);
    expect(acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const day = pacificDayKey(new Date(acceptedAt));

    for (const id of [L(1), L(2)]) {
      const r = lotById(id);
      expect(r.received_on, id).toBe(day);
      expect(r.received_on_source).toBe("manifest");
      expect(r.received_on_set_by).toBeNull();
      expect(r.received_on_set_at).toBe(acceptedAt); // the SAME instant as accepted_at
    }
    expect(lotById(L(2)).status).toBe("quarantine"); // held stays unsellable
    expect(lotById(L(3)).received_on).toBeNull();
    expect(lotById(L(3)).status).toBe("rejected");
    // a typed date is never overwritten (fill-only)
    expect(lotById(L(4)).received_on).toBe("2026-07-01");
    expect(lotById(L(4)).received_on_source).toBe("owner_entered");
    expect(lotById(L(4)).received_on_set_by).toBe(ACTOR);
    expect(events(core.RECEIVED_DATE_STAMP_ERROR_EVENT)).toHaveLength(0);
  });

  it("the stamp is ONE fill-only statement (.in ids + is received_on null)", async () => {
    seedManifest([lot(L(1)), lot(L(2))]);
    await finalizeManifestDispositions(M, ACTOR);
    const stamps = st.db.log.filter(
      (q) => q.method === "PATCH" && q.table === "inventory_lots" && (q.body as Row)?.received_on_source === "manifest",
    );
    expect(stamps).toHaveLength(1);
    expect(stamps[0].url.searchParams.get("received_on")).toBe("is.null");
    expect(stamps[0].url.searchParams.get("id")).toMatch(/^in\./);
  });

  it("a re-finalize never moves a date already stamped", async () => {
    seedManifest([lot(L(1), { status: "active", received_on: "2026-07-10", received_on_source: "manifest", received_on_set_at: "2026-07-10T18:00:00.000Z" })]);
    await finalizeManifestDispositions(M, ACTOR);
    expect(lotById(L(1)).received_on).toBe("2026-07-10");
    expect(lotById(L(1)).received_on_set_at).toBe("2026-07-10T18:00:00.000Z");
  });

  it("nothing accepted -> no stamp statement at all", async () => {
    seedManifest([lot(L(3), { disposition: "rejected_at_dock" })]);
    await finalizeManifestDispositions(M, ACTOR);
    expect(st.db.log.some((q) => q.method === "PATCH" && (q.body as Row)?.received_on_source === "manifest")).toBe(false);
    expect(lotById(L(3)).received_on).toBeNull();
  });

  it("missing 0214 columns -> timeline event naming the migration; the accept still succeeds", async () => {
    seedManifest([lot(L(1))]);
    st.db.before = (req) => {
      if (req.method === "PATCH" && req.table === "inventory_lots" && (req.body as Row)?.received_on_source) {
        return { status: 400, body: { code: "PGRST204", message: "Could not find the 'received_on' column of 'inventory_lots' in the schema cache", details: null, hint: null } };
      }
    };
    const res = await finalizeManifestDispositions(M, ACTOR);
    expect(res.ok).toBe(true);
    expect(lotById(L(1)).status).toBe("active");
    const ev = events(core.RECEIVED_DATE_STAMP_ERROR_EVENT);
    expect(ev).toHaveLength(1);
    expect(String(ev[0].note)).toContain("migration 0214");
  });

  it("any other write error -> timeline event with the message; accept still succeeds", async () => {
    seedManifest([lot(L(1))]);
    st.db.before = (req) => {
      if (req.method === "PATCH" && req.table === "inventory_lots" && (req.body as Row)?.received_on_source) {
        return { status: 400, body: { code: "23514", message: "violates check constraint inventory_lots_received_on_sane_chk", details: null, hint: null } };
      }
    };
    const res = await finalizeManifestDispositions(M, ACTOR);
    expect(res.ok).toBe(true);
    const ev = events(core.RECEIVED_DATE_STAMP_ERROR_EVENT);
    expect(ev).toHaveLength(1);
    expect(String(ev[0].note)).toContain("received_on_sane_chk");
    expect(String(ev[0].note)).not.toContain("migration 0214");
  });
});

// ─── C. strain-type mirror ──────────────────────────────────────────────────
describe("R25 A - mirrorStrainTypePickToLot", () => {
  const admin = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) as any;
  const DRAFT = "00000000-0000-4000-8000-0000000000d1";

  it("writes the human pick with reviewer provenance, keeps other provenance, audits", async () => {
    st.db.rows("inventory_lots").push(lot(L(1), { strain_type: "indica", fact_provenance: { package_thc_mg: "name", strain_type: "manifest" } }));
    const r = await mirrorStrainTypePickToLot(admin(), { draftId: DRAFT, lotId: L(1), humanPick: "Hybrid", actorId: ACTOR });
    expect(r).toEqual({ written: true, code: "written" });
    const row = lotById(L(1));
    expect(row.strain_type).toBe("hybrid");
    expect(row.fact_provenance).toEqual({ package_thc_mg: "name", strain_type: "reviewer" });
    expect(row.updated_by).toBe(ACTOR);
    expect(st.audits).toHaveLength(1);
    expect(st.audits[0].action).toBe(LOT_STRAIN_TYPE_MIRROR_AUDIT_ACTION);
    expect(st.audits[0].entityId).toBe(L(1));
    expect(st.audits[0].before).toEqual({ strain_type: "indica" });
    expect((st.audits[0].after as Row).lot_mirrored).toBe(L(1));
  });

  it("no pick -> lot keeps the manifest value, no read, no write, audited skip", async () => {
    st.db.rows("inventory_lots").push(lot(L(1), { strain_type: "indica" }));
    const r = await mirrorStrainTypePickToLot(admin(), { draftId: DRAFT, lotId: L(1), humanPick: null, actorId: ACTOR });
    expect(r).toEqual({ written: false, code: "no_pick" });
    expect(st.db.log).toHaveLength(0);
    expect(lotById(L(1)).strain_type).toBe("indica");
    expect((st.audits[0].after as Row).lot_mirror_skipped).toBe("no_pick");
  });

  it("'unknown' is not a pick", async () => {
    st.db.rows("inventory_lots").push(lot(L(1), { strain_type: "sativa" }));
    const r = await mirrorStrainTypePickToLot(admin(), { draftId: DRAFT, lotId: L(1), humanPick: "unknown", actorId: ACTOR });
    expect(r.written).toBe(false);
    expect(lotById(L(1)).strain_type).toBe("sativa");
  });

  it("already the same value with reviewer provenance -> no write", async () => {
    st.db.rows("inventory_lots").push(lot(L(1), { strain_type: "hybrid", fact_provenance: { strain_type: "reviewer" } }));
    const r = await mirrorStrainTypePickToLot(admin(), { draftId: DRAFT, lotId: L(1), humanPick: "hybrid", actorId: ACTOR });
    expect(r).toEqual({ written: false, code: "already_set" });
    expect(st.db.log.filter((q) => q.method === "PATCH")).toHaveLength(0);
  });

  it("same value but machine provenance -> provenance upgraded to reviewer", async () => {
    st.db.rows("inventory_lots").push(lot(L(1), { strain_type: "hybrid", fact_provenance: { strain_type: "manifest" } }));
    const r = await mirrorStrainTypePickToLot(admin(), { draftId: DRAFT, lotId: L(1), humanPick: "hybrid", actorId: ACTOR });
    expect(r.written).toBe(true);
    expect(lotById(L(1)).fact_provenance).toEqual({ strain_type: "reviewer" });
  });

  it("no lot linked -> audited skip on the draft id", async () => {
    const r = await mirrorStrainTypePickToLot(admin(), { draftId: DRAFT, lotId: null, humanPick: "hybrid", actorId: ACTOR });
    expect(r).toEqual({ written: false, code: "no_lot" });
    expect(st.audits[0].entityId).toBe(DRAFT);
  });

  it("lot row missing -> lot_not_found, no write", async () => {
    const r = await mirrorStrainTypePickToLot(admin(), { draftId: DRAFT, lotId: L(9), humanPick: "hybrid", actorId: ACTOR });
    expect(r).toEqual({ written: false, code: "lot_not_found" });
    expect(st.db.log.filter((q) => q.method === "PATCH")).toHaveLength(0);
  });

  it("lot read fails -> NEVER writes blind", async () => {
    st.db.rows("inventory_lots").push(lot(L(1), { strain_type: "indica" }));
    st.db.before = (req) => (req.method === "GET" ? { status: 500, body: { code: "XX000", message: "boom", details: null, hint: null } } : undefined);
    const r = await mirrorStrainTypePickToLot(admin(), { draftId: DRAFT, lotId: L(1), humanPick: "hybrid", actorId: ACTOR });
    expect(r).toEqual({ written: false, code: "lot_read_failed" });
    expect(st.db.log.filter((q) => q.method === "PATCH")).toHaveLength(0);
    expect(lotById(L(1)).strain_type).toBe("indica");
    expect((st.audits[0].after as Row).lot_read_failed).toBe("boom");
  });

  it("write error -> write_failed, audited", async () => {
    st.db.rows("inventory_lots").push(lot(L(1)));
    st.db.before = (req) => (req.method === "PATCH" ? { status: 400, body: { code: "23514", message: "nope", details: null, hint: null } } : undefined);
    const r = await mirrorStrainTypePickToLot(admin(), { draftId: DRAFT, lotId: L(1), humanPick: "sativa", actorId: ACTOR });
    expect(r).toEqual({ written: false, code: "write_failed" });
    expect((st.audits[0].after as Row).lot_row_write_failed).toBe("nope");
  });

  it("a throwing client never throws out; audited", async () => {
    const bad = { from: () => { throw new Error("kaboom"); } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await mirrorStrainTypePickToLot(bad as any, { draftId: DRAFT, lotId: L(1), humanPick: "sativa", actorId: ACTOR });
    expect(r).toEqual({ written: false, code: "threw" });
    expect((st.audits[0].after as Row).lot_row_write_failed).toBe("kaboom");
  });
});

// ─── D. wiring + migration pins ─────────────────────────────────────────────
describe("R25 A - wiring and migration 0244 pins", () => {
  const drafts = read("src/lib/inventory/catalog-drafts.ts");
  const intake = read("src/lib/inventory/intake-store.ts");
  const mig = read("supabase/migrations/0244_intake_lot_received_date_strain_type_backfill.sql");
  const rb = read("supabase/rollbacks/0244_intake_lot_received_date_strain_type_backfill.rollback.sql");

  it("approveDraftWithPrice mirrors the human pick (strainChoice.value) to the lot", () => {
    const body = drafts.slice(drafts.indexOf("export async function approveDraftWithPrice"));
    const fnEnd = body.indexOf("\nexport async function ", 10);
    const fn = body.slice(0, fnEnd);
    expect(fn).toMatch(/await mirrorStrainTypePickToLot\(admin, \{\s*draftId,\s*lotId: row\?\.lot_id \?\? null,\s*humanPick: strainChoice\.value,/);
  });

  it("finalize stamps activated + held lots from the planner, fill-only", () => {
    expect(intake).toContain("lotIds: [...activatedLotIds, ...heldLotIds]");
    expect(intake).toContain('.in("id", receivedStamp.lotIds)\n        .is("received_on", null);');
    expect(intake).toMatch(/heldLotIds\.push\(lot\.id\);/);
  });

  it("0244 excludes the Cultivera import manifest, is fill-only and audited", () => {
    expect(mig).toContain("not like 'POS-IMPORT-%'");
    expect(mig).toContain("<> 'pos-import-migration'");
    expect(mig).toContain("where l.received_on is null");
    expect(mig).toContain("'migration:0244'");
    expect(mig).toContain("'America/Los_Angeles'");
    expect(mig).toContain("inventory_lot.details_edited");
    expect(rb).toContain("delete from public.audit_logs");
  });

  it("the public card hides an unknown strain type instead of labelling it Hybrid", () => {
    const card = read("src/components/menu/ProductCardVisual.tsx");
    expect(card).toMatch(/strainType === "unknown"/);
  });

  it("the pure runner registers the core at the exact floor", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      'assertRan("intake-lot-facts-core", __runIntakeLotFactsCoreTests(), 44);',
    );
  });
});
