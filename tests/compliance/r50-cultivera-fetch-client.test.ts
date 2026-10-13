/**
 * R50 S9 — the site side of the button, end to end against a fake crawler.
 * global fetch is replaced by a tiny in-memory crawler that serves a run's
 * files with a manifest computed exactly like crawler/app/cultivera_pos.py
 * (name, bytes, sha256). Proves: verified files assemble to GO; one changed
 * byte, a wrong size, a run that is not done, a torn batches line, or a bad
 * inventories.json each block the import with a reason (never a silent pass).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { INVENTORY_EXPORT_COLUMNS, PRODUCT_EXPORT_COLUMNS, type SheetRow } from "@/lib/pos/cultivera-fetch-core";
import { importDecision } from "@/lib/pos/cultivera-fetch-button-core";

vi.mock("server-only", () => ({}));
process.env.CRAWLER_BASE_URL = "http://crawler.test";
process.env.CRAWLER_SHARED_SECRET = "s3cret";

const RID = "20261101T130000Z-0123abcd";

function book(rows: SheetRow[], cols: readonly string[], sheet: string): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...cols] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
const NAME = "Alpha Farms - Blue Dream - 3.5g";
function invRow(): SheetRow {
  const r: SheetRow = {};
  for (const c of INVENTORY_EXPORT_COLUMNS) r[c] = "";
  return { ...r, Id: 1000, Location: "GREENWAY MARIJUANA", Barcode: "90000000000000000", Product: NAME, Category: "Flower",
    InventoryType: "Usable Marijuana", Brand: "Alpha Farms", Vendor: "ACME LLC", "Product Price": 20, Cost: 5,
    "Units Available For Sale": 4, "Units In Stock": 4, "Package Size": "3.50 Gram", "Storage Location": "Sales Floor",
    "Is Medical": "False", "Is Cannabis": "True", "Is Sample": "False", "Units On Hold": 0, "Received date": "2026-10-05 10:30:00.000000" };
}
function prodRow(): SheetRow {
  return { "Product Name": NAME, "Inventory Type": "Usable Marijuana", Category: "Flower", Brand: "Alpha Farms", Type: "", Strain: "",
    UOM: "Gram", "Package Size": 3.5, "Price Model Y/N": "N", "Price Model Name": "", Price: 20, "Vendor Price Model Y/N": "N",
    "Vendor Price Model Name": "", "Vendor Price": "", "Cannabis Y/N": "Y", "Pre Packed/Bulk": "Pre Packed", "Tax Exempt Y/N": "N",
    "Vendor Only Y/N": "N", "Image Attached Y/N": "N" };
}
const lot = { Id: 1000, Barcode: "90000000000000000", ProductName: NAME, VendorName: "ACME LLC", Location: "GREENWAY MARIJUANA",
  StorageName: "Sales Floor", UnitsAvailable: 4, UnitsInStock: 4, UnitsOnHold: 0, UnitCost: 5, BatchId: 77, IncomingTransferId: 5 };

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

type Files = Record<string, Buffer>;
const TRANSFER_5 = { Id: 5, TransferNumber: "M-5", FromVendor: "ACME LLC", VendorNo: "601", TransferDate: "2026-10-04T15:00:00Z",
  DateAccepted: "2026-10-05T17:31:00Z", StatusDisplay: "Accepted", Details: [{ Barcode: "90000000000000000", AcceptedQuantity: 4, Quantity: 4, IsSample: false }] };
const DETAILS = JSON.stringify(TRANSFER_5) + "\n";

function makeRun(opts: { status?: string; finishedAt?: string; batches?: string; inventories?: string; details?: string | null; sales?: string; salesSummary?: string } = {}): Files {
  const status = opts.status ?? "done";
  const finishedAt = opts.finishedAt ?? new Date(Date.now() - 10 * 60000).toISOString().replace(/\.\d+Z$/, "Z");
  const data: Files = {
    "export_inventories.xlsx": book([invRow()], INVENTORY_EXPORT_COLUMNS, "Inventories"),
    "export_products.xlsx": book([prodRow()], PRODUCT_EXPORT_COLUMNS, "Products"),
    "inventories.json": Buffer.from(opts.inventories ?? JSON.stringify({ data: [lot], meta: { Count: 1 } })),
  };
  if (opts.batches !== undefined) data["batches.jsonl"] = Buffer.from(opts.batches);
  if (opts.details !== null) data["transfer_details.jsonl"] = Buffer.from(opts.details ?? DETAILS);
  if (opts.sales !== undefined) data["sales.jsonl"] = Buffer.from(opts.sales);
  if (opts.salesSummary !== undefined) data["sales_summary.json"] = Buffer.from(opts.salesSummary);
  const state = { status, finishedAt, seconds: 478.3, withinBudget: true, stages: {} };
  const manifest = { kind: "cultivera_pos_phase_a", status, finishedAt,
    files: Object.entries(data).sort().map(([name, b]) => ({ name, bytes: b.length, sha256: sha(b) })) };
  return { ...data, "state.json": Buffer.from(JSON.stringify(state)), "manifest.json": Buffer.from(JSON.stringify(manifest)) };
}

let served: Files = {};
const seen: { url: string; secret: string | null }[] = [];

beforeEach(() => {
  seen.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    seen.push({ url, secret: h.get("X-Crawler-Secret") });
    const m = url.match(/\/cultivera-pos\/runs\/([^/]+)\/files\/(.+)$/);
    if (m && m[1] === RID && served[decodeURIComponent(m[2])]) return new Response(new Uint8Array(served[decodeURIComponent(m[2])]), { status: 200 });
    return new Response(JSON.stringify({ detail: "No such file in this run." }), { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function load() {
  const mod = await import("@/lib/pos/cultivera-fetch-client");
  return mod.loadRunForImport(RID);
}

describe("R50 S9: loadRunForImport against a fake crawler", () => {
  it("verified files assemble to GO, every call carries the secret, sha recorded", async () => {
    served = makeRun();
    const r = await load();
    expect(r.verifyProblems).toEqual([]);
    expect(r.verified).toBe(true);
    expect(r.assembled?.report.go).toBe(true);
    expect(r.assembled?.report.reconcile.unitsRows).toBe(4);
    expect(r.files.map((f) => f.name).sort()).toEqual(["export_inventories.xlsx", "export_products.xlsx", "inventories.json", "transfer_details.jsonl"]);
    // R50 S10: the manifest plan ran on the served transfer and joined the go/no-go.
    const mp = r.assembled?.report.manifestPlan;
    expect(mp?.summary.matched).toBe(1);
    expect(mp?.summary.link).toEqual({ agree: 1, differ: 0, none: 0, unmatchedLinked: 0 });
    expect(mp?.biggest[0]).toMatchObject({ transferId: 5, manifestNumber: "M-5", lots: 1 });
    expect(r.assembled?.report.checks.find((c) => c.id === "manifest_plan")?.pass).toBe(true);
    expect(r.files.every((f) => f.sha256 === sha(served[f.name]))).toBe(true);
    expect(seen.every((s) => s.secret === "s3cret" && s.url.startsWith("http://crawler.test/cultivera-pos/runs/"))).toBe(true);
    expect(r.ageMinutes).toBeGreaterThan(9);
    expect(importDecision({ isTest: false, go: true, cutoverDone: false, ageMinutes: r.ageMinutes, filesVerified: r.verified }).allowed).toBe(true);
  });

  it("one changed byte in a served file → not verified, not assembled", async () => {
    served = makeRun();
    const b = Buffer.from(served["export_products.xlsx"]);
    b[b.length - 1] ^= 0xff;
    served["export_products.xlsx"] = b;
    const r = await load();
    expect(r.verified).toBe(false);
    expect(r.assembled).toBeNull();
    expect(r.verifyProblems.join(" ")).toContain("export_products.xlsx: checksum differs");
    expect(importDecision({ isTest: true, go: false, cutoverDone: false, ageMinutes: 1, filesVerified: r.verified }).allowed).toBe(false);
  });

  it("a truncated file → byte count reason", async () => {
    served = makeRun();
    served["inventories.json"] = served["inventories.json"].subarray(0, 10);
    const r = await load();
    expect(r.verifyProblems.join(" ")).toContain("inventories.json: 10 bytes downloaded");
    expect(r.assembled).toBeNull();
  });

  it("a run that is not done is refused even if files verify", async () => {
    served = makeRun({ status: "failed" });
    const r = await load();
    expect(r.verified).toBe(false);
    expect(r.verifyProblems.join(" ")).toContain('"failed", not done');
  });

  it("batches.jsonl listed in the manifest is fetched; a torn line is reported", async () => {
    served = makeRun({ batches: '{"Id":77,"ReceivedDate":"2026-10-05T17:30:00Z"}\n{"Id":78,' });
    const r = await load();
    expect(r.files.map((f) => f.name)).toContain("batches.jsonl");
    expect(r.verifyProblems).toEqual(["batches.jsonl has 1 unreadable lines."]);
    expect(r.assembled).toBeNull();
  });

  it("inventories.json without a data array is refused", async () => {
    served = makeRun({ inventories: JSON.stringify({ rows: [] }) });
    const r = await load();
    expect(r.verifyProblems).toEqual(["inventories.json has no data array."]);
  });

  it("a stale harvest is verified but a real import is refused (test still allowed)", async () => {
    served = makeRun({ finishedAt: new Date(Date.now() - 3 * 3600000).toISOString() });
    const r = await load();
    expect(r.verified).toBe(true);
    const real = importDecision({ isTest: false, go: Boolean(r.assembled?.report.go), cutoverDone: false, ageMinutes: r.ageMinutes, filesVerified: r.verified });
    expect(real.allowed).toBe(false);
    expect(real.reasons.join(" ")).toContain("minutes old");
    expect(importDecision({ isTest: true, go: true, cutoverDone: false, ageMinutes: r.ageMinutes, filesVerified: r.verified }).allowed).toBe(true);
  });

  it("R50 S10: lots that link transfers but no transfer_details.jsonl → refused with a reason", async () => {
    served = makeRun({ details: null });
    const r = await load();
    expect(r.verified).toBe(false);
    expect(r.assembled).toBeNull();
    expect(r.verifyProblems).toEqual(["Lots link to Cultivera transfers but the run has no transfer_details.jsonl."]);
  });

  it("R50 S10: a torn transfer_details line is reported", async () => {
    served = makeRun({ details: DETAILS + '{"Id":6,' });
    const r = await load();
    expect(r.verifyProblems).toEqual(["transfer_details.jsonl has 1 unreadable lines."]);
    expect(r.assembled).toBeNull();
  });

  it("R50 S10: Cultivera links the lot to a transfer that does not carry it → NO-GO on manifest_plan", async () => {
    const other = { ...TRANSFER_5, Details: [{ Barcode: "OTHER", AcceptedQuantity: 1, Quantity: 1 }] };
    served = makeRun({ details: JSON.stringify(other) + "\n" });
    const r = await load();
    expect(r.verified).toBe(true);
    const check = r.assembled?.report.checks.find((c) => c.id === "manifest_plan");
    expect(check?.pass).toBe(false);
    expect(check?.detail).toContain("1 lots Cultivera linked to a transfer were not placed on one");
    expect(r.assembled?.report.go).toBe(false);
  });

  it("R50 S10: lots with no links and no details → no plan, no extra check (the old path still works)", async () => {
    served = makeRun({ details: null, inventories: JSON.stringify({ data: [{ ...lot, IncomingTransferId: null }] }) });
    const r = await load();
    expect(r.verifyProblems).toEqual([]);
    expect(r.assembled?.report.manifestPlan).toBeNull();
    expect(r.assembled?.report.checks.some((c) => c.id === "manifest_plan")).toBe(false);
    expect(r.assembled?.report.go).toBe(true);
  });

  it("R50 S11: sales files listed → fetched, verified, raw bytes kept; never part of the import gate", async () => {
    const sales = '{"Id":1,"Tsid":"90000000000000000","Units":1}\n';
    const summary = JSON.stringify({ dateFrom: "2026-10-31", rows: 1, reconciled: true });
    served = makeRun({ sales, salesSummary: summary });
    const r = await load();
    expect(r.verified).toBe(true);
    expect(r.sales.problem).toBeNull();
    expect(r.sales.lines?.toString()).toBe(sales);
    expect(r.sales.summary?.toString()).toBe(summary);
    expect(r.sales.files.map((f) => f.name)).toEqual(["sales.jsonl", "sales_summary.json"]);
    expect(r.files.map((f) => f.name)).not.toContain("sales.jsonl");
  });

  it("R50 S11: a changed sales byte → sales refused with the reason, the import still verifies", async () => {
    served = makeRun({ sales: '{"Id":1}\n', salesSummary: "{}" });
    served["sales.jsonl"] = Buffer.from('{"Id":2}\n');
    const r = await load();
    expect(r.verified).toBe(true);
    expect(r.sales.lines).toBeNull();
    expect(r.sales.problem).toContain("sales.jsonl: checksum differs");
  });

  it("R50 S11: one sales file without its partner → refused; no sales files → nothing, no problem", async () => {
    served = makeRun({ sales: '{"Id":1}\n' });
    const r = await load();
    expect(r.sales.lines).toBeNull();
    expect(r.sales.problem).toContain("without its partner");
    served = makeRun();
    const r2 = await load();
    expect(r2.sales).toEqual({ lines: null, summary: null, problem: null, files: [] });
  });

  it("R50 S11: loadRunLotList returns the verified list; a changed byte or an unfinished run throws", async () => {
    const mod = await import("@/lib/pos/cultivera-fetch-client");
    served = makeRun();
    const ok = await mod.loadRunLotList(RID);
    expect(ok.lots.map((l) => l.Barcode)).toEqual(["90000000000000000"]);
    expect(ok.sha256).toBe(sha(served["inventories.json"]));
    const b = Buffer.from(served["inventories.json"]);
    b[b.length - 2] ^= 0x01;
    served["inventories.json"] = b;
    await expect(mod.loadRunLotList(RID)).rejects.toThrow("checksum differs");
    served = makeRun({ status: "failed" });
    await expect(mod.loadRunLotList(RID)).rejects.toThrow("not done");
    served = makeRun({ inventories: JSON.stringify({ data: [] }) });
    await expect(mod.loadRunLotList(RID)).rejects.toThrow("no lots");
  });

  it("an invalid run id never reaches the crawler", async () => {
    const mod = await import("@/lib/pos/cultivera-fetch-client");
    await expect(mod.loadRunForImport("../../etc/passwd")).rejects.toThrow("Invalid run id");
    expect(await mod.getPosRun("x/../y")).toBeNull();
    expect(seen.length).toBe(0);
  });
});

describe("R50 S11: startPosRun sends the sales day only when given", () => {
  const bodies: unknown[] = [];
  beforeEach(() => {
    bodies.length = 0;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "null")));
      return new Response(JSON.stringify({ runId: RID, resumed: false }), { status: 202 });
    });
  });
  it("fresh only / fresh + salesFrom / bad date never sent", async () => {
    const mod = await import("@/lib/pos/cultivera-fetch-client");
    await mod.startPosRun(true);
    await mod.startPosRun(false, "2026-10-31");
    await expect(mod.startPosRun(true, "10/31/2026")).rejects.toThrow("YYYY-MM-DD");
    expect(bodies).toEqual([{ fresh: true }, { fresh: false, salesFrom: "2026-10-31" }]);
  });
});
