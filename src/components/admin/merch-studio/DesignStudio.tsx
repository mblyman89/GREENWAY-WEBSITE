"use client";

/**
 * R70 S2 - the Merch Studio "Design" tab. Banner-Studio behaviours, tailored
 * to garments:
 *  - Docked canvas that follows the scroll (useStudioDock: same on/off + size prefs).
 *  - Undo / redo (60 steps, 600 ms grouping; Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y).
 *  - Arrow-key nudge 1/16" (Shift = 1/4"), Delete, Ctrl+D duplicate, Ctrl+A, Esc.
 *  - Smart guides + snapping (Alt = off), align / distribute, rotate snap.
 *  - Every placement of the blank is its own "side" with its own method.
 *  - Live print checks per side (rules engine from Slice 1), blockers outlined.
 *  - Colour-swap preview across every Printful colour of the blank.
 *  - Drafts saved on this device (localStorage + IndexedDB for art).
 */
import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent } from "react";
import { BLANKS, colorsFor, formatCents, getBlank, sizesFor, basePriceCents, METHOD_LABEL, METHOD_BLURB, type Method } from "@/lib/merch-studio/garment-catalog-core";
import { VIEW_LABEL, viewsFor } from "@/lib/merch-studio/garment-views-core";
import { summarize } from "@/lib/merch-studio/print-rules-core";
import {
  checkSides, curvedBox, fontSizeForLetterHeight, makeIcon, makeImage, makeShape, makeText, newDesign, newId, normalizeDesign, rotatedBox, setSide, sideFor,
  snapSideToThreads, textBox, textLines, toPct, usedPlacements, NUDGE_BIG_IN, NUDGE_IN, MAX_ELEMENTS_PER_SIDE, type MElement, type MerchDesign, type Side,
} from "@/lib/merch-studio/merch-design-core";
import { alignRects, distributeRects, type AlignMode } from "@/lib/cms/banner-arrange-core";
import { fontStack } from "@/lib/cms/fonts";
import { useStudioDock, type DockSize } from "@/components/admin/banner-studio/useStudioDock";
import { Segmented, Toggle, studioInput } from "@/components/admin/banner-studio/controls";
import { MerchCanvas, type CanvasZoom } from "./MerchCanvas";
import { AddPanel } from "./AddPanel";
import { ElementPanel } from "./ElementPanel";
import { IssueList } from "./IssueList";
import { getAsset, inspectImage, loadDesigns, measureLinesEm, putAsset, saveDesigns } from "./merch-assets";

const HISTORY_MAX = 60;
const GROUP_MS = 600;
const CURRENT_KEY = "gw-merch-current-design";
type Sub = "add" | "selected" | "layers" | "checks" | "preview" | "drafts";
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

function initial(blankId: string, colorHex: string): { list: MerchDesign[]; cur: MerchDesign } {
  if (typeof window === "undefined") return { list: [], cur: newDesign(getBlank(blankId) ?? BLANKS[0], colorHex) };
  const list = loadDesigns();
  let id: string | null = null;
  try { id = window.localStorage.getItem(CURRENT_KEY); } catch { /* blocked */ }
  const found = list.find((d) => d.id === id) ?? list[0];
  return { list, cur: found ?? newDesign(getBlank(blankId) ?? BLANKS[0], colorHex) };
}

/** Wall clock for undo grouping - only ever called from event handlers, never during render. */
const clockMs = () => Date.now();

