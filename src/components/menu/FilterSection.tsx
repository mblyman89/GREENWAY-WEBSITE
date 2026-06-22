import type { ReactNode } from "react";

type FilterSectionProps = {
  title: string;
  helper?: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function FilterSection({ title, helper, children, defaultOpen = true }: FilterSectionProps) {
  return (
    <details className="group border-t border-white/10 pt-6" open={defaultOpen}>
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">{title}</span>
          {helper ? <span className="mt-1 block text-[0.68rem] leading-4 text-zinc-500">{helper}</span> : null}
        </span>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-sm font-black text-zinc-400 transition group-open:rotate-45 group-hover:border-[var(--greenway)]/45 group-hover:text-white" aria-hidden="true">
          +
        </span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
