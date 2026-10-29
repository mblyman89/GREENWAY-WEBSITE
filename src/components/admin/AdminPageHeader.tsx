import type { ReactNode } from "react";
import Link from "next/link";
import { helperHref } from "@/lib/admin/page-helpers-core";

/**
 * AdminPageHeader — consistent page title block across the back office.
 *
 * Slots:
 *  - breadcrumbs: wayfinding row above the title (use <Breadcrumbs />)
 *  - action: right-aligned primary action(s). Wraps onto more lines rather
 *    than running off the screen (Fix Phase 2.9: it used to be shrink-0, so a
 *    long button row pushed past the right edge and was cut off).
 *  - toolbar: a FULL-WIDTH, wrapping row of buttons under the title, for
 *    pages with many links (Register Activity). Every button stays visible
 *    at any screen width.
 *  - helpId: R73 S5 — the page's "How this works" guide lives on the Helpers
 *    page (/admin/helpers); the header only shows a small link to it, so the
 *    guide no longer takes canvas space at the top of the page.
 *  - help: a collapsible help panel (use <HelpPanel />) rendered under the
 *    header (pages not yet moved to the Helpers page).
 *
 * R73 S5: the header scrolls away with the page (it used to be sticky, which
 * kept the title, subtitle and green helper on screen over the editors and
 * studios). The top menu bar stays pinned, so navigation is always one click
 * away. Padding is tighter and a long subtitle is clamped (full text on hover).
 */
export function AdminPageHeader({
  title,
  subtitle,
  action,
  breadcrumbs,
  help,
  helpId,
  toolbar,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  toolbar?: ReactNode;
  breadcrumbs?: ReactNode;
  help?: ReactNode;
  helpId?: string;
}) {
  return (
    <div className="border-b border-[var(--admin-border)]">
      {breadcrumbs ? (
        <div className="px-5 pt-3 sm:px-8">{breadcrumbs}</div>
      ) : null}
      <div className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="min-w-0 sm:max-w-[60%] sm:shrink-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="truncate text-lg font-bold tracking-tight text-[var(--admin-text)] sm:text-xl">
              {title}
            </h1>
            {helpId ? (
              <Link
                href={helperHref(helpId)}
                className="admin-focus shrink-0 text-xs font-medium text-[var(--admin-accent)] hover:underline"
              >
                ⓘ How this page works
              </Link>
            ) : null}
          </div>
          {subtitle ? (
            <p title={subtitle} className="mt-0.5 line-clamp-2 text-xs text-[var(--admin-text-muted)] sm:line-clamp-1 sm:text-sm">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end">
            {action}
          </div>
        ) : null}
      </div>
      {toolbar ? (
        <nav aria-label={`${title} links`} className="flex flex-wrap items-center gap-2 px-5 pb-3 sm:px-8">
          {toolbar}
        </nav>
      ) : null}
      {help ? <div className="px-5 pb-3 sm:px-8">{help}</div> : null}
    </div>
  );
}
