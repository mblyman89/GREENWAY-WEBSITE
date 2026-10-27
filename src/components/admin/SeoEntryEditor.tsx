"use client";

/**
 * SeoEntryEditor — the per-page SEO card (PR C). One card per public route.
 * Wraps the existing `saveSeoEntryAction` server action and layers on:
 *   - live character counters for title (/60) and description (/160)
 *   - a live Google-style search preview that updates as you type
 *   - "✨ Generate with AI" → compliant title + description suggestion with
 *     Use / Try again / Discard and visible compliance flags (drafts-only;
 *     never auto-saves — staff must Use it then click Save)
 *
 * Server enforcement is unchanged: saving still goes through the
 * permission-gated server action; AI output is a suggestion the human must
 * accept. This component only improves the editing experience.
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { suggestSeoAction, type AiSeoSuggestResult } from "@/app/admin/content/actions";
import { finalTitle, titleHasBrand, SEO_TITLE_MAX, SEO_DESC_MAX } from "@/lib/seo/seo-override-core";

export type SeoEntryDraft = {
  path: string;
  seo_title: string;
  seo_description: string;
  canonical: string;
  noindex: boolean;
  sitemap_include: boolean;
  /** R47: social-share picture (media_assets id) or null for the default. */
  og_media_id?: string | null;
};

/** R47: a published still image the owner can use as the share picture. */
export type SeoImageChoice = {
  id: string;
  url: string;
  title: string;
  width: number | null;
  height: number | null;
};

type Props = {
  entry: SeoEntryDraft;
  aiEnabled: boolean;
  /** R47: Media Library still images for the share-picture picker. */
  imageChoices?: SeoImageChoice[];
  /** Server action passed in so this stays a pure client component. */
  saveAction: (formData: FormData) => void;
};

// R46-S2: one source of truth with the public pages (seo-override-core).
const TITLE_MAX = SEO_TITLE_MAX;
const DESC_MAX = SEO_DESC_MAX;

function counterTone(len: number, max: number): string {
  const near = Math.round(max * 0.85);
  if (len > max) return "text-red-400";
  if (len >= near) return "text-[var(--admin-accent)]";
  return "text-white/35";
}

