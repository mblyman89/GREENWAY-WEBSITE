/**
 * src/components/admin/media/MediaHealthDashboard.tsx   (D221 M5 + M7)
 *
 * The library health dashboard on /admin/media: the healthTiles() from
 * library-v2-core, the one-click Undo / Redo of auto-publish (M5) and the top
 * searches of the last 30 days (zero-result ones first, so the owner sees what
 * people looked for and did not find). Server component; the buttons are
 * plain forms posting to ../library-actions (media.manage + audit).
 */
import Link from "next/link";
import { Button } from "@/components/admin/ui/Button";
import { healthTiles } from "@/lib/media/library-v2-core";
import type { SearchSummaryRow } from "@/lib/media/library-v2-server";

type Act = (formData: FormData) => Promise<void>;

const TONE: Record<string, string> = {
  good: "text-[var(--admin-accent)]",
  warn: "text-[var(--admin-orange)]",
  muted: "text-[var(--admin-text)]",
};

export function MediaHealthDashboard({
  health,
  searches,
  autoPublishAction,
  returnTo,
}: {
  health: Record<string, number> | null;
  searches: SearchSummaryRow[];
  autoPublishAction: Act;
  returnTo: string;
}) {
  const tiles = healthTiles(health);
  if (tiles.length === 0) return null;
  const autoPublished = Number(health?.auto_published ?? 0);
  const reverted = Number(health?.auto_reverted ?? 0);
  const hasV2 = health ? "auto_reverted" in health : false;

  return (
    <section data-testid="media-health-dashboard" className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--admin-text)]">Library health</h2>
        <Link href="/admin/media/review" className="text-xs font-semibold text-[var(--admin-accent)] hover:underline">Open the review queue →</Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.key} className="rounded border border-[var(--admin-border)] px-2 py-1.5" title={t.hint}>
            <div className="text-[var(--admin-text-faint)]">{t.label}</div>
            <div className={`text-sm font-semibold ${TONE[t.tone]}`}>{t.value}</div>
            <div className="truncate text-[10px] text-[var(--admin-text-faint)]">{t.hint}</div>
          </div>
        ))}
      </div>

      {/* M5: one-click undo of auto-publish (and redo). */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--admin-text-muted)]">
        <span>
          {autoPublished} picture(s) were published automatically from vendor menus{reverted ? ` · ${reverted} set back to draft` : ""}.
        </span>
        {hasV2 ? (
          <>
            {autoPublished > 0 && (
              <form action={autoPublishAction}>
                <input type="hidden" name="mode" value="undo" />
                <input type="hidden" name="return_to" value={returnTo} />
                <Button type="submit" variant="danger" size="sm" data-testid="media-undo-auto-publish">
                  Undo auto-publish ({autoPublished})
                </Button>
              </form>
            )}
            {reverted > 0 && (
              <form action={autoPublishAction}>
                <input type="hidden" name="mode" value="redo" />
                <input type="hidden" name="return_to" value={returnTo} />
                <Button type="submit" variant="neutral" size="sm">Redo ({reverted})</Button>
              </form>
            )}
          </>
        ) : (
          <span className="text-[var(--admin-orange)]">The Undo button appears once the 0354 database update is applied.</span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">
        Undo sets them back to draft (nothing is deleted) and the nightly auto-publish leaves them alone after that. Pictures a person
        published are never touched.
      </p>

      {searches.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold text-[var(--admin-text)]">Top searches, last 30 days ({searches.length})</summary>
          <table className="mt-2 w-full text-left">
            <thead className="text-[var(--admin-text-faint)]">
              <tr>
                <th className="py-1 pr-2 font-normal">Search</th>
                <th className="py-1 pr-2 font-normal">Times</th>
                <th className="py-1 pr-2 font-normal">Found nothing</th>
              </tr>
            </thead>
            <tbody>
              {searches.map((s) => (
                <tr key={s.query} className="border-t border-[var(--admin-border)]">
                  <td className="py-1 pr-2">
                    <Link href={`/admin/media?q=${encodeURIComponent(s.query)}`} className="hover:text-[var(--admin-accent)]">{s.query}</Link>
                  </td>
                  <td className="py-1 pr-2">{s.searches}</td>
                  <td className={`py-1 pr-2 ${s.zero_hits > 0 ? "text-[var(--admin-orange)]" : ""}`}>{s.zero_hits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
