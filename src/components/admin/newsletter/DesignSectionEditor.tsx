"use client";
/* eslint-disable @next/next/no-img-element -- previews of hosted email pictures (any host) */

/**
 * D243 E-2 (SOP-22 G-122) — the email Design section editor.
 *
 * The website's Banner Studio (every tool: text boxes, fonts, effects,
 * shapes, icons, layers, undo, brand banners) at email width, plus:
 *   • a QR code drawn onto the picture (a normal icon layer),
 *   • live menu product rows under the picture (price stays live HTML),
 *   • a live countdown under the picture,
 *   • Save picture: the SAME public <DesignedBanner> is drawn offscreen and
 *     turned into a picture (modern-screenshot), then stored in the Media
 *     Library as a new file. The email shows that picture with alt text and
 *     a link. A change after saving marks it "out of date" (send check).
 *   • D243 E-6: Make it move (GIF): the design's entrances are drawn frame by
 *     frame (the finished design first, for Outlook) and joined into a GIF.
 */
import dynamic from "next/dynamic";
import { useRef, useState, useTransition } from "react";
import { Badge, Button, Input, Select } from "@/components/admin/ui";
import { DesignedBanner } from "@/components/site/DesignedBanner";
import { BrandBannersRow } from "@/components/admin/banner-studio/BannerEditorShell";
import type { CanvasBlock } from "@/lib/cms/newsletter-canvas-core";
import { exportPlan, stillDesign } from "@/lib/brand/brand-sizes-core";
import {
  EMAIL_DESIGN_RENDER_W,
  EMAIL_DESIGN_SHAPES,
  DESIGN_MAX_PRODUCTS,
  addQrToDesign,
  designHash,
  designIssues,
  designStale,
  formatCents,
  putProductName,
  reshapeEmailDesign,
  shapeOf,
  type DesignProduct,
  type EmailDesignShape,
} from "@/lib/cms/newsletter-design-core";
import { uploadCanvasImageAction } from "@/app/admin/newsletter/canvas/actions";
import { saveDesignGifAction, saveDesignPictureAction, searchDesignProductsAction } from "@/app/admin/newsletter/canvas/design-actions";
import { DESIGN_GIF_W, designFrameAt, designGifPlan } from "@/lib/cms/newsletter-polish-core";

const BannerStudio = dynamic(() => import("@/components/admin/banner-studio/BannerStudio"), {
  ssr: false,
  loading: () => <p className="text-xs text-[var(--admin-text-muted)]">Loading the design studio…</p>,
});

type DesignBlock = Extract<CanvasBlock, { type: "design" }>;
const LABEL = "block text-[0.68rem] font-black uppercase tracking-[0.12em] text-[var(--admin-text-faint)]";

