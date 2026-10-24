/**
 * R50 S11 — the Oct 30 count, end to end on the server side (Cultivera menu upload pipeline:
 * harvest → assemble → import → lots → COUNT).
 *
 * Real workbooks are built by buildCountWorkbook, "scanned" by writing cells with exceljs (as a
 * Tera scanner types into Excel), uploaded through saveCountUpload, and previewed / applied through
 * buildCountPreview / applyCountPlan against an in-memory Supabase (storage + inventory_adjustments)
 * with the lineage read and the atomic quantity write replaced by exact in-memory equivalents.
 *
 * Pins: counted − 10/31 sales = new qty; re-apply is a no-op; a lot changed by anything else is left
 * alone; tampered storage, an unreconciled / wrong-day sales file, a sale after the quantities were
 * read, a copied workbook, and a strict refusal each stop or undo the write with a reason.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

type Lot = { id: string; lot_code: string | null; product_name: string; received_qty: number; on_hand_qty: number; status: string };
const db: { lots: Lot[]; adjustments: { id: string; lot_id: string; qty_delta: number; reason: string; note: string; actor_id: string | null }[]; files: Map<string, Buffer>; refuseLot: string | null } = {
  lots: [],
  adjustments: [],
  files: new Map(),
  refuseLot: null,
};

vi.mock("@/lib/inventory/import-lineage-store", () => ({
  importManifestIds: async () => ["m-1"],
  readLotsOnManifests: async () => db.lots.filter((l) => l.status !== "destroyed").map((l) => ({ ...l })),
}));
// R74 S32: each applied lot's menu size follows the count (lot-menu-stock).
const menuSync: { lotId: string; delta: number }[] = [];
vi.mock("@/lib/inventory/lot-menu-stock", () => ({
  loadMenuVersionsForStock: async () => [{ id: "pub", status: "published" }],
  syncLotMenuStock: async (_a: unknown, lotId: string, delta: number) => {
    menuSync.push({ lotId, delta });
    return { outcomes: [{ status: "published", result: "written" }], sentence: null };
  },
}));
vi.mock("@/lib/inventory/atomic-quantity", () => ({
  applyLotDelta: async (_a: unknown, p: { lotId: string; delta: number; clamp: boolean }) => {
    const lot = db.lots.find((l) => l.id === p.lotId);
    if (!lot || db.refuseLot === p.lotId) return { ok: false, usedFallback: false, newQty: null, error: "refused" };
    const next = lot.on_hand_qty + p.delta;
    if (!p.clamp && next < 0) return { ok: false, usedFallback: false, newQty: null, error: "below zero" };
    lot.on_hand_qty = next;
    lot.status = next === 0 ? "sold_out" : lot.status === "sold_out" ? "active" : lot.status;
    return { ok: true, usedFallback: false, newQty: next };
  },
}));

function fakeAdmin() {
  const storage = {
    from: () => ({
      upload: async (key: string, body: Buffer) => {
        db.files.set(key, Buffer.from(body));
        return { error: null };
      },
      download: async (key: string) => {
        const b = db.files.get(key);
        return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "not found" } };
      },
    }),
  };
  const adjustments = () => {
    const f: { reason?: string; like?: string } = {};
    const q = {
      select: () => q,
      eq: (c: string, v: string) => {
        if (c === "reason") f.reason = v;
        return q;
      },
      like: (_c: string, v: string) => {
        f.like = v.replace(/%$/, "");
        return q;
      },
      order: () => q,
      range: async (from: number, to: number) => ({
        data: db.adjustments.filter((a) => (!f.reason || a.reason === f.reason) && (!f.like || a.note.startsWith(f.like))).slice(from, to + 1),
        error: null,
      }),
      insert: (row: Omit<(typeof db.adjustments)[number], "id">) => ({
        select: () => ({
          single: async () => {
            const id = crypto.randomUUID();
            db.adjustments.push({ id, ...row });
            return { data: { id }, error: null };
          },
        }),
      }),
      delete: () => ({
        eq: async (_c: string, id: string) => {
          db.adjustments = db.adjustments.filter((a) => a.id !== id);
          return { error: null };
        },
      }),
    };
    return q;
  };
  return { storage, from: (t: string) => (t === "inventory_adjustments" ? adjustments() : (() => { throw new Error(`unexpected table ${t}`); })()) } as never;
}

const IMPORT = "0f8fad5b-d9cb-469f-a165-70867728950e";
const RUN = "20261101T063000Z-0123abcd";
const LIST = [
  { barcode: "1111111111111111", productName: "A - Blue Dream - 3.5g", storage: "Sales Floor" },
  { barcode: "0222222222222222", productName: "B - Gummies", storage: "Sales Floor" },
  { barcode: "3333333333333333", productName: "C - Vape", storage: "Sales Floor" },
  { barcode: "4444444444444444", productName: "D - Pre-roll", storage: "Sales Floor" },
  { barcode: "5555555555555555", productName: "E - Tincture", storage: "Sales Floor" },
];

async function scanned(counter: string, scans: string[], hand: [string, number][] = [], workbookId?: string): Promise<Buffer> {
  const { buildCountWorkbook } = await import("@/lib/pos/cultivera-count-workbook");
  const out = await buildCountWorkbook({ counter, countDate: "2026-10-30", lots: LIST, lotsSource: RUN, workbookId });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
  const scan = wb.getWorksheet("Scan")!;
  scans.forEach((c, i) => (scan.getCell(i + 2, 1).value = c));
  const hs = wb.getWorksheet("Hand Count")!;
  hand.forEach(([c, n], i) => {
    hs.getCell(i + 2, 1).value = c;
    hs.getCell(i + 2, 2).value = n;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const sale = (Id: number, Tsid: string, Units: number, CreatedAt: string, ReturnUnits = 0) =>
  JSON.stringify({ Id, Tsid, Units, ReturnUnits, Cost: Units * 3, CreatedAt, OrderStatus: 1, ProductName: "x" });

async function saveSales(lines: string[], summary: Record<string, unknown> = {}, snapshot: string | null = "2026-10-31T22:30:00") {
  const { saveCountSales } = await import("@/lib/pos/cultivera-count-store");
  const body = Buffer.from(lines.map((l) => l + "\n").join(""));
  const sum = Buffer.from(JSON.stringify({ dateFrom: "2026-10-31", dateTo: "2026-10-31", count: lines.length, rows: lines.length, reconciled: true, fetchedAtPacific: "2026-10-31T22:31:00", ...summary }));
  return saveCountSales(fakeAdmin(), IMPORT, RUN, { lines: body, summary: sum, problem: null, files: [] }, snapshot);
}

function seedLots() {
  db.lots = [
    { id: "L1", lot_code: "1111111111111111", product_name: "A", received_qty: 10, on_hand_qty: 10, status: "active" },
    { id: "L2", lot_code: "0222222222222222", product_name: "B", received_qty: 4, on_hand_qty: 4, status: "active" },
    { id: "L3", lot_code: "3333333333333333", product_name: "C", received_qty: 2, on_hand_qty: 2, status: "active" },
    { id: "L4", lot_code: "4444444444444444", product_name: "D", received_qty: 5, on_hand_qty: 5, status: "active" },
    { id: "L5", lot_code: "5555555555555555", product_name: "E", received_qty: 0, on_hand_qty: 0, status: "sold_out" },
  ];
}

beforeEach(() => {
  db.adjustments = [];
  db.files = new Map();
  db.refuseLot = null;
  seedLots();
});

async function upload(books: { name: string; buffer: Buffer }[]) {
  const { saveCountUpload } = await import("@/lib/pos/cultivera-count-store");
  return saveCountUpload(fakeAdmin(), IMPORT, books, "staff-1");
}

describe("R50 S11: the Oct 30 count end to end", () => {
  it("counted − 10/31 sales = new qty, per barcode across counters; applying twice changes nothing", { timeout: 60_000 }, async () => {
    const { buildCountPreview, applyCountPlan } = await import("@/lib/pos/cultivera-count-store");
    // Back stock (counter 1) + floor (counter 2). L1: 6+3 = 9 counted; L2 leading zero, 3 counted;
    // L3 hand-counted 2; L4 not scanned (leave policy); one unknown barcode.
    const b1 = await scanned("Back stock", ["1111111111111111", "1111111111111111", "1111111111111111", "1111111111111111", "1111111111111111", "1111111111111111", "0222222222222222"]);
    const b2 = await scanned("Floor", ["1111111111111111", "1111111111111111", "1111111111111111", "0222222222222222", "0222222222222222", "9999999999999999"], [["3333333333333333", 2]]);
    // 10/31 sales: L1 sold 2 then 1 returned (net 1); L2 sold 1. A 10/30 line is ignored.
    await saveSales([sale(1, "1111111111111111", 2, "2026-10-31T11:00:00Z"), sale(2, "1111111111111111", 0, "2026-10-31T12:00:00Z", 1), sale(3, "0222222222222222", 1, "2026-10-31T13:00:00Z"), sale(4, "3333333333333333", 1, "2026-10-30T17:59:00Z")]);
    const up = await upload([{ name: "back.xlsx", buffer: b1 }, { name: "floor.xlsx", buffer: b2 }]);
    const p = await buildCountPreview(fakeAdmin(), IMPORT, up.batchId, "leave");
    expect(p.refusals).toEqual([]);
    expect(p.problems).toEqual([]);
    expect(p.countDate).toBe("2026-10-30");
    expect(p.salesDay).toBe("2026-10-31");
    const line = (code: string) => p.plan!.lines.find((l) => l.lotCode === code)!;
    expect(line("1111111111111111")).toMatchObject({ counted: 9, netSold: 1, rolled: 8, onHand: 10, delta: -2, adjust: true });
    expect(line("1111111111111111").byCounter).toEqual({ "Back stock": 6, Floor: 3 });
    expect(line("0222222222222222")).toMatchObject({ counted: 3, netSold: 1, rolled: 2, delta: -2, adjust: true });
    expect(line("3333333333333333")).toMatchObject({ counted: 2, netSold: 0, rolled: 2, delta: 0, adjust: false });
    expect(line("4444444444444444")).toMatchObject({ exception: "uncounted", adjust: false });
    expect(line("9999999999999999")).toMatchObject({ exception: "unknown_barcode", counted: 1 });
    expect(p.plan!.summary).toMatchObject({ adjustedLots: 2, unitsDown: 4, unitsUp: 0, uncountedLots: 1, uncountedUnits: 5, unknownBarcodes: 1, countedUnits: 15 });
    expect(p.canApply).toBe(true);

    const out = await applyCountPlan(fakeAdmin(), IMPORT, p.plan!, "staff-1");
    expect(out).toEqual({ applied: 2, unitsUp: 0, unitsDown: 4, failed: [], menuStockProblems: [] });
    // R74 S32: the menu moved by exactly the lots' deltas (Leafly + website follow the count).
    expect(menuSync.reduce((s, m) => s + m.delta, 0)).toBe(-4);
    expect(menuSync.length).toBe(2);
    expect(db.lots.find((l) => l.id === "L1")!.on_hand_qty).toBe(8);
    expect(db.lots.find((l) => l.id === "L2")!.on_hand_qty).toBe(2);
    expect(db.lots.find((l) => l.id === "L4")!.on_hand_qty).toBe(5);
    expect(db.adjustments.every((a) => a.reason === "count" && a.note.startsWith(`R50 Oct-30 count ${IMPORT}: barcode `) && a.actor_id === "staff-1")).toBe(true);
    expect(db.adjustments.find((a) => a.lot_id === "L1")!.note).toContain("counted 9, Cultivera sold 1 after the count, Cultivera on hand 10");

    const again = await buildCountPreview(fakeAdmin(), IMPORT, up.batchId, "leave");
    expect(again.plan!.adjustments).toEqual([]);
    expect(again.canApply).toBe(false);
    expect(again.plan!.lines.find((l) => l.lotCode === "1111111111111111")).toMatchObject({ priorCountDelta: -2, exception: null });

    // The zero policy (owner confirms wall-to-wall) moves the unscanned lot to 0 and nothing else.
    const z = await buildCountPreview(fakeAdmin(), IMPORT, up.batchId, "zero");
    expect(z.plan!.adjustments.map((a) => [a.lotId, a.delta])).toEqual([["L4", -5]]);
  });

  it("a lot changed by something else since the import is left alone", { timeout: 60_000 }, async () => {
    const { buildCountPreview } = await import("@/lib/pos/cultivera-count-store");
    db.lots.find((l) => l.id === "L1")!.on_hand_qty = 9; // a sale in the new POS, a disposition…
    await saveSales([]);
    const up = await upload([{ name: "a.xlsx", buffer: await scanned("A", ["1111111111111111"]) }]);
    const p = await buildCountPreview(fakeAdmin(), IMPORT, up.batchId, "leave");
    expect(p.plan!.lines.find((l) => l.lotCode === "1111111111111111")!.exception).toBe("moved_since_import");
    expect(p.plan!.adjustments.some((a) => a.lotId === "L1")).toBe(false);
  });

  it("refuses: unreconciled sales, wrong sales day, a sale after the snapshot, a later-day sale, no snapshot", { timeout: 60_000 }, async () => {
    const { buildCountPreview } = await import("@/lib/pos/cultivera-count-store");
    const up = await upload([{ name: "a.xlsx", buffer: await scanned("A", ["1111111111111111"]) }]);
    const check = async () => buildCountPreview(fakeAdmin(), IMPORT, up.batchId, "leave");

    await saveSales([], { reconciled: false });
    expect((await check()).canApply).toBe(false);
    expect((await check()).refusals.join(" ")).toContain("reconciled is not true");

    await saveSales([], { dateFrom: "2026-11-01" });
    expect((await check()).refusals.join(" ")).toContain("not from the sales day 2026-10-31");

    await saveSales([sale(9, "1111111111111111", 1, "2026-10-31T22:45:00Z")]);
    const snap = await check();
    expect(snap.plan!.blocked).toBe(true);
    expect(snap.canApply).toBe(false);

    await saveSales([sale(10, "1111111111111111", 1, "2026-11-01T09:00:00Z")], { dateTo: "2026-11-01" });
    expect((await check()).plan!.blocked).toBe(true);

    await saveSales([], {}, null);
    expect((await check()).refusals.join(" ")).toContain("no stage start times");
  });

  it("refuses: tampered stored workbook or sales file; a copied workbook; another import's upload", { timeout: 60_000 }, async () => {
    const { buildCountPreview, loadCountUpload } = await import("@/lib/pos/cultivera-count-store");
    await saveSales([]);
    const wid = crypto.randomUUID();
    const one = await scanned("A", ["1111111111111111"], [], wid);
    const copy = await scanned("A copy", ["0222222222222222"], [], wid);
    const up = await upload([{ name: "a.xlsx", buffer: one }, { name: "copy.xlsx", buffer: copy }]);
    const p = await buildCountPreview(fakeAdmin(), IMPORT, up.batchId, "leave");
    expect(p.problems.map((x) => x.code)).toContain("duplicate_workbook");
    expect(p.plan!.blocked).toBe(true);
    expect(p.canApply).toBe(false);

    const key = up.files[0].key;
    const b = Buffer.from(db.files.get(key)!);
    b[b.length - 1] ^= 0xff;
    db.files.set(key, b);
    await expect(loadCountUpload(fakeAdmin(), IMPORT, up.batchId)).rejects.toThrow("no longer matches its checksum");

    await expect(loadCountUpload(fakeAdmin(), "1f8fad5b-d9cb-469f-a165-70867728950e", up.batchId)).rejects.toThrow("not found");

    const up2 = await upload([{ name: "a.xlsx", buffer: one }]);
    const sk = `count/${IMPORT}/sales.jsonl`;
    db.files.set(sk, Buffer.from('{"Id":1}\n'));
    const p2 = await buildCountPreview(fakeAdmin(), IMPORT, up2.batchId, "leave");
    expect(p2.refusals.join(" ")).toContain("sales.jsonl no longer matches its checksum");
    expect(p2.canApply).toBe(false);
  });

  it("a strict refusal removes the ledger row and is reported; the rest still apply", { timeout: 60_000 }, async () => {
    const { buildCountPreview, applyCountPlan } = await import("@/lib/pos/cultivera-count-store");
    await saveSales([]);
    const up = await upload([{ name: "a.xlsx", buffer: await scanned("A", ["1111111111111111", "0222222222222222"]) }]);
    const p = await buildCountPreview(fakeAdmin(), IMPORT, up.batchId, "leave");
    db.refuseLot = "L1";
    const out = await applyCountPlan(fakeAdmin(), IMPORT, p.plan!, null);
    expect(out.applied).toBe(1);
    expect(out.failed).toEqual([{ lotId: "L1", lotCode: "1111111111111111", error: "refused" }]);
    expect(db.adjustments.map((a) => a.lot_id)).toEqual(["L2"]);
    expect(db.lots.find((l) => l.id === "L1")!.on_hand_qty).toBe(10);
    // The refused lot shows up as still to adjust.
    db.refuseLot = null;
    const p2 = await buildCountPreview(fakeAdmin(), IMPORT, up.batchId, "leave");
    expect(p2.plan!.adjustments.map((a) => a.lotId)).toEqual(["L1"]);
  });

  it("a blocked plan is never written, even if passed in directly", async () => {
    const { applyCountPlan } = await import("@/lib/pos/cultivera-count-store");
    await expect(applyCountPlan(fakeAdmin(), IMPORT, { lines: [], adjustments: [{ lotId: "L1", lotCode: "x", delta: -1, onHand: 10, rolled: 9, counted: 9, netSold: 0 }], summary: {} as never, blocked: true }, null)).rejects.toThrow("blocked");
    expect(db.adjustments).toEqual([]);
  });

  it("digest changes when what would be written changes", async () => {
    const { countPlanDigest } = await import("@/lib/pos/cultivera-count-store");
    const base = { lines: [], summary: {} as never, blocked: false };
    const a = countPlanDigest({ ...base, adjustments: [{ lotId: "L1", lotCode: "x", delta: -1, onHand: 10, rolled: 9, counted: 9, netSold: 0 }] });
    const one = (o: Partial<{ lotId: string; delta: number; onHand: number; counted: number; netSold: number }>) =>
      countPlanDigest({ ...base, adjustments: [{ lotId: "L1", lotCode: "x", delta: -1, onHand: 10, rolled: 9, counted: 9, netSold: 0, ...o }] });
    expect(one({})).toBe(a);
    for (const o of [{ lotId: "L2" }, { delta: -2 }, { onHand: 11 }, { counted: 8 }, { netSold: 1 }]) expect(one(o), JSON.stringify(o)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
