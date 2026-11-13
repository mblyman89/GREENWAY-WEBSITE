"use client";
/* eslint-disable @next/next/no-img-element -- previews of hosted email images (any host), not page images */

/**
 * NewsletterCanvasEditor — D238 N-8a (SOP-22 G-118, F-22-8, Q-22-5 (a)).
 *
 * The in-app newsletter canvas: sections on the left, a live email preview
 * (desktop or phone) on the right. The preview is the exact HTML that is
 * sent (rendered by the pure core), shown in a sandboxed frame with no
 * scripts. The send check runs live on every change (size against Gmail's
 * 102 KB clip, warnings, unsubscribe, buttons, QR, alt text) and in full
 * with "Run send check" (downloads every picture to weigh it). "Compress
 * images" re-encodes heavy pictures for email and swaps them in.
 *
 * The footer (the four warnings + unsubscribe) is fixed: it is added by the
 * renderer and is not a block, so it cannot be removed or edited here.
 */
import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Badge, Button, Input, Textarea, Select } from "@/components/admin/ui";
import {
  BLOCK_LABEL,
  BLOCK_TYPES,
  CARD_KIND_LABEL,
  blankBlock,
  canvasPlainText,
  checkCanvas,
  moveBlock,
  normalizeCanvas,
  renderCanvasEmail,
  GMAIL_CLIP_BYTES,
  type CanvasBlock,
  type CanvasBlockType,
  type CanvasCard,
  type CanvasCheck,
  type CanvasDoc,
  type RenderOpts,
} from "@/lib/cms/newsletter-canvas-core";
import {
  saveCanvasAction,
  checkCanvasAction,
  compressCanvasAction,
  makeQrAction,
  fillFromWeekAction,
  uploadCanvasImageAction,
  testSendCanvasAction,
} from "@/app/admin/newsletter/canvas/actions";
import { quoteIsCurated, reviewToCanvas, type CuratedReviewChoice } from "@/lib/cms/curated-reviews-core";
import { DesignSectionEditor } from "./DesignSectionEditor";

export type CanvasMediaChoice = { url: string; title: string };

const LABEL = "block text-[0.68rem] font-black uppercase tracking-[0.12em] text-[var(--admin-text-faint)]";

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

