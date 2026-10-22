/**
 * R74 S9: read the PDFs and spreadsheets the email harvest kept.
 * Owner (round 6): "Make sure when you build the pdf and spreadsheet reader to utilize llama parse
 * ai if it helps us in any way. ... Test it, test the tests."
 *
 * End to end with REAL inputs:
 *   - a REAL vendor PDF (QGT contingency manifest, back-office examples) through the REAL unpdf
 *     text layer and the REAL intake layout parsers;
 *   - the REAL LCB Internal Shipping Document text fixture as "LlamaParse output";
 *   - a REAL .xlsx built by exceljs, read back by the REAL loader (loadXlsxWorkbook);
 *   - the batch runner with fake I/O (claim guard, outage stops loud, missing file unreadable).
 * LlamaParse itself is never called (no network); its outcome is simulated at the provider seam.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readPdfLayer, parsePdfManifest } = await import("@/lib/inventory/pdf-extract");
const core = await import("@/lib/pos/cultivera-mail-read-core");
const store = await import("@/lib/pos/cultivera-mail-read-store");
const { mailDocsFromRows } = await import("@/lib/pos/cultivera-mail-harvest-run-core");

const read = (p: string) => readFileSync(p, "utf8");
const EX = path.resolve(__dirname, "../../back-office/source-materials/examples");
const QGT_PDF = new Uint8Array(readFileSync(path.join(EX, "QGT_FreddysFuego_MANIFEST.pdf")));
const QGT_COA = new Uint8Array(readFileSync(path.join(EX, "QGT_FreddysFuego_COA_QA_RESULTS.pdf")));
const LCB_TEXT = read(path.join(__dirname, "fixtures", "pdf-manifest-sample.txt"));

describe("R74 S9 pure core", () => {
  it("self-tests pass at the pinned count", () => {
    const r = core.__runCultiveraMailReadCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(51);
  });
  it("is registered in the pure self-test runner with its floor", () => {
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toContain("__runCultiveraMailReadCoreTests()");
    expect(src).toMatch(/cultivera-mail-read-core: .*expected >= 51/);
  });
});

describe("R74 S9 PDFs: the same parsers as the live intake", () => {
  it("the REAL LCB shipping document read as LlamaParse text, grounded by the same text as layer", () => {
    const r = core.readPdfText({ text: LCB_TEXT, engine: "llamaparse", layer: LCB_TEXT });
    expect(r.status).toBe("parsed");
    expect(r.sourceFormat).toBe("pdf-manifest");
    expect(r.manifestNumber).toBe("11374279827298553");
    expect(r.lines.length).toBe(9);
    expect(r.lines.map((l) => l[0])).toContain("11373796120454282");
    expect(r.note).toMatch(/read by LlamaParse/);
    expect(r.note).not.toMatch(/dropped/);
  });

  it("an OCR slip (a barcode the PDF's own text does not contain) is dropped and counted", () => {
    const slipped = LCB_TEXT.replace("11373796120454282", "11373796120454289");
    const r = core.readPdfText({ text: slipped, engine: "llamaparse", layer: LCB_TEXT });
    expect(r.status).toBe("parsed");
    expect(r.lines.length).toBe(8);
    expect(r.lines.map((l) => l[0])).not.toContain("11373796120454289");
    expect(r.note).toMatch(/1 barcode LlamaParse read but the PDF's own text does not contain, dropped/);
  });

  it("a scanned PDF (no layer) keeps LlamaParse's barcodes and says they are vision-only", () => {
    const r = core.readPdfText({ text: LCB_TEXT, engine: "llamaparse", layer: "" });
    expect(r.lines.length).toBe(9);
    expect(r.note).toMatch(/scanned PDF/);
  });

  it("LlamaParse unavailable: the text layer reads it and the reason is kept on the row", () => {
    const r = core.readPdfText({ text: LCB_TEXT, engine: "unpdf", layer: LCB_TEXT, engineNote: "LLAMA_CLOUD_API_KEY not set" });
    expect(r.status).toBe("parsed");
    expect(r.note).toMatch(/LlamaParse unavailable: LLAMA_CLOUD_API_KEY not set/);
  });

  it("LlamaParse text that is not a manifest falls back to the PDF's own layer", () => {
    const r = core.readPdfText({ text: "garbled ### nothing", engine: "llamaparse", layer: LCB_TEXT });
    expect(r.status).toBe("parsed");
    expect(r.note).toMatch(/read from the PDF's text layer/);
  });

  it("the REAL QGT contingency PDF: S9 agrees with the intake (refused, same reason)", async () => {
    const layer = await readPdfLayer(QGT_PDF.slice());
    const intake = await parsePdfManifest(QGT_PDF.slice());
    const r = core.readPdfText({ text: layer.text, engine: "unpdf", layer: layer.text });
    // This contingency form is not one of the intake's line layouts: the intake refuses it, and S9
    // refuses it the same way, with the same reason (parity, never a guess).
    expect(intake.ok).toBe(false);
    expect(r.status).toBe("unreadable");
    expect(r.lines).toEqual([]);
    expect(r.note).toContain(intake.ok ? "unreachable" : intake.error);
    expect(r.note).toMatch(/LlamaParse unavailable/);
  });

  it("the REAL QGT certificate of analysis PDF is not a manifest: unreadable with the reason", async () => {
    const layer = await readPdfLayer(QGT_COA.slice());
    const r = core.readPdfText({ text: layer.text, engine: "llamaparse", layer: layer.text });
    expect(r.status).toBe("unreadable");
    expect(r.lines).toEqual([]);
    expect(r.note).toBeTruthy();
  });
});

async function xlsxBytes(build: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("R74 S9 spreadsheets: a REAL .xlsx through exceljs", () => {
  it("label block + table, formula results, rich text, a numeric barcode, a cover sheet", async () => {
    const bytes = await xlsxBytes((wb) => {
      wb.addWorksheet("Cover").addRow(["Thanks for your order!"]);
      const ws = wb.addWorksheet("Manifest");
      ws.addRow(["Manifest #:", "0009123"]);
      ws.addRow(["From License #:", "412345"]);
      ws.addRow(["From:", { richText: [{ text: "CANNA " }, { text: "ORGANIX" }] }]);
      ws.addRow(["Transfer Date:", new Date(Date.UTC(2025, 2, 1))]);
      ws.addRow([]);
      ws.addRow(["Inventory ID", "Product Name", "Inventory Type", "Qty", "Unit Price"]);
      ws.addRow(["1234567890123456", "Blue Dream 3.5g", "Usable Marijuana", 10, 4.5]);
      ws.addRow([1234567890123457, "Gelato 1g", "Usable Marijuana", { formula: "2+3", result: 5 }, "$2.00"]);
    });
    const sheets = await store.loadXlsxWorkbook(bytes);
    expect(sheets.map((s) => s.name)).toEqual(["Cover", "Manifest"]);
    const cells = sheets.map((s) => ({ name: s.name, rows: s.rows.map((r) => r.map((v) => core.excelCellValue(v))) }));
    const r = core.readSpreadsheetCells(cells);
    expect(r.status).toBe("parsed");
    expect(r.sourceFormat).toBe("generic");
    expect(r.manifestNumber).toBe("0009123");
    expect(r.vendorLicense).toBe("412345");
    expect(r.vendorLabel).toBe("CANNA ORGANIX");
    expect(r.transferDate).toBe("2025-03-01");
    expect(r.lines).toEqual([
      ["1234567890123456", 10, "Blue Dream 3.5g", "Usable Marijuana", 450],
      ["1234567890123457", 5, "Gelato 1g", "Usable Marijuana", 200],
    ]);
    expect(r.note).toMatch(/read sheet "Manifest" \(header row 6\)/);
  });

  it("a price list (no barcode column) is unreadable with the sheet's reason, nothing guessed", async () => {
    const bytes = await xlsxBytes((wb) => {
      const ws = wb.addWorksheet("Prices");
      ws.addRow(["Strain", "Price"]);
      ws.addRow(["1234567890123456", 5]);
    });
    const sheets = await store.loadXlsxWorkbook(bytes);
    const r = core.readSpreadsheetCells(sheets.map((s) => ({ name: s.name, rows: s.rows.map((x) => x.map((v) => core.excelCellValue(v))) })));
    expect(r.status).toBe("unreadable");
    expect(r.note).toMatch(/Prices: no column is headed/);
  });
});

/* ------------------------------------------------------------------ *
 *  The batch with fake I/O
 * ------------------------------------------------------------------ */

