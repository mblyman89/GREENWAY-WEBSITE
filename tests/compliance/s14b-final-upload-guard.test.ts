/**
 * S-14b (CCRS Bible Part 17 §E.6, Part 09 S-14b): the owner's real cutover
 * timeline, made safe for the equalize waves.
 *
 * The owner's plan (2026-10-20): full audit Fri 10/30 (every lot scanned),
 * last Cultivera sale Sat 10/31, Cultivera's final upload Sun 11/01, our store
 * opens and sells Sun 11/01 from the imported lots. He asked whether the
 * cleanup ("zero out the garbage") can run after the migration, from a copy
 * of CCRS data he might get before 11/01.
 *
 * These tests pin three guards so that a wave can never zero stock we hold:
 *   1. FINAL-UPLOAD GUARD. A wave is refused when the copy is not strictly
 *      after Cultivera's final upload day. Cultivera's final files (the
 *      10/25-10/31 week, uploaded 11/01, D-21) change quantities and can
 *      create lots after any earlier copy; a wave built from that copy would
 *      zero lots by stale numbers. Sales alone cannot prove which lots the
 *      final files touched (they also carry adjustments, transfers and
 *      receipts), so there is NO override: get a copy dated after the upload.
 *   2. COUNTED-ON-SHELF HOLD. Every barcode scanned in the 10/30 audit is
 *      held out of every wave (H_COUNTED_ON_SHELF) unless it is already one
 *      of our lots by exact id. The import skips zero-unit lots, so a lot on
 *      the shelf that Cultivera shows at 0 has no lot in our system; without
 *      this hold a wave could zero it. Matching ignores letter case (the
 *      count matches barcodes case-insensitively too).
 *   3. LIVE SNAPSHOT. When our lots are read live from the database, the
 *      snapshot date must be today (Pacific): that read IS the snapshot.
 *   4. The audit's barcodes come straight out of the counters' workbooks
 *      (count-barcodes.ts), byte for byte as scanned, one per line.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  DEFAULT_EQUALIZE_POLICY,
  EQUALIZE_HOLD_CODES,
  EQUALIZE_HOLD_MEANING,
  EqualizeError,
  equalizeReport,
  parseCountedList,
  planEqualizeWave,
  type EqualizeInput,
  type OurLot,
} from "@/lib/compliance/ccrs-equalize-core";
import { SEED_HEADERS, SEED_SOURCE, buildLedgerSeed, type SeedEntity } from "@/lib/compliance/ccrs-ledger-seed-core";
import type { LedgerRow } from "@/lib/compliance/ccrs-reseed-core";
import { COUNT_WORKBOOK_SPEC } from "@/lib/pos/cultivera-count-core";
import { liveSnapshotRefusal, main } from "../../scripts/compliance/equalize-ccrs-wave";
import { countedBarcodes, main as countMain } from "../../scripts/compliance/count-barcodes";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/* ----------------------------- fixtures ----------------------------- */
const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
const invRow = (id: string, over: Record<string, string> = {}): string[] => {
  const base: Record<string, string> = {
    "License Number": "413541", Strain: "Blue Dream", "Inventory Type": "Usable Cannabis", Name: "Blue Dream 1g", "Product Identifier": "P-1",
    "Product Name": "desc", IsMedical: "FALSE", "InventoryIdentifier (ExternalIdentifier on inventory.csv)": id, "Initial Quantity": "10",
    "Quantity on Hand": "4", TotalCost: "25.00", CreatedBy: "Cultivera", CreatedDate: "8/30/2024", Updatedby: "", UpdatedDate: "",
  };
  return SEED_HEADERS.Inventory.map((h) => over[h] ?? base[h]);
};
const prodRow = (id: string, name: string) => ["Usable Cannabis", name, "desc", "1", id, "C", "09/01/2026", "", "", ""];
const texts = (inv: string[][]) => ({
  Inventory: csv([[...SEED_HEADERS.Inventory], ...inv]),
  Product: csv([[...SEED_HEADERS.Product], prodRow("P-1", "Blue Dream 1g")]),
  Strain: csv([[...SEED_HEADERS.Strain], ["Hybrid", "Blue Dream", "C", "09/01/2026", "", ""]]),
  Area: csv([[...SEED_HEADERS.Area], ["Sales Floor", "FALSE", "C1100011", "C", "08/22/2024", "", ""]]),
});
const ledgerFrom = (copy: readonly SeedEntity[]): LedgerRow[] =>
  copy.map((e) => ({
    t: e.fileType, id: e.externalId, name: e.filedName, prod: e.productExternalId, state: e.state, source: SEED_SOURCE,
    lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1789898400000000", payload: e.seedPayload,
  }));
