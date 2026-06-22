type FilterTag = {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
};

type FilterTagsProps = {
  tags: FilterTag[];
  onClearAll: () => void;
};

export function FilterTags({ tags, onClearAll }: FilterTagsProps) {
  if (!tags.length) {
    return (
      <div className="mb-6 rounded-3xl border border-white/10 bg-zinc-950/70 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">No active filters · showing the full mock catalog</p>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-3xl border border-[var(--greenway)]/20 bg-[var(--greenway)]/10 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--greenway)]">Active filters</p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">Refine the preview menu without calling live inventory or reservation systems.</p>
        </div>
        <button
          type="button"
          onClick={onClearAll}
          className="w-fit rounded-full border border-white/10 bg-black/35 px-4 py-2 text-[0.65rem] font-black uppercase tracking-[0.14em] text-white transition hover:border-[var(--orange)]/60 hover:text-[var(--orange)]"
        >
          Clear all
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <button
            key={tag.key}
            type="button"
            onClick={tag.onRemove}
            className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-2 text-xs font-bold text-zinc-200 transition hover:border-[var(--greenway)]/50 hover:bg-black hover:text-white"
            aria-label={`Remove ${tag.label} filter`}
          >
            <span className="text-zinc-500">{tag.label}:</span>
            <span>{tag.value}</span>
            <span className="text-zinc-600 transition group-hover:text-[var(--orange)]" aria-hidden="true">×</span>
          </button>
        ))}
      </div>
    </div>
  );
}
