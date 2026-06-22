import type { LocationPreviewRecord } from "@/components/location/location-preview-data";
import { StoreStatusBadge } from "@/components/location/StoreStatusBadge";

type LocationCardProps = {
  location: LocationPreviewRecord;
};

function StorefrontPreview() {
  return (
    <div className="relative aspect-[1.28] overflow-hidden rounded-t-[1.4rem] bg-zinc-900 md:rounded-t-[2rem]">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(126,217,87,0.24)_0%,rgba(0,0,0,0.08)_42%,rgba(0,0,0,0.82)_100%),radial-gradient(circle_at_16%_18%,rgba(255,215,0,0.28),transparent_7rem),radial-gradient(circle_at_88%_30%,rgba(255,127,0,0.24),transparent_8rem)]" />
      <div className="absolute inset-x-5 bottom-8 h-[48%] rounded-t-2xl border border-white/15 bg-[#181818] shadow-2xl shadow-black/60">
        <div className="absolute inset-x-0 top-0 h-10 rounded-t-2xl bg-[var(--greenway)]/85" />
        <div className="absolute left-4 right-4 top-3 flex items-center justify-between gap-3 text-black">
          <span className="text-sm font-black uppercase tracking-[0.18em]">Greenway</span>
          <span className="rounded-full bg-black px-2 py-1 text-[0.52rem] font-black uppercase tracking-[0.12em] text-[var(--greenway)]">21+</span>
        </div>
        <div className="absolute bottom-0 left-5 h-[54%] w-[28%] rounded-t-lg border border-white/15 bg-black/75" />
        <div className="absolute bottom-5 right-5 grid w-[50%] grid-cols-2 gap-2">
          <div className="h-12 rounded-lg border border-white/10 bg-white/12" />
          <div className="h-12 rounded-lg border border-white/10 bg-white/12" />
        </div>
      </div>
      <div className="absolute left-4 top-4 rounded-full bg-[var(--greenway)] px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.14em] text-black shadow-xl shadow-black/30">
        Port Orchard
      </div>
      <div className="absolute bottom-4 right-4 rounded-full border border-white/15 bg-black/70 px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.14em] text-white backdrop-blur">
        Store preview
      </div>
    </div>
  );
}

export function LocationCard({ location }: LocationCardProps) {
  const hasPhone = location.phoneNumber.length > 0;
  const hasAddress = location.streetAddress.length > 0;
  const hasEmail = location.email.length > 0;

  return (
    <article className="overflow-hidden rounded-[1.4rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/35 md:rounded-[2rem]">
      <StorefrontPreview />

      <div className="p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <StoreStatusBadge status={location.storeStatus} label={location.statusLabel} />
          <span className="rounded-full border border-[var(--greenway)]/35 bg-[var(--greenway-dark)] px-3 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.13em] text-[var(--greenway)]">
            21+ only
          </span>
        </div>

        <div className="mt-4">
          <h2 className="text-3xl font-black leading-none tracking-tight text-white md:text-5xl">{location.name}</h2>
          <p className="mt-2 text-sm font-bold text-zinc-300 md:text-lg">{location.market}</p>
        </div>

        <div className="mt-5 space-y-3 text-sm leading-6 text-zinc-300">
          <p>
            <span className="block text-[0.62rem] font-black uppercase tracking-[0.16em] text-zinc-500">Address</span>
            {hasAddress ? location.streetAddress : location.addressLine}
          </p>
          <p>
            <span className="block text-[0.62rem] font-black uppercase tracking-[0.16em] text-zinc-500">Phone</span>
            {hasPhone ? (
              <a href={`tel:${location.phoneTel}`} className="font-bold text-white transition hover:text-[var(--greenway)]">
                {location.phoneNumber}
              </a>
            ) : (
              location.phoneLine
            )}
          </p>
          <p>
            <span className="block text-[0.62rem] font-black uppercase tracking-[0.16em] text-zinc-500">Email</span>
            {hasEmail ? (
              <a href={location.emailHref} className="font-bold text-white transition hover:text-[var(--greenway)]">
                {location.email}
              </a>
            ) : null}
          </p>
          <p>
            <span className="block text-[0.62rem] font-black uppercase tracking-[0.16em] text-zinc-500">Hours</span>
            {location.todayHoursSummary}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <a href={location.directionsUrl} target="_blank" rel="noreferrer" className="rounded-full bg-[var(--orange)] px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-black transition hover:bg-white">
            Directions
          </a>
          <a href={`tel:${location.phoneTel}`} className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-white transition hover:border-[var(--gold)] hover:text-[var(--gold)]">
            Call Store
          </a>
        </div>

        <p className="mt-5 rounded-2xl border border-[var(--orange)]/25 bg-[var(--orange)]/10 p-3 text-xs leading-5 text-zinc-400">
          Preview only: pickup rules, ordering, final prices, discounts, taxes, and availability must be confirmed through approved store systems before production launch.
        </p>
      </div>
    </article>
  );
}
