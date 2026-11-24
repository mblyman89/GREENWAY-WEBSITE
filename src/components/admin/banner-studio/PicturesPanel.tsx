"use client";

/**
 * D271 — 🖼️ Pictures tab (Print Studio): pictures placed ON the canvas, in
 * addition to the full-canvas background. Each one is a normal element
 * (kind "image"), so drag / resize / rotate / snap / layers / lock / copy-paste
 * already work; this panel adds, styles and fixes them:
 *   • Add from the Media Library (logos first), upload / drag-drop, or have
 *     FLUX make one (optionally a cut-out, optionally from reference pictures).
 *   • Front / back, fill canvas, centre, flip, fit, corners, border, shadow,
 *     brightness / contrast / saturation / grey / blur, opacity.
 *   • AI on the selected picture: remove background (exact key-out, FLUX for
 *     busy backgrounds), erase / replace what you paint (FLUX Fill), change
 *     with words (FLUX), sharpen (FLUX Deblur), enlarge 2–4× for print.
 *   • Live print sharpness per picture (DPI at its printed size).
 *   • Recreate the whole canvas as one picture (FLUX.2, canvas as reference).
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { nextId, printRatio, maxElements, type BannerDesign } from "@/lib/cms/banner-design-core";
import { defaultImageElement, type DesignElement } from "@/lib/cms/banner-elements-core";
import { arrangeOrder, type OrderMove } from "@/lib/cms/banner-arrange-core";
import { layerDpi, layerInches, normalizePlacedImg, type ImgFit, type PlacedImg } from "@/lib/printing/print-layers-core";
import { recommendedDpi } from "@/lib/printing/print-sizes-core";
import { libraryArt } from "@/lib/merch-studio/art-prep-core";
import { maskCoverageIssue } from "@/lib/cms/newsletter-picture-core";
import { checkUpload } from "@/lib/media/upload-policy-core";
import { putSigned, tusSigned } from "@/lib/media/direct-upload-client";
import { startDirectUploadAction, finishDirectUploadAction } from "@/app/admin/media/direct-upload-actions";
import {
  printEnlargeAction,
  printFluxPollAction,
  printLayerKeyOutAction,
  printLayerRemoveBgAction,
  printMakeLayerAction,
  printPictureToolAction,
  printRecreateAction,
  printSharpenAction,
  type LayerOut,
} from "@/app/admin/marketing/print-studio/actions";
import { MaskBrush } from "@/components/admin/newsletter/CanvasPictureTools";
import { DesignedBanner } from "@/components/site/DesignedBanner";
import { stillDesign } from "@/lib/brand/brand-sizes-core";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { ColorField, NumberSlider, Segmented, Toggle } from "./controls";
import type { StudioSelection } from "./StudioCanvas";

const box = "space-y-2 rounded-md border border-white/10 p-2";
const title = "text-[0.7rem] font-semibold uppercase tracking-wide text-white/60";
const pill = "rounded-full bg-white/10 px-2.5 py-1 text-[0.7rem] text-white/85 hover:bg-white/20 disabled:opacity-40";
const gold = "rounded-full bg-[#ffd700] px-3 py-1 text-xs font-bold text-black disabled:opacity-40";
const ta = "w-full rounded border border-white/15 bg-black/40 p-2 text-xs text-white";
const POLL_MS = 4000;
const MAX_POLLS = 90;
type AiTool = "cutout" | "erase" | "replace" | "edit" | "sharpen" | "enlarge";
const AI_TOOLS: { key: AiTool; label: string; help: string }[] = [
  { key: "cutout", label: "✂ Remove background", help: "Logos on a flat colour are cut out exactly on our server (free). Busy photos: FLUX isolates the subject, then we cut it out." },
  { key: "erase", label: "🧽 Erase what I paint", help: "Paint over it; FLUX fills the spot to match." },
  { key: "replace", label: "🎨 Replace what I paint", help: "Paint an area and say what goes there (FLUX Fill)." },
  { key: "edit", label: "✏️ Change with words", help: "Say what to change (FLUX keeps the rest)." },
  { key: "sharpen", label: "🔎 Sharpen (FLUX)", help: "Redraws soft or pixelated pictures crisper (FLUX Deblur)." },
  { key: "enlarge", label: "⤢ Enlarge for print", help: "Doubles the pixels (up to 4× when this print needs it). Free, on our server." },
];

/** Natural size of a picture (browser). */
function measure(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i.naturalWidth && i.naturalHeight ? { w: i.naturalWidth, h: i.naturalHeight } : null);
    i.onerror = () => res(null);
    i.src = url;
  });
}

