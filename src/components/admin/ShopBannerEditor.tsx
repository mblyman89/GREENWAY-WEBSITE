"use client";

/**
 * ShopBannerEditor (SLICE A / SHOP-1) — the "special" editor for the Shop (/menu)
 * top-banner CAROUSEL. It manages up to ten slides; each slide gets the FULL
 * loyalty-hero editing power (SLICE 123) PLUS per-slide CTA buttons and an
 * optional schedule window, and a LIVE preview rendering the REAL public slide
 * (<SlideView>), so what staff see is exactly what shoppers get.
 *
 * Slide MANAGEMENT (add / reorder / delete / publish per slide) posts to the
 * store-backed server actions (mirroring the home carousel manager). Editing a
 * slide's LOOK is a live client form that serializes the ShopHeroPresentation
 * into a hidden field and Saves draft / Publishes via those same actions.
 *
 * SLICE 106 LESSON: the server-action module only exports async functions; all
 * constants + helpers used here come from the pure cores.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/admin/ui";
import { ContentImageField, type MediaChoice } from "@/components/admin/ContentImageField";
import type { ImageSpec } from "@/lib/cms/image-spec-core";
import { SlideView } from "@/components/menu/ShopBannerCarousel";
import {
  TEXT_ALIGNS,
  TEXT_VALIGNS,
  IMAGE_FOCUSES,
  HERO_FONTS,
  HERO_COLORS,
  SCRIPT_SCALE_MIN,
  SCRIPT_SCALE_MAX,
  isScriptHeroFont,
  type HeroTextBlock,
  type TextAlign,
  type TextVAlign,
  type ImageFocus,
} from "@/lib/loyalty/loyalty-hero-core";
import {
  MAX_SHOP_CAROUSEL_SLIDES,
  MAX_SLIDE_CTAS,
  CTA_VARIANTS,
  normalizeShopHeroPresentation,
  serializeShopHeroPresentation,
  type ShopHeroPresentation,
  type ShopSlideCta,
  type ShopCtaVariant,
} from "@/lib/cms/shop-carousel-core";

// ── View-model handed down from the server page ──────────────────────────────

export type ShopSlideVM = {
  id: string;
  sortOrder: number;
  status: string;
  enabled: boolean;
  draftEnabled: boolean;
  dirty: boolean;
  /** The presentation to edit: draft when present, else published. */
  presentation: ShopHeroPresentation;
  /** The live/published presentation (for the "matches live" badge). */
  publishedPresentation: ShopHeroPresentation;
};

type Props = {
  slides: ShopSlideVM[];
  /** true once the shop_carousel_slides table exists (post-migration). */
  tableReady: boolean;
  mediaChoices: MediaChoice[];
  desktopSpec?: ImageSpec;
  mobileSpec?: ImageSpec;
  createAction: (formData: FormData) => void | Promise<void>;
  saveDraftAction: (formData: FormData) => void | Promise<void>;
  publishAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  moveAction: (formData: FormData) => void | Promise<void>;
  seedAction: (formData: FormData) => void | Promise<void>;
};

