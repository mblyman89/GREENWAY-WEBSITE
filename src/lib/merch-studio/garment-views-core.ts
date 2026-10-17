/**
 * R70 S2 - Merch Studio garment views (PURE, no I/O).
 *
 * A "view" is one face of a blank drawn in REAL INCHES (size L, flat-lay):
 * front, back, a sleeve / hat side, or the inside neck. The silhouette shape is
 * ILLUSTRATIVE (Printful's exact mockup templates sit behind OAuth - see the
 * R70 doc); what IS exact is the dashed print frame: its width/height and
 * offset come straight from the placement in garment-catalog-core
 * (`topIn` from the reference line, `centerXIn` from the centre line).
 *
 * Reference lines (documented so the owner can check them):
 *   tops front  - bottom of the front neckline (Printful: "3-4 in below collar")
 *   tops back   - back neck seam
 *   sleeves     - shoulder seam
 *   inside      - inside back-neck seam
 *   hats        - top of the brim / bottom of the closure; frame sits topIn ABOVE it
 *   beanie      - bottom of the cuff; frame sits topIn ABOVE it
 */
import type { Blank, Placement, View } from "./garment-catalog-core";

export interface ViewDetail { d: string; kind: "line" | "shade" | "dash" }
export interface GarmentView {
  view: View;
  label: string;
  /** viewBox in inches. */
  minX: number; minY: number; w: number; h: number;
  /** Reference line y (inches) and whether frames hang below it (tops) or sit above it (headwear). */
  refY: number;
  above: boolean;
  /** Centre line x (inches). */
  cx: number;
  body: string;
  details: ViewDetail[];
  /** Mirror the drawing horizontally (right sleeve / right hat side). */
  mirror: boolean;
}

export const VIEW_LABEL: Record<View, string> = { front: "Front", back: "Back", left: "Left", right: "Right", inside: "Inside neck" };

const isLong = (b: Blank) => b.category !== "tee";

/** Views this blank actually has placements on, in a stable order. */
export function viewsFor(b: Blank): View[] {
  const order: View[] = ["front", "back", "left", "right", "inside"];
  const used = new Set(b.placements.map((p) => p.view));
  return order.filter((v) => used.has(v));
}

function topBody(b: Blank, back: boolean): string {
  const neck = back ? "M11.5 1.2 Q15 2.2 18.5 1.2" : "M11.5 1.2 Q15 4.2 18.5 1.2";
  const long = isLong(b);
  const right = long ? "L23 2.2 L29.6 26 L26.9 26.5 L25 10.5" : "L23 2.2 L29 8.8 L25.8 11.2 L25 10";
  const left = long ? "L5 10.5 L3.1 26.5 L0.4 26 L7 2.2" : "L5 10 L4.2 11.2 L1 8.8 L7 2.2";
  const hem = b.category === "jacket" ? "L25 29 Q15 29.6 5 29" : "L25 30 Q15 30.6 5 30";
  return `${neck} ${right} ${hem} ${left} Z`;
}

function topDetails(b: Blank, back: boolean): ViewDetail[] {
  const d: ViewDetail[] = [];
  const long = isLong(b);
  // collar band
  d.push({ kind: "line", d: back ? "M11.9 1.6 Q15 2.7 18.1 1.6" : "M11.9 1.6 Q15 4.8 18.1 1.6" });
  if (long) d.push({ kind: "line", d: "M3.3 25.2 L0.6 24.8 M26.7 25.2 L29.4 24.8" });
  if (b.category === "crew" || b.category === "hoodie" || b.category === "zip") d.push({ kind: "line", d: "M5 28.6 Q15 29.2 25 28.6" });
  if (b.category === "hoodie" && !back) {
    d.push({ kind: "shade", d: "M10.5 1.4 Q9.6 -2.6 15 -3.2 Q20.4 -2.6 19.5 1.4 Q15 5.2 10.5 1.4 Z" });
    d.push({ kind: "line", d: "M13.6 4.2 L13.4 8.2 M16.4 4.2 L16.6 8.2" });
    d.push({ kind: "line", d: "M9 15.7 L21 15.7 L22.5 24 L7.5 24 Z" });
  }
  if ((b.category === "hoodie" || b.category === "zip") && back) d.push({ kind: "shade", d: "M10.5 1.3 Q9.4 9.5 15 10.2 Q20.6 9.5 19.5 1.3 Q15 2.4 10.5 1.3 Z" });
  if ((b.category === "zip" || b.category === "jacket") && !back) {
    d.push({ kind: "dash", d: `M15 3.6 L15 ${b.category === "jacket" ? 29.3 : 30.3}` });
    if (b.category === "zip") {
      d.push({ kind: "shade", d: "M10.5 1.4 Q9.6 -2.6 15 -3.2 Q20.4 -2.6 19.5 1.4 Q15 5.2 10.5 1.4 Z" });
      d.push({ kind: "line", d: "M9 13.5 L14.6 13.5 L14.6 22 L7.8 22 Z M15.4 13.5 L21 13.5 L22.2 22 L15.4 22 Z" });
    } else d.push({ kind: "line", d: "M7 18 L11 17.6 M19 17.6 L23 18" });
  }
  return d;
}