type Row = { id: string; kind: string; filename: string; storage_key: string; status: string; patch?: unknown };

function fakeIo(rows: Row[], files: Map<string, Uint8Array | Error>, opts: { pdf?: (b: Uint8Array) => { text: string; engine: "llamaparse" | "unpdf" | "none"; note: string | null }; layer?: (b: Uint8Array) => string; stealOn?: string; clock?: number[] } = {}) {
  const calls = { pdf: 0, updates: [] as string[] };
  let t = 0;
  const io: import("@/lib/pos/cultivera-mail-read-store").ReadIo = {
    countStored: async () => rows.filter((r) => r.status === "stored").length,
    listStored: async (limit) => rows.filter((r) => r.status === "stored").slice(0, limit),
    download: async (key) => {
      const f = files.get(key);
      if (!f) throw new store.DocumentGone("Object not found");
      if (f instanceof Error) throw f;
      return f;
    },
    readLayer: async (b) => (opts.layer ? opts.layer(b) : ""),
    readPdf: async (b) => {
      calls.pdf += 1;
      return opts.pdf ? opts.pdf(b) : { text: "", engine: "none", note: "LLAMA_CLOUD_API_KEY not set" };
    },
    workbook: store.loadXlsxWorkbook,
    update: async (id, patch) => {
      const r = rows.find((x) => x.id === id)!;
      if (opts.stealOn === id) r.status = "parsed"; // another press wrote it first
      if (r.status !== "stored") return false;
      r.status = patch.status;
      r.patch = patch;
      calls.updates.push(id);
      return true;
    },
    now: () => (opts.clock ? (opts.clock[Math.min(t++, opts.clock.length - 1)] ?? 0) : 0),
  };
  return { io, calls };
}

