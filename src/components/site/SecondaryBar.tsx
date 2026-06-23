import Link from "next/link";
import { greenwayBusiness } from "@/content/business";

export function SecondaryBar() {
  return (
    <div className="border-t border-black/10 bg-[var(--greenway)] text-black">
      <div className="mx-auto flex max-w-7xl flex-nowrap items-center justify-between gap-[clamp(0.2rem,1vw,0.75rem)] px-[clamp(0.35rem,1.7vw,1rem)] py-1 md:max-w-none md:px-5 lg:px-6 xl:px-8">
        <Link
          href="/locations"
          className="inline-flex h-[clamp(1.55rem,7.2vw,2.25rem)] min-w-0 max-w-[48vw] shrink items-center rounded-full bg-black px-[clamp(0.45rem,1.8vw,1rem)] text-[var(--greenway)] transition hover:bg-white hover:text-black sm:max-w-[55vw] md:h-9 md:max-w-none"
          aria-label={`View Greenway location details for ${greenwayBusiness.address.full}`}
        >
          <span className="min-w-0 leading-[0.86]">
            <span className="block truncate text-[clamp(0.48rem,2.45vw,0.76rem)] font-black uppercase tracking-[-0.015em] sm:tracking-[0.005em] md:text-[0.82rem] md:tracking-[0.03em] lg:text-[0.88rem]">
              {greenwayBusiness.address.line1}
            </span>
            <span className="block truncate text-[clamp(0.38rem,1.95vw,0.62rem)] font-bold uppercase tracking-[-0.025em] text-current/75 md:text-[0.66rem] md:tracking-[0.01em] lg:text-[0.7rem]">
              {greenwayBusiness.address.city}, {greenwayBusiness.address.state} {greenwayBusiness.address.postalCode}
            </span>
          </span>
        </Link>

        <div className="min-w-0 flex-1 truncate text-center text-[clamp(0.42rem,2.1vw,0.62rem)] font-black uppercase leading-none tracking-[clamp(0.005em,0.75vw,0.1em)] text-black/80 md:flex-none md:text-left md:text-[0.7rem] lg:text-[0.76rem]">
          {greenwayBusiness.hours.short}
        </div>

        <a
          href={`tel:${greenwayBusiness.phone.tel}`}
          className="inline-flex h-[clamp(1.55rem,7.2vw,2.25rem)] shrink-0 items-center rounded-full bg-black px-[clamp(0.55rem,2vw,1.25rem)] text-[clamp(0.52rem,2.55vw,0.92rem)] font-black uppercase tracking-[-0.015em] text-[var(--greenway)] transition hover:bg-white hover:text-black md:h-9 md:text-[1rem] md:tracking-[0.035em]"
          aria-label={`Call Greenway at ${greenwayBusiness.phone.display}`}
        >
          {greenwayBusiness.phone.display}
        </a>
      </div>
    </div>
  );
}
