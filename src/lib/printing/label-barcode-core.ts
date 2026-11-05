/**
 * label-barcode-core.ts — turns "this value, this symbology, this much room on
 * this printer" into a scan-ready SVG sized in real inches (D177 S2; owner:
 * "I need to be able to switch between 1D and 2D barcodes (qr codes)").
 *
 * The rule that makes thermal barcodes scan: every bar, space and QR module is
 * a WHOLE number of printer dots. At 203 dpi a 10-mil bar is 2.03 dots; the
 * head prints it as 2 or 3 dots depending on where it lands, the bar/space
 * ratios drift, and a code that looks perfect will not scan. So we pick the
 * module size in dots first and derive inches from it — never the other way.
 *
 * Sizing rules (cited in docs/rollo-label-printing.md § Label Studio):
 *  - Code 128: X ≥ 7.5 mil; quiet zone ≥ 10 X (we widen it toward 0.25″ when
 *    the label has room); bar height ≥ max(15 % of length, 0.25″).
 *    https://www.precisionid.com/code-128-faq
 *  - UPC/EAN: X 0.26–0.66 mm (80–200 %); direct thermal may use 0.25 mm (75 %).
 *    Bar height 22.86 mm × magnification.
 *    https://gs1ca.org/gs1ca-components/documents/EAN-UPC-Symbol-Reference.pdf
 *  - QR: 4-module quiet zone on all sides (ISO/IEC 18004; qr-core enforces it).
 *
 * STORE RULES (design choices, not standards — labelled as such in the UI):
 *  - QR modules below 10 mil are refused: they are 2 dots at 203 dpi and leave
 *    no margin for thermal bleed. Below 15 mil we warn.
 *  - Code 128 X is capped at 20 mil so a 4×6 label doesn't get a giant barcode.
 */
import { code128Svg } from "./code128-core";
import { qrSvg, type QrEcLevel } from "./qr-core";
import { eanSvgDots, eanHumanReadable, EAN_KIND_LABEL, type EanKind } from "./ean-upc-core";
import type { FitMessage, FitSeverity } from "./label-stock-core";

export type Symbology = "code128" | "qr" | "upc_ean";

export const SYMBOLOGY_LABEL: Record<Symbology, string> = {
  code128: "1D barcode (Code 128)",
  qr: "2D QR code",
  upc_ean: "Retail UPC / EAN",
};

export type BarcodeRequest = {
  symbology: Symbology;
  value: string;
  dpi: number;
  /** Room for the symbol INCLUDING its quiet zones. */
  maxWidthIn: number;
  maxHeightIn: number;
  qrLevel?: QrEcLevel;
};

export type BarcodeRender =
  | {
      ok: true;
      symbology: Symbology;
      /** Self-contained SVG with width/height in inches. */
      svg: string;
      widthIn: number;
      heightIn: number;
      /** Narrow bar / QR module size. */
      xDots: number;
      xMil: number;
      humanReadable: string;
      /** e.g. "Code 128", "UPC-A", "QR v2-M". */
      formatName: string;
      severity: FitSeverity;
      messages: FitMessage[];
    }
  | { ok: false; symbology: Symbology; error: string; severity: "block"; messages: FitMessage[] };