const enc = (s: string) => new TextEncoder().encode(s);

describe("R74 S9 batch runner (fake I/O)", () => {
  it("reads a PDF via LlamaParse and an xlsx via cells; patches satisfy the 0293 checks", async () => {
    const xlsx = await xlsxBytes((wb) => {
      const ws = wb.addWorksheet("S");
      ws.addRow(["Barcode", "Qty"]);
      ws.addRow(["2222222222222222", 3]);
    });
    const rows: Row[] = [
      { id: "a", kind: "pdf", filename: "m.pdf", storage_key: "mail-harvest/a.pdf", status: "stored" },
      { id: "b", kind: "xlsx", filename: "m.xlsx", storage_key: "mail-harvest/b.xlsx", status: "stored" },
    ];
    const files = new Map<string, Uint8Array | Error>([
      ["mail-harvest/a.pdf", enc("%PDF-fake")],
      ["mail-harvest/b.xlsx", xlsx],
    ]);
    const { io, calls } = fakeIo(rows, files, { pdf: () => ({ text: LCB_TEXT, engine: "llamaparse", note: null }), layer: () => LCB_TEXT });
    const r = await store.runReadBatch(io);
    expect(r).toMatchObject({ ok: true, waiting: 2, read: 2, parsed: 2, unreadable: 0, failed: 0, llamaparse: 1, unpdf: 0, left: 0 });
    expect(calls.pdf).toBe(1);
    for (const row of rows) {
      const p = row.patch as import("@/lib/pos/cultivera-mail-read-store").ReadPatch;
      // the 0293 checks: parsed => line_count > 0 and a source_format; line_count = lines length
      expect(p.status).toBe("parsed");
      expect(p.line_count).toBe(p.lines.length);
      expect(p.line_count).toBeGreaterThan(0);
      expect(["wcia", "generic", "ccrs-csv", "pdf-manifest"]).toContain(p.source_format);
      expect(p.barcodes).toEqual([...new Set(p.lines.map((l) => l[0]))].sort());
    }
    // and S6 now sees them as email documents
    const docs = mailDocsFromRows(rows.map((x) => ({ ...(x.patch as object), status: x.status, filename: x.filename, kind: x.kind, email_at: null, gmail_id: "g", doc_index: 0, subject: "" })) as never);
    expect(docs.length).toBe(2);
    expect(core.readBatchLine(r)).toMatch(/Read 2 kept documents: 2 with barcodes, 0 without \(LlamaParse 1, text layer 0\) Finished/);
  });

  it("a storage outage STOPS loud and leaves the row (and the rest) stored", async () => {
    const rows: Row[] = [
      { id: "a", kind: "pdf", filename: "a.pdf", storage_key: "mail-harvest/a.pdf", status: "stored" },
      { id: "b", kind: "pdf", filename: "b.pdf", storage_key: "mail-harvest/b.pdf", status: "stored" },
    ];
    const { io, calls } = fakeIo(rows, new Map([["mail-harvest/a.pdf", new Error("storage: 503")]]));
    const r = await store.runReadBatch(io);
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(1);
    expect(r.read).toBe(0);
    expect(r.left).toBe(2);
    expect(r.stoppedBecause).toMatch(/could not open a.pdf: storage: 503/);
    expect(calls.updates).toEqual([]);
    expect(rows.every((x) => x.status === "stored")).toBe(true);
  });

  it("a file gone from storage, an old .xls and a corrupt xlsx are unreadable WITH the reason", async () => {
    const rows: Row[] = [
      { id: "gone", kind: "pdf", filename: "g.pdf", storage_key: "mail-harvest/g.pdf", status: "stored" },
      { id: "xls", kind: "xlsx", filename: "o.xls", storage_key: "mail-harvest/o.xls", status: "stored" },
      { id: "bad", kind: "xlsx", filename: "b.xlsx", storage_key: "mail-harvest/b.xlsx", status: "stored" },
    ];
    const files = new Map<string, Uint8Array | Error>([
      ["mail-harvest/o.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
      ["mail-harvest/b.xlsx", new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9])],
    ]);
    const { io } = fakeIo(rows, files);
    const r = await store.runReadBatch(io);
    expect(r).toMatchObject({ ok: true, read: 3, parsed: 0, unreadable: 3, left: 0 });
    const note = (id: string) => (rows.find((x) => x.id === id)!.patch as { note: string }).note;
    expect(note("gone")).toMatch(/missing from storage/);
    expect(note("xls")).toMatch(/old Excel 97-2003 \.xls/);
    expect(note("bad")).toMatch(/could not be opened/);
  });

  it("no LlamaParse and no text layer: the PDF is unreadable and says why", async () => {
    const rows: Row[] = [{ id: "s", kind: "pdf", filename: "scan.pdf", storage_key: "mail-harvest/s.pdf", status: "stored" }];
    const { io } = fakeIo(rows, new Map([["mail-harvest/s.pdf", enc("%PDF")]]));
    await store.runReadBatch(io);
    const p = rows[0].patch as { status: string; note: string };
    expect(p.status).toBe("unreadable");
    expect(p.note).toMatch(/LLAMA_CLOUD_API_KEY not set/);
  });

  it("the guarded update is the claim: a row another press wrote is not counted twice", async () => {
    const rows: Row[] = [{ id: "a", kind: "pdf", filename: "a.pdf", storage_key: "mail-harvest/a.pdf", status: "stored" }];
    const { io, calls } = fakeIo(rows, new Map([["mail-harvest/a.pdf", enc("%PDF")]]), { stealOn: "a", pdf: () => ({ text: LCB_TEXT, engine: "llamaparse", note: null }), layer: () => LCB_TEXT });
    const r = await store.runReadBatch(io);
    expect(r.read).toBe(0);
    expect(calls.updates).toEqual([]);
  });

  it("the time budget stops new documents and says so", async () => {
    const rows: Row[] = [
      { id: "a", kind: "pdf", filename: "a.pdf", storage_key: "mail-harvest/a.pdf", status: "stored" },
      { id: "b", kind: "pdf", filename: "b.pdf", storage_key: "mail-harvest/b.pdf", status: "stored" },
    ];
    const { io } = fakeIo(rows, new Map([["mail-harvest/a.pdf", enc("%PDF")], ["mail-harvest/b.pdf", enc("%PDF")]]), { clock: [0, 0, core.READ_BATCH_TIME_BUDGET_MS + 1] });
    const r = await store.runReadBatch(io);
    expect(r.read).toBe(1);
    expect(r.left).toBe(1);
    expect(r.stoppedBecause).toMatch(/time budget/);
  });

  it("nothing waiting: no reads at all", async () => {
    const { io, calls } = fakeIo([], new Map());
    const r = await store.runReadBatch(io);
    expect(r.waiting).toBe(0);
    expect(calls.pdf).toBe(0);
    expect(core.readBatchLine(r)).toMatch(/^Nothing to read/);
  });
});

