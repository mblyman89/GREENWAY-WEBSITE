"use client";

/**
 * PoReviewPanel — advisory AI review of a draft purchase order (Task I, I6).
 *
 * Click "Review this PO" and the server re-reads the PO's real lines, crosses
 * them against the latest monthly CCRS drop (Port Orchard-first competitor
 * evidence + statewide movers), and returns a grounded briefing: an overall
 * read, line-by-line verdicts, mix observations, and pre-send checks.
 *
 * Read-only / advisory: it never edits the order — every change stays with the
 * manager. Powered by the "heavy" model tier (router-controlled). Soft-disables
 * when no AI key is configured.
 */
import { useState, useTransition } from "react";
import { reviewPurchaseOrderAction, type PoReviewResult } from "../actions";
import type { PoReview, PoLineReview, PoLineVerdict } from "@/lib/purchasing/po-review-ai";

type Props = { poId: string; aiEnabled: boolean };

const VERDICT_STYLE: Record<PoLineVerdict, { label: string; badge: string }> = {
  solid: { label: "Solid", badge: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" },
  check_price: { label: "Check price", badge: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]" },
  check_demand: { label: "Check demand", badge: "bg-white/10 text-[var(--admin-text-muted)]" },
  reconsider: { label: "Reconsider", badge: "bg-[var(--admin-danger)]/15 text-[var(--admin-danger)]" },
};

function LineReviewCard({ r }: { r: PoLineReview }) {
  const style = VERDICT_STYLE[r.verdict];
  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="truncate text-sm font-semibold text-[var(--admin-text)]" title={r.name}>
          {r.name}
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${style.badge}`}>
          {style.label}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-[var(--admin-text-muted)]">{r.rationale}</p>
      <div className="mt-1.5 text-[0.65rem] text-[var(--admin-text-faint)]">
        confidence {Math.round(r.confidence * 100)}%
      </div>
    </div>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">{title}</div>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm text-[var(--admin-text-muted)]">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--admin-accent)]" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PoReviewPanel({ poId, aiEnabled }: Props) {
  const [review, setReview] = useState<PoReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setReview(null);
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("po_id", poId);
      const res: PoReviewResult = await reviewPurchaseOrderAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReview(res.review);
    });
  }

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--admin-accent)]">
            <span aria-hidden>🤖</span> AI purchase review
          </h2>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            A grounded second opinion before you send: each line is checked against the latest
            monthly CCRS drop — is it a proven Port Orchard mover, what retail price does it move
            at, and does the order mix look right. Advisory only — it never edits the order.
          </p>
        </div>
        {aiEnabled && (
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Reviewing…" : review ? "Re-review" : "Review this PO"}
          </button>
        )}
      </div>

      {!aiEnabled ? (
        <p className="mt-3 text-xs text-[var(--admin-gold)]">
          The reviewer turns on once an <code className="font-mono">AI_API_KEY</code> (or{" "}
          <code className="font-mono">OPENAI_API_KEY</code>) is set. The purchase order works
          without it.
        </p>
      ) : error ? (
        <p className="mt-3 text-sm text-[var(--admin-danger)]">{error}</p>
      ) : review ? (
        <div className="mt-4 space-y-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/30 p-4">
          {review.headline && (
            <p className="text-sm font-medium text-[var(--admin-text)]">{review.headline}</p>
          )}

          {review.line_reviews.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Line-by-line
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {review.line_reviews.map((r, i) => (
                  <LineReviewCard key={`${r.name}-${i}`} r={r} />
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <BulletList title="Order mix" items={review.mix_observations} />
            <BulletList title="Before you send" items={review.pre_send_checks} />
          </div>

          <p className="text-[0.65rem] text-[var(--admin-text-faint)]">
            Generated by {review.model} from this PO&apos;s real lines and the persisted CCRS
            rollups. Observed prices are RETAIL at other stores — your costs are wholesale; the
            reviewer is told to never mix the two. Advisory only — every change stays yours.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
          Click <span className="font-semibold text-[var(--admin-text)]">Review this PO</span>{" "}
          for an instant, grounded read before you send.
        </p>
      )}
    </section>
  );
}
