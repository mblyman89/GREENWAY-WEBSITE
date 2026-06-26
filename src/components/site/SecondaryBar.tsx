import Link from "next/link";
import { greenwayBusiness } from "@/content/business";

export function SecondaryBar() {
  return (
    <div className="border-t border-black/10 bg-[var(--greenway)] text-black">
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,34vw)_minmax(3.5rem,1fr)_auto] items-center gap-[clamp(0.12rem,0.5vw,0.5rem)] px-[clamp(0.18rem,0.75vw,0.8rem)] py-1 md:flex md:max-w-none md:flex-nowrap md:justify-between md:px-5 lg:px-6 xl:px-8">
        <Link
          href="/locations"
          className="inline-flex h-[clamp(1.95rem,8.1vw,2.45rem)] min-w-0 items-center rounded-full bg-black px-[clamp(0.42rem,1.55vw,1.15rem)] text-[var(--greenway)] transition hover:bg-white hover:text-black md:h-10 md:max-w-none"
          aria-label={`View Greenway location details for ${greenwayBusiness.address.full}`}
        >
          <span className="min-w-0 leading-[0.98]">
            <span className="block truncate text-[clamp(0.52rem,2.45vw,0.82rem)] font-black uppercase tracking-[-0.025em] sm:tracking-[0.005em] md:text-[0.82rem] md:tracking-[0.03em] lg:text-[0.88rem]">
              {greenwayBusiness.address.line1}
            </span>
            <span className="block truncate text-[clamp(0.46rem,2.18vw,0.66rem)] font-bold uppercase tracking-[-0.03em] text-current/75 sm:tracking-[-0.01em] md:text-[0.66rem] md:tracking-[0.01em] lg:text-[0.7rem]">
              {greenwayBusiness.address.city}, {greenwayBusiness.address.state} {greenwayBusiness.address.postalCode}
            </span>
          </span>
        </Link>

        {/* Hours: MOBILE = stacked (time on top, MON-SUN below). DESKTOP = one line, bigger. */}
        <div className="min-w-0 text-center md:flex-none md:text-left">
          {/* Mobile stacked */}
          <span className="flex flex-col items-center leading-[0.95] md:hidden">
            <span className="text-[clamp(0.6rem,3vw,0.92rem)] font-black uppercase tracking-[-0.01em] text-black">
              {greenwayBusiness.hours.dailyShort}
            </span>
            <span className="text-[clamp(0.52rem,2.6vw,0.78rem)] font-black uppercase tracking-[0.02em] text-black/80">
              Mon-Sun
            </span>
          </span>
          {/* Desktop one line, bigger to match address/phone */}
          <span className="hidden font-black uppercase tracking-[0.03em] text-black md:inline md:text-[0.82rem] lg:text-[0.88rem]">
            {greenwayBusiness.hours.short}
          </span>
        </div>

        <a
          href={`tel:${greenwayBusiness.phone.tel}`}
          className="inline-flex h-[clamp(1.95rem,8.1vw,2.45rem)] shrink-0 items-center rounded-full bg-black px-[clamp(0.6rem,2.05vw,1.25rem)] text-[clamp(0.92rem,4.2vw,1.22rem)] font-black uppercase tracking-[-0.02em] text-[var(--greenway)] transition hover:bg-white hover:text-black md:h-10 md:text-[1.18rem] md:tracking-[0.03em] lg:text-[1.24rem]"
          aria-label={`Call Greenway at ${greenwayBusiness.phone.numeric}`}
        >
          {greenwayBusiness.phone.display}
        </a>
      </div>
    </div>
  );
}
