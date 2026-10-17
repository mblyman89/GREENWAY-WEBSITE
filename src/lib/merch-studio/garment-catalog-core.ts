/**
 * R70 S1 - Merch Studio garment catalog (PURE, no I/O).
 *
 * The curated starter set of premium blanks Greenway Glass & Goods can sell
 * one-at-a-time through Printful print-on-demand (just-in-time: nothing is
 * bought until a customer pays). Every number here is traceable:
 *
 *  - Colours, sizes, base prices: Printful public catalog API snapshot
 *    (garment-colors-data.ts, GENERATED, see PRINTFUL_SNAPSHOT_DATE).
 *  - Placement keys + upcharges: same API (`files[].id`, `additional_price`).
 *  - Fabric facts: Printful product descriptions from the same API.
 *  - Placement inches: Printful t-shirt / hat / hoodie placement guides
 *    (cited per placement via `dimsSource`). Where Printful only exposes the
 *    exact print area behind OAuth (v2 catalog / printfiles return 401), the
 *    placement is marked `dimsSource: "studio-default"` and the UI says so -
 *    we never present a guess as a fact (standing rule: never guess).
 *
 * Coordinates: inches. A placement frame is positioned on the garment view by
 * `topIn` (distance from the reference line: collar for tops, brim/cuff for
 * headwear) and `centerXIn` (offset of the frame centre from the garment
 * centre line, + = viewer's right, so the WEARER's left chest is +).
 */
import { PRINTFUL_COLORS, PRINTFUL_SIZES, PRINTFUL_SNAPSHOT_DATE, type ColorRow, type SizeRow } from "./garment-colors-data";

export { PRINTFUL_SNAPSHOT_DATE };

export type Method = "dtg" | "dtf" | "embroidery";
export type Category = "tee" | "longsleeve" | "hoodie" | "crew" | "zip" | "jacket" | "snapback" | "dad" | "trucker" | "beanie";
export type View = "front" | "back" | "left" | "right" | "inside";
export type ObstacleKind = "zipper" | "pouch" | "hood" | "seam" | "center-seam" | "mesh" | "collar";
export type DimsSource = "printful-tee-guide" | "printful-hat-guide" | "printful-hoodie-guide" | "industry-chart" | "studio-default";

export const METHOD_LABEL: Record<Method, string> = {
  dtg: "DTG (direct-to-garment)",
  dtf: "DTF (Printful DTFlex)",
  embroidery: "Embroidery",
};

/** Plain-English one-liners shown next to the method picker. Sources: R69 report section 3. */
export const METHOD_BLURB: Record<Method, string> = {
  dtg: "Ink sprayed into the fibres. Softest feel, unlimited colours and photos. Best on 100% cotton; on dark shirts it needs a white underbase.",
  dtf: "Printed on film and heat-pressed. Works on nearly any fabric, brightest colour on darks, very wash-durable. Slight film feel on big solid areas.",
  embroidery: "Sewn with thread. Premium, textured, lasts the life of the garment. Needs bold simple art: no gradients, no photos, min 0.25\" text.",
};

export interface Obstacle {
  kind: ObstacleKind;
  label: string;
  /** Rect inside the placement frame, inches from the frame's top-left. */
  x: number; y: number; w: number; h: number;
  /** blocker = decoration physically can't go there; warning = it will distort/hide. */
  severity: "blocker" | "warning";
}

export interface Placement {
  id: string;
  label: string;
  view: View;
  widthIn: number;
  heightIn: number;
  topIn: number;
  centerXIn: number;
  methods: Method[];
  /** Printful placement key per method (what the order API expects). */
  printfulKey: Partial<Record<Method, string>>;
  /** Printful placement upcharge per method, CENTS (rule 8). 0 = included. */
  upchargeCents: Partial<Record<Method, number>>;
  obstacles: Obstacle[];
  dimsSource: DimsSource;
  note?: string;
}

