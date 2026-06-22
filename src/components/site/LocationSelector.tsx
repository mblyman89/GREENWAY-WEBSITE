import Link from "next/link";
import type { LocationPreviewRecord } from "@/components/location/location-preview-data";

type LocationSelectorProps = {
  location: LocationPreviewRecord;
};

export function LocationSelector({ location }: LocationSelectorProps) {
  return (
    <div className="group relative">
      <Link
        href="/locations"
        className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-black/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-black transition hover:bg-black hover:text-[var(--greenway)]"
        aria-label="View Greenway location details"
      >
        <span>{location.market}</span>
        <span aria-hidden="true">⌄</span>
      </Link>
      <div className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-72 translate-y-1 rounded-2xl border border-white/10 bg-zinc-950 p-4 text-white opacity-0 shadow-2xl shadow-black/50 transition group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--greenway)]">Location selector preview</p>
        <p className="mt-2 text-sm font-black text-white">{location.name}</p>
        <p className="mt-1 text-xs leading-5 text-zinc-400">{location.status}</p>
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <p className="text-xs leading-5 text-zinc-300">Additional store choices should be added only after Greenway confirms official location records.</p>
        </div>
      </div>
    </div>
  );
}