const TEXT_ALIGN_LABELS: Record<TextAlign, string> = { left: "Left", center: "Center", right: "Right" };
const TEXT_VALIGN_LABELS: Record<TextVAlign, string> = { top: "Top", center: "Middle", bottom: "Bottom" };
const IMAGE_FOCUS_LABELS: Record<ImageFocus, string> = {
  center: "Center",
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

const INPUT_CLASS =
  "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none";

function Segmented<T extends string>({
  options,
  value,
  labels,
  onChange,
}: {
  options: readonly T[];
  value: T;
  labels: Record<T, string>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-sm font-semibold transition ${
            value === o
              ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
              : "border border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
          }`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

function BlockEditor({
  title,
  hint,
  block,
  multiline,
  onChange,
}: {
  title: string;
  hint: string;
  block: HeroTextBlock;
  multiline: boolean;
  onChange: (patch: Partial<HeroTextBlock>) => void;
}) {
  const scriptable = isScriptHeroFont(block.font);
  return (
    <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">{title}</div>
        <label className="flex items-center gap-2 text-xs text-[var(--admin-text-muted)]">
          <input type="checkbox" checked={block.show} onChange={(e) => onChange({ show: e.target.checked })} />
          Show
        </label>
      </div>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">{hint}</p>

      {multiline ? (
        <textarea
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={2}
          placeholder="Type your text — press Enter to stack lines"
          className={`w-full ${INPUT_CLASS}`}
        />
      ) : (
        <input
          type="text"
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Type your text"
          className={`w-full ${INPUT_CLASS}`}
        />
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
          Font
          <select
            value={block.font}
            onChange={(e) => onChange({ font: e.target.value })}
            className={`mt-1.5 w-full ${INPUT_CLASS}`}
          >
            <optgroup label="Display (bold headlines)">
              {HERO_FONTS.filter((f) => f.group === "display").map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Clean sans">
              {HERO_FONTS.filter((f) => f.group === "sans").map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Script (cursive)">
              {HERO_FONTS.filter((f) => f.group === "script").map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <div className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
          Color
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {HERO_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                onClick={() => onChange({ color: c.id })}
                className={`h-8 w-8 rounded-full border transition ${
                  block.color === c.id
                    ? "ring-2 ring-[var(--admin-accent)] ring-offset-1 ring-offset-[var(--admin-surface)]"
                    : "border-white/20 hover:scale-105"
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>
      </div>

      {scriptable ? (
        <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
          Cursive size ({block.scriptScale.toFixed(1)}×)
          <input
            type="range"
            min={SCRIPT_SCALE_MIN}
            max={SCRIPT_SCALE_MAX}
            step={0.1}
            value={block.scriptScale}
            onChange={(e) => onChange({ scriptScale: Number(e.target.value) })}
            className="mt-1.5 w-full accent-[var(--admin-accent)]"
          />
        </label>
      ) : null}
    </div>
  );
}

/** Editor for one slide's up-to-two CTA buttons. */
function CtaEditor({
  ctas,
  onChange,
}: {
  ctas: ShopSlideCta[];
  onChange: (next: ShopSlideCta[]) => void;
}) {
  function patch(i: number, p: Partial<ShopSlideCta>) {
    onChange(ctas.map((c, idx) => (idx === i ? { ...c, ...p } : c)));
  }
  return (
    <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="mb-1 text-sm font-semibold">Buttons (optional)</div>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
        Add up to {MAX_SLIDE_CTAS} buttons that send shoppers somewhere — e.g. a filtered menu link.
      </p>
      <div className="space-y-3">
        {ctas.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <input
              type="text"
              value={c.label}
              onChange={(e) => patch(i, { label: e.target.value })}
              placeholder="Button text"
              className={INPUT_CLASS}
            />
            <input
              type="text"
              value={c.href}
              onChange={(e) => patch(i, { href: e.target.value })}
              placeholder="/menu?special=…"
              className={INPUT_CLASS}
            />
            <select
              value={c.variant}
              onChange={(e) => patch(i, { variant: e.target.value as ShopCtaVariant })}
              className={INPUT_CLASS}
            >
              {CTA_VARIANTS.map((v) => (
                <option key={v} value={v}>
                  {v === "solid" ? "Solid" : "Outline"}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onChange(ctas.filter((_, idx) => idx !== i))}
              className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 text-sm hover:bg-[var(--admin-surface-hover)]"
            >
              Remove
            </button>
          </div>
        ))}
        {ctas.length < MAX_SLIDE_CTAS ? (
          <button
            type="button"
            onClick={() => onChange([...ctas, { href: "", label: "", variant: "solid" }])}
            className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--admin-surface-hover)]"
          >
            + Add button
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The full editor for ONE slide (controls + live preview + save/publish/schedule). */
function SlideCard({
  slide,
  index,
  total,
  mediaChoices,
  desktopSpec,
  mobileSpec,
  saveDraftAction,
  publishAction,
  deleteAction,
  moveAction,
}: {
  slide: ShopSlideVM;
  index: number;
  total: number;
  mediaChoices: MediaChoice[];
  desktopSpec?: ImageSpec;
  mobileSpec?: ImageSpec;
  saveDraftAction: Props["saveDraftAction"];
  publishAction: Props["publishAction"];
  deleteAction: Props["deleteAction"];
  moveAction: Props["moveAction"];
}) {
  const [pres, setPres] = useState<ShopHeroPresentation>(() =>
    normalizeShopHeroPresentation(slide.presentation),
  );
  const [draftEnabled, setDraftEnabled] = useState<boolean>(slide.draftEnabled);
  const [open, setOpen] = useState<boolean>(index === 0);

  const serialized = useMemo(() => serializeShopHeroPresentation(pres), [pres]);
  const publishedSerialized = useMemo(
    () => serializeShopHeroPresentation(normalizeShopHeroPresentation(slide.publishedPresentation)),
    [slide.publishedPresentation],
  );
  const dirtyVsPublished = serialized !== publishedSerialized || draftEnabled !== slide.enabled;

  function setField<K extends keyof ShopHeroPresentation>(key: K, value: ShopHeroPresentation[K]) {
    setPres((p) => ({ ...p, [key]: value }));
  }
  function patchBlock(which: "eyebrow" | "title" | "subtitle", patch: Partial<HeroTextBlock>) {
    setPres((p) => ({ ...p, [which]: { ...p[which], ...patch } }));
  }

  const title = pres.title.text.split("\n")[0] || "(untitled slide)";

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)]">
      {/* Card header — collapse toggle + status + reorder + delete */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--admin-border)] px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <span className="text-[var(--admin-text-muted)]">{open ? "▾" : "▸"}</span>
          Slide {index + 1}: <span className="text-[var(--admin-text-muted)]">{title}</span>
        </button>
        {slide.status === "published" && slide.enabled ? (
          <span className="rounded-full bg-[var(--admin-accent-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--admin-accent)]">
            Live
          </span>
        ) : (
          <span className="rounded-full bg-[var(--admin-surface-hover)] px-2.5 py-0.5 text-xs font-semibold text-[var(--admin-text-muted)]">
            {slide.enabled ? "Draft" : "Hidden"}
          </span>
        )}
        {dirtyVsPublished ? (
          <span className="rounded-full bg-[var(--admin-gold-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--admin-gold)]">
            Unpublished changes
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <form action={moveAction}>
            <input type="hidden" name="slide_id" value={slide.id} />
            <input type="hidden" name="direction" value="up" />
            <button
              type="submit"
              disabled={index === 0}
              aria-label="Move up"
              className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-2 py-1 text-sm disabled:opacity-40 hover:bg-[var(--admin-surface-hover)]"
            >
              ↑
            </button>
          </form>
          <form action={moveAction}>
            <input type="hidden" name="slide_id" value={slide.id} />
            <input type="hidden" name="direction" value="down" />
            <button
              type="submit"
              disabled={index === total - 1}
              aria-label="Move down"
              className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-2 py-1 text-sm disabled:opacity-40 hover:bg-[var(--admin-surface-hover)]"
            >
              ↓
            </button>
          </form>
          <form action={deleteAction}>
            <input type="hidden" name="slide_id" value={slide.id} />
            <button
              type="submit"
              aria-label="Delete slide"
              className="rounded-[var(--admin-radius-sm)] border border-red-300/40 px-2 py-1 text-sm text-red-400 hover:bg-red-500/10"
            >
              Delete
            </button>
          </form>
        </div>
      </div>

      {open ? (
        <div className="grid gap-6 p-4 lg:grid-cols-2">
          {/* Controls */}
          <div className="space-y-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draftEnabled}
                onChange={(e) => setDraftEnabled(e.target.checked)}
              />
              Show this slide (when published)
            </label>

            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Background image (desktop)</div>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                Optional. Use a <strong>textless</strong> picture (the words are added below). Leave
                blank for a clean dark panel like today&apos;s banner.
              </p>
              <ContentImageField
                value={pres.image}
                onChange={(next) => setField("image", next)}
                mediaChoices={mediaChoices}
                spec={desktopSpec}
              />
            </div>

            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Background image (mobile)</div>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                A taller crop that reads better on phones. If blank, the desktop image (or the dark
                panel) is used.
              </p>
              <ContentImageField
                value={pres.imageMobile}
                onChange={(next) => setField("imageMobile", next)}
                mediaChoices={mediaChoices}
                spec={mobileSpec}
              />
            </div>

            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Text position</div>
              <div className="mt-2 space-y-3">
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    Horizontal
                  </div>
                  <Segmented options={TEXT_ALIGNS} value={pres.textAlign} labels={TEXT_ALIGN_LABELS} onChange={(v) => setField("textAlign", v)} />
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    Vertical
                  </div>
                  <Segmented options={TEXT_VALIGNS} value={pres.verticalAlign} labels={TEXT_VALIGN_LABELS} onChange={(v) => setField("verticalAlign", v)} />
                </div>
              </div>
            </div>

            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Picture focus</div>
              <div className="mt-2 space-y-3">
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    Desktop
                  </div>
                  <Segmented options={IMAGE_FOCUSES} value={pres.imageFocus} labels={IMAGE_FOCUS_LABELS} onChange={(v) => setField("imageFocus", v)} />
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    Mobile
                  </div>
                  <Segmented options={IMAGE_FOCUSES} value={pres.imageFocusMobile} labels={IMAGE_FOCUS_LABELS} onChange={(v) => setField("imageFocusMobile", v)} />
                </div>
              </div>
            </div>

            <BlockEditor
              title="Eyebrow (small kicker)"
              hint="A short line above the headline — e.g. “Weekend Sale”."
              block={pres.eyebrow}
              multiline={false}
              onChange={(patch) => patchBlock("eyebrow", patch)}
            />
            <BlockEditor
              title="Title (the big headline)"
              hint="Press Enter to stack lines, e.g. “50% / Off”."
              block={pres.title}
              multiline
              onChange={(patch) => patchBlock("title", patch)}
            />
            <BlockEditor
              title="Subtitle (the flourish line)"
              hint="A supporting line — great with a cursive font."
              block={pres.subtitle}
              multiline={false}
              onChange={(patch) => patchBlock("subtitle", patch)}
            />

            <CtaEditor ctas={pres.ctas} onChange={(next) => setField("ctas", next)} />

            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Schedule (optional)</div>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                Leave blank to show it whenever it&apos;s published. Set a start/end to have the slide
                appear and retire on its own — handy for a one-off sale.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                  Start
                  <input
                    type="datetime-local"
                    value={toLocalInput(pres.scheduleStart)}
                    onChange={(e) => setField("scheduleStart", fromLocalInput(e.target.value))}
                    className={`mt-1.5 w-full ${INPUT_CLASS}`}
                  />
                </label>
                <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                  End
                  <input
                    type="datetime-local"
                    value={toLocalInput(pres.scheduleEnd)}
                    onChange={(e) => setField("scheduleEnd", fromLocalInput(e.target.value))}
                    className={`mt-1.5 w-full ${INPUT_CLASS}`}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Live preview + save/publish */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Live preview (exactly what shoppers see)
            </div>
            <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-white/10 bg-black p-3">
              <SlideView presentation={pres} />
            </div>

            <form className="mt-4 flex flex-wrap items-center gap-3">
              <input type="hidden" name="slide_id" value={slide.id} />
              <input type="hidden" name="presentation" value={serialized} />
              <input type="hidden" name="draft_enabled" value={draftEnabled ? "1" : "0"} />
              <Button type="submit" formAction={saveDraftAction} variant="save">
                Save draft
              </Button>
              <Button type="submit" formAction={publishAction} variant="primary">
                Publish this slide
              </Button>
              {dirtyVsPublished ? (
                <span className="text-xs text-[var(--admin-gold)]">Unpublished changes</span>
              ) : (
                <span className="text-xs text-[var(--admin-text-muted)]">Matches what&rsquo;s live.</span>
              )}
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** ISO → value for a <input type="datetime-local"> (local time). "" when null. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}
/** datetime-local value → ISO string (or null when blank). */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function ShopBannerEditor(props: Props) {
  const {
    slides,
    tableReady,
    mediaChoices,
    desktopSpec,
    mobileSpec,
    createAction,
    saveDraftAction,
    publishAction,
    deleteAction,
    moveAction,
    seedAction,
  } = props;

  if (!tableReady) {
    return (
      <div className="space-y-4">
        <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          <strong>One-time setup pending.</strong> The Shop banner carousel is ready in the code, but
          its storage table hasn&apos;t been added to the database yet. Until then, the Shop page shows
          the classic single banner (unchanged). Once your administrator applies the database update,
          this editor will let you build the carousel.
        </div>
      </div>
    );
  }

  const atCap = slides.length >= MAX_SHOP_CAROUSEL_SLIDES;

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
        <strong>This is your Shop banner — now a carousel.</strong> Add up to{" "}
        {MAX_SHOP_CAROUSEL_SLIDES} slides (great for one-off sales), style each one with its own
        picture, fonts, colors, and buttons, and reorder them. Each slide has a live preview. Nothing
        goes live until you <strong>Publish</strong> that slide.
      </div>

      {slides.length === 0 ? (
        <div className="rounded-[var(--admin-radius-lg)] border border-dashed border-[var(--admin-border)] p-6 text-center">
          <p className="mb-3 text-sm text-[var(--admin-text-muted)]">
            No slides yet. Start with the default banner (matches your current Shop page), then edit
            it and add more.
          </p>
          <form action={seedAction}>
            <Button type="submit" variant="primary">
              Create the starter slide
            </Button>
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          {slides.map((slide, index) => (
            <SlideCard
              key={slide.id}
              slide={slide}
              index={index}
              total={slides.length}
              mediaChoices={mediaChoices}
              desktopSpec={desktopSpec}
              mobileSpec={mobileSpec}
              saveDraftAction={saveDraftAction}
              publishAction={publishAction}
              deleteAction={deleteAction}
              moveAction={moveAction}
            />
          ))}
        </div>
      )}

      {slides.length > 0 ? (
        <form action={createAction}>
          <Button type="submit" variant="neutral" disabled={atCap}>
            {atCap ? `Maximum of ${MAX_SHOP_CAROUSEL_SLIDES} slides reached` : "+ Add a slide"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