export interface Blank {
  id: string;
  printfulId: number;
  brand: string;
  model: string;
  title: string;
  category: Category;
  headwear: boolean;
  fabric: string;
  /** % cotton of the body fabric; null = Printful does not state the ratio. */
  cottonPct: number | null;
  weightOz: number | null;
  /** Hats: Printful's embroidery_type option (flat / 3D puff / partial puff). */
  puffAvailable: boolean;
  structured: boolean | null;
  premiumNote: string;
  placements: Placement[];
}

// ---------------------------------------------------------------------------
// Placement builders. Inches from the Printful guides (R69 section 6 + notes):
//  tee guide (May 14 2026): left chest 2.5-5" sq, ~3" below neckline;
//    full front 12x16, 3-4" below collar; emb left chest max 4x4, centre 4x4;
//    back 10x12 to 12x16; sleeve ~4x3.5; labels 3x3.
//  hat guide (Sep 4 2026): structured 4-5" x <=2.25"; trucker <=5x2;
//    dad 3.5-4 x 1.75-2; beanie 5 x 1.75-2; side 2-2.5 x 1-1.25;
//    back 2.25-3 x 0.75-1; centre 0.5-1" above brim.
//  hoodie guide (Jul 27 2026): emb left chest 3-4" wide; printed chest 3-5";
//    full front/back 10-12" wide; avoid hood, pocket, zipper, seams.
// ---------------------------------------------------------------------------

type Keys = Partial<Record<Method, [key: string, cents: number]>>;
function pl(
  id: string, label: string, view: View, w: number, h: number, top: number, cx: number,
  keys: Keys, dimsSource: DimsSource, obstacles: Obstacle[] = [], note?: string,
): Placement {
  const methods = (Object.keys(keys) as Method[]).filter((m) => keys[m]);
  const printfulKey: Partial<Record<Method, string>> = {};
  const upchargeCents: Partial<Record<Method, number>> = {};
  for (const m of methods) { const k = keys[m]!; printfulKey[m] = k[0]; upchargeCents[m] = k[1]; }
  return { id, label, view, widthIn: w, heightIn: h, topIn: top, centerXIn: cx, methods, printfulKey, upchargeCents, obstacles, dimsSource, note };
}

const LEFT_CHEST_NOTE = "Printed left-chest art rides inside Printful's front file (no extra placement fee for DTG). Embroidered left chest is its own placement.";

function frontFull(dtfKey = "front_dtf", dtfCents = 595, extraObs: Obstacle[] = [], h = 16, src: DimsSource = "printful-tee-guide"): Placement {
  return pl("front", "Full front", "front", 12, h, 3.5, 0, { dtg: ["default", 0], dtf: [dtfKey, dtfCents] }, src, extraObs);
}
function leftChest(emb = true, print = true): Placement {
  const k: Keys = {};
  if (print) { k.dtg = ["default", 0]; k.dtf = ["front_dtf", 595]; }
  if (emb) k.embroidery = ["embroidery_chest_left", 295];
  return pl("left_chest", "Left chest", "front", 4, 4, 3, 4, k, "printful-tee-guide", [], LEFT_CHEST_NOTE);
}
const centerChestEmb = (): Placement =>
  pl("center_chest_emb", "Center chest (embroidery)", "front", 4, 4, 3, 0, { embroidery: ["embroidery_chest_center", 295] }, "printful-tee-guide");
const backFull = (dtf = true, top = 4): Placement =>
  pl("back", "Full back", "back", 12, 16, top, 0, dtf ? { dtg: ["back", 595], dtf: ["back_dtf", 595] } : { dtg: ["back", 595] }, "printful-tee-guide");
function sleeves(long: boolean, emb: boolean, dtf = true): Placement[] {
  const c = long ? 595 : 249;
  const mk = (side: "left" | "right") => {
    const k: Keys = { dtg: [`sleeve_${side}`, c] };
    if (dtf) k.dtf = [long ? `long_sleeve_${side}_dtf` : `short_sleeve_${side}_dtf`, c];
    if (emb) k.embroidery = [`embroidery_sleeve_${side}_top`, 295];
    return pl(`sleeve_${side}`, `${side === "left" ? "Left" : "Right"} sleeve`, side, 4, 3.5, 1.5, 0, k, "printful-tee-guide");
  };
  return [mk("left"), mk("right")];
}
const labelOutside = (cents = 249): Placement =>
  pl("label_outside", "Outside back-neck label", "back", 3, 3, 1, 0, { dtg: ["label_outside", cents] }, "printful-tee-guide", [], "Premium private-label finish under the collar.");
