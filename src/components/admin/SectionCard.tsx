"use client";

import { useEffect, useState } from "react";
import { ContentImageField, type MediaChoice } from "./ContentImageField";
import type {
  SectionAdminVM,
  SectionButton,
  SectionButtonVariant,
} from "@/lib/cms/page-sections-types";

/**
 * SectionCard — one editable page section (banner) in the generic per-page
 * builder. Generalizes CarouselSlideCard: image picker, eyebrow/title/subtitle/
 * body, layout knobs (image focus + text align), and a fully dynamic list of
 * call-to-action BUTTONS the editor can add / delete / relabel / restyle / hide
 * (up to 4). Edits the section's DRAFT via a plain <form> posting to a server
 * action. Locked sections render read-only.
 */

const MAX_BUTTONS = 4;

type DraftButton = SectionButton & { _id: string };

function withIds(buttons: SectionButton[]): DraftButton[] {
  return buttons.map((b, i) => ({ ...b, _id: `${i}-${b.label}-${b.href}` }));
}

export function SectionCard({
  section,
  index,
  total,
  mediaChoices,
  saveAction,
  publishAction,
  deleteAction,
  moveAction,
}: {
  section: SectionAdminVM;
  index: number;
  total: number;
  mediaChoices: MediaChoice[];
  saveAction: (formData: FormData) => void | Promise<void>;
  publishAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  moveAction: (formData: FormData) => void | Promise<void>;
}) {
  const locked = section.locked;

  const d = {
    image: section.draft_image ?? section.image ?? "",
    image_alt: section.draft_image_alt ?? section.image_alt ?? "",
    image_focus: section.draft_image_focus ?? section.image_focus ?? "center",
    text_align: section.draft_text_align ?? section.text_align ?? "left",
    eyebrow: section.draft_eyebrow ?? section.eyebrow ?? "",
    title: section.draft_title ?? section.title ?? "",
    subtitle: section.draft_subtitle ?? section.subtitle ?? "",
    body: section.draft_body ?? section.body ?? "",
    buttons: (section.draft_buttons ?? section.buttons ?? []) as SectionButton[],
    enabled: section.draft_enabled,
  };

  const [image, setImage] = useState(d.image);
  const [imageAlt, setImageAlt] = useState(d.image_alt);
  const [imageFocus, setImageFocus] = useState(d.image_focus);
  const [textAlign, setTextAlign] = useState(d.text_align);
  const [eyebrow, setEyebrow] = useState(d.eyebrow);
  const [title, setTitle] = useState(d.title);
  const [subtitle, setSubtitle] = useState(d.subtitle);
  const [body, setBody] = useState(d.body);
  const [enabled, setEnabled] = useState(d.enabled);
  const [buttons, setButtons] = useState<DraftButton[]>(withIds(d.buttons));

  const buttonsJson = JSON.stringify(
    buttons.map(({ _id, ...b }) => {
      void _id;
      return b;
    }),
  );
  const initialButtonsJson = JSON.stringify(d.buttons);

  const unsaved =
    !locked &&
    (image !== d.image ||
      imageAlt !== d.image_alt ||
      imageFocus !== d.image_focus ||
      textAlign !== d.text_align ||
      eyebrow !== d.eyebrow ||
      title !== d.title ||
      subtitle !== d.subtitle ||
      body !== d.body ||
      enabled !== d.enabled ||
      buttonsJson !== initialButtonsJson);

  useEffect(() => {
    if (!unsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsaved]);

  function addButton() {
    if (buttons.length >= MAX_BUTTONS) return;
    setButtons((prev) => [
      ...prev,
      {
        _id: `new-${Date.now()}`,
        label: "New button",
        href: "/menu",
        variant: "solid",
        enabled: true,
      },
    ]);
  }
  function removeButton(id: string) {
    setButtons((prev) => prev.filter((b) => b._id !== id));
  }
  function patchButton(id: string, patch: Partial<SectionButton>) {
    setButtons((prev) =>
      prev.map((b) => (b._id === id ? { ...b, ...patch } : b)),
    );
  }

  const inputCls =
    "w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#7ed957]/60";
  const labelCls =
    "mb-1 block text-[0.7rem] font-semibold uppercase tracking-wide text-white/60";

  return (
    <div
      id={`section-${section.id}`}
      className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#0f0f0f] p-5"
    >
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#7ed957]/15 text-sm font-bold text-[#7ed957]">
            {index + 1}
          </span>
          <span className="text-sm font-semibold text-white">
            {title || section.title || "Untitled section"}
          </span>
          {locked ? (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] font-semibold text-white/60">
              🔒 locked
            </span>
          ) : unsaved ? (
            <span className="rounded-full bg-[#ffd700]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[#ffd700]">
              ● unsaved edits
            </span>
          ) : section.dirty ? (
            <span className="rounded-full bg-[#ff7f00]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[#ff7f00]">
              unpublished draft
            </span>
          ) : (
            <span className="rounded-full bg-[#7ed957]/12 px-2 py-0.5 text-[0.65rem] font-semibold text-[#7ed957]">
              live
            </span>
          )}
          {!locked && !enabled ? (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] font-semibold text-white/60">
              hidden
            </span>
          ) : null}
        </div>

        {!locked ? (
          <div className="flex items-center gap-1.5">
            <form action={moveAction}>
              <input type="hidden" name="section_id" value={section.id} />
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
              <input type="hidden" name="section_id" value={section.id} />
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
                    "Delete this section? This removes it from the page and can't be undone.",
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="section_id" value={section.id} />
              <button
                type="submit"
                className="rounded-md border border-red-500/30 px-2 py-1 text-xs font-medium text-red-300 transition hover:bg-red-500/10"
              >
                Delete
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {locked ? (
        <p className="rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/60">
          This section is managed automatically (e.g. the daily-deal highlights)
          and isn&apos;t editable here.
        </p>
      ) : (
        <>
          {/* Editor form */}
          <form action={saveAction} className="space-y-4">
            <input type="hidden" name="section_id" value={section.id} />
            <input type="hidden" name="image" value={image} />
            <input type="hidden" name="image_focus" value={imageFocus} />
            <input type="hidden" name="text_align" value={textAlign} />
            <input type="hidden" name="buttons_json" value={buttonsJson} />

            {/* Background image */}
            <div>
              <span className={labelCls}>
                Background image (textless art works best)
              </span>
              <ContentImageField
                value={image}
                onChange={setImage}
                mediaChoices={mediaChoices}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={labelCls}>Image alt text (accessibility)</label>
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
                    <option value="center">Center</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </div>
                <div>
                  <span className={labelCls}>Text align</span>
                  <select
                    className={inputCls}
                    value={textAlign}
                    onChange={(e) =>
                      setTextAlign(e.target.value as typeof textAlign)
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={labelCls}>Eyebrow (small label above title)</label>
                <input
                  className={inputCls}
                  name="eyebrow"
                  value={eyebrow}
                  onChange={(e) => setEyebrow(e.target.value)}
                  placeholder="e.g. Find your vibe"
                />
              </div>
              <div>
                <label className={labelCls}>Title (the headline)</label>
                <input
                  className={inputCls}
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Shop by Category"
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Subtitle</label>
              <input
                className={inputCls}
                name="subtitle"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="One supporting sentence."
              />
            </div>

            <div>
              <label className={labelCls}>Body (optional, longer copy)</label>
              <textarea
                className={`${inputCls} min-h-[64px] resize-y`}
                name="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Extra paragraph if this section needs it."
              />
            </div>

            {/* Dynamic buttons */}
            <div className="rounded-lg border border-white/10 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">
                  Buttons ({buttons.length}/{MAX_BUTTONS})
                </span>
                <button
                  type="button"
                  onClick={addButton}
                  disabled={buttons.length >= MAX_BUTTONS}
                  className="rounded-md border border-[#7ed957]/40 px-2.5 py-1 text-xs font-semibold text-[#7ed957] transition hover:bg-[#7ed957]/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  + Add button
                </button>
              </div>
              {buttons.length === 0 ? (
                <p className="text-xs text-white/40">
                  No buttons yet. Click <strong>+ Add button</strong> to add a
                  call-to-action that links to another page.
                </p>
              ) : (
                <div className="space-y-2">
                  {buttons.map((b) => (
                    <div
                      key={b._id}
                      className="grid items-center gap-2 rounded-md border border-white/10 bg-black/30 p-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]"
                    >
                      <input
                        className={inputCls}
                        value={b.label}
                        onChange={(e) =>
                          patchButton(b._id, { label: e.target.value })
                        }
                        placeholder="Label (e.g. Shop the menu)"
                      />
                      <input
                        className={inputCls}
                        value={b.href}
                        onChange={(e) =>
                          patchButton(b._id, { href: e.target.value })
                        }
                        placeholder="Links to (e.g. /menu)"
                      />
                      <select
                        className={inputCls}
                        value={b.variant}
                        onChange={(e) =>
                          patchButton(b._id, {
                            variant: e.target.value as SectionButtonVariant,
                          })
                        }
                      >
                        <option value="solid">Solid</option>
                        <option value="outline">Outline</option>
                        <option value="ghost">Ghost</option>
                      </select>
                      <label className="flex items-center gap-1 whitespace-nowrap text-xs text-white/70">
                        <input
                          type="checkbox"
                          checked={b.enabled}
                          onChange={(e) =>
                            patchButton(b._id, { enabled: e.target.checked })
                          }
                          className="h-4 w-4 accent-[#7ed957]"
                        />
                        Show
                      </label>
                      <button
                        type="button"
                        onClick={() => removeButton(b._id)}
                        aria-label="Remove button"
                        className="rounded-md border border-red-500/30 px-2 py-1 text-xs font-medium text-red-300 transition hover:bg-red-500/10"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Enable + save */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  name="draft_enabled"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 accent-[#7ed957]"
                />
                Show this section on the page
              </label>
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
          </form>

          {/* Publish */}
          <form action={publishAction} className="mt-3 border-t border-white/10 pt-3">
            <input type="hidden" name="section_id" value={section.id} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-white/50">
                {unsaved
                  ? "Save your draft first, then publish to make it live."
                  : section.dirty
                    ? "This section has changes that aren't live yet."
                    : "This section is live and matches what visitors see."}
              </p>
              <button
                type="submit"
                disabled={unsaved}
                className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#94e570] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Publish to page
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
