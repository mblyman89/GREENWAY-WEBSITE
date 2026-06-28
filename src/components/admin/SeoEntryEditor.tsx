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
import { useToast } from "@/components/admin/ux";
import { suggestSeoAction, type AiSeoSuggestResult } from "@/app/admin/content/actions";

export type SeoEntryDraft = {
  path: string;
  seo_title: string;
  seo_description: string;
  canonical: string;
  noindex: boolean;
  sitemap_include: boolean;
};

type Props = {
  entry: SeoEntryDraft;
  aiEnabled: boolean;
  /** Server action passed in so this stays a pure client component. */
  saveAction: (formData: FormData) => void;
};

const TITLE_MAX = 60;
const DESC_MAX = 160;

function counterTone(len: number, max: number): string {
  const near = Math.round(max * 0.85);
  if (len > max) return "text-red-400";
  if (len >= near) return "text-[#7ed957]";
  return "text-white/35";
}

export function SeoEntryEditor({ entry, aiEnabled, saveAction }: Props) {
  const { toast } = useToast();
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
          <button
            type="button"
            onClick={() => setAiOpen((o) => !o)}
            className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-3 py-1 text-xs font-bold text-[#7ed957] transition hover:bg-[#7ed957]/20"
          >
            ✨ Generate with AI
          </button>
        </div>
      </div>

      {/* AI panel */}
      {aiOpen && (
        <div className="mt-3 rounded-lg border border-[#7ed957]/25 bg-[#7ed957]/[0.04] p-3">
          {!aiEnabled ? (
            <p className="text-xs text-[#ffd700]">
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
                  className="min-w-[12rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-[#7ed957]"
                />
                <button
                  type="button"
                  onClick={runAi}
                  disabled={pending}
                  className="rounded-lg bg-[#7ed957] px-3 py-1.5 text-xs font-bold text-black transition hover:bg-[#6bc746] disabled:opacity-50"
                >
                  {pending ? "Writing…" : "Generate"}
                </button>
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
                      <span className="rounded-full border border-[#7ed957]/40 bg-[#7ed957]/10 px-2 py-0.5 text-[0.6rem] font-semibold text-[#7ed957]">
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
                    <button
                      type="button"
                      onClick={useSuggestion}
                      className="rounded-lg bg-[#7ed957] px-3 py-1.5 text-xs font-bold text-black hover:bg-[#6bc746]"
                    >
                      Use it
                    </button>
                    <button
                      type="button"
                      onClick={runAi}
                      disabled={pending}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/10 disabled:opacity-50"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuggestion(null)}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/60 hover:bg-white/10"
                    >
                      Discard
                    </button>
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
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
          />
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
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-white/50">Canonical (optional)</label>
            <input
              name="canonical"
              defaultValue={entry.canonical}
              className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-white/70">
            <input type="checkbox" name="noindex" defaultChecked={entry.noindex} className="h-4 w-4" />
            Noindex
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

        {/* Live Google-style preview */}
        <div className="rounded-lg border border-white/10 bg-black p-3">
          <div className="text-xs text-white/40">Search preview</div>
          <div className="mt-1 text-sm text-[#8ab4f8]">{title || `Greenway Marijuana · ${path}`}</div>
          <div className="text-xs text-[#7ed957]/80">
            greenwaymarijuana.com{path === "/" ? "" : path}
          </div>
          <div className="mt-0.5 text-xs text-white/55">
            {desc || "Add a description to control this snippet."}
          </div>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-bold text-black hover:bg-[#6bc746]"
        >
          Save SEO for {path}
        </button>
      </div>
    </form>
  );
}
