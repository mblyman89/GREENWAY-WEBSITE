"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/ux";
import type { FaqAdminVM } from "@/lib/cms/faq-store";

/**
 * FaqItemCard — one editable FAQ Q&A in the carousel-style FAQ manager.
 * Draft is the source of truth; Save draft persists it, Publish promotes it
 * live (gated until the draft is saved). Mirrors SectionCard's UX: status
 * badges, reorder ↑/↓, delete with confirm, unsaved-edits guard.
 */
export function FaqItemCard({
  item,
  index,
  total,
  saveAction,
  publishAction,
  deleteAction,
  moveAction,
}: {
  item: FaqAdminVM;
  index: number;
  total: number;
  saveAction: (formData: FormData) => void | Promise<void>;
  publishAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  moveAction: (formData: FormData) => void | Promise<void>;
}) {
  const locked = item.locked;
  const d = {
    question: item.draft_question ?? item.question ?? "",
    answer: item.draft_answer ?? item.answer ?? "",
    enabled: item.draft_enabled,
  };

  const [question, setQuestion] = useState(d.question);
  // GW-035: friendly confirm dialog instead of the browser's window.confirm.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteFormRef = useRef<HTMLFormElement>(null);
  const [answer, setAnswer] = useState(d.answer);
  const [enabled, setEnabled] = useState(d.enabled);

  const unsaved =
    !locked &&
    (question !== d.question || answer !== d.answer || enabled !== d.enabled);

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
      id={`faq-${item.id}`}
      className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#0f0f0f] p-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--admin-orange)]/15 text-sm font-bold text-[var(--admin-orange)]">
            {index + 1}
          </span>
          <span className="max-w-[18rem] truncate text-sm font-semibold text-white">
            {question || "Untitled question"}
          </span>
          {unsaved ? (
            <span className="rounded-full bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-gold)]">
              ● unsaved edits
            </span>
          ) : item.dirty ? (
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

        <div className="flex items-center gap-1.5">
          <form action={moveAction}>
            <input type="hidden" name="item_id" value={item.id} />
            <input type="hidden" name="direction" value="up" />
            <Button type="submit" disabled={index === 0} aria-label="Move up" variant="neutral" size="sm">
              ↑
            </Button>
          </form>
          <form action={moveAction}>
            <input type="hidden" name="item_id" value={item.id} />
            <input type="hidden" name="direction" value="down" />
            <Button type="submit" disabled={index === total - 1} aria-label="Move down" variant="neutral" size="sm">
              ↓
            </Button>
          </form>
          <form ref={deleteFormRef} action={deleteAction}>
            <input type="hidden" name="item_id" value={item.id} />
            <Button type="button" variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </form>
          <ConfirmDialog
            open={confirmDelete}
            title="Delete this Q&A?"
            description="This removes it from the FAQ page and can't be undone."
            confirmLabel="Delete Q&A"
            tone="danger"
            onConfirm={() => {
              setConfirmDelete(false);
              deleteFormRef.current?.requestSubmit();
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        </div>
      </div>

      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="item_id" value={item.id} />
        <div>
          <label className={labelCls}>Question</label>
          <input
            className={inputCls}
            name="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What are your store hours?"
          />
        </div>
        <div>
          <label className={labelCls}>Answer</label>
          <textarea
            className={`${inputCls} min-h-[110px] resize-y`}
            name="answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Write the answer. Use line breaks for bullet points (e.g. • item)."
          />
          <p className="mt-1 text-[0.65rem] text-white/40">
            Line breaks are preserved on the page. Start lines with “•” for a list.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              name="draft_enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--admin-accent)]"
            />
            Show this question on the FAQ page
          </label>
          <Button type="submit" variant={unsaved ? "save" : "neutral"}>
            {unsaved ? "Save draft ●" : "Save draft"}
          </Button>
        </div>
      </form>

      <form action={publishAction} className="mt-3 border-t border-white/10 pt-3">
        <input type="hidden" name="item_id" value={item.id} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-white/50">
            {unsaved
              ? "Save your draft first, then publish to make it live."
              : item.dirty
                ? "This Q&A has changes that aren't live yet."
                : "This Q&A is live and matches what visitors see."}
          </p>
          <Button type="submit" disabled={unsaved} variant="confirm">
            Publish to page
          </Button>
        </div>
      </form>
    </div>
  );
}
