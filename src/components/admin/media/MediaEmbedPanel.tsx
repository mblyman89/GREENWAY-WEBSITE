/**
 * src/components/admin/media/MediaEmbedPanel.tsx  (D244 R-4)
 *
 * The "Semantic photo search" card on /admin/media: is it on, how much of
 * the library is indexed (by words and by the picture), and Pause / Resume /
 * Retry failed. Server component; the buttons are plain forms posting to
 * ../embed-actions (media.manage + audit).
 */
import { Button } from "@/components/admin/ui/Button";
import type { EmbedPanel } from "@/lib/media/media-embed-server";

type Act = (formData: FormData) => Promise<void>;

const TONE: Record<EmbedPanel["line"]["tone"], string> = {
  ok: "text-[var(--admin-green)]",
  working: "text-[var(--admin-text)]",
  warn: "text-[var(--admin-orange)]",
  off: "text-[var(--admin-text-faint)]",
};

export function MediaEmbedPanel({ panel, pauseAction, retryAction }: { panel: EmbedPanel; pauseAction: Act; retryAction: () => Promise<void> }) {
  const h = panel.health;
  const ready = panel.migrated && panel.cap.columnReady;
  return (
    <section data-testid="media-embed-panel" className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--admin-text)]">Semantic photo search (finds photos by meaning, not just words)</h2>
        <span className="text-[11px] text-[var(--admin-text-faint)]">Model {panel.model} · 768 numbers per photo · pgvector</span>
      </div>
      <p className={`mt-2 text-sm font-medium ${TONE[panel.line.tone]}`} data-testid="media-embed-status">{panel.line.title}</p>
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{panel.line.detail}</p>
      {panel.error && <p className="mt-1 text-xs text-[var(--admin-orange)]">{panel.error}</p>}
      {ready && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-[var(--admin-border)]" aria-label={`${panel.line.pct}% indexed`}>
          <div className="h-full bg-[var(--admin-green)]" style={{ width: `${Math.max(0, Math.min(100, panel.line.pct))}%` }} />
        </div>
      )}
      {ready && h && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          {[
            ["Live photos", h.live_images],
            ["By their words", h.text_done],
            ["By the picture", h.image_done],
            ["Could not read", h.failed],
            ["Not PNG/JPEG", h.skipped],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded border border-[var(--admin-border)] px-2 py-1.5">
              <div className="text-[var(--admin-text-faint)]">{label}</div>
              <div className="text-sm font-semibold text-[var(--admin-text)]">{value}</div>
            </div>
          ))}
        </div>
      )}
      <details className="mt-3 text-xs text-[var(--admin-text-muted)]">
        <summary className="cursor-pointer font-medium text-[var(--admin-text)]">How it works</summary>
        <p className="mt-1">
          Every search box that looks for photos (the product page&rsquo;s recommended photos, &ldquo;Search for a better picture&rdquo; and &ldquo;Find similar&rdquo;) now asks two questions at once: which photos
          contain these words, and which photos mean the same thing (by their description and by what the picture shows). The two lists are merged so a photo that wins both comes first. A photo found
          only by meaning is shown with a &ldquo;Matches by meaning&rdquo; chip and is never marked High on its own. Nothing is attached automatically by this search.
        </p>
        <p className="mt-1">Indexing runs in the background when the AI worker has nothing else to do. A changed caption or a new file is re-indexed automatically. Cost: about $0.20 per million words and $0.45 per million picture tokens (a full library of a few thousand photos is well under a dollar).</p>
      </details>
      {ready && (
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={pauseAction}>
            <input type="hidden" name="to" value={panel.state.paused ? "running" : "paused"} />
            <Button type="submit" variant="neutral" data-testid="media-embed-pause">{panel.state.paused ? "▶ Resume indexing" : "⏸ Pause indexing"}</Button>
          </form>
          {h && h.failed > 0 && (
            <form action={retryAction}>
              <Button type="submit" variant="neutral" data-testid="media-embed-retry">↻ Retry {h.failed} that could not be read</Button>
            </form>
          )}
        </div>
      )}
      {panel.state.lastNote && <p className="mt-2 text-[11px] text-[var(--admin-text-faint)]">Last run: {panel.state.lastNote}</p>}
    </section>
  );
}
