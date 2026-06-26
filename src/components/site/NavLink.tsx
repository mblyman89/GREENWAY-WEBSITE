import Link from "next/link";
import type { NavigationItem } from "@/components/site/navigation-data";

type NavLinkProps = {
  item: NavigationItem;
};

export function NavLink({ item }: NavLinkProps) {
  const hasChildren = Boolean(item.children?.length);

  if (!hasChildren) {
    return (
      <Link href={item.href} className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:text-white">
        {item.label}
      </Link>
    );
  }

  return (
    <div className="group relative -my-3 py-3">
      <Link
        href={item.href}
        className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:text-white group-hover:text-white"
        aria-haspopup="true"
      >
        <span>{item.label}</span>
        <span className="text-[0.62rem] text-[var(--greenway)] transition group-hover:rotate-180" aria-hidden="true">
          ⌄
        </span>
      </Link>

      <div className="pointer-events-none absolute left-1/2 top-full z-[70] w-[22rem] max-h-[70vh] -translate-x-1/2 translate-y-2 overflow-y-auto rounded-[1.5rem] border border-white/10 bg-zinc-950/98 p-3 text-white opacity-0 shadow-2xl shadow-black/60 backdrop-blur transition group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
        {/* Transparent hover bridge: spans the gap between the trigger and the
            panel so dragging the cursor down keeps group-hover active. */}
        <div className="absolute -top-4 left-0 h-4 w-full" aria-hidden="true" />
        <div className="grid gap-1">
          {item.children?.map((child) => (
            <Link
              key={child.label}
              href={child.href}
              className="group/child rounded-2xl border border-transparent px-3 py-2.5 transition hover:border-white/10 hover:bg-white/[0.05]"
            >
              <span className="flex items-center justify-between gap-3 text-sm font-black text-white transition group-hover/child:text-[var(--greenway)]">
                {child.label}
                <span className="text-xs text-zinc-600 transition group-hover/child:text-[var(--orange)]" aria-hidden="true">
                  →
                </span>
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{child.helper}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
