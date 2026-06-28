"use client";

/**
 * ContentRevisionHistory — collapsible history + diff for ONE content block.
 *
 * Shows:
 *   - a word-level diff of LIVE → current DRAFT (so staff see exactly what
 *     publishing would change), and
 *   - the list of previous published values with who/when and a one-click
 *     "Restore to draft" button (restoring never auto-publishes — it loads the
 *     old value back into the draft for review).
 *
 * Pure client component; the actual restore goes through a permission-gated
 * server action passed in as a prop.
 */
import { useMemo, useState } from "react";
import { diffWords } from "@/lib/cms/diff";

export type RevisionItem = {
  id: string;
  value: string;
  note: string | null;
  actor_email: string | null;
  created_at: string;
};

type Props = {
  blockKey: string;
  liveValue: string;
  draftValue: string;
  revisions: RevisionItem[];
  /** Permission-gated server action; takes a FormData with revision_id. */
  restoreAction: (formData: FormData) => void;
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function DiffView({ before, after }: { before: string; after: string }) {
  const ops = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <p className="whitespace-pre-wrap text-sm leading-6">
      {ops.map((op, idx) => {
        if (op.type === "equal")
          return (
            <span key={idx} className="text-white/70">
              {op.text}
            </span>
          );
        if (op.type === "insert")
          return (
            <span
              key={idx}
              className="rounded bg-[#7ed957]/20 text-[#7ed957] underline decoration-[#7ed957]/40"
            >
              {op.text}
            </span>
          );
        return (
          <span
            key={idx}
            className="rounded bg-red-500/15 text-red-300 line-through decoration-red-400/50"
          >
            {op.text}
          </span>
        );
      })}
    </p>
  );
}

export function ContentRevisionHistory({
  blockKey,
  liveValue,
  draftValue,
  revisions,
  restoreAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const dirty = (draftValue ?? "") !== (liveValue ?? "");
  const count = revisions.length;

  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs font-bold text-white/55 transition hover:text-white/80"
        aria-expanded={open}
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        History &amp; changes
        {count > 0 && (
          <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[0.6rem] text-white/45">
            {count}
          </span>
        )}
        {dirty && (
          <span className="rounded-full border border-[#ff7f00]/40 bg-[#ff7f00]/10 px-1.5 py-0.5 text-[0.6rem] text-[#ff7f00]">
            unpublished change
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {/* Live → draft diff */}
          <div className="rounded-lg border border-white/10 bg-black/40 p-3">
            <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
              {dirty ? "What publishing will change (live → draft)" : "Draft matches live — nothing to publish"}
            </div>
            {dirty ? (
              <DiffView before={liveValue} after={draftValue} />
            ) : (
              <p className="text-sm text-white/45">No pending changes.</p>
            )}
          </div>

          {/* Past published versions */}
          {count === 0 ? (
            <p className="text-xs text-white/35">
              No previous published versions yet. Each time you Publish, a snapshot
              is saved here so you can roll back anytime.
            </p>
          ) : (
            <ol className="space-y-2">
              {revisions.map((rev, idx) => (
                <li
                  key={rev.id}
                  className="rounded-lg border border-white/10 bg-[#0d0d0d] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] font-semibold text-white/50">
                        {idx === 0 ? "current live" : `v${count - idx}`}
                      </span>
                      <span className="text-[0.7rem] text-white/45">
                        {timeAgo(rev.created_at)}
                        {rev.actor_email ? ` · ${rev.actor_email}` : ""}
                        {rev.note ? ` · ${rev.note}` : ""}
                      </span>
                    </div>
                    {idx !== 0 && (
                      <form action={restoreAction}>
                        <input type="hidden" name="revision_id" value={rev.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-2.5 py-1 text-[0.7rem] font-bold text-[#7ed957] transition hover:bg-[#7ed957]/20"
                          title="Load this version back into the draft to review, then publish"
                        >
                          ↺ Restore to draft
                        </button>
                      </form>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-white/75">
                    {rev.value}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <p className="text-[0.6rem] text-white/30">
            Block <span className="font-mono">{blockKey}</span> · restoring loads
            the value into your draft — review it, then Publish to go live.
          </p>
        </div>
      )}
    </div>
  );
}
