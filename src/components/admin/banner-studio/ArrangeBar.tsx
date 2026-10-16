"use client";

/**
 * R56-S3 — the Arrange bar under the canvas: align (to the banner for one
 * item, to each other for a group), distribute, duplicate, copy / paste (works
 * between banners — the clipboard is this browser's storage), rotate, and
 * delete a whole group. Ctrl/⌘ + C / V / D do the same from the keyboard.
 */
import { useEffect, useRef, useState } from "react";
import type { BannerDesign, DesignDevice } from "@/lib/cms/banner-design-core";
import {
  CLIPBOARD_KEY,
  alignRects,
  copyItems,
  distributeRects,
  parseClipboard,
  pasteItems,
  removeItems,
  rotateItem,
  setPositions,
  type AlignMode,
  type ItemRef,
  type PctRect,
} from "@/lib/cms/banner-arrange-core";

const btn = "rounded bg-white/10 px-2 py-1 text-[0.7rem] text-white/85 hover:bg-white/20 disabled:opacity-30";

const ALIGN: { mode: AlignMode; label: string; title: string }[] = [
  { mode: "left", label: "⇤", title: "Align left edges" },
  { mode: "center", label: "↔", title: "Centre horizontally" },
  { mode: "right", label: "⇥", title: "Align right edges" },
  { mode: "top", label: "⤒", title: "Align tops" },
  { mode: "middle", label: "↕", title: "Centre vertically" },
  { mode: "bottom", label: "⤓", title: "Align bottoms" },
];

/** Measure items on the Studio canvas (in % of the frame; the canvas scale cancels out). */
function measure(root: HTMLElement | null, refs: ItemRef[]): PctRect[] {
  const frame = root?.querySelector<HTMLElement>(".gw-dframe");
  if (!frame) return [];
  const f = frame.getBoundingClientRect();
  if (!f.width || !f.height) return [];
  const out: PctRect[] = [];
  for (const r of refs) {
    const el = frame.querySelector<HTMLElement>(`[data-studio-id="${CSS.escape(r.id)}"]`);
    if (!el) continue;
    const b = el.getBoundingClientRect();
    out.push({ id: r.id, x: ((b.left - f.left) / f.width) * 100, y: ((b.top - f.top) / f.height) * 100, w: (b.width / f.width) * 100, h: (b.height / f.height) * 100 });
  }
  return out;
}

function itemRotate(design: BannerDesign, r: ItemRef): number {
  const it = r.target === "box" ? design.boxes.find((b) => b.id === r.id) : r.target === "button" ? design.buttons.find((b) => b.id === r.id) : (design.elements ?? []).find((e) => e.id === r.id);
  return it?.rotate ?? 0;
}

