"use client";

/**
 * BlogEditorClient — the visual, Squarespace-style editing surface for a blog
 * post (UX-3). It wraps the SAME server actions (updatePostAction etc.) and
 * adds, on top of the existing fields:
 *
 *   - a faithful, side-by-side LIVE PREVIEW of the public article that updates
 *     as the author types (title, category, author, date, excerpt, body, and a
 *     locally-previewed hero image)
 *   - live character counters with gentle SEO-length guidance on the SEO + key
 *     fields (mirrors the Site Content editor)
 *   - an "✨ Suggest alt text" button (drafts-only AI) for the hero image
 *
 * Server enforcement is unchanged: saving still posts to the permission-gated
 * updatePostAction. This component only improves the editing experience; it
 * holds the editable fields in local state purely to drive the live preview.
 */
import { useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useToast } from "@/components/admin/ux";
import { suggestHeroAltAction } from "@/app/admin/blog/actions";

export type BlogEditorInitial = {
  id: string;
  title: string;
  slug: string;
  category: string;
  kind: string;
  author: string;
  excerpt: string;
  body: string; // paragraphs separated by blank lines
  heroImageSrc: string | null;
  heroImageAlt: string;
  dateLabel: string;
  publishDate: string; // datetime-local value or ""
  seoTitle: string;
  seoDescription: string;
  canonicalPath: string;
  noindex: boolean;
  newsletterPagePaths: string;
  heroImagePath: string | null;
};

type Props = {
  initial: BlogEditorInitial;
  categories: readonly string[];
  aiEnabled: boolean;
  updateAction: (formData: FormData) => void | Promise<void>;
};

const fieldCls =
  "w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50";

/** Inline live character counter with optional SEO target guidance. */
function CharCount({
  value,
  min,
  max,
}: {
  value: string;
  min?: number;
  max?: number;
}) {
  const len = value.length;
  let tone = "text-white/40";
  let note = "";
  if (typeof max === "number" && len > max) {
    tone = "text-[#ff7f00]";
    note = ` · ${len - max} over ideal`;
  } else if (typeof min === "number" && len > 0 && len < min) {
    tone = "text-[#ffd700]";
    note = " · a bit short";
  } else if (typeof min === "number" && len >= min) {
    tone = "text-[#7ed957]";
    note = " · good length";
  }
  const range =
    typeof min === "number" && typeof max === "number"
      ? ` / ${min}–${max}`
      : typeof max === "number"
        ? ` / ${max}`
        : "";
  return (
    <span className={`text-[0.7rem] font-medium ${tone}`}>
      {len}
      {range} chars{note}
    </span>
  );
}

