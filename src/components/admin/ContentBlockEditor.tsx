"use client";

/**
 * ContentBlockEditor — the editor card for ONE controlled site-text block.
 *
 * Task U PR A redesign — "how the big players do it":
 *   - PROGRESSIVE DISCLOSURE (Squarespace/Shopify pattern): each block renders
 *     as a compact summary row (label · status · current text snippet) and
 *     expands into the full editor only when clicked. A page of 30 blocks is
 *     now a scannable list instead of a wall of forms.
 *   - Design-token styling (var(--admin-*)) so the page matches the rest of
 *     the back office instead of the old raw-hex look.
 *   - One clear status pill per block: Live ✓ · Draft pending · Unsaved edits.
 *   - The primary action tracks state: "Save draft" lights up when there are
 *     unsaved edits; "Publish" appears when the draft differs from live.
 *   - Auto-expands (and focuses) when the live preview's "✎ Edit" hotspot or a
 *     ?block= deep link targets it — via a `gw-expand` DOM event from the shell.
 *
 * Everything else is unchanged: saving/publishing still flow through the
 * permission-gated server actions; AI writes DRAFTS ONLY that a human must
 * accept; compliance flags stay visible on every AI suggestion.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
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
import { resolveImageSpec } from "@/lib/cms/image-spec-core";
import { ContentFontField } from "@/components/admin/ContentFontField";
import { ContentSelectField } from "@/components/admin/ContentSelectField";

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
  /**
   * Admin route the save/publish/restore server actions should send the user
   * back to (with their flash param). Since these actions are shared by several
   * editors -- and the old Site Content page was retired (MIG-7) -- each host
   * passes its own route so "Saved."/"Published." lands on the right page.
   */
  returnTo?: string;
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

