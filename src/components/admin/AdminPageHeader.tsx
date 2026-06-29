import type { ReactNode } from "react";

/**
 * AdminPageHeader — consistent page title block across the back office.
 *
 * Slots:
 *  - breadcrumbs: wayfinding row above the title (use <Breadcrumbs />)
 *  - action: right-aligned primary action(s)
 *  - help: a collapsible help panel (use <HelpPanel />) rendered under the
 *    header so every section can explain itself in plain language.
 *
 * Token-driven (--admin-*) so it matches the rest of the shell. A subtle
 * sticky, blurred bar keeps the title + primary action in reach while scrolling.
 */
export function AdminPageHeader({
  title,
  subtitle,
  action,
  breadcrumbs,
  help,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  breadcrumbs?: ReactNode;
  help?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-[var(--admin-border)] bg-[var(--admin-canvas)]/80 backdrop-blur supports-[backdrop-filter]:bg-[var(--admin-canvas)]/70">
      {breadcrumbs ? (
        <div className="px-5 pt-4 sm:px-8">{breadcrumbs}</div>
      ) : null}
      <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-[var(--admin-text)] sm:text-2xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {action}
          </div>
        ) : null}
      </div>
      {help ? <div className="px-5 pb-5 sm:px-8">{help}</div> : null}
    </div>
  );
}
