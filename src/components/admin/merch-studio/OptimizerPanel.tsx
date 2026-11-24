"use client";

/**
 * D270 - Printful Optimizer for a selected picture. Nothing changes until you
 * press Apply / Use this; every step shows Before | After on the garment colour.
 *   - Colours: each detected colour -> keep, any Printful thread, your own
 *     colour, or remove. "Flatten" snaps every pixel to these colours (kills
 *     the photo look / soft gradients). Live preview, then Apply.
 *   - AI fix (FLUX): flat print-ready redraw with N colours (+ your notes),
 *     FLUX sharpen, enlarge to 300 DPI. Result previewed first.
 * Reuses: art-prep actions (D267/D268), printFluxPollAction, analyzePixels.
 */
import { useEffect, useRef, useState } from "react";
import { printFluxPollAction } from "@/app/admin/marketing/print-studio/actions";
import { merchFlatRedrawAction, merchKeyOutAction, merchSharpenAction, merchUpscaleAction, type PrepOut } from "@/app/admin/merch-studio/art-prep-actions";
import { THREAD_PALETTE, nearestThread, type Method, type Placement } from "@/lib/merch-studio/garment-catalog-core";
import { FLAT_MAX, finalColors, remapPixels, suggestTargets } from "@/lib/merch-studio/optimizer-core";
import { MAX_THREADS } from "@/lib/merch-studio/print-rules-core";
import type { MElement } from "@/lib/merch-studio/merch-design-core";

export type OptTab = "colors" | "ai";
const POLL_MS = 4000;
const MAX_POLLS = 75;
const PREVIEW_PX = 520;
const btn = "rounded-[var(--admin-radius-sm)] bg-white/10 px-2.5 py-1 text-xs text-white/85 hover:bg-white/20 disabled:opacity-40";
const go = "rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-2.5 py-1 text-xs font-bold text-black disabled:opacity-40";

const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Could not read the picture.")); r.readAsDataURL(b); });
async function remapBlob(src: Blob, from: string[], to: (string | null)[], flatten: boolean, hardAlpha: boolean, maxPx?: number): Promise<{ canvas: HTMLCanvasElement }> {
  const bmp = await createImageBitmap(src);
  const k = maxPx ? Math.min(1, maxPx / Math.max(bmp.width, bmp.height)) : 1;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot edit pictures.");
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const img = ctx.getImageData(0, 0, c.width, c.height);
  remapPixels(img.data, from, to, { flatten, hardAlpha });
  ctx.putImageData(img, 0, 0);
  return { canvas: c };
}