const MM_PER_IN = 25.4;
const mil = (dots: number, dpi: number) => (dots / dpi) * 1000;
const mm = (dots: number, dpi: number) => (dots / dpi) * MM_PER_IN;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function sized(svg: string, wDots: number, hDots: number, dpi: number): string {
  // Replace the encoder's own width/height (in dots/px) with inches so the
  // browser prints it at true size; keep viewBox in dots; crisp edges.
  const wIn = r3(wDots / dpi);
  const hIn = r3(hDots / dpi);
  return svg
    .replace(/^<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${wIn}in" height="${hIn}in"`)
    .replace(/preserveAspectRatio="none"/, 'preserveAspectRatio="none" shape-rendering="crispEdges"');
}

function fail(symbology: Symbology, error: string): BarcodeRender {
  return { ok: false, symbology, error, severity: "block", messages: [{ severity: "block", code: "barcode", text: error }] };
}

function verdict(messages: FitMessage[]): FitSeverity {
  return messages.some((m) => m.severity === "block") ? "block" : messages.some((m) => m.severity === "warn") ? "warn" : "ok";
}

// ── Code 128 ─────────────────────────────────────────────────────────────────

export const C128_MIN_X_MIL = 7.5;
export const C128_MAX_X_MIL = 20;
export const C128_QUIET_X = 10;

function renderCode128(req: BarcodeRequest): BarcodeRender {
  const value = req.value;
  const probe = code128Svg(value, { moduleWidth: 1, height: 1, quietModules: 0 });
  if (!probe.ok) return fail("code128", probe.error ?? "Can't encode this value as Code 128.");
  const symbolModules = probe.widthModules; // bars + spaces, no quiet zone
  const maxW = Math.floor(req.maxWidthIn * req.dpi);
  const maxXDots = Math.max(1, Math.floor((C128_MAX_X_MIL / 1000) * req.dpi));
  let x = 0;
  for (let d = maxXDots; d >= 1; d--) {
    if ((symbolModules + 2 * C128_QUIET_X) * d <= maxW) {
      x = d;
      break;
    }
  }
  if (x === 0 || mil(x, req.dpi) < C128_MIN_X_MIL) {
    const needIn = ((symbolModules + 2 * C128_QUIET_X) * Math.ceil((C128_MIN_X_MIL / 1000) * req.dpi)) / req.dpi;
    return fail(
      "code128",
      `"${value}" is too long for a Code 128 barcode this narrow — it needs about ${r3(needIn)}″ of width. Pick a wider label, or switch to a QR code.`,
    );
  }
  // Widen the quiet zone toward 0.25″ when there is room (PrecisionID).
  const quarterDots = Math.ceil(0.25 * req.dpi);
  const spare = Math.floor((maxW - symbolModules * x) / 2);
  const quietDots = Math.max(C128_QUIET_X * x, Math.min(quarterDots, spare));
  const quietModules = Math.floor(quietDots / x);
  const heightDots = Math.floor(req.maxHeightIn * req.dpi);
  const r = code128Svg(value, { moduleWidth: x, height: heightDots, quietModules });
  if (!r.ok) return fail("code128", r.error ?? "Can't encode this value as Code 128.");
  const wDots = r.widthModules * x;
  const messages: FitMessage[] = [];
  const lengthIn = (symbolModules * x) / req.dpi;
  const minH = Math.max(0.15 * lengthIn, 0.25);
  if (heightDots / req.dpi < minH - 1e-9) {
    messages.push({
      severity: heightDots / req.dpi < 0.15 ? "block" : "warn",
      code: "short_bars",
      text: `The bars are ${r3(heightDots / req.dpi)}″ tall; Code 128 should be at least ${r3(minH)}″. Give the barcode more room or show fewer lines of text.`,
    });
  }
  if (x === 1 && req.dpi < 300) {
    messages.push({ severity: "warn", code: "thin_bars", text: "Bars are a single printer dot wide. Scans may be unreliable; a wider label or shorter code helps." });
  }
  return {
    ok: true,
    symbology: "code128",
    svg: sized(r.svg, wDots, heightDots, req.dpi),
    widthIn: wDots / req.dpi,
    heightIn: heightDots / req.dpi,
    xDots: x,
    xMil: mil(x, req.dpi),
    humanReadable: value,
    formatName: "Code 128",
    severity: verdict(messages),
    messages,
  };
}

// ── UPC / EAN ────────────────────────────────────────────────────────────────

export const EAN_MIN_X_MM = 0.25; // 75 %, direct thermal on demand only
export const EAN_80_X_MM = 0.26;
export const EAN_MAX_X_MM = 0.66;
export const EAN_NOMINAL_X_MM = 0.33;
export const EAN_NOMINAL_H_MM = 22.86;

function renderEan(req: BarcodeRequest): BarcodeRender {
  const probe = eanSvgDots(req.value, 1, 1);
  if (!probe.ok) return fail("upc_ean", probe.error);
  const maxW = Math.floor(req.maxWidthIn * req.dpi);
  const modules = probe.widthDots; // at 1 dot/module
  let x = 0;
  for (let d = 12; d >= 1; d--) {
    if (mm(d, req.dpi) <= EAN_MAX_X_MM + 1e-9 && modules * d <= maxW) {
      x = d;
      break;
    }
  }
  // Allow tiny floating tolerance: 2 dots @203 = 0.2502 mm.
  if (x === 0 || mm(x, req.dpi) < EAN_MIN_X_MM - 0.001) {
    return fail("upc_ean", `A ${EAN_KIND_LABEL[probe.kind]} needs at least ${r3((modules * Math.ceil((EAN_MIN_X_MM / MM_PER_IN) * req.dpi)) / req.dpi)}″ of width. Pick a wider label.`);
  }
  const heightDots = Math.floor(req.maxHeightIn * req.dpi);
  const r = eanSvgDots(req.value, x, heightDots);
  if (!r.ok) return fail("upc_ean", r.error);
  const xMm = mm(x, req.dpi);
  const messages: FitMessage[] = [];
  const mag = Math.max(xMm, EAN_80_X_MM) / EAN_NOMINAL_X_MM;
  const minHmm = EAN_NOMINAL_H_MM * mag;
  const hMm = mm(heightDots, req.dpi);
  if (hMm + 0.05 < minHmm) {
    messages.push({
      severity: "warn",
      code: "truncated",
      text: `Bars are ${r3(hMm)} mm tall; GS1's full height at this size is ${r3(minHmm)} mm. Short ("truncated") bars scan on handheld scanners like ours but are below the retail standard.`,
    });
  }
  if (xMm < EAN_80_X_MM) {
    messages.push({
      severity: "warn",
      code: "ean_75",
      text: "This prints at 75 % size — allowed by GS1 only for on-demand thermal labels like this one.",
    });
  }
  const wDots = r.widthDots;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(wDots / req.dpi)}in" height="${r3(heightDots / req.dpi)}in" viewBox="0 0 ${wDots} ${heightDots}" preserveAspectRatio="none" shape-rendering="crispEdges">${r.svgBody}</svg>`;
  return {
    ok: true,
    symbology: "upc_ean",
    svg,
    widthIn: wDots / req.dpi,
    heightIn: heightDots / req.dpi,
    xDots: x,
    xMil: mil(x, req.dpi),
    humanReadable: eanHumanReadable(r.kind as EanKind, r.digits),
    formatName: EAN_KIND_LABEL[r.kind],
    severity: verdict(messages),
    messages,
  };
}

