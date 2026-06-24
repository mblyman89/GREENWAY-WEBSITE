import Link from "next/link";
import { greenwayBusiness } from "@/content/business";

export function SecondaryBar() {
  return (
    <div className="border-t border-black/10 bg-[var(--greenway)] text-black">
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,31vw)_minmax(6.15rem,1fr)_auto] items-center gap-[clamp(0.1rem,0.45vw,0.42rem)] px-[clamp(0.12rem,0.55vw,0.68rem)] py-1 md:flex md:max-w-none md:flex-nowrap md:justify-between md:px-5 lg:px-6 xl:px-8">
        <Link
          href="/locations"
          className="inline-flex h-[clamp(1.85rem,7.65vw,2.32rem)] min-w-0 items-center rounded-full bg-black px-[clamp(0.34rem,1.2vw,1rem)] text-[var(--greenway)] transition hover:bg-white hover:text-black md:h-9 md:max-w-none"
          aria-label={`View Greenway location details for ${greenwayBusiness.address.full}`}
        >
          <span className="min-w-0 leading-[0.98]">
            <span className="block truncate text-[clamp(0.5rem,2.28vw,0.78rem)] font-black uppercase tracking-[-0.025em] sm:tracking-[0.005em] md:text-[0.82rem] md:tracking-[0.03em] lg:text-[0.88rem]">
              {greenwayBusiness.address.line1}
            </span>
            <span className="block truncate text-[clamp(0.42rem,1.95vw,0.61rem)] font-bold uppercase tracking-[-0.03em] text-current/75 sm:tracking-[-0.01em] md:text-[0.66rem] md:tracking-[0.01em] lg:text-[0.7rem]">
              {greenwayBusiness.address.city}, {greenwayBusiness.address.state} {greenwayBusiness.address.postalCode}
            </span>
          </span>
        </Link>

        <div className="min-w-0 truncate text-center text-[clamp(0.5rem,2.28vw,0.78rem)] font-black uppercase leading-none tracking-[-0.025em] text-black/85 md:flex-none md:text-left md:text-[0.82rem] md:tracking-[0.03em] lg:text-[0.88rem]">
          {greenwayBusiness.hours.short}
        </div>

        <a
          href={`tel:${greenwayBusiness.phone.tel}`}
          className="inline-flex h-[clamp(1.85rem,7.65vw,2.32rem)] shrink-0 items-center rounded-full bg-black px-[clamp(0.6rem,2.05vw,1.25rem)] text-[clamp(0.57rem,2.45vw,0.94rem)] font-black uppercase tracking-[-0.025em] text-[var(--greenway)] transition hover:bg-white hover:text-black md:h-9 md:text-[1rem] md:tracking-[0.035em]"
          aria-label={`Call Greenway at ${greenwayBusiness.phone.display}`}
        >
          {greenwayBusiness.phone.display}
        </a>
      </div>
    </div>
  );
}
