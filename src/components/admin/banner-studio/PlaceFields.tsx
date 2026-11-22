"use client";

/**
 * D263 S10 - exact placement for print designs: X / Y from the TRIM top-left
 * and W / H, in inches (what a designer measures with a ruler). Shown for one
 * selected item. Values round to 0.001". Text-box height follows its words,
 * buttons size to their label, so those fields only appear where they apply.
 */
import { useState } from "react";
import { boxPosition, inToPct, inToSpan, pctToIn, roundStep, spanToIn, PRINT_PLACE_STEP, type BannerDesign, type DesignDevice, type DesignPrint } from "@/lib/cms/banner-design-core";
import { elementPosition } from "@/lib/cms/banner-elements-core";
import { setPositions, type ItemRef } from "@/lib/cms/banner-arrange-core";

const q = (n: number) => roundStep(n, PRINT_PLACE_STEP);

function Num({ label, value, onCommit, title }: { label: string; value: number; onCommit: (v: number) => void; title: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v)) onCommit(v);
  };
  return (
    <label className="flex items-center gap-0.5 text-[0.7rem] text-white/70" title={title}>
      {label}
      <input
        aria-label={title}
        inputMode="decimal"
        className="w-[4.2rem] rounded border border-white/15 bg-black px-1 py-0.5 text-white"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setDraft(null);
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            // 1/100" per press, Shift = 1/10" (like InDesign's field nudge).
            e.preventDefault();
            const st = (e.shiftKey ? 0.1 : 0.01) * (e.key === "ArrowUp" ? 1 : -1);
            setDraft(null);
            onCommit(Math.round((value + st) * 1000) / 1000);
          }
        }}
      />
      <span className="text-white/40">in</span>
    </label>
  );
}

export function PlaceFields({ design, device, item, onChange }: { design: BannerDesign; device: DesignDevice; item: ItemRef; onChange: (d: BannerDesign) => void }) {
  const p: DesignPrint | undefined = design.frame.print;
  if (!p) return null;
  const box = item.target === "box" ? design.boxes.find((b) => b.id === item.id) : undefined;
  const el = item.target === "element" ? (design.elements ?? []).find((e) => e.id === item.id) : undefined;
  const btn = item.target === "button" ? design.buttons.find((b) => b.id === item.id) : undefined;
  const it = box ?? el ?? btn;
  if (!it) return null;
  const pos: { x: number; y: number; w: number; h: number | null } = box ? { ...boxPosition(box, device), h: null } : el ? elementPosition(el, device) : { x: device === "mobile" ? (btn!.mx ?? btn!.x) : btn!.x, y: device === "mobile" ? (btn!.my ?? btn!.y) : btn!.y, w: 0, h: null };
  const locked = !!it.locked;

  const setXY = (axis: "x" | "y", inches: number) => {
    const next = { x: pos.x, y: pos.y, [axis]: inToPct(inches, axis, p) };
    onChange(setPositions(design, new Map([[item.id, next]]), device));
  };
  const setW = (inches: number) => {
    const w = q(Math.min(100, Math.max(box ? 5 : 1, inToSpan(inches, "x", p))));
    if (box) onChange({ ...design, boxes: design.boxes.map((b) => (b.id !== item.id ? b : device === "mobile" ? { ...b, mw: w } : { ...b, w })) });
    else if (el) onChange({ ...design, elements: (design.elements ?? []).map((e) => (e.id !== item.id ? e : device === "mobile" ? { ...e, mw: w } : { ...e, w })) });
  };
  const setH = (inches: number) => {
    if (!el) return;
    const h = q(Math.min(100, Math.max(0.1, inToSpan(inches, "y", p))));
    onChange({ ...design, elements: (design.elements ?? []).map((e) => (e.id !== item.id ? e : device === "mobile" ? { ...e, mh: h } : { ...e, h })) });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Exact position in inches">
      <Num label="X" value={pctToIn(pos.x, "x", p)} onCommit={(v) => !locked && setXY("x", v)} title="Left edge, inches from the trim's left edge (↑/↓ = 0.01, Shift = 0.1)" />
      <Num label="Y" value={pctToIn(pos.y, "y", p)} onCommit={(v) => !locked && setXY("y", v)} title="Top edge, inches from the trim's top edge (↑/↓ = 0.01, Shift = 0.1)" />
      {box || el ? <Num label="W" value={spanToIn(pos.w, "x", p)} onCommit={(v) => !locked && setW(v)} title={box ? "Text width in inches (words wrap inside it)" : "Width in inches"} /> : null}
      {el && pos.h !== null ? <Num label="H" value={spanToIn(pos.h, "y", p)} onCommit={(v) => !locked && setH(v)} title="Height in inches" /> : null}
      {locked ? <span className="text-[0.7rem] text-white/50">🔒 locked</span> : null}
    </div>
  );
}
