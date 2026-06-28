"use client";

import { useEffect, useState } from "react";
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
    "w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#7ed957]/60";
  const labelCls =
    "mb-1 block text-[0.7rem] font-semibold uppercase tracking-wide text-white/60";

  return (
    <div
      id={`faq-${item.id}`}
      className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#0f0f0f] p-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff7f00]/15 text-sm font-bold text-[#ff7f00]">
            {index + 1}
          </span>
          <span className="max-w-[18rem] truncate text-sm font-semibold text-white">
            {question || "Untitled question"}
          </span>
          {unsaved ? (
            <span className="rounded-full bg-[#ffd700]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[#ffd700]">
              ● unsaved edits
            </span>
          ) : item.dirty ? (
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

        <div className="flex items-center gap-1.5">
          <form action={moveAction}>
            <input type="hidden" name="item_id" value={item.id} />
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
            <input type="hidden" name="item_id" value={item.id} />
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
                  "Delete this Q&A? This removes it from the FAQ page and can't be undone.",
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="item_id" value={item.id} />
            <button
              type="submit"
              className="rounded-md border border-red-500/30 px-2 py-1 text-xs font-medium text-red-300 transition hover:bg-red-500/10"
            >
              Delete
            </button>
          </form>
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
              className="h-4 w-4 accent-[#7ed957]"
            />
            Show this question on the FAQ page
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
          <button
            type="submit"
            disabled={unsaved}
            className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#94e570] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Publish to page
          </button>
        </div>
      </form>
    </div>
  );
}
