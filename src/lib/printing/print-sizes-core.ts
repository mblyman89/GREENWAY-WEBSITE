/**
 * print-sizes-core: D263 Print Studio S1. Pure.
 *
 * Owner (D263, verbatim): "Physical banners will typically be 6' x 12'. Flyers
 * are 8.5" x 11". Stickers will be small. ... I will use vista print for the
 * banners and stickers, and will print myself the flyers and other in store
 * print outs. Add in preset sizes for pendant flags, sandwich boards, yard
 * signs, upright style banners like retractable and non retractable. Plus
 * others I am not thinking of right now that vista print has to offer."
 *
 * Every size below is the TRIM size in inches as listed on vistaprint.com
 * (scraped 2026-11 during D263 recon, see PRINT_STUDIO_RECON.md section 3).
 * `verified: false` = Vistaprint's page did not show exact print dimensions
 * (feather / teardrop flags, pole banners, hanging pennants), so the size is a
 * common industry size: confirm it on the Vistaprint product page before you
 * order. File facts (verified): Vistaprint accepts PDF/JPG/PNG/TIFF; banners
 * "300 dpi at final size"; retractables / flyers 150+ DPI (300 recommended);
 * yard signs 0.125" bleed; flyers 0.125" full bleed.
 */
import { cardDesign, printRatio, pxForPt, type BannerDesign, type DesignPrint } from "@/lib/cms/banner-design-core";

export type PrintVendor = "vistaprint" | "self";
/** Where it hangs: drives the compliance check (WAC 314-55-155) and DPI. */
export type PrintPlacement = "outdoor" | "window" | "instore" | "handout" | "sticker";
export type PrintGroup =
  | "Banners"
  | "Upright banners"
  | "Flags"
  | "Yard & A-frame signs"
  | "Posters & boards"
  | "Flyers & cards"
  | "Stickers & decals"
  | "Custom";

export type PrintPreset = {
  id: string;
  group: PrintGroup;
  label: string;
  /** Trim size, inches. */
  w: number;
  h: number;
  vendor: PrintVendor;
  placement: PrintPlacement;
  /** Typical reading distance in feet (drives the DPI advice). */
  viewFt: number;
  bleed: number;
  safe: number;
  verified: boolean;
  note?: string;
};

const FT = 12;
const BLEED = 0.125;

type Seed = [id: string, label: string, w: number, h: number, extra?: Partial<PrintPreset>];

function group(g: PrintGroup, base: Omit<PrintPreset, "id" | "group" | "label" | "w" | "h">, seeds: Seed[]): PrintPreset[] {
  return seeds.map(([id, label, w, h, extra]) => ({ id, group: g, label, w, h, ...base, ...(extra ?? {}) }));
}

const vinyl = (wFt: number, hFt: number): Seed => [`banner-${hFt}x${wFt}`, `Vinyl banner ${hFt}' x ${wFt}'`, wFt * FT, hFt * FT];

