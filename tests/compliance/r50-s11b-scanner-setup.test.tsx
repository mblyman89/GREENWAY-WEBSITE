/**
 * R50 S11b: scanner helpers on the Oct 30 count page (Tera D5100, Socket DuraScan D760).
 *
 * Pins:
 *   1. Every setup barcode payload equals the value decoded from the maker's PDF
 *      (docs/research/scanner-setup-sources.md). The table below is copied from that file, not
 *      from the code.
 *   2. Every barcode the page draws decodes back to its payload with an independent decoder
 *      (zxing-cpp; tests/fixtures/scanner/roundtrip.json). The fixture's svgSha256 must equal what
 *      the live encoder draws today, so a change to the drawing cannot slip past the decode proof.
 *   3. The section renders: both models, every step's barcodes, the TEST barcode, the test box,
 *      and never a harmful choice (Storage Mode, Tab, no Enter, iOS mode).
 *   4. The workbook tells counters where the setup is, and a TEST / setup scan in the Scan sheet is
 *      a warning that is never counted as a unit.
 *   5. The test box classifier: each failure a scanner can really produce gets its own verdict.
 */
import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));

import { code128Svg } from "@/lib/printing/code128-core";
import {
  HARMFUL_PAYLOADS,
  SCANNER_BARCODE_DRAW,
  SCANNER_COMMANDS,
  SCANNER_GUIDES,
  TEST_BARCODE,
  classifyTestScan,
  commandById,
} from "@/lib/pos/scanner-setup-core";
import { ScannerSetupSection } from "@/components/admin/ScannerSetupSection";
import { parseCountWorkbook } from "@/lib/pos/cultivera-count-core";

// Copied from docs/research/scanner-setup-sources.md (decoded from TERA-UM, SOCKET-700-UG, SOCKET-D740-760).
const DECODED: Record<string, string> = {
  "tera-restore-defaults": "%%SpecCode93",
  "tera-battery": "%%SpecCode15",
  "tera-sleep-300": "%%SpecCode33",
  "tera-sleep-1800": "%%SpecCode35",
  "tera-us-layout": "%%SpecCode40",
  "tera-real-time": "%%SpecCode10",
  "tera-upload-stored": "%%SpecCode16",
  "tera-clear-stored": "%%SpecCode18",
  "tera-24ghz": "%%SpecCodeA8",
  "tera-pairing": "%%SpecCode99",
  "tera-case-off": "%%SpecCodeA5",
  "tera-cr": "%%SpecCode9C",
  "socket-basic-hid": "#FNB00F40001#",
  "socket-cr": "#FNB00F507C60408FFEB020000#",
  "socket-power-8h": "#FNB012101E001E0#",
  "socket-power-2h": "#FNB012100780005#",
  "socket-english": "#FNB01430001#",
  "socket-pairing-reset": "#FNBAB#",
  "socket-factory-reset": "#FNB00F0#",
};

type RtItem = { id: string; payload: string; svgSha256: string; zxing: string | null; format: string | null; ok: boolean };
const RT: { items: RtItem[] } = JSON.parse(readFileSync("tests/fixtures/scanner/roundtrip.json", "utf8"));

describe("setup barcode payloads", () => {
  it("match the values decoded from the makers' PDFs, one for one", () => {
    expect(Object.fromEntries(SCANNER_COMMANDS.map((c) => [c.id, c.payload]))).toEqual(DECODED);
  });
  it("the research doc lists every payload the code uses", () => {
    const doc = readFileSync("docs/research/scanner-setup-sources.md", "utf8");
    for (const c of SCANNER_COMMANDS) {
      const short = c.payload.startsWith("%%SpecCode") ? c.payload.slice(-2) : c.payload;
      expect(doc.includes(c.payload) || doc.includes(`\`${short}\``), c.id).toBe(true);
    }
  });
  it("never offers a payload that breaks the count", () => {
    for (const c of SCANNER_COMMANDS) expect(HARMFUL_PAYLOADS[c.payload]).toBeUndefined();
  });
});

describe("drawn barcodes decode back (zxing-cpp round trip)", () => {
  const all = [...SCANNER_COMMANDS.map((c) => ({ id: c.id, payload: c.payload })), { id: "test", payload: TEST_BARCODE }];
  it("the fixture covers every barcode the page draws, all decoded as Code 128 to the exact payload", () => {
    expect(RT.items.map((i) => i.id).sort()).toEqual(all.map((i) => i.id).sort());
    for (const i of RT.items) {
      expect(i.ok, i.id).toBe(true);
      expect(i.zxing, i.id).toBe(i.payload);
      expect(i.format, i.id).toBe("Code128");
    }
  });
  it("the live encoder still draws exactly the SVG that was decoded", () => {
    for (const it2 of all) {
      const r = code128Svg(it2.payload, SCANNER_BARCODE_DRAW);
      expect(r.ok).toBe(true);
      const fx = RT.items.find((i) => i.id === it2.id)!;
      expect(fx.payload).toBe(it2.payload);
      expect(createHash("sha256").update(r.svg).digest("hex"), it2.id).toBe(fx.svgSha256);
    }
  });
});