export function ArrangeBar({
  design,
  device,
  refs,
  rootRef,
  legacy,
  onChange,
  onSelectMany,
}: {
  design: BannerDesign;
  device: DesignDevice;
  /** The selected items (one, or a shift-click group). */
  refs: ItemRef[];
  rootRef: React.RefObject<HTMLDivElement | null>;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  onChange: (d: BannerDesign) => void;
  onSelectMany: (refs: ItemRef[]) => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const many = refs.length > 1;
  const one = refs.length === 1 ? refs[0]! : null;

  const align = (mode: AlignMode) => onChange(setPositions(design, alignRects(measure(rootRef.current, refs), mode), device));
  const distribute = (axis: "h" | "v") => onChange(setPositions(design, distributeRects(measure(rootRef.current, refs), axis), device));
  const paste = (raw: string | null, label: string) => {
    const clip = parseClipboard(raw);
    if (!clip) return setMsg("Nothing to paste yet — select something and press Copy first.");
    const r = pasteItems(design, clip);
    if (!r.added.length) return setMsg("This banner is full for that kind of item (limits: 8 text boxes, 4 buttons, 12 shapes).");
    onChange(r.design);
    onSelectMany(r.added);
    setMsg(`${label} ${r.added.length} item${r.added.length > 1 ? "s" : ""}${r.skipped ? ` (${r.skipped} skipped — banner limit)` : ""}. Not saved until you press Save.`);
  };
  const copy = () => {
    if (!refs.length) return;
    try {
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(copyItems(design, refs, legacy)));
      setMsg(`Copied ${refs.length} item${refs.length > 1 ? "s" : ""}. Paste here or in any other banner.`);
    } catch {
      setMsg("This browser blocked the copy (private mode?). Use Duplicate instead.");
    }
  };
  const duplicate = () => refs.length && paste(JSON.stringify(copyItems(design, refs, legacy)), "Duplicated");
  const readClip = () => {
    try {
      return localStorage.getItem(CLIPBOARD_KEY);
    } catch {
      return null;
    }
  };

  // Ctrl/⌘ + C / V / D while focus is in the Studio (never while typing).
  const api = useRef({ copy, duplicate, paste: () => paste(readClip(), "Pasted") });
  useEffect(() => {
    api.current = { copy, duplicate, paste: () => paste(readClip(), "Pasted") };
  });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select") || t.isContentEditable || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "c" && window.getSelection()?.toString()) return; // copying selected text
      if (k === "c") api.current.copy();
      else if (k === "v") api.current.paste();
      else if (k === "d") api.current.duplicate();
      else return;
      e.preventDefault();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [rootRef]);

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md bg-white/5 px-2 py-1.5" role="toolbar" aria-label="Arrange">
      <span className="mr-1 text-[0.7rem] font-semibold text-white/60">{many ? `${refs.length} selected` : one ? "Arrange" : "Arrange (select an item)"}</span>
      {ALIGN.map((a) => (
        <button key={a.mode} type="button" className={btn} disabled={!refs.length} onClick={() => align(a.mode)} title={`${a.title}${many ? "" : " (to the banner)"}`} aria-label={a.title}>
          {a.label}
        </button>
      ))}
      <button type="button" className={btn} disabled={refs.length < 3} onClick={() => distribute("h")} title="Equal gaps left→right (select 3+)">
        ⇹ Space
      </button>
      <button type="button" className={btn} disabled={refs.length < 3} onClick={() => distribute("v")} title="Equal gaps top→bottom (select 3+)">
        ⇳ Space
      </button>
      <span className="mx-1 h-4 w-px bg-white/15" aria-hidden="true" />
      <button type="button" className={btn} disabled={!refs.length} onClick={duplicate} title="Duplicate (Ctrl/⌘+D)">
        ⧉ Duplicate
      </button>
      <button type="button" className={btn} disabled={!refs.length} onClick={copy} title="Copy (Ctrl/⌘+C) — paste into this or another banner">
        Copy
      </button>
      <button type="button" className={btn} onClick={() => paste(readClip(), "Pasted")} title="Paste (Ctrl/⌘+V)">
        Paste
      </button>
      {one ? (
        <label className="ml-1 flex items-center gap-1 text-[0.7rem] text-white/70" title="Rotation in degrees (or drag the gold knob on the canvas)">
          ⟳
          <input
            type="number"
            min={-180}
            max={180}
            value={itemRotate(design, one)}
            onChange={(e) => onChange(rotateItem(design, one, Number(e.target.value) || 0))}
            className="w-14 rounded border border-white/15 bg-black px-1 py-0.5 text-white"
          />
          °
        </label>
      ) : null}
      {many ? (
        <>
          <button type="button" className={btn} onClick={() => onChange(removeItems(design, refs))} title="Delete every selected item (locked ones stay; Undo brings them back)">
            🗑 Delete {refs.length}
          </button>
          <button type="button" className={btn} onClick={() => onSelectMany([])}>
            Clear selection
          </button>
        </>
      ) : null}
      {msg ? (
        <span className="basis-full text-[0.7rem] text-white/60" aria-live="polite">
          {msg}
        </span>
      ) : null}
    </div>
  );
}
