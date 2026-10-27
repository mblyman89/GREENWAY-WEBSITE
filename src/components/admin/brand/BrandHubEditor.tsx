"use client";

/**
 * R64 — the Brand hub. One form for the whole `brand.kit` block, split into
 * tabs (Colours · Logos · Messaging · Saved banners · Social & guidelines).
 * Same Save draft → Publish flow as every other editor; nothing on the public
 * site changes until Publish (colours + header logo apply site-wide).
 */
import { useState } from "react";
import { Button } from "@/components/admin/ui";
import { ContentImageField, type MediaChoice } from "@/components/admin/ContentImageField";
import { ColorField } from "@/components/admin/banner-studio/controls";
import { DesignCard } from "@/components/admin/banner-studio/BannerEditorShell";
import type { PickerPost } from "@/components/admin/banner-studio/LinkPicker";
import { DesignedCard } from "@/components/site/DesignedCard";
import { BrandDesignExport } from "@/components/admin/brand/BrandDesignExport";
import { applySize, checkCustomSize, newDesignForSize, sizeOptionById, sizeOptions, type BrandSize } from "@/lib/brand/brand-sizes-core";
import { ColorWheel } from "@/components/admin/brand/ColorWheel";
import type { BannerDesign } from "@/lib/cms/banner-design-core";
import { colorToHex } from "@/lib/cms/color-input-core";
import { measureImage, putSigned } from "@/lib/media/direct-upload-client";
import { finishDirectUploadAction, startDirectUploadAction } from "@/app/admin/media/direct-upload-actions";
import {
  BRAND_COLOR_PRESETS,
  BRAND_COLOR_TOKENS,
  BRAND_KIT_BLOCK,
  BRAND_MAX_BANNERS,
  BRAND_MAX_LINKS,
  BRAND_MAX_LOGOS,
  BRAND_MAX_SLOGANS,
  SHIPPED_HEADER_LOGO,
  contrastText,
  defaultBrandColors,
  parseBrandKit,
  serializeBrandKit,
  type BrandColorKey,
  type BrandKit,
} from "@/lib/brand/brand-kit-core";

export type BrandHubTab = "colors" | "logos" | "messaging" | "banners" | "social";

const INPUT =
  "mt-1 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]";
const CARD = "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4";
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      disabled={!text.trim()}
      className="text-xs underline text-[var(--admin-text-muted)] disabled:opacity-40"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copied ✓" : "Copy"}
    </button>
  );
}

function TextBlock({
  label,
  hint,
  value,
  onChange,
  rows = 3,
  max,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  max: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-[var(--admin-text)]">{label}</span>
        <span className="flex items-center gap-3 text-xs text-[var(--admin-text-muted)]">
          {value.length}/{max} <CopyButton text={value} />
        </span>
      </div>
      {hint ? <p className="text-xs text-[var(--admin-text-muted)]">{hint}</p> : null}
      {rows <= 1 ? (
        <input type="text" maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} />
      ) : (
        <textarea rows={rows} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} />
      )}
    </div>
  );
}

/** Upload one logo file straight into the Media Library (published) and return its URL. */
async function uploadLogo(file: File): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const mime = file.type || "application/octet-stream";
    if (!/^image\//.test(mime)) return { ok: false, error: "Pick an image file (PNG, WebP, JPG or SVG)." };
    const dims = await measureImage(file);
    const start = await startDirectUploadAction({ filename: file.name, mime, size: file.size, usageType: "brand-logo" });
    if (!start.ok) return { ok: false, error: start.error };
    await putSigned(start.key, start.token, file, mime);
    const fin = await finishDirectUploadAction({
      key: start.key,
      filename: file.name,
      size: file.size,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      title: file.name.replace(/\.[a-z0-9]+$/i, ""),
      usageType: "brand-logo",
      status: "published",
    });
    if (!fin.ok) return { ok: false, error: fin.error };
    if (!fin.url) return { ok: false, error: "Uploaded, but the file has no public link yet." };
    return { ok: true, url: fin.url };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Upload failed." };
  }
}