export function PicturesPanel({
  design,
  imageSrc,
  printViewFt,
  selection,
  mediaChoices = [],
  onSelect,
  onChange,
  onRequestDelete,
  onBackground,
}: {
  design: BannerDesign;
  imageSrc: string;
  printViewFt: number;
  selection: StudioSelection;
  mediaChoices?: MediaChoice[];
  onSelect: (s: StudioSelection) => void;
  onChange: (d: BannerDesign) => void;
  onRequestDelete: (s: NonNullable<StudioSelection>) => void;
  onBackground?: (url: string) => void;
}) {
  const elements = design.elements ?? [];
  const pics = elements.filter((e) => e.kind === "image");
  const el = selection?.target === "element" ? pics.find((e) => e.id === selection.id) : undefined;
  const full = elements.length >= maxElements(design);
  const print = design.frame.print;
  const W = print ? print.w + 2 * print.bleed : 0;
  const H = print ? print.h + 2 * print.bleed : 0;
  const ratio = print ? printRatio(print) : 2;
  const need = print ? recommendedDpi({ viewFt: printViewFt, w: print.w, h: print.h }) : 150;
  const art = useMemo(() => libraryArt(mediaChoices.filter((m) => !m.mimeType || m.mimeType.startsWith("image/")), []), [mediaChoices]);

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [libOpen, setLibOpen] = useState(false);
  const [q, setQ] = useState("");
  const [ask, setAsk] = useState("");
  const [cutout, setCutout] = useState(true);
  const [useRef1, setUseRef1] = useState(false);
  const [shape, setShape] = useState<"square" | "wide" | "tall" | "canvas">("square");
  const [tool, setTool] = useState<AiTool>("cutout");
  const [toolAsk, setToolAsk] = useState("");
  const [mask, setMask] = useState<{ url: string | null; coverage: number }>({ url: null, coverage: 0 });
  const [result, setResult] = useState<{ url: string; from: "layer" | "make" | "recreate" } | null>(null);
  const [recAsk, setRecAsk] = useState("");
  const [keepText, setKeepText] = useState(true);
  const [drag, setDrag] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const patch = (id: string, p: Partial<DesignElement>) => onChange({ ...design, elements: elements.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const setImg = (p: Partial<PlacedImg>) => {
    if (!el?.img) return;
    const next = normalizePlacedImg({ ...el.img, ...p });
    if (next) patch(el.id, { img: next });
  };

  async function imgFor(url: string, alt: string): Promise<PlacedImg | null> {
    const m = await measure(url);
    return normalizePlacedImg({ src: url, alt, ...(m ? { ratio: m.w / m.h, pxW: m.w, pxH: m.h } : {}) });
  }

  async function addPicture(url: string, alt: string) {
    if (full) return setMsg({ ok: false, text: "The canvas is full - delete a layer first." });
    const img = await imgFor(url, alt);
    if (!img) return setMsg({ ok: false, text: "That picture can't go on the canvas (it must be in the Media Library)." });
    // Start ~30% wide, centred, keeping its own shape.
    const w = 30;
    const hPct = img.ratio && W && H ? ((W * w) / 100 / img.ratio / H) * 100 : w;
    const ne = defaultImageElement(img, { id: nextId(design, "picture"), x: Math.round((50 - w / 2) * 10) / 10, y: Math.max(0, Math.round((50 - hPct / 2) * 10) / 10) });
    onChange({ ...design, elements: [...elements, ne], ...(design.order ? { order: [...design.order, ne.id] } : {}) });
    onSelect({ target: "element", id: ne.id });
    setMsg({ ok: true, text: "Added. Drag it on the canvas; the corner handle resizes, the round handle rotates." });
  }

  async function replacePicture(url: string) {
    if (!el) return;
    const img = await imgFor(url, el.img?.alt ?? "");
    if (!img) return;
    const keep = el.img ? { fit: el.img.fit, flipX: el.img.flipX, flipY: el.img.flipY, bright: el.img.bright, contrast: el.img.contrast, sat: el.img.sat, gray: el.img.gray, blur: el.img.blur } : {};
    const next = normalizePlacedImg({ ...keep, ...img });
    if (next) patch(el.id, { img: next });
  }

  const upload = (file: File) =>
    start(async () => {
      setMsg(null);
      const pre = checkUpload({ filename: file.name, mime: file.type, size: file.size });
      if (!pre.ok || pre.kind !== "image") return setMsg({ ok: false, text: pre.ok ? "Pick a picture file (PNG, JPG, WebP, SVG)." : pre.error });
      try {
        setBusy("Uploading…");
        const s = await startDirectUploadAction({ filename: file.name, mime: pre.mime, size: file.size, usageType: "banner" });
        if (!s.ok) throw new Error(s.error);
        if (s.resumable) await tusSigned({ endpoint: s.endpoint, anonKey: s.anonKey, key: s.key, token: s.token, file, contentType: pre.mime });
        else await putSigned(s.key, s.token, file, pre.mime);
        setBusy("Checking the file…");
        const alt = file.name.replace(/\.[a-z0-9]+$/i, "");
        const fin = await finishDirectUploadAction({ key: s.key, filename: file.name, size: file.size, title: alt, usageType: "banner", status: "published" });
        if (!fin.ok) throw new Error(fin.error);
        await addPicture(fin.url, alt);
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed." });
      } finally {
        setBusy(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    });

  /** Run an action; FLUX tasks are polled, then (for cut-outs) keyed out. */
  async function settle(out: LayerOut, from: "layer" | "make" | "recreate") {
    if (!out.ok) return setMsg({ ok: false, text: out.error });
    if (out.kind === "done") {
      setResult({ url: out.url, from });
      return setMsg({ ok: true, text: `${out.note} Saved to Media.` });
    }
    for (let n = 0; n < MAX_POLLS && alive.current; n++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const r = await printFluxPollAction(out.pollingUrl, out.prompt);
      if (r.state === "pending") {
        setBusy(`FLUX is working${r.progress ? ` (${Math.round(r.progress * 100)}%)` : ""}…`);
        continue;
      }
      if (r.state === "failed") return setMsg({ ok: false, text: `FLUX: ${r.error}` });
      if (out.keyOut) {
        setBusy("Cutting out the background…");
        return settle(await printLayerKeyOutAction(r.url), from);
      }
      setResult({ url: r.url, from });
      return setMsg({ ok: true, text: "Done and saved to Media. Check it, then apply it." });
    }
    setMsg({ ok: false, text: "FLUX took too long. The picture may still appear in Media later." });
  }

  const run = (label: string, fn: () => Promise<void>) =>
    start(async () => {
      setMsg(null);
      setResult(null);
      setBusy(label);
      try {
        await fn();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
      } finally {
        if (alive.current) setBusy(null);
      }
    });

  const shapeRatio = shape === "square" ? 1 : shape === "wide" ? 16 / 9 : shape === "tall" ? 3 / 4 : ratio;
  const make = () =>
    run("Sending to FLUX…", async () => {
      if (!ask.trim()) return setMsg({ ok: false, text: "Describe the picture first." });
      const refs = useRef1 && el?.img ? [el.img.src] : [];
      await settle(await printMakeLayerAction({ ask, cutout, ratio: shapeRatio, refs }), "make");
    });

  // Sharpness of the selected picture at its printed size.
  const inches = el && print ? layerInches(W, H, el.w, el.h, el.img?.ratio) : null;
  const dpi = el?.img?.pxW && el.img.pxH && inches ? layerDpi(el.img.pxW, el.img.pxH, inches.w, inches.h) : 0;
  const tone = !dpi ? null : dpi >= need ? "text-emerald-300" : dpi >= need * 0.6 ? "text-[var(--admin-gold)]" : "text-red-300";

  const runTool = () =>
    run("Working…", async () => {
      if (!el?.img) return;
      const src = el.img.src;
      if (tool === "cutout") return settle(await printLayerRemoveBgAction(src), "layer");
      if (tool === "sharpen") return settle(await printSharpenAction(src), "layer");
      if (tool === "enlarge") {
        const t = inches ? { targetW: Math.round(inches.w * need), targetH: Math.round(inches.h * need) } : {};
        return settle(await printEnlargeAction({ url: src, ...t }), "layer");
      }
      if ((tool === "erase" || tool === "replace") && maskCoverageIssue(mask.coverage)) return setMsg({ ok: false, text: maskCoverageIssue(mask.coverage)! });
      if ((tool === "replace" || tool === "edit") && !toolAsk.trim()) return setMsg({ ok: false, text: "Say what you want first." });
      const out = await printPictureToolAction({ tool, engine: tool === "edit" ? "flux" : null, sourceUrl: src, ask: toolAsk, maskDataUrl: mask.url });
      if (!out.ok) return setMsg({ ok: false, text: out.error });
      if (out.kind === "flux") return settle({ ok: true, kind: "flux", pollingUrl: out.pollingUrl, prompt: out.prompt }, "layer");
      const url = out.results[0]?.url;
      if (url) {
        setResult({ url, from: "layer" });
        setMsg({ ok: true, text: "Done and saved to Media." });
      }
    });

  const recreate = () =>
    run("Capturing the canvas…", async () => {
      setCapturing(true);
      let dataUrl = "";
      try {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await document.fonts.ready;
        await new Promise((r) => setTimeout(r, 900)); // pictures decode
        const node = holder.current?.querySelector<HTMLElement>("[data-rec-root] > *");
        if (!node) return setMsg({ ok: false, text: "Couldn't capture the canvas. Try again." });
        const { domToJpeg } = await import("modern-screenshot");
        const wpx = 1280;
        dataUrl = await domToJpeg(node, { width: wpx, height: Math.round(wpx / ratio), quality: 0.9, backgroundColor: "#ffffff", timeout: 45_000 });
      } finally {
        setCapturing(false);
      }
      setBusy("Sending to FLUX…");
      await settle(await printRecreateAction({ dataUrl, ask: recAsk, keepText, ratio }), "recreate");
    });

  function order(move: OrderMove) {
    if (el) onChange(arrangeOrder(design, [{ target: "element", id: el.id }], move));
  }
  function fillCanvas() {
    if (el) patch(el.id, { x: 0, y: 0, w: 100, h: 100, rotate: 0, img: { ...el.img!, fit: "cover" } });
  }
  function centre() {
    if (!el) return;
    const hPct = el.h ?? (el.img?.ratio && W && H ? ((W * el.w) / 100 / el.img.ratio / H) * 100 : el.w);
    patch(el.id, { x: Math.round((50 - el.w / 2) * 10) / 10, y: Math.max(0, Math.round((50 - hPct / 2) * 10) / 10) });
  }
  function duplicate() {
    if (!el || full) return;
    const ne = { ...el, id: nextId(design, "picture"), x: Math.min(95, el.x + 2), y: Math.min(95, el.y + 2), locked: undefined };
    onChange({ ...design, elements: [...elements, ne], ...(design.order ? { order: [...design.order, ne.id] } : {}) });
    onSelect({ target: "element", id: ne.id });
  }
  function applyRecreated(hideAll: boolean) {
    if (!result || !onBackground) return;
    onBackground(result.url);
    if (hideAll) onChange({ ...design, elements: elements.map((e) => ({ ...e, hidden: true })), ...(keepText ? { boxes: design.boxes.map((b) => ({ ...b, hidden: true })) } : {}) });
    setResult(null);
    setMsg({ ok: true, text: hideAll ? "Now the background. The old layers are hidden (Layers tab brings them back)." : "Now the background." });
  }

  const shown = art.filter((a) => !q || a.title.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  const working = pending || !!busy;

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white/70">Pictures on the canvas ({pics.length})</span>
        <span className="text-[0.65rem] text-white/45">The background picture is separate (Picture tab).</span>
      </div>

      <div
        className={`${box} ${drag ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
      >
        <p className={title}>Add a picture</p>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={pill} disabled={full || working} onClick={() => setLibOpen((o) => !o)}>
            📚 From Media Library
          </button>
          <button type="button" className={pill} disabled={full || working} onClick={() => fileRef.current?.click()}>
            ⬆ Upload
          </button>
          {imageSrc ? (
            <button type="button" className={pill} disabled={full || working} onClick={() => addPicture(imageSrc, "Background copy")} title="Put a movable copy of the background picture on top">
              ⧉ Copy of background
            </button>
          ) : null}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
        <p className="text-[0.65rem] text-white/45">…or drop a picture file here.</p>
        {libOpen ? (
          <div className="space-y-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the library…" className={ta} />
            <div className="grid max-h-56 grid-cols-4 gap-1 overflow-y-auto">
              {shown.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  title={a.title}
                  disabled={working}
                  onClick={() => addPicture(a.url, a.title)}
                  className="relative aspect-square overflow-hidden rounded border border-white/10 bg-[repeating-conic-gradient(#555_0_25%,#333_0_50%)] bg-[length:12px_12px] hover:border-[var(--admin-accent)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.title} loading="lazy" className="h-full w-full object-contain" />
                  {a.logo ? <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[0.55rem]">logo</span> : null}
                </button>
              ))}
              {!shown.length ? <p className="col-span-4 text-white/50">No pictures found.</p> : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className={box}>
        <p className={title}>✨ Make a picture with FLUX</p>
        <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={2} placeholder="A glowing green cannabis leaf, neon style…" className={ta} />
        <Segmented
          label="Shape"
          value={shape}
          onChange={setShape}
          options={[
            { value: "square", label: "Square" },
            { value: "wide", label: "Wide" },
            { value: "tall", label: "Tall" },
            { value: "canvas", label: "Canvas", title: "Same shape as this print" },
          ]}
        />
        <Toggle label="Cut-out (no background) — ready to place" checked={cutout} onChange={setCutout} />
        {el?.img ? <Toggle label="Use the selected picture as the reference" checked={useRef1} onChange={setUseRef1} /> : null}
        <button type="button" className={gold} disabled={working || !ask.trim()} onClick={make}>
          {busy && !result ? busy : "Make it"}
        </button>
      </div>

      {el?.img ? (
        <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={el.img.src} alt="" className="h-10 w-10 rounded bg-[repeating-conic-gradient(#555_0_25%,#333_0_50%)] bg-[length:8px_8px] object-contain" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-white/85">
                {el.img.alt || "Picture"}
                {el.locked ? " 🔒" : ""}
              </p>
              {inches ? (
                <p className={tone ?? "text-white/50"}>
                  Prints {inches.w}″ × {inches.h}″{dpi ? ` · ${dpi} DPI (needs ${need})` : ""}
                  {dpi && dpi < need ? " — Enlarge for print" : ""}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            <button type="button" className={pill} onClick={() => order("front")} title="Bring to front">⤒ Front</button>
            <button type="button" className={pill} onClick={() => order("forward")} title="Forward one layer">↑ Forward</button>
            <button type="button" className={pill} onClick={() => order("backward")} title="Back one layer">↓ Back</button>
            <button type="button" className={pill} onClick={() => order("back")} title="Send to back (still above the background picture)">⤓ To back</button>
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={pill} onClick={centre}>⊕ Centre</button>
            <button type="button" className={pill} onClick={fillCanvas}>⛶ Fill canvas</button>
            {el.h !== null ? <button type="button" className={pill} onClick={() => patch(el.id, { h: null })}>↺ Own shape</button> : <button type="button" className={pill} onClick={() => patch(el.id, { h: Math.round(((W * el.w) / 100 / (el.img?.ratio ?? 1) / (H || 1)) * 1000) / 10 })} title="Stretch / crop freely">⇕ Free shape</button>}
            <button type="button" className={pill} onClick={() => setImg({ flipX: el.img?.flipX ? undefined : true })}>⇆ Flip</button>
            <button type="button" className={pill} onClick={() => setImg({ flipY: el.img?.flipY ? undefined : true })}>⇅ Flip</button>
            <button type="button" className={pill} disabled={full} onClick={duplicate}>⧉ Duplicate</button>
            <button type="button" className={pill} onClick={() => patch(el.id, { locked: el.locked ? undefined : true })}>{el.locked ? "🔓 Unlock" : "🔒 Lock"}</button>
            {onBackground ? <button type="button" className={pill} onClick={() => onBackground(el.img!.src)} title="Use this picture as the full-canvas background">▣ Make background</button> : null}
          </div>
          {el.h !== null ? (
            <Segmented label="Fit in its box" value={(el.img.fit ?? "contain") as ImgFit} onChange={(fit) => setImg({ fit })} options={[{ value: "contain", label: "Whole" }, { value: "cover", label: "Crop to fill" }, { value: "fill", label: "Stretch" }]} />
          ) : null}
          <NumberSlider label="Size (width)" value={el.w} min={1} max={100} step={0.5} unit="%" onChange={(w) => patch(el.id, { w })} />
          <NumberSlider label="Rotate" value={el.rotate} min={-180} max={180} unit="°" onChange={(rotate) => patch(el.id, { rotate })} />
          <NumberSlider label="See-through" value={el.opacity} min={5} max={100} unit="%" onChange={(opacity) => patch(el.id, { opacity })} />
          <NumberSlider label="Rounded corners" value={el.radius} min={0} max={200} unit="px" onChange={(radius) => patch(el.id, { radius })} />
          <NumberSlider label="Border" value={el.strokeWidth} min={0} max={24} unit="px" onChange={(strokeWidth) => patch(el.id, { strokeWidth })} />
          {el.strokeWidth ? <ColorField label="Border colour" value={el.stroke} onChange={(stroke) => patch(el.id, { stroke })} /> : null}
          <NumberSlider label="Drop shadow" value={el.shadow ?? 0} min={0} max={40} unit="px" onChange={(v) => patch(el.id, v > 0 ? { shadow: v, shadowColor: el.shadowColor ?? "#000000" } : { shadow: undefined, shadowColor: undefined })} />
          {el.shadow ? <ColorField label="Shadow colour" value={el.shadowColor ?? "#000000"} onChange={(shadowColor) => patch(el.id, { shadowColor })} /> : null}
          <details>
            <summary className="cursor-pointer text-white/70">Adjust colour</summary>
            <div className="mt-2 space-y-2">
              <NumberSlider label="Brightness" value={el.img.bright ?? 100} min={0} max={200} unit="%" onChange={(bright) => setImg({ bright })} />
              <NumberSlider label="Contrast" value={el.img.contrast ?? 100} min={0} max={200} unit="%" onChange={(contrast) => setImg({ contrast })} />
              <NumberSlider label="Saturation" value={el.img.sat ?? 100} min={0} max={200} unit="%" onChange={(sat) => setImg({ sat })} />
              <NumberSlider label="Black & white" value={el.img.gray ?? 0} min={0} max={100} unit="%" onChange={(gray) => setImg({ gray })} />
              <NumberSlider label="Blur" value={el.img.blur ?? 0} min={0} max={20} step={0.5} unit="px" onChange={(blur) => setImg({ blur })} />
              <button type="button" className={pill} onClick={() => patch(el.id, { img: { src: el.img!.src, alt: el.img!.alt, ratio: el.img!.ratio, pxW: el.img!.pxW, pxH: el.img!.pxH, fit: el.img!.fit } })}>Reset colour</button>
            </div>
          </details>

          <div className={box}>
            <p className={title}>AI tools for this picture</p>
            <div className="flex flex-wrap gap-1">
              {AI_TOOLS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTool(t.key);
                    setMask({ url: null, coverage: 0 });
                    setMsg(null);
                  }}
                  className={`rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ${tool === t.key ? "bg-[var(--admin-accent)] text-black" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-white/55">{AI_TOOLS.find((t) => t.key === tool)!.help}</p>
            {tool === "erase" || tool === "replace" || tool === "edit" ? <textarea value={toolAsk} onChange={(e) => setToolAsk(e.target.value)} rows={2} placeholder={tool === "edit" ? "Make it gold metallic…" : tool === "replace" ? "What goes there" : "Optional: what is being removed"} className={ta} /> : null}
            {tool === "erase" || tool === "replace" ? <MaskBrush key={el.img.src} src={el.img.src} onMask={(url, coverage) => setMask({ url, coverage })} /> : null}
            <button type="button" className={gold} disabled={working} onClick={runTool}>
              {busy ?? "Run"}
            </button>
          </div>
          <button type="button" className="rounded-full bg-red-500/20 px-3 py-1 text-red-200 hover:bg-red-500/30" onClick={() => onRequestDelete({ target: "element", id: el.id })}>
            Delete picture
          </button>
        </div>
      ) : pics.length ? (
        <p className="text-white/50">Click a picture on the canvas to move, style or fix it.</p>
      ) : null}

      {result ? (
        <div className={box}>
          <p className={title}>Result</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.url} alt="Result" className="max-h-48 w-full rounded border border-white/15 bg-[repeating-conic-gradient(#555_0_25%,#333_0_50%)] bg-[length:16px_16px] object-contain" />
          <div className="flex flex-wrap gap-1">
            {result.from === "layer" && el ? (
              <button type="button" className={gold} onClick={() => (replacePicture(result.url), setResult(null))}>
                Replace the picture
              </button>
            ) : null}
            <button type="button" className={result.from === "layer" && el ? pill : gold} disabled={full} onClick={() => (addPicture(result.url, result.from === "recreate" ? "Recreated canvas" : ask.slice(0, 60) || "Picture"), setResult(null))}>
              Add as a new picture
            </button>
            {result.from === "recreate" && onBackground ? (
              <>
                <button type="button" className={gold} onClick={() => applyRecreated(true)}>Use as background & hide old layers</button>
                <button type="button" className={pill} onClick={() => applyRecreated(false)}>Use as background only</button>
              </>
            ) : null}
            <button type="button" className={pill} onClick={() => setResult(null)}>Discard</button>
          </div>
        </div>
      ) : null}

      <div className={box}>
        <p className={title}>🪄 Recreate the canvas as one picture</p>
        <p className="text-white/55">FLUX redraws everything on the canvas (background, pictures, shapes{keepText ? ", words" : ""}) as one seamless, polished picture in this print&apos;s shape.</p>
        <textarea value={recAsk} onChange={(e) => setRecAsk(e.target.value)} rows={2} placeholder="Optional: make it look like a neon sign at night…" className={ta} />
        <Toggle label="Keep the words in the picture" checked={keepText} onChange={setKeepText} />
        <button type="button" className={gold} disabled={working} onClick={recreate}>
          {busy ?? "Recreate"}
        </button>
      </div>

      {msg ? <p className={msg.ok ? "text-emerald-300" : "text-red-300"}>{msg.text}</p> : null}

      {/* Offscreen still render of the canvas for Recreate (same renderer as the print export). */}
      {capturing ? (
        <div aria-hidden="true" ref={holder} style={{ position: "fixed", left: -30000, top: 0, pointerEvents: "none" }}>
          <div data-rec-root style={{ width: 1280 }}>
            <DesignedBanner design={stillDesign(keepText ? design : { ...design, boxes: [], buttons: [] })} imageSrc={imageSrc} imageAlt="" legacy={{}} frameClassName="" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
