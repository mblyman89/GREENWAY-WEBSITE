import type { StoreHourRow } from "@/components/location/location-preview-data";

type StoreHoursProps = {
  hours: StoreHourRow[];
  id?: string;
};

export function StoreHours({ hours, id }: StoreHoursProps) {
  return (
    <div id={id} className="rounded-[2rem] border border-white/10 bg-black/55 p-6 backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">Store hours</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-white">Verify before visiting.</h2>
        </div>
        <span className="rounded-full border border-[var(--gold)]/35 bg-[var(--gold)]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[var(--gold)]">
          Pending official records
        </span>
      </div>

      <div className="mt-6 grid gap-2">
        {hours.map((row) => (
          <div key={row.day} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-sm font-black uppercase tracking-[0.14em] text-white">{row.day}</p>
            <p className={row.isVerified ? "text-sm font-bold text-[var(--greenway)]" : "text-sm font-bold text-zinc-400"}>{row.value}</p>
          </div>
        ))}
      </div>

      <p className="mt-5 text-sm leading-6 text-zinc-400">
        These rows are structured so verified hours can be swapped in later without redesigning the page. Until then, the page avoids inventing business-hour details.
      </p>
    </div>
  );
}
