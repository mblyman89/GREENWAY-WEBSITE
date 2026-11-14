"use client";

/**
 * D244 E-1b (F-41) — Prev / Next / Save & next inside the filtered worklist.
 *
 * The list page records its ordered keys for its own query string
 * (`WorklistOrderRecorder`); the detail page reads them back
 * (`DetailNav`) and computes its neighbours without re-querying. Only the
 * order saved for the SAME `back` is used, so an old list never steers a
 * new one. No order on file (opened from a link, a new tab) = no buttons.
 */
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import {
  DETAIL_EDITOR_FORM_ID,
  DETAIL_PUBLISH_FORM_ID,
  WORKLIST_ORDER_STORAGE_KEY,
  detailUrl,
  neighbours,
  parseStoredOrder,
  serializeOrder,
} from "@/lib/enrichment/detail-nav-core";

export function WorklistOrderRecorder({ back, keys }: { back: string; keys: string[] }) {
  useEffect(() => {
    try {
      window.sessionStorage.setItem(WORKLIST_ORDER_STORAGE_KEY, serializeOrder(back, keys));
    } catch {
      // private mode / storage full: Prev/Next simply stay hidden.
    }
  }, [back, keys]);
  return null;
}

const noop = () => () => undefined;
function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(WORKLIST_ORDER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function DetailNav({ posKey, back, position }: { posKey: string; back: string; position: "top" | "bottom" }) {
  const raw = useSyncExternalStore(noop, readStored, () => null);
  const n = neighbours(parseStoredOrder(raw, back), posKey);
  if (n.index < 0) return null;
  const link = "rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-[var(--admin-accent)] hover:text-white";

  if (position === "top") {
    return (
      <nav className="flex flex-wrap items-center gap-2" aria-label="Product in list" data-testid="detail-nav">
        {n.prev ? (
          <Link href={detailUrl(n.prev, back)} className={link}>
            ← Previous
          </Link>
        ) : null}
        <span className="text-xs text-white/50">
          {n.index + 1} of {n.total} in your list
        </span>
        {n.next ? (
          <Link href={detailUrl(n.next, back)} className={link}>
            Next →
          </Link>
        ) : (
          <span className="text-xs text-white/40">last one</span>
        )}
      </nav>
    );
  }

  if (!n.next) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="detail-save-next">
      <input type="hidden" form={DETAIL_EDITOR_FORM_ID} name="nextKey" value={n.next} />
      <input type="hidden" form={DETAIL_PUBLISH_FORM_ID} name="nextKey" value={n.next} />
      <button
        type="submit"
        form={DETAIL_EDITOR_FORM_ID}
        name="then"
        value="next"
        className="rounded-[var(--admin-radius)] border border-white/15 px-3 py-2 text-xs font-bold text-white/85 hover:border-[var(--admin-accent)]"
      >
        Save &amp; next →
      </button>
      <button
        type="submit"
        form={DETAIL_PUBLISH_FORM_ID}
        name="status"
        value="published:next"
        className="rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-3 py-2 text-xs font-bold text-black hover:opacity-90"
      >
        Publish &amp; next →
      </button>
      <span className="text-xs text-white/45">
        {n.index + 1} of {n.total}
      </span>
    </div>
  );
}