describe("the Scanner setup section renders", () => {
  const html = renderToStaticMarkup(ScannerSetupSection());
  it("shows both models, the test box and the TEST barcode", () => {
    expect(html).toContain('data-testid="scanner-setup"');
    expect(html).toContain('data-testid="scanner-guide-tera-d5100"');
    expect(html).toContain('data-testid="scanner-guide-socket-d760"');
    expect(html).toContain('data-testid="scanner-test-box"');
    expect(html).toContain(`data-payload="${TEST_BARCODE}"`);
    expect(html).toContain("Tera D5100");
    expect(html).toContain("DuraScan D760");
  });
  it("draws every barcode the guides reference, with its label", () => {
    const ids = SCANNER_GUIDES.flatMap((g) => [...g.steps.flatMap((s) => s.scan), ...g.trouble.flatMap((t) => t.scan ?? [])]);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      const c = commandById(id)!;
      expect(html, id).toContain(`data-payload="${c.payload}"`);
    }
  });
  it("draws no harmful setup barcode", () => {
    for (const p of Object.keys(HARMFUL_PAYLOADS)) expect(html).not.toContain(`data-payload="${p}"`);
  });
  it("the core setup steps are in order: Tera Real Time → US → case → CR; Socket Basic HID → CR → English", () => {
    const pos = (id: string) => html.indexOf(`data-payload="${commandById(id)!.payload}"`);
    expect(pos("tera-real-time")).toBeLessThan(pos("tera-us-layout"));
    expect(pos("tera-us-layout")).toBeLessThan(pos("tera-case-off"));
    expect(pos("tera-case-off")).toBeLessThan(pos("tera-cr"));
    expect(pos("socket-basic-hid")).toBeLessThan(pos("socket-cr"));
    expect(pos("socket-cr")).toBeLessThan(pos("socket-english"));
  });
  it("the Socket guide says to charge from a wall plug and to set up while disconnected", () => {
    expect(html).toMatch(/wall charger/);
    expect(html).toMatch(/NOT connected/);
  });
});

describe("the count page and workbook point at the setup", () => {
  it("the count page mounts the section", () => {
    const page = readFileSync("src/app/admin/menu-imports/count/page.tsx", "utf8");
    expect(page).toContain("<ScannerSetupSection />");
  });
  it("the workbook's Start Here names both models and the setup step", async () => {
    const { buildCountWorkbook } = await import("@/lib/pos/cultivera-count-workbook");
    const out = await buildCountWorkbook({
      counter: "Ana",
      countDate: "2026-10-30",
      lots: [{ barcode: "1111111111111111", productName: "A", storage: "Sales Floor" }],
      lotsSource: "run-x",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const text: string[] = [];
    wb.getWorksheet("Start Here")!.eachRow((r) => r.eachCell((c) => text.push(String(c.value ?? ""))));
    const all = text.join("\n");
    expect(all).toMatch(/Tera D5100/);
    expect(all).toMatch(/Socket D760/);
    expect(all).toMatch(/Set up and test each scanner/);
    expect(all).toMatch(/Carriage Return/);
  });
  it("a TEST scan and a setup barcode in the Scan sheet are warnings, never units", async () => {
    const { buildCountWorkbook, workbookCells } = await import("@/lib/pos/cultivera-count-workbook");
    const out = await buildCountWorkbook({
      counter: "Ana",
      countDate: "2026-10-30",
      lots: [{ barcode: "1111111111111111", productName: "A", storage: "Sales Floor" }],
      lotsSource: "run-x",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const scan = wb.getWorksheet("Scan")!;
    [TEST_BARCODE, "1111111111111111", "#FNB00F507C60408FFEB020000#", "1111111111111111"].forEach((v, i) => (scan.getCell(i + 2, 1).value = v));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = parseCountWorkbook({ fileName: "ana.xlsx", sha256: "s", cells: await workbookCells(buf) });
    expect(parsed.scanCount).toBe(2);
    expect(parsed.scans.get("1111111111111111")).toBe(2);
    expect(parsed.problems.map((p) => [p.code, p.severity, p.row])).toEqual([
      ["scanner_text", "warning", 2],
      ["scanner_text", "warning", 4],
    ]);
  });
});

describe("test box verdicts", () => {
  const v = (text: string, terminator: "enter" | "tab" | "none" = "enter", extraEnters = 0) => classifyTestScan({ text, terminator, extraEnters });
  it.each([
    [TEST_BARCODE, "enter", 0, "ok_test", true],
    ["1111111111111111", "enter", 0, "ok_product", true],
    ["", "none", 0, "nothing", false],
    [TEST_BARCODE, "none", 0, "no_enter", false],
    [TEST_BARCODE, "tab", 0, "tab", false],
    [TEST_BARCODE, "enter", 1, "double_enter", false],
    [TEST_BARCODE + TEST_BARCODE, "none", 0, "merged", false],
    ["%%SpecCode9C", "enter", 0, "command_text", false],
    [TEST_BARCODE.toUpperCase(), "enter", 0, "case_changed", false],
    ["GZtest)à&é\"'(-è_ç", "enter", 0, "layout", false],
  ] as const)("%j + %s (+%i) → %s", (text, term, extra, code, ok) => {
    const r = v(text, term, extra);
    expect(r.code).toBe(code);
    expect(r.ok).toBe(ok);
  });
});
