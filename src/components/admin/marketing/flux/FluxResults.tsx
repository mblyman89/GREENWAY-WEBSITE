"use client";

/**
 * FluxResults — the live results gallery for image and video jobs (R62).
 * Every finished file is already saved to the media library as a DRAFT.
 */
import Link from "next/link";
import type { FluxJob } from "./useFluxJobs";

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function FluxResults({
  jobs,
  now,
  onUseAsReference,
  onReuseSeed,
  onEnhanceDraft,
  onUseVideo,
  onRemove,
  onClear,
  emptyText,
}: {
  jobs: FluxJob[];
  now: number;
  onUseAsReference?: (j: FluxJob) => void;
  onReuseSeed?: (seed: number) => void;
  onEnhanceDraft?: (j: FluxJob) => void;
  onUseVideo?: (j: FluxJob) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  emptyText: string;
}) {
  if (jobs.length === 0) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-[var(--admin-radius-lg)] border border-dashed border-[var(--admin-border-strong)] p-6 text-center text-sm text-[var(--admin-text-muted)]">
        {emptyText}
      </div>
    );
  }
  const anyDone = jobs.some((j) => j.state !== "pending");
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">Results</h3>
        {anyDone && (
          <button type="button" onClick={onClear} className="text-[0.7rem] font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]">
            Clear finished
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {jobs.map((j) => (
          <div key={j.key} className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
            <div className="relative flex aspect-[4/3] items-center justify-center bg-[var(--admin-canvas)]">
              {j.state === "ready" && j.asset ? (
                j.kind === "video" ? (
                  <video src={j.asset.url} controls playsInline className="h-full w-full object-contain" />
                ) : (
                  <a href={j.asset.url} target="_blank" rel="noreferrer" className="block h-full w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img loading="lazy" decoding="async" src={j.asset.url} alt={j.asset.title} className="h-full w-full object-contain" />
                  </a>
                )
              ) : j.state === "pending" ? (
                <div className="text-center">
                  <div className="mx-auto mb-2 h-7 w-7 animate-spin rounded-full border-2 border-[var(--admin-accent)] border-t-transparent" aria-hidden />
                  <p className="text-xs font-semibold text-[var(--admin-text)]">{j.label || "Queued"}…</p>
                  <p className="text-[0.65rem] text-[var(--admin-text-faint)]">
                    {elapsed(now - j.startedAt)}
                    {typeof j.progress === "number" ? ` · ${Math.round(j.progress * (j.progress <= 1 ? 100 : 1))}%` : ""}
                  </p>
                </div>
              ) : (
                <p className="px-4 text-center text-xs text-[var(--admin-danger)]">{j.error || "Failed."}</p>
              )}
            </div>
            <div className="space-y-1.5 p-2.5">
              {j.meta && <p className="text-[0.68rem] text-[var(--admin-text-faint)]">{j.meta}</p>}
              <div className="flex flex-wrap gap-1.5">
                {j.state === "ready" && j.asset && (
                  <>
                    <Link href={`/admin/media/${j.asset.id}`} className="rounded-md bg-[var(--admin-accent-soft)] px-2 py-1 text-[0.68rem] font-bold text-[var(--admin-accent)]">
                      Open in media (draft)
                    </Link>
                    <a href={j.asset.url} download={j.asset.filename} className="rounded-md bg-[var(--admin-surface-2)] px-2 py-1 text-[0.68rem] font-bold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]">
                      Download
                    </a>
                    {j.kind === "image" && onUseAsReference && (
                      <button type="button" onClick={() => onUseAsReference(j)} className="rounded-md bg-[var(--admin-surface-2)] px-2 py-1 text-[0.68rem] font-bold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]">
                        Use as reference
                      </button>
                    )}
                    {j.kind === "video" && onUseVideo && (
                      <button type="button" onClick={() => onUseVideo(j)} className="rounded-md bg-[var(--admin-surface-2)] px-2 py-1 text-[0.68rem] font-bold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]" title="Use this clip as the source for Continue, Edit or Upscale">
                        Use as source clip
                      </button>
                    )}
                    {j.kind === "video" && j.draftCache && onEnhanceDraft && (
                      <button type="button" onClick={() => onEnhanceDraft(j)} className="rounded-md bg-[var(--admin-orange)] px-2 py-1 text-[0.68rem] font-bold text-black">
                        Enhance draft → full quality
                      </button>
                    )}
                  </>
                )}
                {typeof j.seed === "number" && onReuseSeed && (
                  <button type="button" onClick={() => onReuseSeed(j.seed as number)} className="rounded-md bg-[var(--admin-surface-2)] px-2 py-1 text-[0.68rem] font-bold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]" title="Put this seed back into the settings">
                    Seed {j.seed}
                  </button>
                )}
                {j.state !== "pending" && (
                  <button type="button" onClick={() => onRemove(j.key)} className="ml-auto rounded-md px-1.5 py-1 text-[0.68rem] text-[var(--admin-text-faint)] hover:text-[var(--admin-text)]" aria-label="Remove from results">
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
