"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/ux";
import {
  type CoreValue,
  MAX_CORE_VALUES,
  moveValue,
  ordinalLabel,
  renumberValues,
  serializeCoreValues,
  slugForValue,
} from "@/lib/about/core-values-core";

/**
 * AboutCoreValuesCard — the owner editor for the About page "Our Values" cards.
 *
 * SINGLE-DOCUMENT UX: the whole set of cards is edited together in one card.
 * Add / delete / reorder happen instantly in the browser; "Save draft" persists
 * the staged list, and "Publish" promotes it live (gated until the draft is
 * saved). Mirrors the draft → preview → publish flow of the rest of the page
 * editor, and keeps the exact public look (this only edits the number/title/
 * summary text; the card styling lives in AboutContent).
 */
export function AboutCoreValuesCard({
  publishedValues,
  draftValues,
  dirty,
  isFallback,
  previewPath,
  saveAction,
  publishAction,
}: {
  publishedValues: CoreValue[];
  draftValues: CoreValue[];
  dirty: boolean;
  isFallback: boolean;
  previewPath: string;
  saveAction: (formData: FormData) => void | Promise<void>;
  publishAction: () => void | Promise<void>;
}) {
  const initial = draftValues.length ? draftValues : publishedValues;
  const [rows, setRows] = useState<CoreValue[]>(initial);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Serialized comparison: are the staged rows different from what was saved?
  const savedJson = useMemo(() => serializeCoreValues(initial), [initial]);
  const rowsJson = useMemo(() => serializeCoreValues(rows), [rows]);
  const unsaved = rowsJson !== savedJson;

  useEffect(() => {
    if (!unsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsaved]);

  function updateRow(index: number, patch: Partial<CoreValue>): void {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow(): void {
    setRows((prev) => {
      if (prev.length >= MAX_CORE_VALUES) return prev;
      const n = prev.length + 1;
      return [
        ...prev,
        {
          key: slugForValue("", Date.now()),
          number: ordinalLabel(n),
          title: "",
          summary: "",
        },
      ];
    });
  }

  function removeRow(index: number): void {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setConfirmDelete(null);
  }

  function move(index: number, direction: "up" | "down"): void {
    setRows((prev) => moveValue(prev, index, direction));
  }

  function autoNumber(): void {
    setRows((prev) => renumberValues(prev));
  }

  const inputCls =
    "w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--admin-accent)]/60";
  const labelCls =
    "mb-1 block text-[0.7rem] font-semibold uppercase tracking-wide text-white/60";

  return (
    <div
      id="about-core-values"
      className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#0f0f0f] p-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-white">Core values cards</h3>
          <p className="mt-0.5 text-xs text-white/50">
            The numbered “Our Values” cards on the About page. Edit the text, add
            or remove cards, and drag order with ↑/↓. They keep their exact look.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {unsaved ? (
            <span className="rounded-full bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-gold)]">
              ● unsaved edits
            </span>
          ) : dirty ? (
            <span className="rounded-full bg-[var(--admin-orange)]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-orange)]">
              unpublished draft
            </span>
          ) : (
            <span className="rounded-full bg-[var(--admin-accent)]/12 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-accent)]">
              live
            </span>
          )}
        </div>
      </div>

      {isFallback ? (
        <p className="mb-4 rounded-lg border border-[var(--admin-gold)]/25 bg-[var(--admin-gold)]/8 px-3 py-2 text-xs text-white/70">
          Showing your current four values. Your first “Save draft” + “Publish”
          stores them so you can edit freely from here on.
        </p>
      ) : null}

      <div className="space-y-4">
        {rows.map((row, index) => (
          <div
            key={row.key}
            className="rounded-xl border border-white/10 bg-black/30 p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--admin-orange)]/15 text-sm font-bold text-[var(--admin-orange)]">
                {index + 1}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, "up")}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  aria-label="Move down"
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, "down")}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirmDelete(index)}
                >
                  Delete
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[7rem_1fr]">
              <div>
                <label className={labelCls}>Number</label>
                <input
                  className={inputCls}
                  value={row.number}
                  onChange={(e) => updateRow(index, { number: e.target.value })}
                  placeholder="01"
                />
              </div>
              <div>
                <label className={labelCls}>Title</label>
                <input
                  className={inputCls}
                  value={row.title}
                  onChange={(e) => updateRow(index, { title: e.target.value })}
                  placeholder="e.g. Customer Commitment"
                />
              </div>
            </div>
            <div className="mt-3">
              <label className={labelCls}>Summary</label>
              <input
                className={inputCls}
                value={row.summary}
                onChange={(e) => updateRow(index, { summary: e.target.value })}
                placeholder="e.g. Exceptional Customer Service"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={addRow}
          disabled={rows.length >= MAX_CORE_VALUES}
        >
          + Add value
        </Button>
        <Button type="button" variant="neutral" onClick={autoNumber}>
          Auto-number 01, 02, 03…
        </Button>
        {rows.length >= MAX_CORE_VALUES ? (
          <span className="text-xs text-white/40">
            Up to {MAX_CORE_VALUES} cards.
          </span>
        ) : null}
      </div>

      <form
        ref={formRef}
        action={saveAction}
        className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"
      >
        <input type="hidden" name="values_json" value={rowsJson} />
        <p className="text-xs text-white/50">
          {unsaved
            ? "You have unsaved changes to your values."
            : "Your draft is saved. Preview it, then publish."}
        </p>
        <Button type="submit" variant={unsaved ? "save" : "neutral"}>
          {unsaved ? "Save draft ●" : "Save draft"}
        </Button>
      </form>

      <form action={publishAction} className="mt-3 border-t border-white/10 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-white/50">
            {unsaved ? (
              "Save your draft first, then publish to make it live."
            ) : dirty ? (
              <>
                Changes aren’t live yet.{" "}
                <a
                  href={previewPath}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-white"
                >
                  Preview
                </a>{" "}
                then publish.
              </>
            ) : (
              "Your values are live and match what visitors see."
            )}
          </p>
          <Button type="submit" disabled={unsaved} variant="confirm">
            Publish to page
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete this value?"
        description="This removes the card from the About page when you publish. You can't undo it here."
        confirmLabel="Delete value"
        tone="danger"
        onConfirm={() => {
          if (confirmDelete !== null) removeRow(confirmDelete);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