describe("R74 S9 wiring", () => {
  const action = read("src/app/admin/menu-imports/mail-harvest-actions.ts");
  const page = read("src/app/admin/menu-imports/page.tsx");
  const st = read("src/lib/pos/cultivera-mail-read-store.ts");
  it("the action uses LlamaParse (parsePdfWithFallback) + the text layer + exceljs, audited, permissioned", () => {
    expect(action).toMatch(/export async function readKeptDocumentsAction/);
    expect(action).toMatch(/parsePdfWithFallback/);
    expect(action).toMatch(/readPdfLayer/);
    expect(action).toMatch(/loadXlsxWorkbook/);
    expect(action).toMatch(/action: "cultivera_mail\.read"/);
    expect(action.slice(action.indexOf("readKeptDocumentsAction"))).toMatch(/requirePermission\("menu\.import"\)/);
  });
  it("the store's update is guarded on status = stored and logs LlamaParse usage under its own feature", () => {
    expect(st).toMatch(/\.update\(patch\)\.eq\("id", id\)\.eq\("status", "stored"\)/);
    expect(st).toMatch(/feature: "cultivera-mail-read"/);
    expect(st).toMatch(/mimeType: "application\/pdf"/);
    expect(st).not.toMatch(/from "xlsx"/);
  });
  it("the page has the button, wired to the action", () => {
    expect(page).toMatch(/readKeptDocumentsAction/);
    expect(page).toContain("Read the kept PDFs and spreadsheets");
    expect(page).toContain('data-testid="mail-read-run"');
  });
  it("the intake's PDF dispatch is shared, not copied", () => {
    expect(read("src/lib/inventory/pdf-extract.ts")).toMatch(/parsePdfManifestText/);
    expect(read("src/lib/pos/cultivera-mail-read-core.ts")).toMatch(/from "@\/lib\/inventory\/pdf-manifest-dispatch-core"/);
  });
});
