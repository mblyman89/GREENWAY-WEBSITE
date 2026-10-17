"use client";

/**
 * R70 S2 - the Merch Studio canvas. One SVG whose user unit is ONE INCH:
 * the garment view (illustrative silhouette, real proportions), every
 * placement's exact print frame (dashed), obstacles (zipper, pouch, seam,
 * hood - hatched), inch rulers, and the art. Interaction mirrors the Banner
 * Studio: drag to move with smart guides (Alt = no snap), corner handles to
 * resize (Shift = free aspect / keep aspect for shapes), top handle to rotate
 * (Shift = 15 deg steps), Shift-click to multi-select. The parent owns state,
 * history and the keyboard.
 */
import { useId, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import type { Blank, Placement } from "@/lib/merch-studio/garment-catalog-core";
import { garmentView, frameRect, zoomBox, type Rect } from "@/lib/merch-studio/garment-views-core";
import { curvedBox, fromPct, resizeRotated, rotatedBox, textLines, toPct, type MElement, type MerchDesign } from "@/lib/merch-studio/merch-design-core";
import { smartSnap, type GuideLine } from "@/lib/cms/banner-guides-core";
import { angleFromPointer } from "@/lib/cms/banner-arrange-core";
import { shapePoints, type ShapeKind } from "@/lib/cms/banner-elements-core";
import { fontStack } from "@/lib/cms/fonts";
import { isDarkColor } from "@/lib/merch-studio/garment-catalog-core";

export type CanvasZoom = "garment" | "frame";
type Corner = "nw" | "ne" | "sw" | "se";
type Drag =
  | { mode: "move"; sx: number; sy: number; start: Map<string, MElement>; primary: string }
  | { mode: "resize"; sx: number; sy: number; el: MElement; corner: Corner }
  | { mode: "rotate"; el: MElement; cx: number; cy: number };

export function MerchElementArt({ e, url, uid }: { e: MElement; url?: string; uid: string }) {
  const sw = (box: number) => (e.strokeIn > 0 ? { stroke: e.strokeColor, strokeWidth: (e.strokeIn * box) / Math.max(0.01, Math.min(e.w, e.h)) } : {});
  if (e.kind === "image") {
    return url ? <image href={url} x={0} y={0} width={e.w} height={e.h} preserveAspectRatio="none" /> : <rect width={e.w} height={e.h} fill="none" stroke="#f0b429" strokeWidth={Math.min(e.w, e.h) / 40} strokeDasharray="0.1 0.1" />;
  }
  if (e.kind === "icon") {
    return (
      <svg x={0} y={0} width={e.w} height={e.h} viewBox="0 0 256 256" preserveAspectRatio="none" overflow="visible">
        <path d={e.iconPath} fill={e.fill} {...sw(256)} style={{ paintOrder: "stroke" }} />
      </svg>
    );
  }
  if (e.kind === "shape") {
    const stroke = e.strokeIn > 0 ? { stroke: e.strokeColor, strokeWidth: e.strokeIn } : {};
    if (e.shape === "rect" || e.shape === "line") return <rect width={e.w} height={e.h} rx={e.shape === "rect" ? e.radiusIn ?? 0 : e.h / 2} fill={e.fill} {...stroke} />;
    if (e.shape === "circle") return <ellipse cx={e.w / 2} cy={e.h / 2} rx={e.w / 2} ry={e.h / 2} fill={e.fill} {...stroke} />;
    const pts = shapePoints((e.shape ?? "star") as ShapeKind);
    return (
      <svg x={0} y={0} width={e.w} height={e.h} viewBox="0 0 100 100" preserveAspectRatio="none" overflow="visible">
        {pts ? <polygon points={pts} fill={e.fill} {...sw(100)} /> : null}
      </svg>
    );
  }
  // text
  const fs = e.fontSizeIn ?? 0.6;
  const style = { fontFamily: fontStack(e.fontId, "system"), fontWeight: e.weight ?? 700, fontStyle: e.italic ? "italic" : "normal", letterSpacing: `${e.letterSpacingEm ?? 0}em`, paintOrder: "stroke" as const };
  const stroke = e.strokeIn > 0 ? { stroke: e.strokeColor, strokeWidth: e.strokeIn * 2, strokeLinejoin: "round" as const } : {};
  const lines = textLines(e.text);
  if (e.curve && lines.length === 1) {
    const cb = curvedBox((e.lineWidthsIn ?? [e.w])[0], fs, e.curve);
    const pid = `mp-${uid}-${e.id}`;
    return (
      <svg x={0} y={0} width={e.w} height={e.h} viewBox={cb.viewBox} overflow="visible">
        <defs><path id={pid} d={cb.d} /></defs>
        <text fontSize={fs} fill={e.fill} style={style} {...stroke}>
          <textPath href={`#${pid}`} startOffset="50%" textAnchor="middle">{lines[0]}</textPath>
        </text>
      </svg>
    );
  }
  const anchor = e.align === "left" ? "start" : e.align === "right" ? "end" : "middle";
  const ax = e.align === "left" ? 0 : e.align === "right" ? e.w : e.w / 2;
  const lh = e.lineHeight ?? 1.1;
  return (
    <text fontSize={fs} fill={e.fill} style={style} textAnchor={anchor} {...stroke}>
      {lines.map((l, i) => (
        <tspan key={i} x={ax} y={fs * i * lh + fs * 0.5} dominantBaseline="central">{l || " "}</tspan>
      ))}
    </text>
  );
}

function Hatch({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} width="0.25" height="0.25" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="0.25" height="0.25" fill={color} fillOpacity="0.12" />
      <line x1="0" y1="0" x2="0" y2="0.25" stroke={color} strokeWidth="0.06" strokeOpacity="0.55" />
    </pattern>
  );
}

