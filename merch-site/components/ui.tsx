/**
 * Shop building blocks copied from greenwaymarijuana.com's shop
 * (src/components/menu/FilterSection.tsx, FilterCheckboxGroup.tsx,
 * SortDropdown.tsx, site/Breadcrumbs.tsx) - same class strings, so the merch
 * shop looks and behaves the same. Server-safe (no hooks) except where noted.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export function FilterSection({ title, helper, children, defaultOpen = true }: { title: string; helper?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group min-w-0 max-w-full border-t border-white/10 pt-6" open={defaultOpen}>
      <summary className="flex min-h-10 min-w-0 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block break-words text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)] [overflow-wrap:anywhere]">{title}</span>
          {helper ? <span className="mt-1 block break-words text-[0.68rem] leading-4 text-zinc-500 [overflow-wrap:anywhere]">{helper}</span> : null}
        </span>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-sm font-black text-zinc-400 transition group-open:rotate-45 group-hover:border-[var(--greenway)]/45 group-hover:text-white" aria-hidden="true">+</span>
      </summary>
      <div className="mt-4 min-w-0 max-w-full">{children}</div>
    </details>
  );
}

const ROW = "flex min-h-12 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition";
const ROW_ON = "border-[var(--greenway)] bg-[var(--greenway)]/10 text-white";
const ROW_OFF = "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:text-white";
const BOX = "grid h-5 w-5 shrink-0 place-items-center rounded border-2 text-[0.7rem] font-black leading-none text-black transition";

function RowInner({ checked, label, count }: { checked: boolean; label: string; count?: number }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className={`${BOX} ${checked ? "border-[var(--orange)] bg-[var(--orange)]" : "border-zinc-500 bg-transparent"}`} aria-hidden="true">{checked ? "✓" : ""}</span>
        <span className="min-w-0 break-words font-bold leading-snug [overflow-wrap:anywhere]">{label}</span>
      </span>
      {count !== undefined ? <span className={`shrink-0 rounded-full px-2 py-1 text-[0.65rem] font-black ${checked ? "bg-[var(--greenway)]/15 text-[var(--greenway)]" : "bg-black/35 text-zinc-500"}`}>{count}</span> : null}
    </>
  );
}

/** A filter row that is a LINK (category navigation from the filter bar). */
export function FilterLinkRow({ href, checked, label, count, onNavigate }: { href: string; checked: boolean; label: string; count?: number; onNavigate?: () => void }) {
  return (
    <Link href={href} onClick={onNavigate} aria-current={checked ? "page" : undefined} className={`${ROW} ${checked ? ROW_ON : ROW_OFF}`}>
      <RowInner checked={checked} label={label} count={count} />
    </Link>
  );
}

/** A filter row that is a checkbox (colour / size). */
export function FilterCheckRow({ name, value, checked, label, count, onToggle }: { name: string; value: string; checked: boolean; label: string; count?: number; onToggle: (v: string) => void }) {
  return (
    <label title={label} className={`${ROW} ${checked ? ROW_ON : ROW_OFF}`}>
      <input type="checkbox" name={name} value={value} checked={checked} onChange={() => onToggle(value)} className="sr-only" />
      <RowInner checked={checked} label={label} count={count} />
    </label>
  );
}

export function SearchIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.4" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export const SEARCH_INPUT_CLASS =
  "h-11 w-full rounded-full border border-white/10 bg-zinc-950 pl-11 pr-4 text-sm font-bold text-white outline-none transition placeholder:text-zinc-600 hover:border-[var(--greenway)]/45 focus:border-[var(--greenway)] focus:ring-2 focus:ring-[var(--greenway)]/20";

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="relative border-b border-white/10 bg-black/80 px-4 py-3 md:px-8">
      <ol className="mx-auto flex max-w-[var(--shop-max)] flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.16em]">
        <li><Link href="/" className="text-zinc-500 transition hover:text-[var(--greenway)]">Shop</Link></li>
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-2">
            <span className="text-zinc-700" aria-hidden="true">/</span>
            {item.href ? (
              <Link href={item.href} className="text-zinc-500 transition hover:text-[var(--greenway)]">{item.label}</Link>
            ) : (
              <span className="text-[var(--greenway)]" aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8 md:py-14">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--greenway)]">{eyebrow}</p>
      <h1 className="mt-2 text-[2.15rem] font-black leading-[0.96] tracking-[-0.045em] text-white md:text-5xl">{title}</h1>
      <div className="prose-merch mt-6">{children}</div>
    </main>
  );
}
