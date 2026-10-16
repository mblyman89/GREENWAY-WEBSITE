/**
 * banner-arrange-core — R56-S3. Pure "direct manipulation" rules for Banner
 * Studio: multi-select group moves, align + distribute, duplicate, copy/paste
 * (also between banners), rotation by handle, and the drag snapping maths
 * (moved here from StudioCanvas so it is testable and the canvas stays small).
 *
 * Positions are % of the banner (top-left corner), per device: on "mobile" the
 * phone override (mx/my) is read and written, exactly like dragging. Locked
 * items are never moved, rotated or removed by a group action.
 */
import {
  MAX_DESIGN_BUTTONS,
  MAX_TEXT_BOXES,
  nextId,
  normalizeButton,
  normalizeTextBox,
  type BannerDesign,
  type DesignDevice,
} from "./banner-design-core";
import { MAX_ELEMENTS, normalizeElement } from "./banner-elements-core";

export type ArrangeTarget = "box" | "button" | "element";
export type ItemRef = { target: ArrangeTarget; id: string };
/** A measured item, all in % of the banner frame. */
export type PctRect = { id: string; x: number; y: number; w: number; h: number };
export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

export const CLIPBOARD_KEY = "gw-studio-clipboard";
export const CLIPBOARD_KIND = "gw-banner-items";
export const ROTATE_SNAP_DEG = 15;
export const SNAP_PCT = 1.5;

const half = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const sameRef = (a: ItemRef, b: ItemRef) => a.target === b.target && a.id === b.id;

export function hasRef(list: ItemRef[], r: ItemRef): boolean {
  return list.some((x) => sameRef(x, r));
}

/** Shift-click: add the item, or take it out if it's already in the group. */
export function toggleRef(list: ItemRef[], r: ItemRef): ItemRef[] {
  return hasRef(list, r) ? list.filter((x) => !sameRef(x, r)) : [...list, r];
}

type Movable = { x: number; y: number; mx: number | null; my: number | null; locked?: boolean };

function find(design: BannerDesign, r: ItemRef): (Movable & { rotate?: number }) | undefined {
  if (r.target === "box") return design.boxes.find((b) => b.id === r.id);
  if (r.target === "button") return design.buttons.find((b) => b.id === r.id);
  return (design.elements ?? []).find((e) => e.id === r.id);
}

/** Current top-left (device-aware). */
export function itemXY(design: BannerDesign, r: ItemRef, device: DesignDevice): { x: number; y: number } | null {
  const it = find(design, r);
  if (!it) return null;
  return device === "mobile" ? { x: it.mx ?? it.x, y: it.my ?? it.y } : { x: it.x, y: it.y };
}

/** Write new top-left positions (by id) for one device; locked items are skipped. Returns a new design. */
export function setPositions(design: BannerDesign, pos: Map<string, { x: number; y: number }>, device: DesignDevice): BannerDesign {
  const put = <T extends Movable & { id: string }>(it: T): T => {
    const p = pos.get(it.id);
    if (!p || it.locked) return it;
    const x = half(clamp(p.x, 0, 100));
    const y = half(clamp(p.y, 0, 100));
    return device === "mobile" ? { ...it, mx: x, my: y } : { ...it, x, y };
  };
  return {
    ...design,
    boxes: design.boxes.map(put),
    buttons: design.buttons.map(put),
    ...(design.elements ? { elements: design.elements.map(put) } : {}),
  };
}

/** Move a group by (dx, dy)% from the positions in `from` (the design when the drag began). */
export function moveGroup(from: BannerDesign, refs: ItemRef[], dx: number, dy: number, device: DesignDevice): BannerDesign {
  const pos = new Map<string, { x: number; y: number }>();
  for (const r of refs) {
    const p = itemXY(from, r, device);
    if (p) pos.set(r.id, { x: p.x + dx, y: p.y + dy });
  }
  return setPositions(from, pos, device);
}

/**
 * Align measured rects. One item → aligns to the BANNER (left edge, centre,
 * right edge…); several → aligns to the group's own bounding box (Figma/Canva
 * behaviour). Returns new top-left per id.
 */
export function alignRects(rects: PctRect[], mode: AlignMode): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!rects.length) return out;
  const single = rects.length === 1;
  const L = single ? 0 : Math.min(...rects.map((r) => r.x));
  const R = single ? 100 : Math.max(...rects.map((r) => r.x + r.w));
  const T = single ? 0 : Math.min(...rects.map((r) => r.y));
  const B = single ? 100 : Math.max(...rects.map((r) => r.y + r.h));
  for (const r of rects) {
    let { x, y } = r;
    if (mode === "left") x = L;
    else if (mode === "center") x = (L + R) / 2 - r.w / 2;
    else if (mode === "right") x = R - r.w;
    else if (mode === "top") y = T;
    else if (mode === "middle") y = (T + B) / 2 - r.h / 2;
    else y = B - r.h;
    out.set(r.id, { x, y });
  }
  return out;
}