export function OptimizerPanel({ el, blob, beforeUrl, method, garmentHex, placement, tab, setTab, onApply }: {
  el: MElement;
  blob: Blob | null;
  beforeUrl: string | null;
  method: Method;
  garmentHex: string;
  placement: Placement;
  tab: OptTab;
  setTab: (t: OptTab) => void;
  /** Replace the picture (new local asset); the Studio re-checks it. */
  onApply: (b: Blob, note: string) => Promise<void>;
}) {
  const emb = method === "embroidery";
  const from = (el.imgColors ?? []).slice(0, FLAT_MAX);
  const [to, setTo] = useState<(string | null)[]>(() => suggestTargets(from, method));
  const [flatten, setFlatten] = useState(emb || !!el.autoPhoto || !!el.isPhoto);
  const [after, setAfter] = useState<string | null>(null); // preview URL (colours or AI)
  const [aiBlob, setAiBlob] = useState<Blob | null>(null);
  const [aiNote, setAiNote] = useState("");
  const [nColors, setNColors] = useState(Math.min(Math.max(from.length, 2), emb ? MAX_THREADS : 4));
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const vector = blob?.type === "image/svg+xml" || !!el.vector;

  // Live colour preview.
  const key = `${to.join()}|${flatten}|${emb}`;
  useEffect(() => {
    if (tab !== "colors" || !blob || vector || !from.length) return;
    let gone = false;
    let url: string | null = null;
    remapBlob(blob, from, to, flatten, emb, PREVIEW_PX).then(({ canvas }) => canvas.toBlob((b) => { if (gone || !b) return; url = URL.createObjectURL(b); setAfter(url); }, "image/png")).catch(() => {});
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, blob, tab]);

  const setOne = (i: number, v: string | null) => setTo((cur) => cur.map((x, j) => (j === i ? v : x)));
  const finals = finalColors(from, to);
  const offThread = emb ? finals.filter((h) => !THREAD_PALETTE.some((t) => t.hex.toUpperCase() === h)) : [];

  const applyColors = async () => {
    if (!blob) return;
    setBusy("Applying colours at full size…");
    try {
      const { canvas } = await remapBlob(blob, from, to, flatten, emb);
      const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!out) throw new Error("Could not save the picture.");
      await onApply(out, `Colours applied (${finals.length} colour${finals.length === 1 ? "" : "s"}${flatten ? ", flattened" : ""}).`);
      setMsg({ ok: true, text: "Applied. Undo (Ctrl+Z) brings the old picture back." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not apply." }); }
    finally { setBusy(null); }
  };

  const pollFlux = async (pollingUrl: string, prompt: string) => {
    for (let n = 0; n < MAX_POLLS && alive.current; n++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const r = await printFluxPollAction(pollingUrl, prompt);
      if (r.state === "ready") return r.url;
      if (r.state === "failed") throw new Error(r.error);
      setBusy(`FLUX working… ${Math.round((r.progress ?? 0) * 100)}%`);
    }
    throw new Error("FLUX took too long - try again.");
  };
  const done = async (o: PrepOut) => { if (!o.ok) throw new Error(o.error); return o.kind === "done" ? o.url : pollFlux(o.pollingUrl, o.prompt); };
  const runAi = async (label: string, fn: (dataUrl: string) => Promise<string>, note: string) => {
    if (!blob) return;
    setMsg(null); setBusy(label); setAiBlob(null);
    try {
      const url = await fn(await blobToDataUrl(blob));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load the result (HTTP ${res.status}).`);
      const b = await res.blob();
      if (!alive.current) return;
      setAiBlob(b); setAiNote(note);
      setAfter(URL.createObjectURL(b));
      setMsg({ ok: true, text: "Preview ready - compare, then Use this (also saved to Media)." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That did not work." }); }
    finally { if (alive.current) setBusy(null); }
  };
  const palette = finals.length ? finals : undefined;
  const flatRedraw = () => runAi("FLUX redrawing flat…", async (dataUrl) => {
    const flat = await done(await merchFlatRedrawAction({ dataUrl, colors: nColors, method, palette, extra }));
    setBusy("Cutting out the background…");
    return done(await merchKeyOutAction({ url: flat, title: el.name ?? "Artwork" }));
  }, `Redrawn flat by FLUX (${nColors} colours).`);
  const sharpen = () => runAi("FLUX sharpening…", async (dataUrl) => done(await merchSharpenAction({ dataUrl })), "Sharpened by FLUX.");
  const enlarge = () => runAi("Enlarging to 300 DPI…", async (dataUrl) => done(await merchUpscaleAction({ dataUrl, title: el.name, widthIn: Math.max(el.w, 0.5), heightIn: Math.max(el.h, 0.5) })), "Enlarged to 300 DPI at its current size.");

  if (!blob) return <p className="text-xs text-white/50">The picture file isn&apos;t on this device - add it again to optimize it.</p>;
  if (vector) return <p className="text-xs text-white/60">Vector (SVG) art is already ideal for Printful - change its colours in your design app, or upload a PNG to use the optimizer.</p>;

  const preview = (src: string | null, label: string) => (
    <figure className="min-w-0 flex-1">
      <div className="flex aspect-square items-center justify-center rounded border border-white/10 p-2" style={{ background: garmentHex }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt={label} className="max-h-full max-w-full object-contain" /> : <span className="text-[0.65rem] text-white/50">…</span>}
      </div>
      <figcaption className="mt-0.5 text-center text-[0.65rem] text-white/50">{label}</figcaption>
    </figure>
  );
  return (
    <section className="space-y-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/40 bg-black/20 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{"\u2728"} Printful Optimizer <span className="text-xs font-normal text-white/50">{placement.label} · {emb ? "embroidery" : "print"}</span></h3>
        <div className="flex gap-1">
          {(["colors", "ai"] as const).map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => { setTab(t); setAfter(null); setAiBlob(null); }} className={tab === t ? go : btn}>{t === "colors" ? "Colours" : "AI fix (FLUX)"}</button>)}
        </div>
      </div>
      <div className="flex gap-2">{preview(beforeUrl, "Before")}{preview(after, tab === "colors" ? "After (preview)" : aiBlob ? "After (AI)" : "After")}</div>

      {tab === "colors" ? (
        from.length ? (
          <div className="space-y-1.5">
            {from.map((c, i) => (
              <div key={c} className="flex flex-wrap items-center gap-1 text-xs">
                <span className="inline-block h-5 w-5 rounded border border-white/30" style={{ background: c }} title={c} />
                <span className="w-16 text-white/60">{c}</span>
                <span className="text-white/40">{"\u2192"}</span>
                <button type="button" onClick={() => setOne(i, null)} className={`rounded px-1.5 py-0.5 ${to[i] === null ? "bg-white/25 text-white" : "bg-white/5 text-white/60"}`}>Keep</button>
                {THREAD_PALETTE.map((t) => (
                  <button key={t.code} type="button" title={`${t.code} ${t.name}${nearestThread(c).code === t.code ? " (closest)" : ""}`} onClick={() => setOne(i, t.hex.toUpperCase())}
                    className={`h-5 w-5 rounded-full border ${to[i] === t.hex.toUpperCase() ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]" : nearestThread(c).code === t.code ? "border-white" : "border-white/25"}`} style={{ background: t.hex }} />
                ))}
                {!emb ? <input type="color" aria-label={`Custom colour for ${c}`} value={to[i] && to[i] !== "none" ? to[i]! : c} onChange={(e) => setOne(i, e.target.value.toUpperCase())} className="h-5 w-6 cursor-pointer bg-transparent" /> : null}
                <button type="button" onClick={() => setOne(i, "none")} className={`rounded px-1.5 py-0.5 ${to[i] === "none" ? "bg-red-500/40 text-white" : "bg-white/5 text-white/60"}`} title="Make this colour see-through (e.g. a leftover background box)">Remove</button>
              </div>
            ))}
            <label className="flex items-center gap-2 text-xs text-white/80"><input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} /> Flatten to these colours (removes gradients / photo look{emb ? " - needed for thread" : ""})</label>
            <p className="text-[0.7rem] text-white/55">Result: {finals.length} colour{finals.length === 1 ? "" : "s"}{emb && finals.length > MAX_THREADS ? ` - over the ${MAX_THREADS}-thread limit, merge some` : ""}{offThread.length ? ` - ${offThread.length} not a Printful thread (Printful would swap it)` : emb ? " - all Printful threads \u2713" : ""}. Ringed swatch = closest thread.</p>
            <div className="flex flex-wrap gap-1">
              <button type="button" className={btn} onClick={() => setTo(from.map((h) => nearestThread(h).hex.toUpperCase()))}>All to closest threads</button>
              <button type="button" className={btn} onClick={() => setTo(from.map(() => null))}>Reset</button>
              <button type="button" disabled={!!busy} className={go} onClick={() => void applyColors()}>Apply colours</button>
            </div>
          </div>
        ) : <p className="text-xs text-white/55">No main colours detected - try the AI fix.</p>
      ) : (
        <div className="space-y-1.5 text-xs">
          <p className="text-white/60">FLUX redraws your logo as clean flat art Printful prints exactly - same design and wording, solid colours, crisp edges, no photo look - then the background is cut out. You see it before anything changes.</p>
          <label className="flex items-center gap-2 text-white/80">Colours
            <input type="range" min={1} max={emb ? MAX_THREADS : FLAT_MAX} value={nColors} onChange={(e) => setNColors(Number(e.target.value))} />
            <b className="text-white">{nColors}</b>{palette ? <span className="text-white/45">(uses your Colours choices)</span> : null}
          </label>
          <input className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-white" maxLength={400} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Optional notes, e.g. make the text bolder, drop the thin outer ring, use a heavier font" />
          <div className="flex flex-wrap gap-1">
            <button type="button" disabled={!!busy} className={go} onClick={() => void flatRedraw()}>{"\u2728"} Optimize for Printful (flat redraw)</button>
            <button type="button" disabled={!!busy} className={btn} onClick={() => void sharpen()}>Sharpen (FLUX)</button>
            <button type="button" disabled={!!busy} className={btn} onClick={() => void enlarge()}>Enlarge to 300 DPI</button>
            {aiBlob ? <button type="button" disabled={!!busy} className={go} onClick={() => void (async () => { setBusy("Placing…"); try { await onApply(aiBlob, aiNote); setMsg({ ok: true, text: "Used. Undo (Ctrl+Z) brings the old picture back." }); setAiBlob(null); } finally { setBusy(null); } })()}>Use this</button> : null}
          </div>
          <p className="text-[0.66rem] text-white/40">Uses the monthly AI budget; every result is saved to Media and logged. AI can drift on tiny text - always compare before using.</p>
        </div>
      )}
      {busy ? <p className="text-xs text-white/60">{busy}</p> : null}
      {msg ? <p className={`text-xs ${msg.ok ? "text-[var(--admin-accent)]" : "text-red-300"}`}>{msg.text}</p> : null}
    </section>
  );
}
