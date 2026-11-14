"use client";

/**
 * D244 E-2 — the sticky bulk action bar for the enrichment worklist.
 *
 * Checkboxes live on the grid cards / table rows (outside this form) and join
 * it through the HTML `form="bulk-status-form"` attribute, so no card markup
 * has to nest inside the form. Each checkbox carries data-ready / data-photo /
 * data-copy / data-own so the bar can show a live pre-flight for the ticked
 * set ("12 ticked · 9 ready · 3 have no photo") without another request.
 *
 * "Select every card matching this filter" switches scope to the whole
 * filtered list (the page passes those keys, capped at BULK_STATUS_MAX), so
 * the owner is not limited to the 300 cards drawn on screen.
 */
import { useCallback, useEffect, useState } from "react";
import type { BulkPreflight } from "@/lib/enrichment/bulk-publish-core";

export const BULK_FORM_ID = "bulk-status-form";

type Counts = { ticked: number; ready: number; readyCopy: number; noPhoto: number; noCopy: number; noRecord: number };

function readTicked(): Counts {
  const boxes = Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${BULK_FORM_ID}"][name="keys"]`),
  ).filter((b) => b.checked);
  const c: Counts = { ticked: boxes.length, ready: 0, readyCopy: 0, noPhoto: 0, noCopy: 0, noRecord: 0 };
  for (const b of boxes) {
    if (b.dataset.ready === "1") c.ready++;
    if (b.dataset.ready === "1" && b.dataset.copy === "1") c.readyCopy++;
    if (b.dataset.photo !== "1") c.noPhoto++;
    if (b.dataset.copy !== "1") c.noCopy++;
    if (b.dataset.own !== "1") c.noRecord++;
  }
  return c;
}

export function BulkStatusBar({
  action,
  back,
  matchingKeys,
  matchingTotal,
  shownCount,
  matching,
}: {
  action: (formData: FormData) => void | Promise<void>;
  back: string;
  /** Every key matching the current filter (already capped by the page). */
  matchingKeys: string[];
  /** How many cards match the filter (may exceed matchingKeys.length). */
  matchingTotal: number;
  shownCount: number;
  /** Server pre-flight over the whole filtered list. */
  matching: BulkPreflight;
}) {
  const [counts, setCounts] = useState<Counts>({ ticked: 0, ready: 0, readyCopy: 0, noPhoto: 0, noCopy: 0, noRecord: 0 });
  const [scope, setScope] = useState<"selected" | "matching">("selected");
  const [mode, setMode] = useState<"photo" | "photo-copy" | "all">("photo");

  const refresh = useCallback(() => setCounts(readTicked()), []);
  useEffect(() => {
    // Nothing is ticked on first render; count on every checkbox change.
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement | null;
      if (t && t.getAttribute("form") === BULK_FORM_ID) refresh();
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [refresh]);

  const setAll = (checked: boolean) => {
    document
      .querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${BULK_FORM_ID}"][name="keys"]`)
      .forEach((b) => {
        b.checked = checked;
      });
    if (!checked) setScope("selected");
    refresh();
  };

  const n = scope === "matching" ? matchingKeys.length : counts.ticked;
  const ready = scope === "matching" ? matching.ready : counts.ready;
  const noPhoto = scope === "matching" ? matching.total - matching.ready : counts.noPhoto;
  const willPublish =
    mode === "all"
      ? n - (scope === "matching" ? matching.noRecord : counts.noRecord)
      : mode === "photo-copy"
        ? scope === "matching"
          ? matching.readyWithCopy
          : counts.readyCopy
        : ready;

  const confirmPress = (verb: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (n === 0) {
      e.preventDefault();
      window.alert("Tick at least one product first.");
      return;
    }
    if (scope === "matching" || n > 25) {
      if (!window.confirm(`${verb} up to ${n} products?`)) e.preventDefault();
    }
  };

  return (
    <form
      id={BULK_FORM_ID}
      action={action}
      data-testid="bulk-status-bar"
      className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-surface-2)]/95 px-4 py-3 text-sm shadow-[var(--admin-shadow-sm)] backdrop-blur"
    >
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="mode" value={mode} />
      {scope === "matching" && <input type="hidden" name="matchingKeys" value={matchingKeys.join("\n")} />}

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-[var(--admin-text)]" data-testid="bulk-selected-count">
          {scope === "matching" ? `All ${matchingKeys.length} matching` : `${counts.ticked} ticked`}
        </span>
        <button type="button" onClick={() => setAll(true)} className="text-xs font-semibold text-[var(--admin-accent)] hover:underline">
          Select all on this page ({shownCount})
        </button>
        {matchingTotal > shownCount || scope === "selected" ? (
          <button
            type="button"
            onClick={() => setScope(scope === "matching" ? "selected" : "matching")}
            className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
          >
            {scope === "matching" ? "Only the ticked ones" : `Select every card matching this filter (${matchingKeys.length})`}
          </button>
        ) : null}
        <button type="button" onClick={() => setAll(false)} className="text-xs font-semibold text-[var(--admin-text-muted)] hover:underline">
          Clear
        </button>
      </div>

      <p className="text-xs text-[var(--admin-text-muted)]" data-testid="bulk-preflight">
        {ready} ready to publish (draft + photo) · {Math.max(0, noPhoto)} {scope === "matching" ? "not ready" : "have no photo"}
        {scope === "matching" ? ` · ${matching.readyNoCopy} of the ready ones only have the placeholder description` : ` · ${counts.noCopy} have no real description`}
        {` → Publish will change about ${Math.max(0, willPublish)}.`}
      </p>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-[var(--admin-text-muted)]">
          Publish:
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "photo" | "photo-copy" | "all")}
            className="rounded border border-[var(--admin-border-strong)] bg-[var(--admin-surface)] px-2 py-1 text-xs"
            aria-label="Which ticked products Publish applies to"
          >
            <option value="photo">only the ready ones (have a photo)</option>
            <option value="photo-copy">only ones with a photo and a real description</option>
            <option value="all">every ticked product</option>
          </select>
        </label>
        <button
          type="submit"
          name="status"
          value="published"
          onClick={confirmPress("Publish")}
          className="admin-focus rounded-full bg-[var(--admin-accent)] px-4 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.1em] text-black"
        >
          Publish
        </button>
        <button
          type="submit"
          name="status"
          value="draft"
          onClick={confirmPress("Move back to draft")}
          className="admin-focus rounded-full bg-[var(--admin-orange-soft)] px-4 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.1em] text-[var(--admin-orange)] ring-1 ring-[var(--admin-orange)]/40"
        >
          Unpublish
        </button>
        <button
          type="submit"
          name="status"
          value="archived"
          onClick={confirmPress("Archive")}
          className="admin-focus rounded-full bg-white/10 px-4 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.1em] text-[var(--admin-text-muted)]"
        >
          Archive
        </button>
      </div>
    </form>
  );
}