const labelInside = (dtg = true, dtf = true): Placement => {
  const k: Keys = {};
  if (dtg) k.dtg = ["label_inside", 99];
  if (dtf) k.dtf = ["label_inside_dtf", 99];
  return pl("label_inside", "Inside neck label", "inside", 3, 3, 0.5, 0, k, "printful-tee-guide", [], "Replaces the maker's tag look: logo <=3x1.13\", fonts >=10pt (Printful).");
};
function wrists(): Placement[] {
  const mk = (side: "left" | "right") =>
    pl(`wrist_${side}`, `${side === "left" ? "Left" : "Right"} wrist`, side, 3, 1.25, 20, 0, { embroidery: [`embroidery_wrist_${side}`, 295] }, "studio-default", [], "Small text or icon above the cuff rib.");
  return [mk("left"), mk("right")];
}

const POUCH = (w: number, h: number, frameH: number): Obstacle => ({ kind: "pouch", label: "Kangaroo pouch opening", x: (12 - w) / 2, y: frameH - h, w, h, severity: "warning" });
const ZIPPER = (frameW: number, frameH: number): Obstacle => ({ kind: "zipper", label: "Zipper", x: frameW / 2 - 0.5, y: 0, w: 1, h: frameH, severity: "blocker" });
const HOOD_DRAPE: Obstacle = { kind: "hood", label: "Hood drape (covers art when the hood is down)", x: 0, y: 0, w: 12, h: 1.5, severity: "warning" };

// Headwear --------------------------------------------------------------------
const seam = (w: number, h: number): Obstacle => ({ kind: "center-seam", label: "Center front seam (6-panel)", x: w / 2 - 0.06, y: 0, w: 0.12, h, severity: "warning" });
function hatFront(w: number, h: number, keys: Keys, sixPanel: boolean, note?: string): Placement {
  // topIn for headwear = distance of frame BOTTOM above the brim, Printful: 0.5-1".
  return pl("hat_front", "Front", "front", w, h, 0.75, 0, keys, "printful-hat-guide", sixPanel ? [seam(w, h)] : [], note);
}
const hatSide = (side: "left" | "right"): Placement =>
  pl(`hat_${side}`, `${side === "left" ? "Left" : "Right"} side`, side, 2.5, 1.25, 0.75, 0, { embroidery: [side, 295] }, "printful-hat-guide", [], "<=10 characters per line, minimalist.");
const hatBack = (): Placement =>
  pl("hat_back", "Back (above closure)", "back", 3, 1, 0.5, 0, { embroidery: ["back", 295] }, "printful-hat-guide", [], "Arched text suits the back.");