export function DesignStudio({ blankId, colorHex, setBlank, setColor }: { blankId: string; colorHex: string; setBlank: (id: string) => void; setColor: (hex: string) => void }) {
  const [boot] = useState(() => initial(blankId, colorHex));
  const [list, setList] = useState<MerchDesign[]>(boot.list);
  const [design, setDesign] = useState<MerchDesign>(boot.cur);
  const blank = getBlank(design.blankId) ?? BLANKS[0];
  const [placementId, setPlacementId] = useState(() => usedPlacements(boot.cur, getBlank(boot.cur.blankId) ?? BLANKS[0])[0]?.id ?? (getBlank(boot.cur.blankId) ?? BLANKS[0]).placements[0].id);
  const placement = blank.placements.find((p) => p.id === placementId) ?? blank.placements[0];
  const side = sideFor(design, placement);
  const [selected, setSelected] = useState<string[]>([]);
  const [sub, setSub] = useState<Sub>("add");
  const [zoom, setZoom] = useState<CanvasZoom>("frame");
  const [snap, setSnap] = useState(true);
  const [guides, setGuides] = useState(true);
  const [previewHex, setPreviewHex] = useState<string | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const { follow, saveFollow, dockSize, saveDock, dockTop, canvasMaxH } = useStudioDock();

  // History -----------------------------------------------------------------------
  const past = useRef<MerchDesign[]>([]);
  const future = useRef<MerchDesign[]>([]);
  const lastPush = useRef(0);
  const designRef = useRef(design);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const sync = () => setCounts({ undo: past.current.length, redo: future.current.length });
  const commit = (next: MerchDesign) => { designRef.current = next; setDesign(next); setSaved(false); };
  const change = (next: MerchDesign) => {
    const now = clockMs();
    if (now - lastPush.current > GROUP_MS) { past.current = [...past.current, designRef.current].slice(-HISTORY_MAX); future.current = []; }
    lastPush.current = now;
    commit(next);
    sync();
  };
  const undo = () => {
    const prev = past.current[past.current.length - 1];
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [designRef.current, ...future.current].slice(0, HISTORY_MAX);
    lastPush.current = 0;
    commit(prev);
    sync();
  };
  const redo = () => {
    const nxt = future.current[0];
    if (!nxt) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, designRef.current].slice(-HISTORY_MAX);
    lastPush.current = 0;
    commit(nxt);
    sync();
  };
  const resetHistory = () => { past.current = []; future.current = []; lastPush.current = 0; sync(); };

  // Autosave (debounced) -------------------------------------------------------------
  useEffect(() => {
    if (saved) return;
    const t = window.setTimeout(() => {
      const stamped = { ...design, updatedAt: new Date().toISOString() };
      const next = [stamped, ...list.filter((d) => d.id !== stamped.id)].slice(0, 60);
      const ok = saveDesigns(next);
      try { window.localStorage.setItem(CURRENT_KEY, stamped.id); } catch { /* blocked */ }
      setList(next);
      setSaved(ok);
      setMsg(ok ? null : "This browser refused to save the draft (storage full or blocked). Export or delete old drafts.");
    }, 700);
    return () => window.clearTimeout(t);
  }, [design, saved, list]);

  // Load artwork object URLs for the current design (from IndexedDB).
  useEffect(() => {
    const missing = [...new Set(Object.values(design.sides).flatMap((s) => s.elements.map((e) => e.assetId).filter((x): x is string => !!x)))].filter((id) => !assetUrls[id]);
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(missing.map(async (id) => [id, await getAsset(id).catch(() => null)] as const)).then((rows) => {
      if (cancelled) return;
      const add: Record<string, string> = {};
      for (const [id, blob] of rows) if (blob) add[id] = URL.createObjectURL(blob);
      if (Object.keys(add).length) setAssetUrls((cur) => ({ ...cur, ...add }));
    });
    return () => { cancelled = true; };
  }, [design.sides, assetUrls]);

  // Side helpers ---------------------------------------------------------------------
  const setEls = (els: MElement[], pid = placement.id) => {
    const p = blank.placements.find((x) => x.id === pid) ?? placement;
    change(setSide(designRef.current, pid, { ...sideFor(designRef.current, p), elements: els }));
  };
  const els = side.elements;
  const patchEl = (id: string, patch: Partial<MElement>) => setEls(els.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const addEl = (e: MElement) => {
    if (els.length >= MAX_ELEMENTS_PER_SIDE) { setMsg(`Max ${MAX_ELEMENTS_PER_SIDE} elements per placement.`); return; }
    setEls([...els, e]);
    setSelected([e.id]);
    setSub("selected");
  };
  const defaultInk = () => {
    const hex = previewHex ?? design.colorHex;
    const v = parseInt(hex.slice(1), 16);
    const lum = ((v >> 16) & 255) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114;
    return side.method === "embroidery" ? (lum < 128 ? "#FFFFFF" : "#000000") : lum < 128 ? "#ffffff" : "#111111";
  };

  /** Re-measure a text element with the real font and keep its centre in place. */
  const measured = (e: MElement): MElement => {
    if (e.kind !== "text") return e;
    const fs = e.fontSizeIn ?? 0.6;
    const lines = textLines(e.text);
    const widths = measureLinesEm(lines, fontStack(e.fontId, "system"), e.weight ?? 700, !!e.italic, e.letterSpacingEm ?? 0).map((w) => r4(w * fs));
    const box = e.curve && lines.length === 1 ? curvedBox(widths[0], fs, e.curve) : textBox(widths, fs, e.lineHeight ?? 1.1);
    const cx = e.x + e.w / 2; const cy = e.y + e.h / 2;
    return { ...e, lineWidthsIn: widths, w: box.w, h: box.h, x: r4(cx - box.w / 2), y: r4(cy - box.h / 2) };
  };
  const remeasure = (id: string, patch: Partial<MElement>) => {
    const cur = els.find((e) => e.id === id);
    if (!cur) return;
    const next = measured({ ...cur, ...patch, name: patch.text !== undefined && (!cur.name || cur.name === (cur.text ?? "").slice(0, 24)) ? patch.text.slice(0, 24) : cur.name });
    setEls(els.map((e) => (e.id === id ? next : e)));
    // Webfonts load lazily: measure again once the face is ready (no extra undo step - grouped).
    const stack = fontStack(next.fontId, "system");
    document.fonts?.load(`${next.weight ?? 700} 100px ${stack}`).then(() => {
      const d = designRef.current;
      const s = sideFor(d, placement);
      const live = s.elements.find((e) => e.id === id);
      if (!live) return;
      const again = measured(live);
      if (Math.abs(again.w - live.w) > 1e-3 || Math.abs(again.h - live.h) > 1e-3) {
        lastPush.current = Date.now();
        commit(setSide(d, placement.id, { ...s, elements: s.elements.map((e) => (e.id === id ? again : e)) }));
      }
    }).catch(() => { /* font API unavailable: first measurement stands */ });
  };

  const addText = (text: string, letterIn: number, curve: number, weight: 400 | 700 | 900) => {
    const fs = fontSizeForLetterHeight(Math.max(0.25, Math.min(letterIn, placement.heightIn * 0.8)), text);
    const base = makeText({ w: placement.widthIn, h: placement.heightIn }, text, [1], fs, defaultInk());
    let e = measured({ ...base, weight, curve });
    if (e.w > placement.widthIn) { // too wide: scale down to 90% of the frame
      const k = (placement.widthIn * 0.9) / e.w;
      e = measured({ ...e, fontSizeIn: r4(fs * k) });
    }
    e = { ...e, x: r4((placement.widthIn - e.w) / 2), y: r4(Math.max(0, Math.min(placement.heightIn * 0.15, placement.heightIn - e.h))) };
    addEl(e);
    remeasure(e.id, {});
  };
  const onFile = async (f: File) => {
    setBusy(true);
    setMsg(null);
    try {
      if (f.size > 40 * 1024 * 1024) throw new Error("That file is over 40 MB - export a smaller PNG.");
      const id = newId("asset");
      await putAsset(id, f);
      const url = URL.createObjectURL(f);
      const isSvg = f.type === "image/svg+xml";
      const { w, h, analysis } = await inspectImage(url, isSvg);
      setAssetUrls((cur) => ({ ...cur, [id]: url }));
      let e = makeImage({ w: placement.widthIn, h: placement.heightIn }, id, f.name, w, h, analysis);
      if (isSvg) {
        const fit = Math.min(placement.widthIn * 0.8, (placement.heightIn * 0.8 * w) / h);
        e = { ...e, vector: true, w: r4(fit), h: r4((fit * h) / w), x: r4((placement.widthIn - fit) / 2), y: r4((placement.heightIn - (fit * h) / w) / 2) };
      }
      addEl(e);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not add that image.");
    } finally {
      setBusy(false);
    }
  };

  // Selection ops ----------------------------------------------------------------------
  const selEls = els.filter((e) => selected.includes(e.id));
  const one = selEls.length === 1 ? selEls[0] : null;
  const removeSel = () => { if (!selEls.length) return; setEls(els.filter((e) => !selected.includes(e.id) || e.locked)); setSelected([]); };
  const duplicateSel = () => {
    if (!selEls.length) return;
    const copies = selEls.map((e) => ({ ...e, id: newId(), x: r4(e.x + 0.25), y: r4(e.y + 0.25), locked: false }));
    setEls([...els, ...copies]);
    setSelected(copies.map((c) => c.id));
  };
  const nudge = (dx: number, dy: number) => setEls(els.map((e) => (selected.includes(e.id) && !e.locked ? { ...e, x: r4(e.x + dx), y: r4(e.y + dy) } : e)));
  const arrange = (mode: AlignMode | "dh" | "dv") => {
    const movable = selEls.filter((e) => !e.locked);
    if (!movable.length) return;
    const rects = movable.map((e) => ({ id: e.id, ...toPct(rotatedBox(e), placement.widthIn, placement.heightIn) }));
    const out = mode === "dh" || mode === "dv" ? distributeRects(rects, mode === "dh" ? "h" : "v") : alignRects(rects, mode);
    setEls(els.map((e) => {
      const to = out.get(e.id);
      const from = rects.find((r) => r.id === e.id);
      if (!to || !from) return e;
      return { ...e, x: r4(e.x + ((to.x - from.x) / 100) * placement.widthIn), y: r4(e.y + ((to.y - from.y) / 100) * placement.heightIn) };
    }));
  };
  const reorder = (id: string, dir: "up" | "down" | "top" | "bottom") => {
    const i = els.findIndex((e) => e.id === id);
    if (i < 0) return;
    const arr = els.slice();
    const [it] = arr.splice(i, 1);
    const j = dir === "top" ? arr.length : dir === "bottom" ? 0 : dir === "up" ? Math.min(arr.length, i + 1) : Math.max(0, i - 1);
    arr.splice(j, 0, it);
    setEls(arr);
  };

  const onKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select") || t.isContentEditable) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
      else if (k === "d") { e.preventDefault(); duplicateSel(); }
      else if (k === "a") { e.preventDefault(); setSelected(els.filter((x) => !x.hidden).map((x) => x.id)); }
      return;
    }
    if (!selEls.length) return;
    const step = e.shiftKey ? NUDGE_BIG_IN : NUDGE_IN;
    if (k === "arrowleft") { e.preventDefault(); nudge(-step, 0); }
    else if (k === "arrowright") { e.preventDefault(); nudge(step, 0); }
    else if (k === "arrowup") { e.preventDefault(); nudge(0, -step); }
    else if (k === "arrowdown") { e.preventDefault(); nudge(0, step); }
    else if (k === "delete" || k === "backspace") { e.preventDefault(); removeSel(); }
    else if (k === "escape") setSelected([]);
  };

  // Design-level ops -------------------------------------------------------------------
  const switchPlacement = (pid: string) => { setPlacementId(pid); setSelected([]); };
  const setMethod = (m: Method) => change(setSide(design, placement.id, { ...side, method: m }));
  const changeBlank = (id: string) => {
    const b = getBlank(id);
    if (!b) return;
    const keepHex = colorsFor(b).some((c) => c[1] === design.colorHex) ? design.colorHex : colorsFor(b).find((c) => c[0] === "Black")?.[1] ?? colorsFor(b)[0][1];
    const moved = normalizeDesign({ ...design, blankId: id, colorHex: keepHex });
    if (!moved) return;
    const lost = Object.keys(design.sides).filter((pid) => (design.sides[pid]?.elements.length ?? 0) > 0 && !moved.sides[pid]);
    if (lost.length && !window.confirm(`${b.brand} ${b.model} has no ${lost.join(", ")} placement. Art on those sides will be dropped (Undo brings it back). Continue?`)) return;
    change(moved);
    setPlacementId(usedPlacements(moved, b)[0]?.id ?? b.placements[0].id);
    setSelected([]);
    setBlank(id);
    setColor(keepHex);
  };
  const setDesignColor = (hex: string) => { change({ ...design, colorHex: hex }); setColor(hex); setPreviewHex(null); };
  const openDesign = (d: MerchDesign) => {
    designRef.current = d;
    setDesign(d);
    resetHistory();
    const b = getBlank(d.blankId) ?? BLANKS[0];
    setPlacementId(usedPlacements(d, b)[0]?.id ?? b.placements[0].id);
    setSelected([]);
    setPreviewHex(null);
    setBlank(d.blankId);
    setColor(d.colorHex);
    try { window.localStorage.setItem(CURRENT_KEY, d.id); } catch { /* blocked */ }
  };
  const newFromGarments = () => {
    const b = getBlank(blankId) ?? BLANKS[0];
    const d = newDesign(b, colorHex);
    openDesign(d);
    setSaved(false);
    setSub("add");
  };

  // Checks ---------------------------------------------------------------------------------
  const garmentHex = previewHex ?? design.colorHex;
  const results = checkSides(design, garmentHex);
  const curRes = checkSides(design, garmentHex, placement.id)[0];
  const ackFor = (pid: string) => new Set(design.ack.filter((a) => a.startsWith(`${pid}:`)).map((a) => a.slice(pid.length + 1)));
  const flagged = new Set((curRes?.issues ?? []).filter((i) => i.level === "blocker" && i.elementId).map((i) => i.elementId!));
  const totals = results.reduce((acc, r) => {
    const s = summarize(r.issues);
    const ack = ackFor(r.placement.id);
    const openReview = r.issues.filter((i) => i.level === "review" && !ack.has(i.id)).length;
    return { blocker: acc.blocker + s.blocker, warning: acc.warning + s.warning, review: acc.review + openReview, tip: acc.tip + s.tip };
  }, { blocker: 0, warning: 0, review: 0, tip: 0 });
  const curSum = curRes ? summarize(curRes.issues) : { blocker: 0, warning: 0, review: 0, tip: 0 };
  const used = usedPlacements(design, blank);
  const sizeM = sizesFor(blank).find((s) => s[0] === "M")?.[0] ?? sizesFor(blank)[0]?.[0] ?? "";
  const price = basePriceCents(blank, sizeM, used.map((p) => ({ placementId: p.id, method: sideFor(design, p).method })), used.some((p) => sideFor(design, p).puff));
  const toggleAck = (pid: string, id: string) => {
    const key = `${pid}:${id}`;
    change({ ...design, ack: design.ack.includes(key) ? design.ack.filter((a) => a !== key) : [...design.ack, key] });
  };
  const selectFromIssue = (pid: string, elId: string) => { switchPlacement(pid); setSelected([elId]); setSub("selected"); };

  const views = viewsFor(blank);
  const colorName = colorsFor(blank).find((c) => c[1] === garmentHex)?.[0] ?? garmentHex;
  const pill = "rounded-full px-3 py-1 text-xs";
  const SUBS: { id: Sub; label: string }[] = [
    { id: "add", label: "\u2795 Add" },
    { id: "selected", label: `\u270f\ufe0f Selected${selEls.length ? ` (${selEls.length})` : ""}` },
    { id: "layers", label: "\ud83d\uddc2\ufe0f Layers & Arrange" },
    { id: "checks", label: `\u2705 Print checks${totals.blocker ? ` (${totals.blocker} \u26d4)` : ""}` },
    { id: "preview", label: "\ud83c\udfa8 Colours & Preview" },
    { id: "drafts", label: "\ud83d\udcbe Drafts" },
  ];

  return (
    <div className="space-y-3 outline-none" tabIndex={-1} onKeyDown={onKey}>
      {/* Design header */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[14rem] flex-1">
          <span className="mb-1 block text-[0.68rem] font-semibold uppercase tracking-wide text-white/60">Design name</span>
          <input className={studioInput} value={design.name} maxLength={80} onChange={(e) => change({ ...design, name: e.target.value })} />
        </label>
        <label>
          <span className="mb-1 block text-[0.68rem] font-semibold uppercase tracking-wide text-white/60">Garment</span>
          <select className={studioInput} value={design.blankId} onChange={(e) => changeBlank(e.target.value)}>
            {BLANKS.map((b) => <option key={b.id} value={b.id}>{b.brand} {b.model} - {b.title}</option>)}
          </select>
        </label>
        <span className="pb-1.5 text-xs text-white/55">{saved ? "\u2714 Saved on this device" : "Saving..."}</span>
      </div>
      {blankId !== design.blankId ? (
        <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 p-2 text-xs text-white/80">
          The Garments tab has a different blank selected. <button type="button" className="underline" onClick={newFromGarments}>Start a new design on it</button> or <button type="button" className="underline" onClick={() => changeBlank(blankId)}>move this design to it</button>.
        </p>
      ) : null}
      {msg ? <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-danger)]/50 bg-[var(--admin-danger)]/10 p-2 text-xs text-white/85">{msg}</p> : null}

      {/* Dock: toolbar + canvas follow the scroll */}
      <div className={follow ? "sticky z-30 -mx-2 space-y-2 rounded-lg border border-white/10 bg-[var(--admin-canvas)]/95 px-2 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur" : "space-y-2"} style={follow ? { top: dockTop + 8 } : undefined}>
        <div className="flex flex-wrap items-center gap-1.5">
          {views.map((v) => (
            <span key={v} className="flex flex-wrap items-center gap-1">
              <span className="text-[0.65rem] uppercase tracking-wide text-white/40">{VIEW_LABEL[v]}</span>
              {blank.placements.filter((p) => p.view === v).map((p) => {
                const n = (design.sides[p.id]?.elements ?? []).filter((e) => !e.hidden).length;
                const bad = results.find((r) => r.placement.id === p.id)?.issues.some((i) => i.level === "blocker");
                return (
                  <button key={p.id} type="button" onClick={() => switchPlacement(p.id)} title={`${p.label} - ${p.widthIn}" x ${p.heightIn}"`}
                    className={`${pill} ${p.id === placement.id ? "bg-[var(--admin-accent)] font-semibold text-black" : "bg-white/10 text-white/75 hover:bg-white/20"}`}>
                    {p.label.replace(" (embroidery)", " \u2022 emb")}{n ? ` \u00b7 ${n}` : ""}{bad ? " \u26d4" : ""}
                  </button>
                );
              })}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setZoom(zoom === "frame" ? "garment" : "frame")} className={`${pill} bg-white/10 text-white/80 hover:bg-white/20`} title="Zoom to the print area, or see the whole garment">
            {zoom === "frame" ? "\ud83d\udd0d Print area" : "\ud83d\udc55 Whole garment"}
          </button>
          <button type="button" onClick={() => saveFollow(!follow)} aria-pressed={follow} className={follow ? `${pill} bg-[var(--admin-accent)]/25 font-semibold text-[var(--admin-accent)]` : `${pill} bg-white/10 text-white/75 hover:bg-white/20`} title="Keep the canvas on screen while you scroll through the settings below">
            {"\ud83d\udccc"} {follow ? "Following scroll" : "Follow scroll"}
          </button>
          {follow ? (
            <select aria-label="Canvas size while following" value={dockSize} onChange={(e) => saveDock(e.target.value as DockSize)} className="rounded-full border border-white/15 bg-black/40 px-2 py-1 text-xs text-white/80">
              <option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option>
            </select>
          ) : null}
          <button type="button" onClick={undo} disabled={!counts.undo} className={`${pill} bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-30`} title="Undo (Ctrl+Z)">{"\u21b6"} Undo</button>
          <button type="button" onClick={redo} disabled={!counts.redo} className={`${pill} bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-30`} title="Redo (Ctrl+Shift+Z)">{"\u21b7"} Redo</button>
          <button type="button" onClick={() => setSnap(!snap)} aria-pressed={snap} className={`${pill} ${snap ? "bg-pink-500/20 text-pink-300" : "bg-white/10 text-white/60"}`} title="Smart guides snap to the frame centre/edges and other elements (hold Alt while dragging to skip)">{"\ud83e\uddf2"} Snap</button>
          <button type="button" onClick={() => setGuides(!guides)} aria-pressed={guides} className={`${pill} ${guides ? "bg-white/15 text-white/85" : "bg-white/10 text-white/50"}`} title="Inch rulers + centre lines">{"\ud83d\udccf"} Rulers</button>
          {selEls.length ? (
            <>
              <button type="button" onClick={duplicateSel} className={`${pill} bg-white/10 text-white/80 hover:bg-white/20`} title="Duplicate (Ctrl+D)">{"\u2398"} Duplicate</button>
              <button type="button" onClick={removeSel} className={`${pill} bg-[var(--admin-danger)]/20 text-red-200 hover:bg-[var(--admin-danger)]/30`} title="Delete (Del)">{"\ud83d\uddd1"} Delete</button>
            </>
          ) : null}
          <span className="ml-auto flex items-center gap-2 text-xs text-white/60">
            <span className="inline-block h-3.5 w-3.5 rounded-full border border-white/30" style={{ background: garmentHex }} />{colorName}{previewHex ? " (preview)" : ""}
            {price ? <span title="Printful wholesale estimate, size M, before shipping/tax">{"\u00b7"} Printful est. {formatCents(price.cents)}</span> : null}
          </span>
        </div>
        <div className="grid gap-2 lg:grid-cols-[1fr_15rem]">
          <div onPointerDownCapture={(e) => (e.currentTarget.closest("[tabindex]") as HTMLElement | null)?.focus({ preventScroll: true })}>
            <MerchCanvas blank={blank} design={design} placement={placement} zoom={zoom} garmentHex={garmentHex} selected={selected} assetUrls={assetUrls}
              snap={snap} showGuides={guides} maxH={canvasMaxH} onSelect={setSelected} onElements={(next) => setEls(next)} onPlacement={switchPlacement} flagged={flagged} />
          </div>
          <div className="space-y-2 text-xs">
            <Segmented label={`Method - ${placement.label}`} value={side.method} options={placement.methods.map((m) => ({ value: m, label: METHOD_LABEL[m].split(" (")[0], title: METHOD_BLURB[m] }))} onChange={setMethod} />
            {side.method === "embroidery" && blank.puffAvailable ? <Toggle label="3D puff (+$1.50)" checked={!!side.puff} onChange={(v) => change(setSide(design, placement.id, { ...side, puff: v }))} /> : null}
            {side.method === "embroidery" && els.length ? (
              <button type="button" className="w-full rounded-[var(--admin-radius-sm)] bg-white/10 px-2 py-1 text-white/85 hover:bg-white/20" onClick={() => change(setSide(design, placement.id, snapSideToThreads(side)))}
                title="Recolour every element on this placement to the nearest of Printful's 15 thread colours">{"\ud83e\uddf5"} Snap colours to threads</button>
            ) : null}
            <button type="button" onClick={() => setSub("checks")} className="block w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2 text-left hover:bg-white/5">
              <b className="text-white">This placement</b><br />
              {curSum.blocker ? <span className="text-[var(--admin-danger)]">{curSum.blocker} blocker{curSum.blocker > 1 ? "s" : ""} </span> : null}
              {curSum.warning ? <span className="text-[var(--admin-gold)]">{curSum.warning} warning{curSum.warning > 1 ? "s" : ""} </span> : null}
              {curSum.review ? <span className="text-[var(--admin-orange)]">{curSum.review} review </span> : null}
              {!curSum.blocker && !curSum.warning && !curSum.review ? <span className="text-[var(--admin-accent)]">{els.length ? "Print-ready \u2714" : "Empty"}</span> : null}
            </button>
            {placement.note ? <p className="text-white/50">{placement.note}</p> : null}
            <p className="text-white/40">Arrows nudge 1/16&quot; (Shift 1/4&quot;). Shift-click multi-select. Alt-drag = no snap.</p>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div role="tablist" aria-label="Design tools" className="flex flex-wrap gap-1 border-b border-[var(--admin-border)]">
        {SUBS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={sub === t.id} onClick={() => setSub(t.id)}
            className={`-mb-px px-3 py-1.5 text-xs font-semibold ${sub === t.id ? "border-b-2 border-[var(--admin-accent)] text-white" : "text-white/55 hover:text-white/85"}`}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" className="pb-24">
        {sub === "add" ? (
          <AddPanel placement={placement} method={side.method} disabled={els.length >= MAX_ELEMENTS_PER_SIDE} busy={busy}
            onText={addText}
            onShape={(s) => addEl(makeShape({ w: placement.widthIn, h: placement.heightIn }, s, defaultInk()))}
            onIcon={(path, label) => addEl(makeIcon({ w: placement.widthIn, h: placement.heightIn }, path, label, defaultInk()))}
            onFile={(f) => { void onFile(f); }} />
        ) : null}

        {sub === "selected" ? (
          one ? (
            <ElementPanel key={one.id} el={one} placement={placement} method={side.method} onChange={(p) => patchEl(one.id, p)} onRemeasure={(p) => remeasure(one.id, p)} />
          ) : selEls.length > 1 ? (
            <p className="text-sm text-white/70">{selEls.length} elements selected - use Layers &amp; Arrange to align or distribute them, or arrows to nudge together.</p>
          ) : (
            <p className="text-sm text-white/60">Click something on the canvas (or in Layers) to edit it.</p>
          )
        ) : null}

        {sub === "layers" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <section>
              <h3 className="mb-1 text-sm font-semibold text-white">Layers - {placement.label} (top first)</h3>
              {els.length === 0 ? <p className="text-xs text-white/55">Nothing on this placement yet.</p> : null}
              <ul className="space-y-1">
                {els.slice().reverse().map((e) => (
                  <li key={e.id} className={`flex items-center gap-1 rounded-[var(--admin-radius-sm)] border px-2 py-1 text-xs ${selected.includes(e.id) ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]" : "border-[var(--admin-border)]"}`}>
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-white/85" onClick={(ev) => setSelected(ev.shiftKey ? (selected.includes(e.id) ? selected.filter((x) => x !== e.id) : [...selected, e.id]) : [e.id])}>
                      {e.kind === "text" ? "T" : e.kind === "image" ? "\ud83d\uddbc" : "\u25c6"} {e.name || e.kind} <span className="text-white/40">{r2(e.w)}&quot;x{r2(e.h)}&quot;</span>
                    </button>
                    <button type="button" title="Bring forward" className="px-1 text-white/60 hover:text-white" onClick={() => reorder(e.id, "up")}>{"\u25b2"}</button>
                    <button type="button" title="Send backward" className="px-1 text-white/60 hover:text-white" onClick={() => reorder(e.id, "down")}>{"\u25bc"}</button>
                    <button type="button" title={e.hidden ? "Show" : "Hide"} className="px-1 text-white/60 hover:text-white" onClick={() => patchEl(e.id, { hidden: !e.hidden })}>{e.hidden ? "\ud83d\udeab" : "\ud83d\udc41"}</button>
                    <button type="button" title={e.locked ? "Unlock" : "Lock"} className="px-1 text-white/60 hover:text-white" onClick={() => patchEl(e.id, { locked: !e.locked })}>{e.locked ? "\ud83d\udd12" : "\ud83d\udd13"}</button>
                  </li>
                ))}
              </ul>
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-white">Arrange</h3>
              <p className="text-xs text-white/55">One element aligns to the print area; several align to each other. Distribute needs 3+.</p>
              <div className="flex flex-wrap gap-1">
                {([["left", "\u21e4 Left"], ["center", "\u2194 Center"], ["right", "Right \u21e5"], ["top", "\u2912 Top"], ["middle", "\u2195 Middle"], ["bottom", "Bottom \u2913"], ["dh", "\u2194 Distribute"], ["dv", "\u2195 Distribute"]] as const).map(([m, lab]) => (
                  <button key={m} type="button" disabled={!selEls.length || ((m === "dh" || m === "dv") && selEls.length < 3)} onClick={() => arrange(m)}
                    className="rounded-[var(--admin-radius-sm)] bg-white/10 px-2 py-1 text-xs text-white/85 hover:bg-white/20 disabled:opacity-30">{lab}</button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                <button type="button" disabled={!one} onClick={() => one && reorder(one.id, "top")} className="rounded-[var(--admin-radius-sm)] bg-white/10 px-2 py-1 text-xs text-white/85 hover:bg-white/20 disabled:opacity-30">Bring to front</button>
                <button type="button" disabled={!one} onClick={() => one && reorder(one.id, "bottom")} className="rounded-[var(--admin-radius-sm)] bg-white/10 px-2 py-1 text-xs text-white/85 hover:bg-white/20 disabled:opacity-30">Send to back</button>
              </div>
            </section>
          </div>
        ) : null}

        {sub === "checks" ? (
          <div className="space-y-3">
            <div className={`rounded-[var(--admin-radius)] border p-3 text-sm ${totals.blocker ? "border-[var(--admin-danger)]/60 bg-[var(--admin-danger)]/10" : totals.review ? "border-[var(--admin-orange)]/60 bg-[var(--admin-orange)]/10" : "border-[var(--admin-accent)]/50 bg-[var(--admin-accent-soft)]"}`}>
              <b className="text-white">{!used.length ? "Nothing designed yet" : totals.blocker ? `Not printable yet - ${totals.blocker} blocker(s)` : totals.review ? `${totals.review} compliance item(s) to review` : "Print-ready by every rule the studio knows"}</b>
              <p className="text-white/70">{used.length} placement(s) in use on a {colorName} {blank.brand} {blank.model}. {totals.warning} warning(s), {totals.tip} tip(s).
                {price ? ` Printful estimate (size ${sizeM}): ${formatCents(price.cents)} before shipping.` : ""}</p>
              <p className="mt-1 text-[0.7rem] text-white/50">Checks use the garment colour shown on the canvas{previewHex ? " (preview colour)" : ""}. A physical sample is still the final proof (Fulfillment tab, step 4).</p>
            </div>
            {results.map((r) => (
              <section key={r.placement.id}>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
                  {r.placement.label} <span className="text-xs font-normal text-white/50">{METHOD_LABEL[r.method]}</span>
                  {r.placement.id !== placement.id ? <button type="button" className="text-xs font-normal text-[var(--admin-accent)] underline" onClick={() => switchPlacement(r.placement.id)}>open</button> : null}
                </h3>
                <IssueList issues={r.issues} onSelect={(id) => selectFromIssue(r.placement.id, id)} acknowledged={ackFor(r.placement.id)} onAcknowledge={(id) => toggleAck(r.placement.id, id)} />
              </section>
            ))}
          </div>
        ) : null}

        {sub === "preview" ? (
          <div className="space-y-3">
            <p className="text-sm text-white/70">Click a colour to preview the whole design on it (checks re-run live). Badges count contrast problems on that colour. <b className="text-white">Use this colour</b> makes it the design&apos;s colour.</p>
            <div className="flex flex-wrap gap-1.5">
              {colorsFor(blank).map(([name, hex]) => {
                const n = checkSides(design, hex).reduce((a, r) => a + r.issues.filter((i) => i.id.startsWith("contrast-") && i.level === "warning").length, 0);
                return (
                  <button key={hex + name} type="button" title={`${name}${n ? ` - ${n} low-contrast element(s)` : ""}`} onClick={() => setPreviewHex(hex === design.colorHex ? null : hex)}
                    className={`relative h-8 w-8 rounded-full border ${hex === garmentHex ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]/60" : "border-white/25"}`} style={{ background: hex }}>
                    {n ? <span className="absolute -right-1 -top-1 rounded-full bg-[var(--admin-gold)] px-1 text-[0.6rem] font-bold text-black">{n}</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {previewHex ? <button type="button" className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-3 py-1 text-xs font-bold text-black" onClick={() => setDesignColor(previewHex)}>Use {colorName}</button> : null}
              {previewHex ? <button type="button" className="rounded-[var(--admin-radius-sm)] bg-white/10 px-3 py-1 text-xs text-white/80" onClick={() => setPreviewHex(null)}>Back to design colour</button> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {views.map((v) => {
                const p = blank.placements.find((x) => x.view === v && (design.sides[x.id]?.elements.length ?? 0) > 0) ?? blank.placements.find((x) => x.view === v)!;
                return (
                  <figure key={v} className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2">
                    <MerchCanvas blank={blank} design={design} placement={p} zoom="garment" garmentHex={garmentHex} selected={[]} assetUrls={assetUrls} interactive={false} />
                    <figcaption className="mt-1 text-center text-xs text-white/60">{VIEW_LABEL[v]}</figcaption>
                  </figure>
                );
              })}
            </div>
            <p className="text-[0.7rem] text-white/45">Silhouettes are illustrative (true proportions, size L flat). Exact print files, a printable proof and Printful photo mockups are on the Proof & Export tab.</p>
          </div>
        ) : null}

        {sub === "drafts" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-3 py-1 text-xs font-bold text-black" onClick={newFromGarments}>+ New design ({getBlank(blankId)?.model})</button>
              <button type="button" className="rounded-[var(--admin-radius-sm)] bg-white/10 px-3 py-1 text-xs text-white/85" onClick={() => { const c = { ...design, id: newId("ds"), name: `${design.name} (copy)` }; openDesign(c); setSaved(false); }}>Duplicate this design</button>
            </div>
            <p className="text-xs text-white/55">Drafts and uploaded art are saved in THIS browser only until Slice 4 adds shared, server-side designs. Don&apos;t clear site data for this admin site.</p>
            <ul className="divide-y divide-[var(--admin-border)] rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)]">
              {list.length === 0 ? <li className="p-2 text-xs text-white/55">No saved drafts yet - they save automatically as you design.</li> : null}
              {list.map((d) => {
                const b = getBlank(d.blankId);
                const n = Object.values(d.sides).reduce((a, s: Side) => a + s.elements.length, 0);
                return (
                  <li key={d.id} className={`flex flex-wrap items-center gap-2 p-2 text-xs ${d.id === design.id ? "bg-[var(--admin-accent-soft)]" : ""}`}>
                    <span className="inline-block h-4 w-4 rounded-full border border-white/30" style={{ background: d.colorHex }} />
                    <b className="text-white">{d.name}</b>
                    <span className="text-white/55">{b?.brand} {b?.model} - {n} element(s) - {d.updatedAt.slice(0, 16).replace("T", " ")}</span>
                    <span className="ml-auto flex gap-1">
                      {d.id !== design.id ? <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-white/85 hover:bg-white/20" onClick={() => openDesign(d)}>Open</button> : <span className="px-2 text-[var(--admin-accent)]">Open now</span>}
                      <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-white/70 hover:bg-[var(--admin-danger)]/30" onClick={() => {
                        if (!window.confirm(`Delete "${d.name}"? This can't be undone.`)) return;
                        const next = list.filter((x) => x.id !== d.id);
                        saveDesigns(next);
                        setList(next);
                        if (d.id === design.id) { if (next[0]) openDesign(next[0]); else newFromGarments(); }
                      }}>Delete</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
