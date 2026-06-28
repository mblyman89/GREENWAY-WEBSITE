"use client";

/**
 * MediaMetaEditor — Slice 6 "smart metadata" editor for a single asset.
 * Structured WHAT / WHY / WHERE inputs with live, advisory guardrail warnings
 * and an optional one-click AI auto-fill (drafts-only; staff review before save).
 *
 * It posts to the existing updateMediaMetaAction via a normal <form>, so server
 * validation/normalisation still applies. The "Suggest" actions are passed in as
 * props from the server page (they call the server actions).
 */
import { useState, useTransition } from "react";
import {
  MEDIA_PURPOSES,
  PLACEMENT_SUGGESTIONS,
  checkMediaMeta,
  type MediaWarning,
} from "@/lib/media/taxonomy";
import type { MediaAltResult, MediaMetaResult } from "@/app/admin/media/actions";

// NOTE: these are type-only imports from the server actions module — no server
// code is bundled into the client; only the action functions passed as props
// (formAction/suggestAlt/suggestMeta) cross the boundary at runtime.

const field =
  "w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]";
const label = "mb-1 block text-xs font-medium text-white/50";

export function MediaMetaEditor({
  id,
  initial,
  mimeType,
  filename,
  aiEnabled,
  formAction,
  suggestAlt,
  suggestMeta,
}: {
  id: string;
  initial: {
    title: string;
    description: string;
    alt_text: string;
    usage_type: string;
    tags: string;
  };
  mimeType: string | null;
  filename: string | null;
  aiEnabled: boolean;
  formAction: (formData: FormData) => void | Promise<void>;
  suggestAlt: (id: string) => Promise<MediaAltResult>;
  suggestMeta: (id: string) => Promise<MediaMetaResult>;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [altText, setAltText] = useState(initial.alt_text);
  const [purpose, setPurpose] = useState(initial.usage_type);
  const [tags, setTags] = useState(initial.tags);

  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const warnings: MediaWarning[] = checkMediaMeta({
    filename,
    title,
    description,
    alt_text: altText,
    usage_type: purpose,
    tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    mime_type: mimeType,
  });

  function runMeta() {
    setNote(null);
    startTransition(async () => {
      const res = await suggestMeta(id);
      if (!res.ok) {
        setNote(res.error);
        return;
      }
      if (res.title) setTitle(res.title);
      if (res.description) setDescription(res.description);
      setNote(`Auto-filled from ${res.method === "vision" ? "the image" : "context"} — review & save.`);
    });
  }

  function runAlt() {
    setNote(null);
    startTransition(async () => {
      const res = await suggestAlt(id);
      if (!res.ok) {
        setNote(res.error);
        return;
      }
      setAltText(res.value);
      setNote(`Alt text suggested from ${res.method === "vision" ? "the image" : "context"} — review & save.`);
    });
  }

  const isImage = Boolean(mimeType && mimeType.startsWith("image/"));

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
      <input type="hidden" name="id" value={id} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">Smart metadata</p>
        {aiEnabled ? (
          <button
            type="button"
            onClick={runMeta}
            disabled={pending}
            className="rounded-full border border-[#7ed957]/40 px-3 py-1.5 text-xs font-semibold text-[#7ed957] hover:bg-[#7ed957]/10 disabled:opacity-50"
          >
            {pending ? "Thinking…" : "✨ Auto-fill title & description"}
          </button>
        ) : null}
      </div>

      {note ? (
        <p className="rounded-lg border border-[#7ed957]/30 bg-[#7ed957]/10 px-3 py-2 text-xs text-[#7ed957]">{note}</p>
      ) : null}

      {/* WHAT */}
      <label className="block">
        <span className={label}>
          What is it? <span className="text-white/30">(title)</span>
        </span>
        <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      </label>

      <label className="block">
        <span className={label}>
          Describe it <span className="text-white/30">(what it shows / says)</span>
        </span>
        <textarea
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={field}
        />
      </label>

      {/* Accessibility / alt */}
      <label className="block">
        <span className={`${label} flex items-center justify-between`}>
          <span>Alt text {isImage ? <span className="text-white/30">(accessibility & SEO)</span> : null}</span>
          {aiEnabled && isImage ? (
            <button
              type="button"
              onClick={runAlt}
              disabled={pending}
              className="text-[10px] font-semibold text-[#7ed957] hover:underline disabled:opacity-50"
            >
              ✨ Suggest
            </button>
          ) : null}
        </span>
        <input name="alt_text" value={altText} onChange={(e) => setAltText(e.target.value)} className={field} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* WHY */}
        <label className="block">
          <span className={label}>
            Why / purpose <span className="text-white/30">(category)</span>
          </span>
          <select name="usage_type" value={purpose} onChange={(e) => setPurpose(e.target.value)} className={field}>
            <option value="">— choose a purpose —</option>
            {MEDIA_PURPOSES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {purpose ? (
            <span className="mt-1 block text-[11px] text-white/40">
              {MEDIA_PURPOSES.find((p) => p.id === purpose)?.hint}
            </span>
          ) : null}
        </label>

        {/* WHERE */}
        <label className="block">
          <span className={label}>
            Where used <span className="text-white/30">(placement tags)</span>
          </span>
          <input
            name="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            list="placement-suggestions-edit"
            placeholder="home-hero, menu-banner"
            className={field}
          />
          <datalist id="placement-suggestions-edit">
            {PLACEMENT_SUGGESTIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
      </div>

      {/* Guardrails (advisory) */}
      {warnings.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-[#ffd700]/25 bg-[#ffd700]/5 p-3 text-[11px] text-[#ffd700]">
          {warnings.map((w, i) => (
            <li key={i}>• {w.text}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-[#7ed957]/80">✓ Looks good — all best-practice checks pass.</p>
      )}

      <button
        type="submit"
        className="rounded-full bg-[#7ed957] px-5 py-2 text-sm font-semibold text-black hover:bg-[#6cc746]"
      >
        Save metadata
      </button>
    </form>
  );
}