function sleeveView(b: Blank, side: "left" | "right"): GarmentView {
  const long = isLong(b);
  const len = long ? 25 : 9.5;
  const body = long ? "M1.5 1 Q6 -0.2 10.5 1 L8.3 25 L3.7 25 Z" : "M1.5 1 Q6 -0.2 10.5 1 L10 9.5 L2 9.5 Z";
  const details: ViewDetail[] = long ? [{ kind: "line", d: "M3.85 23.4 L8.15 23.4" }] : [{ kind: "line", d: "M2.1 8.6 L9.9 8.6" }];
  return { view: side, label: `${side === "left" ? "Left" : "Right"} sleeve`, minX: 0, minY: -0.6, w: 12, h: len + 1.6, refY: 1, above: false, cx: 6, body, details, mirror: side === "right" };
}

function hatView(b: Blank, v: View): GarmentView {
  const base = { minX: 0, minY: 0, w: 10, h: 7.4, above: true, mirror: false } as const;
  if (b.category === "beanie") {
    return { ...base, view: v, label: "Front", h: 10, refY: 9.3, cx: 5, body: "M1.2 6.2 C1.2 -0.4 8.8 -0.4 8.8 6.2 L9 9.3 L1 9.3 Z",
      details: [{ kind: "line", d: "M1.1 6 L8.9 6" }, { kind: "dash", d: "M2 6.8 L2 9 M3 6.8 L3 9 M7 6.8 L7 9 M8 6.8 L8 9" }] };
  }
  const brim = b.category === "dad" ? "M0.6 5 Q5 4.5 9.4 5 Q9.6 6.5 5 6.7 Q0.4 6.5 0.6 5 Z" : "M0 5 Q5 4.4 10 5 Q10.2 6.9 5 7.1 Q-0.2 6.9 0 5 Z";
  if (v === "front") {
    const crown = b.category === "dad" ? "M1.2 5 C1.2 1.4 8.8 1.4 8.8 5 Z" : "M1 5 C1 0.5 9 0.5 9 5 Z";
    const details: ViewDetail[] = [{ kind: "shade", d: brim }, { kind: "dash", d: `M5 ${b.category === "dad" ? 2.3 : 1.6} L5 5` }];
    if (b.category === "trucker") details.push({ kind: "line", d: "M1.6 3 L2.6 4.9 M8.4 3 L7.4 4.9" });
    return { ...base, view: v, label: "Front", refY: 5, cx: 5, body: crown, details };
  }
  if (v === "back") {
    return { ...base, view: v, label: "Back", refY: 3.6, cx: 5, body: "M1 5 C1 0.5 9 0.5 9 5 Z",
      details: [{ kind: "shade", d: "M3.5 5 Q5 3.6 6.5 5 Z" }, { kind: "line", d: "M3.3 5.1 L6.7 5.1" }] };
  }
  // side profile (front of cap to the right)
  return { ...base, view: v, label: `${v === "left" ? "Left" : "Right"} side`, refY: 5, cx: 4.4, mirror: v === "right",
    body: "M1 5 C0.8 1 7 0.6 7.8 5 Z", details: [{ kind: "shade", d: "M7.5 5 Q9 5.1 10 5.7 L9.7 6.1 Q8.6 5.6 7.3 5.4 Z" }, { kind: "line", d: "M4.4 1.6 L4.4 5" }] };
}