// The catalog -----------------------------------------------------------------
export const BLANKS: readonly Blank[] = [
  {
    id: "cc-1717", printfulId: 586, brand: "Comfort Colors", model: "1717", title: "Garment-Dyed Heavyweight Tee", category: "tee", headwear: false,
    fabric: "100% ring-spun cotton, garment-dyed", cottonPct: 100, weightOz: 6.1, puffAvailable: false, structured: null,
    premiumNote: "Heavy vintage hand, twill-taped neck & shoulders. The streetwear favourite and our hero tee.",
    placements: [frontFull(), leftChest(), centerChestEmb(), backFull(), ...sleeves(false, true), labelOutside()],
  },
  {
    id: "bc-3001", printfulId: 71, brand: "Bella + Canvas", model: "3001", title: "Staple Tee", category: "tee", headwear: false,
    fabric: "100% combed ring-spun cotton (heather colours contain polyester)", cottonPct: 100, weightOz: 4.2, puffAvailable: false, structured: null,
    premiumNote: "Soft retail fit, 84 colours, inside-label option. Backup tee (different mill from the 1717).",
    placements: [frontFull(), leftChest(), centerChestEmb(), backFull(), ...sleeves(false, true), labelOutside(), labelInside()],
  },
  {
    id: "cc-6014", printfulId: 753, brand: "Comfort Colors", model: "6014", title: "Garment-Dyed Heavyweight Long Sleeve", category: "longsleeve", headwear: false,
    fabric: "100% ring-spun cotton, garment-dyed", cottonPct: 100, weightOz: 6.1, puffAvailable: false, structured: null,
    premiumNote: "Same hand as the 1717 with long sleeves - sleeve prints are the premium move.",
    placements: [frontFull(), leftChest(), centerChestEmb(), backFull(), ...sleeves(true, false), labelOutside()],
  },
  {
    id: "ind-4000", printfulId: 1543, brand: "Independent Trading Co.", model: "IND4000", title: "Heavyweight Hoodie", category: "hoodie", headwear: false,
    fabric: "Cotton/polyester blend fleece (Printful does not state the ratio)", cottonPct: null, weightOz: 10, puffAvailable: false, structured: null,
    premiumNote: "10 oz heavyweight streetwear hoodie, wrist embroidery available.",
    placements: [
      { ...frontFull("front_dtf", 595, [POUCH(9, 2, 11)], 11, "studio-default"), note: "Printful hoodie guide: full front 10-12\" wide; height kept above the pouch (studio default - confirm in Printful's file template)." },
      leftChest(),
      pl("right_chest_emb", "Right chest (embroidery)", "front", 4, 4, 3, -4, { embroidery: ["embroidery_chest_right", 295] }, "printful-hoodie-guide"),
      centerChestEmb(),
      { ...backFull(true, 5), obstacles: [HOOD_DRAPE], dimsSource: "printful-hoodie-guide", note: "Back art sits below the hood seam (Printful hoodie guide)." },
      ...sleeves(true, false), ...wrists(), labelOutside(), labelInside(false, true),
    ],
  },
  {
    id: "cc-1566", printfulId: 839, brand: "Comfort Colors", model: "1566", title: "Garment-Dyed Crewneck Sweatshirt", category: "crew", headwear: false,
    fabric: "80% ring-spun cotton / 20% polyester, 100% cotton face", cottonPct: 80, weightOz: 9.5, puffAvailable: false, structured: null,
    premiumNote: "Thrifted vintage-wash feel; cotton face takes DTG well.",
    placements: [frontFull(), leftChest(), centerChestEmb(), backFull(), ...sleeves(true, false), ...wrists(), labelOutside(99)],
  },
  {
    id: "l7-14003", printfulId: 943, brand: "Lane Seven", model: "LS14003", title: "Full-Zip Hoodie", category: "zip", headwear: false,
    fabric: "80% cotton / 20% recycled polyester (heathers differ)", cottonPct: 80, weightOz: 8.3, puffAvailable: false, structured: null,
    premiumNote: "Zip front: put the hero art on the back, a chest hit on the front.",
    placements: [
      pl("front", "Front (split by zipper)", "front", 12, 10, 3.5, 0, { dtg: ["default", 0] }, "studio-default", [ZIPPER(12, 10), POUCH(10, 2, 10)], "Zipper splits the front - keep art left or right of it."),
      pl("left_chest", "Left chest (embroidery)", "front", 4, 4, 3, 4, { embroidery: ["embroidery_chest_left", 295] }, "printful-hoodie-guide"),
      { ...backFull(false, 5), obstacles: [HOOD_DRAPE], dimsSource: "printful-hoodie-guide" },
      ...sleeves(true, false, false), labelOutside(),
    ],
  },
  {
    id: "ind-exp54", printfulId: 629, brand: "Independent Trading Co.", model: "EXP54LWZ", title: "Lightweight Windbreaker", category: "jacket", headwear: false,
    fabric: "100% polyester, water-resistant coating", cottonPct: 0, weightOz: 2.5, puffAvailable: false, structured: null,
    premiumNote: "Polyester shell: DTF only (Printful). Chest hit front, big graphic back.",
    placements: [
      pl("front", "Front (split by zipper)", "front", 10, 8, 3.5, 0, { dtf: ["default", 0] }, "studio-default", [ZIPPER(10, 8)], "Zipper splits the front; welt pockets below."),
      pl("back", "Back", "back", 12, 12, 4, 0, { dtf: ["back", 595] }, "studio-default"),
      pl("label_inside", "Inside neck label", "inside", 3, 3, 0.5, 0, { dtf: ["label_inside", 99] }, "printful-tee-guide"),
    ],
  },
  {
    id: "yp-6089m", printfulId: 99, brand: "Yupoong", model: "6089M", title: "Classic Snapback", category: "snapback", headwear: true,
    fabric: "80% acrylic / 20% wool, full buckram", cottonPct: 0, weightOz: null, puffAvailable: true, structured: true,
    premiumNote: "Structured high-profile crown - the best base for 3D puff.",
    placements: [hatFront(5, 2.25, { embroidery: ["default", 0] }, true, "Use 80-90% of the width (Printful)."), hatSide("left"), hatSide("right"), hatBack()],
  },
  {
    id: "yp-6245cm", printfulId: 206, brand: "Yupoong", model: "6245CM", title: "Classic Dad Hat", category: "dad", headwear: true,
    fabric: "100% chino cotton twill, unstructured", cottonPct: 100, weightOz: null, puffAvailable: true, structured: false,
    premiumNote: "Unstructured low-profile: keep fronts simple; DTF available for full-colour art.",
    placements: [hatFront(4, 2, { embroidery: ["default", 0], dtf: ["front_dtf_hat", 295] }, true, "Soft crown - simpler designs read better."), hatSide("left"), hatSide("right"), hatBack()],
  },
  {
    id: "rch-112", printfulId: 422, brand: "Richardson", model: "112", title: "Snapback Trucker", category: "trucker", headwear: true,
    fabric: "60% cotton / 40% polyester front, 100% polyester mesh back", cottonPct: 60, weightOz: null, puffAvailable: true, structured: true,
    premiumNote: "The trucker everyone knows. Front only - mesh back can't be embroidered.",
    placements: [hatFront(5, 2, { embroidery: ["default", 0] }, true, "Front panels only; never the mesh.")],
  },
  {
    id: "yp-1501kc", printfulId: 266, brand: "Yupoong", model: "1501KC", title: "Cuffed Beanie", category: "beanie", headwear: true,
    fabric: "100% Turbo Acrylic knit", cottonPct: 0, weightOz: null, puffAvailable: true, structured: null,
    premiumNote: "Cuff embroidery; knit stretches so text must be bigger (0.25\" lower / 0.3\" upper).",
    placements: [pl("hat_front", "Cuff front", "front", 5, 2, 0.5, 0, { embroidery: ["default", 0] }, "printful-hat-guide", [], "Knit stretches - bold shapes only.")],
  },
];

