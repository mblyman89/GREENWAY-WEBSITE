/**
 * D191 — Label print geometry & per-device calibration (pure).
 *
 * Owner (D191): "I tested the 2x1" labels, it prints two labels, the first
 * blank, the second nearly prints off the bottom of the label."
 *
 * Root cause (researched, docs/rollo-label-printing.md § Troubleshooting):
 * Chromium rotates a print job 90° whenever the CSS page is WIDER than it is
 * TALL (Chromium issue 372435414, "Prints are rotated with 90 degree if the page
 * width is larger than the page height" — reported for a 60×50 mm label on a
 * thermal printer; Firefox and Acrobat print the same file correctly). A 2″×1″
 * label sent as a 2-wide × 1-tall page therefore reaches the Rollo as a
 * 1-wide × 2-tall image: it runs across two labels, the first mostly blank and
 * the second cut off at the bottom — exactly what was reported.
 *
 * The fix is to never hand Chrome a landscape page for a wide label: send a
 * PORTRAIT page (feed × across) with the artwork pre-rotated, so Chrome has
 * nothing to rotate. Drivers differ, so every device can also choose the
 * orientation by hand, nudge the image (offset), shrink it a touch (scale),
 * and print a calibration label that shows edges, centre and direction.
 *
 * D196 (owner photo, 2026-11-06): with D191's turned tall page the Rollo
 * printed the design sideways down two labels, with the QR code on one label
 * and the name on the next. That is the 1″ × 2″ page printed exactly as
 * sent, so on that computer nothing rotates the page and the extra turn was
 * wrong. Rollo's documented flow is a page the same size as the label
 * (support 29000051200: "Make sure your label file is designed at the same size
 * as your labels"), with the printer's Media set to that size. The owner's
 * Rollo web page now shows 2 × 1. So Auto sends every label STRAIGHT. The
 * turned pages stay as manual options for a driver that does turn wide pages
 * (Chromium issue 372435414). The Rollo's own web page also has an Orientation
 * setting, and the owner's showed "?" (auto-rotate). The setup now says to set
 * it to the upright "A" so the printer never turns a page by itself. If a
 * Windows computer still prints a straight page sideways, Rollo's own fix is
 * its Windows driver, added by hostname, with Rotate set to Normal.
 *
 * Everything here is deterministic and self-tested; the component only stores
 * the choice and renders the CSS/SVG these functions return.
 */
import { ROLLO_X1040, customStock, stockById, stockSizeText, type LabelStock, type PrinterProfile } from "./label-stock-core";

// ── Calibration (per device, per label size) ────────────────────────────────

/**
 * - auto:     D196: the page is exactly the label (same as straight). This is
 *             Rollo's documented setup and what its own Windows driver and
 *             the Mac custom size expect.
 * - straight: page exactly as the label (across × feed), no rotation.
 * - rotate_cw / rotate_ccw: send a tall page with the artwork turned
 *             clockwise / counter-clockwise, for a driver that turns wide pages
 *             itself (Chromium issue 372435414). Use the direction test to
 *             find out.
 */
export type PrintOrientation = "auto" | "straight" | "rotate_cw" | "rotate_ccw";

export type PrintCalibration = {
  orientation: PrintOrientation;
  /** Move the image right (+) / left (−) on the label, inches. */
  offsetXIn: number;
  /** Move the image down (+) / up (−) on the label, inches. */
  offsetYIn: number;
  /** Shrink/grow the whole image about its centre, percent. */
  scalePct: number;
};

export const ORIENTATIONS: readonly PrintOrientation[] = ["auto", "straight", "rotate_cw", "rotate_ccw"];
export const OFFSET_MAX_IN = 0.25;
export const OFFSET_STEP_IN = 0.01;
export const SCALE_MIN_PCT = 85;
export const SCALE_MAX_PCT = 105;

export const DEFAULT_CALIBRATION: PrintCalibration = { orientation: "auto", offsetXIn: 0, offsetYIn: 0, scalePct: 100 };

export const ORIENTATION_LABEL: Record<PrintOrientation, string> = {
  auto: "Auto (recommended)",
  straight: "Straight",
  rotate_cw: "Turned ↻",
  rotate_ccw: "Turned ↺",
};


