"use client";

/**
 * BatchTransferImport — Slice H11b. Paste hundreds of Cultivera "Transfer
 * Data Link" URLs (one per line); we import them ALL: the list is cleaned +
 * de-duplicated client-side, then submitted in small sequential chunks so a
 * single serverless call never has to survive hundreds of remote fetches.
 *
 * DRAFTS-ONLY: each staged manifest lands exactly like the single-URL
 * importer — status 'pending', lots in quarantine, human review required.
 * Live per-URL results (staged / already imported / failed) with links
 * straight to each staged manifest's review page.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Field, Textarea } from "@/components/admin/ui";
import {
  parseUrlList,
  chunkUrls,
  summarizeBatch,
  statusLabel,
  MAX_BATCH_URLS,
  type BatchUrlResult,
} from "@/lib/inventory/batch-import-core";

type Props = {
  importBatch: (urls: string[]) => Promise<BatchUrlResult[]>;
};

export function BatchTransferImport({ importBatch }: Props) {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const [results, setResults] = useState<BatchUrlResult[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);

  const preview = useMemo(() => parseUrlList(text), [text]);
  const summary = useMemo(() => summarizeBatch(results), [results]);

  async function run() {
    if (running || preview.urls.length === 0) return;
    setRunning(true);
    setDone(false);
    setFatal(null);
    setResults([]);
    const chunks = chunkUrls(preview.urls);
    setProgress({ sent: 0, total: preview.urls.length });
    try {
      for (const chunk of chunks) {
        // Sequential on purpose: keeps server load gentle and progress honest.
        const chunkResults = await importBatch(chunk);
        setResults((prev) => [...prev, ...chunkResults]);
        setProgress((p) => ({ ...p, sent: p.sent + chunk.length }));
      }
      setDone(true);
    } catch (err) {
      setFatal(
        err instanceof Error && err.message
          ? `The batch stopped early: ${err.message}`
          : "The batch stopped early — results below are what completed. Re-paste and run again; duplicates are skipped automatically.",
      );
    } finally {
      setRunning(false);
    }
  }

  const tone = (status: BatchUrlResult["status"]): string => {
    if (status === "staged") return "text-[var(--admin-accent)]";
    if (status === "duplicate") return "text-[var(--admin-text-muted)]";
    return "text-[var(--admin-danger)]";
  };

  return (
    <div className="space-y-4">
      <Field
        label="Transfer Data Links (one per line)"
        help={`Paste up to ${MAX_BATCH_URLS} links from your order emails. Doubled prefixes are fixed and exact duplicates removed automatically.`}
        htmlFor="batch_urls"
      >
        <Textarea
          id="batch_urls"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"https://files.cultivera.com/.../Cultivera_ORD-20001_413541.json\nhttps://files.cultivera.com/.../Cultivera_ORD-20002_413541.json\n…"}
          disabled={running}
        />
      </Field>

      {text.trim() && (
        <p className="text-xs text-[var(--admin-text-muted)]">
          {preview.urls.length} link{preview.urls.length === 1 ? "" : "s"} ready
          {preview.duplicates > 0 ? ` · ${preview.duplicates} duplicate(s) removed` : ""}
          {preview.invalid.length > 0 ? ` · ${preview.invalid.length} line(s) aren't URLs` : ""}
          {preview.truncated ? ` · list capped at ${MAX_BATCH_URLS} — run the rest in a second batch` : ""}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="save"
          size="sm"
          disabled={running || preview.urls.length === 0}
          onClick={run}
        >
          {running
            ? `Importing… ${progress.sent}/${progress.total}`
            : `Fetch & stage ${preview.urls.length > 0 ? preview.urls.length : ""} link${preview.urls.length === 1 ? "" : "s"}`}
        </Button>
        {running && (
          <span className="text-xs text-[var(--admin-text-faint)]">
            Working in small batches — keep this tab open.
          </span>
        )}
      </div>

      {fatal && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
          {fatal}
        </div>
      )}

      {done && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
          Batch finished — {summary.staged} staged for review, {summary.duplicates} already
          imported, {summary.failed} failed. Staged manifests are pending drafts: review each one,
          then use &ldquo;Promote all manifests to KB drafts&rdquo; below to seed the Knowledge
          Base.
        </div>
      )}

      {results.length > 0 && (
        <div className="overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--admin-surface-2)] text-[var(--admin-text-faint)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Link</th>
                <th className="px-3 py-2 font-semibold">Result</th>
                <th className="px-3 py-2 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.url}-${i}`} className="border-t border-[var(--admin-border)]">
                  <td className="max-w-[280px] truncate px-3 py-2 text-[var(--admin-text-muted)]" title={r.url}>
                    {r.url}
                  </td>
                  <td className={`px-3 py-2 font-semibold ${tone(r.status)}`}>
                    {statusLabel(r.status)}
                  </td>
                  <td className="px-3 py-2 text-[var(--admin-text-muted)]">
                    {r.manifestId ? (
                      <Link
                        href={`/admin/inventory/intake/${r.manifestId}`}
                        className="font-semibold text-[var(--admin-accent)] underline"
                      >
                        {r.detail ?? "Open manifest"}
                      </Link>
                    ) : (
                      r.detail ?? "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
