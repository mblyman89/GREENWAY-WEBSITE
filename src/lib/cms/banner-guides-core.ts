/**
 * banner-guides-core — R57-S1. Smart spacing guides for the Banner Studio
 * (the Figma / Canva "smart guides" behaviour), pure + testable.
 *
 * While dragging one item:
 *  • its left / centre / right (and top / middle / bottom) snap to the banner's
 *    edges + centre lines AND to every other item's edges + centres;
 *  • a guide line is drawn only between the two things that line up;
 *  • "equal spacing": when the item sits between two neighbours and the two
 *    gaps are nearly equal, it snaps so they ARE equal (both gaps highlighted);
 *  • distance readouts: the gap to the nearest neighbour on each side, in real
 *    banner pixels (computer 1408px wide / phone 390px wide).
 *
 * All positions are % of the banner frame (top-left origin). Hold Alt = no snap.
 */
export type GuideRect = { id: string; x: number; y: number; w: number; h: number };
/** A guide line: vertical lines sit at x = `at` and run from y `from`→`to` (and vice versa). */
export type GuideLine = { at: number; from: number; to: number };
export type GuideGap = { axis: "x" | "y"; from: number; to: number; at: number; pct: number; equal?: boolean };
export type SmartSnap = { x: number; y: number; v: GuideLine[]; h: GuideLine[]; gaps: GuideGap[] };

export const GUIDE_SNAP_PCT = 1.5;
const half = (n: number) => Math.round(n * 2) / 2;
const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

type Target = { at: number; from: number; to: number };

