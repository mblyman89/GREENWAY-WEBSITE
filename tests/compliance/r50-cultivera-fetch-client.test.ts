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
function makeRun(opts: { status?: string; finishedAt?: string; batches?: string; inventories?: string } = {}): Files {
  const status = opts.status ?? "done";
  const finishedAt = opts.finishedAt ?? new Date(Date.now() - 10 * 60000).toISOString().replace(/\.\d+Z$/, "Z");
  const data: Files = {
    "export_inventories.xlsx": book([invRow()], INVENTORY_EXPORT_COLUMNS, "Inventories"),
    "export_products.xlsx": book([prodRow()], PRODUCT_EXPORT_COLUMNS, "Products"),
    "inventories.json": Buffer.from(opts.inventories ?? JSON.stringify({ data: [lot], meta: { Count: 1 } })),
  };
  if (opts.batches !== undefined) data["batches.jsonl"] = Buffer.from(opts.batches);
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
    expect(r.files.map((f) => f.name).sort()).toEqual(["export_inventories.xlsx", "export_products.xlsx", "inventories.json"]);
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

  it("an invalid run id never reaches the crawler", async () => {
    const mod = await import("@/lib/pos/cultivera-fetch-client");
    await expect(mod.loadRunForImport("../../etc/passwd")).rejects.toThrow("Invalid run id");
    expect(await mod.getPosRun("x/../y")).toBeNull();
    expect(seen.length).toBe(0);
  });
});
