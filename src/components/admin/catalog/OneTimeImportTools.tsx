/**
 * src/components/admin/catalog/OneTimeImportTools.tsx   (S21, bible F-075)
 *
 * Wraps the Menu Imports upload section.
 *
 *   Before cutover (or when the read failed): the upload renders exactly as
 *   before, open, because it is the one thing the owner came to do.
 *   After the one-time import went live: a banner states WHEN it happened and
 *   how big it was, and the upload sits behind a closed native <details>
 *   ("Show one-time import tools"). Closed by default = no `open` attribute
 *   (MDN <details>); keyboard and screen-reader support come with the element.
 *
 * Pure presentational server component (no hooks, no client directive) so the
 * compliance suite can render both states with renderToStaticMarkup.
 */
import type { ReactNode } from "react";
import {
  ONE_TIME_TOOLS_SUMMARY,
  completedHeadline,
  laterUploadNote,
  oneTimeToolsNote,
  storeDate,
  type MenuImportsCutover,
} from "@/lib/inventory/menu-imports-cutover-core";

export function OneTimeImportTools({
  cutover,
  refused,
  children,
}: {
  cutover: MenuImportsCutover;
  /** The S18 guard's verdict (readCutoverDone) - drives the "refused" wording only. */
  refused: boolean;
  children: ReactNode;
}) {
  if (!cutover.done) return <>{children}</>;
  const { first, latest, realPublishedCount } = cutover;
  return (
    <section
      data-testid="cultivera-import-done"
      className="rounded-xl border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/5 p-5"
    >
      <h2 className="text-sm font-semibold text-white">{completedHeadline(storeDate(first.publishedAt), first)}</h2>
      <p className="mt-1 text-xs text-white/50">
        Everything new comes in through receiving now. This page stays useful for the rare menu update that waits
        for review (above).
      </p>
      {latest && realPublishedCount !== null && realPublishedCount > 1 && (
        <p data-testid="cultivera-later-upload" className="mt-2 text-xs text-[var(--admin-gold)]">
          {laterUploadNote(storeDate(latest.publishedAt), realPublishedCount)}
        </p>
      )}
      <details data-testid="one-time-import-tools" className="mt-4 rounded-lg border border-white/10 bg-black/20">
        <summary className="admin-focus cursor-pointer px-4 py-2.5 text-xs font-semibold text-white/80">
          {ONE_TIME_TOOLS_SUMMARY}
        </summary>
        <div className="space-y-3 px-4 pb-4">
          <p className="text-xs text-white/50">{oneTimeToolsNote(refused)}</p>
          {children}
        </div>
      </details>
    </section>
  );
}
