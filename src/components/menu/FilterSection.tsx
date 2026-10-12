import type { ReactNode } from "react";

type FilterSectionProps = {
  title: string;
  helper?: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function FilterSection({ title, helper, children, defaultOpen = true }: FilterSectionProps) {
  return (
    // R49 S1 — STACKING RULE: every flex/grid child here carries min-w-0 and the
    // text wraps ([overflow-wrap:anywhere]), so a long section title or a wide
    // child can never push past the filter rail's edge into the product grid.
    <details className="group min-w-0 max-w-full border-t border-white/10 pt-6" open={defaultOpen}>
      <summary className="flex min-h-10 min-w-0 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block break-words text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)] [overflow-wrap:anywhere]">{title}</span>
          {helper ? <span className="mt-1 block break-words text-[0.68rem] leading-4 text-zinc-500 [overflow-wrap:anywhere]">{helper}</span> : null}
        </span>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-sm font-black text-zinc-400 transition group-open:rotate-45 group-hover:border-[var(--greenway)]/45 group-hover:text-white" aria-hidden="true">
          +
        </span>
      </summary>
      <div className="mt-4 min-w-0 max-w-full">{children}</div>
    </details>
  );
}