const input = (inv: string[][], o: Partial<EqualizeInput> = {}): EqualizeInput => {
  const copy = buildLedgerSeed(texts(inv)).entities;
  return {
    copy, ledger: ledgerFrom(copy), ours: [], copyAsOf: "2026-11-06", snapshotDate: "2026-11-15", waveDate: "2026-11-15", wave: "W1",
    finalUploadDate: "2026-11-01", countedBarcodes: [],
    licenseNumber: "413541", submittedBy: "Greenway Marijuana", policy: { ...DEFAULT_EQUALIZE_POLICY }, ...o,
  };
};
const our = (o: Partial<OurLot>): OurLot => ({ externalId: null, lotCode: null, posProductKey: null, destroyed: false, ...o });
const holdOf = (p: ReturnType<typeof planEqualizeWave>, id: string) => p.holds.find((h) => h.id === id)?.code ?? null;
const refused = (f: () => unknown, re: RegExp) => {
  try { f(); return "no error"; } catch (e) { return e instanceof EqualizeError && re.test(e.message) ? "ok" : `wrong error: ${(e as Error).message}`; }
};

/* ------------------------- 1. final-upload guard ------------------------- */
describe("S-14b final-upload guard: a copy must be dated AFTER Cultivera's final upload", () => {
  it("a copy pulled before the final upload (e.g. requested 10/26, the owner's 'before the 1st' copy) is refused", () => {
    expect(refused(() => planEqualizeWave(input([invRow("A")], { copyAsOf: "2026-10-29" })), /before or on Cultivera's final upload day \(2026-11-01\)/)).toBe("ok");
  });
  it("a copy dated ON the final upload day is refused too: we cannot tell whether that day's upload landed before the copy was pulled", () => {
    expect(refused(() => planEqualizeWave(input([invRow("A")], { copyAsOf: "2026-11-01" })), /before or on Cultivera's final upload day/)).toBe("ok");
  });
  it("a copy dated the day after the final upload plans normally", () => {
    const p = planEqualizeWave(input([invRow("A")], { copyAsOf: "2026-11-02", snapshotDate: "2026-11-02", waveDate: "2026-11-02" }));
    expect(p.lots.map((l) => l.id)).toEqual(["A"]);
    expect(p.finalUploadDate).toBe("2026-11-01");
  });
  it("the final upload day is required and must be a real date (never assumed)", () => {
    expect(refused(() => planEqualizeWave(input([invRow("A")], { finalUploadDate: "" })), /final upload day must be a real date/)).toBe("ok");
    expect(refused(() => planEqualizeWave(input([invRow("A")], { finalUploadDate: "2026-11-31" })), /final upload day must be a real date/)).toBe("ok");
    expect(refused(() => planEqualizeWave(input([invRow("A")], { finalUploadDate: undefined as unknown as string })), /final upload day must be a real date/)).toBe("ok");
  });
  it("the refusal tells the owner what to do next, in plain words", () => {
    try { planEqualizeWave(input([invRow("A")], { copyAsOf: "2026-10-29" })); } catch (e) {
      expect((e as Error).message).toMatch(/Request a new copy from the examiner/);
    }
  });
  it("the report states the final upload day the wave was checked against", () => {
    const md = equalizeReport(planEqualizeWave(input([invRow("A")])));
    expect(md).toContain("Cultivera's final upload 2026-11-01");
  });
});

/* ----------------------- 2. counted-on-shelf hold ----------------------- */
describe("S-14b counted-on-shelf hold: a lot scanned in the 10/30 audit is never zeroed", () => {
  it("a scanned barcode that is not one of our lots is held H_COUNTED_ON_SHELF", () => {
    const p = planEqualizeWave(input([invRow("ZERO-IN-CULTIVERA"), invRow("STALE")], { countedBarcodes: ["ZERO-IN-CULTIVERA"] }));
    expect(holdOf(p, "ZERO-IN-CULTIVERA")).toBe("H_COUNTED_ON_SHELF");
    expect(p.lots.map((l) => l.id)).toEqual(["STALE"]);
    expect(p.counts.held.H_COUNTED_ON_SHELF).toBe(1);
  });
  it("matching ignores letter case and surrounding spaces, like the count itself", () => {
    const p = planEqualizeWave(input([invRow("Abc123")], { countedBarcodes: ["  aBC123 "] }));
    expect(holdOf(p, "Abc123")).toBe("H_COUNTED_ON_SHELF");
  });
  it("one of our lots by exact id stays 'ours' (skipped), not a hold, even if it was scanned", () => {
    const p = planEqualizeWave(input([invRow("OURS")], { ours: [our({ externalId: "OURS" })], countedBarcodes: ["OURS"] }));
    expect(p.counts.ours).toBe(1);
    expect(p.holds).toEqual([]);
  });
  it("a destroyed lot of ours that was scanned is still held as destroyed (that rule comes first)", () => {
    const p = planEqualizeWave(input([invRow("D")], { ours: [our({ externalId: "D", destroyed: true })], countedBarcodes: ["D"] }));
    expect(holdOf(p, "D")).toBe("H_OURS_DESTROYED");
  });
  it("a lot already at 0 in CCRS is counted as already zero, whatever the scan says (nothing would be sent)", () => {
    const p = planEqualizeWave(input([invRow("Z", { "Quantity on Hand": "0" })], { countedBarcodes: ["Z"] }));
    expect(p.counts.alreadyZero).toBe(1);
    expect(p.holds).toEqual([]);
  });
  it("the hold sits right after H_POSSIBLY_OURS in the fixed order and has a plain-English meaning", () => {
    const i = EQUALIZE_HOLD_CODES.indexOf("H_COUNTED_ON_SHELF");
    expect(EQUALIZE_HOLD_CODES[i - 1]).toBe("H_POSSIBLY_OURS");
    expect(EQUALIZE_HOLD_MEANING.H_COUNTED_ON_SHELF).toMatch(/scanned in our audit/i);
  });
  it("the counted list must be a list of text (a missing list is refused, never treated as empty)", () => {
    expect(refused(() => planEqualizeWave(input([invRow("A")], { countedBarcodes: undefined as unknown as string[] })), /counted barcodes must be a list/)).toBe("ok");
    expect(refused(() => planEqualizeWave(input([invRow("A")], { countedBarcodes: [7 as unknown as string] })), /counted barcodes must be a list/)).toBe("ok");
  });
  it("the report says how many audit barcodes protected the wave", () => {
    const md = equalizeReport(planEqualizeWave(input([invRow("A"), invRow("B")], { countedBarcodes: ["B", "Q"] })));
    expect(md).toContain("Barcodes from our audit (never zeroed) | 2");
    expect(md).toContain("| H_COUNTED_ON_SHELF | 1 |");
  });
});

describe("S-14b parseCountedList: the audit list file", () => {
  it("one barcode per line; blank lines and # notes skipped; spaces trimmed; bytes otherwise kept", () => {
    expect(parseCountedList("# audit 2026-10-30\r\nA1\n\n  b2  \n#x\nC 3\n")).toEqual(["A1", "b2", "C 3"]);
  });
  it("an empty list file is refused (use --no-counted-file to say there is none)", () => {
    expect(refused(() => parseCountedList("\n# nothing\n"), /no barcodes/)).toBe("ok");
  });
});

/* -------------------------- 3. live snapshot -------------------------- */
describe("S-14b live snapshot: our lots read live means the snapshot is today", () => {
  it("refuses a snapshot date that is not today in Pacific time", () => {
    expect(liveSnapshotRefusal("2026-11-15", new Date("2026-11-15T20:00:00Z"))).toBeNull();
    expect(liveSnapshotRefusal("2026-11-15", new Date("2026-11-16T06:00:00Z"))).toBeNull(); // still 11/15 PST
    expect(liveSnapshotRefusal("2026-11-14", new Date("2026-11-15T20:00:00Z"))).toMatch(/REFUSED: our lots were read live today \(11\/15\/2026/);
  });
});

/* ------------------------- 4. the CLI, end to end ------------------------- */
describe("S-14b script end to end", () => {
  let dir = "";
  let logs: string[] = [];
  let errs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "s14b-"));
    logs = []; errs = [];
    vi.spyOn(console, "error").mockImplementation((m: unknown) => { errs.push(String(m)); });
    vi.spyOn(console, "log").mockImplementation((m: unknown) => { logs.push(String(m)); });
  });
  afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });
  const setup = () => {
    const t = texts([invRow("STALE-1"), invRow("SHELF-1")]);
    for (const [k, v] of Object.entries(t)) writeFileSync(path.join(dir, `${k}.csv`), v);
    writeFileSync(path.join(dir, "ledger.jsonl"), ledgerFrom(buildLedgerSeed(t).entities).map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(path.join(dir, "ours.jsonl"), "");
    writeFileSync(path.join(dir, "counted.txt"), "SHELF-1\n");
    return ["x", "equalize-ccrs-wave.ts", "--phase", "inventory", "--wave", "W1", "--wave-date", "2026-11-15", "--copy-as-of", "2026-11-06", "--snapshot-date", "2026-11-15",
      "--inventory", path.join(dir, "Inventory.csv"), "--product", path.join(dir, "Product.csv"), "--strain", path.join(dir, "Strain.csv"), "--area", path.join(dir, "Area.csv"),
      "--ledger-file", path.join(dir, "ledger.jsonl"), "--ours-file", path.join(dir, "ours.jsonl")];
  };
  it("--final-upload-date is required (exit 2) and an early copy is refused (exit 1)", () => {
    const a = setup();
    expect(main([...a, "--counted-file", path.join(dir, "counted.txt")])).toBe(2);
    expect(errs.some((e) => e.includes("--final-upload-date"))).toBe(true);
    errs = [];
    expect(main([...a.map((x) => (x === "2026-11-06" ? "2026-10-29" : x)), "--final-upload-date", "2026-11-01", "--counted-file", path.join(dir, "counted.txt")])).toBe(1);
    expect(errs.some((e) => /REFUSED: .*final upload day/.test(e))).toBe(true);
  });
  it("the audit list is required: --counted-file <file> or an explicit --no-counted-file (exit 2 otherwise, and both is refused)", () => {
    const a = [...setup(), "--final-upload-date", "2026-11-01"];
    expect(main(a)).toBe(2);
    expect(errs.some((e) => e.includes("--counted-file"))).toBe(true);
    expect(main([...a, "--counted-file", path.join(dir, "counted.txt"), "--no-counted-file"])).toBe(2);
    expect(main([...a, "--counted-file", path.join(dir, "missing.txt")])).toBe(2);
  });
  it("with the audit list the scanned lot is held and only the stale lot is in the wave", () => {
    const a = [...setup(), "--final-upload-date", "2026-11-01"];
    expect(main([...a, "--counted-file", path.join(dir, "counted.txt"), "--report", path.join(dir, "w1.md")])).toBe(0);
    const counts = JSON.parse(logs.find((l) => l.startsWith("wave counts: "))!.slice(13));
    expect(counts.wave).toBe(1);
    expect(counts.held.H_COUNTED_ON_SHELF).toBe(1);
    expect(readFileSync(path.join(dir, "w1.md"), "utf8")).toContain("| SHELF-1 | H_COUNTED_ON_SHELF |");
    logs = [];
    expect(main([...a, "--no-counted-file"])).toBe(0);
    expect(JSON.parse(logs.find((l) => l.startsWith("wave counts: "))!.slice(13)).wave).toBe(2);
  });
});

