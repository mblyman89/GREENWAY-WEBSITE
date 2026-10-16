/**
 * banner-curve-core — R58-S2. Curved text (arch ∩ / smile ∪ / full circle).
 *
 * `curve` −100…100 on a text box: + arches up like a rainbow, − bends down
 * like a smile; ±100 ≈ a full circle (badge ring). The text runs along an SVG
 * circular arc (<textPath>), centred. The arc LENGTH always equals the box
 * width, so text that fits the box flat still fits once curved.
 *
 * Geometry is computed in reference pixels (desktop 1408 / phone 390 wide
 * banner) and drawn in an SVG whose viewBox uses those pixels — so the result
 * is identical in the Studio and on the site, server-rendered, no JS.
 * Pure + self-tested.
 */
export const CURVE = { min: -100, max: 100 };
/** Max bend (degrees) at |curve| = 100 — just short of a closed ring. */
export const CURVE_MAX_DEG = 340;

export type CurveGeo = {
  /** SVG path (arc) in viewBox units. */
  d: string;
  /** viewBox "x y w h". */
  viewBox: string;
  /** SVG width as % of the text box width, and its left offset (%). */
  widthPct: number;
  leftPct: number;
  /** SVG height relative to its width (for aspect-ratio). */
  aspect: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function normalizeCurve(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(CURVE.max, Math.max(CURVE.min, n)));
}

/**
 * @param curve  −100…100 (non-zero)
 * @param W      arc length = text box width in reference px
 * @param fs     font size in reference px
 */
export function curveGeometry(curve: number, W: number, fs: number): CurveGeo {
  const up = curve > 0;
  const theta = (Math.max(1, Math.abs(curve)) / 100) * CURVE_MAX_DEG * (Math.PI / 180);
  const R = W / theta;
  // Circle centre at (0,0). ∩: arc over the top (angle −90° ± θ/2) clockwise.
  // ∪: arc along the bottom (90° ± θ/2), drawn left → right = anticlockwise.
  const mid = up ? -Math.PI / 2 : Math.PI / 2;
  const a0 = up ? mid - theta / 2 : mid + theta / 2;
  const a1 = up ? mid + theta / 2 : mid - theta / 2;
  const p = (a: number) => [R * Math.cos(a), R * Math.sin(a)] as const;
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = theta > Math.PI ? 1 : 0;
  const sweep = up ? 1 : 0;
  const d = `M ${r2(x0)} ${r2(y0)} A ${r2(R)} ${r2(R)} 0 ${large} ${sweep} ${r2(x1)} ${r2(y1)}`;
  // Bounding box of the arc (sampled) grown by the letters' height.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i <= 48; i += 1) {
    const [x, y] = p(a0 + ((a1 - a0) * i) / 48);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = fs * 1.15;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad * 0.45;
  if (!up) { minY += pad * 0.7; maxY += pad * 0.0; }
  const vw = maxX - minX;
  const vh = maxY - minY;
  return {
    d,
    viewBox: `${r2(minX)} ${r2(minY)} ${r2(vw)} ${r2(vh)}`,
    widthPct: r2((vw / W) * 100),
    leftPct: r2(((minX + W / 2) / W) * 100),
    aspect: r2(vh / vw * 10000) / 10000,
  };
}

export function __runBannerCurveTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL banner-curve-core: ${m}`);
    }
  };
  ok(normalizeCurve(undefined) === 0 && normalizeCurve(500) === 100 && normalizeCurve("-30.4") === -30, "normalize");
  const g = curveGeometry(40, 600, 48);
  ok(g.d.startsWith("M ") && g.d.includes(" A ") && g.d.includes(" 0 0 1 "), "arch path clockwise small arc");
  ok(curveGeometry(-40, 600, 48).d.includes(" 0 0 0 "), "smile anticlockwise");
  ok(curveGeometry(100, 600, 48).d.includes(" 0 1 1 "), "near-circle uses large arc");
  ok(g.widthPct > 50 && Math.abs(g.leftPct - (100 - g.widthPct) / 2) < 0.1, "svg centred on the box");
  ok(g.aspect > 0 && g.aspect < 1, "arch is wider than tall");
  const c = curveGeometry(100, 600, 48);
  ok(c.aspect > 0.7, "near-circle roughly square");
  // Arc length = W: endpoints chord ≤ W.
  const [, x0, y0] = /M (-?[\d.]+) (-?[\d.]+)/.exec(g.d)!.map(Number);
  ok(Math.abs(x0) <= 300 && y0 < 0, "arch endpoints within width, above centre");
  return { passed, failed };
}