/** Equal gaps between 3+ items along one axis (ends stay put). */
export function distributeRects(rects: PctRect[], axis: "h" | "v"): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (rects.length < 3) return out;
  const pos = (r: PctRect) => (axis === "h" ? r.x : r.y);
  const size = (r: PctRect) => (axis === "h" ? r.w : r.h);
  const sorted = [...rects].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - sorted.reduce((s, r) => s + size(r), 0)) / (sorted.length - 1);
  let cur = pos(first);
  for (const r of sorted) {
    out.set(r.id, axis === "h" ? { x: cur, y: r.y } : { x: r.x, y: cur });
    cur += size(r) + gap;
  }
  return out;
}

/** Angle (deg, −180…180, 0 = upright) for a handle dragged to (px, py) around centre (cx, cy). */
export function angleFromPointer(cx: number, cy: number, px: number, py: number, snap = false): number {
  let a = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
  if (snap) a = Math.round(a / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;
  else a = Math.round(a);
  while (a > 180) a -= 360;
  while (a <= -180) a += 360;
  return a === -180 ? 180 : a;
}

/** Set rotation; 0 removes the field from text/buttons so unrotated designs stay byte-identical. */
export function rotateItem(design: BannerDesign, r: ItemRef, deg: number): BannerDesign {
  const it = find(design, r);
  if (!it || it.locked) return design;
  const a = clamp(Math.round(deg), -180, 180);
  if (r.target === "element") return { ...design, elements: (design.elements ?? []).map((e) => (e.id === r.id ? { ...e, rotate: a } : e)) };
  const set = <T extends { id: string; rotate?: number }>(x: T): T => {
    if (x.id !== r.id) return x;
    const { rotate: _drop, ...rest } = x;
    void _drop;
    return (a ? { ...rest, rotate: a } : rest) as T;
  };
  return r.target === "box" ? { ...design, boxes: design.boxes.map(set) } : { ...design, buttons: design.buttons.map(set) };
}

/** Remove items (locked ones stay); also drops them from the layer order. */
export function removeItems(design: BannerDesign, refs: ItemRef[]): BannerDesign {
  const gone = new Set(refs.filter((r) => !find(design, r)?.locked).map((r) => r.id));
  if (!gone.size) return design;
  const order = design.order?.filter((id) => !gone.has(id));
  return {
    ...design,
    boxes: design.boxes.filter((b) => !gone.has(b.id)),
    buttons: design.buttons.filter((b) => !gone.has(b.id)),
    ...(design.elements ? { elements: design.elements.filter((e) => !gone.has(e.id)) } : {}),
    ...(design.order ? { order: order?.length ? order : undefined } : {}),
  };
}

type ClipItem = { target: ArrangeTarget; data: Record<string, unknown> };
export type ClipPayload = { kind: typeof CLIPBOARD_KIND; v: 1; items: ClipItem[] };

/** Copy: the raw item JSON (bound boxes become plain text so a paste never edits another banner's title). */
export function copyItems(design: BannerDesign, refs: ItemRef[], legacy: { eyebrow?: string; title?: string; subtitle?: string } = {}): ClipPayload {
  const items: ClipItem[] = [];
  for (const r of refs) {
    const it = find(design, r);
    if (!it) continue;
    const data = JSON.parse(JSON.stringify(it)) as Record<string, unknown>;
    if (r.target === "box" && data.bind) {
      const k = data.bind as "eyebrow" | "title" | "subtitle";
      data.text = (typeof data.text === "string" && data.text) || legacy[k] || "";
      data.bind = null;
    }
    delete data.locked;
    items.push({ target: r.target, data });
  }
  return { kind: CLIPBOARD_KIND, v: 1, items };
}

export function parseClipboard(raw: unknown): ClipPayload | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== CLIPBOARD_KIND || !Array.isArray(o.items)) return null;
  const items = o.items.filter(
    (i): i is ClipItem => !!i && typeof i === "object" && ["box", "button", "element"].includes((i as ClipItem).target) && !!(i as ClipItem).data && typeof (i as ClipItem).data === "object",
  );
  return items.length ? { kind: CLIPBOARD_KIND, v: 1, items: items.slice(0, 24) } : null;
}

/**
 * Paste (also = Duplicate): every item is re-validated by the normal
 * normalizers, gets a fresh id and is offset by `offset`% so it's visible.
 * Items over the per-banner limits are skipped and counted.
 */
