"use client";
/**
 * src/app/admin/products/[key]/remove-text/RemoveTextEditor.tsx  (D244 R-9)
 *
 * Owner (verbatim): "I want to drag a box over the text, then click a button
 * to remove it."
 *
 * Drag on the picture to draw a box (any number, up to 12). "Find the text"
 * asks the vision model where the text is and which pieces name a different
 * product; those come in ticked, with the reason, and the person can untick
 * any. "Remove text" sends the boxes to FLUX Erase (D244 R-17; Fill only as a fallback;
 * R-20: cropped + enlarged to ~1 MP, letters-only mask by default); the browser polls every
 * 3 s, then shows Before / After. Attach / Attach as cover are ordinary
 * forms (attachMatchedMedia); nothing is attached until one is pressed.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { findTextAction, pollEraseAction, publishErasedAction, startEraseAction } from "./actions";
import { attachMatchedMedia } from "../../actions";
import { FACTS_FIRST_HINT, foundSummary, type EraseBox, type EraseMaskMode, type EraseProduct, type FoundText } from "@/lib/enrichment/text-erase-core";

type Box = EraseBox & { id: number; text?: string; why?: string; advice?: FoundText["advice"]; on: boolean; ai: boolean };

const POLL_MS = 3000;
const POLL_MAX = 60;

export function RemoveTextEditor(props: {
  productKey: string;
  back: string | null;
  mediaId: string;
  imageUrl: string;
  product: EraseProduct;
  identityKey: string;
  visionReady: boolean;
  fluxReady: boolean;
  hint: string | null;
}) {
  const { productKey, back, mediaId, imageUrl, product, identityKey, visionReady, fluxReady, hint } = props;
  const wrap = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(1);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [surface, setSurface] = useState("");
  const [mode, setMode] = useState<EraseMaskMode>("letters");
  const [detail, setDetail] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(hint);
  const [error, setError] = useState<string | null>(null);
  const [finding, startFind] = useTransition();
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ mediaId: string; url: string; published: boolean } | null>(null);
  const [showAfter, setShowAfter] = useState(true);
  // D244 R-22: Publish a text-removed draft so the Copilot can suggest it.
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const publishResult = async () => {
    if (!result) return;
    setPublishing(true);
    setError(null);
    const out = await publishErasedAction(productKey, result.mediaId);
    setPublishing(false);
    if (!out.ok) {
      setError(out.error);
      return;
    }
    setPublishNote(out.note);
    setResult({ ...result, published: true });
  };
  const cancelled = useRef(false);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const frac = (e: React.PointerEvent) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (working || result) return;
    const p = frac(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const p = frac(e);
    if (p) setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const onUp = () => {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    setDrag(null);
    if (w < 0.01 || h < 0.01) return;
    setBoxes((b) => (b.length >= 12 ? b : [...b, { id: nextId.current++, x, y, w, h, on: true, ai: false }]));
  };

  const findText = () => {
    setError(null);
    startFind(async () => {
      const out = await findTextAction(productKey, mediaId, product);
      if (!out.ok) {
        setError(out.error);
        return;
      }
      setNote(foundSummary(out.found));
      setBoxes((b) => [
        ...b.filter((x) => !x.ai),
        ...out.found.map((f) => ({ ...f.box, id: nextId.current++, text: f.text, why: f.why, advice: f.advice, on: f.advice === "remove", ai: true })),
      ]);
    });
  };

  const remove = async () => {
    const chosen = boxes.filter((b) => b.on).map(({ x, y, w, h }) => ({ x, y, w, h }));
    setError(null);
    setWorking(true);
    setProgress("Sending to FLUX Erase…");
    try {
      const sub = await startEraseAction(productKey, mediaId, JSON.stringify(chosen), surface, mode);
      if (!sub.ok) {
        setError(sub.error);
        return;
      }
      setDetail(sub.detail);
      for (let i = 0; i < POLL_MAX && !cancelled.current; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const p = await pollEraseAction(productKey, sub.pollingUrl, mediaId, JSON.stringify(sub.boxes), sub.mode);
        if (p.state === "ready") {
          setResult({ mediaId: p.mediaId, url: p.url, published: p.published });
          setShowAfter(true);
          return;
        }
        if (p.state === "failed") {
          setError(p.error);
          return;
        }
        setProgress(`FLUX is removing the text${typeof p.progress === "number" ? ` (${Math.round(p.progress * (p.progress <= 1 ? 100 : 1))}%)` : "…"}`);
      }
      if (!cancelled.current) setError("FLUX is taking longer than 3 minutes. Try again in a moment.");
    } finally {
      setWorking(false);
      setProgress(null);
    }
  };

  const onCount = boxes.filter((b) => b.on).length;
  const live = drag ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : null;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" data-testid="remove-text-editor">
      <div>
        <div
          ref={wrap}
          data-testid="remove-text-canvas"
          className={`relative w-full select-none overflow-hidden rounded-xl border border-white/15 bg-black ${result ? "" : "cursor-crosshair"}`}
          style={{ touchAction: "none" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDrag(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result && showAfter ? result.url : imageUrl} alt={result && showAfter ? "After: text removed" : "Before"} draggable={false} className="block h-auto w-full" />
          {!result
            ? boxes.map((b) => (
                <div
                  key={b.id}
                  className={`pointer-events-none absolute border-2 ${b.on ? "border-[var(--admin-orange)] bg-[var(--admin-orange)]/25" : "border-dashed border-white/60 bg-transparent"}`}
                  style={{ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) }}
                />
              ))
            : null}
          {live ? <div className="pointer-events-none absolute border-2 border-[var(--admin-accent)] bg-[var(--admin-accent)]/20" style={{ left: pct(live.x), top: pct(live.y), width: pct(live.w), height: pct(live.h) }} /> : null}
          {result ? (
            <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">{showAfter ? "After" : "Before"}</span>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-white/50">
          {result ? "Compare, then attach the new photo or try again." : "Drag on the picture to draw a box over the text. Orange boxes will be removed; tap a box in the list to switch it off."}
        </p>
      </div>

      <div className="space-y-4">
        {note ? <p className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/80" data-testid="remove-text-note">{note}</p> : null}
        {error ? <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200" role="alert">{error}</p> : null}

        {!result ? (
          <>
            <button
              type="button"
              data-testid="remove-text-find"
              onClick={findText}
              disabled={!visionReady || finding || working}
              className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-40"
            >
              {finding ? "Reading the photo…" : "✨ Find the text (AI)"}
            </button>
            {!visionReady ? <p className="text-[11px] text-white/45">AI is not set up; draw the boxes by hand.</p> : null}

            {boxes.length > 0 ? (
              <ul className="space-y-1.5" data-testid="remove-text-boxes">
                {boxes.map((b, i) => (
                  <li key={b.id} className="flex items-start gap-2 rounded border border-white/10 p-2 text-xs">
                    <input
                      type="checkbox"
                      checked={b.on}
                      onChange={() => setBoxes((all) => all.map((x) => (x.id === b.id ? { ...x, on: !x.on } : x)))}
                      aria-label={`Remove box ${i + 1}`}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-white/85">{b.text ? `“${b.text}”` : `Box ${i + 1} (drawn)`}</span>
                      {b.why ? (
                        <span className={`block text-[11px] ${b.advice === "remove" ? "text-[var(--admin-orange)]" : b.advice === "keep" ? "text-emerald-300" : "text-white/50"}`}>
                          {b.advice === "remove" ? "AI: remove — " : b.advice === "keep" ? "AI: keep — " : "AI: "}
                          {b.why}
                        </span>
                      ) : null}
                    </span>
                    <button type="button" onClick={() => setBoxes((all) => all.filter((x) => x.id !== b.id))} className="text-white/40 hover:text-white" title="Delete this box">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <label className="block text-xs text-white/60">
              What is under the text? <span className="text-white/40">(optional, e.g. “black jar label”, “gold foil bag”)</span>
              <input value={surface} onChange={(e) => setSurface(e.target.value)} maxLength={80} className="mt-1 w-full rounded border border-white/15 bg-black px-2 py-1.5 text-sm text-white" />
            </label>

            <fieldset className="space-y-1 text-xs text-white/70" data-testid="remove-text-mode">
              <legend className="mb-1 text-white/60">What to erase inside each box</legend>
              <label className="flex items-start gap-2">
                <input type="radio" name="erase-mode" checked={mode === "letters"} onChange={() => setMode("letters")} className="mt-0.5" />
                <span>
                  The letters only <span className="text-white/40">(best: the label round each letter is kept, so FLUX has no room to invent new text)</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="erase-mode" checked={mode === "boxes"} onChange={() => setMode("boxes")} className="mt-0.5" />
                <span>
                  The whole box <span className="text-white/40">(for a sticker, logo or picture rather than letters)</span>
                </span>
              </label>
            </fieldset>

            <button
              type="button"
              data-testid="remove-text-run"
              onClick={() => void remove()}
              disabled={!fluxReady || working || finding || onCount === 0}
              className="w-full rounded-lg bg-[var(--admin-accent)] px-3 py-2.5 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40"
            >
              {working ? (progress ?? "Working…") : `Remove text (${onCount} box${onCount === 1 ? "" : "es"})`}
            </button>
            {!fluxReady ? <p className="text-[11px] text-amber-300">FLUX is not set up (Settings → Integrations), so text cannot be removed yet.</p> : null}
            <p className="text-[11px] text-white/45">FLUX Erase (Black Forest Labs&apos; purpose-built remover) works best at about 1 megapixel on a mask that follows the letters. So the text area is cut out with some label round it, enlarged to about 1 MP, the letters inside your boxes are found and erased, and only those pixels are stitched back onto your photo — nothing else can change. Draw each box snug round one line or block of text. The original photo is never changed — the result is saved as a new library photo.</p>
          </>
        ) : (
          <div className="space-y-3" data-testid="remove-text-result">
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowAfter(false)} className={`flex-1 rounded border px-2 py-1.5 text-xs ${!showAfter ? "border-white bg-white/10 text-white" : "border-white/20 text-white/60"}`}>
                Before
              </button>
              <button type="button" onClick={() => setShowAfter(true)} className={`flex-1 rounded border px-2 py-1.5 text-xs ${showAfter ? "border-white bg-white/10 text-white" : "border-white/20 text-white/60"}`}>
                After
              </button>
            </div>
            <p className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 p-2 text-[11px] text-[var(--admin-gold)]" data-testid="facts-first-hint">
              {FACTS_FIRST_HINT}
            </p>
            {detail ? (
              <p className="text-[11px] text-white/50" data-testid="remove-text-detail">
                {detail}
              </p>
            ) : null}
            <p className="text-xs text-emerald-300">Saved to the media library{result.published ? "." : " as a draft (the original was a draft or its rights are pending)."}</p>
            {result.published ? (
              <p className="text-[11px] text-white/60" data-testid="remove-text-published-note">
                {publishNote ?? "Published: the Copilot suggests it just behind exact matches."}
              </p>
            ) : (
              <button
                type="button"
                data-testid="remove-text-publish"
                disabled={publishing}
                onClick={publishResult}
                className="w-full rounded-lg border border-emerald-400/60 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-60"
                title="Publish this text-removed photo so the Copilot can suggest it (you are confirming the rights are fine)"
              >
                {publishing ? "Publishing\u2026" : "Publish (so the Copilot suggests it)"}
              </button>
            )}
            <form action={attachMatchedMedia}>
              <input type="hidden" name="key" value={productKey} />
              {back ? <input type="hidden" name="back" value={back} /> : null}
              <input type="hidden" name="mediaId" value={result.mediaId} />
              <input type="hidden" name="source" value="text-removed" />
              <input type="hidden" name="identityKey" value={identityKey} />
              <input type="hidden" name="cover" value="1" />
              <button type="submit" data-testid="remove-text-attach-cover" className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black hover:brightness-110">
                Attach as cover
              </button>
            </form>
            <form action={attachMatchedMedia}>
              <input type="hidden" name="key" value={productKey} />
              {back ? <input type="hidden" name="back" value={back} /> : null}
              <input type="hidden" name="mediaId" value={result.mediaId} />
              <input type="hidden" name="source" value="text-removed" />
              <input type="hidden" name="identityKey" value={identityKey} />
              <button type="submit" data-testid="remove-text-attach" className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10">
                Attach to gallery
              </button>
            </form>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setError(null);
              }}
              className="w-full rounded-lg px-3 py-1.5 text-xs text-white/60 hover:text-white"
            >
              Try again with different boxes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
