"use client";
/* eslint-disable @next/next/no-img-element -- previews of hosted email images (any host), not page images */

/**
 * CanvasStudioParts — D243 E-3 (SOP-22 G-123): the pieces of the full-page
 * newsletter editor. Section library (click to add), templates, saved
 * sections, the style panel (background, words colour, padding, corners),
 * fields for Columns and Picture-with-words, and the inbox mockups (Gmail
 * phone and desktop, iPhone Mail).
 *
 * Owner (D243): "I want the website editors plus all the above plus more."
 */
import { useState, type ReactNode } from "react";
import { Button, Input, Select, Textarea } from "@/components/admin/ui";
import { BLOCK_LABEL, BLOCK_TYPES, THEMES, type CanvasBlock, type CanvasBlockType, type CanvasTheme } from "@/lib/cms/newsletter-canvas-core";
import { blankColumn, OVERLAY_MAX_H, OVERLAY_MIN_H } from "@/lib/cms/newsletter-layout-core";
import { cleanSectionStyle, contrastOf, defaultStyle, SECTION_PADS, STYLE_SWATCHES, styledColors, type SectionPad, type SectionStyle } from "@/lib/cms/newsletter-style-core";
import { NEWSLETTER_TEMPLATES, type InboxLines, type SavedSection, type TemplateId } from "@/lib/cms/newsletter-templates-core";

export type MediaChoice = { url: string; title: string };

const LABEL = "block text-[0.68rem] font-black uppercase tracking-[0.12em] text-[var(--admin-text-faint)]";
const PANEL = "rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

function MediaPick({ media, onPick }: { media: MediaChoice[]; onPick: (url: string) => void }) {
  if (media.length === 0) return null;
  return (
    <Select value="" onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">Pick from the media library…</option>
      {media.map((m) => <option key={m.url} value={m.url}>{m.title}</option>)}
    </Select>
  );
}

const ICON: Partial<Record<CanvasBlockType, string>> = {
  header: "▭", headline: "H", text: "¶", design: "✦", overlay: "▣", columns: "▥", image: "🖼", button: "⬭", qr: "▦",
  cards: "▤", review: "❝", hours: "◷", divider: "—", spacer: "↕", countdown: "⏱", poll: "✓",
};

// ── Library ────────────────────────────────────────────────────────────────