export function NewsletterCanvasEditor({
  postId,
  postTitle,
  initial,
  renderOpts,
  media,
  extraTools,
  reviews = [],
}: {
  postId: string;
  postTitle: string;
  initial: CanvasDoc;
  renderOpts: RenderOpts;
  media: CanvasMediaChoice[];
  /** D239 N-9 (Q-22-2 (a)): curated reviews with the permission tick. */
  reviews?: CuratedReviewChoice[];
  /** N-8b/N-8c slot: the AI studio and motion tools render here. */
  extraTools?: (api: { doc: CanvasDoc; setDoc: (d: CanvasDoc) => void; selected: CanvasBlock | null; update: (b: CanvasBlock) => void }) => ReactNode;
}) {
  const [doc, setDocRaw] = useState<CanvasDoc>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial.blocks[0]?.id ?? null);
  const [view, setView] = useState<"desktop" | "phone" | "text">("desktop");
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [fullCheck, setFullCheck] = useState<CanvasCheck | null>(null);
  const [testTo, setTestTo] = useState("");
  const [addType, setAddType] = useState<CanvasBlockType>("text");
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<{ blockId: string; card?: number } | null>(null);

  // Typing is kept as typed (so spaces at the end survive); the preview, the
  // check and every save use the cleaned copy.
  const setDoc = (d: CanvasDoc) => {
    setDocRaw(d);
    setDirty(true);
    setFullCheck(null);
  };
  const clean = useMemo(() => normalizeCanvas(doc), [doc]);
  const html = useMemo(() => renderCanvasEmail(clean, renderOpts), [clean, renderOpts]);
  const text = useMemo(() => canvasPlainText(clean, renderOpts), [clean, renderOpts]);
  const live = useMemo(() => checkCanvas(clean, html, text), [clean, html, text]);
  const check = fullCheck ?? live;
  const selected = doc.blocks.find((b) => b.id === selectedId) ?? null;

  const update = (b: CanvasBlock) => setDoc({ ...doc, blocks: doc.blocks.map((x) => (x.id === b.id ? b : x)) });
  const remove = (id: string) => {
    setDoc({ ...doc, blocks: doc.blocks.filter((b) => b.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };
  const add = () => {
    const b = blankBlock(addType);
    const i = selected ? doc.blocks.findIndex((x) => x.id === selected.id) + 1 : doc.blocks.length;
    const blocks = doc.blocks.slice();
    blocks.splice(i, 0, b);
    setDoc({ ...doc, blocks });
    setSelectedId(b.id);
  };

  const run = (fn: () => Promise<void>) => start(async () => {
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "Something went wrong." });
    }
  });

  const save = () => run(async () => {
    const r = await saveCanvasAction(postId, doc);
    if (!r.ok) return setMsg({ tone: "err", text: r.error });
    setDocRaw(r.doc);
    setDirty(false);
    setMsg({ tone: "ok", text: r.notice ?? "Saved." });
  });
  const runCheck = () => run(async () => {
    const r = await checkCanvasAction(postId, doc);
    if (!r.ok) return setMsg({ tone: "err", text: r.error });
    setFullCheck(r.check);
    setMsg({ tone: r.check.ok ? "ok" : "err", text: r.check.ok ? "Ready to send." : "Fix the must-fix items below." });
  });
  const compress = () => run(async () => {
    const r = await compressCanvasAction(postId, doc);
    if (!r.ok) return setMsg({ tone: "err", text: r.error });
    setDocRaw(r.doc);
    setFullCheck(r.check);
    setDirty(false);
    const saved = r.changed.reduce((a, c) => a + c.before - c.after, 0);
    setMsg({ tone: r.errors.length ? "err" : "ok", text: r.changed.length ? `Compressed ${r.changed.length} picture(s), ${kb(saved)} lighter. Saved.${r.errors.length ? ` Problems: ${r.errors.join("; ")}` : ""}` : "Every picture is already light enough." });
  });
  const fill = () => run(async () => {
    const r = await fillFromWeekAction(postId, doc);
    if (!r.ok) return setMsg({ tone: "err", text: r.error });
    setDoc(r.doc);
    setMsg({ tone: "ok", text: r.filled ? `Filled ${r.filled} section(s) from this week. Review, then Save.${r.partial ? " (Some of the week could not be read.)" : ""}` : "Nothing new to fill (only empty card sections are filled)." });
  });
  const testSend = () => run(async () => {
    const r = await testSendCanvasAction(postId, doc, testTo);
    setMsg(r.ok ? { tone: "ok", text: `Test sent to ${testTo}.` } : { tone: "err", text: r.error });
  });
  const makeQr = (b: Extract<CanvasBlock, { type: "qr" }>) => run(async () => {
    const r = await makeQrAction(b.url);
    if (!r.ok) return setMsg({ tone: "err", text: r.error });
    update({ ...b, src: r.src });
    setMsg({ tone: "ok", text: "QR code made. Scan the preview with your phone to try it." });
  });
  const pickFile = (blockId: string, card?: number) => {
    uploadTarget.current = { blockId, card };
    fileRef.current?.click();
  };
  const onFile = (f: File | undefined) => {
    const t = uploadTarget.current;
    if (!f || !t) return;
    run(async () => {
      const fd = new FormData();
      fd.set("file", f);
      const r = await uploadCanvasImageAction(fd);
      if (!r.ok) return setMsg({ tone: "err", text: r.error });
      const b = doc.blocks.find((x) => x.id === t.blockId);
      if (!b) return;
      if (b.type === "image") update({ ...b, src: r.src });
      if (b.type === "cards" && t.card != null) update({ ...b, cards: b.cards.map((c, i) => (i === t.card ? { ...c, imageUrl: r.src } : c)) });
      setMsg({ tone: "ok", text: r.mime === "image/gif" ? "Moving GIF added. Remember: Outlook for Windows shows only its first frame." : "Picture added." });
    });
  };

  const mustFix = check.issues.filter((i) => i.level === "must-fix");
  const headsUp = check.issues.filter((i) => i.level === "heads-up");
  const pct = Math.min(100, Math.round((check.htmlBytes / GMAIL_CLIP_BYTES) * 100));

  return (
    <div className="space-y-4" data-testid="newsletter-canvas">
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
        <Button type="button" variant="save" size="sm" onClick={save} disabled={pending}>{dirty ? "Save" : "Saved"}</Button>
        <Button type="button" variant="neutral" size="sm" onClick={fill} disabled={pending}>Fill from this week</Button>
        <Button type="button" variant="neutral" size="sm" onClick={runCheck} disabled={pending}>Run send check</Button>
        <Button type="button" variant="neutral" size="sm" onClick={compress} disabled={pending}>Compress images</Button>
        <span className="mx-1 h-5 w-px bg-[var(--admin-border)]" />
        <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" type="email" className="w-52" />
        <Button type="button" variant="confirm" size="sm" onClick={testSend} disabled={pending || !testTo}>Send test</Button>
        {pending ? <span className="text-xs text-[var(--admin-text-faint)]">Working…</span> : null}
      </div>
      {msg ? (
        <p role="status" className={`rounded-[var(--admin-radius-md)] px-3 py-2 text-xs ${msg.tone === "ok" ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]"}`}>{msg.text}</p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Left: settings, blocks, block editor */}
        <div className="space-y-4">
          <div className="grid gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 sm:grid-cols-2">
            <Row label={`Subject (${doc.subject.length}/60 shows on phones)`}>
              <Input value={doc.subject} onChange={(e) => setDoc({ ...doc, subject: e.target.value })} placeholder={`Greenway Marijuana: ${postTitle}`} />
            </Row>
            <Row label="Preheader (grey line after the subject)">
              <Input value={doc.preheader} onChange={(e) => setDoc({ ...doc, preheader: e.target.value })} placeholder="Fresh drops, two deals and our hours" />
            </Row>
            <Row label="Look">
              <Select value={doc.theme} onChange={(e) => setDoc({ ...doc, theme: e.target.value === "light" ? "light" : "dark" })}>
                <option value="dark">Dark (Greenway black)</option>
                <option value="light">Light</option>
              </Select>
            </Row>
            <label className="flex items-center gap-2 self-end text-xs text-[var(--admin-text-muted)]">
              <input type="checkbox" checked={doc.useForEmail} onChange={(e) => setDoc({ ...doc, useForEmail: e.target.checked })} className="h-4 w-4 accent-[var(--admin-accent)]" />
              Send this canvas as the email (off = send the PDF announcement)
            </label>
          </div>

          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-[var(--admin-text)]">Sections</p>
              <Select value={addType} onChange={(e) => setAddType(e.target.value as CanvasBlockType)} className="ml-auto w-auto">
                {BLOCK_TYPES.map((t) => <option key={t} value={t}>{BLOCK_LABEL[t]}</option>)}
              </Select>
              <Button type="button" size="sm" variant="neutral" onClick={add}>Add</Button>
            </div>
            <ol className="space-y-1.5">
              {doc.blocks.map((b, i) => (
                <li key={b.id} className={`flex items-center gap-2 rounded-[var(--admin-radius-md)] border px-3 py-2 text-xs ${b.id === selectedId ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]" : "border-[var(--admin-border)]"}`}>
                  <button type="button" className="flex-1 text-left text-[var(--admin-text)]" onClick={() => setSelectedId(b.id)}>
                    <span className="font-semibold">{BLOCK_LABEL[b.type].split(" (")[0]}</span>
                    <span className="ml-2 text-[var(--admin-text-faint)]">{summary(b)}</span>
                    {check.issues.some((x) => x.blockId === b.id && x.level === "must-fix") ? <Badge tone="danger" className="ml-2">fix</Badge> : null}
                  </button>
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => setDoc({ ...doc, blocks: moveBlock(doc.blocks, b.id, -1) })} className="px-1 disabled:opacity-30">↑</button>
                  <button type="button" aria-label="Move down" disabled={i === doc.blocks.length - 1} onClick={() => setDoc({ ...doc, blocks: moveBlock(doc.blocks, b.id, 1) })} className="px-1 disabled:opacity-30">↓</button>
                  <button type="button" aria-label="Remove" onClick={() => remove(b.id)} className="px-1 text-[var(--admin-orange)]">✕</button>
                </li>
              ))}
              <li className="rounded-[var(--admin-radius-md)] border border-dashed border-[var(--admin-border)] px-3 py-2 text-xs text-[var(--admin-text-faint)]">
                Footer (fixed): the four required warnings and the unsubscribe link. Always added; cannot be removed.
              </li>
            </ol>
          </div>

          {selected ? (
            <div className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <p className="text-sm font-semibold text-[var(--admin-text)]">{BLOCK_LABEL[selected.type]}</p>
              {selected.type === "design" ? (
                <DesignSectionEditor key={selected.id} b={selected} update={update} media={media} title={doc.subject || postTitle} />
              ) : (
                <BlockFields b={selected} update={update} media={media} pickFile={pickFile} makeQr={makeQr} pending={pending} reviews={reviews} />
              )}
            </div>
          ) : null}

          {extraTools ? extraTools({ doc, setDoc, selected, update }) : null}
        </div>

        {/* Right: preview + checks */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {(["desktop", "phone", "text"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`rounded-full px-3 py-1 text-[0.68rem] font-black uppercase tracking-[0.1em] ${view === v ? "bg-[var(--admin-accent)] text-black" : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]"}`}>
                {v === "text" ? "Plain text" : v}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-[var(--admin-text-faint)]">The preview shows a sample unsubscribe link.</span>
          </div>
          <div className="flex justify-center rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
            {view === "text" ? (
              <pre className="max-h-[720px] w-full overflow-auto whitespace-pre-wrap p-3 text-xs text-[var(--admin-text-muted)]">{text}</pre>
            ) : (
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={html}
                className="h-[720px] rounded-[var(--admin-radius-md)] border-0 bg-white"
                style={{ width: view === "phone" ? 380 : "100%" }}
              />
            )}
          </div>

          <div className="space-y-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4" data-testid="canvas-send-check">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-[var(--admin-text)]">Send check</p>
              <Badge tone={check.ok ? "green" : "danger"}>{check.ok ? "Ready to send" : `${mustFix.length} to fix`}</Badge>
              <span className="text-[11px] text-[var(--admin-text-faint)]">{fullCheck ? "Full check (pictures weighed)" : "Live check (press Run send check to weigh pictures)"}</span>
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-[var(--admin-text-faint)]">
                <span>Email size {kb(check.htmlBytes)} of Gmail&apos;s 102 KB limit</span>
                <span>{check.imageCount} picture(s){fullCheck ? `, ${kb(check.imageBytes)}` : ""}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
                <div className={`h-full ${pct >= 100 ? "bg-[var(--admin-danger,#e5484d)]" : pct >= 88 ? "bg-[var(--admin-gold)]" : "bg-[var(--admin-accent)]"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
            <ul className="space-y-1 text-xs">
              {mustFix.map((i, k) => <li key={`m${k}`} className="text-[var(--admin-orange)]">Must fix: {i.text}</li>)}
              {headsUp.map((i, k) => <li key={`h${k}`} className="text-[var(--admin-text-muted)]">Heads-up: {i.text}</li>)}
              {check.issues.length === 0 ? <li className="text-[var(--admin-accent)]">No problems found.</li> : null}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function summary(b: CanvasBlock): string {
  switch (b.type) {
    case "header": return b.tagline;
    case "headline": return b.text;
    case "text": return b.text.slice(0, 40);
    case "image": return b.src ? (b.alt || "picture") : "no picture yet";
    case "button": return b.label;
    case "qr": return b.url || "no link yet";
    case "cards": return `${CARD_KIND_LABEL[b.kind]} · ${b.cards.length} card(s)`;
    case "review": return b.name || b.quote.slice(0, 30);
    case "hours": return "from the store info";
    case "spacer": return `${b.height}px`;
    case "countdown": return b.endsAt ? `ends ${b.endsAt.slice(0, 16).replace("T", " ")} UTC` : "no end time";
    case "poll": return `${b.question.slice(0, 30)} · ${b.options.length} answers`;
    case "design": return !b.src ? "no picture yet" : b.alt || "picture";
    case "overlay": return b.heading || (b.src ? "picture" : "no picture yet");
    case "columns": return `${b.items.length} columns`;
    default: return "";
  }
}

/** ISO (UTC) to the value of a datetime-local box, in this computer's time. */
function toLocalInput(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string): string {
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function MediaPick({ media, onPick }: { media: CanvasMediaChoice[]; onPick: (url: string) => void }) {
  if (media.length === 0) return null;
  return (
    <Select value="" onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">Pick from the media library…</option>
      {media.map((m) => <option key={m.url} value={m.url}>{m.title}</option>)}
    </Select>
  );
}

function BlockFields({
  b,
  update,
  media,
  pickFile,
  makeQr,
  pending,
  reviews,
}: {
  b: CanvasBlock;
  update: (b: CanvasBlock) => void;
  media: CanvasMediaChoice[];
  pickFile: (blockId: string, card?: number) => void;
  makeQr: (b: Extract<CanvasBlock, { type: "qr" }>) => void;
  pending: boolean;
  reviews: CuratedReviewChoice[];
}) {
  switch (b.type) {
    case "header":
      return <Row label="Small line under the name"><Input value={b.tagline} onChange={(e) => update({ ...b, tagline: e.target.value })} /></Row>;
    case "headline":
      return (
        <>
          <Row label="Headline"><Input value={b.text} onChange={(e) => update({ ...b, text: e.target.value })} /></Row>
          <Row label="Sub line"><Input value={b.sub} onChange={(e) => update({ ...b, sub: e.target.value })} /></Row>
          <Row label={`Size ${b.size}px`}><input type="range" min={18} max={40} value={b.size} onChange={(e) => update({ ...b, size: Number(e.target.value) })} className="w-full" /></Row>
        </>
      );
    case "text":
      return (
        <>
          <Row label="Text (blank line = new paragraph; [words](https://link) for a link; **bold**)">
            <Textarea rows={6} value={b.text} onChange={(e) => update({ ...b, text: e.target.value })} />
          </Row>
          <Row label="Align">
            <Select value={b.align} onChange={(e) => update({ ...b, align: e.target.value === "center" ? "center" : "left" })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
            </Select>
          </Row>
        </>
      );
    case "image":
      return (
        <>
          {b.src ? <img src={b.src} alt={b.alt} className="max-h-40 rounded border border-[var(--admin-border)]" /> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="neutral" onClick={() => pickFile(b.id)} disabled={pending}>Upload picture or GIF</Button>
          </div>
          <MediaPick media={media} onPick={(url) => update({ ...b, src: url })} />
          <Row label="Picture link"><Input value={b.src} onChange={(e) => update({ ...b, src: e.target.value })} placeholder="https://…" /></Row>
          <Row label="Describe the picture (alt text)"><Input value={b.alt} onChange={(e) => update({ ...b, alt: e.target.value })} /></Row>
          <Row label="Clicks go to (optional)"><Input value={b.href} onChange={(e) => update({ ...b, href: e.target.value })} placeholder="https://www.greenwaymarijuana.com/menu" /></Row>
          <Row label="Caption (optional)"><Input value={b.caption} onChange={(e) => update({ ...b, caption: e.target.value })} /></Row>
          <Row label={`Width ${b.width}px`}><input type="range" min={120} max={600} step={10} value={b.width} onChange={(e) => update({ ...b, width: Number(e.target.value) })} className="w-full" /></Row>
        </>
      );
    case "button":
      return (
        <>
          <Row label="Words"><Input value={b.label} onChange={(e) => update({ ...b, label: e.target.value })} /></Row>
          <Row label="Link"><Input value={b.href} onChange={(e) => update({ ...b, href: e.target.value })} placeholder="https://www.greenwaymarijuana.com/menu" /></Row>
          <Row label="Colour">
            <Select value={b.color} onChange={(e) => update({ ...b, color: e.target.value as "accent" | "gold" | "white" })}>
              <option value="accent">Green</option>
              <option value="gold">Gold</option>
              <option value="white">White</option>
            </Select>
          </Row>
        </>
      );
    case "qr":
      return (
        <>
          <Row label="Link the code opens"><Input value={b.url} onChange={(e) => update({ ...b, url: e.target.value, src: "" })} placeholder="https://www.greenwaymarijuana.com/specials" /></Row>
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" variant="neutral" onClick={() => makeQr(b)} disabled={pending || !b.url}>Make QR</Button>
            {b.src ? <img src={b.src} alt="QR code" className="h-20 w-20 rounded bg-white p-1" /> : null}
          </div>
          <Row label="Caption"><Input value={b.caption} onChange={(e) => update({ ...b, caption: e.target.value })} placeholder="Scan at the counter for this week's deal" /></Row>
          <Row label={`Size ${b.size}px`}><input type="range" min={100} max={300} step={10} value={b.size} onChange={(e) => update({ ...b, size: Number(e.target.value) })} className="w-full" /></Row>
          <p className="text-[11px] text-[var(--admin-text-faint)]">Links to our own site get newsletter tracking tags, so visits from the code show in analytics.</p>
        </>
      );
    case "cards":
      return <CardsFields b={b} update={update} media={media} pickFile={pickFile} pending={pending} />;
    case "review":
      return (
        <>
          {/* D239 N-9 (Q-22-2 (a)): pick from the Curated reviews list (permission ticked). */}
          {reviews.length > 0 ? (
            <Select value="" onChange={(e) => { const r = reviews.find((x) => x.id === e.target.value); if (r) update({ ...b, ...reviewToCanvas(r) }); }} data-testid="canvas-review-pick">
              <option value="">Pick a curated review…</option>
              {reviews.map((r) => <option key={r.id} value={r.id}>{`${r.firstName}: ${r.quote.slice(0, 70)}${r.quote.length > 70 ? "…" : ""}`}</option>)}
            </Select>
          ) : (
            <p className="text-[11px] text-[var(--admin-text-faint)]">No curated reviews yet. Add them (with the customer&apos;s permission) in Blog &amp; Newsletter &gt; Curated reviews.</p>
          )}
          {b.quote.trim() && !quoteIsCurated(b.quote, reviews) ? (
            <p className="text-[11px] text-[var(--admin-orange)]">This quote is not in the Curated reviews list. Only use a review the customer said we may quote.</p>
          ) : null}
          <Row label="Quote (only with the reviewer's permission)"><Textarea rows={3} value={b.quote} onChange={(e) => update({ ...b, quote: e.target.value })} /></Row>
          <Row label="First name"><Input value={b.name} onChange={(e) => update({ ...b, name: e.target.value })} /></Row>
          <Row label="Google review link (optional)"><Input value={b.href} onChange={(e) => update({ ...b, href: e.target.value })} /></Row>
        </>
      );
    case "hours":
      return <Row label="Extra note (holiday hours etc.)"><Input value={b.note} onChange={(e) => update({ ...b, note: e.target.value })} /></Row>;
    case "spacer":
      return <Row label={`Height ${b.height}px`}><input type="range" min={8} max={80} value={b.height} onChange={(e) => update({ ...b, height: Number(e.target.value) })} className="w-full" /></Row>;
    case "countdown":
      return (
        <>
          <Row label="Ends at (your computer's time)"><Input type="datetime-local" value={toLocalInput(b.endsAt)} onChange={(e) => update({ ...b, endsAt: fromLocalInput(e.target.value) })} /></Row>
          <Row label="Words above the timer"><Input value={b.label} onChange={(e) => update({ ...b, label: e.target.value })} placeholder="The deal ends in" /></Row>
          <Row label="Link when tapped (optional)"><Input value={b.href} onChange={(e) => update({ ...b, href: e.target.value })} placeholder="https://www.greenwaymarijuana.com/specials" /></Row>
          <p className="text-[11px] text-[var(--admin-text-faint)]">The timer is drawn by our site each time the email is opened, so it always shows the real time left. Outlook for Windows shows it still; the end time is printed under it.</p>
        </>
      );
    case "poll":
      return (
        <>
          <Row label="Question"><Input value={b.question} onChange={(e) => update({ ...b, question: e.target.value })} /></Row>
          {b.options.map((opt, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1"><Row label={`Answer ${i + 1}`}><Input value={opt} onChange={(e) => update({ ...b, options: b.options.map((x, k) => (k === i ? e.target.value : x)) })} /></Row></div>
              <Button type="button" variant="neutral" size="sm" disabled={b.options.length <= 2} onClick={() => update({ ...b, options: b.options.filter((_, k) => k !== i) })}>Remove</Button>
            </div>
          ))}
          {b.options.length < 4 ? <Button type="button" variant="neutral" size="sm" onClick={() => update({ ...b, options: [...b.options, `Option ${b.options.length + 1}`] })}>Add an answer</Button> : null}
          <Row label="Page a vote opens (our site)"><Input value={b.href} onChange={(e) => update({ ...b, href: e.target.value })} placeholder="https://www.greenwaymarijuana.com/menu" /></Row>
          <p className="text-[11px] text-[var(--admin-text-faint)]">Each answer is a tracked link: a tap is a vote. Results show in Clicks by section below once it is sent.</p>
        </>
      );
    default:
      return <p className="text-xs text-[var(--admin-text-faint)]">Nothing to set.</p>;
  }
}

function CardsFields({
  b,
  update,
  media,
  pickFile,
  pending,
}: {
  b: Extract<CanvasBlock, { type: "cards" }>;
  update: (b: CanvasBlock) => void;
  media: CanvasMediaChoice[];
  pickFile: (blockId: string, card?: number) => void;
  pending: boolean;
}) {
  const setCard = (i: number, c: CanvasCard) => update({ ...b, cards: b.cards.map((x, k) => (k === i ? c : x)) });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Heading"><Input value={b.heading} onChange={(e) => update({ ...b, heading: e.target.value })} /></Row>
        <Row label="Layout">
          <Select value={String(b.columns)} onChange={(e) => update({ ...b, columns: e.target.value === "2" ? 2 : 1 })}>
            <option value="1">One per row</option>
            <option value="2">Two per row (stacks on phones)</option>
          </Select>
        </Row>
      </div>
      {b.cards.map((c, i) => (
        <div key={i} className="space-y-2 rounded-[var(--admin-radius-md)] border border-[var(--admin-border)] p-3">
          <div className="flex items-center gap-2">
            <span className={LABEL}>Card {i + 1}</span>
            <button type="button" className="ml-auto text-xs text-[var(--admin-orange)]" onClick={() => update({ ...b, cards: b.cards.filter((_, k) => k !== i) })}>Remove</button>
          </div>
          <Input value={c.title} onChange={(e) => setCard(i, { ...c, title: e.target.value })} placeholder="Title" />
          <Textarea rows={2} value={c.text} onChange={(e) => setCard(i, { ...c, text: e.target.value })} placeholder="Short text" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={c.href} onChange={(e) => setCard(i, { ...c, href: e.target.value })} placeholder="Link https://…" />
            <Input value={c.cta} onChange={(e) => setCard(i, { ...c, cta: e.target.value })} placeholder="Link words (Take a look)" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {c.imageUrl ? <img src={c.imageUrl} alt={c.imageAlt} className="h-12 rounded" /> : null}
            <Button type="button" size="sm" variant="neutral" onClick={() => pickFile(b.id, i)} disabled={pending}>Upload picture</Button>
            <div className="min-w-48 flex-1"><MediaPick media={media} onPick={(url) => setCard(i, { ...c, imageUrl: url })} /></div>
          </div>
          {c.imageUrl ? <Input value={c.imageAlt} onChange={(e) => setCard(i, { ...c, imageAlt: e.target.value })} placeholder="Describe the picture" /> : null}
        </div>
      ))}
      <Button type="button" size="sm" variant="neutral" onClick={() => update({ ...b, cards: [...b.cards, { title: "New card", text: "", imageUrl: "", imageAlt: "", href: "", cta: "" }] })}>Add card</Button>
    </>
  );
}