export function pasteItems(design: BannerDesign, clip: ClipPayload, offset = 2): { design: BannerDesign; added: ItemRef[]; skipped: number } {
  let next: BannerDesign = { ...design, boxes: [...design.boxes], buttons: [...design.buttons], ...(design.elements ? { elements: [...design.elements] } : {}) };
  const added: ItemRef[] = [];
  let skipped = 0;
  for (const it of clip.items) {
    const d = it.data;
    const shift = (k: string) => (typeof d[k] === "number" ? clamp((d[k] as number) + offset, 0, 100) : d[k]);
    const raw = { ...d, x: shift("x"), y: shift("y"), ...(d.mx != null ? { mx: shift("mx") } : {}), ...(d.my != null ? { my: shift("my") } : {}) };
    const base = typeof d.id === "string" ? d.id.replace(/-copy(-\d+)?$/, "").slice(0, 18) + "-copy" : it.target;
    const id = nextId(next, base);
    if (it.target === "box") {
      const b = next.boxes.length < MAX_TEXT_BOXES ? normalizeTextBox({ ...raw, id }, id) : null;
      if (!b) skipped++;
      else {
        next.boxes.push({ ...b, id });
        added.push({ target: "box", id });
      }
    } else if (it.target === "button") {
      const b = next.buttons.length < MAX_DESIGN_BUTTONS ? normalizeButton({ ...raw, id }, id) : null;
      if (!b) skipped++;
      else {
        next.buttons.push({ ...b, id });
        added.push({ target: "button", id });
      }
    } else {
      const els = next.elements ?? [];
      const e = els.length < MAX_ELEMENTS ? normalizeElement({ ...raw, id }, id) : null;
      if (!e) skipped++;
      else {
        next = { ...next, elements: [...els, { ...e, id }] };
        added.push({ target: "element", id });
      }
    }
  }
  if (next.order && added.length) next = { ...next, order: [...next.order, ...added.map((a) => a.id)] };
  return { design: next, added, skipped };
}

/** Start / centre / end of one axis against the banner's 0 / 50 / 100 lines. */
function snapAxis(p: number, size: number): { pos: number; guide: number } | null {
  if (Math.abs(p) <= SNAP_PCT) return { pos: 0, guide: 0 };
  if (Math.abs(p + size / 2 - 50) <= SNAP_PCT) return { pos: 50 - size / 2, guide: 50 };
  if (Math.abs(p + size - 100) <= SNAP_PCT) return { pos: 100 - size, guide: 100 };
  return null;
}

/**
 * Drag snapping (moved from StudioCanvas): snap the item's left/centre/right
 * and top/middle/bottom to the banner's edges + centre lines, then keep it
 * inside the banner. Returns the guides to draw.
 */
export function snapMove(x: number, y: number, w: number, h: number, on: boolean): { x: number; y: number; v: number[]; h: number[] } {
  const v: number[] = [];
  const hs: number[] = [];
  if (on) {
    const sx = snapAxis(x, w);
    const sy = snapAxis(y, h);
    if (sx) {
      x = sx.pos;
      v.push(sx.guide);
    }
    if (sy) {
      y = sy.pos;
      hs.push(sy.guide);
    }
  }
  return { x: half(clamp(x, 0, 100 - Math.min(w, 100))), y: half(clamp(y, 0, 100 - Math.min(h, 100))), v, h: hs };
}

// ── Self-tests ─────────────────────────────────────────────────────────────

