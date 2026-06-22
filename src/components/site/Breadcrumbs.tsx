import Link from "next/link";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type BreadcrumbsProps = {
  items: BreadcrumbItem[];
};

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="relative border-b border-white/10 bg-black/80 px-4 py-3 md:px-8">
      <ol className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.16em]">
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
