/**
 * Breadcrumbs — wayfinding for detail pages so a non-technical user always
 * knows where they are and can get back up one level.
 *
 * Server-component friendly. Last crumb is the current page (not a link).
 *
 * Usage:
 *   <Breadcrumbs items={[
 *     { label: "Menu Imports", href: "/admin/menu-imports" },
 *     { label: "Import Review" },
 *   ]} />
 */
import Link from "next/link";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-white/40">
      <Link href="/admin" className="transition hover:text-white/70">
        Dashboard
      </Link>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            <span aria-hidden="true">/</span>
            {item.href && !isLast ? (
              <Link href={item.href} className="transition hover:text-white/70">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "text-white/70" : ""} aria-current={isLast ? "page" : undefined}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
