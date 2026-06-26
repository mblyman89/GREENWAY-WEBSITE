import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_URL } from "@/lib/seo/seo";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type BreadcrumbsProps = {
  items: BreadcrumbItem[];
  /** Optional explicit path for the last (current) crumb so JSON-LD has a URL. */
  currentPath?: string;
};

export function Breadcrumbs({ items, currentPath }: BreadcrumbsProps) {
  // Build BreadcrumbList JSON-LD (Home + provided crumbs). The last crumb falls
  // back to currentPath, then its href, so structured data always has a URL.
  const listElements = [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    ...items.map((item, index) => {
      const isLast = index === items.length - 1;
      const path = item.href ?? (isLast ? currentPath : undefined);
      const element: Record<string, unknown> = {
        "@type": "ListItem",
        position: index + 2,
        name: item.label,
      };
      if (path) element.item = path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
      return element;
    }),
  ];
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: listElements,
  };

  return (
    <nav aria-label="Breadcrumb" className="relative border-b border-white/10 bg-black/80 px-4 py-3 md:px-8">
      <JsonLd data={breadcrumbJsonLd} id="breadcrumbs" />
      <ol className="mx-auto flex max-w-[88rem] flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.16em]">
        <li>
          <Link href="/" className="text-zinc-500 transition hover:text-[var(--greenway)]">
            Home
          </Link>
        </li>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2">
              <span className="text-zinc-700" aria-hidden="true">
                /
              </span>
              {item.href && !isLast ? (
                <Link href={item.href} className="text-zinc-500 transition hover:text-[var(--greenway)]">
                  {item.label}
                </Link>
              ) : (
                <span className="text-[var(--greenway)]" aria-current="page">
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
