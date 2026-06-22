export function SortBar({ total }: { total: number }) {
  return (
    <div className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-black/45 p-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-black text-white">Showing {total} preview products</p>
        <p className="mt-1 text-xs text-zinc-400">Static mock layout for design review before live Leafly data.</p>
      </div>
      <label className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-300">
        Sort
        <select className="rounded-full border border-white/10 bg-zinc-950 px-4 py-3 text-sm normal-case tracking-normal text-white">
          <option>Name A-Z</option>
          <option>Price Low-High</option>
          <option>Price High-Low</option>
          <option>Newest First</option>
          <option>Most Popular</option>
        </select>
      </label>
    </div>
  );
}
