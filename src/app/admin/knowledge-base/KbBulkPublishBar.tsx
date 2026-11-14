"use client";
/**
 * src/app/admin/knowledge-base/KbBulkPublishBar.tsx  (D244 round 6, slice R-19)
 *
 * Owner (verbatim): "I need a way to approve all of the 20,000 records
 * awaiting me in the kb data pipeline. The bronze, silver, gold page."
 *
 * Shown on the Data pipeline page and the Review inbox. Pick a quality bar
 * and a source, press "Check first" to see how many would publish (nothing
 * changes), then "Publish every draft that passes". The browser walks every
 * draft 500 at a time with a running total and a Stop button; the rest stay
 * drafts for a person, with the reason counted.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { kbBulkPublishPageAction } from "./bulk-publish-actions";
import {
  KB_DEFAULT_MIN_QUALITY,
  KB_QUALITY_OPTIONS,
  KB_SOURCE_OPTIONS,
  addKbTotals,
  emptyKbTotals,
  kbBulkConfirm,
  kbBulkProgress,
  kbBulkSummary,
  type KbSourceGroup,
} from "@/lib/ai/kb/kb-bulk-review-core";

/** Safety stop: 200 pages × 500 = 100,000 drafts in one press. */
const MAX_PAGES = 200;

export function KbBulkPublishBar(props: { drafts: number }) {
  const { drafts } = props;
  const router = useRouter();
  const stop = useRef(false);
  const [minQuality, setMinQuality] = useState<number>(KB_DEFAULT_MIN_QUALITY);
  const [source, setSource] = useState<KbSourceGroup>("all");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );

  const walk = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm(kbBulkConfirm(drafts, minQuality, source))) return;
    stop.current = false;
    setRunning(true);
    setSummary(null);
    setError(null);
    let t = emptyKbTotals();
    let cursor = "";
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        if (stop.current) break;
        setProgress(kbBulkProgress(t, drafts, dryRun));
        const r = await kbBulkPublishPageAction({ cursor, minQuality, source, dryRun }).catch((e: unknown) => ({
          totals: emptyKbTotals(),
          nextCursor: cursor,
          done: true,
          error: e instanceof Error ? e.message : "The server did not answer. Press again to carry on.",
        }));
        t = addKbTotals(t, r.totals);
        if (r.error) {
          setError(r.error);
          break;
        }
        cursor = r.nextCursor;
        if (r.done) break;
      }
      setSummary(kbBulkSummary(t, dryRun) + (stop.current ? " Stopped early; press again to carry on." : ""));
      if (!dryRun) router.refresh();
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-surface)] px-4 py-3" data-testid="kb-bulk-publish-bar">
      <p className="text-sm font-semibold text-[var(--admin-text)]">Publish every draft that passes ({drafts.toLocaleString("en-US")} waiting)</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-[var(--admin-text-muted)]">
          Quality bar
          <select data-testid="kb-bulk-quality" value={minQuality} disabled={running} onChange={(e) => setMinQuality(Number(e.target.value))} className="rounded border border-[var(--admin-border)] bg-transparent px-2 py-1 text-xs text-[var(--admin-text)]">
            {KB_QUALITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--admin-text-muted)]">
          Source
          <select data-testid="kb-bulk-source" value={source} disabled={running} onChange={(e) => setSource(e.target.value as KbSourceGroup)} className="rounded border border-[var(--admin-border)] bg-transparent px-2 py-1 text-xs text-[var(--admin-text)]">
            {KB_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" data-testid="kb-bulk-check" onClick={() => void walk(true)} disabled={running || drafts === 0} className="rounded-lg border border-[var(--admin-border)] px-3 py-1.5 text-xs font-semibold text-[var(--admin-text)] hover:bg-white/5 disabled:opacity-40">
          Check first (changes nothing)
        </button>
        <button type="button" data-testid="kb-bulk-publish" onClick={() => void walk(false)} disabled={running || drafts === 0} className="rounded-lg bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-40">
          {"\u2705"} Publish every draft that passes
        </button>
        {running ? (
          <button type="button" data-testid="kb-bulk-stop" disabled={!running} onClick={() => (stop.current = true)} className="rounded-lg border border-[var(--admin-border)] px-3 py-1.5 text-xs text-[var(--admin-text-muted)] hover:bg-white/5">
            Stop
          </button>
        ) : null}
      </div>
      {progress ? (
        <p className="text-xs text-[var(--admin-text-muted)]" role="status">
          {progress}
        </p>
      ) : null}
      {summary ? (
        <p className="text-xs text-[var(--admin-accent)]" role="status" data-testid="kb-bulk-summary">
          {summary}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-[var(--admin-orange)]" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-[0.65rem] text-[var(--admin-text-faint)]">
        Each draft must meet the quality bar (the same score as its review card) and pass the WA compliance scan, including your banned-phrase list. The rest stay drafts here for you, with the reason counted. Works 500 at a time, so 20,000 records take about 40 steps. You can archive any published record later.
      </p>
    </div>
  );
}
