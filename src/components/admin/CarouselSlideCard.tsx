"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/ux";
import { ContentImageField, type MediaChoice } from "./ContentImageField";
import { CAROUSEL_SLIDE_SPEC } from "@/lib/cms/image-spec-core";
import type { SlideAdminVM, SlideCta } from "@/lib/cms/carousel-types";
import { DesignCard } from "@/components/admin/specials/SpecialsR41Panels";
import type { PickerPost } from "@/components/admin/banner-studio/LinkPicker";
import { ensureBoundBoxes, type BannerDesign } from "@/lib/cms/banner-design-core";
import {
  IMAGE_FOCUSES,
  TEXT_ALIGNS,
  TEXT_VALIGNS,
  defaultHomeSlideAdvanced,
  effectiveLayout,
  homeLegacyWords,
  normalizeHomeSlideAdvanced,
  serializeHomeSlideAdvanced,
  type HomeLineStyle,
  type HomeSlideAdvanced,
} from "@/lib/cms/home-slide-advanced-core";
import {
  HERO_COLORS,
  HERO_FONTS,
  SCRIPT_SCALE_MAX,
  SCRIPT_SCALE_MIN,
  isScriptHeroFont,
  type ImageFocus,
  type TextAlign,
  type TextVAlign,
} from "@/lib/loyalty/loyalty-hero-core";

/**
 * CarouselSlideCard — one editable home-hero slide in the manager.
 *
 * Edits the slide's DRAFT values via a plain <form> posting to the server
 * action (no client fetch). Shows a live thumbnail, image picker (Media Library
 * or paste URL), eyebrow/title/description, layout knobs (image focus + text
 * side), up to two CTAs, an enable toggle, and Save draft / Publish / Delete /
 * reorder controls. A gold "● unsaved edits" badge tracks unsaved field changes
 * and warns before leaving the page.
 */
