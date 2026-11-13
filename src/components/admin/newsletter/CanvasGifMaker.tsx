"use client";
/* eslint-disable @next/next/no-img-element -- previews of hosted email images (any host), not page images */

/**
 * CanvasGifMaker — D238 N-8c (SOP-22 G-118).
 *
 * "Moving elements": pick 2-10 pictures from Media, choose the seconds per
 * picture and the shape, and the server joins them into a looping GIF sized
 * for email (it lowers colours, then width, until it is light enough). The
 * GIF is saved to Media as a new file and dropped into the selected Image
 * section (or added as a new one). The first picture is the one Outlook for
 * Windows shows, so put the key message first.
 */
import { useState, useTransition } from "react";
import { Button, Select } from "@/components/admin/ui";
import { newBlockId, type CanvasBlock, type CanvasDoc } from "@/lib/cms/newsletter-canvas-core";
import { GIF_MAX_FRAMES, GIF_MIN_FRAMES, GIF_SHAPES } from "@/lib/cms/newsletter-motion-core";
import { buildGifAction } from "@/app/admin/newsletter/canvas/actions";
import type { CanvasMediaChoice } from "./NewsletterCanvasEditor";

type Api = { doc: CanvasDoc; setDoc: (d: CanvasDoc) => void; selected: CanvasBlock | null; update: (b: CanvasBlock) => void };

export function CanvasGifMaker({ media, api }: { media: CanvasMediaChoice[]; api: Api }) {
  const { doc, setDoc, selected, update } = api;
  const [frames, setFrames] = useState<CanvasMediaChoice[]>([]);
  const [seconds, setSeconds] = useState("1.5");
  const [shape, setShape] = useState<string>("wide");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const stills = media.filter((m) => !/\.gif(\?|$)/i.test(m.url));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= frames.length) return;
    const next = frames.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setFrames(next);
  };

  const build = () =>
    start(async () => {
      setMsg(null);
      const r = await buildGifAction({ urls: frames.map((f) => f.url), seconds: Number(seconds), shape, title: frames.map((f) => f.title).join(", ").slice(0, 120) });
      if (!r.ok) return setMsg({ tone: "err", text: r.error });
      const alt = frames[0]?.title ?? "Moving picture";
      if (selected && selected.type === "image") {
        update({ ...selected, src: r.url, alt: selected.alt || alt });
      } else {
        const i = selected ? doc.blocks.findIndex((x) => x.id === selected.id) + 1 : doc.blocks.length;
        const blocks = [...doc.blocks];
        blocks.splice(i, 0, { id: newBlockId("gif"), type: "image", src: r.url, alt, href: "", width: 600, caption: "" });
        setDoc({ ...doc, blocks });
      }
      setMsg({ tone: "ok", text: `GIF made: ${r.frames} pictures, ${Math.round(r.bytes / 1024)} KB, ${r.width}px wide. Saved to Media and placed. Save the canvas.` });
      setFrames([]);
    });

  return (
    <div className="mt-4 space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
      <p className="text-sm font-semibold text-[var(--admin-text)]">GIF maker (moving picture)</p>
      <p className="text-xs text-[var(--admin-text-muted)]">Pick {GIF_MIN_FRAMES}-{GIF_MAX_FRAMES} pictures in order. Outlook for Windows only shows the first one, so put the key message first.</p>
      {msg ? (
        <p role="status" className={`rounded-[var(--admin-radius-md)] px-3 py-2 text-xs ${msg.tone === "ok" ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]"}`}>{msg.text}</p>
      ) : null}
      <Select
        value=""
        aria-label="Add a picture to the GIF"
        disabled={frames.length >= GIF_MAX_FRAMES}
        onChange={(e) => {
          const m = stills.find((x) => x.url === e.target.value);
          if (m) setFrames([...frames, m]);
        }}
      >
        <option value="">Add a picture from Media…</option>
        {stills.map((m) => (
          <option key={m.url} value={m.url}>{m.title}</option>
        ))}
      </Select>
      {frames.length ? (
        <ol className="space-y-1">
          {frames.map((f, i) => (
            <li key={`${f.url}-${i}`} className="flex items-center gap-2 text-xs text-[var(--admin-text)]">
              <img src={f.url} alt="" className="h-8 w-12 rounded object-cover" />
              <span className="flex-1 truncate">{i + 1}. {f.title}</span>
              <button type="button" aria-label="Move up" className="px-1 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" aria-label="Move down" className="px-1 disabled:opacity-30" disabled={i === frames.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" aria-label="Remove" className="px-1 text-[var(--admin-orange)]" onClick={() => setFrames(frames.filter((_, k) => k !== i))}>✕</button>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Select value={seconds} onChange={(e) => setSeconds(e.target.value)} aria-label="Seconds per picture">
          {["0.8", "1.5", "2.5", "4"].map((s) => (
            <option key={s} value={s}>{s} s each</option>
          ))}
        </Select>
        <Select value={shape} onChange={(e) => setShape(e.target.value)} aria-label="Shape">
          {GIF_SHAPES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </Select>
        <Button type="button" variant="confirm" size="sm" onClick={build} disabled={pending || frames.length < GIF_MIN_FRAMES}>{pending ? "Making…" : "Make GIF"}</Button>
      </div>
    </div>
  );
}