// ── QR ───────────────────────────────────────────────────────────────────────

export const QR_MIN_MODULE_MIL = 10;
export const QR_WARN_MODULE_MIL = 15;

function renderQr(req: BarcodeRequest): BarcodeRender {
  const level = req.qrLevel ?? "M";
  const probe = qrSvg(req.value, { level, scale: 1, quietModules: 4 });
  if (!probe.ok) return fail("qr", probe.error ?? "Can't encode this value as a QR code.");
  const total = probe.size + 8;
  const room = Math.floor(Math.min(req.maxWidthIn, req.maxHeightIn) * req.dpi);
  const s = Math.floor(room / total);
  if (s < 1 || mil(s, req.dpi) < QR_MIN_MODULE_MIL) {
    const needIn = (total * Math.ceil((QR_MIN_MODULE_MIL / 1000) * req.dpi)) / req.dpi;
    return fail("qr", `This QR code needs a square about ${r3(needIn)}″ on each side. Pick a bigger label, show fewer lines, or use a shorter code.`);
  }
  const r = qrSvg(req.value, { level, scale: s, quietModules: 4 });
  if (!r.ok) return fail("qr", r.error ?? "Can't encode this value as a QR code.");
  const dim = total * s;
  const messages: FitMessage[] = [];
  if (mil(s, req.dpi) < QR_WARN_MODULE_MIL) {
    messages.push({ severity: "warn", code: "small_qr", text: `QR squares are only ${r3(mil(s, req.dpi))} mil. Store rule: 15 mil or more scans most reliably on thermal paper.` });
  }
  const svg = r.svg.replace(/width="\d+" height="\d+"/, `width="${r3(dim / req.dpi)}in" height="${r3(dim / req.dpi)}in"`);
  return {
    ok: true,
    symbology: "qr",
    svg,
    widthIn: dim / req.dpi,
    heightIn: dim / req.dpi,
    xDots: s,
    xMil: mil(s, req.dpi),
    humanReadable: req.value,
    formatName: `QR v${r.version}-${level}`,
    severity: verdict(messages),
    messages,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export function renderLabelBarcode(req: BarcodeRequest): BarcodeRender {
  const value = (req.value ?? "").trim();
  if (!value) return fail(req.symbology, "There is no code to print. Add a lot code or SKU first.");
  if (!(req.dpi > 0) || !(req.maxWidthIn > 0) || !(req.maxHeightIn > 0)) return fail(req.symbology, "The barcode has no room on this label.");
  const r = { ...req, value };
  if (req.symbology === "qr") return renderQr(r);
  if (req.symbology === "upc_ean") return renderEan(r);
  return renderCode128(r);
}

/** Which symbologies can encode this value at all (for the UI toggle). */
export function availableSymbologies(value: string): Symbology[] {
  const v = (value ?? "").trim();
  const out: Symbology[] = [];
  if (v && code128Svg(v).ok) out.push("code128");
  if (v && qrSvg(v).ok) out.push("qr");
  if (v && eanSvgDots(v, 1, 1).ok) out.push("upc_ean");
  return out;
}

// ── Self-tests ───────────────────────────────────────────────────────────────

export function __runLabelBarcodeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL label-barcode-core:", msg);
    }
  };
  const dpi = 203;

  // Code 128 on a 2×1 (1.875″ usable) — a real 16-digit lot barcode (fixture
  // shape from tests/fixtures), which Code 128 packs as 8 Code C pairs.
  const lot = "6034772160010001";
  const c = renderLabelBarcode({ symbology: "code128", value: lot, dpi, maxWidthIn: 1.875, maxHeightIn: 0.45 });
  ok(c.ok, "lot code fits 2x1");
  if (c.ok) {
    ok(Number.isInteger(c.xDots) && c.xDots >= 2, "x is whole dots ≥ 2");
    ok(c.widthIn <= 1.875 + 1e-9, "fits width");
    ok(c.xMil >= C128_MIN_X_MIL, "x ≥ 7.5 mil");
    ok(/width="[\d.]+in" height="[\d.]+in"/.test(c.svg), "svg sized in inches");
    ok(c.svg.includes("crispEdges"), "crisp edges");
    ok(c.humanReadable === lot && c.formatName === "Code 128", "HRI");
  }
  // A 16-character alphanumeric code is Code B (211 modules): on a 2×1 that is
  // 1 dot = 4.9 mil, below the 7.5 mil minimum → refused, never printed thin.
  ok(!renderLabelBarcode({ symbology: "code128", value: "WA-LOT-2026-0412", dpi, maxWidthIn: 1.875, maxHeightIn: 0.45 }).ok, "long alnum on 2x1 refused");
  ok(renderLabelBarcode({ symbology: "code128", value: "WA-LOT-2026-0412", dpi, maxWidthIn: 3.875, maxHeightIn: 0.8 }).ok, "long alnum fits 4in");
  // Same code on 4×6: capped at 20 mil (4 dots).
  const big = renderLabelBarcode({ symbology: "code128", value: lot, dpi, maxWidthIn: 3.875, maxHeightIn: 1 });
  ok(big.ok && big.xDots === 4, "x capped at 4 dots (19.7 mil) on 4x6");
  ok(big.ok && big.severity === "ok", "4x6 code128 clean");
  // Very long value on a narrow label → block, with a "switch to QR" hint.
  const long = renderLabelBarcode({ symbology: "code128", value: "X".repeat(40), dpi, maxWidthIn: 1.4, maxHeightIn: 0.5 });
  ok(!long.ok && long.error.includes("QR"), "too long blocks and suggests QR");
  // Short bars → warn; very short → block.
  const shortBars = renderLabelBarcode({ symbology: "code128", value: lot, dpi, maxWidthIn: 3.875, maxHeightIn: 0.2 });
  ok(shortBars.ok && shortBars.messages.some((m) => m.code === "short_bars"), "short bars flagged");
  const tiny = renderLabelBarcode({ symbology: "code128", value: lot, dpi, maxWidthIn: 3.875, maxHeightIn: 0.1 });
  ok(tiny.ok && tiny.severity === "block", "bars under 0.15in block");
  // All-digit even → Code C, narrower.
  const digits = renderLabelBarcode({ symbology: "code128", value: "12345678", dpi, maxWidthIn: 3, maxHeightIn: 0.5 });
  ok(digits.ok, "digits encode");
  ok(!renderLabelBarcode({ symbology: "code128", value: "  ", dpi, maxWidthIn: 2, maxHeightIn: 1 }).ok, "blank blocks");
  ok(!renderLabelBarcode({ symbology: "code128", value: "héllo", dpi, maxWidthIn: 2, maxHeightIn: 1 }).ok, "non-ascii blocks");

  // UPC-A on a 2.25×1.25 (2.125″ usable): 113 modules → 3 dots = 339 dots = 1.67″.
  const u = renderLabelBarcode({ symbology: "upc_ean", value: "036000291452", dpi, maxWidthIn: 2.125, maxHeightIn: 0.6 });
  ok(u.ok && u.xDots === 3 && u.formatName === "UPC-A", "UPC-A picks 3 dots on 2.25 label");
  ok(u.ok && u.messages.some((m) => m.code === "truncated"), "short UPC warned as truncated, not blocked");
  ok(u.ok && u.severity === "warn", "UPC truncated is a warning");
  ok(u.ok && u.humanReadable === "0 36000 29145 2", "UPC HRI grouped");
  // On a 2×1 (1.875″ = 380 dots): 113×3 = 339 fits.
  const u2 = renderLabelBarcode({ symbology: "upc_ean", value: "036000291452", dpi, maxWidthIn: 1.875, maxHeightIn: 0.5 });
  ok(u2.ok && u2.xDots === 3, "UPC fits 2x1 at 3 dots");
  // Narrower than 2 dots → 75 % with warning; narrower still → block.
  const u3 = renderLabelBarcode({ symbology: "upc_ean", value: "036000291452", dpi, maxWidthIn: 1.2, maxHeightIn: 0.5 });
  ok(u3.ok && u3.xDots === 2 && u3.messages.some((m) => m.code === "ean_75"), "2 dots = 75% warned");
  const u4 = renderLabelBarcode({ symbology: "upc_ean", value: "036000291452", dpi, maxWidthIn: 1.0, maxHeightIn: 0.5 });
  ok(!u4.ok, "too narrow UPC blocks");
  // Cap at 0.66 mm: at 203 dpi that's 5 dots (0.625 mm).
  const u5 = renderLabelBarcode({ symbology: "upc_ean", value: "036000291452", dpi, maxWidthIn: 3.875, maxHeightIn: 1.2 });
  ok(u5.ok && u5.xDots === 5, "UPC capped at 200% (5 dots @203)");
  ok(!renderLabelBarcode({ symbology: "upc_ean", value: "036000291453", dpi, maxWidthIn: 3, maxHeightIn: 1 }).ok, "bad check digit blocks");
  ok(!renderLabelBarcode({ symbology: "upc_ean", value: "SKU-1234", dpi, maxWidthIn: 3, maxHeightIn: 1 }).ok, "SKU isn't a UPC");
  const e8 = renderLabelBarcode({ symbology: "upc_ean", value: "96385074", dpi, maxWidthIn: 1.875, maxHeightIn: 0.5 });
  ok(e8.ok && e8.formatName === "EAN-8", "EAN-8 renders");

  // QR.
  const q = renderLabelBarcode({ symbology: "qr", value: lot, dpi, maxWidthIn: 0.85, maxHeightIn: 0.85 });
  ok(q.ok, "QR fits 0.85in square");
  if (q.ok) {
    ok(q.widthIn === q.heightIn && q.widthIn <= 0.85, "QR square within room");
    ok(q.xMil >= QR_MIN_MODULE_MIL, "QR module ≥ 10 mil");
    ok(q.formatName.startsWith("QR v") && q.formatName.endsWith("-M"), "QR format name");
    ok(/width="[\d.]+in"/.test(q.svg), "QR sized in inches");
  }
  const qH = renderLabelBarcode({ symbology: "qr", value: lot, dpi, maxWidthIn: 2, maxHeightIn: 2, qrLevel: "H" });
  ok(qH.ok && qH.formatName.endsWith("-H"), "QR level H honoured");
  const qTiny = renderLabelBarcode({ symbology: "qr", value: lot, dpi, maxWidthIn: 0.3, maxHeightIn: 0.3 });
  ok(!qTiny.ok, "QR in 0.3in blocks");
  const qSmall = renderLabelBarcode({ symbology: "qr", value: lot, dpi, maxWidthIn: 0.4, maxHeightIn: 0.4 });
  ok(!qSmall.ok || qSmall.severity !== "ok", "QR in 0.4in is at best a warning");

  // 300 dpi printers get finer steps.
  const c300 = renderLabelBarcode({ symbology: "code128", value: lot, dpi: 300, maxWidthIn: 1.875, maxHeightIn: 0.45 });
  ok(c300.ok && c300.xDots === 3, "300 dpi picks 3 dots (10 mil)");
  ok(c300.ok && c300.xMil >= C128_MIN_X_MIL, "300 dpi code128 respects 7.5 mil");

  ok(availableSymbologies("036000291452").join() === "code128,qr,upc_ean", "UPC gets all three");
  ok(availableSymbologies("ABC-123").join() === "code128,qr", "SKU gets 1D + QR");
  ok(availableSymbologies("").length === 0, "empty gets none");

  return { passed, failed };
}