export function BlogEditorClient({ initial, categories, aiEnabled, updateAction }: Props) {
  const { toast } = useToast();
  const [aiPending, startAi] = useTransition();

  // Live-preview state (drives the right-hand preview only).
  const [title, setTitle] = useState(initial.title);
  const [category, setCategory] = useState(initial.category);
  const [author, setAuthor] = useState(initial.author);
  const [excerpt, setExcerpt] = useState(initial.excerpt);
  const [body, setBody] = useState(initial.body);
  const [dateLabel, setDateLabel] = useState(initial.dateLabel);
  const [heroAlt, setHeroAlt] = useState(initial.heroImageAlt);
  const [seoTitle, setSeoTitle] = useState(initial.seoTitle);
  const [seoDescription, setSeoDescription] = useState(initial.seoDescription);
  const [kind, setKind] = useState(initial.kind);

  // Local hero preview (object URL when a new file is picked).
  const [heroPreview, setHeroPreview] = useState<string | null>(initial.heroImageSrc);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const paragraphs = useMemo(
    () =>
      body
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean),
    [body],
  );

  function onPickHero(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setHeroPreview(URL.createObjectURL(file));
  }

  function onSuggestAlt() {
    startAi(async () => {
      const res = await suggestHeroAltAction(initial.id, title, category);
      if (res.ok) {
        setHeroAlt(res.value);
        toast({
          tone: res.complianceFlags.length > 0 ? "warning" : "success",
          message:
            res.complianceFlags.length > 0
              ? `Alt text suggested — ${res.complianceFlags.length} compliance flag(s) to review.`
              : "Alt text suggested — review and save.",
        });
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  const previewDate = dateLabel || (initial.publishDate ? initial.publishDate.slice(0, 10) : "Draft");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------------- LEFT: editor form ---------------- */}
      <form action={updateAction} encType="multipart/form-data" className="space-y-5">
        <input type="hidden" name="id" value={initial.id} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between">
              <label className={labelCls}>Title</label>
              <CharCount value={title} min={20} max={70} />
            </div>
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={fieldCls}
            />
          </div>
          <div>
            <label className={labelCls}>Slug</label>
            <input name="slug" defaultValue={initial.slug} className={fieldCls} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Category</label>
            <select
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={fieldCls}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Kind</label>
            <select
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={fieldCls}
            >
              <option value="article">Article</option>
              <option value="newsletter">Newsletter</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Author</label>
            <input
              name="author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className={fieldCls}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className={labelCls}>Excerpt</label>
            <CharCount value={excerpt} min={60} max={160} />
          </div>
          <textarea
            name="excerpt"
            rows={2}
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            className={fieldCls}
          />
        </div>

        <div>
          <label className={labelCls}>Body (paragraphs separated by a blank line)</label>
          <textarea
            name="body"
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={fieldCls}
          />
          <p className="mt-1 text-[0.7rem] text-white/40">
            {paragraphs.length} paragraph{paragraphs.length === 1 ? "" : "s"} ·{" "}
            {body.trim() ? body.trim().split(/\s+/).length : 0} words
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Hero image (upload)</label>
            <input
              ref={fileRef}
              type="file"
              name="hero_image"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={onPickHero}
              className="w-full text-xs text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
            {initial.heroImagePath && (
              <p className="mt-1 text-xs text-white/40">Current: {initial.heroImagePath}</p>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className={labelCls}>Hero image alt text</label>
              {aiEnabled && (
                <button
                  type="button"
                  onClick={onSuggestAlt}
                  disabled={aiPending}
                  className="rounded-md border border-[#ffd700]/40 px-2 py-0.5 text-[0.7rem] font-bold text-[#ffd700] transition hover:bg-[#ffd700]/10 disabled:opacity-50"
                >
                  {aiPending ? "…thinking" : "✨ Suggest alt text"}
                </button>
              )}
            </div>
            <input
              name="hero_image_alt"
              value={heroAlt}
              onChange={(e) => setHeroAlt(e.target.value)}
              className={fieldCls}
            />
            <p className="mt-1 text-[0.7rem] text-white/40">
              Describe the image for screen readers + SEO.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Publish date (optional)</label>
            <input
              name="publish_date"
              type="datetime-local"
              defaultValue={initial.publishDate}
              className={fieldCls}
            />
          </div>
          <div>
            <label className={labelCls}>Date label</label>
            <input
              name="date_label"
              value={dateLabel}
              onChange={(e) => setDateLabel(e.target.value)}
              className={fieldCls}
            />
          </div>
        </div>

        {/* Newsletter assets */}
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-white/50">
            Newsletter assets (used only when Kind = newsletter)
          </h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-white/50">PDF upload</label>
              <input
                type="file"
                name="pdf_file"
                accept="application/pdf"
                className="w-full text-xs text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-white/50">
                Page image paths (one per line; first = preview)
              </label>
              <textarea
                name="page_paths"
                rows={3}
                defaultValue={initial.newsletterPagePaths}
                placeholder="/blog/newsletters/2026-06-20-p1.png"
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-xs text-white outline-none focus:border-[#7ed957]"
              />
            </div>
          </div>
        </div>

        {/* SEO */}
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-white/50">SEO</h3>
          <div className="mt-3 space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <label className="mb-1 block text-xs font-semibold text-white/50">SEO title</label>
                <CharCount value={seoTitle} min={50} max={60} />
              </div>
              <input
                name="seo_title"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                className={fieldCls}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="mb-1 block text-xs font-semibold text-white/50">
                  SEO description
                </label>
                <CharCount value={seoDescription} min={140} max={160} />
              </div>
              <textarea
                name="seo_description"
                rows={2}
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                className={fieldCls}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-white/50">
                  Canonical path (optional)
                </label>
                <input name="canonical_path" defaultValue={initial.canonicalPath} className={fieldCls} />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  name="noindex"
                  defaultChecked={initial.noindex}
                  className="h-4 w-4"
                />
                Noindex this post
              </label>
            </div>
            {/* Google-style search preview */}
            <div className="rounded-lg border border-white/10 bg-black p-3">
              <div className="text-xs text-white/40">Search preview</div>
              <div className="mt-1 text-sm text-[#8ab4f8]">{seoTitle || title}</div>
              <div className="text-xs text-[#7ed957]/80">greenwaymarijuana.com/blog/{initial.slug}</div>
              <div className="mt-0.5 text-xs text-white/55">
                {seoDescription || excerpt || "Add an SEO description to control this snippet."}
              </div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-[#7ed957] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#6bc746]"
        >
          Save changes
        </button>
      </form>

      {/* ---------------- RIGHT: live preview ---------------- */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#7ed957]" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
            Live preview · how it looks on the site
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40">
          {kind === "newsletter" ? (
            <div className="space-y-3 p-6">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#ff7f00]">
                Newsletter
              </p>
              <h1 className="text-2xl font-black leading-tight text-white">{title || "Untitled"}</h1>
              <p className="text-sm text-white/55">
                Newsletter pages render from the uploaded PDF / page images.
              </p>
            </div>
          ) : (
            <>
              <div className="relative min-h-[16rem] overflow-hidden bg-zinc-900">
                {heroPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={heroPreview} alt={heroAlt} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-white/30">
                    <span className="text-xs">No hero image yet</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-black/10" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <p className="text-[0.7rem] font-black uppercase tracking-[0.18em] text-[#ff7f00]">
                    {previewDate}
                  </p>
                  <h1 className="mt-2 text-2xl font-black leading-tight tracking-tight text-white md:text-3xl">
                    {title || "Untitled post"}
                  </h1>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.7rem] font-black uppercase tracking-[0.14em] text-zinc-300">
                    <span>{author || "Greenway Team"}</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-[#7ed957]" aria-hidden />
                    <span className="rounded-full bg-[#ff7f00] px-2 py-0.5 text-black">{category}</span>
                  </div>
                </div>
              </div>
              <div className="px-6 py-6">
                <div className="space-y-4 text-sm leading-7 text-zinc-200">
                  {paragraphs.length > 0 ? (
                    paragraphs.map((p, i) => <p key={i}>{p}</p>)
                  ) : (
                    <p className="italic text-white/30">
                      Start writing the body — paragraphs appear here as you type.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <p className="mt-2 text-center text-[0.7rem] text-white/35">
          Approximate preview · final styling matches the public blog. Remember to <strong>Save</strong>,
          then Publish.
        </p>
      </div>
    </div>
  );
}
