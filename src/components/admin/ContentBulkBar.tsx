"use client";

/**
 * ContentBulkBar — a sticky summary + bulk actions for the Site Content page.
 *
 * Shows how many blocks have unpublished changes and offers:
 *   - "Publish all drafts" (with confirm) — pushes every pending draft live
 *   - "Discard all drafts" (with confirm) — resets every draft to the live value
 *
 * Both go through permission-gated server actions passed in as props. When
 * nothing is pending we show a calm "all changes are live" state so the page
 * feels reassuring rather than nagging.
 */
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/admin/ux";

type Props = {
  pendingCount: number;
  publishAllAction: () => void;
  discardAllAction: () => void;
};

export function ContentBulkBar({
  pendingCount,
  publishAllAction,
  discardAllAction,
}: Props) {
  const [confirm, setConfirm] = useState<null | "publish" | "discard">(null);
  const publishFormRef = useRef<HTMLFormElement>(null);
  const discardFormRef = useRef<HTMLFormElement>(null);

  const hasPending = pendingCount > 0;

  return (
    <div
      className={`sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 backdrop-blur ${
        hasPending
          ? "border-[#ff7f00]/40 bg-[#ff7f00]/[0.08]"
          : "border-[#7ed957]/30 bg-[#7ed957]/[0.06]"
      }`}
    >
      <div className="text-sm font-semibold">
        {hasPending ? (
          <span className="text-[#ff7f00]">
            {pendingCount} block{pendingCount === 1 ? "" : "s"} {pendingCount === 1 ? "has" : "have"} unpublished changes
          </span>
        ) : (
          <span className="text-[#7ed957]">✓ All changes are live — nothing pending</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form ref={publishFormRef} action={publishAllAction} className="contents">
          <button
            type="button"
            disabled={!hasPending}
            onClick={() => setConfirm("publish")}
            className="rounded-lg bg-[#7ed957] px-4 py-1.5 text-xs font-bold text-black transition hover:bg-[#6bc746] disabled:cursor-not-allowed disabled:opacity-40"
          >
            🚀 Publish all drafts
          </button>
        </form>
        <form ref={discardFormRef} action={discardAllAction} className="contents">
          <button
            type="button"
            disabled={!hasPending}
            onClick={() => setConfirm("discard")}
            className="rounded-lg border border-white/15 px-4 py-1.5 text-xs font-bold text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Discard all drafts
          </button>
        </form>
      </div>

      <ConfirmDialog
        open={confirm === "publish"}
        title={`Publish all ${pendingCount} pending change${pendingCount === 1 ? "" : "s"}?`}
        description="This pushes every unpublished draft live at once. A snapshot of each is saved to history so you can roll back."
        confirmLabel="Publish everything"
        tone="primary"
        onConfirm={() => {
          setConfirm(null);
          publishFormRef.current?.requestSubmit();
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "discard"}
        title={`Discard all ${pendingCount} draft${pendingCount === 1 ? "" : "s"}?`}
        description="This resets every draft back to what's currently live. Your unpublished edits will be lost. This can't be undone."
        confirmLabel="Discard drafts"
        tone="danger"
        requireTextToConfirm="DISCARD"
        onConfirm={() => {
          setConfirm(null);
          discardFormRef.current?.requestSubmit();
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