function toLocalInput(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string): string {
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

export function DesignSectionEditor({
  b,
  update,
  media,
  title,
}: {
  b: DesignBlock;
  update: (b: CanvasBlock) => void;
  media: { url: string; title: string }[];
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [qrUrl, setQrUrl] = useState("https://www.greenwaymarijuana.com/menu");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DesignProduct[] | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  // D243 E-6: which items are hidden in the frame being drawn (null = the whole design).
  const [frameHide, setFrameHide] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<DesignBlock>) => update({ ...b, ...patch });
  const stale = designStale(b);
  const issues = designIssues(b);
  const plan = exportPlan(stillDesign(b.design), { w: EMAIL_DESIGN_RENDER_W, h: 0, label: "email" });
  const shape = shapeOf(b.design);
  const mediaChoices = media.map((m) => ({ id: m.url, url: m.url, title: m.title, usageType: "newsletter" }));

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setMsg(null);
      try {
        await fn();
      } catch (e) {
        setMsg({ tone: "err", text: e instanceof Error ? e.message : "Something went wrong." });
      }
    });

  const savePicture = () =>
    run(async () => {
      setRendering(true);
      try {
        // Let React paint the offscreen copy (and its fonts and picture) first.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (document.fonts?.ready) await document.fonts.ready;
        const node = holder.current?.firstElementChild as HTMLElement | null;
        if (!node) throw new Error("Couldn't prepare the picture. Try again.");
        const { domToBlob } = await import("modern-screenshot");
        const blob = await domToBlob(node, { width: plan.renderW, height: plan.renderH, scale: plan.scale, backgroundColor: "#000000", type: "image/png", timeout: 20000 });
        if (!blob || !blob.size) throw new Error("The picture came out empty. Try again.");
        const fd = new FormData();
        fd.set("file", new File([blob], "design.png", { type: "image/png" }));
        fd.set("title", b.alt || title);
        fd.set("blockId", b.id);
        const r = await saveDesignPictureAction(fd);
        if (!r.ok) throw new Error(r.error);
        update({ ...b, src: r.src, w: r.w, h: r.h, hash: designHash(b), alt: b.alt || title });
        setMsg({ tone: "ok", text: `Picture saved to the Media Library (${r.w}×${r.h}, ${Math.round(r.bytes / 1024)} KB). Save the newsletter to keep it.` });
      } finally {
        setRendering(false);
      }
    });

  const gifPlan = designGifPlan(b.design);
  const saveGif = () =>
    run(async () => {
      if (!gifPlan.ok) throw new Error(gifPlan.error);
      setRendering(true);
      try {
        const { domToBlob } = await import("modern-screenshot");
        const fd = new FormData();
        const scale = Math.min(plan.scale, (DESIGN_GIF_W * 1.5) / plan.renderW);
        for (let i = 0; i < gifPlan.frames.length; i++) {
          setFrameHide(gifPlan.frames[i].hide);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          if (document.fonts?.ready) await document.fonts.ready;
          const node = holder.current?.firstElementChild as HTMLElement | null;
          if (!node) throw new Error("Couldn't prepare the moving picture. Try again.");
          const blob = await domToBlob(node, { width: plan.renderW, height: plan.renderH, scale, backgroundColor: "#000000", type: "image/jpeg", quality: 0.92, timeout: 20000 });
          if (!blob || !blob.size) throw new Error("A frame came out empty. Try again.");
          fd.set(`frame${i}`, new File([blob], `frame${i}.jpg`, { type: "image/jpeg" }));
        }
        fd.set("delays", JSON.stringify(gifPlan.frames.map((f) => f.ms)));
        fd.set("title", b.alt || title);
        fd.set("blockId", b.id);
        const r = await saveDesignGifAction(fd);
        if (!r.ok) throw new Error(r.error);
        update({ ...b, src: r.src, w: r.w, h: r.h, hash: designHash(b), alt: b.alt || title });
        setMsg({ tone: "ok", text: `Moving picture saved (${r.frames} frames, ${r.w}×${r.h}, ${Math.round(r.bytes / 1024)} KB). Outlook for Windows shows the first frame: the finished design. Save the newsletter to keep it.` });
      } finally {
        setFrameHide(null);
        setRendering(false);
      }
    });

  const uploadBackground = (f: File | undefined) => {
    if (!f) return;
    run(async () => {
      const fd = new FormData();
      fd.set("file", f);
      const r = await uploadCanvasImageAction(fd);
      if (!r.ok) throw new Error(r.error);
      set({ image: r.src });
      setMsg({ tone: "ok", text: "Background picture added." });
    });
  };

  const addQr = () => {
    const r = addQrToDesign(b.design, qrUrl.trim());
    if (!r.ok) return setMsg({ tone: "err", text: r.error });
    set({ design: r.design });
    setMsg({ tone: "ok", text: "QR code added to the picture. Drag it in the studio; scan the saved picture with your phone to try it." });
  };

  const search = () =>
    run(async () => {
      const r = await searchDesignProductsAction(query);
      if (!r.ok) throw new Error(r.error);
      setHits(r.products);
    });

  return (
    <div className="space-y-3" data-testid="design-section-editor">
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { uploadBackground(e.target.files?.[0]); e.target.value = ""; }} />

      {/* The picture the email shows */}
      <div className="rounded-[var(--admin-radius-md)] border border-[var(--admin-border)] p-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={LABEL}>In the email</span>
          {!b.src ? <Badge tone="danger">no picture yet</Badge> : stale ? <Badge tone="danger">out of date</Badge> : <Badge tone="green">up to date</Badge>}
          <Button type="button" size="sm" variant="save" className="ml-auto" disabled={pending} onClick={savePicture}>
            {pending && rendering ? "Drawing…" : b.src ? "Update picture" : "Save picture"}
          </Button>
          <Button type="button" size="sm" variant="neutral" disabled={pending || !gifPlan.ok} onClick={saveGif} data-testid="design-save-gif" title={gifPlan.ok ? (gifPlan.animated ? "Plays the design's entrances as a moving GIF" : "No entrances set: the words build up in reading order") : gifPlan.error}>
            Make it move (GIF)
          </Button>
        </div>
        {b.src ? <img src={b.src} alt={b.alt} className="w-full rounded" /> : (
          <div className="overflow-hidden rounded">
            <DesignedBanner design={b.design} imageSrc={b.image} imageAlt="" legacy={{}} frameClassName="" />
          </div>
        )}
        {stale ? <p className="mt-1 text-[11px] text-[var(--admin-gold)]">The design changed after the picture was saved. Press Update picture before sending.</p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="confirm" onClick={() => setOpen(true)}>Open the design studio</Button>
        <Button type="button" size="sm" variant="neutral" disabled={pending} onClick={() => fileRef.current?.click()}>Upload background</Button>
        {b.image ? <Button type="button" size="sm" variant="neutral" onClick={() => set({ image: "" })}>Remove background</Button> : null}
      </div>
      {media.length ? (
        <Select value="" onChange={(e) => e.target.value && set({ image: e.target.value })}>
          <option value="">Background from the media library…</option>
          {media.map((m) => <option key={m.url} value={m.url}>{m.title}</option>)}
        </Select>
      ) : null}

      <div>
        <span className={LABEL}>Shape</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {EMAIL_DESIGN_SHAPES.map((s) => (
            <button key={s.id} type="button" title={s.note} onClick={() => set({ design: reshapeEmailDesign(b.design, s.id as EmailDesignShape) })} className={`rounded-full px-3 py-1 text-[0.68rem] font-bold ${shape === s.id ? "bg-[var(--admin-accent)] text-black" : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1"><span className={LABEL}>Describe the picture (alt text)</span><Input value={b.alt} onChange={(e) => set({ alt: e.target.value })} placeholder="Greenway weekly: fresh drops and deals" /></label>
        <label className="block space-y-1"><span className={LABEL}>Link when tapped</span><Input value={b.href} onChange={(e) => set({ href: e.target.value })} placeholder="https://www.greenwaymarijuana.com/menu" /></label>
      </div>
      <label className="flex items-center gap-2 text-xs text-[var(--admin-text-muted)]">
        <input type="checkbox" checked={b.bleed} onChange={(e) => set({ bleed: e.target.checked })} className="h-4 w-4 accent-[var(--admin-accent)]" />
        Edge to edge (off = inside the margins, rounded corners)
      </label>

      {/* QR on the picture */}
      <div className="space-y-1 rounded-[var(--admin-radius-md)] border border-[var(--admin-border)] p-2">
        <span className={LABEL}>QR code on the picture</span>
        <div className="flex gap-2">
          <Input value={qrUrl} onChange={(e) => setQrUrl(e.target.value)} placeholder="https://…" />
          <Button type="button" size="sm" variant="neutral" onClick={addQr}>Add QR</Button>
        </div>
      </div>

      {/* Live rows under the picture */}
      <div className="space-y-2 rounded-[var(--admin-radius-md)] border border-[var(--admin-border)] p-2">
        <span className={LABEL}>Menu products (live rows under the picture, up to {DESIGN_MAX_PRODUCTS})</span>
        <div className="flex gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} placeholder="Search the menu: name or brand" />
          <Button type="button" size="sm" variant="neutral" disabled={pending || query.trim().length < 2} onClick={search}>Search</Button>
        </div>
        {hits ? (
          hits.length === 0 ? <p className="text-[11px] text-[var(--admin-text-faint)]">Nothing in stock matches.</p> : (
            <ul className="max-h-48 space-y-1 overflow-auto text-xs">
              {hits.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-8 w-8 rounded object-cover" /> : null}
                  <span className="flex-1 truncate">{p.name}<span className="ml-1 text-[var(--admin-text-faint)]">{p.brand} · {formatCents(p.priceCents)}</span></span>
                  <Button type="button" size="sm" variant="neutral" disabled={b.products.length >= DESIGN_MAX_PRODUCTS || b.products.some((x) => x.id === p.id)} onClick={() => set({ products: [...b.products, p] })}>Add row</Button>
                  <Button type="button" size="sm" variant="neutral" onClick={() => set({ design: putProductName(b.design, p), image: b.image || p.imageUrl })}>Name on picture</Button>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {b.products.map((p, i) => (
          <div key={p.id || i} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate text-[var(--admin-text)]">{p.name} <span className="text-[var(--admin-gold)]">{formatCents(p.priceCents)}</span></span>
            <button type="button" className="text-[var(--admin-orange)]" onClick={() => set({ products: b.products.filter((_, k) => k !== i) })}>Remove</button>
          </div>
        ))}
        <p className="text-[11px] text-[var(--admin-text-faint)]">Prices are live text in the email, not part of the picture, so they stay correct and readable.</p>
      </div>

      <label className="block space-y-1">
        <span className={LABEL}>Live countdown under the picture (optional, your computer&apos;s time)</span>
        <div className="flex gap-2">
          <Input type="datetime-local" value={toLocalInput(b.timerEndsAt)} onChange={(e) => set({ timerEndsAt: fromLocalInput(e.target.value) })} />
          {b.timerEndsAt ? <Button type="button" size="sm" variant="neutral" onClick={() => set({ timerEndsAt: "" })}>Clear</Button> : null}
        </div>
      </label>

      {issues.length ? (
        <ul className="space-y-0.5 text-[11px]">
          {issues.map((i, k) => <li key={k} className={i.level === "must-fix" ? "text-[var(--admin-orange)]" : "text-[var(--admin-text-muted)]"}>{i.level === "must-fix" ? "Must fix: " : "Heads-up: "}{i.text}</li>)}
        </ul>
      ) : null}
      {msg ? <p role="status" className={`text-xs ${msg.tone === "ok" ? "text-[var(--admin-accent)]" : "text-[var(--admin-orange)]"}`}>{msg.text}</p> : null}

      {/* Full-screen studio */}
      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Design studio" className="fixed inset-0 z-50 overflow-auto bg-black/90 p-4">
          <div className="mx-auto max-w-6xl space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-[var(--admin-text)]">Design studio · email section ({EMAIL_DESIGN_SHAPES.find((s) => s.id === shape)?.note})</p>
              <Button type="button" size="sm" variant="save" className="ml-auto" disabled={pending} onClick={savePicture}>{b.src ? "Update picture" : "Save picture"}</Button>
              <Button type="button" size="sm" variant="neutral" onClick={() => setOpen(false)}>Done</Button>
            </div>
            <BrandBannersRow design={b.design} imageSrc={b.image} onPick={(d) => set({ design: { ...d, enabled: true } })} />
            <BannerStudio design={b.design} onChange={(d) => set({ design: { ...d, enabled: true } })} legacy={{}} imageSrc={b.image} imageAlt={b.alt} posts={[]} mediaChoices={mediaChoices} />
            {msg ? <p role="status" className={`text-xs ${msg.tone === "ok" ? "text-[var(--admin-accent)]" : "text-[var(--admin-orange)]"}`}>{msg.text}</p> : null}
          </div>
        </div>
      ) : null}

      {/* Offscreen copy that becomes the picture */}
      {rendering ? (
        <div aria-hidden="true" style={{ position: "fixed", left: -20000, top: 0, pointerEvents: "none" }}>
          <div ref={holder} style={{ width: plan.renderW }}>
            <DesignedBanner design={frameHide ? designFrameAt(stillDesign(b.design), frameHide) : stillDesign(b.design)} imageSrc={b.image} imageAlt="" legacy={{}} frameClassName="" priority />
          </div>
        </div>
      ) : null}
    </div>
  );
}