export function BrandHubEditor({
  tab,
  draftJson,
  publishedJson,
  mediaChoices,
  posts,
  saveDraftAction,
  publishAction,
}: {
  tab: BrandHubTab;
  draftJson: string | null;
  publishedJson: string | null;
  mediaChoices: MediaChoice[];
  posts: PickerPost[];
  saveDraftAction: (fd: FormData) => void | Promise<void>;
  publishAction: (fd: FormData) => void | Promise<void>;
}) {
  const start = draftJson ?? publishedJson;
  const [kit, setKit] = useState<BrandKit>(() => parseBrandKit(start));
  const saved = serializeBrandKit(parseBrandKit(start));
  const value = serializeBrandKit(kit);
  const dirty = value !== saved;
  const live = serializeBrandKit(parseBrandKit(publishedJson)) === saved;
  const set = (p: Partial<BrandKit>) => setKit((k) => ({ ...k, ...p }));

  const [active, setActive] = useState<BrandColorKey>("greenway");
  const setColor = (key: BrandColorKey, hex: string) => {
    const h = colorToHex(hex);
    if (h) setKit((k) => ({ ...k, colors: { ...k.colors, [key]: h } }));
  };

  const [upMsg, setUpMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newSlogan, setNewSlogan] = useState("");
  const [draftBanner, setDraftBanner] = useState<BannerDesign | null>(null);
  const [draftBannerName, setDraftBannerName] = useState("");
  const [draftBannerImage, setDraftBannerImage] = useState("");
  // R73 S6: what the new design is for (banner, card, blog, newsletter, social, print or a custom size).
  const [draftSizeId, setDraftSizeId] = useState("banner");
  const [customW, setCustomW] = useState("1200");
  const [customH, setCustomH] = useState("800");
  const customCheck = checkCustomSize(Number(customW), Number(customH));
  const draftSize: BrandSize | null = draftSizeId === "custom" ? (customCheck.ok ? customCheck.size : null) : (sizeOptionById(draftSizeId)?.size ?? null);

  return (
    <form className="space-y-4">
      <input type="hidden" name="block_key" value={BRAND_KIT_BLOCK} />
      <input type="hidden" name="draft_value" value={value} />
      <input type="hidden" name="tab" value={tab} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs font-semibold ${live ? "text-[var(--admin-accent)]" : "text-[var(--admin-gold)]"}`}>
          {live ? "Brand kit is live & up to date" : "Brand kit has a draft that isn't published yet"}
        </span>
        <span className="text-xs text-[var(--admin-text-muted)]">Every tab shares one draft — Save keeps all of it.</span>
      </div>

      {tab === "colors" ? (
        <div className="space-y-4">
          <div className={CARD}>
            <h3 className="text-sm font-black text-[var(--admin-text)]">Colour presets</h3>
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
              One tap fills all six brand colours. &ldquo;Greenway classic&rdquo; is today&apos;s look.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {BRAND_COLOR_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => set({ colors: { ...p.colors } })}
                  className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2 text-left hover:border-[var(--admin-accent)]"
                >
                  <div className="flex h-6 overflow-hidden rounded">
                    {BRAND_COLOR_TOKENS.map((t) => (
                      <span key={t.key} className="flex-1" style={{ background: p.colors[t.key] }} />
                    ))}
                  </div>
                  <span className="mt-1 block text-xs font-semibold text-[var(--admin-text)]">{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <div className={CARD}>
              <h3 className="text-sm font-black text-[var(--admin-text)]">Brand colours</h3>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                Click a colour to edit it with the wheel, or type a hex / rgb value. Only colours you change are applied to the site.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {BRAND_COLOR_TOKENS.map((t) => (
                  <div
                    key={t.key}
                    className={`rounded-[var(--admin-radius-sm)] border p-2 ${active === t.key ? "border-[var(--admin-accent)]" : "border-[var(--admin-border)]"}`}
                  >
                    <button
                      type="button"
                      onClick={() => setActive(t.key)}
                      className="mb-2 flex w-full items-center justify-between rounded px-2 py-3 text-xs font-bold"
                      style={{ background: kit.colors[t.key], color: contrastText(kit.colors[t.key]) }}
                    >
                      <span>{t.label}</span>
                      <span className="font-mono">{kit.colors[t.key]}</span>
                    </button>
                    <ColorField label={t.hint} value={kit.colors[t.key]} onChange={(hex) => setColor(t.key, hex)} />
                    {kit.colors[t.key] !== t.def ? (
                      <button type="button" className="mt-1 text-xs underline text-[var(--admin-text-muted)]" onClick={() => setColor(t.key, t.def)}>
                        Reset to {t.def}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="mt-3 text-xs underline text-[var(--admin-text-muted)]"
                onClick={() => set({ colors: defaultBrandColors() })}
              >
                Reset all colours to Greenway classic
              </button>
            </div>
            <div className={`${CARD} flex flex-col items-center gap-2`}>
              <h3 className="text-sm font-black text-[var(--admin-text)]">
                Colour wheel — {BRAND_COLOR_TOKENS.find((t) => t.key === active)?.label}
              </h3>
              <ColorWheel value={kit.colors[active]} onChange={(hex) => setColor(active, hex)} size={200} />
            </div>
          </div>

          <div className={CARD}>
            <h3 className="mb-2 text-sm font-black text-[var(--admin-text)]">Quick look</h3>
            <div className="rounded-[var(--admin-radius-sm)] p-4" style={{ background: kit.colors.charcoal, border: `2px solid ${kit.colors.gold}` }}>
              <p className="text-lg font-black" style={{ color: kit.colors.orange }}>
                Heading in your orange
              </p>
              <p className="text-sm" style={{ color: kit.colors.frost }}>
                Body text in frost, with a <span style={{ color: kit.colors.greenway }}>green link</span>.
              </p>
              <div className="mt-3 inline-block rounded px-3 py-1 text-xs font-bold" style={{ background: kit.colors.greenwayDark, color: contrastText(kit.colors.greenwayDark) }}>
                Deep green panel
              </div>
            </div>
            <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
              Some banners and buttons use their own colours set in their Design Studio; those stay as you made them.
            </p>
          </div>
        </div>
      ) : null}

      {tab === "logos" ? (
        <div className="space-y-4">
          <div className={CARD}>
            <h3 className="text-sm font-black text-[var(--admin-text)]">Header logo (every page)</h3>
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">The wordmark at the top of the site. Leave it on the original to keep today&apos;s look.</p>
            <div className="mb-3 flex justify-center rounded-[var(--admin-radius-sm)] bg-black p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- in-editor thumbnail */}
              <img loading="lazy" decoding="async" src={kit.headerLogo || SHIPPED_HEADER_LOGO} alt="" className="h-14 w-auto object-contain" />
            </div>
            <ContentImageField value={kit.headerLogo || SHIPPED_HEADER_LOGO} onChange={(src) => set({ headerLogo: src === SHIPPED_HEADER_LOGO ? "" : src })} mediaChoices={mediaChoices} />
            {kit.headerLogo ? (
              <button type="button" className="mt-2 text-xs underline text-[var(--admin-text-muted)]" onClick={() => set({ headerLogo: "" })}>
                Use the original wordmark
              </button>
            ) : null}
          </div>

          <div className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-black text-[var(--admin-text)]">Logo library ({kit.logos.length}/{BRAND_MAX_LOGOS})</h3>
              <label className={`cursor-pointer rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-1 text-xs font-semibold ${uploading || kit.logos.length >= BRAND_MAX_LOGOS ? "pointer-events-none opacity-50" : ""}`}>
                {uploading ? "Uploading…" : "⬆ Import a logo file"}
                <input
                  type="file"
                  accept="image/png,image/webp,image/jpeg,image/svg+xml,image/gif"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setUploading(true);
                    setUpMsg(null);
                    const r = await uploadLogo(file);
                    setUploading(false);
                    if (!r.ok) {
                      setUpMsg(r.error);
                      return;
                    }
                    setKit((k) => ({ ...k, logos: [...k.logos, { id: uid("l"), name: file.name.replace(/\.[a-z0-9]+$/i, ""), src: r.url, note: "" }].slice(0, BRAND_MAX_LOGOS) }));
                    setUpMsg("Imported into the Media Library and added below. Save draft to keep it in the kit.");
                  }}
                />
              </label>
            </div>
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
              Every brand logo in one place. Imported files also land in the Media Library (as &ldquo;brand logo&rdquo;) so every picture picker can use them.
            </p>
            {upMsg ? <p className="mb-2 text-xs text-[var(--admin-gold)]">{upMsg}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {kit.logos.map((l, i) => (
                <div key={l.id} className="space-y-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2">
                  <div className="flex h-24 items-center justify-center rounded bg-[repeating-conic-gradient(#333_0_25%,#222_0_50%)] bg-[length:16px_16px]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- in-editor thumbnail */}
                    <img loading="lazy" decoding="async" src={l.src} alt="" className="max-h-20 max-w-full object-contain" />
                  </div>
                  <input
                    type="text"
                    maxLength={80}
                    value={l.name}
                    placeholder="Name"
                    onChange={(e) => setKit((k) => ({ ...k, logos: k.logos.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))}
                    className={INPUT}
                  />
                  <input
                    type="text"
                    maxLength={300}
                    value={l.note}
                    placeholder="When to use it"
                    onChange={(e) => setKit((k) => ({ ...k, logos: k.logos.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) }))}
                    className={INPUT}
                  />
                  <div className="flex flex-wrap gap-3 text-xs">
                    <button type="button" className="underline text-[var(--admin-accent)]" onClick={() => set({ headerLogo: l.src === SHIPPED_HEADER_LOGO ? "" : l.src })}>
                      Use as header logo
                    </button>
                    <CopyButton text={l.src} />
                    <a href={l.src} target="_blank" rel="noreferrer" className="underline text-[var(--admin-text-muted)]">
                      Open
                    </a>
                    <button type="button" className="underline text-red-400" onClick={() => setKit((k) => ({ ...k, logos: k.logos.filter((_, j) => j !== i) }))}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {kit.logos.length < BRAND_MAX_LOGOS ? (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold text-[var(--admin-text)]">Or add one from the Media Library / a link</p>
                <ContentImageField
                  value=""
                  onChange={(src) => {
                    if (src) setKit((k) => ({ ...k, logos: [...k.logos, { id: uid("l"), name: "Logo", src, note: "" }].slice(0, BRAND_MAX_LOGOS) }));
                  }}
                  mediaChoices={mediaChoices}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "messaging" ? (
        <div className="space-y-4">
          <div className={`${CARD} space-y-4`}>
            <TextBlock label="Tagline" hint="The short line that sums up Greenway." value={kit.tagline} onChange={(v) => set({ tagline: v })} rows={1} max={200} />
            <div>
              <span className="text-sm font-semibold text-[var(--admin-text)]">
                Slogans ({kit.slogans.length}/{BRAND_MAX_SLOGANS})
              </span>
              <ul className="mt-2 space-y-2">
                {kit.slogans.map((s, i) => (
                  <li key={`${i}-${s.slice(0, 8)}`} className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={200}
                      value={s}
                      onChange={(e) => setKit((k) => ({ ...k, slogans: k.slogans.map((x, j) => (j === i ? e.target.value : x)) }))}
                      className={INPUT}
                    />
                    <CopyButton text={s} />
                    <button type="button" className="text-xs underline text-red-400" onClick={() => setKit((k) => ({ ...k, slogans: k.slogans.filter((_, j) => j !== i) }))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              {kit.slogans.length < BRAND_MAX_SLOGANS ? (
                <div className="mt-2 flex gap-2">
                  <input type="text" maxLength={200} value={newSlogan} placeholder="New slogan" onChange={(e) => setNewSlogan(e.target.value)} className={INPUT} />
                  <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    disabled={!newSlogan.trim()}
                    onClick={() => {
                      setKit((k) => ({ ...k, slogans: [...k.slogans, newSlogan.trim()] }));
                      setNewSlogan("");
                    }}
                  >
                    Add
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
          <div className={`${CARD} space-y-4`}>
            <TextBlock label="Mission statement" hint="Why Greenway exists." value={kit.mission} onChange={(v) => set({ mission: v })} rows={4} max={2000} />
            <TextBlock label="Vision" hint="Where Greenway is heading." value={kit.vision} onChange={(v) => set({ vision: v })} rows={3} max={2000} />
            <TextBlock label="About us — short" hint="One or two sentences (bios, directories, social profiles)." value={kit.aboutShort} onChange={(v) => set({ aboutShort: v })} rows={3} max={600} />
            <TextBlock label="About us — long" hint="The full story (press, vendor packets, About page drafts)." value={kit.aboutLong} onChange={(v) => set({ aboutLong: v })} rows={8} max={6000} />
            <TextBlock label="Elevator pitch" hint="What you'd say to a new vendor or customer in 30 seconds." value={kit.pitch} onChange={(v) => set({ pitch: v })} rows={4} max={1000} />
            <TextBlock label="Brand voice & tone" hint="How Greenway sounds (e.g. friendly, local, knowledgeable, never pushy)." value={kit.voice} onChange={(v) => set({ voice: v })} rows={4} max={2000} />
            <TextBlock label="Keywords" hint="Comma-separated words you want associated with the brand." value={kit.keywords} onChange={(v) => set({ keywords: v })} rows={2} max={600} />
          </div>
          <p className="text-xs text-[var(--admin-text-muted)]">
            These are your saved brand words to copy into pages, posts and emails — they don&apos;t change any page by themselves.
          </p>
        </div>
      ) : null}

      {tab === "banners" ? (
        <div className="space-y-4">
          <div className={CARD}>
            <h3 className="text-sm font-black text-[var(--admin-text)]">
              Saved brand designs ({kit.banners.length}/{BRAND_MAX_BANNERS})
            </h3>
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
              Reusable Design Studio banners, cards and custom sizes (blog, newsletter, social, print). Every banner and card editor can start from one of these (&ldquo;Start from a saved brand banner&rdquo;). &ldquo;Save as picture&rdquo; turns a design into a finished PNG in the Media Library &mdash; the Merch folder is what Website &rarr; Merchandise &rarr; Banners lists first.
            </p>
            {kit.banners.length === 0 ? <p className="text-xs text-[var(--admin-text-muted)]">No saved designs yet — make one below.</p> : null}
            <div className="grid gap-4 md:grid-cols-2">
              {kit.banners.map((b, i) => (
                <div key={b.id} className="space-y-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2">
                  <div className="pointer-events-none overflow-hidden rounded">
                    <DesignedCard design={b.design} imageSrc={b.image} legacy={{}} label={b.name} />
                  </div>
                  <input
                    type="text"
                    maxLength={80}
                    value={b.name}
                    onChange={(e) => setKit((k) => ({ ...k, banners: k.banners.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))}
                    className={INPUT}
                  />
                  {b.size ? <p className="text-xs text-[var(--admin-text-muted)]">Made for: {b.size.label} ({b.size.w}×{b.size.h})</p> : null}
                  <BrandDesignExport name={b.name} image={b.image} design={b.design} size={b.size} />
                  <div className="flex gap-3 text-xs">
                    <button
                      type="button"
                      className="underline text-[var(--admin-accent)]"
                      onClick={() => {
                        setDraftBanner({ ...b.design, enabled: true });
                        setDraftBannerName(`${b.name} (copy)`);
                        setDraftBannerImage(b.image);
                        if (b.size) {
                          setDraftSizeId("custom");
                          setCustomW(String(b.size.w));
                          setCustomH(String(b.size.h));
                        } else setDraftSizeId(b.design.frame.card ? "card" : "banner");
                      }}
                    >
                      Duplicate & edit below
                    </button>
                    <button type="button" className="underline text-red-400" onClick={() => setKit((k) => ({ ...k, banners: k.banners.filter((_, j) => j !== i) }))}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {kit.banners.length < BRAND_MAX_BANNERS ? (
            <div className={`${CARD} space-y-3`}>
              <h3 className="text-sm font-black text-[var(--admin-text)]">Make a new brand design</h3>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <label className="block text-sm text-[var(--admin-text)]">
                  What is it for?
                  <select
                    value={draftSizeId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setDraftSizeId(id);
                      const next = id === "custom" ? (customCheck.ok ? customCheck.size : null) : (sizeOptionById(id)?.size ?? null);
                      if (draftBanner && next) setDraftBanner(applySize(draftBanner, next));
                    }}
                    className={INPUT}
                  >
                    {Object.entries(
                      sizeOptions().reduce<Record<string, ReturnType<typeof sizeOptions>>>((acc, o) => ((acc[o.group] ??= []).push(o), acc), {}),
                    ).map(([group, opts]) => (
                      <optgroup key={group} label={group}>
                        {opts.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.size.label} — {o.size.w}×{o.size.h}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="custom">Custom size…</option>
                  </select>
                </label>
                {draftSizeId === "custom" ? (
                  <div className="flex items-end gap-1 text-sm text-[var(--admin-text)]">
                    <label>
                      W
                      <input type="number" min={64} max={6000} value={customW} onChange={(e) => setCustomW(e.target.value)} className={`${INPUT} w-24`} />
                    </label>
                    <span className="pb-2">×</span>
                    <label>
                      H
                      <input type="number" min={64} max={6000} value={customH} onChange={(e) => setCustomH(e.target.value)} className={`${INPUT} w-24`} />
                    </label>
                    {draftBanner && customCheck.ok ? (
                      <button type="button" className="pb-2 text-xs underline text-[var(--admin-accent)]" onClick={() => setDraftBanner(applySize(draftBanner, customCheck.size))}>
                        Apply
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {draftSizeId === "custom" && !customCheck.ok ? <p className="text-xs text-red-400">{customCheck.error}</p> : null}
              <label className="block text-sm text-[var(--admin-text)]">
                Name
                <input type="text" maxLength={80} value={draftBannerName} onChange={(e) => setDraftBannerName(e.target.value)} className={INPUT} placeholder="e.g. Grand-opening green" />
              </label>
              <div>
                <span className="text-sm text-[var(--admin-text)]">Background picture (optional)</span>
                <ContentImageField value={draftBannerImage} onChange={setDraftBannerImage} mediaChoices={mediaChoices} />
              </div>
              <DesignCard
                mediaChoices={mediaChoices}
                title="Design Studio"
                description="Tick the box and design the banner. Then click “Add to saved designs”."
                design={draftBanner}
                onChange={setDraftBanner}
                legacy={{}}
                imageSrc={draftBannerImage}
                imageAlt=""
                preset="section"
                seed={{}}
                posts={posts}
                brandBanners={false}
                makeNew={draftSize ? () => newDesignForSize(draftSize) : undefined}
              />
              <Button
                type="button"
                variant="neutral"
                size="sm"
                disabled={!draftBanner?.enabled}
                onClick={() => {
                  if (!draftBanner) return;
                  setKit((k) => ({
                    ...k,
                    banners: [...k.banners, { id: uid("b"), name: draftBannerName.trim() || `Banner ${k.banners.length + 1}`, image: draftBannerImage, design: { ...draftBanner, enabled: true }, ...(draftSize && draftSizeId !== "banner" ? { size: draftSize } : {}) }].slice(0, BRAND_MAX_BANNERS),
                  }));
                  setDraftBanner(null);
                  setDraftBannerName("");
                  setDraftBannerImage("");
                }}
              >
                Add to saved designs
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "social" ? (
        <div className="space-y-4">
          <div className={CARD}>
            <h3 className="text-sm font-black text-[var(--admin-text)]">
              Social & review profiles ({kit.social.length}/{BRAND_MAX_LINKS})
            </h3>
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">Your official profile links in one place (must start with https://).</p>
            <div className="space-y-2">
              {kit.social.map((l, i) => (
                <div key={l.id} className="grid gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-center">
                  <input
                    type="text"
                    maxLength={60}
                    value={l.label}
                    placeholder="e.g. Instagram"
                    onChange={(e) => setKit((k) => ({ ...k, social: k.social.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))}
                    className={INPUT}
                  />
                  <input
                    type="url"
                    maxLength={500}
                    value={l.url}
                    placeholder="https://"
                    onChange={(e) => setKit((k) => ({ ...k, social: k.social.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) }))}
                    className={INPUT}
                  />
                  <button type="button" className="text-xs underline text-red-400" onClick={() => setKit((k) => ({ ...k, social: k.social.filter((_, j) => j !== i) }))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            {kit.social.length < BRAND_MAX_LINKS ? (
              <Button type="button" variant="neutral" size="sm" className="mt-3" onClick={() => setKit((k) => ({ ...k, social: [...k.social, { id: uid("s"), label: "", url: "https://" }] }))}>
                + Add a profile link
              </Button>
            ) : null}
            <p className="mt-2 text-xs text-[var(--admin-text-muted)]">Links that don&apos;t start with https:// are dropped when you save.</p>
          </div>
          <div className={`${CARD} space-y-4`}>
            <TextBlock label="Brand guidelines — do" hint="e.g. Always use the transparent logo on dark backgrounds." value={kit.doNotes} onChange={(v) => set({ doNotes: v })} rows={5} max={3000} />
            <TextBlock label="Brand guidelines — don't" hint="e.g. Don't stretch the logo or put it on busy photos." value={kit.dontNotes} onChange={(v) => set({ dontNotes: v })} rows={5} max={3000} />
          </div>
        </div>
      ) : null}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-[var(--admin-border)] bg-[var(--admin-surface)] py-3">
        <Button type="submit" variant="save" size="sm" formAction={saveDraftAction}>
          Save draft
        </Button>
        <Button type="submit" variant="primary" size="sm" formAction={publishAction} disabled={dirty}>
          Publish
        </Button>
        <span className="text-xs text-[var(--admin-text-muted)]">{dirty ? "Save draft first, then Publish." : "Publish makes the saved brand kit live."}</span>
      </div>
    </form>
  );
}
