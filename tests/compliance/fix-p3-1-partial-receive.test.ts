/**
 * tests/compliance/fix-p3-1-partial-receive.test.ts  (Fix Phase 3.1 · G-16 · F-04-1)
 *
 * The owner, verbatim:
 *   "So we need the ability to tell the system that we are only accepting a
 *    part of the manifest and the rest was rejected. There are several
 *    instances where the vendor forgot to send an item, or it broke in
 *    transit, etc." (docs/ccrs-rejection-and-returns.md L15-21)
 *   D29: "we need a way to accept less than what came in, please add this to
 *        the list of serious issues to fix"
 *   Owner message 6: "please begin work on phase 3, receiving: accept "18 of 20""
 *
 * Proven through the REAL setLotDockCount / setLotDisposition / rejectManifest
 * / finalizeManifestDispositions against the fake PostgREST:
 *   1. pure core (self-tests at the exact floor + the G-16 cases)
 *   2. the dock count write: 18 of 20, overage refused, 0 = refuse the line,
 *      equal = clear, a reason is required, finalized lines refused, a
 *      racing count refused, 0319 missing refused with nothing changed
 *   3. finalize: activated at the count, receive adjustment at the count,
 *      partial note required, timeline names shipped / counted / refused
 *   4. refusing a short-counted line puts the manifest quantity back
 *   5. wiring: the page, the component, the action (inventory.manage), the
 *      CCRS transfer / vendor bill read received_qty, migration 0319
 *   6. SOP / ledgers / KB pins
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
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
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/ai/suggestions", () => ({ persistSuggestion: async () => ({}) }));
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => null, getItemBySourceKey: async () => null }));
vi.mock("@/lib/ai/kb/store", () => ({ listKbProductCategoriesAll: async () => [] }));
vi.mock("@/lib/inventory/catalog-drafts", async (orig) => ({
  ...((await orig()) as object),
  seedDraftsForManifest: async () => ({ draftsCreated: 0, draftsFailed: 0, firstError: null, lotIdentities: null }),
}));
vi.mock("@/lib/inventory/coa-archive", () => ({ archiveCoasForManifest: async () => ({}) }));
vi.mock("@/lib/inventory/manifest-kb-bridge", () => ({ promoteManifestToKb: async () => ({ ok: true }) }));
vi.mock("@/lib/inventory/po-receive-store", () => ({ autoReceiveManifestPo: async () => ({ attempted: false, note: "" }) }));
vi.mock("@/lib/pos/intake-menu-staging", () => ({ stageIntakeMenuVersionForManifest: async () => ({ staged: false }) }));
vi.mock("@/lib/inventory/kb-link-store", () => ({ linkKbProductsToDrafts: async () => ({}) }));

const store = await import("@/lib/inventory/intake-store");
const core = await import("@/lib/inventory/intake-count-core");
const { planFinalize } = await import("@/lib/inventory/finalize-label-core");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const M = "00000000-0000-4000-8000-0000000000e1";
const LAB = "00000000-0000-4000-8000-0000000000c1";
const L = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

function lot(id: string, over: Row = {}): Row {
  return {
    id,
    manifest_id: M,
    product_name: `Product ${id.slice(-2)}`,
    lot_code: `LC-${id.slice(-2)}`,
    unit: "each",
    received_qty: 20,
    on_hand_qty: 20,
    shipped_qty: null,
    short_reason_code: null,
    short_reason: null,
    counted_by: null,
    counted_at: null,
    status: "quarantine",
    disposition: null,
    reject_reason_code: null,
    reject_reason: null,
    ccrs_inventory_external_id: `CCRS-${id.slice(-2)}`,
    lab_result_id: LAB,
    received_on: null,
    ...over,
  };
}
function seed(lots: Row[], status = "received") {
  st.db.rows("inbound_manifests").push({ id: M, manifest_number: "0425", status, vendor_id: "00000000-0000-4000-8000-0000000000f1", vendor_label: "Vendor", accepted_at: null, raw_payload: {} });
  st.db.rows("inventory_lots").push(...lots);
}
const lotById = (id: string) => st.db.rows("inventory_lots").find((r) => r.id === id)!;
const events = (type: string) => st.db.rows("manifest_events").filter((e) => e.event_type === type);
const adjustments = () => st.db.rows("inventory_adjustments");

beforeEach(() => {
  st.db = new FakePostgrest();
});

// ─── 1. pure core ──────────────────────────────────────────────────────────
describe("1. intake-count-core", () => {
  it("self-tests pass at the exact floor (36)", () => {
    expect(core.__runIntakeCountCoreTests()).toEqual({ passed: 36, failed: 0 });
  });
  it("is registered in run-pure-selftests", () => {
    const r = read("scripts/compliance/run-pure-selftests.ts");
    expect(r).toContain('import { __runIntakeCountCoreTests } from "../../src/lib/inventory/intake-count-core"');
    expect(r).toContain('assertRan("intake-count-core", __runIntakeCountCoreTests(), 36)');
  });
  it("is pure: no React, no next/*, no supabase, no process.env", () => {
    const s = read("src/lib/inventory/intake-count-core.ts");
    expect(s).not.toMatch(/from "react"|from "next\/|supabase|process\.env|server-only/);
  });
  it("G-16 test 1: 18 of 20 -> short, 2 refused", () => {
    const p = core.planDockCount({ receivedQty: 20, shippedQty: null, status: "quarantine", disposition: null }, { counted: "18", reasonCode: "short_shipment" });
    expect(p).toMatchObject({ ok: true, kind: "short", shipped: 20, counted: 18, refused: 2, reasonCode: "short_shipment" });
  });
  it("G-16 test 2: an overage is refused with the Overage instruction", () => {
    const p = core.planDockCount({ receivedQty: 20, shippedQty: null, status: "quarantine", disposition: null }, { counted: "22", reasonCode: "short_shipment" });
    expect(p.ok).toBe(false);
    expect(!p.ok && p.code).toBe("overage");
    expect(!p.ok && p.error).toContain("Overage");
  });
  it("G-16 test 3: zero counted = refuse the whole line", () => {
    const p = core.planDockCount({ receivedQty: 20, shippedQty: null, status: "quarantine", disposition: null }, { counted: "0", reasonCode: "damaged_in_transit" });
    expect(p).toMatchObject({ ok: true, kind: "refuse_whole", shipped: 20 });
  });
  it("short reasons are the dock reasons less overage, and match the 0319 check", () => {
    const mig = read("supabase/migrations/0319_intake_counted_short.sql");
    expect([...core.SHORT_REASON_CODES]).toEqual(["short_shipment", "damaged_in_transit", "wrong_product", "failed_coa", "expired", "other"]);
    expect(mig).toContain("('short_shipment', 'damaged_in_transit', 'wrong_product', 'failed_coa', 'expired', 'other')");
  });
  it("planFinalize: a short-counted line makes the note required (same rule as the server)", () => {
    const p = planFinalize([{ id: "1", disposition: null, shortCounted: true }]);
    expect(p.noteRequired).toBe(true);
    expect(p.short).toBe(1);
    expect(planFinalize([{ id: "1", disposition: null }]).noteRequired).toBe(false);
  });
});

// ─── 2. the dock count write ───────────────────────────────────────────────
describe("2. setLotDockCount", () => {
  it("18 of 20: received_qty / on_hand_qty = 18, shipped_qty = 20, reason, who, event, audit", async () => {
    seed([lot(L(1))]);
    const res = await store.setLotDockCount(M, L(1), { counted: "18", reasonCode: "damaged_in_transit" }, ACTOR);
    expect(res).toMatchObject({ ok: true, kind: "short" });
    const r = lotById(L(1));
    expect(r.received_qty).toBe(18);
    expect(r.on_hand_qty).toBe(18);
    expect(r.shipped_qty).toBe(20);
    expect(r.short_reason_code).toBe("damaged_in_transit");
    expect(r.short_reason).toBe(core.SHORT_REASON_LABELS.damaged_in_transit);
    expect(r.counted_by).toBe(ACTOR);
    expect(r.disposition).toBe("accepted");
    const ev = events(core.COUNT_SHORT_EVENT);
    expect(ev).toHaveLength(1);
    expect(String(ev[0].note)).toContain("counted 18 of 20 shipped; 2 refused at the dock");
    const audit = st.db.rows("audit_logs");
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("inventory_lot.dock_count_short");
    expect((audit[0].before_json as Row).received_qty).toBe(20);
  });
  it("the write is guarded: staged status AND the quantity it read", async () => {
    seed([lot(L(1))]);
    await store.setLotDockCount(M, L(1), { counted: "18", reasonCode: "short_shipment" }, ACTOR);
    const patch = st.db.log.find((q) => q.method === "PATCH" && q.table === "inventory_lots")!;
    expect(patch.url.searchParams.get("status")).toBe("in.(quarantine,pending)");
    expect(patch.url.searchParams.get("received_qty")).toBe("eq.20");
  });
  it("a racing count in between is refused, never overwritten", async () => {
    seed([lot(L(1))]);
    st.db.before = (req) => {
      if (req.method === "PATCH" && req.table === "inventory_lots") lotById(L(1)).received_qty = 19;
    };
    const res = await store.setLotDockCount(M, L(1), { counted: "18", reasonCode: "short_shipment" }, ACTOR);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("changed while you were counting");
    expect(lotById(L(1)).received_qty).toBe(19);
    expect(events(core.COUNT_SHORT_EVENT)).toHaveLength(0);
  });
  it("overage refused, nothing written", async () => {
    seed([lot(L(1))]);
    const res = await store.setLotDockCount(M, L(1), { counted: "21", reasonCode: "short_shipment" }, ACTOR);
    expect(res.ok).toBe(false);
    expect(lotById(L(1)).received_qty).toBe(20);
    expect(st.db.log.some((q) => q.method === "PATCH")).toBe(false);
  });
  it("no reason refused, nothing written", async () => {
    seed([lot(L(1))]);
    const res = await store.setLotDockCount(M, L(1), { counted: "18", reasonCode: "" }, ACTOR);
    expect(res.ok).toBe(false);
    expect(lotById(L(1)).received_qty).toBe(20);
  });
  it("0 counted: the whole line is refused at the dock with the reason, quantity stays the manifest's", async () => {
    seed([lot(L(1))]);
    const res = await store.setLotDockCount(M, L(1), { counted: "0", reasonCode: "short_shipment" }, ACTOR);
    expect(res).toMatchObject({ ok: true, kind: "refuse_whole" });
    const r = lotById(L(1));
    expect(r.disposition).toBe("rejected_at_dock");
    expect(r.reject_reason_code).toBe("short_shipment");
    expect(String(r.reject_reason)).toContain("Counted 0 of 20");
    expect(r.received_qty).toBe(20);
    expect(r.shipped_qty).toBeNull();
  });
  it("recount to the manifest quantity clears the short count", async () => {
    seed([lot(L(1), { received_qty: 18, on_hand_qty: 18, shipped_qty: 20, short_reason_code: "short_shipment", short_reason: "x", disposition: "accepted" })]);
    const res = await store.setLotDockCount(M, L(1), { counted: "20" }, ACTOR);
    expect(res).toMatchObject({ ok: true, kind: "clear" });
    const r = lotById(L(1));
    expect(r.received_qty).toBe(20);
    expect(r.on_hand_qty).toBe(20);
    expect(r.shipped_qty).toBeNull();
    expect(r.short_reason_code).toBeNull();
    expect(events(core.COUNT_SHORT_CLEARED_EVENT)).toHaveLength(1);
  });
  it("a recount is measured against the manifest quantity, not the earlier count", async () => {
    seed([lot(L(1), { received_qty: 18, on_hand_qty: 18, shipped_qty: 20, short_reason_code: "short_shipment", short_reason: "x", disposition: "accepted" })]);
    const res = await store.setLotDockCount(M, L(1), { counted: "19", reasonCode: "short_shipment" }, ACTOR);
    expect(res.ok).toBe(true);
    expect(lotById(L(1)).received_qty).toBe(19);
    expect(lotById(L(1)).shipped_qty).toBe(20);
  });
  it("a finalized delivery refuses a count", async () => {
    seed([lot(L(1))], "accepted");
    const res = await store.setLotDockCount(M, L(1), { counted: "18", reasonCode: "short_shipment" }, ACTOR);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("already finalized");
  });
  it("an active lot refuses a count", async () => {
    seed([lot(L(1), { status: "active" })]);
    expect((await store.setLotDockCount(M, L(1), { counted: "18", reasonCode: "short_shipment" }, ACTOR)).ok).toBe(false);
  });
  it("a lot from another delivery is refused", async () => {
    seed([lot(L(1), { manifest_id: "00000000-0000-4000-8000-0000000000e9" })]);
    const res = await store.setLotDockCount(M, L(1), { counted: "18", reasonCode: "short_shipment" }, ACTOR);
    expect(!res.ok && res.error).toContain("not on this delivery");
  });
  it("migration 0319 missing: refused in words, nothing changed", async () => {
    seed([lot(L(1))]);
    st.db.before = (req) => {
      if (req.method === "GET" && req.table === "inventory_lots") {
        return { status: 400, body: { code: "42703", message: "column inventory_lots.shipped_qty does not exist", details: null, hint: null } };
      }
    };
    const res = await store.setLotDockCount(M, L(1), { counted: "18", reasonCode: "short_shipment" }, ACTOR);
    expect(!res.ok && res.error).toContain("Migration 0319 is not applied");
    expect(lotById(L(1)).received_qty).toBe(20);
  });
});

// ─── 3. finalize at the count ──────────────────────────────────────────────
describe("3. finalize receives the counted quantity", () => {
  it("18 of 20: activated at 18, receive adjustment +18 with the count note, partial, timeline says it", async () => {
    seed([
      lot(L(1), { received_qty: 18, on_hand_qty: 18, shipped_qty: 20, short_reason_code: "damaged_in_transit", short_reason: "Damaged / broke in transit", disposition: "accepted" }),
      lot(L(2), { received_qty: 5, on_hand_qty: 5 }),
    ]);
    const res = await store.finalizeManifestDispositions(M, ACTOR, { partialNote: "Two cartridges broke in transit." });
    expect(res.ok).toBe(true);
    expect(lotById(L(1)).status).toBe("active");
    expect(lotById(L(1)).on_hand_qty).toBe(18);
    const adj = adjustments();
    const a1 = adj.find((a) => a.lot_id === L(1))!;
    const a2 = adj.find((a) => a.lot_id === L(2))!;
    expect(a1.qty_delta).toBe(18);
    expect(a1.reason).toBe("receive");
    expect(String(a1.note)).toContain("18 of 20 shipped");
    expect(a2.qty_delta).toBe(5);
    expect(a2.note).toBe("Accepted from vendor manifest intake (partial-accept flow).");
    const m = st.db.rows("inbound_manifests")[0];
    expect(m.status).toBe("partially_accepted");
    const ev = events("partially_accepted");
    expect(ev).toHaveLength(1);
    expect(String(ev[0].note)).toContain("Received short: Product 01 18 of 20 (2 refused: Damaged / broke in transit).");
    expect(String(ev[0].note)).toContain("Why partial: Two cartridges broke in transit.");
  });
  it("a short-counted line with no why-partial note: refused before any lot is touched", async () => {
    seed([lot(L(1), { received_qty: 18, on_hand_qty: 18, shipped_qty: 20, short_reason_code: "short_shipment", short_reason: "x", disposition: "accepted" })]);
    const res = await store.finalizeManifestDispositions(M, ACTOR);
    expect(res.ok).toBe(false);
    expect(lotById(L(1)).status).toBe("quarantine");
    expect(adjustments()).toHaveLength(0);
  });
  it("no short line: unchanged behaviour (accepted, no note needed, old adjustment note)", async () => {
    seed([lot(L(1))]);
    const res = await store.finalizeManifestDispositions(M, ACTOR);
    expect(res.ok).toBe(true);
    expect(st.db.rows("inbound_manifests")[0].status).toBe("accepted");
    expect(adjustments()[0].qty_delta).toBe(20);
  });
  it("a failed dock-count read refuses the finalize before any lot is touched", async () => {
    seed([lot(L(1))]);
    st.db.before = (req) => {
      if (req.method === "GET" && req.table === "inventory_lots" && req.url.searchParams.get("shipped_qty") === "not.is.null") {
        return { status: 500, body: { code: "XX000", message: "boom", details: null, hint: null } };
      }
    };
    const res = await store.finalizeManifestDispositions(M, ACTOR);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("dock counts could not be read");
    expect(lotById(L(1)).status).toBe("quarantine");
  });
  it("a short-counted line that was then REFUSED is not reported as received short", async () => {
    seed([
      lot(L(1), { received_qty: 18, on_hand_qty: 18, shipped_qty: 20, short_reason_code: "short_shipment", short_reason: "Short shipment", disposition: "rejected_at_dock", reject_reason_code: "wrong_product", reject_reason: "Wrong product" }),
      lot(L(2), { received_qty: 5, on_hand_qty: 5, disposition: "accepted" }),
    ]);
    const res = await store.finalizeManifestDispositions(M, ACTOR, { partialNote: "Wrong product on one line." });
    expect(res.ok).toBe(true);
    const ev = events("partially_accepted");
    expect(ev).toHaveLength(1);
    expect(String(ev[0].note)).not.toContain("Received short");
    expect(adjustments().find((x) => x.lot_id === L(1))).toBeUndefined();
  });
  it("before 0319 (columns missing): finalize works exactly as before", async () => {
    seed([lot(L(1))]);
    st.db.before = (req) => {
      if (req.method === "GET" && req.table === "inventory_lots" && req.url.searchParams.get("shipped_qty") === "not.is.null") {
        return { status: 400, body: { code: "42703", message: "column inventory_lots.shipped_qty does not exist", details: null, hint: null } };
      }
    };
    const res = await store.finalizeManifestDispositions(M, ACTOR);
    expect(res.ok).toBe(true);
    expect(lotById(L(1)).status).toBe("active");
  });
});

// ─── 4. refusing a short-counted line ──────────────────────────────────────
describe("4. a refused line reads the manifest quantity again", () => {
  it("line reject: received_qty back to shipped_qty, short columns cleared", async () => {
    seed([lot(L(1), { received_qty: 18, on_hand_qty: 18, shipped_qty: 20, short_reason_code: "short_shipment", short_reason: "x", disposition: "accepted" })]);
    const res = await store.setLotDisposition(L(1), "rejected_at_dock", ACTOR, { reasonCode: "wrong_product", reasonText: "Wrong product" });
    expect(res.ok).toBe(true);
    const r = lotById(L(1));
    expect(r.disposition).toBe("rejected_at_dock");
    expect(r.received_qty).toBe(20);
    expect(r.on_hand_qty).toBe(20);
    expect(r.shipped_qty).toBeNull();
    expect(r.short_reason_code).toBeNull();
  });
  it("whole-manifest reject: short lines read the manifest quantity again", async () => {
    seed([lot(L(1), { received_qty: 18, on_hand_qty: 18, shipped_qty: 20, short_reason_code: "short_shipment", short_reason: "x", disposition: "accepted" })]);
    const res = await store.rejectManifest(M, ACTOR, { reasonCode: "wrong_product", reasonText: "Wrong product" });
    expect(res.ok).toBe(true);
    expect(lotById(L(1)).received_qty).toBe(20);
    expect(lotById(L(1)).shipped_qty).toBeNull();
  });
  it("the restore never touches a lot that went live in between (race guard)", async () => {
    seed([lot(L(1), { received_qty: 18, on_hand_qty: 18, shipped_qty: 20, short_reason_code: "short_shipment", short_reason: "x", disposition: "accepted" })]);
    st.db.before = (req) => {
      // A racing finalize activates the lot right after the restore read it.
      if (req.method === "GET" && req.table === "inventory_lots" && req.url.searchParams.get("shipped_qty") === "not.is.null") {
        lotById(L(1)).status = "active";
      }
    };
    const res = await store.rejectManifest(M, ACTOR, { reasonCode: "wrong_product", reasonText: "Wrong product" });
    expect(res.ok).toBe(true);
    expect(lotById(L(1)).received_qty).toBe(18);
    expect(lotById(L(1)).on_hand_qty).toBe(18);
    expect(lotById(L(1)).shipped_qty).toBe(20);
  });
  it("an untouched line reject writes no restore", async () => {
    seed([lot(L(1))]);
    await store.setLotDisposition(L(1), "rejected_at_dock", ACTOR, { reasonCode: "wrong_product", reasonText: "Wrong product" });
    expect(lotById(L(1)).received_qty).toBe(20);
    expect(st.db.log.filter((q) => q.method === "PATCH")).toHaveLength(1);
  });
});

// ─── 5. wiring ─────────────────────────────────────────────────────────────
describe("5. wiring", () => {
  const page = read("src/app/admin/inventory/intake/[id]/page.tsx");
  const actions = read("src/app/admin/inventory/intake/actions.ts");
  const comp = read("src/components/admin/inventory/ManifestLotDisposition.tsx");
  it("the action is manager-only (D30: inventory.manage) and reports ?count=", () => {
    const fn = actions.slice(actions.indexOf("export async function setLotDockCountAction"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain('requirePermission("inventory.manage")');
    expect(body).toContain("setLotDockCount(");
    expect(body).toContain("?count=error&countmsg=");
    expect(body).toContain('res.kind === "short" ? "short" : res.kind === "clear" ? "cleared" : "refused"');
  });
  it("the page passes the count action only after 0319, shows 18 of 20, and says a failed read", () => {
    expect(page).toContain("const shortCounts = await listLotShortCounts(id);");
    expect(page).toContain('const countOn = shortCounts.kind === "loaded";');
    expect(page).toContain("countAction={countOn ? setLotDockCountAction : undefined}");
    expect(page).toContain("data-qty-short={l.id}");
    expect(page).toContain('shortCounts.kind === "error"');
    expect(page).toContain("shortCounted: shortByLot.has(l.id),");
    expect(page).toContain("data-count-result={count}");
  });
  it("the component has Count short / Recount, the count box, the reasons, and the 18 of 20 chip", () => {
    expect(comp).toContain('{shippedQty != null ? "Recount" : "Count short"}');
    expect(comp).toContain("data-count-short={lotId}");
    expect(comp).toContain('name="counted_qty"');
    expect(comp).toContain('name="short_reason_code"');
    expect(comp).toContain("SHORT_REASON_CODES.map");
    expect(comp).toContain('data-line-state="counted-short"');
    expect(comp).toContain("Accepting {receivedQty != null ? fmtCountQty(receivedQty)");
  });
  it("received_qty is what CCRS InventoryTransfer, Inventory.csv and the vendor bill read (so they follow the count)", () => {
    expect(read("src/lib/compliance/ccrs-batch.ts")).toContain("const qty = r.received_qty === null ? null : Number(r.received_qty);");
    expect(read("src/lib/compliance/ccrs-transfer-core.ts")).toContain("Quantity =\n *      received quantity");
    expect(read("src/lib/accounting/vendor-bill-service.ts")).toContain("const qty = Number(lot.received_qty) || 0;");
  });
  it("the timeline labels exist for both event types", () => {
    const labels = read("src/lib/inventory/manifest-event-labels-core.ts");
    expect(labels).toContain('count_short: { label: "Counted short at the dock (the rest refused)"');
    expect(labels).toContain('count_short_cleared: { label: "Short count removed"');
  });
  it("migration 0319: idempotent columns, the shipped > received check, no data written", () => {
    const mig = read("supabase/migrations/0319_intake_counted_short.sql");
    expect(mig).toContain("add column if not exists shipped_qty       numeric");
    expect(mig).toContain("check (shipped_qty is null or (shipped_qty > 0 and received_qty >= 0 and received_qty < shipped_qty))");
    expect(mig).not.toMatch(/^\s*(update|insert|delete)\s/im);
    expect(mig).toContain("we need a way to accept less than what came in");
  });
});

// ─── 6. docs / ledgers / KB ────────────────────────────────────────────────
describe("6. SOP-04 v1.5, ledgers and KB", () => {
  const sop = read("docs/sop/SOP-04-receiving-intake.md");
  it("SOP-04 is v1.5 and §4.11 is the built count-short procedure", () => {
    expect(sop).toMatch(/\| 1\.5 draft \| Fix phase \| Phase 3\.1 /);
    expect(sop).toContain("| **Version** | 1.5 (Phase 3.1");
    expect(sop).toContain("### 4.11 Short counts: receive part of a line (\"18 of 20\")");
    expect(sop).toContain("**Count short**");
    expect(sop).not.toContain("### 4.11 Short counts (interim rule)");
  });
  it("03: F-04-1 FIXED quoting the superseded interim rule", () => {
    const f = read("docs/sop-program/03-FINDINGS-LEDGER.md");
    expect(f).toMatch(/### F-04-1 · [^\n]*\n- \*\*Status: FIXED \(Phase 3\.1/);
  });
  it("05: G-16 BUILT", () => {
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toMatch(/## G-16 · Partial-quantity receive[\s\S]*?\*\*Status: BUILT \(Phase 3\.1/);
  });
  it("06: progress row for 3.1", () => {
    expect(read("docs/sop-program/06-FIX-PHASE-PLAN.md")).toMatch(/\| 3\.1 \| G-16/);
  });
  it("04: superseded answers quoted", () => {
    expect(read("docs/sop-program/04-CONCIERGE-COVERAGE-LEDGER.md")).toContain("Fix Phase 3.1 update to the SOP-04 rows");
  });
  it("KB: the concierge knows Count short", () => {
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toContain("Receiving \\u2192 Count short (Phase 3.1");
  });
});
