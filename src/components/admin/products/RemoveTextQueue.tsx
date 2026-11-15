"use client";
/**
 * src/components/admin/products/RemoveTextQueue.tsx  (D244 R-11)
 *
 * Owner (round 4, verbatim): "on both, I think it would be a great idea to
 * have the ability to select a product image, draw a box on it where I want
 * it to remove and replace text with the background. I want to draw a box on
 * all product images, then click the remove text button. that way I can
 * quickly queue up several images to feed to flux to fix one after the next."
 *
 * Tick the photos, drag a box (or press "Find the text") on each, then ONE
 * press of "Remove text" sends them to FLUX Fill one after the next. Each
 * result shows Before / After with the page's own buttons (Copilot: Attach /
 * Attach as cover; Vendor kits: Use as the kit photo). Nothing is attached by
 * the queue itself: a person's press does that.
 *
 * D244 R-21: a page can own the ticks (picked / onToggle) and hide the small
 * thumbnail strip - Vendor kits ticks straight from its one photo grid.
 *
 * D244 R-22: a result saved as a draft has a Publish button (owner: "give
 * me the ability to publish the draft from removing the text so it can be
 * suggested on the copilot page"). Published text-removed photos rank just
 * behind exact matches in the Copilot's suggestions.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { queueFindTextAction, queuePollEraseAction, queuePublishErasedAction, queueStartEraseAction } from "./remove-text-queue-actions";
import {
  ERASE_BOXES_MAX,
  eraseQueuePlan,
  queueButtonLabel,
  queueSummary,
  toggleQueuePick,
  type EraseBox,
  type EraseMaskMode,
  type EraseProduct,
  type QueueScope,
  type QueueState,
} from "@/lib/enrichment/text-erase-core";

export type QueuePhoto = { mediaId: string; url: string; label: string };
type Box = EraseBox & { id: number; text?: string; why?: string; on: boolean; ai: boolean };
type Slot = { boxes: Box[]; state: QueueState; progress: string | null; error: string | null; result: { mediaId: string; url: string; published: boolean } | null; after: boolean; finding: boolean; publishing: boolean; publishNote: string | null };

const POLL_MS = 3000;
const POLL_MAX = 60;
const emptySlot = (): Slot => ({ boxes: [], state: "idle", progress: null, error: null, result: null, after: true, finding: false, publishing: false, publishNote: null });
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

function QueueCanvas(props: { photo: QueuePhoto; slot: Slot; locked: boolean; onBox: (b: EraseBox) => void }) {
  const { photo, slot, locked, onBox } = props;
  const wrap = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const frac = (e: React.PointerEvent) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const live = drag ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : null;
  const showAfter = Boolean(slot.result && slot.after);
  return (
    <div
      ref={wrap}
      data-testid="queue-canvas"
      className={`relative w-full select-none overflow-hidden rounded-lg border border-white/15 bg-black ${locked ? "" : "cursor-crosshair"}`}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        if (locked) return;
        const p = frac(e);
        if (!p) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = frac(e);
        if (p) setDrag({ ...drag, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (!drag || !live) return;
        setDrag(null);
        if (live.w < 0.01 || live.h < 0.01) return;
        onBox(live);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={showAfter && slot.result ? slot.result.url : photo.url} alt={showAfter ? "After: text removed" : photo.label} draggable={false} className="block h-auto w-full" />
      {!slot.result
        ? slot.boxes.map((b) => (
            <div
              key={b.id}
              className={`pointer-events-none absolute border-2 ${b.on ? "border-[var(--admin-orange)] bg-[var(--admin-orange)]/25" : "border-dashed border-white/60"}`}
              style={{ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) }}
            />
          ))
        : null}
      {live ? <div className="pointer-events-none absolute border-2 border-[var(--admin-accent)] bg-[var(--admin-accent)]/20" style={{ left: pct(live.x), top: pct(live.y), width: pct(live.w), height: pct(live.h) }} /> : null}
      {slot.result ? <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-[0.65rem] font-semibold text-white">{showAfter ? "After" : "Before"}</span> : null}
    </div>
  );
}

export function RemoveTextQueue(props: {
  scope: QueueScope;
  photos: QueuePhoto[];
  product: EraseProduct;
  visionReady: boolean;
  fluxReady: boolean;
  /** Copilot: a server action that attaches (form fields mediaId, cover + hidden). */
  attachAction?: (formData: FormData) => void | Promise<void>;
  hidden?: Record<string, string>;
  /** Vendor kits: a link with __MEDIA__ in place of the new photo's id. */
  pickHref?: string;
  pickLabel?: string;
  /**
   * D244 R-21: the page owns the ticks (Vendor kits ticks from its one big
   * photo grid) and the small thumbnail strip is hidden.
   */
  picked?: string[];
  onToggle?: (mediaId: string) => void;
  hidePicker?: boolean;
}) {
  const { scope, photos, product, visionReady, fluxReady, attachAction, hidden, pickHref, pickLabel, hidePicker } = props;
  const nextId = useRef(1);
  const cancelled = useRef(false);
  const [ownPicked, setOwnPicked] = useState<string[]>([]);
  const picked = props.picked ?? ownPicked;
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [surface, setSurface] = useState("");
  const [mode, setMode] = useState<EraseMaskMode>("letters");
  const [running, setRunning] = useState(false);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const slotOf = (m: string) => slots[m] ?? emptySlot();
  const patch = (m: string, p: Partial<Slot> | ((s: Slot) => Partial<Slot>)) =>
    setSlots((all) => {
      const cur = all[m] ?? emptySlot();
      return { ...all, [m]: { ...cur, ...(typeof p === "function" ? p(cur) : p) } };
    });

  const toggle = (m: string) => (props.onToggle ? props.onToggle(m) : setOwnPicked((p) => toggleQueuePick(p, m).picked));
  const chosen = picked.map((m) => photos.find((p) => p.mediaId === m)).filter((p): p is QueuePhoto => Boolean(p));
  const entries = chosen.map((p) => ({ mediaId: p.mediaId, boxesOn: slotOf(p.mediaId).boxes.filter((b) => b.on).length, state: slotOf(p.mediaId).state }));
  const plan = eraseQueuePlan(entries);
  const planBoxes = entries.filter((e) => plan.includes(e.mediaId)).reduce((n, e) => n + e.boxesOn, 0);
  const summary = queueSummary(chosen.map((p) => slotOf(p.mediaId).state));

  const findText = async (m: string) => {
    patch(m, { finding: true, error: null });
    const out = await queueFindTextAction(scope, m, product);
    if (!out.ok) {
      patch(m, { finding: false, error: out.error });
      return;
    }
    patch(m, (s) => ({
      finding: false,
      boxes: [...s.boxes.filter((b) => !b.ai), ...out.found.map((f) => ({ ...f.box, id: nextId.current++, text: f.text, why: f.why, on: f.advice === "remove", ai: true }))].slice(0, ERASE_BOXES_MAX),
    }));
  };

  /** D244 R-22: the person's Publish press on a text-removed draft. */
  const publishResult = async (m: string, mediaId: string) => {
    patch(m, { publishing: true, error: null });
    const out = await queuePublishErasedAction(scope, mediaId);
    if (!out.ok) {
      patch(m, { publishing: false, error: out.error });
      return;
    }
    patch(m, (cur) => ({ publishing: false, publishNote: out.note, result: cur.result ? { ...cur.result, published: true } : cur.result }));
  };

  const runOne = async (m: string, boxes: EraseBox[]) => {
    patch(m, { state: "working", progress: "Sending to FLUX Erase\u2026", error: null });
    const sub = await queueStartEraseAction(scope, m, JSON.stringify(boxes), surface, mode);
    if (!sub.ok) {
      patch(m, { state: "failed", progress: null, error: sub.error });
      return;
    }
    for (let i = 0; i < POLL_MAX && !cancelled.current; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const p = await queuePollEraseAction(scope, sub.pollingUrl, m, JSON.stringify(sub.boxes), sub.mode);
      if (p.state === "ready") {
        patch(m, { state: "ready", progress: null, result: { mediaId: p.mediaId, url: p.url, published: p.published }, after: true });
        return;
      }
      if (p.state === "failed") {
        patch(m, { state: "failed", progress: null, error: p.error });
        return;
      }
      patch(m, { progress: `FLUX is removing the text${typeof p.progress === "number" ? ` (${Math.round(p.progress * (p.progress <= 1 ? 100 : 1))}%)` : "\u2026"}` });
    }
    if (!cancelled.current) patch(m, { state: "failed", progress: null, error: "FLUX took longer than 3 minutes. Press Remove text again." });
  };

  /** One press: every boxed photo, one after the next. */
  const runQueue = async () => {
    const order = plan.slice();
    const boxesFor = new Map(order.map((m) => [m, slotOf(m).boxes.filter((b) => b.on).map(({ x, y, w, h }) => ({ x, y, w, h }))] as const));
    setRunning(true);
    for (const m of order) patch(m, { state: "waiting", error: null });
    try {
      for (const m of order) {
        if (cancelled.current) break;
        await runOne(m, boxesFor.get(m) ?? []);
      }
    } finally {
      setRunning(false);
    }
  };

  if (photos.length === 0) return null;
  if (hidePicker && chosen.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-white/10 p-3" data-testid="remove-text-queue">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">{"\u2702"} Remove text from several photos</h3>
        {summary ? <span className="text-xs text-white/60" data-testid="queue-summary">{summary}</span> : null}
      </div>
      <p className="text-[11px] text-white/50">
        1. {hidePicker ? <>Press &ldquo;{"\u2702"} Remove text&rdquo; on any photo above (up to 12 at a time).</> : <>Tick the photos.</>} 2. Drag a box over the text on each one (or press &ldquo;Find the text&rdquo;). 3. Press Remove text once &mdash; FLUX fixes them one after the next. The originals never change; each result is a new library photo.
      </p>
      {hidePicker ? null : (
      <div className="flex flex-wrap gap-2" data-testid="queue-pick">
        {photos.map((p) => {
          const on = picked.includes(p.mediaId);
          const st = slotOf(p.mediaId).state;
          return (
            <button
              key={p.mediaId}
              type="button"
              onClick={() => toggle(p.mediaId)}
              disabled={running}
              aria-pressed={on}
              title={on ? `Take ${p.label} out of the queue` : `Add ${p.label} to the queue`}
              className={`relative h-16 w-16 overflow-hidden rounded border disabled:opacity-60 ${on ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]/40" : "border-white/15 hover:border-white/40"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.label} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              {on ? <span className="absolute right-0.5 top-0.5 rounded bg-black/80 px-1 text-[0.6rem] text-white">{st === "ready" ? "\u2713" : picked.indexOf(p.mediaId) + 1}</span> : null}
            </button>
          );
        })}
      </div>
      )}

      {chosen.length > 0 ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {chosen.map((p, idx) => {
              const s = slotOf(p.mediaId);
              const locked = running || Boolean(s.result) || s.state === "working";
              const on = s.boxes.filter((b) => b.on).length;
              return (
                <div key={p.mediaId} className="space-y-1.5 rounded border border-white/10 p-2" data-testid="queue-item">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-white/80">
                      {idx + 1}. {p.label}
                    </span>
                    <span className={s.state === "failed" ? "text-red-300" : s.state === "ready" ? "text-emerald-300" : "text-white/50"}>
                      {s.state === "working" ? (s.progress ?? "Working\u2026") : s.state === "waiting" ? "Waiting\u2026" : s.state === "ready" ? "Done" : s.state === "failed" ? "Failed" : `${on} box${on === 1 ? "" : "es"}`}
                    </span>
                  </div>
                  <QueueCanvas
                    photo={p}
                    slot={s}
                    locked={locked}
                    onBox={(b) => patch(p.mediaId, (cur) => ({ boxes: cur.boxes.length >= ERASE_BOXES_MAX ? cur.boxes : [...cur.boxes, { ...b, id: nextId.current++, on: true, ai: false }] }))}
                  />
                  {s.error ? (
                    <p className="text-[11px] text-red-300" role="alert">
                      {s.error}
                    </p>
                  ) : null}
                  {!s.result ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void findText(p.mediaId)}
                        disabled={!visionReady || s.finding || locked}
                        className="rounded border border-white/20 px-2 py-1 text-[11px] text-white hover:bg-white/10 disabled:opacity-40"
                      >
                        {s.finding ? "Reading\u2026" : "\u2728 Find the text"}
                      </button>
                      <button
                        type="button"
                        onClick={() => patch(p.mediaId, { boxes: [] })}
                        disabled={locked || s.boxes.length === 0}
                        className="rounded px-2 py-1 text-[11px] text-white/60 hover:text-white disabled:opacity-40"
                      >
                        Clear boxes
                      </button>
                      {s.boxes
                        .filter((b) => b.ai)
                        .map((b) => (
                          <label key={b.id} className="flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[0.65rem] text-white/70" title={b.why}>
                            <input type="checkbox" checked={b.on} disabled={locked} onChange={() => patch(p.mediaId, (cur) => ({ boxes: cur.boxes.map((x) => (x.id === b.id ? { ...x, on: !x.on } : x)) }))} />
                            &ldquo;{(b.text ?? "").slice(0, 24)}&rdquo;
                          </label>
                        ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5" data-testid="queue-result">
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => patch(p.mediaId, { after: false })} className={`flex-1 rounded border px-2 py-1 text-[11px] ${!s.after ? "border-white bg-white/10 text-white" : "border-white/20 text-white/60"}`}>
                          Before
                        </button>
                        <button type="button" onClick={() => patch(p.mediaId, { after: true })} className={`flex-1 rounded border px-2 py-1 text-[11px] ${s.after ? "border-white bg-white/10 text-white" : "border-white/20 text-white/60"}`}>
                          After
                        </button>
                      </div>
                      <p className="text-[11px] text-emerald-300">Saved to the media library{s.result.published ? "." : " as a draft (the original was a draft or its rights are pending)."}</p>
                      {s.result.published ? (
                        <p className="text-[11px] text-white/60" data-testid="queue-published-note">
                          {s.publishNote ?? "Published: the Copilot suggests it just behind exact matches."}
                        </p>
                      ) : (
                        <button
                          type="button"
                          data-testid="queue-publish"
                          disabled={s.publishing}
                          onClick={() => publishResult(p.mediaId, s.result!.mediaId)}
                          className="w-full rounded border border-emerald-400/60 px-2 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-60"
                          title="Publish this text-removed photo so the Copilot can suggest it (you are confirming the rights are fine)"
                        >
                          {s.publishing ? "Publishing\u2026" : "Publish (so the Copilot suggests it)"}
                        </button>
                      )}
                      {attachAction ? (
                        <div className="flex gap-1.5">
                          <form action={attachAction} className="flex-1">
                            {Object.entries(hidden ?? {}).map(([k, v]) => (
                              <input key={k} type="hidden" name={k} value={v} />
                            ))}
                            <input type="hidden" name="mediaId" value={s.result.mediaId} />
                            <input type="hidden" name="cover" value="1" />
                            <button type="submit" data-testid="queue-attach-cover" className="w-full rounded bg-emerald-500 px-2 py-1.5 text-xs font-semibold text-black hover:brightness-110">
                              Attach as cover
                            </button>
                          </form>
                          <form action={attachAction} className="flex-1">
                            {Object.entries(hidden ?? {}).map(([k, v]) => (
                              <input key={k} type="hidden" name={k} value={v} />
                            ))}
                            <input type="hidden" name="mediaId" value={s.result.mediaId} />
                            <button type="submit" data-testid="queue-attach" className="w-full rounded border border-white/20 px-2 py-1.5 text-xs font-semibold text-white hover:bg-white/10">
                              Attach
                            </button>
                          </form>
                        </div>
                      ) : null}
                      {pickHref ? (
                        <Link href={pickHref.replace("__MEDIA__", encodeURIComponent(s.result.mediaId))} data-testid="queue-pick-kit" className="block rounded bg-emerald-500 px-2 py-1.5 text-center text-xs font-semibold text-black hover:brightness-110">
                          {pickLabel ?? "Use this photo"}
                        </Link>
                      ) : null}
                      <button type="button" onClick={() => patch(p.mediaId, { result: null, state: "idle", error: null })} className="w-full text-[11px] text-white/50 hover:text-white">
                        Try again with different boxes
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <label className="block text-xs text-white/60">
            What is under the text? <span className="text-white/40">(optional, used for every photo, e.g. &ldquo;black jar label&rdquo;)</span>
            <input value={surface} onChange={(e) => setSurface(e.target.value)} maxLength={80} disabled={running} className="mt-1 w-full rounded border border-white/15 bg-black px-2 py-1.5 text-sm text-white" />
          </label>
          <label className="flex items-center gap-2 text-xs text-white/60">
            <input type="checkbox" checked={mode === "boxes"} onChange={(e) => setMode(e.target.checked ? "boxes" : "letters")} disabled={running} data-testid="queue-mode-boxes" />
            Erase the whole boxes <span className="text-white/40">(off = the letters only, best for text)</span>
          </label>
          <button
            type="button"
            data-testid="queue-run"
            onClick={() => void runQueue()}
            disabled={!fluxReady || running || plan.length === 0}
            className="w-full rounded-lg bg-[var(--admin-accent)] px-3 py-2.5 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40"
          >
            {running ? `Working through the queue\u2026 ${summary}` : queueButtonLabel(plan.length, planBoxes)}
          </button>
          {!fluxReady ? <p className="text-[11px] text-amber-300">FLUX is not set up (Settings {"\u2192"} Integrations), so text cannot be removed yet.</p> : null}
        </>
      ) : (
        <p className="text-[11px] text-white/40">Tick one or more photos above to start.</p>
      )}
    </div>
  );
}