export function SeoEntryEditor({ entry, aiEnabled, saveAction, imageChoices = [] }: Props) {
  const { toast } = useToast();
  const [ogId, setOgId] = useState<string>(entry.og_media_id ?? "");
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState("");
  const ogChoice = imageChoices.find((c) => c.id === ogId) ?? null;
  const shownChoices = filter.trim()
    ? imageChoices.filter((c) => c.title.toLowerCase().includes(filter.trim().toLowerCase()))
    : imageChoices;
  const [title, setTitle] = useState(entry.seo_title);
  const [desc, setDesc] = useState(entry.seo_description);
  const [aiOpen, setAiOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [suggestion, setSuggestion] = useState<
    { title: string; description: string; flags: string[]; model: string } | null
  >(null);
  const [pending, startTransition] = useTransition();

  const path = entry.path;

  function runAi() {
    setSuggestion(null);
    startTransition(async () => {
      const res: AiSeoSuggestResult = await suggestSeoAction(path, instruction);
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      setSuggestion({
        title: res.title,
        description: res.description,
        flags: res.complianceFlags,
        model: res.model,
      });
      if (res.complianceFlags.length > 0) {
        toast({
          tone: "warning",
          message: `AI draft ready — but flagged: ${res.complianceFlags.join(", ")}. Review before using.`,
        });
      } else {
        toast({ tone: "success", message: "AI SEO draft ready. Review, then Use it." });
      }
    });
  }

  function useSuggestion() {
    if (!suggestion) return;
    setTitle(suggestion.title);
    setDesc(suggestion.description);
    setSuggestion(null);
    setAiOpen(false);
    toast({ tone: "info", message: "Inserted. Review the preview, then click Save." });
  }

  return (
    <form action={saveAction} className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
      <input type="hidden" name="path" value={path} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm text-white">{path}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/40">
            sitemap: {entry.sitemap_include ? "included" : "excluded"}
            {entry.noindex ? " · noindex" : ""}
          </span>
          <Button type="button" onClick={() => setAiOpen((o) => !o)} variant="special" size="sm">
            ✨ Generate with AI
          </Button>
        </div>
      </div>

      {/* AI panel */}
      {aiOpen && (
        <div className="mt-3 rounded-lg border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/[0.04] p-3">
          {!aiEnabled ? (
            <p className="text-xs text-[var(--admin-gold)]">
              AI isn&apos;t set up yet. Add an <code className="font-mono">AI_API_KEY</code> to
              enable “Generate with AI.” You can still edit by hand.
            </p>
          ) : (
            <>
              <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-white/45">
                Tell the AI what to emphasize (optional)
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="e.g. mention fast curbside pickup, daily deals"
                  className="min-w-[12rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-[var(--admin-accent)]"
                />
                <Button type="button" onClick={runAi} disabled={pending} variant="special" size="sm">
                  {pending ? "Writing…" : "Generate"}
                </Button>
              </div>

              {suggestion && (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
                      AI suggestion · {suggestion.model}
                    </span>
                    {suggestion.flags.length > 0 ? (
                      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[0.6rem] font-semibold text-red-300">
                        ⚠ {suggestion.flags.join(", ")}
                      </span>
                    ) : (
                      <span className="rounded-full border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-2 py-0.5 text-[0.6rem] font-semibold text-[var(--admin-accent)]">
                        ✓ no compliance flags
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-white/90">
                    <span className="text-white/45">Title:</span> {suggestion.title}
                  </div>
                  <div className="mt-1 text-sm text-white/90">
                    <span className="text-white/45">Description:</span> {suggestion.description}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" onClick={useSuggestion} variant="confirm" size="sm">
                      Use it
                    </Button>
                    <Button type="button" onClick={runAi} disabled={pending} variant="neutral" size="sm">
                      Try again
                    </Button>
                    <Button type="button" onClick={() => setSuggestion(null)} variant="neutral" size="sm">
                      Discard
                    </Button>
                  </div>
                  <p className="mt-2 text-[0.65rem] text-white/35">
                    AI writes a draft only — nothing changes until you Use it and then Save.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-3 space-y-3">
        <div>
          <label className="mb-1 flex items-center justify-between text-xs font-semibold text-white/50">
            <span>SEO title</span>
            <span className={counterTone(title.length, TITLE_MAX)}>
              {title.length}/{TITLE_MAX}
            </span>
          </label>
          <input
            name="seo_title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Leave blank to keep the built-in title"
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
          />
          {title.trim() ? (
            <p className="mt-1 text-[0.7rem] text-white/40">
              {titleHasBrand(title)
                ? "Your title names Greenway, so it is used exactly as typed."
                : "\u201c | Greenway Marijuana\u201d is added to the end automatically."}{" "}
              Google shows about {TITLE_MAX} characters{finalTitle(title).length > TITLE_MAX ? `; the full title is ${finalTitle(title).length}, so the end may be cut off` : ""}.
            </p>
          ) : null}
        </div>
        <div>
          <label className="mb-1 flex items-center justify-between text-xs font-semibold text-white/50">
            <span>SEO description</span>
            <span className={counterTone(desc.length, DESC_MAX)}>
              {desc.length}/{DESC_MAX}
            </span>
          </label>
          <textarea
            name="seo_description"
            rows={2}
            placeholder="Leave blank to keep the built-in description"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-white/50">Canonical (optional)</label>
            <input
              name="canonical"
              defaultValue={entry.canonical}
              placeholder="/menu (usually leave blank)"
              className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-white/70">
            <input type="checkbox" name="noindex" defaultChecked={entry.noindex} className="h-4 w-4" />
            Hide from Google (noindex)
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-white/70">
            <input
              type="checkbox"
              name="sitemap_include"
              defaultChecked={entry.sitemap_include}
              className="h-4 w-4"
            />
            In sitemap
          </label>
        </div>

        {/* R47: social-share picture picker (stored as og_media_id) */}
        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <input type="hidden" name="og_media_id" value={ogId} />
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex h-[84px] w-[160px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/15 bg-black">
              {ogChoice ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img loading="lazy" decoding="async" src={ogChoice.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="px-2 text-center text-[0.65rem] text-white/40">
                  {ogId ? "Picture not found in Digital Assets" : "Site default picture"}
                </span>
              )}
            </div>
            <div className="min-w-[12rem] flex-1">
              <div className="text-xs font-semibold text-white/60">Share picture (optional)</div>
              <p className="mt-0.5 text-[0.7rem] text-white/40">
                The picture shown when someone shares this page on Facebook, in a text message, or on
                X. Best size: 1200 × 630 pixels (wide). Leave it on the default to use the
                page&apos;s built-in picture.
              </p>
              {ogChoice && ogChoice.width && ogChoice.height ? (
                <p
                  className={`mt-1 text-[0.7rem] ${
                    ogChoice.width < 600 || ogChoice.height < 315 ? "text-[var(--admin-gold)]" : "text-white/40"
                  }`}
                >
                  This picture is {ogChoice.width} × {ogChoice.height}.
                  {ogChoice.width < 600 || ogChoice.height < 315
                    ? " That is small, so it may look blurry or be skipped. 1200 × 630 is best."
                    : ""}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="neutral" size="sm" onClick={() => setPicking((p) => !p)}>
                  {picking ? "Close picker" : ogId ? "Change picture" : "Choose picture"}
                </Button>
                <a
                  href="/admin/media"
                  target="_blank"
                  rel="noreferrer"
                  className="self-center text-[0.7rem] text-white/50 underline hover:text-white"
                >
                  + Upload in Digital Assets ↗
                </a>
                {ogId ? (
                  <Button type="button" variant="neutral" size="sm" onClick={() => setOgId("")}>
                    Use site default
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          {picking && (
            <div className="mt-3">
              {imageChoices.length === 0 ? (
                <p className="text-xs text-white/45">
                  No published pictures yet.{" "}
                  <a href="/admin/media" target="_blank" rel="noreferrer" className="underline">
                    Upload one in Digital Assets ↗
                  </a>
                  , publish it, then reload this page.
                </p>
              ) : (
                <>
                  <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search pictures by name"
                    className="mb-2 w-full rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-[var(--admin-accent)]"
                  />
                  <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
                    {shownChoices.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setOgId(c.id);
                          setPicking(false);
                        }}
                        className={`overflow-hidden rounded-md border text-left ${
                          c.id === ogId ? "border-[var(--admin-accent)]" : "border-white/10 hover:border-white/40"
                        }`}
                        title={c.title}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.url} alt="" loading="lazy" className="aspect-[1200/630] w-full object-cover" />
                        <span className="block truncate px-1 py-0.5 text-[0.6rem] text-white/55">{c.title}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Live Google-style preview */}
        <div className="rounded-lg border border-white/10 bg-black p-3">
          <div className="text-xs text-white/40">Search preview</div>
          <div className="mt-1 text-sm text-[#8ab4f8]">
            {title.trim() ? finalTitle(title) : "(the page\u2019s built-in title is used)"}
          </div>
          <div className="text-xs text-[var(--admin-accent)]/80">
            greenwaymarijuana.com{path === "/" ? "" : path}
          </div>
          <div className="mt-0.5 text-xs text-white/55">
            {desc || "Add a description to control this snippet."}
          </div>
        </div>

        <Button type="submit" variant="confirm">
          Save SEO for {path}
        </Button>
      </div>
    </form>
  );
}