export function SectionLibrary({
  onAdd,
  onTemplate,
  saved,
  onUseSaved,
  onDeleteSaved,
  pending,
}: {
  onAdd: (t: CanvasBlockType) => void;
  onTemplate: (id: TemplateId) => void;
  saved: SavedSection[] | null;
  onUseSaved: (s: SavedSection) => void;
  onDeleteSaved: (s: SavedSection) => void;
  pending: boolean;
}) {
  const [tab, setTab] = useState<"add" | "templates" | "saved">("add");
  return (
    <div className={`${PANEL} space-y-3`} data-testid="canvas-library">
      <div className="flex gap-1">
        {(["add", "templates", "saved"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`flex-1 rounded-full px-2 py-1 text-[0.65rem] font-black uppercase tracking-[0.1em] ${tab === t ? "bg-[var(--admin-accent)] text-black" : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]"}`}>
            {t === "add" ? "Add" : t === "templates" ? "Templates" : "Saved"}
          </button>
        ))}
      </div>
      {tab === "add" ? (
        <div className="grid grid-cols-2 gap-1.5">
          {BLOCK_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/gw-new", t)}
              onClick={() => onAdd(t)}
              title={BLOCK_LABEL[t]}
              className="flex items-center gap-1.5 rounded-[var(--admin-radius-md)] border border-[var(--admin-border)] px-2 py-2 text-left text-[11px] text-[var(--admin-text)] hover:border-[var(--admin-accent)] hover:bg-[var(--admin-accent-soft)]"
            >
              <span aria-hidden className="w-4 text-center text-[var(--admin-accent)]">{ICON[t] ?? "+"}</span>
              <span className="truncate">{BLOCK_LABEL[t].split(" (")[0]}</span>
            </button>
          ))}
          <p className="col-span-2 text-[10px] text-[var(--admin-text-faint)]">Click to add below the selected section, or drag onto the section list.</p>
        </div>
      ) : null}
      {tab === "templates" ? (
        <ul className="space-y-1.5">
          {NEWSLETTER_TEMPLATES.map((t) => (
            <li key={t.id}>
              <button type="button" disabled={pending} onClick={() => onTemplate(t.id)} className="w-full rounded-[var(--admin-radius-md)] border border-[var(--admin-border)] px-3 py-2 text-left hover:border-[var(--admin-accent)] disabled:opacity-50" data-testid={`canvas-template-${t.id}`}>
                <span className="block text-xs font-semibold text-[var(--admin-text)]">{t.label}</span>
                <span className="block text-[11px] text-[var(--admin-text-faint)]">{t.note}</span>
              </button>
            </li>
          ))}
          <li className="text-[10px] text-[var(--admin-text-faint)]">A template replaces the sections (Undo brings them back). Words starting with &quot;Replace:&quot; must be written before it can be sent.</li>
        </ul>
      ) : null}
      {tab === "saved" ? (
        saved === null ? (
          <p className="text-xs text-[var(--admin-text-faint)]">Loading…</p>
        ) : saved.length === 0 ? (
          <p className="text-xs text-[var(--admin-text-faint)]">No saved sections yet. Select a section and press Save as section to reuse it in any newsletter.</p>
        ) : (
          <ul className="space-y-1.5">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-[var(--admin-radius-md)] border border-[var(--admin-border)] px-3 py-2 text-xs">
                <button type="button" className="flex-1 text-left" onClick={() => onUseSaved(s)} disabled={pending}>
                  <span className="font-semibold text-[var(--admin-text)]">{s.name}</span>
                  <span className="ml-2 text-[var(--admin-text-faint)]">{BLOCK_LABEL[s.block.type].split(" (")[0]}</span>
                </button>
                <button type="button" aria-label={`Delete ${s.name}`} onClick={() => onDeleteSaved(s)} disabled={pending} className="px-1 text-[var(--admin-orange)]">✕</button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

// ── Style panel ────────────────────────────────────────────────────────────

function Swatches({ value, onPick, allowNone }: { value: string; onPick: (hex: string) => void; allowNone: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => onPick("")} className={`rounded-full border px-2 py-0.5 text-[10px] ${value === "" ? "border-[var(--admin-accent)] text-[var(--admin-accent)]" : "border-[var(--admin-border)] text-[var(--admin-text-faint)]"}`}>{allowNone}</button>
      {STYLE_SWATCHES.map((s) => (
        <button key={s.hex} type="button" title={s.label} aria-label={s.label} onClick={() => onPick(s.hex)} className={`h-6 w-6 rounded-full border-2 ${value === s.hex ? "border-[var(--admin-accent)]" : "border-[var(--admin-border)]"}`} style={{ background: s.hex }} />
      ))}
      <input type="color" aria-label="Any colour" value={value || "#000000"} onChange={(e) => onPick(e.target.value)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
    </div>
  );
}

export function StylePanel({ b, update, theme }: { b: CanvasBlock; update: (b: CanvasBlock) => void; theme: CanvasTheme }) {
  const s: SectionStyle = b.style ?? defaultStyle();
  const set = (patch: Partial<SectionStyle>) => {
    const next = cleanSectionStyle({ ...s, ...patch });
    const { style: _old, ...rest } = b;
    void _old;
    update((next ? { ...rest, style: next } : rest) as CanvasBlock);
  };
  const c = styledColors(THEMES[theme], b.style);
  const ratio = contrastOf(c.text, c.card);
  return (
    <div className="space-y-3 rounded-[var(--admin-radius-md)] border border-[var(--admin-border)] p-3" data-testid="canvas-style-panel">
      <div className="flex items-center gap-2">
        <span className={LABEL}>Section style</span>
        {b.style ? <button type="button" className="ml-auto text-[11px] text-[var(--admin-orange)]" onClick={() => { const { style: _x, ...rest } = b; void _x; update(rest as CanvasBlock); }}>Reset</button> : null}
      </div>
      <Row label="Background"><Swatches value={s.bg} onPick={(hex) => set({ bg: hex })} allowNone="Look" /></Row>
      <Row label="Words colour"><Swatches value={s.text} onPick={(hex) => set({ text: hex })} allowNone="Auto" /></Row>
      <Row label="Links and buttons"><Swatches value={s.accent} onPick={(hex) => set({ accent: hex })} allowNone="Green" /></Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Space above and below">
          <Select value={s.pad} onChange={(e) => set({ pad: e.target.value as SectionPad })}>
            {SECTION_PADS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Row>
        <div className="flex flex-col justify-end gap-1 text-xs text-[var(--admin-text-muted)]">
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.round} onChange={(e) => set({ round: e.target.checked })} className="accent-[var(--admin-accent)]" /> Rounded box</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.border} onChange={(e) => set({ border: e.target.checked })} className="accent-[var(--admin-accent)]" /> Thin border</label>
        </div>
      </div>
      {b.style ? (
        <p className={`text-[11px] ${ratio >= 4.5 ? "text-[var(--admin-accent)]" : "text-[var(--admin-orange)]"}`}>
          Readability {ratio.toFixed(1)}:1 {ratio >= 4.5 ? "(good)" : "(hard to read; aim for 4.5:1)"}
        </p>
      ) : null}
    </div>
  );
}

// ── Columns and Picture-with-words fields ─────────────────────────────────

export function ColumnsFieldsEditor({ b, update, media, pickFile, pending }: { b: Extract<CanvasBlock, { type: "columns" }>; update: (b: CanvasBlock) => void; media: MediaChoice[]; pickFile: (blockId: string, card?: number) => void; pending: boolean }) {
  const setItem = (i: number, patch: Partial<(typeof b.items)[number]>) => update({ ...b, items: b.items.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Columns">
          <Select value={String(b.items.length)} onChange={(e) => update({ ...b, items: e.target.value === "3" ? [...b.items, blankColumn(2)].slice(0, 3) : b.items.slice(0, 2) })}>
            <option value="2">Two</option>
            <option value="3">Three</option>
          </Select>
        </Row>
        <Row label="Align">
          <Select value={b.align} onChange={(e) => update({ ...b, align: e.target.value === "left" ? "left" : "center" })}>
            <option value="center">Center</option>
            <option value="left">Left</option>
          </Select>
        </Row>
      </div>
      {b.items.map((c, i) => (
        <div key={i} className="space-y-2 rounded-[var(--admin-radius-md)] border border-[var(--admin-border)] p-3">
          <span className={LABEL}>Column {i + 1}</span>
          <Input value={c.title} onChange={(e) => setItem(i, { title: e.target.value })} placeholder="Title" />
          <Textarea rows={2} value={c.text} onChange={(e) => setItem(i, { text: e.target.value })} placeholder="Short text ([words](https://link), **bold**)" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={c.href} onChange={(e) => setItem(i, { href: e.target.value })} placeholder="Link https://…" />
            <Input value={c.cta} onChange={(e) => setItem(i, { cta: e.target.value })} placeholder="Link words (Take a look)" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {c.imageUrl ? <img src={c.imageUrl} alt={c.imageAlt} className="h-12 rounded" /> : null}
            <Button type="button" size="sm" variant="neutral" onClick={() => pickFile(b.id, i)} disabled={pending}>Upload picture</Button>
            <div className="min-w-40 flex-1"><MediaPick media={media} onPick={(url) => setItem(i, { imageUrl: url })} /></div>
            {c.imageUrl ? <button type="button" className="text-[11px] text-[var(--admin-orange)]" onClick={() => setItem(i, { imageUrl: "" })}>Remove picture</button> : null}
          </div>
          {c.imageUrl ? <Input value={c.imageAlt} onChange={(e) => setItem(i, { imageAlt: e.target.value })} placeholder="Describe the picture" /> : null}
        </div>
      ))}
      <p className="text-[11px] text-[var(--admin-text-faint)]">Columns sit side by side on computers and stack on phones.</p>
    </>
  );
}

export function OverlayFieldsEditor({ b, update, media, pickFile, pending }: { b: Extract<CanvasBlock, { type: "overlay" }>; update: (b: CanvasBlock) => void; media: MediaChoice[]; pickFile: (blockId: string, card?: number) => void; pending: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {b.src ? <img src={b.src} alt={b.alt} className="h-16 rounded" /> : null}
        <Button type="button" size="sm" variant="neutral" onClick={() => pickFile(b.id)} disabled={pending}>Upload picture</Button>
        <div className="min-w-40 flex-1"><MediaPick media={media} onPick={(url) => update({ ...b, src: url })} /></div>
      </div>
      <Row label="Describe the picture (alt text)"><Input value={b.alt} onChange={(e) => update({ ...b, alt: e.target.value })} /></Row>
      <Row label="Big words"><Input value={b.heading} onChange={(e) => update({ ...b, heading: e.target.value })} /></Row>
      <Row label="Small words"><Textarea rows={2} value={b.text} onChange={(e) => update({ ...b, text: e.target.value })} /></Row>
      <div className="grid gap-2 sm:grid-cols-2">
        <Row label="Button words"><Input value={b.label} onChange={(e) => update({ ...b, label: e.target.value })} placeholder="Shop the menu" /></Row>
        <Row label="Button link"><Input value={b.href} onChange={(e) => update({ ...b, href: e.target.value })} placeholder="https://www.greenwaymarijuana.com/menu" /></Row>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Row label={`Height ${b.height}px`}><input type="range" min={OVERLAY_MIN_H} max={OVERLAY_MAX_H} step={10} value={b.height} onChange={(e) => update({ ...b, height: Number(e.target.value) })} className="w-full" /></Row>
        <Row label={`Shade ${b.shade}%`}><input type="range" min={0} max={80} step={5} value={b.shade} onChange={(e) => update({ ...b, shade: Number(e.target.value) })} className="w-full" /></Row>
        <Row label={`Words ${b.size}px`}><input type="range" min={20} max={40} value={b.size} onChange={(e) => update({ ...b, size: Number(e.target.value) })} className="w-full" /></Row>
      </div>
      <Row label="Align">
        <Select value={b.align} onChange={(e) => update({ ...b, align: e.target.value === "left" ? "left" : "center" })}>
          <option value="center">Center</option>
          <option value="left">Left</option>
        </Select>
      </Row>
      <p className="text-[11px] text-[var(--admin-text-faint)]">The words stay real text (they read even with pictures off). Outlook for Windows shows them on dark grey instead of the picture.</p>
    </>
  );
}

// ── Inbox mockups ─────────────────────────────────────────────────────────

export function InboxMockups({ lines }: { lines: InboxLines }) {
  const avatar = <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2f7d16] text-sm font-bold text-white">{lines.from.slice(0, 1)}</span>;
  return (
    <div className="w-full space-y-4 p-2" data-testid="canvas-inbox-preview">
      <div>
        <p className={LABEL}>Gmail app (phone)</p>
        <div className="mt-1 flex max-w-[380px] gap-3 rounded-lg bg-white p-3 text-black shadow">
          {avatar}
          <div className="min-w-0 flex-1 text-[13px] leading-tight">
            <div className="flex justify-between"><span className="font-bold">{lines.from}</span><span className="text-[11px] text-gray-600">9:00 AM</span></div>
            <div className="font-bold">{lines.gmailPhone.subject}</div>
            <div className="text-gray-600">{lines.gmailPhone.snippet}</div>
          </div>
        </div>
      </div>
      <div>
        <p className={LABEL}>Gmail (computer)</p>
        <div className="mt-1 flex items-center gap-3 rounded bg-white px-3 py-2 text-[13px] text-black shadow">
          <span className="w-40 shrink-0 truncate font-bold">{lines.from}</span>
          <span className="min-w-0 flex-1 truncate"><b>{lines.subject}</b> <span className="text-gray-600">- {lines.preview}</span></span>
          <span className="text-[11px] text-gray-600">9:00 AM</span>
        </div>
      </div>
      <div>
        <p className={LABEL}>iPhone Mail</p>
        <div className="mt-1 max-w-[380px] rounded-lg bg-white p-3 text-[14px] leading-snug text-black shadow">
          <div className="flex justify-between"><span className="font-semibold">{lines.from}</span><span className="text-[12px] text-gray-500">9:00 AM ›</span></div>
          <div>{lines.iphone.subject}</div>
          <div className="text-gray-500">{lines.iphone.preview}</div>
        </div>
      </div>
      {lines.previewFromBody ? <p className="text-[11px] text-[var(--admin-orange)]">No preheader yet, so inboxes show the first words of the email. Add a preheader for a better preview line.</p> : null}
    </div>
  );
}
