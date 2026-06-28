import type { ReactNode } from "react";

/**
 * AdminPageHeader — consistent page title block across the back office.
 *
 * Slots:
 *  - breadcrumbs: wayfinding row above the title (use <Breadcrumbs />)
 *  - action: right-aligned primary action(s)
 *  - help: a collapsible help panel (use <HelpPanel />) rendered under the
 *    header so every section can explain itself in plain language.
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
    <div className="border-b border-white/10">
      <div className="px-5 pt-5 sm:px-8">
        {breadcrumbs}
      </div>
      <div className="flex flex-col gap-3 px-5 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-8">
        <div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-white/50">{subtitle}</p>}
        </div>
        {action}
      </div>
      {help && <div className="px-5 pb-5 sm:px-8">{help}</div>}
    </div>
  );
}
