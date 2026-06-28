"use client";

/**
 * ContentBlockEditor — the Squarespace-style editor card for ONE controlled
 * site-text block (UX-3). Wraps the existing save-draft / publish server
 * actions and layers on:
 *   - live character count + gentle SEO-length guidance for SEO blocks
 *   - "✨ Write with AI" → compliant draft suggestion with Accept / Edit /
 *     Reject and visible compliance flags (drafts-only; never auto-saves)
 *   - clear draft-vs-live state, "View on site" link, and toast feedback
 *
 * Server enforcement is unchanged: saving/publishing still go through the
 * permission-gated server actions; AI output is a suggestion the human must
 * accept. This component only improves the editing experience.
 */
import { useEffect, useState, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import { suggestContentAction, type AiSuggestResult } from "@/app/admin/content/actions";
import {
  ContentRevisionHistory,
  type RevisionItem,
} from "@/components/admin/ContentRevisionHistory";
import {
  ContentImageField,
  type MediaChoice,
} from "@/components/admin/ContentImageField";

export type EditableBlock = {
  block_key: string;
  label: string;
  field_type: string;
  help_text?: string | null;
  seo_impact: boolean;
  draft_value: string | null;
  published_value: string | null;
  /** ISO timestamp of the last edit (optional metadata for the card footer). */
  updated_at?: string | null;
};

type Props = {
  block: EditableBlock;
  aiEnabled: boolean;
  /** The server actions are passed in so this stays a pure client component. */
  saveDraftAction: (formData: FormData) => void;
  publishAction: (formData: FormData) => void;
  /** Public path to "View on site" (e.g. "/menu"); optional. */
  publicPath?: string | null;
  /** Past published versions of this block (newest first). */
  revisions?: RevisionItem[];
  /** Permission-gated server action to restore a revision into the draft. */
  restoreAction?: (formData: FormData) => void;
  /** Published media library images, for the "image" field-type picker. */
  mediaChoices?: MediaChoice[];
};

function relTime(iso?: string | null): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return null;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Soft SEO length windows (chars). Used only for friendly guidance, not blocking.
function seoTarget(blockKey: string): { min: number; max: number; what: string } | null {
  const k = blockKey.toLowerCase();
  if (k.includes("title") || k.includes("heading")) return { min: 15, max: 60, what: "headline" };
  if (k.includes("subtitle") || k.includes("subhead")) return { min: 20, max: 120, what: "subtitle" };
  return null;
}

export function ContentBlockEditor({
  block,
  aiEnabled,
  saveDraftAction,
  publishAction,
  publicPath,
  revisions = [],
  restoreAction,
  mediaChoices = [],
}: Props) {
  const { toast } = useToast();
  const [value, setValue] = useState(block.draft_value ?? "");
  const [instruction, setInstruction] = useState("");
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<
    { value: string; flags: string[]; model: string } | null
  >(null);
  const [pending, startTransition] = useTransition();

  const isImage = block.field_type === "image";
  const isRich = block.field_type === "rich" || block.field_type === "markdown";
  const dirty = (value ?? "") !== (block.published_value ?? "");
  // VALUE-ADD: an "unsaved edits" indicator. `savedValue` tracks what's been
  // committed to the draft via Save; if the textarea differs, we nudge the user
  // so they don't lose work by navigating away.
  const [savedValue, setSavedValue] = useState(block.draft_value ?? "");
  const unsaved = (value ?? "") !== (savedValue ?? "");

  // Warn before leaving the page (tab close / reload) with unsaved edits.
  useEffect(() => {
    if (!unsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsaved]);
  const target = block.seo_impact ? seoTarget(block.block_key) : null;
  const len = value.length;
  const lenTone =
    target == null
      ? "text-white/35"
      : len < target.min
        ? "text-[#ffd700]"
        : len > target.max
          ? "text-[#ff7f00]"
          : "text-[#7ed957]";

  async function runAi() {
    setSuggestion(null);
    startTransition(async () => {
      const res: AiSuggestResult = await suggestContentAction(block.block_key, instruction);
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      setSuggestion({ value: res.value, flags: res.complianceFlags, model: res.model });
      if (res.complianceFlags.length > 0) {
        toast({
          tone: "warning",
          message: `AI draft ready — but flagged: ${res.complianceFlags.join(", ")}. Review before using.`,
        });
      } else {
        toast({ tone: "success", message: "AI draft ready. Review, then Use it." });
      }
    });
  }

  function acceptSuggestion() {
    if (!suggestion) return;
    setValue(suggestion.value);
    setSuggestion(null);
    setAiPanelOpen(false);
    toast({ tone: "info", message: "Inserted into your draft. Remember to Save, then Publish." });
  }

  return (
    <div
      id={`block-${block.block_key}`}
      className="scroll-mt-24 rounded-xl border border-white/10 bg-[#0a0a0a] p-4"
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{block.label}</div>
          <div className="font-mono text-xs text-white/35">{block.block_key}</div>
        </div>
        <div className="flex items-center gap-2">
          {block.seo_impact && (
            <span className="rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 px-2 py-0.5 text-[0.65rem] font-semibold text-[#ffd700]">
              SEO impact
            </span>
          )}
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.65rem] font-semibold text-white/50">
            {block.field_type}
          </span>
          {unsaved && (
            <span className="rounded-full border border-[#ffd700]/50 bg-[#ffd700]/10 px-2 py-0.5 text-[0.65rem] font-semibold text-[#ffd700]">
              ● unsaved edits
            </span>
          )}
          {!unsaved && dirty && (
            <span className="rounded-full border border-[#ff7f00]/40 bg-[#ff7f00]/10 px-2 py-0.5 text-[0.65rem] font-semibold text-[#ff7f00]">
              unpublished draft
            </span>
          )}
        </div>
      </div>
      {block.help_text && <p className="mt-1 text-xs text-white/45">{block.help_text}</p>}

      {/* Editor */}
      <form action={saveDraftAction} className="mt-3 space-y-2">
        <input type="hidden" name="block_key" value={block.block_key} />
        <input type="hidden" name="draft_value" value={value} />

        {isImage ? (
          <ContentImageField
            value={value}
            onChange={setValue}
            mediaChoices={mediaChoices}
          />
        ) : (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={isRich ? 4 : 2}
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            placeholder={`Type the ${block.label.toLowerCase()}…`}
          />
        )}

        {/* Meta row: length + AI toggle (text blocks only) */}
        {!isImage && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={`text-[0.7rem] ${lenTone}`}>
              {len} characters
              {target && (
                <span className="ml-1 text-white/35">
                  · aim for {target.min}–{target.max} for a strong {target.what}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAiPanelOpen((o) => !o)}
              className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-3 py-1.5 text-xs font-bold text-[#7ed957] transition hover:bg-[#7ed957]/20"
            >
              ✨ Write with AI
            </button>
          </div>
        )}

        {/* AI panel */}
        {!isImage && aiPanelOpen && (
          <div className="rounded-lg border border-[#7ed957]/25 bg-[#7ed957]/[0.04] p-3">
            {!aiEnabled ? (
              <p className="text-xs text-[#ffd700]">
                AI isn&apos;t set up yet. Add an <code className="font-mono">AI_API_KEY</code> to
                enable “Write with AI.” You can still edit by hand.
              </p>
            ) : (
              <>
                <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-white/45">
                  Tell the AI what you want (optional)
                </label>
                <div className="mt-1 flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="e.g. friendlier, shorter, mention fast pickup"
                    className="min-w-[12rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-[#7ed957]"
                  />
                  <button
                    type="button"
                    onClick={runAi}
                    disabled={pending}
                    className="rounded-lg bg-[#7ed957] px-3 py-1.5 text-xs font-bold text-black transition hover:bg-[#6bc746] disabled:opacity-50"
                  >
                    {pending ? "Writing…" : "Generate draft"}
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
                    <p className="whitespace-pre-wrap text-sm text-white/90">{suggestion.value}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={acceptSuggestion}
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
                      AI writes a draft only — nothing changes on your site until you Save the draft
                      and then Publish.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="submit"
            onClick={() => setSavedValue(value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              unsaved
                ? "bg-[#ffd700] text-black hover:bg-[#e6c200]"
                : "border border-white/15 text-white/80 hover:bg-white/10"
            }`}
          >
            {unsaved ? "Save draft ●" : "Save draft"}
          </button>
          {publicPath && (
            <a
              href={publicPath}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/60 hover:bg-white/10"
            >
              View on site ↗
            </a>
          )}
        </div>
      </form>

      <form action={publishAction} className="mt-2">
        <input type="hidden" name="block_key" value={block.block_key} />
        <button
          type="submit"
          className="rounded-lg bg-[#7ed957] px-3 py-1.5 text-xs font-bold text-black hover:bg-[#6bc746]"
        >
          Publish live
        </button>
      </form>

      {block.published_value != null && (
        <p className="mt-2 text-xs text-white/35">
          <span className="font-semibold text-white/45">Live:</span> {block.published_value}
        </p>
      )}

      {relTime(block.updated_at) && (
        <p className="mt-1 text-[0.65rem] text-white/30">
          Last edited {relTime(block.updated_at)}
        </p>
      )}

      {restoreAction && (
        <ContentRevisionHistory
          blockKey={block.block_key}
          liveValue={block.published_value ?? ""}
          draftValue={value}
          revisions={revisions}
          restoreAction={restoreAction}
        />
      )}
    </div>
  );
}