export function CarouselSlideCard({
  slide,
  index,
  total,
  mediaChoices,
  saveAction,
  publishAction,
  deleteAction,
  moveAction,
  posts = [],
}: {
  slide: SlideAdminVM;
  index: number;
  total: number;
  mediaChoices: MediaChoice[];
  saveAction: (formData: FormData) => void | Promise<void>;
  publishAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  moveAction: (formData: FormData) => void | Promise<void>;
  /** R47: published blog posts / newsletters for the Banner Studio link picker. */
  posts?: PickerPost[];
}) {
  // Draft is the source of truth for the editor.
  const d = {
    image: slide.draft_image ?? slide.image ?? "",
    image_alt: slide.draft_image_alt ?? slide.image_alt ?? "",
    image_focus: slide.draft_image_focus ?? slide.image_focus ?? "right",
    text_align: slide.draft_text_align ?? slide.text_align ?? "left",
    eyebrow: slide.draft_eyebrow ?? slide.eyebrow ?? "",
    title: slide.draft_title ?? slide.title ?? "",
    description: slide.draft_description ?? slide.description ?? "",
    ctas: (slide.draft_ctas ?? slide.ctas ?? []) as SlideCta[],
    enabled: slide.draft_enabled,
  };

  const [image, setImage] = useState(d.image);
  // GW-035: friendly confirm dialog instead of the browser's window.confirm.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteFormRef = useRef<HTMLFormElement>(null);
  const [imageAlt, setImageAlt] = useState(d.image_alt);
  const [imageFocus, setImageFocus] = useState(d.image_focus);
  const [textAlign, setTextAlign] = useState(d.text_align);
  const [eyebrow, setEyebrow] = useState(d.eyebrow);
  const [title, setTitle] = useState(d.title);
  const [description, setDescription] = useState(d.description);
  const [enabled, setEnabled] = useState(d.enabled);

  // R47: advanced options (same as the Shop / Loyalty banners). null = the
  // classic slide; the first change creates the advanced value.
  const initialAdv = useMemo(
    () =>
      normalizeHomeSlideAdvanced(
        slide.draft_advanced !== undefined ? slide.draft_advanced : (slide.advanced ?? null),
      ),
    [slide.draft_advanced, slide.advanced],
  );
  const [adv, setAdv] = useState<HomeSlideAdvanced | null>(initialAdv);
  const [advOpen, setAdvOpen] = useState<boolean>(!!initialAdv);
  const advSerialized = serializeHomeSlideAdvanced(adv) ?? "";
  const advInitialSerialized = serializeHomeSlideAdvanced(initialAdv) ?? "";
  const words = { eyebrow, title, description };
  function patchAdv(patch: Partial<HomeSlideAdvanced>) {
    setAdv((cur) => ({ ...(cur ?? defaultHomeSlideAdvanced()), ...patch }));
  }
  function patchLine(which: "eyebrow" | "title" | "description", patch: Partial<HomeLineStyle>) {
    setAdv((cur) => {
      const base = cur ?? defaultHomeSlideAdvanced();
      const next: HomeSlideAdvanced = { ...base, [which]: { ...base[which], ...patch } };
      // Same fix as the Shop banner eyebrow: ticking Show with a custom
      // design on makes sure the studio has a box for that line.
      if (next.design) {
        next.design = ensureBoundBoxes(
          next.design,
          homeLegacyWords(words, next),
          patch.show === true ? (which === "description" ? "subtitle" : which) : null,
        );
      }
      return next;
    });
  }
  const layout = effectiveLayout(
    { imageFocus: imageFocus as "left" | "center" | "right", textAlign: textAlign as "left" | "right" },
    adv,
  );

  const cta0 = d.ctas[0] ?? { label: "", href: "", variant: "solid" as const };
  const cta1 = d.ctas[1] ?? { label: "", href: "", variant: "outline" as const };
  const [cta0Label, setCta0Label] = useState(cta0.label);
  const [cta0Href, setCta0Href] = useState(cta0.href);
  const [cta0Variant, setCta0Variant] = useState(cta0.variant);
  const [cta1Label, setCta1Label] = useState(cta1.label);
  const [cta1Href, setCta1Href] = useState(cta1.href);
  const [cta1Variant, setCta1Variant] = useState(cta1.variant);

  const unsaved =
    image !== d.image ||
    imageAlt !== d.image_alt ||
    imageFocus !== d.image_focus ||
    textAlign !== d.text_align ||
    eyebrow !== d.eyebrow ||
    title !== d.title ||
    description !== d.description ||
    enabled !== d.enabled ||
    cta0Label !== cta0.label ||
    cta0Href !== cta0.href ||
    cta0Variant !== cta0.variant ||
    cta1Label !== cta1.label ||
    cta1Href !== cta1.href ||
    cta1Variant !== cta1.variant ||
    advSerialized !== advInitialSerialized;

  useEffect(() => {
    if (!unsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsaved]);

  const inputCls =
    "w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--admin-accent)]/60";
  const labelCls =
    "mb-1 block text-[0.7rem] font-semibold uppercase tracking-wide text-white/60";

  return (
    <div
      id={`slide-${slide.id}`}
      className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#0f0f0f] p-5"
    >
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--admin-accent)]/15 text-sm font-bold text-[var(--admin-accent)]">
            {index + 1}
          </span>
          <span className="text-sm font-semibold text-white">
            {title || slide.title || "Untitled slide"}
          </span>
          {unsaved ? (
            <span className="rounded-full bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-gold)]">
              ● unsaved edits
            </span>
          ) : slide.dirty ? (
            <span className="rounded-full bg-[var(--admin-orange)]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-orange)]">
              unpublished draft
            </span>
          ) : (
            <span className="rounded-full bg-[var(--admin-accent)]/12 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-accent)]">
              live
            </span>
          )}
          {!enabled ? (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] font-semibold text-white/60">
              hidden
            </span>
          ) : null}
        </div>

        {/* Reorder + delete (separate forms so they don't submit the editor) */}
        <div className="flex items-center gap-1.5">
          <form action={moveAction}>
            <input type="hidden" name="slide_id" value={slide.id} />
            <input type="hidden" name="direction" value="up" />
            <Button type="submit" disabled={index === 0} aria-label="Move up" variant="neutral" size="sm">
              ↑
            </Button>
          </form>
          <form action={moveAction}>
            <input type="hidden" name="slide_id" value={slide.id} />
            <input type="hidden" name="direction" value="down" />
            <Button type="submit" disabled={index === total - 1} aria-label="Move down" variant="neutral" size="sm">
              ↓
            </Button>
          </form>
          <form ref={deleteFormRef} action={deleteAction}>
            <input type="hidden" name="slide_id" value={slide.id} />
            <Button type="button" variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </form>
          <ConfirmDialog
            open={confirmDelete}
            title="Delete this slide?"
            description="This removes it from the homepage and can't be undone."
            confirmLabel="Delete slide"
            tone="danger"
            onConfirm={() => {
              setConfirmDelete(false);
              deleteFormRef.current?.requestSubmit();
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        </div>
      </div>

      {/* Editor form */}
      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="slide_id" value={slide.id} />
        {/* Mirror controlled values into hidden inputs the action reads. */}
        <input type="hidden" name="image" value={image} />
        <input type="hidden" name="image_focus" value={imageFocus} />
        <input type="hidden" name="text_align" value={textAlign} />
        <input type="hidden" name="cta0_variant" value={cta0Variant} />
        <input type="hidden" name="cta1_variant" value={cta1Variant} />
        {/* R47: advanced options JSON ("" = classic slide). */}
        <input type="hidden" name="advanced" value={advSerialized} />

        {/* Background image */}
        <div>
          <span className={labelCls}>Background image (textless art works best)</span>
          <ContentImageField
            value={image}
            onChange={setImage}
            mediaChoices={mediaChoices}
            spec={CAROUSEL_SLIDE_SPEC}
            allowVideo
          />
        </div>

        <div>
          <label className={labelCls}>Image alt text (for accessibility)</label>
          <input
            className={inputCls}
            name="image_alt"
            value={imageAlt}
            onChange={(e) => setImageAlt(e.target.value)}
            placeholder="Describe the image briefly"
          />
        </div>

        <DesignCard
          mediaChoices={mediaChoices}
          title="Design Studio"
          description="Design the slide right on the picture: drag text and buttons, double-click any text to type on it (Enter = new line), click an item then use the arrow keys to nudge it (Shift = bigger steps), and Undo / Redo any change. Studio buttons replace the two classic buttons. Untick to go back to the classic look (Basic mode below)."
          design={adv?.design ?? null}
          onChange={(dsg: BannerDesign | null) =>
            setAdv((cur) => {
              const next: HomeSlideAdvanced = { ...(cur ?? defaultHomeSlideAdvanced()) };
              if (dsg) next.design = dsg;
              else delete next.design;
              return next;
            })
          }
          legacy={homeLegacyWords(words, adv)}
          imageSrc={image}
          imageAlt={imageAlt}
          preset="hero"
          seed={{
            ...homeLegacyWords(words, adv),
            textAlign: layout.textAlign,
            verticalAlign: layout.verticalAlign,
            imageFocus: layout.imageFocus,
            buttons: [
              { label: cta0Label, href: cta0Href, variant: cta0Variant === "outline" ? "outline" : "solid" },
              { label: cta1Label, href: cta1Href, variant: cta1Variant === "outline" ? "outline" : "solid" },
            ].filter((b) => b.label.trim() && b.href.trim()) as {
              label: string;
              href: string;
              variant: "solid" | "outline";
            }[],
          }}
          posts={posts}
          onLegacyEdit={(bind, text) => {
            if (bind === "eyebrow") setEyebrow(text);
            else if (bind === "title") setTitle(text);
            else setDescription(text);
          }}
        />

        <div className="rounded-lg border border-white/10 p-3">
          <span className={labelCls}>🗓️ Schedule — show only between (optional, your local time)</span>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-white/60">
              Start
              <input
                type="datetime-local"
                className={`${inputCls} mt-1`}
                value={toLocalInput(adv?.scheduleStart ?? null)}
                onChange={(e) => patchAdv({ scheduleStart: fromLocalInput(e.target.value) })}
              />
            </label>
            <label className="text-xs text-white/60">
              End
              <input
                type="datetime-local"
                className={`${inputCls} mt-1`}
                value={toLocalInput(adv?.scheduleEnd ?? null)}
                onChange={(e) => patchAdv({ scheduleEnd: fromLocalInput(e.target.value) })}
              />
            </label>
          </div>
          <p className="mt-1 text-xs text-white/40">
            Outside these times the slide is hidden from visitors (staff preview still shows it).
          </p>
        </div>

        {/* R53: Basic mode — collapsed under the studio. A native <details>
            keeps every field inside the form, so closed fields still save. */}
        <details className="rounded-lg border border-white/10 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-white">
            Basic mode{" "}
            <span className="font-normal text-white/50">
              (classic words, buttons, fonts, colours, focus and centring)
            </span>
          </summary>
          <div className="mt-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={labelCls}>Image focus</span>
              <select
                className={inputCls}
                value={imageFocus}
                onChange={(e) =>
                  setImageFocus(e.target.value as typeof imageFocus)
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div>
              <span className={labelCls}>Text side</span>
              <select
                className={inputCls}
                value={textAlign}
                onChange={(e) =>
                  setTextAlign(e.target.value as typeof textAlign)
                }
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>Eyebrow (small label above the title)</label>
            <input
              className={inputCls}
              name="eyebrow"
              value={eyebrow}
              onChange={(e) => setEyebrow(e.target.value)}
              placeholder="e.g. Deal of the Day"
            />
          </div>
          <div>
            <label className={labelCls}>Title (the big headline)</label>
            <input
              className={inputCls}
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Premium Cannabis, Everyday Deals"
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Description (press Enter to start a new line)</label>
          <textarea
            className={`${inputCls} min-h-[64px] resize-y`}
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One or two supporting sentences."
          />
        </div>

        {/* CTAs */}
        <div className="grid gap-4 md:grid-cols-2">
          <fieldset className="rounded-lg border border-white/10 p-3">
            <legend className="px-1 text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">
              Button 1 (primary)
            </legend>
            <input
              className={`${inputCls} mb-2`}
              name="cta0_label"
              value={cta0Label}
              onChange={(e) => setCta0Label(e.target.value)}
              placeholder="Button text (e.g. Shop the Menu)"
            />
            <input
              className={`${inputCls} mb-2`}
              name="cta0_href"
              value={cta0Href}
              onChange={(e) => setCta0Href(e.target.value)}
              placeholder="Links to (e.g. /menu)"
            />
            <select
              className={inputCls}
              value={cta0Variant}
              onChange={(e) =>
                setCta0Variant(e.target.value as typeof cta0Variant)
              }
            >
              <option value="solid">Solid (filled)</option>
              <option value="outline">Outline</option>
            </select>
          </fieldset>
          <fieldset className="rounded-lg border border-white/10 p-3">
            <legend className="px-1 text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">
              Button 2 (optional)
            </legend>
            <input
              className={`${inputCls} mb-2`}
              name="cta1_label"
              value={cta1Label}
              onChange={(e) => setCta1Label(e.target.value)}
              placeholder="Button text (e.g. Today's Specials)"
            />
            <input
              className={`${inputCls} mb-2`}
              name="cta1_href"
              value={cta1Href}
              onChange={(e) => setCta1Href(e.target.value)}
              placeholder="Links to (e.g. /specials)"
            />
            <select
              className={inputCls}
              value={cta1Variant}
              onChange={(e) =>
                setCta1Variant(e.target.value as typeof cta1Variant)
              }
            >
              <option value="solid">Solid (filled)</option>
              <option value="outline">Outline</option>
            </select>
          </fieldset>
        </div>

        {/* R47: advanced options — same features as the Shop / Loyalty banners */}
        <div className="rounded-lg border border-white/10 p-3">
          <button
            type="button"
            onClick={() => setAdvOpen((v) => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
            aria-expanded={advOpen}
          >
            <span>
              ✨ Advanced options{" "}
              <span className="font-normal text-white/50">
                (fonts, colours, focus, centring)
              </span>
            </span>
            <span className="text-white/50">{advOpen ? "▾" : "▸"}</span>
          </button>
          {advOpen ? (
            <div className="mt-4 space-y-4">
              <p className="text-xs text-white/50">
                Everything here is optional. Leave a font or colour on <strong>Classic</strong> to keep
                today&apos;s look. These settings override the basic Image focus / Text side above.
              </p>

              <div className="grid gap-3 lg:grid-cols-3">
                <LineStyleEditor
                  title="Eyebrow"
                  line={(adv ?? defaultHomeSlideAdvanced()).eyebrow}
                  onChange={(p) => patchLine("eyebrow", p)}
                />
                <LineStyleEditor
                  title="Title"
                  line={(adv ?? defaultHomeSlideAdvanced()).title}
                  onChange={(p) => patchLine("title", p)}
                />
                <LineStyleEditor
                  title="Description"
                  line={(adv ?? defaultHomeSlideAdvanced()).description}
                  onChange={(p) => patchLine("description", p)}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <span className={labelCls}>Picture focus — computer</span>
                  <Pills
                    options={IMAGE_FOCUSES}
                    labels={FOCUS_LABELS}
                    value={layout.imageFocus}
                    onChange={(v) => patchAdv({ imageFocus: v })}
                  />
                </div>
                <div>
                  <span className={labelCls}>Picture focus — phone</span>
                  <Pills
                    options={IMAGE_FOCUSES}
                    labels={FOCUS_LABELS}
                    value={layout.imageFocusMobile}
                    onChange={(v) => patchAdv({ imageFocusMobile: v })}
                  />
                </div>
                <div>
                  <span className={labelCls}>Text — left / centre / right</span>
                  <Pills
                    options={TEXT_ALIGNS}
                    labels={ALIGN_LABELS}
                    value={layout.textAlign}
                    onChange={(v) => patchAdv({ textAlign: v })}
                  />
                </div>
                <div>
                  <span className={labelCls}>Text — top / middle / bottom</span>
                  <Pills
                    options={TEXT_VALIGNS}
                    labels={VALIGN_LABELS}
                    value={layout.verticalAlign}
                    onChange={(v) => patchAdv({ verticalAlign: v })}
                  />
                </div>
              </div>

              {adv ? (
                <button
                  type="button"
                  onClick={() => setAdv(null)}
                  className="text-xs text-white/50 underline hover:text-white"
                >
                  Reset all advanced options (back to the classic slide)
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

          </div>
        </details>

        {/* Enable + actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              name="draft_enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--admin-accent)]"
            />
            Show this slide on the homepage
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" variant={unsaved ? "save" : "neutral"}>
              {unsaved ? "Save draft ●" : "Save draft"}
            </Button>
          </div>
        </div>
      </form>

      {/* Publish is a separate form (publishes the saved draft → live). */}
      <form action={publishAction} className="mt-3 border-t border-white/10 pt-3">
        <input type="hidden" name="slide_id" value={slide.id} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-white/50">
            {unsaved
              ? "Save your draft first, then publish to make it live."
              : slide.dirty
                ? "This slide has changes that aren't live yet."
                : "This slide is live and matches what visitors see."}
          </p>
          <Button type="submit" disabled={unsaved} variant="confirm">
            Publish to homepage
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── R47 helpers ─────────────────────────────────────────────────────────────

const FOCUS_LABELS: Record<ImageFocus, string> = {
  center: "Center",
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};
const ALIGN_LABELS: Record<TextAlign, string> = { left: "Left", center: "Center", right: "Right" };
const VALIGN_LABELS: Record<TextVAlign, string> = { top: "Top", center: "Middle", bottom: "Bottom" };

function Pills<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          aria-pressed={value === o}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            value === o
              ? "bg-[var(--admin-accent)]/15 text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
              : "border border-white/15 text-white/60 hover:text-white"
          }`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

function LineStyleEditor({
  title,
  line,
  onChange,
}: {
  title: string;
  line: HomeLineStyle;
  onChange: (patch: Partial<HomeLineStyle>) => void;
}) {
  const sel =
    "w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--admin-accent)]/60";
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-white/70">{title}</span>
        <label className="flex items-center gap-1.5 text-xs text-white/60">
          <input type="checkbox" checked={line.show} onChange={(e) => onChange({ show: e.target.checked })} />
          Show
        </label>
      </div>
      <label className="mb-2 block text-[0.65rem] uppercase tracking-wide text-white/50">
        Font
        <select className={`${sel} mt-1`} value={line.font} onChange={(e) => onChange({ font: e.target.value })}>
          <option value="">Classic (site font)</option>
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
      <div className="text-[0.65rem] uppercase tracking-wide text-white/50">Colour</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <button
          type="button"
          title="Classic colour"
          onClick={() => onChange({ color: "" })}
          className={`h-7 rounded-full border px-2 text-[0.6rem] text-white/70 ${
            line.color === "" ? "ring-2 ring-[var(--admin-accent)]" : "border-white/20"
          }`}
        >
          Classic
        </button>
        {HERO_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.label}
            aria-label={c.label}
            onClick={() => onChange({ color: c.id })}
            className={`h-7 w-7 rounded-full border transition ${
              line.color === c.id ? "ring-2 ring-[var(--admin-accent)]" : "border-white/20 hover:scale-105"
            }`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
      {isScriptHeroFont(line.font) ? (
        <label className="mt-2 block text-[0.65rem] uppercase tracking-wide text-white/50">
          Cursive size ({line.scriptScale.toFixed(1)}×)
          <input
            type="range"
            min={SCRIPT_SCALE_MIN}
            max={SCRIPT_SCALE_MAX}
            step={0.1}
            value={line.scriptScale}
            onChange={(e) => onChange({ scriptScale: Number(e.target.value) })}
            className="mt-1 w-full accent-[var(--admin-accent)]"
          />
        </label>
      ) : null}
    </div>
  );
}

/** ISO → <input type="datetime-local"> value (browser local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
/** datetime-local value → ISO (null when blank). */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}
