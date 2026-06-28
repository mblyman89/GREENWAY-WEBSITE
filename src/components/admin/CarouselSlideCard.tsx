"use client";

import { useEffect, useState } from "react";
import { ContentImageField, type MediaChoice } from "./ContentImageField";
import type { SlideAdminVM, SlideCta } from "@/lib/cms/carousel-types";

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
}: {
  slide: SlideAdminVM;
  index: number;
  total: number;
  mediaChoices: MediaChoice[];
  saveAction: (formData: FormData) => void | Promise<void>;
  publishAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  moveAction: (formData: FormData) => void | Promise<void>;
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
  const [imageAlt, setImageAlt] = useState(d.image_alt);
  const [imageFocus, setImageFocus] = useState(d.image_focus);
  const [textAlign, setTextAlign] = useState(d.text_align);
  const [eyebrow, setEyebrow] = useState(d.eyebrow);
  const [title, setTitle] = useState(d.title);
  const [description, setDescription] = useState(d.description);
  const [enabled, setEnabled] = useState(d.enabled);

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
    cta1Variant !== cta1.variant;

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
    "w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#7ed957]/60";
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
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#7ed957]/15 text-sm font-bold text-[#7ed957]">
            {index + 1}
          </span>
          <span className="text-sm font-semibold text-white">
            {title || slide.title || "Untitled slide"}
          </span>
          {unsaved ? (
            <span className="rounded-full bg-[#ffd700]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[#ffd700]">
              ● unsaved edits
            </span>
          ) : slide.dirty ? (
            <span className="rounded-full bg-[#ff7f00]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[#ff7f00]">
              unpublished draft
            </span>
          ) : (
            <span className="rounded-full bg-[#7ed957]/12 px-2 py-0.5 text-[0.65rem] font-semibold text-[#7ed957]">
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
            <button
              type="submit"
              disabled={index === 0}
              aria-label="Move up"
              className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/70 transition hover:bg-white/5 disabled:opacity-30"
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
              className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/70 transition hover:bg-white/5 disabled:opacity-30"
            >
              ↓
            </button>
          </form>
          <form
            action={deleteAction}
            onSubmit={(e) => {
              if (
                !window.confirm(
                  "Delete this slide? This removes it from the homepage and can't be undone.",
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="slide_id" value={slide.id} />
            <button
              type="submit"
              className="rounded-md border border-red-500/30 px-2 py-1 text-xs font-medium text-red-300 transition hover:bg-red-500/10"
            >
              Delete
            </button>
          </form>
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

        {/* Background image */}
        <div>
          <span className={labelCls}>Background image (textless art works best)</span>
          <ContentImageField
            value={image}
            onChange={setImage}
            mediaChoices={mediaChoices}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
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
          <label className={labelCls}>Description</label>
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

        {/* Enable + actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              name="draft_enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-[#7ed957]"
            />
            Show this slide on the homepage
          </label>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className={
                unsaved
                  ? "rounded-lg bg-[#ffd700] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#ffe34d]"
                  : "rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/5"
              }
            >
              {unsaved ? "Save draft ●" : "Save draft"}
            </button>
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
          <button
            type="submit"
            disabled={unsaved}
            className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#94e570] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Publish to homepage
          </button>
        </div>
      </form>
    </div>
  );
}