export function __runBannerArrangeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("banner-arrange-core FAIL:", m);
    }
  };
  const box = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => normalizeTextBox({ id, role: "body", text: id, x, y, w: 20, ...extra }, id)!;
  const btn = normalizeButton({ id: "go", label: "Go", href: "/menu", x: 10, y: 80 }, "go")!;
  const el = normalizeElement({ id: "star", shape: "star", x: 50, y: 50, w: 10 }, "star")!;
  const d0 = { v: 1, enabled: true, boxes: [box("a", 10, 10), box("b", 40, 20), box("lock", 5, 5, { locked: true })], buttons: [btn], elements: [el] } as unknown as BannerDesign;
  const A: ItemRef = { target: "box", id: "a" };
  const B: ItemRef = { target: "box", id: "b" };
  const L: ItemRef = { target: "box", id: "lock" };
  const S: ItemRef = { target: "element", id: "star" };

  ok(toggleRef([A], B).length === 2 && toggleRef([A, B], A).length === 1 && hasRef([A], { target: "box", id: "a" }), "toggle/hasRef");
  const g = moveGroup(d0, [A, B, L, S], 5, -5, "desktop");
  ok(g.boxes[0]!.x === 15 && g.boxes[0]!.y === 5 && g.boxes[1]!.x === 45 && g.elements![0]!.x === 55, "group move desktop");
  ok(g.boxes[2]!.x === 5, "locked stays put");
  const gm = moveGroup(d0, [A], 3, 3, "mobile");
  ok(gm.boxes[0]!.mx === 13 && gm.boxes[0]!.my === 13 && gm.boxes[0]!.x === 10, "group move phone writes overrides only");
  ok(moveGroup(d0, [A], -50, 0, "desktop").boxes[0]!.x === 0, "clamped");

  const rs: PctRect[] = [
    { id: "a", x: 10, y: 10, w: 20, h: 10 },
    { id: "b", x: 40, y: 30, w: 10, h: 10 },
  ];
  const al = alignRects(rs, "left");
  ok(al.get("a")!.x === 10 && al.get("b")!.x === 10, "align left to group");
  ok(alignRects(rs, "right").get("a")!.x === 30, "align right to group");
  ok(alignRects([rs[0]!], "center").get("a")!.x === 40 && alignRects([rs[0]!], "bottom").get("a")!.y === 90, "single aligns to banner");
  ok(alignRects(rs, "middle").get("b")!.y === 20, "align middle");
  const dist = distributeRects(
    [
      { id: "1", x: 0, y: 0, w: 10, h: 5 },
      { id: "3", x: 90, y: 0, w: 10, h: 5 },
      { id: "2", x: 20, y: 0, w: 10, h: 5 },
    ],
    "h",
  );
  ok(dist.get("2")!.x === 45 && dist.get("1")!.x === 0 && dist.get("3")!.x === 90, "distribute equal gaps");
  ok(distributeRects(rs, "v").size === 0, "distribute needs 3");

  ok(angleFromPointer(0, 0, 0, -10) === 0 && angleFromPointer(0, 0, 10, 0) === 90 && angleFromPointer(0, 0, 0, 10) === 180, "angle basics");
  ok(angleFromPointer(0, 0, -10, 0) === -90 && angleFromPointer(0, 0, 10, -9, true) === 45, "angle negative + snap");
  const r1 = rotateItem(d0, A, 30);
  ok(r1.boxes[0]!.rotate === 30 && !("rotate" in rotateItem(r1, A, 0).boxes[0]!), "box rotate set/clear");
  ok(rotateItem(d0, S, -45).elements![0]!.rotate === -45 && rotateItem(d0, L, 10) === d0, "element rotate + locked refused");

  const rm = removeItems({ ...d0, order: ["star", "a", "b", "lock", "go"] }, [A, L]);
  ok(rm.boxes.length === 2 && rm.order!.join() === "star,b,lock,go", "remove (locked kept)");

  const clip = copyItems(d0, [A, S, { target: "button", id: "go" }]);
  ok(clip.items.length === 3 && parseClipboard(JSON.stringify(clip))!.items.length === 3 && parseClipboard("nope") === null && parseClipboard({ kind: "x", items: [] }) === null, "copy/parse");
  const p = pasteItems(d0, clip);
  ok(p.added.length === 3 && p.skipped === 0 && p.design.boxes.length === 4 && p.design.boxes[3]!.id === "a-copy" && p.design.boxes[3]!.x === 12, "paste with new id + offset");
  ok(p.design.elements!.length === 2 && p.design.buttons[1]!.id === "go-copy", "paste shapes + buttons");
  const p2 = pasteItems(p.design, copyItems(p.design, [{ target: "box", id: "a-copy" }]));
  ok(p2.design.boxes[4]!.id === "a-copy-2", "repeat paste unique id");
  const bound = { ...d0, boxes: [normalizeTextBox({ id: "headline", role: "headline", bind: "title", x: 1, y: 1 }, "headline")!] } as BannerDesign;
  const bc = copyItems(bound, [{ target: "box", id: "headline" }], { title: "Big Sale" });
  ok(bc.items[0]!.data.bind === null && bc.items[0]!.data.text === "Big Sale", "bound box copies as plain text");
  const full = { ...d0, buttons: [btn, btn, btn, btn].map((b, i) => ({ ...b, id: `b${i}` })) } as BannerDesign;
  ok(pasteItems(full, copyItems(d0, [{ target: "button", id: "go" }])).skipped === 1, "limit respected");
  ok(pasteItems({ ...d0, order: ["a"] }, copyItems(d0, [A])).design.order!.join() === "a,a-copy", "order extended");

  const s1 = snapMove(0.8, 49, 10, 4, true);
  ok(s1.x === 0 && s1.v[0] === 0 && s1.y === 48 && s1.h[0] === 50, "snap edges + middle");
  ok(snapMove(0.8, 49, 10, 4, false).x === 1 && snapMove(0.8, 49, 10, 4, false).v.length === 0, "alt = no snap");
  ok(snapMove(95, 99, 10, 4, false).x === 90 && snapMove(95, 99, 10, 4, false).y === 96, "kept inside");
  return { passed, failed };
}