function clampNum(raw: unknown, lo: number, hi: number, d: number, step: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return d;
  const c = Math.min(hi, Math.max(lo, n));
  const v = Math.round(Math.round(c / step) * step * 1000) / 1000;
  return v === 0 ? 0 : v; // never -0
}

/** Coerce anything (localStorage, a hand-edited value) into a valid calibration. */
export function sanitizeCalibration(raw: unknown): PrintCalibration {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const orientation = typeof r.orientation === "string" && (ORIENTATIONS as readonly string[]).includes(r.orientation) ? (r.orientation as PrintOrientation) : "auto";
  return {
    orientation,
    offsetXIn: clampNum(r.offsetXIn, -OFFSET_MAX_IN, OFFSET_MAX_IN, 0, OFFSET_STEP_IN),
    offsetYIn: clampNum(r.offsetYIn, -OFFSET_MAX_IN, OFFSET_MAX_IN, 0, OFFSET_STEP_IN),
    scalePct: clampNum(r.scalePct, SCALE_MIN_PCT, SCALE_MAX_PCT, 100, 1),
  };
}

export function isDefaultCalibration(c: PrintCalibration): boolean {
  return c.orientation === "auto" && c.offsetXIn === 0 && c.offsetYIn === 0 && c.scalePct === 100;
}

/**
 * localStorage key for this device's calibration map (stockId → calibration).
 * D196 bumped v1 → v2: nudges saved while D191 sent a turned page were tuned
 * for the wrong direction, so every computer starts fresh on Auto (straight).
 */
export const CALIBRATION_STORAGE_KEY = "gw.labelStudio.v2.calibration";

/** Pick one stock's calibration out of the stored map (sanitised). */
export function calibrationFor(map: unknown, stockId: string): PrintCalibration {
  const m = (map && typeof map === "object" ? map : {}) as Record<string, unknown>;
  return sanitizeCalibration(Object.prototype.hasOwnProperty.call(m, stockId) ? m[stockId] : null);
}

/** Return a new map with this stock's calibration set (defaults are removed, keeps the map small). */
export function withCalibration(map: unknown, stockId: string, c: PrintCalibration): Record<string, PrintCalibration> {
  const m = (map && typeof map === "object" ? map : {}) as Record<string, unknown>;
  const out: Record<string, PrintCalibration> = {};
  let n = 0;
  for (const [k, v] of Object.entries(m)) {
    if (k === stockId || n >= 60 || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(k)) continue;
    out[k] = sanitizeCalibration(v);
    n += 1;
  }
  const s = sanitizeCalibration(c);
  if (!isDefaultCalibration(s)) out[stockId] = s;
  return out;
}

// ── Page geometry ──────────────────────────────────────────────────────────

export type ResolvedOrientation = Exclude<PrintOrientation, "auto">;

/** A label is "wide" when it is wider across the roll than it is long. */
export function isWideLabel(stock: LabelStock): boolean {
  return stock.acrossIn > stock.feedIn + 1e-9;
}

export function resolveOrientation(stock: LabelStock, c: PrintCalibration): ResolvedOrientation {
  void stock;
  // D196: Auto = straight for every size (see the header). The turned pages
  // made a 2×1 print sideways across two labels on the owner's Rollo.
  if (c.orientation !== "auto") return c.orientation;
  return "straight";
}

export type PageGeometry = {
  orientation: ResolvedOrientation;
  /** The CSS page the browser sees (portrait whenever rotated). */
  pageWIn: number;
  pageHIn: number;
  /** The label artwork's own size (across × feed). */
  artWIn: number;
  artHIn: number;
  /** CSS transform placing the artwork on the page (origin top-left). */
  transform: string;
  /** True when the browser page is wider than tall (the risky case). */
  landscapePage: boolean;
};

const r4 = (n: number) => {
  const v = Math.round(n * 10000) / 10000;
  return Object.is(v, -0) ? 0 : v;
};

/**
 * Where the artwork lands on the page. Composition (applied to the artwork
 * right-to-left): nudge in the label's own frame → rotate onto the portrait
 * page → scale about the page centre.
 */