/** Best snap on one axis: moving points (start/centre/end) against targets. */
function bestSnap(pos: number, size: number, targets: Target[], limit: number): { pos: number; lines: GuideLine[] } | null {
  const points = [0, size / 2, size];
  let best: { d: number; at: number } | null = null;
  for (const t of targets)
    for (const p of points) {
      const d = t.at - (pos + p);
      if (Math.abs(d) <= limit && (!best || Math.abs(d) < Math.abs(best.d) - 1e-9)) best = { d, at: t.at };
    }
  if (!best) return null;
  const np = pos + best.d;
  // Every target sitting on the snapped line (several items can line up at once).
  const lines = targets
    .filter((t) => Math.abs(t.at - best!.at) < 1e-6)
    .map((t) => ({ at: r2(t.at), from: t.from, to: t.to }));
  return { pos: np, lines };
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0.01;

/** Nearest neighbours left/right (axis "x") or above/below (axis "y") that overlap on the other axis. */
function neighbours(me: GuideRect, others: GuideRect[], axis: "x" | "y"): { before?: GuideRect; after?: GuideRect } {
  const p = axis === "x" ? "x" : "y";
  const s = axis === "x" ? "w" : "h";
  const q = axis === "x" ? "y" : "x";
  const t = axis === "x" ? "h" : "w";
  let before: GuideRect | undefined;
  let after: GuideRect | undefined;
  for (const o of others) {
    if (!overlaps(me[q], me[q] + me[t], o[q], o[q] + o[t])) continue;
    if (o[p] + o[s] <= me[p] + 0.01 && (!before || o[p] + o[s] > before[p] + before[s])) before = o;
    if (o[p] >= me[p] + me[s] - 0.01 && (!after || o[p] < after[p])) after = o;
  }
  return { before, after };
}

function gapsFor(me: GuideRect, others: GuideRect[], axis: "x" | "y", equal: boolean): GuideGap[] {
  const { before, after } = neighbours(me, others, axis);
  const p = axis === "x" ? "x" : "y";
  const s = axis === "x" ? "w" : "h";
  const q = axis === "x" ? "y" : "x";
  const t = axis === "x" ? "h" : "w";
  const out: GuideGap[] = [];
  const mid = (o: GuideRect) => r2((Math.max(me[q], o[q]) + Math.min(me[q] + me[t], o[q] + o[t])) / 2);
  if (before) out.push({ axis, from: r2(before[p] + before[s]), to: r2(me[p]), at: mid(before), pct: r2(me[p] - before[p] - before[s]), ...(equal ? { equal } : {}) });
  if (after) out.push({ axis, from: r2(me[p] + me[s]), to: r2(after[p]), at: mid(after), pct: r2(after[p] - me[p] - me[s]), ...(equal ? { equal } : {}) });
  return out;
}

/** Snap so the gaps to both neighbours are equal (when they're already close). */
function equalSnap(me: GuideRect, others: GuideRect[], axis: "x" | "y", limit: number): number | null {
  const { before, after } = neighbours(me, others, axis);
  if (!before || !after) return null;
  const p = axis === "x" ? "x" : "y";
  const s = axis === "x" ? "w" : "h";
  const g1 = me[p] - (before[p] + before[s]);
  const g2 = after[p] - (me[p] + me[s]);
  if (g1 < 0 || g2 < 0 || Math.abs(g1 - g2) > limit * 2) return null;
  return before[p] + before[s] + (g1 + g2) / 2;
}

/**
 * Snap a dragged item (top-left x,y; size w,h — all %) against the banner and
 * the other items. `on` = false (Alt held) → no snapping, readouts still shown.
 */
export function smartSnap(x: number, y: number, w: number, h: number, others: GuideRect[], on: boolean, limit = GUIDE_SNAP_PCT): SmartSnap {
  let v: GuideLine[] = [];
  let hs: GuideLine[] = [];
  let eqX = false;
  let eqY = false;
  if (on) {
    const tx: Target[] = [0, 50, 100].map((at) => ({ at, from: 0, to: 100 }));
    const ty: Target[] = [0, 50, 100].map((at) => ({ at, from: 0, to: 100 }));
    for (const o of others) {
      for (const at of [o.x, o.x + o.w / 2, o.x + o.w]) tx.push({ at, from: r2(Math.min(o.y, y)), to: r2(Math.max(o.y + o.h, y + h)) });
      for (const at of [o.y, o.y + o.h / 2, o.y + o.h]) ty.push({ at, from: r2(Math.min(o.x, x)), to: r2(Math.max(o.x + o.w, x + w)) });
    }
    const sx = bestSnap(x, w, tx, limit);
    const sy = bestSnap(y, h, ty, limit);
    if (sx) {
      x = sx.pos;
      v = sx.lines;
    } else {
      const e = equalSnap({ id: "", x, y, w, h }, others, "x", limit);
      if (e !== null) {
        x = e;
        eqX = true;
      }
    }
    if (sy) {
      y = sy.pos;
      hs = sy.lines;
    } else {
      const e = equalSnap({ id: "", x, y, w, h }, others, "y", limit);
      if (e !== null) {
        y = e;
        eqY = true;
      }
    }
  }
  // Keep inside the banner (Studio rounds positions to 0.5%).
  const fx = half(clamp(x, 0, 100 - Math.min(w, 100)));
  const fy = half(clamp(y, 0, 100 - Math.min(h, 100)));
  // Re-fit the guide segments to the final spot (they were built from the pre-snap position).
  const fit = (lines: GuideLine[], lo: number, hi: number) => lines.map((l) => (l.from === 0 && l.to === 100 ? l : { ...l, from: r2(Math.min(l.from, lo)), to: r2(Math.max(l.to, hi)) }));
  const me: GuideRect = { id: "", x: fx, y: fy, w, h };
  return {
    x: fx,
    y: fy,
    v: fit(v, fy, fy + h),
    h: fit(hs, fx, fx + w),
    gaps: [...gapsFor(me, others, "x", eqX), ...gapsFor(me, others, "y", eqY)].filter((g) => g.pct > 0.05),
  };
}

/** Gap in real banner pixels for the readout label. */
export function gapPx(g: GuideGap, frame: { refW: number; height: number }): number {
  return Math.round((g.pct / 100) * (g.axis === "x" ? frame.refW : frame.height));
}

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runBannerGuidesTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  ✗ banner-guides: ${m}`);
    }
  };
  const A: GuideRect = { id: "a", x: 10, y: 10, w: 20, h: 10 };
  // banner snapping still works with no other items
  const s0 = smartSnap(0.8, 44.6, 10, 10, [], true);
  ok(s0.x === 0 && s0.v[0].at === 0 && s0.y === 45 && s0.h[0].at === 50, "banner edges + middle");
  ok(s0.v[0].from === 0 && s0.v[0].to === 100, "banner guide runs full height");
  // snap left edge to A's left edge
  const s1 = smartSnap(11, 40, 10, 10, [A], true);
  ok(s1.x === 10 && s1.v.length === 1 && s1.v[0].at === 10, "left edges line up");
  ok(s1.v[0].from === 10 && s1.v[0].to === 50, "guide spans both items only");
  // centre to centre (A centre x = 20; item w 6 → x 17)
  const s2 = smartSnap(17.8, 60, 6, 6, [A], true);
  ok(s2.x === 17 && s2.v[0].at === 20, "centres line up");
  // top to A's bottom (y 20)
  const s3 = smartSnap(60, 20.9, 10, 5, [A], true);
  ok(s3.y === 20 && s3.h[0].at === 20, "top meets other's bottom");
  // nearest target wins
  const s4 = smartSnap(30.4, 70, 10, 5, [A, { id: "b", x: 31, y: 80, w: 5, h: 5 }], true);
  ok(s4.x === 30, "closest line wins");
  // Alt: no snapping, readouts still there
  const s5 = smartSnap(33, 12, 10, 5, [A], false);
  ok(s5.x === 33 && s5.v.length === 0 && s5.gaps.length === 1 && s5.gaps[0].pct === 3, "alt = no snap, gap still measured");
  // gap readouts left/right/up/down
  const L: GuideRect = { id: "l", x: 0, y: 40, w: 10, h: 10 };
  const R: GuideRect = { id: "r", x: 80, y: 40, w: 10, h: 10 };
  const U: GuideRect = { id: "u", x: 40, y: 0, w: 10, h: 10 };
  const g = smartSnap(40, 40, 10, 10, [L, R, U], false).gaps;
  ok(g.length === 3, "three neighbours measured");
  ok(g.some((x) => x.axis === "x" && x.from === 10 && x.to === 40 && x.pct === 30), "left gap");
  ok(g.some((x) => x.axis === "x" && x.from === 50 && x.to === 80 && x.pct === 30), "right gap");
  ok(g.some((x) => x.axis === "y" && x.from === 10 && x.to === 40 && x.at === 45), "gap above, drawn at overlap middle");
  ok(smartSnap(40, 70, 10, 10, [L], false).gaps.length === 0, "no overlap → no gap");
  // equal spacing snap
  const e = smartSnap(35.6, 40, 10, 10, [L, { ...R, x: 70 }], true);
  ok(e.x === 35 && e.gaps.filter((x) => x.equal).length === 2 && e.gaps[0].pct === e.gaps[1].pct, "snaps to equal gaps, both highlighted");
  ok(!smartSnap(20, 40, 10, 10, [L, { ...R, x: 70 }], true).gaps.some((x) => x.equal), "far from equal → no equal snap");
  // clamp
  ok(smartSnap(97, 99, 10, 4, [], false).x === 90 && smartSnap(97, 99, 10, 4, [], false).y === 96, "kept inside");
  ok(gapPx({ axis: "x", from: 0, to: 0, at: 0, pct: 10 }, { refW: 1408, height: 200 }) === 141, "px readout across");
  ok(gapPx({ axis: "y", from: 0, to: 0, at: 0, pct: 10 }, { refW: 1408, height: 200 }) === 20, "px readout down");
  return { passed, failed };
}
