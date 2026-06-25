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
  // Nothing renders when there are no active filters — the pill row disappears entirely.
  if (!tags.length) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <button
          key={tag.key}
          type="button"
          onClick={tag.onRemove}
          className="group inline-flex items-center gap-2 rounded-full border border-[var(--greenway)]/45 bg-[var(--greenway)]/12 px-3.5 py-1.5 text-xs font-black uppercase tracking-[0.08em] text-white transition hover:border-[var(--orange)]/70 hover:bg-[var(--orange)]/15"
          aria-label={`Remove ${tag.label} filter ${tag.value}`}
        >
          <span>{tag.value}</span>
          <span className="text-sm leading-none text-[var(--greenway)] transition group-hover:text-[var(--orange)]" aria-hidden="true">
            ×
          </span>
        </button>
      ))}

      {tags.length > 1 ? (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex items-center rounded-full border border-white/15 bg-black/40 px-3.5 py-1.5 text-xs font-black uppercase tracking-[0.08em] text-zinc-300 transition hover:border-white hover:text-white"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