export function pageGeometry(stock: LabelStock, calibration: PrintCalibration): PageGeometry {
  const c = sanitizeCalibration(calibration);
  const o = resolveOrientation(stock, c);
  const W = stock.acrossIn;
  const H = stock.feedIn;
  const rotated = o !== "straight";
  const pw = rotated ? H : W;
  const ph = rotated ? W : H;
  const s = c.scalePct / 100;
  const parts: string[] = [];
  if (Math.abs(s - 1) > 1e-9) parts.push(`translate(${r4(((1 - s) * pw) / 2)}in,${r4(((1 - s) * ph) / 2)}in) scale(${r4(s)})`);
  if (o === "rotate_cw") parts.push(`translate(${r4(H)}in,0in) rotate(90deg)`);
  if (o === "rotate_ccw") parts.push(`translate(0in,${r4(W)}in) rotate(-90deg)`);
  if (c.offsetXIn !== 0 || c.offsetYIn !== 0) parts.push(`translate(${r4(c.offsetXIn)}in,${r4(c.offsetYIn)}in)`);
  return {
    orientation: o,
    pageWIn: pw,
    pageHIn: ph,
    artWIn: W,
    artHIn: H,
    transform: parts.length ? parts.join(" ") : "none",
    landscapePage: pw > ph + 1e-9,
  };
}

/**
 * Map a point on the artwork (label frame, inches) to the page — the same
 * maths the CSS transform performs. Used by the self-tests to prove every
 * corner lands inside the page.
 */
export function mapPoint(g: PageGeometry, c: PrintCalibration, x: number, y: number): { x: number; y: number } {
  const cal = sanitizeCalibration(c);
  let px = x + cal.offsetXIn;
  let py = y + cal.offsetYIn;
  if (g.orientation === "rotate_cw") [px, py] = [g.artHIn - py, px];
  else if (g.orientation === "rotate_ccw") [px, py] = [py, g.artWIn - px];
  const s = cal.scalePct / 100;
  return { x: r4(px * s + ((1 - s) * g.pageWIn) / 2), y: r4(py * s + ((1 - s) * g.pageHIn) / 2) };
}

/** Class on the print portal (direct child of <body>). */
export const PRINT_ROOT_CLASS = "gw-label-print-root";

/**
 * Print CSS for one job. The page is sized from the geometry (portrait when
 * rotated); margin 0 is marked !important so the admin-wide
 * `@media print { @page { margin: 8mm } }` (globals.css, for pick tickets) can
 * never add a margin around a label. Each page box is a hair (0.01″) shorter
 * than the page so rounding can never spill one label onto a second page —
 * the "extra blank label" symptom. The last page has no break after it.
 */
export function printCss(stock: LabelStock, calibration: PrintCalibration = DEFAULT_CALIBRATION): string {
  const g = pageGeometry(stock, calibration);
  const pw = `${r4(g.pageWIn)}in`;
  const ph = `${r4(g.pageHIn)}in`;
  const boxH = `${r4(Math.max(0.1, g.pageHIn - 0.01))}in`;
  const aw = `${r4(g.artWIn)}in`;
  const ah = `${r4(g.artHIn)}in`;
  return [
    `@page { size: ${pw} ${ph}; margin: 0 !important; }`,
    `.${PRINT_ROOT_CLASS}{display:none}`,
    "@media print{",
    "html,body{margin:0!important;padding:0!important;background:#fff!important;width:auto!important;height:auto!important;min-height:0!important;overflow:visible!important}",
    `body>*:not(.${PRINT_ROOT_CLASS}){display:none!important}`,
    `.${PRINT_ROOT_CLASS}{display:block!important;margin:0!important;padding:0!important}`,
    `.${PRINT_ROOT_CLASS} .gw-label-page{position:relative;width:${pw};height:${boxH};margin:0;padding:0;overflow:hidden;break-after:page;page-break-after:always;break-inside:avoid}`,
    `.${PRINT_ROOT_CLASS} .gw-label-page:last-child{break-after:auto;page-break-after:auto}`,
    `.${PRINT_ROOT_CLASS} .gw-label-art{position:absolute;left:0;top:0;width:${aw};height:${ah};transform-origin:0 0;transform:${g.transform}}`,
    `.${PRINT_ROOT_CLASS} .gw-label-art svg{display:block;width:${aw};height:${ah}}`,
    "*{-webkit-print-color-adjust:exact;print-color-adjust:exact}",
    "}",
  ].join("");
}