/** Short human snippet of a value for the collapsed summary row. */
function snippet(value: string | null, fieldType: string): string {
  if (fieldType === "image") return value ? "🖼 image set" : "no image yet";
  if (fieldType === "font") return value || "default font";
  if (fieldType === "select") return value ? value : "default";
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v) return "— empty —";
  return v.length > 90 ? `${v.slice(0, 90)}…` : v;
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
  returnTo,
}: Props) {
  const { toast } = useToast();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(block.draft_value ?? "");
  const [instruction, setInstruction] = useState("");
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<
    { value: string; flags: string[]; model: string } | null
  >(null);
  const [pending, startTransition] = useTransition();

  const isImage = block.field_type === "image";
  const isFont = block.field_type === "font";
  const isSelect = block.field_type === "select";
  const isRich = block.field_type === "rich" || block.field_type === "markdown";
  const dirty = (value ?? "") !== (block.published_value ?? "");
  // `savedValue` tracks what's been committed to the draft via Save; if the
  // editor differs, we nudge so nobody loses work by navigating away.
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

  // Auto-expand + focus when the shell targets this block (preview "✎ Edit"
  // hotspot or ?block= deep link). The shell dispatches `gw-expand` on our root.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onExpand = () => {
      setOpen(true);
      window.setTimeout(() => {
        const focusable =
          el.querySelector("textarea") ?? el.querySelector("input[type='text']");
        if (focusable) (focusable as HTMLElement).focus();
      }, 80);
    };
    el.addEventListener("gw-expand", onExpand);
    return () => el.removeEventListener("gw-expand", onExpand);
  }, []);

  const target = block.seo_impact ? seoTarget(block.block_key) : null;
  const len = value.length;
  const lenTone =
    target == null
      ? "text-[var(--admin-text-faint)]"
      : len < target.min
        ? "text-[var(--admin-gold)]"
        : len > target.max
          ? "text-[var(--admin-orange)]"
          : "text-[var(--admin-accent)]";

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

  // One clear status pill (priority: unsaved > pending draft > live).
  const statusPill = unsaved ? (
    <span className="rounded-full border border-[var(--admin-gold)]/50 bg-[var(--admin-gold-soft)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-gold)]">
      ● unsaved edits
    </span>
  ) : dirty ? (
    <span className="rounded-full border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-orange)]">
      draft pending
    </span>
  ) : (
    <span className="rounded-full border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-accent)]">
      ✓ live
    </span>
  );

  return (
    <div
      ref={rootRef}
      id={`block-${block.block_key}`}
      className={`scroll-mt-24 rounded-[var(--admin-radius-lg)] border bg-[var(--admin-surface)] transition ${
        open ? "border-[var(--admin-border-strong)]" : "border-[var(--admin-border)]"
      }`}
    >
      {/* Summary row — always visible; click to expand/collapse. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--admin-surface-hover)]"
      >
        <span
          className={`text-xs transition-transform ${open ? "rotate-90" : ""} text-[var(--admin-text-faint)]`}
          aria-hidden
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--admin-text)]">{block.label}</span>
            {block.seo_impact && (
              <span className="rounded-full border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-1.5 py-0.5 text-[0.6rem] font-semibold text-[var(--admin-gold)]">
                SEO
              </span>
            )}
            {statusPill}
          </span>
          {!open && (
            <span className="mt-0.5 block truncate text-xs text-[var(--admin-text-faint)]">
              {snippet(value, block.field_type)}
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs font-semibold text-[var(--admin-accent)]">
          {open ? "Close" : "Edit"}
        </span>
      </button>

      {/* Full editor — progressive disclosure. */}
      {open && (
        <div className="border-t border-[var(--admin-border)] px-4 pb-4 pt-3">
          {block.help_text && (
            <p className="mb-2 text-xs text-[var(--admin-text-muted)]">{block.help_text}</p>
          )}

          <form action={saveDraftAction} className="space-y-2">
            <input type="hidden" name="block_key" value={block.block_key} />
            <input type="hidden" name="draft_value" value={value} />
            {returnTo ? (
              <input type="hidden" name="return_to" value={returnTo} />
            ) : null}

            {isImage ? (
              <ContentImageField
                value={value}
                onChange={setValue}
                mediaChoices={mediaChoices}
                spec={resolveImageSpec(block.block_key)}
              />
            ) : isFont ? (
              <ContentFontField value={value} onChange={setValue} />
            ) : isSelect ? (
              <ContentSelectField blockKey={block.block_key} value={value} onChange={setValue} />
            ) : (
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={isRich ? 4 : 2}
                className="admin-focus w-full rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none transition focus:border-[var(--admin-accent)]"
                placeholder={`Type the ${block.label.toLowerCase()}…`}
              />
            )}

            {/* Meta row: length + AI toggle (text blocks only) */}
            {!isImage && !isFont && !isSelect && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className={`text-[0.7rem] ${lenTone}`}>
                  {len} characters
                  {target && (
                    <span className="ml-1 text-[var(--admin-text-faint)]">
                      · aim for {target.min}–{target.max} for a strong {target.what}
                    </span>
                  )}
                </div>
                <Button type="button" onClick={() => setAiPanelOpen((o) => !o)} variant="special" size="sm">
                  ✨ Write with AI
                </Button>
              </div>
            )}

            {/* AI panel */}
            {!isImage && !isFont && !isSelect && aiPanelOpen && (
              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/[0.04] p-3">
                {!aiEnabled ? (
                  <p className="text-xs text-[var(--admin-gold)]">
                    AI isn&apos;t set up yet. Add an <code className="font-mono">AI_API_KEY</code> to
                    enable &ldquo;Write with AI.&rdquo; You can still edit by hand.
                  </p>
                ) : (
                  <>
                    <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                      Tell the AI what you want (optional)
                    </label>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="e.g. friendlier, shorter, mention fast pickup"
                        className="admin-focus min-w-[12rem] flex-1 rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-xs text-[var(--admin-text)] outline-none transition focus:border-[var(--admin-accent)]"
                      />
                      <Button type="button" onClick={runAi} disabled={pending} variant="special" size="sm">
                        {pending ? "Writing…" : "Generate draft"}
                      </Button>
                    </div>

                    {suggestion && (
                      <div className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)]/60 p-3">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                            AI suggestion · {suggestion.model}
                          </span>
                          {suggestion.flags.length > 0 ? (
                            <span className="rounded-full border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-2 py-0.5 text-[0.6rem] font-semibold text-[var(--admin-danger)]">
                              ⚠ {suggestion.flags.join(", ")}
                            </span>
                          ) : (
                            <span className="rounded-full border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-2 py-0.5 text-[0.6rem] font-semibold text-[var(--admin-accent)]">
                              ✓ no compliance flags
                            </span>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-[var(--admin-text)]">{suggestion.value}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button type="button" onClick={acceptSuggestion} variant="confirm" size="sm">
                            Use it
                          </Button>
                          <Button type="button" onClick={runAi} disabled={pending} variant="neutral" size="sm">
                            Try again
                          </Button>
                          <Button type="button" onClick={() => setSuggestion(null)} variant="neutral" size="sm">
                            Discard
                          </Button>
                        </div>
                        <p className="mt-2 text-[0.65rem] text-[var(--admin-text-faint)]">
                          AI writes a draft only — nothing changes on your site until you Save the
                          draft and then Publish.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="submit" onClick={() => setSavedValue(value)} variant={unsaved ? "save" : "neutral"} size="sm">
                {unsaved ? "Save draft ●" : "Save draft"}
              </Button>
              {publicPath && (
                <a
                  href={publicPath}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] px-3 py-1.5 text-xs font-bold text-[var(--admin-text-faint)] hover:bg-[var(--admin-surface-hover)]"
                >
                  View on site ↗
                </a>
              )}
            </div>
          </form>

          <form action={publishAction} className="mt-2">
            <input type="hidden" name="block_key" value={block.block_key} />
            {returnTo ? (
              <input type="hidden" name="return_to" value={returnTo} />
            ) : null}
            <Button type="submit" variant="confirm" size="sm">
              Publish live
            </Button>
          </form>

          {block.published_value != null && (
            <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
              <span className="font-semibold text-[var(--admin-text-muted)]">Live:</span>{" "}
              {block.published_value}
            </p>
          )}

          {relTime(block.updated_at) && (
            <p className="mt-1 text-[0.65rem] text-[var(--admin-text-faint)]">
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
              returnTo={returnTo}
            />
          )}
        </div>
      )}
    </div>
  );
}
