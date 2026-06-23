import Link from "next/link";
import { greenwayBusiness } from "@/content/business";

export function SecondaryBar() {
  return (
    <div className="border-t border-black/10 bg-[var(--greenway)] text-black">
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1.55fr)_minmax(3.15rem,0.52fr)_auto] items-center gap-[clamp(0.18rem,0.75vw,0.65rem)] px-[clamp(0.22rem,1.05vw,0.8rem)] py-1 md:flex md:max-w-none md:flex-nowrap md:justify-between md:px-5 lg:px-6 xl:px-8">
        <Link
          href="/locations"
          className="inline-flex h-[clamp(1.85rem,7.65vw,2.32rem)] min-w-0 items-center rounded-full bg-black px-[clamp(0.58rem,2.25vw,1.15rem)] text-[var(--greenway)] transition hover:bg-white hover:text-black md:h-9 md:max-w-none"
          aria-label={`View Greenway location details for ${greenwayBusiness.address.full}`}
        >
          <span className="min-w-0 leading-[0.98]">
            <span className="block truncate text-[clamp(0.57rem,2.75vw,0.82rem)] font-black uppercase tracking-[-0.025em] sm:tracking-[0.005em] md:text-[0.82rem] md:tracking-[0.03em] lg:text-[0.88rem]">
              {greenwayBusiness.address.line1}
            </span>
            <span className="block truncate text-[clamp(0.46rem,2.18vw,0.66rem)] font-bold uppercase tracking-[-0.03em] text-current/75 sm:tracking-[-0.01em] md:text-[0.66rem] md:tracking-[0.01em] lg:text-[0.7rem]">
              {greenwayBusiness.address.city}, {greenwayBusiness.address.state} {greenwayBusiness.address.postalCode}
            </span>
          </span>
        </Link>

        <div className="min-w-0 truncate text-center text-[clamp(0.39rem,1.75vw,0.62rem)] font-black uppercase leading-none tracking-[clamp(-0.015em,0.45vw,0.08em)] text-black/80 md:flex-none md:text-left md:text-[0.7rem] lg:text-[0.76rem]">
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