// ── Calibration (test) label ───────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * A test label at the stock's own size: a border 0.03″ inside the die edge,
 * corner brackets, a centre cross, 0.1″ ruler ticks along the top and left,
 * "TOP" + an arrow, the size, and the active settings. Print one: if the
 * border is complete and the cross is centred, every label will land right.
 */
export function testLabelSvg(stock: LabelStock, calibration: PrintCalibration, printer: PrinterProfile = ROLLO_X1040): string {
  const W = stock.acrossIn;
  const H = stock.feedIn;
  const U = 1000;
  const u = (n: number) => String(Math.round(n * U * 10) / 10);
  const g = pageGeometry(stock, calibration);
  const c = sanitizeCalibration(calibration);
  const p: string[] = [];
  const sw = 0.012;
  const inset = 0.03;
  p.push(`<rect x="0" y="0" width="${u(W)}" height="${u(H)}" fill="#fff"/>`);
  if (stock.shape === "circle") {
    p.push(`<circle cx="${u(W / 2)}" cy="${u(H / 2)}" r="${u(W / 2 - inset)}" fill="none" stroke="#000" stroke-width="${u(sw)}"/>`);
  } else {
    p.push(`<rect x="${u(inset)}" y="${u(inset)}" width="${u(W - 2 * inset)}" height="${u(H - 2 * inset)}" fill="none" stroke="#000" stroke-width="${u(sw)}"/>`);
    const b = Math.min(W, H) * 0.18;
    for (const [x, y, dx, dy] of [
      [inset, inset, 1, 1],
      [W - inset, inset, -1, 1],
      [inset, H - inset, 1, -1],
      [W - inset, H - inset, -1, -1],
    ] as const) {
      p.push(`<path d="M${u(x)} ${u(y + dy * b)} L${u(x)} ${u(y)} L${u(x + dx * b)} ${u(y)}" fill="none" stroke="#000" stroke-width="${u(sw * 3)}"/>`);
    }
    // Ruler ticks every 0.1″ (longer every 0.5″) along the top and left.
    for (let i = 1; i * 0.1 < W - inset; i++) {
      const x = i * 0.1;
      const len = i % 5 === 0 ? 0.09 : 0.045;
      p.push(`<line x1="${u(x)}" y1="${u(inset)}" x2="${u(x)}" y2="${u(inset + len)}" stroke="#000" stroke-width="${u(sw)}"/>`);
    }
    for (let i = 1; i * 0.1 < H - inset; i++) {
      const y = i * 0.1;
      const len = i % 5 === 0 ? 0.09 : 0.045;
      p.push(`<line x1="${u(inset)}" y1="${u(y)}" x2="${u(inset + len)}" y2="${u(y)}" stroke="#000" stroke-width="${u(sw)}"/>`);
    }
  }
  // Centre cross.
  const cx = W / 2;
  const cy = H / 2;
  const arm = Math.min(W, H) * 0.12;
  p.push(`<line x1="${u(cx - arm)}" y1="${u(cy)}" x2="${u(cx + arm)}" y2="${u(cy)}" stroke="#000" stroke-width="${u(sw)}"/>`);
  p.push(`<line x1="${u(cx)}" y1="${u(cy - arm)}" x2="${u(cx)}" y2="${u(cy + arm)}" stroke="#000" stroke-width="${u(sw)}"/>`);
  // Text: TOP ▲, size, settings.
  const big = Math.max(0.07, Math.min(0.2, H * 0.13));
  const small = Math.max(0.05, Math.min(0.11, H * 0.075));
  const font = `font-family="Arial, Helvetica, sans-serif" text-anchor="middle" fill="#000"`;
  p.push(`<text x="${u(cx)}" y="${u(inset + 0.1 + big)}" ${font} font-size="${u(big)}" font-weight="700">▲ TOP ▲</text>`);
  const lines = [
    `${stockSizeText(stock)} · ${printer.dpi} dpi`,
    `${ORIENTATION_LABEL[c.orientation]}${c.orientation === "auto" ? ` → ${ORIENTATION_LABEL[g.orientation]}` : ""}`,
    `Nudge ${c.offsetXIn >= 0 ? "+" : ""}${c.offsetXIn.toFixed(2)}″ / ${c.offsetYIn >= 0 ? "+" : ""}${c.offsetYIn.toFixed(2)}″ · ${c.scalePct}%`,
  ];
  const startY = H - inset - 0.06 - small * (lines.length - 1) * 1.2;
  lines.forEach((t, i) => {
    p.push(`<text x="${u(cx)}" y="${u(startY + i * small * 1.2)}" ${font} font-size="${u(small)}">${esc(t)}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}in" height="${H}in" viewBox="0 0 ${u(W)} ${u(H)}" role="img" aria-label="Printer test label">${p.join("")}</svg>`;
}

// ── Setup guidance ─────────────────────────────────────────────────────────

export type ClientOs = "mac" | "windows" | "chromeos" | "ios" | "android" | "other";

/** Best-effort OS from navigator.userAgent / platform (no fingerprinting beyond this). */
export function detectOs(userAgent: string, platform = ""): ClientOs {
  const ua = `${userAgent} ${platform}`.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/cros/.test(ua)) return "chromeos";
  if (/mac/.test(ua)) return "mac";
  if (/win/.test(ua)) return "windows";
  return "other";
}

function inchText(n: number): string {
  return `${Math.round(n * 1000) / 1000}`;
}

/**
 * The exact print-dialog settings for this label on this OS, given how the
 * page will be sent. When the page is rotated (portrait), the paper size the
 * driver needs is still the label's real size; the orientation line says so.
 */
export function dialogSteps(os: ClientOs, stock: LabelStock, printer: PrinterProfile, g: PageGeometry): string[] {
  const size = `${inchText(stock.acrossIn)}″ wide × ${inchText(stock.feedIn)}″ tall`;
  const mm = `${Math.round(stock.acrossIn * 25.4)} × ${Math.round(stock.feedIn * 25.4)} mm`;
  const steps: string[] = [`Printer: ${printer.name}.`];
  if (os === "mac") {
    steps.push(`Paper size: your ${size} custom size (Paper Size → Manage Custom Sizes… → width ${inchText(stock.acrossIn)} in, height ${inchText(stock.feedIn)} in, all four margins 0, “User defined” non-printable area). Name it e.g. “Rollo ${inchText(stock.acrossIn)}x${inchText(stock.feedIn)}”.`);
  } else if (os === "windows") {
    steps.push(`Paper size: ${size} (${mm}). If it isn't in the list, set the Rollo's Media to this size on its web page first.`);
  } else {
    steps.push(`Paper size: ${size} (${mm}).`);
  }
  steps.push("Margins: None. Scale: Default / 100% (Actual size) — not “Fit to page”.");
  steps.push("Turn off “Headers and footers”; “Background graphics” on.");
  if (g.orientation !== "straight") {
    steps.push("Layout: leave Portrait. The studio already turned the artwork (Turned mode, for drivers that turn wide pages; Chromium issue 372435414).");
  } else {
    steps.push("Layout: if Chrome shows a Layout choice, leave it as it is. The page is already the label's exact size.");
  }
  return steps;
}

/**
 * D196: Rollo's documented Windows setup for custom sizes on the Wireless Rollo
 * (support article 29000051200). Done once per computer, then once per new
 * label size (step 5 only).
 */
export function windowsRolloDriverSteps(stock: LabelStock): string[] {
  const wmm = Math.round(stock.acrossIn * 25.4);
  const hmm = Math.round(stock.feedIn * 25.4);
  return [
    "Download and install Rollo's Windows driver: rollo.com/driver-dl/Rollo-Windows-Latest.zip.",
    "Find the printer's network name: it is in the address bar of the Rollo web page you set Media on (like rollo-e8-54-7a.local). Or hold the Rollo's Wi-Fi button 2–3 seconds to print a network page that shows it.",
    "Control Panel → Devices and Printers → Add a printer → “The printer that I want isn't listed” → “Add a printer using a TCP/IP address or hostname”. Device type TCP/IP Device, type the network name, then Next.",
    "Pick Rollo and the Rollo driver (“Use the driver that is currently installed”). Name it “Rollo Labels” so it's easy to spot. Finish.",
    `Settings → Printers & scanners → Rollo Labels → Printing preferences → Settings tab: Form name ${stockSizeText(stock).replace(/\s/g, "")}, Width ${wmm} mm, Height ${hmm} mm, Left/Right/Top/Bottom 0 → Save → Apply. Orientation/Rotate: Normal. Print position adjustment: 0 and 0.`,
    "In the studio, Orientation Auto, press 🎯 Print test label and choose Rollo Labels as the destination.",
  ];
}

/** What to try next for each symptom (all observable on the test label). */
export const SYMPTOM_FIXES: ReadonlyArray<{ symptom: string; fix: string }> = [
  {
    symptom: "The design comes out sideways and runs across two labels (QR code on one, the name on the next)",
    fix: "The printer got a page turned the wrong way, so it printed it down two labels. The design is fine. Set Orientation to Auto (it now sends the label exactly its own size). On the Rollo's web page → Printing Defaults, set Orientation to the upright “A” (not “?”) and Save. Print a 🎯 test label. If it still runs down two labels on Windows, add the Rollo with Rollo's own driver (Windows: one-time printer setup).",
  },
  {
    symptom: "Two labels come out — the first blank, the second cut off",
    fix: "Check Chrome's Margins say None and the paper size is this label, not 4×6. Then print a 🎯 test label.",
  },
  {
    symptom: "Image is sideways",
    fix: "Try Straight first, then Turned ↻ / ↺, with a 🎯 test label each time. On the Rollo's web page, Orientation should be the upright “A”. On Mac, also check Printer Features → Rotate is 0. With Rollo's Windows driver, Orientation/Rotate must be Normal.",
  },
  {
    symptom: "Everything is shifted / one edge is clipped",
    fix: "Use Nudge: if the border is cut on the bottom, nudge up (−); cut on the right, nudge left (−). 0.01″ = 2 printer dots.",
  },
  {
    symptom: "Border is cut on every side / image too big",
    fix: "Set Scale to 97–98%, or check Scale is 100% (not Fit) in the dialog.",
  },
  {
    symptom: "It prints on every other label, or drifts down the roll",
    fix: "The printer lost the gap between labels. The Wireless Rollo re-learns it by itself when labels are loaded: take the roll out, feed it back in from the back with the guides touching its edges, and let it feed. (A USB Rollo: hold the top button until it beeps.) On the Rollo's web page, Media → Label Separator must be Gap.",
  },
  {
    symptom: "Print is faint or bars bleed together",
    fix: "On the Rollo's web page → Printing Defaults: raise Print Darkness (or lower Print Speed) if faint; lower Darkness if the bars bleed.",
  },
];

// ── Self-tests ─────────────────────────────────────────────────────────────

export function __runLabelPrintTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL label-print-core:", msg);
    }
  };
  const wide = stockById("rollo-2x1")!;
  const tall = stockById("rollo-4x6")!;
  const sqR = customStock(2, 2, "rect");
  const sq = sqR.ok ? sqR.stock : tall;
  ok(sqR.ok, "custom 2x2 stock");
  const D = DEFAULT_CALIBRATION;

  // Sanitise.
  ok(JSON.stringify(sanitizeCalibration(null)) === JSON.stringify(D), "null → default");
  const s1 = sanitizeCalibration({ orientation: "rotate_ccw", offsetXIn: 0.333, offsetYIn: -9, scalePct: 200 });
  ok(s1.orientation === "rotate_ccw" && s1.offsetXIn === 0.25 && s1.offsetYIn === -0.25 && s1.scalePct === 105, "clamped");
  ok(sanitizeCalibration({ offsetXIn: "0.037" }).offsetXIn === 0.04, "rounded to 0.01 step");
  ok(sanitizeCalibration({ orientation: "sideways", scalePct: "x" }).orientation === "auto" && sanitizeCalibration({ scalePct: "x" }).scalePct === 100, "junk → default");
  ok(sanitizeCalibration({ offsetYIn: -0.001 }).offsetYIn === 0 && !Object.is(sanitizeCalibration({ offsetYIn: -0.001 }).offsetYIn, -0), "no negative zero");
  ok(isDefaultCalibration(D) && !isDefaultCalibration({ ...D, scalePct: 99 }), "isDefault");

  // Storage map.
  const m1 = withCalibration({}, "rollo-2x1", { ...D, offsetYIn: -0.03 });
  ok(calibrationFor(m1, "rollo-2x1").offsetYIn === -0.03 && calibrationFor(m1, "rollo-4x6").offsetYIn === 0, "per-stock map");
  ok(!("rollo-2x1" in withCalibration(m1, "rollo-2x1", D)), "default removes entry");
  ok(Object.keys(withCalibration({ "<bad>": {}, ok1: { scalePct: 98 } }, "x", D)).join() === "ok1", "bad keys dropped");
  ok(calibrationFor("garbage", "x").orientation === "auto" && calibrationFor({ toString: 1 }, "toString").orientation === "auto", "garbage map safe");

  // Orientation.
  ok(isWideLabel(wide) && !isWideLabel(tall) && !isWideLabel(sq), "wide detection");
  ok(resolveOrientation(wide, D) === "straight", "D196: auto sends wide labels straight (owner photo: the turned page ran across two labels)");
  ok(resolveOrientation(tall, D) === "straight" && resolveOrientation(sq, D) === "straight", "auto leaves tall/square");
  ok(resolveOrientation(wide, { ...D, orientation: "straight" }) === "straight", "manual straight");

  // Geometry: wide + auto = the label's own 2×1 page (D196).
  const g0 = pageGeometry(wide, D);
  ok(g0.pageWIn === 2 && g0.pageHIn === 1 && g0.transform === "none", "D196: 2x1 auto = 2x1 page, no transform");
  ok(printCss(wide).includes("@page { size: 2in 1in; margin: 0 !important; }"), "D196: 2x1 auto css page is the label size");
  // Turned ↻ (manual): portrait page 1×2.
  const g1 = pageGeometry(wide, { ...D, orientation: "rotate_cw" });
  ok(g1.pageWIn === 1 && g1.pageHIn === 2 && !g1.landscapePage, "2x1 goes out as a 1x2 portrait page");
  ok(g1.transform === "translate(1in,0in) rotate(90deg)", `cw transform (${g1.transform})`);
  const g2 = pageGeometry(wide, { ...D, orientation: "straight" });
  ok(g2.pageWIn === 2 && g2.pageHIn === 1 && g2.landscapePage && g2.transform === "none", "straight 2x1 is landscape, no transform");
  const g3 = pageGeometry(tall, D);
  ok(g3.pageWIn === 4 && g3.pageHIn === 6 && g3.transform === "none", "4x6 unchanged");
  const g4 = pageGeometry(wide, { ...D, orientation: "rotate_ccw" });
  ok(g4.transform === "translate(0in,2in) rotate(-90deg)", "ccw transform");

  // Every corner of the artwork lands on the page corners (no clipping).
  const corners = (g: PageGeometry, c: PrintCalibration) =>
    [
      [0, 0],
      [g.artWIn, 0],
      [0, g.artHIn],
      [g.artWIn, g.artHIn],
    ].map(([x, y]) => mapPoint(g, c, x, y));
  const inPage = (g: PageGeometry, pts: Array<{ x: number; y: number }>) => pts.every((p) => p.x >= -1e-6 && p.y >= -1e-6 && p.x <= g.pageWIn + 1e-6 && p.y <= g.pageHIn + 1e-6);
  for (const o of ORIENTATIONS) {
    for (const st of [wide, tall, sq]) {
      const c = { ...D, orientation: o };
      const g = pageGeometry(st, c);
      ok(inPage(g, corners(g, c)), `corners inside page (${st.id}, ${o})`);
    }
  }
  // CW: the label's top-left ends up at the page's top-right; label "up" faces page-right.
  const tl = mapPoint(g1, D, 0, 0);
  ok(tl.x === 1 && tl.y === 0, "cw: label top-left → page top-right");
  const tr = mapPoint(g1, D, 2, 0);
  ok(tr.x === 1 && tr.y === 2, "cw: label top-right → page bottom-right");
  // CCW: the label's top-left ends up at the page's bottom-left.
  const tl4 = mapPoint(g4, { ...D, orientation: "rotate_ccw" }, 0, 0);
  ok(tl4.x === 0 && tl4.y === 2, "ccw: label top-left → page bottom-left");

  // Nudge is in the LABEL frame: "down" on the label stays "down" after rotation.
  const CW = { ...D, orientation: "rotate_cw" as const };
  const cDown = { ...CW, offsetYIn: 0.05 };
  const gDown = pageGeometry(wide, cDown);
  const a = mapPoint(gDown, cDown, 1, 0.5);
  const b = mapPoint(g1, D, 1, 0.5);
  ok(Math.abs(a.x - (b.x - 0.05)) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, "label-down nudge = page-left on cw");
  ok(gDown.transform.endsWith("translate(0in,0.05in)"), "nudge applied in label frame (last)");
  // Scale about page centre: the centre doesn't move.
  const cS = { ...D, scalePct: 96 };
  const gS = pageGeometry(tall, cS);
  const mid = mapPoint(gS, cS, 2, 3);
  ok(Math.abs(mid.x - 2) < 1e-6 && Math.abs(mid.y - 3) < 1e-6, "scale keeps centre");
  ok(gS.transform.startsWith("translate(0.08in,0.12in) scale(0.96)"), `scale transform (${gS.transform})`);

  // CSS.
  const css = printCss(wide, CW);
  ok(css.includes("@page { size: 1in 2in; margin: 0 !important; }"), "rotated page css is portrait");
  ok(printCss(wide, { ...D, orientation: "straight" }).includes("@page { size: 2in 1in;"), "straight page css");
  ok(css.includes("height:1.99in") && css.includes("overflow:hidden"), "page box a hair short, clipped");
  ok(css.includes(":last-child{break-after:auto"), "no trailing blank page");
  ok(css.includes("transform:translate(1in,0in) rotate(90deg)") && css.includes("transform-origin:0 0"), "art transform in css");
  ok(css.includes(".gw-label-art svg{display:block;width:2in;height:1in}"), "art keeps label size");
  ok(css.includes(`body>*:not(.${PRINT_ROOT_CLASS}){display:none!important}`) && !/[<>]/.test(css.replace(/body>\*/g, "")), "hides chrome, no markup");
  ok(printCss(tall).includes("@page { size: 4in 6in; margin: 0 !important; }") && printCss(tall).includes("transform:none"), "4x6 css");

  // Test label.
  const t = testLabelSvg(wide, D);
  ok(t.startsWith("<svg") && t.includes('width="2in" height="1in"') && t.includes("TOP"), "test label svg");
  ok(t.includes("Auto (recommended) → Straight") && t.includes("2″ × 1″"), "test label states settings");
  ok(testLabelSvg(stockById("rollo-circle-2")!, D).includes("<circle"), "circle test label");
  ok(!testLabelSvg(wide, { ...D, offsetXIn: -0.02 }).includes("<script"), "no script");
  ok(testLabelSvg(wide, { ...D, offsetXIn: -0.02 }).includes("Nudge -0.02″"), "test label shows nudge");

  // OS + steps.
  ok(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)") === "mac", "mac");
  ok(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)") === "windows", "windows");
  ok(detectOs("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)") === "ios" && detectOs("Mozilla/5.0 (Linux; Android 14)") === "android", "ios/android");
  ok(detectOs("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)") === "chromeos" && detectOs("") === "other", "chromeos/other");
  const mac = dialogSteps("mac", wide, ROLLO_X1040, g1);
  ok(mac.some((s) => s.includes("Manage Custom Sizes") && s.includes("width 2 in, height 1 in")), "mac custom size step");
  ok(mac.some((s) => s.includes("leave Portrait")), "turned → portrait advice");
  const win = dialogSteps("windows", wide, ROLLO_X1040, g2);
  ok(win.some((s) => s.includes("51 × 25 mm")), "windows mm step");
  ok(win.some((s) => s.includes("exact size")), "straight → leave layout");
  const wd = windowsRolloDriverSteps(wide);
  ok(wd.length >= 5 && wd.some((s) => s.includes("TCP/IP")) && wd.some((s) => s.includes("Width 51 mm, Height 25 mm") && s.includes("Normal")), "windows Rollo driver steps (Rollo 29000051200)");
  ok(SYMPTOM_FIXES[0].symptom.includes("across two labels") && SYMPTOM_FIXES[0].fix.includes("upright"), "D196 symptom first");
  // D196: every catalogue size defaults to its own page size, never turned.
  for (const st of [wide, tall, sq, stockById("rollo-circle-2")!]) {
    const g = pageGeometry(st, D);
    ok(g.pageWIn === st.acrossIn && g.pageHIn === st.feedIn && g.transform === "none", `D196 auto straight (${st.id})`);
  }
  ok(SYMPTOM_FIXES.length >= 6 && SYMPTOM_FIXES.some((f) => f.symptom.includes("first blank")), "symptom table");

  return { passed, failed };
}