export const PRINT_PRESETS: readonly PrintPreset[] = [
  ...group("Banners", { vendor: "vistaprint", placement: "outdoor", viewFt: 15, bleed: 0, safe: 1.5, verified: true, note: "Vistaprint adds grommets about 1\" in from the edge: keep words out of the safe margin." }, [
    ["banner-6x12", "Vinyl banner 6' x 12' (your usual)", 12 * FT, 6 * FT],
    vinyl(10, 6),
    vinyl(8, 4),
    vinyl(6, 4),
    vinyl(10, 4),
    vinyl(12, 4),
    vinyl(4, 4),
    vinyl(4, 2.5),
    vinyl(6, 2.5),
    vinyl(8, 2.5),
    vinyl(10, 2.5),
    vinyl(12, 2.5),
    vinyl(3, 1.7),
    vinyl(2, 1),
    vinyl(10, 8),
    vinyl(12, 8),
    ["mesh-4x8", "Mesh banner 4' x 8' (windy spots, fences)", 8 * FT, 4 * FT],
    ["mesh-6x12", "Mesh banner 6' x 12'", 12 * FT, 6 * FT],
  ]),
  ...group("Upright banners", { vendor: "vistaprint", placement: "instore", viewFt: 6, bleed: 0, safe: 1, verified: true, note: "The bottom 6-8\" can hide in the stand: keep words above it." }, [
    ["retract-33x81", "Retractable banner 33\" x 81\" (most popular)", 33, 81],
    ["retract-24x81", "Retractable banner 24\" x 81\"", 24, 81],
    ["retract-24x62", "Retractable banner 24\" x 62\" (tabletop)", 24, 62],
    ["retract-47x81", "Retractable banner 47\" x 81\" (wide)", 47, 81],
    ["xbanner-23x63", "X-banner 23.75\" x 63\" (non-retractable)", 23.75, 63],
    ["xbanner-31x70", "X-banner 31.5\" x 70.5\" (non-retractable)", 31.5, 70.5],
  ]),
  ...group("Flags", { vendor: "vistaprint", placement: "outdoor", viewFt: 20, bleed: 0, safe: 1, verified: true }, [
    ["flag-3x5", "Flag 3' x 5'", 5 * FT, 3 * FT],
    ["flag-2x3", "Flag 2' x 3'", 3 * FT, 2 * FT],
    ["flag-4x6", "Flag 4' x 6'", 6 * FT, 4 * FT],
    ["flag-5x8", "Flag 5' x 8'", 8 * FT, 5 * FT],
    ["flag-12x18", "Flag 12\" x 18\"", 18, 12],
    ["flag-28x28", "Flag 28\" x 28\"", 28, 28],
    ["feather-10", "Feather flag 10' (print area about 26\" x 103\")", 26, 103, { verified: false, note: "Size not listed on Vistaprint's page: confirm the print template there before ordering." }],
    ["feather-13", "Feather flag 13' (print area about 30\" x 136\")", 30, 136, { verified: false, note: "Size not listed on Vistaprint's page: confirm the print template there before ordering." }],
    ["teardrop-8", "Teardrop flag 8' (print area about 28\" x 74\")", 28, 74, { verified: false, note: "Size not listed on Vistaprint's page: confirm the print template there before ordering." }],
    ["pennant-12x18", "Pennant flag 12\" x 18\" (one triangle of a string)", 12, 18, { verified: false, note: "Hanging pennant sizes were not readable on Vistaprint: confirm before ordering. Design one pennant; the triangle shape is cut by the printer." }],
    ["pole-18x36", "Pole banner 18\" x 36\"", 18, 36, { verified: false, note: "Pole banner sizes were not readable on Vistaprint: confirm before ordering." }],
    ["pole-24x48", "Pole banner 24\" x 48\"", 24, 48, { verified: false, note: "Pole banner sizes were not readable on Vistaprint: confirm before ordering." }],
  ]),
  ...group("Yard & A-frame signs", { vendor: "vistaprint", placement: "outdoor", viewFt: 10, bleed: BLEED, safe: 0.5, verified: true }, [
    ["yard-18x24", "Yard sign 18\" x 24\" (most popular)", 24, 18],
    ["yard-24x18", "Yard sign 18\" x 24\" tall", 18, 24],
    ["yard-12x18", "Yard sign 12\" x 18\"", 18, 12],
    ["yard-9x12", "Yard sign 9\" x 12\"", 12, 9],
    ["yard-24x36", "Yard sign 24\" x 36\"", 36, 24],
    ["yard-24x24", "Yard sign 24\" x 24\"", 24, 24],
    ["yard-6x24", "Yard sign 6\" x 24\" (strip)", 24, 6],
    ["yard-48x96", "Big sign 48\" x 96\"", 96, 48],
    ["aframe-24x36", "Sandwich board / A-frame 24\" x 36\" (per side)", 24, 36, { placement: "outdoor" }],
    ["aframe-22x28", "Sandwich board / A-frame 22\" x 28\" (per side)", 22, 28, { placement: "outdoor" }],
  ]),
  ...group("Posters & boards", { vendor: "vistaprint", placement: "instore", viewFt: 4, bleed: BLEED, safe: 0.25, verified: true }, [
    ["poster-18x24", "Poster 18\" x 24\"", 18, 24],
    ["poster-24x36", "Poster 24\" x 36\"", 24, 36],
    ["poster-11x14", "Poster 11\" x 14\"", 11, 14],
    ["poster-12x18", "Poster 12\" x 18\"", 12, 18],
    ["foam-11x17", "Foam board 11\" x 17\"", 11, 17],
    ["foam-36x48", "Foam board 36\" x 48\"", 36, 48],
    ["window-24x36", "Window poster 24\" x 36\" (faces the street)", 24, 36, { placement: "window" }],
  ]),
  ...group("Flyers & cards", { vendor: "self", placement: "handout", viewFt: 1.5, bleed: BLEED, safe: 0.25, verified: true }, [
    ["flyer-letter", "Flyer 8.5\" x 11\" (print it yourself)", 8.5, 11],
    ["flyer-half", "Half-letter flyer 5.5\" x 8.5\"", 5.5, 8.5],
    ["flyer-legal", "Legal flyer 8.5\" x 14\"", 8.5, 14],
    ["flyer-tabloid", "Tabloid 11\" x 17\" (counter poster)", 11, 17, { placement: "instore" }],
    ["card-4x6", "Card / postcard 4\" x 6\"", 4, 6],
    ["card-5x7", "Card 5\" x 7\"", 5, 7],
    ["rack-card", "Rack card 4\" x 9\"", 4, 9],
    ["shelf-talker", "Shelf talker 3.5\" x 5\"", 3.5, 5, { placement: "instore" }],
    ["flyer-letter-vp", "Flyer 8.5\" x 11\" (Vistaprint)", 8.5, 11, { vendor: "vistaprint" }],
    ["rack-card-vp", "Rack card 3.74\" x 8.27\" (Vistaprint)", 3.74, 8.27, { vendor: "vistaprint" }],
  ]),
  ...group("Stickers & decals", { vendor: "vistaprint", placement: "sticker", viewFt: 1, bleed: BLEED, safe: 0.125, verified: true, note: "Die-cut stickers follow the cut line: keep everything 1/8\" inside it." }, [
    ["sticker-2", "Die-cut sticker 2\" x 2\"", 2, 2],
    ["sticker-3", "Die-cut sticker 3\" x 3\"", 3, 3],
    ["sticker-4", "Die-cut sticker 4\" x 4\"", 4, 4],
    ["sticker-5", "Die-cut sticker 5\" x 5\"", 5, 5],
    ["sticker-2_5", "Die-cut sticker 2.5\" x 2.5\"", 2.5, 2.5],
    ["sticker-3_5", "Die-cut sticker 3.5\" x 3.5\"", 3.5, 3.5],
    ["decal-12x12", "Window decal 12\" x 12\"", 12, 12, { placement: "window", viewFt: 6 }],
    ["decal-24x12", "Window decal 24\" x 12\"", 24, 12, { placement: "window", viewFt: 6 }],
  ]),
];