/** The drawing for one view of a blank (inches). */
export function garmentView(b: Blank, v: View): GarmentView {
  if (b.headwear) return hatView(b, v);
  if (v === "left" || v === "right") return sleeveView(b, v);
  if (v === "inside") {
    return { view: v, label: "Inside back neck", minX: 0, minY: 0, w: 12, h: 8, refY: 2, above: false, cx: 6, mirror: false,
      body: "M0.5 0.6 Q6 3.4 11.5 0.6 L11.5 8 L0.5 8 Z", details: [{ kind: "line", d: "M0.5 1.2 Q6 4 11.5 1.2" }] };
  }
  const back = v === "back";
  const hood = b.category === "hoodie" || b.category === "zip";
  return {
    view: v, label: back ? "Back" : "Front", minX: 0, minY: hood && !back ? -3.6 : 0, w: 30, h: hood && !back ? 34.6 : 31,
    refY: back ? 2 : 3.2, above: false, cx: 15, body: topBody(b, back), details: topDetails(b, back), mirror: false,
  };
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Exact print frame of a placement inside its view (inches). */
export function frameRect(b: Blank, p: Placement): Rect {
  const gv = garmentView(b, p.view);
  const x = gv.cx + p.centerXIn - p.widthIn / 2;
  const y = gv.above ? gv.refY - p.topIn - p.heightIn : gv.refY + p.topIn;
  return { x, y, w: p.widthIn, h: p.heightIn };
}

/** Zoomed viewBox around a frame: 18% margin, never smaller than 2 in. */
export function zoomBox(r: Rect): Rect {
  const m = Math.max(0.5, Math.max(r.w, r.h) * 0.18);
  const w = Math.max(2, r.w + m * 2);
  const h = Math.max(2, r.h + m * 2);
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}

// Self-tests ----------------------------------------------------------------------
export function __runGarmentViewsTests(blanks: readonly Blank[]): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error("FAIL garment-views:", m); } };
  for (const b of blanks) {
    const views = viewsFor(b);
    ok(views.length > 0, `${b.id} has views`);
    for (const p of b.placements) {
      const gv = garmentView(b, p.view);
      const r = frameRect(b, p);
      const eps = 1e-9;
      ok(r.x >= gv.minX - eps && r.x + r.w <= gv.minX + gv.w + eps, `${b.id}/${p.id} frame inside view horizontally`);
      ok(r.y >= gv.minY - eps && r.y + r.h <= gv.minY + gv.h + eps, `${b.id}/${p.id} frame inside view vertically`);
      ok(Math.abs(r.x + r.w / 2 - (gv.cx + p.centerXIn)) < 1e-9, `${b.id}/${p.id} centred on centre line + offset`);
      const z = zoomBox(r);
      ok(z.x <= r.x && z.y <= r.y && z.x + z.w >= r.x + r.w && z.y + z.h >= r.y + r.h, `${b.id}/${p.id} zoom contains frame`);
    }
  }
  const tee = blanks.find((b) => b.id === "cc-1717");
  if (tee) {
    const lc = tee.placements.find((p) => p.id === "left_chest")!;
    const r = frameRect(tee, lc);
    ok(r.x + r.w / 2 > garmentView(tee, "front").cx, "wearer's left chest drawn on viewer's right");
    ok(Math.abs(r.y - (3.2 + 3)) < 1e-9, "left chest 3 in below front neckline");
    const back = tee.placements.find((p) => p.id === "back")!;
    ok(Math.abs(frameRect(tee, back).y - 6) < 1e-9, "full back 4 in below back neck seam");
    ok(garmentView(tee, "right").mirror && !garmentView(tee, "left").mirror, "right sleeve mirrored");
  }
  const snap = blanks.find((b) => b.id === "yp-6089m");
  if (snap) {
    const f = snap.placements.find((p) => p.id === "hat_front")!;
    const r = frameRect(snap, f);
    ok(Math.abs(r.y + r.h - (5 - 0.75)) < 1e-9, "hat front sits 0.75 in above the brim");
    ok(viewsFor(snap).join(",") === "front,back,left,right", "snapback views");
  }
  ok(zoomBox({ x: 0, y: 0, w: 0.5, h: 0.5 }).w === 2, "zoom min 2 in");
  return { passed, failed };
}
