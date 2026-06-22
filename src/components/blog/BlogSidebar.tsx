type BlogSidebarProps = {
  categories: string[];
  replacementNotes: string[];
};

export function BlogSidebar({ categories, replacementNotes }: BlogSidebarProps) {
  return (
    <aside className="grid gap-5 lg:sticky lg:top-32">
      <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--greenway)]">Draft categories</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {categories.map((category) => (
            <span key={category} className="rounded-full border border-white/10 bg-black/45 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-zinc-300">
              {category}
            </span>
          ))}
        </div>
      </div>

      <div className="film-strip rounded-[2rem] border border-[var(--orange)]/25 bg-[var(--orange)]/10 p-6">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--orange)]">Replacement plan</p>
        <div className="mt-5 grid gap-3">
          {replacementNotes.map((note) => (
            <div key={note} className="rounded-2xl border border-white/10 bg-black/35 p-4">
              <p className="text-sm leading-6 text-zinc-300">{note}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[2rem] border border-[var(--gold)]/25 bg-[var(--gold)]/10 p-6">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--gold)]">21+ content note</p>
        <p className="mt-3 text-sm leading-6 text-zinc-300">
          Future articles should remain adult-use focused, factual, reviewed, and aligned with Washington cannabis compliance expectations before publishing.
        </p>
      </div>
    </aside>
  );
}
