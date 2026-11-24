"use client";

/**
 * src/components/site/NavChildLink.tsx — USAGE-9b.
 *
 * One desktop-dropdown category link. A client component on purpose: as a
 * server-rendered tree, every child (17 of them, in every page) put about 730
 * bytes of class names and markup into the RSC payload. As a client reference
 * each row is just {href,label,helper}. The SSR HTML is identical. Pinned by
 * src/lib/site/nav-child-core.ts.
 */
import Link from "@/components/site/IntentLink";

export function NavChildLink({ href, label, helper }: { href: string; label: string; helper: string }) {
  return (
    <Link
      href={href}
      className="group/child rounded-2xl border border-transparent px-3 py-2.5 transition hover:border-white/10 hover:bg-white/[0.05]"
    >
      <span className="flex items-center justify-between gap-3 text-sm font-black text-white transition group-hover/child:text-[var(--greenway)]">
        {label}
        <span className="text-xs text-zinc-600 transition group-hover/child:text-[var(--orange)]" aria-hidden="true">
          →
        </span>
      </span>
      <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{helper}</span>
    </Link>
  );
}