export function MerchCanvas({
  blank, design, placement, zoom, garmentHex, selected, assetUrls, interactive = true, showGuides = true, snap = true, maxH,
  onSelect, onElements, onPlacement, flagged,
}: {
  blank: Blank;
  design: MerchDesign;
  placement: Placement;
  zoom: CanvasZoom;
  garmentHex: string;
  selected: string[];
  assetUrls: Record<string, string>;
  interactive?: boolean;
  showGuides?: boolean;
  snap?: boolean;
  maxH?: number;
  onSelect?: (ids: string[]) => void;
  onElements?: (els: MElement[]) => void;
  onPlacement?: (id: string) => void;
  /** element ids with blockers (red outline). */
  flagged?: Set<string>;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ v: GuideLine[]; h: GuideLine[] } | null>(null);
  const [readout, setReadout] = useState<string | null>(null);

  const gv = garmentView(blank, placement.view);
  const fr = frameRect(blank, placement);
  const vb: Rect = zoom === "frame" ? zoomBox(fr) : { x: gv.minX - 0.6, y: gv.minY - 0.6, w: gv.w + 1.2, h: gv.h + 1.2 };
  const u = vb.w / 60; // UI unit (handles, labels) in inches
  const dark = isDarkColor(garmentHex);
  const ink = dark ? "#ffffff" : "#000000";
  const els = design.sides[placement.id]?.elements ?? [];
  const samePlacements = blank.placements.filter((p) => p.view === placement.view);

  const toSvg = (ev: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    return { x: pt.x - fr.x, y: pt.y - fr.y }; // frame inches
  };

  const startMove = (ev: RPointerEvent, e: MElement) => {
    if (!interactive || !onSelect) return;
    ev.stopPropagation();
    let ids = selected;
    if (ev.shiftKey) ids = selected.includes(e.id) ? selected.filter((x) => x !== e.id) : [...selected, e.id];
    else if (!selected.includes(e.id)) ids = [e.id];
    onSelect(ids);
    if (e.locked || !ids.includes(e.id)) return;
    const p = toSvg(ev);
    drag.current = { mode: "move", sx: p.x, sy: p.y, primary: e.id, start: new Map(els.filter((x) => ids.includes(x.id) && !x.locked).map((x) => [x.id, x])) };
    svgRef.current?.setPointerCapture(ev.pointerId);
  };
  const startResize = (ev: RPointerEvent, e: MElement, corner: Corner) => {
    ev.stopPropagation();
    const p = toSvg(ev);
    drag.current = { mode: "resize", sx: p.x, sy: p.y, el: e, corner };
    svgRef.current?.setPointerCapture(ev.pointerId);
  };
  const startRotate = (ev: RPointerEvent, e: MElement) => {
    ev.stopPropagation();
    drag.current = { mode: "rotate", el: e, cx: e.x + e.w / 2, cy: e.y + e.h / 2 };
    svgRef.current?.setPointerCapture(ev.pointerId);
  };

  const onMove = (ev: RPointerEvent) => {
    const d = drag.current;
    if (!d || !onElements) return;
    const p = toSvg(ev);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    if (d.mode === "move") {
      const prim = d.start.get(d.primary);
      if (!prim) return;
      const bb = rotatedBox(prim);
      const others = els.filter((x) => !d.start.has(x.id) && !x.hidden).map((x) => ({ id: x.id, ...toPct(rotatedBox(x), fr.w, fr.h) }));
      const want = toPct({ x: bb.x + (p.x - d.sx), y: bb.y + (p.y - d.sy), w: bb.w, h: bb.h }, fr.w, fr.h);
      const s = smartSnap(want.x, want.y, want.w, want.h, others, snap && !ev.altKey);
      const at = fromPct(s.x, s.y, fr.w, fr.h);
      const dx = at.x - bb.x; const dy = at.y - bb.y;
      setGuides(showGuides ? { v: s.v, h: s.h } : null);
      setReadout(`L ${r2(at.x)}"  T ${r2(at.y)}"  R ${r2(fr.w - at.x - bb.w)}"  B ${r2(fr.h - at.y - bb.h)}"`);
      onElements(els.map((x) => { const st = d.start.get(x.id); return st ? { ...x, x: Math.round((st.x + dx) * 10000) / 10000, y: Math.round((st.y + dy) * 10000) / 10000 } : x; }));
    } else if (d.mode === "resize") {
      const e = d.el;
      const keepDefault = e.kind !== "shape";
      const keep = ev.shiftKey ? !keepDefault : keepDefault;
      const nb = resizeRotated(e, d.corner, p.x - d.sx, p.y - d.sy, keep);
      let next: MElement = { ...e, ...nb };
      if (e.kind === "text") {
        const k = nb.w / e.w;
        next = { ...next, fontSizeIn: Math.round((e.fontSizeIn ?? 0.6) * k * 10000) / 10000, lineWidthsIn: (e.lineWidthsIn ?? [e.w]).map((x) => x * k), h: e.h * k };
      }
      setReadout(`${r2(next.w)}" x ${r2(next.h)}"`);
      onElements(els.map((x) => (x.id === e.id ? next : x)));
    } else {
      const a = angleFromPointer(d.cx, d.cy, p.x, p.y, ev.shiftKey);
      setReadout(`${a}\u00b0`);
      onElements(els.map((x) => (x.id === d.el.id ? { ...x, rotate: a } : x)));
    }
  };
  const onUp = (ev: RPointerEvent) => {
    if (drag.current) svgRef.current?.releasePointerCapture?.(ev.pointerId);
    drag.current = null;
    setGuides(null);
    setReadout(null);
  };

  const selEls = els.filter((e) => selected.includes(e.id));
  const handles = (e: MElement): ReactNode => {
    if (!interactive || e.locked || selEls.length !== 1) return null;
    const hs = u * 0.9;
    const c = (x: number, y: number, corner: Corner) => (
      <rect key={corner} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} fill="#ffffff" stroke="#16a34a" strokeWidth={u * 0.15}
        style={{ cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize" }} onPointerDown={(ev) => startResize(ev, e, corner)} />
    );
    return (
      <>
        <line x1={e.w / 2} y1={0} x2={e.w / 2} y2={-u * 2.2} stroke="#16a34a" strokeWidth={u * 0.15} />
        <circle cx={e.w / 2} cy={-u * 2.2} r={hs * 0.6} fill="#16a34a" stroke="#fff" strokeWidth={u * 0.12} style={{ cursor: "grab" }} onPointerDown={(ev) => startRotate(ev, e)} />
        {c(0, 0, "nw")}{c(e.w, 0, "ne")}{c(0, e.h, "sw")}{c(e.w, e.h, "se")}
      </>
    );
  };

  const ticks: ReactNode[] = [];
  if (showGuides && interactive) {
    for (let i = 0; i <= fr.w * 4 + 1e-9; i += 1) {
      const x = i / 4; const big = i % 4 === 0;
      ticks.push(<line key={`tx${i}`} x1={x} y1={0} x2={x} y2={-(big ? u * 1.1 : u * 0.5)} stroke={ink} strokeOpacity={0.5} strokeWidth={u * 0.08} />);
      if (big && zoom === "frame") ticks.push(<text key={`lx${i}`} x={x} y={-u * 1.4} fontSize={u * 1.1} fill={ink} fillOpacity={0.6} textAnchor="middle">{i / 4}</text>);
    }
    for (let i = 0; i <= fr.h * 4 + 1e-9; i += 1) {
      const y = i / 4; const big = i % 4 === 0;
      ticks.push(<line key={`ty${i}`} x1={0} y1={y} x2={-(big ? u * 1.1 : u * 0.5)} y2={y} stroke={ink} strokeOpacity={0.5} strokeWidth={u * 0.08} />);
      if (big && zoom === "frame" && i > 0) ticks.push(<text key={`ly${i}`} x={-u * 1.5} y={y} fontSize={u * 1.1} fill={ink} fillOpacity={0.6} textAnchor="end" dominantBaseline="central">{i / 4}</text>);
    }
  }

  const draw = (list: MElement[], frame: Rect, active: boolean) => list.filter((e) => !e.hidden).map((e) => (
    <g key={e.id} transform={`translate(${frame.x + e.x} ${frame.y + e.y}) rotate(${e.rotate} ${e.w / 2} ${e.h / 2})`} opacity={(e.opacity / 100) * (active || !interactive ? 1 : 0.55)}
      style={active && interactive ? { cursor: e.locked ? "not-allowed" : "move" } : { pointerEvents: "none" }}
      onPointerDown={active ? (ev) => startMove(ev, e) : undefined}>
      <rect width={e.w} height={e.h} fill="transparent" />
      <MerchElementArt e={e} url={e.assetId ? assetUrls[e.assetId] : undefined} uid={uid} />
    </g>
  ));

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="block h-auto w-full touch-none select-none rounded-[var(--admin-radius-sm)]"
        style={{ maxHeight: maxH, background: "repeating-conic-gradient(#1f2622 0% 25%, #232b26 0% 50%) 50% / 20px 20px" }}
        onPointerMove={interactive ? onMove : undefined}
        onPointerUp={interactive ? onUp : undefined}
        onPointerCancel={interactive ? onUp : undefined}
        onPointerDown={interactive && onSelect ? () => onSelect([]) : undefined}
        role="img"
        aria-label={`${blank.brand} ${blank.model} ${gv.label} - ${placement.label} print area ${placement.widthIn} by ${placement.heightIn} inches`}
      >
        <defs>
          <Hatch id={`hb-${uid}`} color="#ef4444" />
          <Hatch id={`hw-${uid}`} color="#f0b429" />
        </defs>
        <g transform={gv.mirror ? `translate(${2 * gv.minX + gv.w} 0) scale(-1 1)` : undefined}>
          <path d={gv.body} fill={garmentHex} stroke={dark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)"} strokeWidth={vb.w / 400} strokeLinejoin="round" />
          {gv.details.map((d, i) => (
            <path key={i} d={d.d} fill={d.kind === "shade" ? (dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)") : "none"}
              stroke={dark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)"} strokeWidth={vb.w / 500} strokeDasharray={d.kind === "dash" ? `${vb.w / 150} ${vb.w / 200}` : undefined} />
          ))}
        </g>
        {/* other placements on this view: faint frames + their art */}
        {samePlacements.filter((p) => p.id !== placement.id).map((p) => {
          const r = frameRect(blank, p);
          const used = (design.sides[p.id]?.elements ?? []).some((e) => !e.hidden);
          return (
            <g key={p.id}>
              {draw(design.sides[p.id]?.elements ?? [], r, false)}
              {interactive && zoom === "garment" ? (
                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" stroke={ink} strokeOpacity={used ? 0.35 : 0.18} strokeWidth={u * 0.1} strokeDasharray={`${u * 0.5} ${u * 0.4}`}
                  style={{ cursor: "pointer" }} onPointerDown={(ev) => { ev.stopPropagation(); onPlacement?.(p.id); }}>
                  <title>{`Switch to ${p.label}`}</title>
                </rect>
              ) : null}
            </g>
          );
        })}
        {/* current print frame */}
        <g transform={`translate(${fr.x} ${fr.y})`}>
          {interactive ? placement.obstacles.map((o, i) => (
            <g key={i}>
              <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={`url(#${o.severity === "blocker" ? "hb" : "hw"}-${uid})`} />
              {interactive ? <text x={o.x + o.w / 2} y={o.y + o.h / 2} fontSize={u * 0.9} fill={o.severity === "blocker" ? "#ef4444" : "#f0b429"} textAnchor="middle" dominantBaseline="central" style={{ pointerEvents: "none" }}>{o.label.split(" (")[0]}</text> : null}
            </g>
          )) : null}
          {interactive ? <rect x={0} y={0} width={fr.w} height={fr.h} fill="none" stroke="#22c55e" strokeWidth={u * 0.14} strokeDasharray={`${u * 0.7} ${u * 0.45}`} /> : null}
          {ticks}
          {showGuides && interactive ? (
            <>
              <line x1={fr.w / 2} y1={0} x2={fr.w / 2} y2={fr.h} stroke="#22c55e" strokeOpacity={0.18} strokeWidth={u * 0.08} />
              <line x1={0} y1={fr.h / 2} x2={fr.w} y2={fr.h / 2} stroke="#22c55e" strokeOpacity={0.18} strokeWidth={u * 0.08} />
            </>
          ) : null}
        </g>
        {draw(els, fr, true)}
        {/* selection */}
        {interactive ? selEls.map((e) => (
          <g key={`s-${e.id}`} transform={`translate(${fr.x + e.x} ${fr.y + e.y}) rotate(${e.rotate} ${e.w / 2} ${e.h / 2})`}>
            <rect width={e.w} height={e.h} fill="none" stroke={e.locked ? "#9ca3af" : "#16a34a"} strokeWidth={u * 0.14} style={{ pointerEvents: "none" }} />
            {handles(e)}
          </g>
        )) : null}
        {interactive && flagged ? els.filter((e) => flagged.has(e.id) && !e.hidden && !selected.includes(e.id)).map((e) => (
          <rect key={`f-${e.id}`} transform={`translate(${fr.x + e.x} ${fr.y + e.y}) rotate(${e.rotate} ${e.w / 2} ${e.h / 2})`} width={e.w} height={e.h} fill="none" stroke="#ef4444" strokeWidth={u * 0.12} strokeDasharray={`${u * 0.4} ${u * 0.3}`} style={{ pointerEvents: "none" }} />
        )) : null}
        {guides ? (
          <g transform={`translate(${fr.x} ${fr.y})`} style={{ pointerEvents: "none" }}>
            {guides.v.map((g, i) => <line key={`v${i}`} x1={(g.at / 100) * fr.w} x2={(g.at / 100) * fr.w} y1={(g.from / 100) * fr.h} y2={(g.to / 100) * fr.h} stroke="#ec4899" strokeWidth={u * 0.1} />)}
            {guides.h.map((g, i) => <line key={`h${i}`} y1={(g.at / 100) * fr.h} y2={(g.at / 100) * fr.h} x1={(g.from / 100) * fr.w} x2={(g.to / 100) * fr.w} stroke="#ec4899" strokeWidth={u * 0.1} />)}
          </g>
        ) : null}
        {interactive ? (
          <text x={fr.x + fr.w} y={fr.y + fr.h + u * 1.6} fontSize={u * 1.05} fill="#22c55e" textAnchor="end" style={{ pointerEvents: "none" }}>
            {placement.label} {placement.widthIn}&quot; x {placement.heightIn}&quot;
          </text>
        ) : null}
      </svg>
      {readout ? <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/75 px-2 py-0.5 font-mono text-[0.7rem] text-white">{readout}</span> : null}
    </div>
  );
}