/* -------------------- 5. the audit barcodes from the workbooks -------------------- */
const S = COUNT_WORKBOOK_SPEC;
function workbook(o: { id: string; counter: string; scans: string[]; hand?: [string, number][] }): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[S.scanHeader], ...o.scans.map((s) => [s])]), S.scanSheet);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...S.handHeaders], ...(o.hand ?? []).map(([b, q]) => [b, q, ""])]), S.handSheet);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["format", S.format], ["workbook_id", o.id], ["counter", o.counter], ["count_date", "2026-10-30"], ["generated_at", "2026-10-29T12:00:00Z"], ["lots_from_import", "imp"],
  ]), S.metaSheet);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("S-14b count-barcodes: the audit list comes straight from the counters' workbooks", () => {
  it("every scanned and hand-counted barcode from every workbook, once each, as scanned, sorted", async () => {
    const a = workbook({ id: "w-a", counter: "Ann", scans: ["1234567890123456789", "ABC", "ABC"], hand: [["0012", 3]] });
    const b = workbook({ id: "w-b", counter: "Bob", scans: ["abc", "Z9"] });
    const r = await countedBarcodes([{ fileName: "a.xlsx", buffer: a }, { fileName: "b.xlsx", buffer: b }]);
    expect(r.barcodes).toEqual(["0012", "1234567890123456789", "ABC", "Z9"]);
    expect(r.workbooks).toBe(2);
  });
  it("a workbook that is not one of ours (no Meta sheet) is refused, never silently skipped", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Barcode"], ["X"]]), "Sheet1");
    const bad = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    await expect(countedBarcodes([{ fileName: "bad.xlsx", buffer: bad }])).rejects.toThrow(/bad\.xlsx/);
  });
  it("the CLI writes the list file (never overwriting) and the wave script reads it back", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "s14b-cb-"));
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => { logs.push(String(m)); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      writeFileSync(path.join(dir, "a.xlsx"), workbook({ id: "w-a", counter: "Ann", scans: ["L1", "L2"] }));
      const out = path.join(dir, "counted.txt");
      expect(await countMain(["x", "count-barcodes.ts", "--out", out, path.join(dir, "a.xlsx")])).toBe(0);
      expect(parseCountedList(readFileSync(out, "utf8"))).toEqual(["L1", "L2"]);
      expect(await countMain(["x", "count-barcodes.ts", "--out", out, path.join(dir, "a.xlsx")])).toBe(2); // never overwrite
      expect(await countMain(["x", "count-barcodes.ts", "--out", path.join(dir, "o2.txt")])).toBe(2); // no workbook given
      expect(logs.some((l) => /2 barcodes from 1 workbook/.test(l))).toBe(true);
    } finally {
      vi.restoreAllMocks();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("S-14b wiring", () => {
  it("the core stays pure", () => {
    expect(/from "node:|require\(|Date\.now\(|new Date\(\)|supabase|fetch\(/.test(read("src/lib/compliance/ccrs-equalize-core.ts"))).toBe(false);
  });
  it("count-barcodes does not import the server-only workbook module", () => {
    expect(read("scripts/compliance/count-barcodes.ts")).not.toMatch(/from "[^"]*cultivera-count-workbook"/);
    expect(read("scripts/compliance/count-barcodes.ts")).toMatch(/from "\.\.\/\.\.\/src\/lib\/pos\/cultivera-count-core"/);
  });
});