export function presetById(id: string): PrintPreset | null {
  return PRINT_PRESETS.find((p) => p.id === id) ?? null;
}

export function presetsByGroup(): { group: PrintGroup; items: PrintPreset[] }[] {
  const out: { group: PrintGroup; items: PrintPreset[] }[] = [];
  for (const p of PRINT_PRESETS) {
    const g = out.find((x) => x.group === p.group);
    if (g) g.items.push(p);
    else out.push({ group: p.group, items: [p] });
  }
  return out;
}

/** A custom size: inches, 0.5"-600". */
export function customPreset(w: number, h: number, placement: PrintPlacement = "instore", vendor: PrintVendor = "vistaprint"): { ok: true; preset: PrintPreset } | { ok: false; error: string } {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return { ok: false, error: "Type the width and height in inches." };
  if (w < 0.5 || h < 0.5) return { ok: false, error: "The smallest size is 0.5 inch." };
  if (w > 600 || h > 600) return { ok: false, error: "The largest size is 600 inches (50 feet)." };
  if (w / h > 10 || h / w > 10) return { ok: false, error: "One side can be at most 10x the other." };
  const big = Math.max(w, h);
  const viewFt = placement === "outdoor" ? (big >= 48 ? 15 : 10) : placement === "handout" || placement === "sticker" ? 1.5 : big >= 36 ? 6 : 4;
  return {
    ok: true,
    preset: { id: "custom", group: "Custom", label: `Custom ${fmtIn(w)} x ${fmtIn(h)}`, w: r3(w), h: r3(h), vendor, placement, viewFt, bleed: big >= 48 ? 0 : BLEED, safe: big >= 48 ? 1 : 0.25, verified: true },
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** 72 -> 6', 8.5 -> 8.5", 30 -> 30" (feet only for whole feet over 4'). */
export function fmtIn(inches: number): string {
  if (inches >= 48 && inches % 12 === 0) return `${inches / 12}'`;
  return `${r3(inches)}"`;
}

export function sizeLabel(p: Pick<PrintPreset, "w" | "h">): string {
  return `${fmtIn(p.w)} x ${fmtIn(p.h)}`;
}

/**
 * DPI that looks sharp from the reading distance (visual acuity ~ 1 arc
 * minute: DPI = 3438 / inches away, capped 300, floored by vendor rules).
 * Vistaprint: banners "300 dpi at final size" is their best case; large
 * pieces read from 10'+ look sharp at 100-150 DPI.
 */
export function recommendedDpi(p: Pick<PrintPreset, "viewFt" | "w" | "h">): number {
  const acuity = 3438 / Math.max(6, p.viewFt * 12);
  const raw = Math.max(acuity, 100);
  const steps = [100, 150, 200, 300];
  const pick = steps.find((s) => s >= raw) ?? 300;
  return Math.max(p.w * p.h <= 200 ? 300 : 0, pick);
}

export function pixelsAt(p: Pick<PrintPreset, "w" | "h" | "bleed">, dpi: number): { w: number; h: number; mp: number } {
  const w = Math.round((p.w + 2 * p.bleed) * dpi);
  const h = Math.round((p.h + 2 * p.bleed) * dpi);
  return { w, h, mp: Math.round((w * h) / 100_000) / 10 };
}

export function printOf(p: Pick<PrintPreset, "w" | "h" | "bleed" | "safe">): DesignPrint {
  return { w: p.w, h: p.h, bleed: p.bleed, safe: p.safe };
}

/** A fresh print design for this size: headline + line + required-words box, no picture overlay. */
export function newPrintDesign(p: PrintPreset): BannerDesign {
  const print = printOf(p);
  const ratio = printRatio(print);
  const d = cardDesign({ ratio, subtitle: true });
  const sz = (pt: number) => Math.max(2, Math.min(160, pxForPt(pt, print)));
  const big = Math.min(p.w, p.h);
  // Headline about 1/8 of the short side, line 1/20.
  const head = sz((big / 8) * 72);
  const sub = sz((big / 20) * 72);
  return {
    ...d,
    frame: { ...d.frame, radius: 0, card: { ratio, ratioMobile: ratio }, print },
    overlay: { kind: "none", color: "#000000", opacity: 0, direction: "bottom" },
    boxes: d.boxes.map((b) => ({ ...b, bind: null, text: b.role === "headline" ? "Your headline" : "Your message", size: b.role === "headline" ? head : sub, sizeMobile: b.role === "headline" ? head : sub })),
  };
}

/** Reshape a design to a new print size (keeps every layer; positions are %). */
export function applyPrintSize(design: BannerDesign, p: PrintPreset): BannerDesign {
  const print = printOf(p);
  const ratio = printRatio(print);
  return { ...design, frame: { ...design.frame, radius: 0, card: { ratio, ratioMobile: ratio }, print } };
}

/** Safe + bleed lines as % of the canvas (canvas = trim + bleed). */
export function guideInsets(print: DesignPrint): { trimX: number; trimY: number; safeX: number; safeY: number } {
  const W = print.w + 2 * print.bleed;
  const H = print.h + 2 * print.bleed;
  const pc = (v: number, of: number) => Math.round((v / of) * 100000) / 1000;
  return { trimX: pc(print.bleed, W), trimY: pc(print.bleed, H), safeX: pc(print.bleed + print.safe, W), safeY: pc(print.bleed + print.safe, H) };
}

export const PLACEMENT_LABEL: Record<PrintPlacement, string> = {
  outdoor: "Outdoors (faces the street)",
  window: "In a window (seen from outside)",
  instore: "Inside the store",
  handout: "Handout / take-home",
  sticker: "Sticker",
};

// -- Self-test ---------------------------------------------------------------

/** D263 S3: how sharp a W×H px picture prints across the whole canvas (bleed included). Warn-only. */
export type Sharpness = { dpi: number; tone: "good" | "ok" | "low"; text: string };
export function pictureSharpness(pxW: number, pxH: number, print: DesignPrint, need: number): Sharpness | null {
  if (!(pxW > 0 && pxH > 0)) return null;
  const W = print.w + 2 * print.bleed;
  const H = print.h + 2 * print.bleed;
  // cover-fit: the picture fills the canvas, so the smaller px/inch side decides.
  const dpi = Math.round(Math.min(pxW / W, pxH / H));
  const tone = dpi >= need ? "good" : dpi >= need * 0.6 ? "ok" : "low";
  const text =
    tone === "good"
      ? `Sharp: about ${dpi} DPI at this size (needs ${need}).`
      : tone === "ok"
        ? `Slightly soft: about ${dpi} DPI (best is ${need}). Fine from a distance; Enlarge 2× helps.`
        : `Will look blurry: about ${dpi} DPI (needs ${need}). Use Enlarge 2× or a bigger picture.`;
  return { dpi, tone, text };
}

export function __runPrintSizesTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => (c ? passed++ : failures.push(m));
  const ids = PRINT_PRESETS.map((p) => p.id);
  ok(new Set(ids).size === ids.length, "preset ids unique");
  const b = presetById("banner-6x12")!;
  ok(b.w === 144 && b.h === 72 && b.vendor === "vistaprint", "owner's 6x12 banner");
  ok(presetById("flyer-letter")!.vendor === "self", "flyers are self-printed");
  ok(PRINT_PRESETS.every((p) => p.w / p.h <= 10 && p.h / p.w <= 10), "every preset fits the print ratio range");
  ok(["aframe-24x36", "retract-33x81", "xbanner-23x63", "yard-18x24", "pennant-12x18", "sticker-3"].every((id) => presetById(id)), "owner's named products exist");
  ok(recommendedDpi(presetById("sticker-3")!) === 300 && recommendedDpi(b) <= 150, "dpi by distance");
  ok(pixelsAt(presetById("flyer-letter")!, 300).w === 2625, "flyer px incl. bleed");
  const d = newPrintDesign(presetById("flyer-letter")!);
  ok(!!d.frame.print && d.frame.card!.ratio === Math.round((8.75 / 11.25) * 10000) / 10000, "flyer design ratio incl. bleed");
  ok(customPreset(1, 20).ok === false && customPreset(24, 36).ok === true, "custom size checks");
  const g = guideInsets({ w: 8.5, h: 11, bleed: 0.125, safe: 0.25 });
  ok(g.trimX > 1.4 && g.trimX < 1.5 && g.safeX > g.trimX, "guide insets");
  ok(fmtIn(72) === "6'" && fmtIn(8.5) === '8.5"', "inch labels");
  const sp = pictureSharpness(3300, 2550, { w: 11, h: 8.5, bleed: 0, safe: 0.25 }, 300);
  ok(sp?.dpi === 300 && sp.tone === "good", "sharpness good");
  ok(pictureSharpness(1000, 500, { w: 144, h: 72, bleed: 0, safe: 1 }, 100)?.tone === "low", "sharpness low");
  ok(pictureSharpness(0, 0, { w: 1, h: 1, bleed: 0, safe: 0 }, 300) === null, "sharpness unknown");
  return { passed, failed: failures.length, failures };
}
