import Link from "next/link";
import { greenwayBusiness } from "@/content/business";

export function SecondaryBar() {
  return (
    <div className="border-t border-black/10 bg-[var(--greenway)] text-black">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-1.5 px-2 py-1 sm:gap-3 md:max-w-none md:px-5 lg:px-6 xl:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-3">
          <Link
            href="/locations"
            className="inline-flex h-8 min-w-0 shrink items-center rounded-full bg-black px-2.5 text-[var(--greenway)] transition hover:bg-white hover:text-black sm:h-9 sm:px-4 md:h-9"
            aria-label={`View Greenway location details for ${greenwayBusiness.address.full}`}
          >
            <span className="min-w-0 max-w-[8.4rem] leading-[0.9] sm:max-w-none">
              <span className="block truncate text-[0.66rem] font-black uppercase tracking-[0.005em] sm:text-[0.76rem] md:text-[0.82rem] md:tracking-[0.03em] lg:text-[0.88rem]">
                {greenwayBusiness.address.line1}
              </span>
              <span className="block truncate text-[0.51rem] font-bold uppercase tracking-[-0.005em] text-current/75 sm:text-[0.62rem] md:text-[0.66rem] md:tracking-[0.01em] lg:text-[0.7rem]">
                {greenwayBusiness.address.city}, {greenwayBusiness.address.state} {greenwayBusiness.address.postalCode}
              </span>
            </span>
          </Link>

          <div className="min-w-0 flex-1 px-0.5 text-center text-[0.53rem] font-black uppercase leading-tight tracking-[0.06em] text-black/80 sm:px-0 sm:text-[0.62rem] sm:tracking-[0.1em] md:flex-none md:text-left md:text-[0.7rem] lg:text-[0.76rem]">
            <span className="truncate">{greenwayBusiness.hours.short}</span>
          </div>
        </div>

        <a
          href={`tel:${greenwayBusiness.phone.tel}`}
          className="inline-flex h-8 shrink-0 items-center rounded-full bg-black px-3 text-[0.78rem] font-black uppercase tracking-[0.005em] text-[var(--greenway)] transition hover:bg-white hover:text-black sm:h-9 sm:px-4 sm:text-[0.92rem] md:h-9 md:px-5 md:text-[1rem] md:tracking-[0.035em]"
          aria-label={`Call Greenway at ${greenwayBusiness.phone.display}`}
        >
          {greenwayBusiness.phone.display}
        </a>
      </div>
    </div>
  );
}