// Printful embroidery thread palette (catalog `thread_colors` option, identical on every product checked).
export interface Thread { hex: string; code: string; name: string }
export const THREAD_PALETTE: readonly Thread[] = [
  { hex: "#FFFFFF", code: "1801", name: "White" }, { hex: "#000000", code: "1800", name: "Black" },
  { hex: "#96A1A8", code: "1718", name: "Grey" }, { hex: "#A67843", code: "1672", name: "Old Gold" },
  { hex: "#FFCC00", code: "1951", name: "Gold" }, { hex: "#E25C27", code: "1987", name: "Orange" },
  { hex: "#CC3366", code: "1910", name: "Flamingo" }, { hex: "#CC3333", code: "1839", name: "Red" },
  { hex: "#660000", code: "1784", name: "Maroon" }, { hex: "#333366", code: "1966", name: "Navy" },
  { hex: "#005397", code: "1842", name: "Royal" }, { hex: "#3399FF", code: "1695", name: "Aqua/Teal" },
  { hex: "#6B5294", code: "1832", name: "Purple" }, { hex: "#01784E", code: "1751", name: "Kelly Green" },
  { hex: "#7BA35A", code: "1848", name: "Kiwi Green" },
];
/** Printful hat `embroidery_type` 3D puff / partial puff option, cents. */
export const PUFF_UPCHARGE_CENTS = 150;

