"use client";

/**
 * KbBackfillPanel — Slice H12g. The "⚡ Promote all manifests to KB drafts"
 * button, rebuilt as a client panel with LIVE progress and an unmissable
 * confirmation. Owner: "I clicked the button on the promote all to kb, I'm
 * not sure if it works, I don't get a confirmation and I'm not sure where I
 * should look on the kb page to see if I promoted anything to it."
 *
 * The old form action swept up to 1000 manifests in ONE serverless call and
 * only then redirected with a banner — a big backlog can outlive the
 * function timeout, so the banner never showed. Now the panel:
 *  1. asks the server for the promotable manifest ids;
 *  2. promotes them in small sequential chunks (each call finishes fast)
 *     with a live "Promoting… X of Y" counter;
 *  3. finishes with a persistent success card that says exactly what
 *     happened AND links straight to the KB Review inbox
 *     (/admin/knowledge-base/review) where the drafts appear.
 *
 * DRAFTS-ONLY + idempotent: safe to re-run, existing KB data is gap-filled,
 * never overwritten, and nothing is published.
 */

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/admin/ui";
import {
  chunkManifestIds,
  summarizeKbBackfill,
  kbBackfillMessage,
  KB_REVIEW_INBOX_PATH,
  type KbChunkOutcome,
} from "@/lib/inventory/kb-backfill-core";

type Props = {
  listIds: () => Promise<{ ok: true; ids: string[] } | { ok: false; error: string }>;
  promoteChunk: (ids: string[]) => Promise<KbChunkOutcome[]>;
};

export function KbBackfillPanel({ listIds, promoteChunk }: Props) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function run() {
    if (running) return;
    setRunning(true);
    setMessage(null);
    setFailed(null);
    setProgress({ done: 0, total: 0 });
    try {
      const listed = await listIds();
      if (!listed.ok) {
        setFailed(listed.error);
        return;
      }
      if (listed.ids.length === 0) {
        setMessage(
          "No staged manifests to promote yet — import some transfers above, then run this.",
        );
        return;
      }
      const chunks = chunkManifestIds(listed.ids);
      setProgress({ done: 0, total: listed.ids.length });
      const outcomes: KbChunkOutcome[] = [];
      for (const chunk of chunks) {
        // Sequential on purpose: gentle on the server, honest progress.
        const chunkOutcomes = await promoteChunk(chunk);
        outcomes.push(...chunkOutcomes);
        setProgress((p) => ({ ...p, done: p.done + chunk.length }));
      }
      setMessage(kbBackfillMessage(summarizeKbBackfill(outcomes)));
    } catch (err) {
      setFailed(
        err instanceof Error && err.message
          ? `The run stopped early: ${err.message}. Safe to click again — completed work is kept and re-runs gap-fill only.`
          : "The run stopped early. Safe to click again — completed work is kept and re-runs gap-fill only.",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="save" size="sm" onClick={run} disabled={running}>
          {running
            ? `Promoting… ${progress.done} of ${progress.total || "?"} manifests`
            : "⚡ Promote all manifests to KB drafts"}
        </Button>
        {running && (
          <span className="inline-flex items-center gap-2 text-xs text-[var(--admin-text-muted)]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--admin-accent)] border-t-transparent" />
            Working — leave this page open.
          </span>
        )}
      </div>

      {message && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          <p className="font-semibold">✓ {message}</p>
          <p className="mt-1.5">
            <Link
              href={KB_REVIEW_INBOX_PATH}
              className="font-bold underline underline-offset-2 hover:opacity-80"
            >
              Open the KB Review inbox →
            </Link>{" "}
            <span className="text-[var(--admin-text-muted)]">
              (Knowledge Base → Review) — every promoted draft is waiting there for your
              validation.
            </span>
          </p>
        </div>
      )}

      {failed && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
          {failed}
        </div>
      )}
    </div>
  );
}
