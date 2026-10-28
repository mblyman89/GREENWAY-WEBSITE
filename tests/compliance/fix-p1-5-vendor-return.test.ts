/**
 * Fix Phase 1.5 (G-42; F-15-1, F-15-2, F-15-3, F-15-19; D63, D65).
 *
 * A vendor return now follows the state's own steps:
 *   log (units RESERVED, still on hand and in CCRS)
 *   -> Manifest.CSV built here and uploaded by the store
 *   -> LCB success email + PDF recorded
 *   -> departure (on-hand comes off and the CCRS Other adjustment posts then).
 * Cancel is owner-only and releases the reserve. A Recalled lot can be
 * returned. The unsupported "48-72 hours / Mon-Wed-Fri" text is gone.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VENDOR_RETURN_STATE_STEPS,
  VENDOR_RETURN_STATUS_LABELS,
  MANIFEST_HEADER_ATTRIBUTES,
  MANIFEST_ITEM_COLUMNS,
  buildManifestCsv,
  evaluateVendorReturnCancel,
  evaluateVendorReturnLog,
  evaluateVendorReturnStep,
  isLegacyReducedReturn,
  manifestFileName,
  nextVendorReturnStatus,
  vendorReturnAdjustmentNote,
  vendorReturnManifestId,
  __runVendorReturnCoreTests,
  type ManifestInput,
  type VendorReturnLogInput,
} from "@/lib/inventory/vendor-return-core";
import { can } from "@/lib/auth/roles";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const MIG = read("supabase/migrations/0309_vendor_return_staged.sql");
const DISP = read("src/lib/inventory/disposition.ts");
const ACT = read("src/app/admin/inventory/disposition/actions.ts");
const PAGE = read("src/app/admin/inventory/disposition/page.tsx");
const ROUTE = read("src/app/admin/inventory/disposition/vendor-return-manifest/route.ts");
const TEMPLATE = read("docs/fixtures/ccrs-manifest-template.csv");

describe("core self-test", () => {
  it("passes with no failures", () => {
    const r = __runVendorReturnCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(59);
  });
});

describe("state steps (F-15-19, D63)", () => {
  it("one step at a time; closed returns go nowhere", () => {
    expect(nextVendorReturnStatus("requested")).toBe("submitted");
    expect(nextVendorReturnStatus("submitted")).toBe("confirmed");
    expect(nextVendorReturnStatus("confirmed")).toBe("picked_up");
    expect(nextVendorReturnStatus("picked_up")).toBeNull();
    expect(nextVendorReturnStatus("cancelled")).toBeNull();
  });
  it("labels name the state's real steps", () => {
    expect(VENDOR_RETURN_STATUS_LABELS.submitted).toBe("Manifest uploaded");
    expect(VENDOR_RETURN_STATUS_LABELS.confirmed).toBe("LCB success email and PDF received");
  });
  it("no 48-72 hour or Mon/Wed/Fri guidance anywhere the operator reads it", () => {
    expect(VENDOR_RETURN_STATE_STEPS.join(" ")).not.toMatch(/48|Mon\/Wed\/Fri/);
    for (const f of ["src/lib/inventory/disposition-core.ts", "src/lib/inventory/disposition-advisor.ts"]) {
      const code = read(f)
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      expect(code).not.toMatch(/48[-\u2013]72 hours|Mon\/Wed\/Fri/);
    }
    expect(read("src/lib/inventory/disposition-core.ts")).not.toContain("export const VENDOR_RETURN_MANIFEST_STEPS");
  });
  it("cannot skip the LCB email; departure needs a past pickup time and a driver", () => {
    const base = { todayPacific: "2026-11-02", nowIso: "2026-11-02T20:00:00.000Z" };
    expect(evaluateVendorReturnStep({ ...base, from: "requested", to: "picked_up" }).ok).toBe(false);
    expect(evaluateVendorReturnStep({ ...base, from: "submitted", to: "picked_up" }).ok).toBe(false);
    expect(
      evaluateVendorReturnStep({ ...base, from: "confirmed", to: "picked_up", pickupIso: "2026-11-03T20:00:00.000Z", driverName: "Ann" }).ok,
    ).toBe(false);
    expect(
      evaluateVendorReturnStep({ ...base, from: "confirmed", to: "picked_up", pickupIso: "2026-11-02T19:00:00.000Z", driverName: "Ann" }).ok,
    ).toBe(true);
  });
});

describe("logging (F-15-1, F-15-2, D65)", () => {
  const base: VendorReturnLogInput = {
    lotStatus: "active",
    reason: "defective",
    quantity: 2,
    free: 5,
    vendorId: "v1",
    rmaNumber: "RMA-1",
    processorLicense: "412345",
    detail: "Seal broken, vendor agreed by email",
    todayPacific: "2026-11-02",
  };
  const codes = (x: ReturnType<typeof evaluateVendorReturnLog>) => (x.ok ? [] : x.refusals.map((r) => r.code));
  it("RMA, vendor, numeric license, detail and free stock are required", () => {
    expect(evaluateVendorReturnLog(base).ok).toBe(true);
    expect(codes(evaluateVendorReturnLog({ ...base, rmaNumber: " " }))).toContain("rma");
    expect(codes(evaluateVendorReturnLog({ ...base, vendorId: null }))).toContain("vendor");
    expect(codes(evaluateVendorReturnLog({ ...base, processorLicense: "WA-41" }))).toContain("license");
    expect(codes(evaluateVendorReturnLog({ ...base, detail: "" }))).toContain("detail");
    expect(codes(evaluateVendorReturnLog({ ...base, quantity: 6 }))).toContain("qty_free");
  });
  it("a Recalled lot can be returned, only as a recall with the officer and contact date", () => {
    expect(codes(evaluateVendorReturnLog({ ...base, lotStatus: "recalled" }))).toContain("recalled_needs_recall");
    expect(
      evaluateVendorReturnLog({ ...base, lotStatus: "recalled", reason: "recall", recallOfficer: "Ofc. Smith", recallContactDate: "2026-11-01" }).ok,
    ).toBe(true);
    expect(codes(evaluateVendorReturnLog({ ...base, lotStatus: "destroyed" }))).toContain("lot_status");
  });
});

describe("cancel (owner only)", () => {
  it("only the owner holds the permission", () => {
    expect(can("owner", "inventory.vendor_return.cancel")).toBe(true);
    for (const role of ["manager", "inventory", "budtender"] as const) {
      expect(can(role as never, "inventory.vendor_return.cancel")).toBe(false);
    }
  });
  it("refuses a departed, cancelled or pre-1.5 (already reduced) return, and needs a reason", () => {
    const ok = { status: "submitted", canCancel: true, legacyReduced: false, reason: "Vendor withdrew the RMA" };
    expect(evaluateVendorReturnCancel(ok).ok).toBe(true);
    expect(evaluateVendorReturnCancel({ ...ok, canCancel: false }).ok).toBe(false);
    expect(evaluateVendorReturnCancel({ ...ok, status: "picked_up" }).ok).toBe(false);
    expect(evaluateVendorReturnCancel({ ...ok, legacyReduced: true }).ok).toBe(false);
    expect(evaluateVendorReturnCancel({ ...ok, reason: "x" }).ok).toBe(false);
    expect(isLegacyReducedReturn({ reserved_qty: 0, adjustment_id: "adj" })).toBe(true);
    expect(isLegacyReducedReturn({ reserved_qty: 3, adjustment_id: null })).toBe(false);
  });
});

describe("CCRS Other detail", () => {
  it("names the processor, license, manifest and RMA", () => {
    const note = vendorReturnAdjustmentNote({
      processorName: "Acme Farms",
      processorLicense: "412345",
      manifestNumber: "M-9",
      rmaNumber: "RMA-1",
      reason: "defective",
      detail: "seal broken",
    });
    expect(note).toBe("Vendor return to Acme Farms license 412345, manifest M-9, RMA RMA-1, reason defective: seal broken");
  });
});

describe("Manifest.CSV matches the state template's shape", () => {
  const input: ManifestInput = {
    submittedBy: "Michael Lyman",
    submittedAt: new Date("2026-11-02T20:00:00.000Z"),
    externalManifestId: vendorReturnManifestId("0f1e2d3c-aaaa-bbbb-cccc-000000000001"),
    headerOperation: "Insert",
    transportationType: "Pick-up",
    originLicense: "413541",
    originPhone: "3605550100",
    originEmail: "dev@greenwaymarijuana.com",
    transporterLicense: null,
    driverName: "Ann Driver",
    departureIso: "2026-11-04T17:00:00.000Z",
    arrivalIso: "2026-11-04T19:00:00.000Z",
    vin: "1HGCM82633A004352",
    plate: "ABC1234",
    model: "Transit",
    make: "Ford",
    color: "White",
    destinationLicense: "412345",
    destinationPhone: "3605550111",
    destinationEmail: "returns@example.com",
    items: [{ inventoryExternalId: "INV-1", quantity: 2, uom: "Each", weightPerUnit: 1, servingsPerUnit: 1 }],
  };
  const tplRows = TEMPLATE.split("\r\n").filter((r) => r.length > 0);

  it("header attribute names and item columns are the template's, in order", () => {
    const tplHeader = tplRows.slice(0, 21).map((r) => r.split(",")[0]);
    expect([...MANIFEST_HEADER_ATTRIBUTES]).toEqual(tplHeader);
    expect([...MANIFEST_ITEM_COLUMNS]).toEqual(tplRows[21].split(","));
  });

  it("every row has 13 cells, lines end CRLF, and the file ends with CRLF", () => {
    const out = buildManifestCsv(input);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.csv.endsWith("\r\n")).toBe(true);
    expect(out.csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const rows = out.csv.split("\r\n").filter((r) => r.length > 0);
    expect(rows.length).toBe(23);
    for (const r of rows) expect(r.split(",").length).toBe(13);
    expect(rows.slice(0, 21).map((r) => r.split(",")[0])).toEqual(tplRows.slice(0, 21).map((r) => r.split(",")[0]));
    expect(rows[21]).toBe(tplRows[21]);
    const item = rows[22].split(",");
    expect(item[0]).toBe("INV-1");
    expect(item[12]).toBe("Insert");
    expect(item[8]).toBe("Michael Lyman");
  });

  it("refuses a value with a comma or line break, and a missing driver", () => {
    expect(buildManifestCsv({ ...input, driverName: "Driver, Ann" }).ok).toBe(false);
    expect(buildManifestCsv({ ...input, color: "White\nRed" }).ok).toBe(false);
    expect(buildManifestCsv({ ...input, driverName: "" }).ok).toBe(false);
  });

  it("file name follows manifest_<license>_<Pacific timestamp>.csv", () => {
    expect(manifestFileName("413541", new Date("2026-11-02T20:00:00.000Z"))).toMatch(/^manifest_413541_\d{14}\.csv$/);
  });
});

describe("migration 0309", () => {
  it("is idempotent and adds what the app reads", () => {
    expect(MIG).toContain("add column if not exists held_qty");
    expect(MIG).toContain("add column if not exists reserved_qty");
    expect(MIG).toContain("'cancelled'");
    expect(MIG).toContain("create or replace function public.reserve_vendor_return(");
    expect(MIG).toContain("create or replace function public.depart_vendor_return(");
    expect(MIG).toContain("create or replace function public.release_vendor_return(");
    expect(MIG).toContain("notify pgrst, 'reload schema'");
  });
  it("reserve only takes FREE units; depart reduces on-hand and the hold together, with CCRS reason other", () => {
    expect(MIG).toContain("and on_hand_qty - held_qty >= p_qty");
    expect(MIG).toContain("values (r.lot_id, -r.reserved_qty, 'other', p_note, p_actor)");
    expect(MIG).toContain("set on_hand_qty = on_hand_qty - r.reserved_qty,");
    expect(MIG).toContain("held_qty    = held_qty - r.reserved_qty,");
  });
  it("the RPCs are not callable by the browser roles", () => {
    expect(MIG).toMatch(/revoke execute on function public\.reserve_vendor_return\([^)]*\) from public, anon, authenticated;/);
    expect(MIG).toMatch(/revoke execute on function public\.depart_vendor_return\([^)]*\) from public, anon, authenticated;/);
    expect(MIG).toMatch(/revoke execute on function public\.release_vendor_return\([^)]*\) from public, anon, authenticated;/);
  });
});

describe("server wiring", () => {
  it("logging reserves through the RPC and never falls back to reduce-at-logging", () => {
    expect(DISP).toContain("admin.rpc(RESERVE_VENDOR_RETURN_RPC");
    expect(DISP).toContain("VENDOR_RETURN_PENDING_MIGRATION");
    const create = DISP.slice(DISP.indexOf("export async function createVendorReturn("), DISP.indexOf("export async function updateVendorReturnTransport("));
    expect(create).not.toContain("postReduction(");
    expect(create).not.toContain("inventory_adjustments");
  });
  it("departure and cancel go through their RPCs", () => {
    expect(DISP).toContain("DEPART_VENDOR_RETURN_RPC");
    expect(DISP).toContain("RELEASE_VENDOR_RETURN_RPC");
    expect(DISP).toContain("evaluateVendorReturnStep(");
  });
  it("cancel action checks the owner permission and audits refusals", () => {
    expect(ACT).toContain("export async function cancelVendorReturnAction(");
    expect(ACT).toContain('"inventory.vendor_return.cancel"');
    expect(ACT).toContain("action: `${VENDOR_RETURN_CANCEL_AUDIT_ACTION}_refused`");
  });
  it("the page offers Recalled lots for a vendor return and links the Manifest.CSV download", () => {
    expect(PAGE).toContain('listLots({ status: "recalled", limit: 500 })');
    expect(PAGE).toContain("vendor-return-manifest?id=");
    expect(PAGE).toContain("Log return (reserves the units)");
    expect(PAGE).not.toContain("Log return (reduces on-hand)");
  });
  it("the download is gated, checked and audited", () => {
    expect(ROUTE).toContain('requirePermission("inventory.manage")');
    expect(ROUTE).toContain("buildManifestCsv(");
    expect(ROUTE).toContain("vendor_return.manifest_csv");
    expect(ROUTE).toContain("text/csv");
  });
});