// Helpers -----------------------------------------------------------------------
export function getBlank(id: string): Blank | undefined { return BLANKS.find((b) => b.id === id); }
export function colorsFor(b: Blank): readonly ColorRow[] { return PRINTFUL_COLORS[b.printfulId] ?? []; }
export function sizesFor(b: Blank): readonly SizeRow[] { return PRINTFUL_SIZES[b.printfulId] ?? []; }
export function placementsFor(b: Blank, method?: Method): Placement[] {
  return method ? b.placements.filter((p) => p.methods.includes(method)) : [...b.placements];
}
export function getPlacement(b: Blank, id: string): Placement | undefined { return b.placements.find((p) => p.id === id); }
export function methodsFor(b: Blank): Method[] {
  const s = new Set<Method>(); for (const p of b.placements) for (const m of p.methods) s.add(m);
  return (["dtg", "dtf", "embroidery"] as Method[]).filter((m) => s.has(m));
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** WCAG 2.x relative luminance (0..1). */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex); if (!rgb) return 0;
  const lin = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
/** WCAG contrast ratio 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** "Dark garment" = white contrasts better than black on it (needs white underbase for DTG). */
export function isDarkColor(hex: string): boolean { return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#000000"); }

export function nearestThread(hex: string): Thread {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  let best = THREAD_PALETTE[0], bestD = Infinity;
  for (const t of THREAD_PALETTE) {
    const c = hexToRgb(t.hex)!;
    // "redmean" weighted distance - cheap perceptual approximation.
    const rm = (rgb[0] + c[0]) / 2, dr = rgb[0] - c[0], dg = rgb[1] - c[1], db = rgb[2] - c[2];
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}
export function isThreadColor(hex: string): boolean {
  const h = hex.trim().toUpperCase();
  return THREAD_PALETTE.some((t) => t.hex === h);
}

export interface UsedPlacement { placementId: string; method: Method }
/**
 * Printful wholesale estimate for ONE unit, cents: size base price + each
 * placement upcharge (+ puff). It is an ESTIMATE - the Printful order-estimate
 * API is the source of truth (Slice 4) and shipping/tax are excluded.
 */
export function basePriceCents(b: Blank, size: string, used: UsedPlacement[], puff = false): { cents: number; lines: { label: string; cents: number }[] } | null {
  const row = sizesFor(b).find((s) => s[0] === size);
  if (!row) return null;
  const lines: { label: string; cents: number }[] = [{ label: `${b.brand} ${b.model} - ${size}`, cents: row[1] }];
  const seen = new Set<string>();
  for (const u of used) {
    const p = getPlacement(b, u.placementId);
    if (!p || !p.methods.includes(u.method)) continue;
    const key = p.printfulKey[u.method]!;
    if (seen.has(key)) continue; // left-chest print shares the front file
    seen.add(key);
    const c = p.upchargeCents[u.method] ?? 0;
    if (c > 0) lines.push({ label: `${p.label} - ${METHOD_LABEL[u.method]}`, cents: c });
  }
  if (puff && b.puffAvailable) lines.push({ label: "3D puff embroidery", cents: PUFF_UPCHARGE_CENTS });
  return { cents: lines.reduce((a, l) => a + l.cents, 0), lines };
}

export function formatCents(c: number): string {
  const neg = c < 0; const a = Math.abs(Math.round(c));
  return `${neg ? "-" : ""}$${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

// Self-tests ----------------------------------------------------------------------
export function __runGarmentCatalogTests(): { passed: number; failed: number } {
  let passed = 0, failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL garment-catalog-core: ${m}`); } };

  ok(BLANKS.length === 11, "11 starter blanks");
  ok(new Set(BLANKS.map((b) => b.id)).size === BLANKS.length, "unique blank ids");
  for (const b of BLANKS) {
    ok(colorsFor(b).length > 0, `${b.id} has colours`);
    ok(sizesFor(b).length > 0, `${b.id} has sizes`);
    ok(b.placements.length > 0, `${b.id} has placements`);
    ok(new Set(b.placements.map((p) => p.id)).size === b.placements.length, `${b.id} unique placement ids`);
    for (const p of b.placements) {
      ok(p.methods.length > 0 && p.widthIn > 0 && p.heightIn > 0, `${b.id}/${p.id} sane`);
      for (const m of p.methods) ok(typeof p.printfulKey[m] === "string" && Number.isInteger(p.upchargeCents[m]), `${b.id}/${p.id}/${m} key+cents`);
      for (const o of p.obstacles) ok(o.x >= 0 && o.y >= 0 && o.x + o.w <= p.widthIn + 1e-9 && o.y + o.h <= p.heightIn + 1e-9, `${b.id}/${p.id} obstacle inside frame`);
    }
  }
  const w = getBlank("ind-exp54")!;
  ok(methodsFor(w).join() === "dtf", "windbreaker DTF only");
  ok(getBlank("rch-112")!.placements.length === 1, "trucker front only");
  ok(getBlank("yp-6089m")!.placements[0].obstacles.some((o) => o.kind === "center-seam"), "snapback centre seam");
  ok(getBlank("l7-14003")!.placements[0].obstacles.some((o) => o.kind === "zipper" && o.severity === "blocker"), "zip hoodie zipper blocker");
  ok(placementsFor(getBlank("cc-1717")!, "embroidery").length === 4, "1717 has 4 embroidery placements");
  ok(getBlank("nope") === undefined, "unknown blank");

  // Pricing (cents)
  const t = getBlank("cc-1717")!;
  ok(basePriceCents(t, "M", [{ placementId: "front", method: "dtg" }])!.cents === 1560, "1717 M front DTG = 15.60");
  ok(basePriceCents(t, "2XL", [{ placementId: "front", method: "dtg" }, { placementId: "back", method: "dtg" }])!.cents === 1760 + 595, "2XL + back");
  ok(basePriceCents(t, "M", [{ placementId: "front", method: "dtg" }, { placementId: "left_chest", method: "dtg" }])!.cents === 1560, "left chest print shares front file");
  ok(basePriceCents(t, "M", [{ placementId: "left_chest", method: "embroidery" }])!.cents === 1560 + 295, "emb left chest +2.95");
  ok(basePriceCents(t, "XS", []) === null, "1717 has no XS");
  ok(basePriceCents(getBlank("yp-6089m")!, "One size", [{ placementId: "hat_front", method: "embroidery" }], true)!.cents === 1723 + 150, "snapback puff");
  ok(basePriceCents(t, "M", [{ placementId: "front", method: "embroidery" }])!.lines.length === 1, "invalid method ignored");

  // Colour maths
  ok(isDarkColor("#000000") && !isDarkColor("#ffffff"), "dark/light extremes");
  ok(isDarkColor("#1b1b1c") && !isDarkColor("#efff99"), "1717 Black dark, Neon Lemon light");
  ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 1e-6, "contrast 21");
  ok(nearestThread("#fe0000").code === "1839", "pure red -> 1839 Red");
  ok(nearestThread("#f8f8f8").code === "1801", "near white -> White");
  ok(isThreadColor("#ffcc00") && !isThreadColor("#ffcc01"), "palette membership case-insensitive");
  ok(hexToRgb("zzz") === null, "bad hex");
  ok(formatCents(1560) === "$15.60" && formatCents(5) === "$0.05" && formatCents(-250) === "-$2.50", "formatCents");
  ok(THREAD_PALETTE.length === 15, "15 threads");
  return { passed, failed };
}
