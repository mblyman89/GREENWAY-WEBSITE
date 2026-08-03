import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { greenwayBusiness } from "@/content/business";
import { SiteText } from "@/components/site/SiteText";
import { getContentForRender, getContentValues } from "@/lib/cms/render-content";

const mapEmbedUrl = `https://www.google.com/maps?q=${encodeURIComponent(greenwayBusiness.address.mapQuery)}&output=embed`;

// A conservative email check: if the editable value looks like an address we
// build a mailto: from it; otherwise we fall back to the shared business
// mailto so the link stays valid no matter what staff type.
function mailtoFor(email: string): string {
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
    ? `mailto:${trimmed}`
    : greenwayBusiness.emailHref;
}

function MapPinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current">
      <path d="M12 2.25a7.25 7.25 0 0 0-7.25 7.25c0 5.44 6.43 11.76 6.71 12.03a.78.78 0 0 0 1.08 0c.28-.27 6.71-6.59 6.71-12.03A7.25 7.25 0 0 0 12 2.25Zm0 10.05a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current">
      <path d="M12 2.25a9.75 9.75 0 1 0 0 19.5 9.75 9.75 0 0 0 0-19.5Zm.8 10.06 3.06 1.82a.9.9 0 0 1-.92 1.55l-3.5-2.08a.9.9 0 0 1-.44-.77V7.5a.9.9 0 1 1 1.8 0v4.81Z" />
    </svg>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-white/10 py-5 last:border-b-0">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--orange)]">{label}</p>
      <div className="mt-2 text-base font-semibold leading-7 text-zinc-100">{children}</div>
    </div>
  );
}

export async function LocationsContent() {
  // Editable from Admin → Site Content (locations.*). Every field falls back to
  // the byte-identical shipped copy so the live look never changes until staff
  // edit + publish. The actionable links (directions, tel:, mailto:, /menu) stay
  // derived from the shared business record, so editing a display label never
  // breaks a link or changes the real dialed number. The map iframe is not
  // editable.
  const heroImage =
    (await getContentForRender("locations.hero.image"))?.trim() ||
    greenwayBusiness.assets.storefront;

  // Batch the detail-row values in one round-trip. address/phone/hours are shown
  // verbatim; email is shown verbatim and also drives a validated mailto:.
  const details = await getContentValues([
    "locations.details.address",
    "locations.details.phone",
    "locations.details.hours",
    "locations.details.email",
  ]);
  const addressText = details["locations.details.address"] || greenwayBusiness.address.full;
  const phoneText = details["locations.details.phone"] || greenwayBusiness.phone.display;
  const hoursText = details["locations.details.hours"] || greenwayBusiness.hours.display;
  const emailText = details["locations.details.email"] || greenwayBusiness.email;
  const emailHref = mailtoFor(emailText);

  return (
    <section className="overflow-hidden bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 pt-8 md:px-8 md:pt-12 lg:px-10">
        <div className="relative min-h-[19rem] overflow-hidden rounded-[1.35rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40 md:min-h-[27rem] md:rounded-[2rem] lg:min-h-[31rem]">
          <Image
            src={heroImage}
            alt="Front of Greenway Marijuana storefront on Geiger Road"
            fill
            priority
            sizes="(min-width: 1280px) 1216px, (min-width: 768px) calc(100vw - 4rem), calc(100vw - 2rem)"
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_88%,rgba(126,217,87,0.22),transparent_19rem),radial-gradient(circle_at_82%_18%,rgba(255,127,0,0.14),transparent_20rem)]" />

          <div className="relative flex min-h-[19rem] items-end p-5 md:min-h-[27rem] md:p-8 lg:min-h-[31rem] lg:p-10">
            <div className="max-w-5xl">
              <SiteText
                blockKey="locations.hero.title"
                as="h1"
                className="text-5xl font-black uppercase leading-[0.88] tracking-tight text-white drop-shadow-2xl md:text-7xl lg:text-8xl"
              />
              <div className="mt-4 flex flex-col gap-2 text-sm font-black tracking-[0.08em] text-zinc-100 drop-shadow-lg sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 md:text-base">
                <span className="inline-flex items-center gap-2 text-[var(--greenway)]">
                  <MapPinIcon />
                  <SiteText blockKey="locations.hero.city" as="span" />
                </span>
                <span className="inline-flex items-center gap-2 text-[var(--orange)]">
                  <ClockIcon />
                  <SiteText blockKey="locations.hero.hoursPill" as="span" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 md:px-8 md:py-14 lg:px-10 lg:py-16">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-7 xl:grid-cols-[minmax(0,1fr)_27rem]">
          <article className="rounded-[1.35rem] border border-white/10 bg-zinc-950/92 p-5 shadow-2xl shadow-black/35 md:rounded-[2rem] md:p-8 lg:p-10">
            <SiteText
              blockKey="locations.about.heading"
              as="h2"
              className="text-center text-3xl font-black uppercase leading-tight tracking-tight text-[var(--orange)] md:text-5xl"
            />
            <SiteText
              blockKey="locations.about.body"
              as="p"
              className="mt-6 text-base font-medium leading-8 text-zinc-300 md:mt-8 md:text-lg md:leading-9"
            />
            <div className="mt-8 flex justify-start">
              <Link
                href="/menu"
                className="inline-flex min-h-14 items-center justify-center rounded-full bg-[var(--orange)] px-8 text-sm font-black uppercase tracking-[0.16em] text-black shadow-lg shadow-[var(--orange)]/20 transition hover:-translate-y-0.5 hover:bg-[var(--greenway)]"
              >
                <SiteText blockKey="locations.about.cta" as="span" />
              </Link>
            </div>
          </article>

          <aside className="rounded-[1.35rem] border border-white/10 bg-zinc-950/92 p-5 shadow-2xl shadow-black/35 md:rounded-[2rem] md:p-7 lg:p-8">
            <SiteText
              blockKey="locations.details.heading"
              as="h2"
              className="text-3xl font-black uppercase tracking-tight text-[var(--orange)] md:text-4xl"
            />
            <div className="mt-4 h-px w-full bg-[var(--greenway)]/65" />

            <div className="mt-2">
              <DetailRow label="Address">
                <a
                  href={greenwayBusiness.address.directionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="transition hover:text-[var(--greenway)]"
                >
                  {addressText}
                </a>
              </DetailRow>
              <DetailRow label="Phone">
                <a href={`tel:${greenwayBusiness.phone.tel}`} className="transition hover:text-[var(--greenway)]">
                  {phoneText}
                </a>
              </DetailRow>
              <DetailRow label="Hours">{hoursText}</DetailRow>
              <DetailRow label="Email">
                <a href={emailHref} className="break-words transition hover:text-[var(--greenway)]">
                  {emailText}
                </a>
              </DetailRow>
            </div>
          </aside>
        </div>

        <section aria-labelledby="location-map-title" className="mt-6 max-w-[calc(100%-0rem)] lg:mt-8 lg:max-w-[calc(100%-25.75rem)] xl:max-w-[calc(100%-29rem)]">
          <div className="overflow-hidden rounded-[1.35rem] border border-white/10 bg-zinc-950/92 shadow-2xl shadow-black/35 md:rounded-[2rem]">
            <div className="flex flex-col gap-4 border-b border-white/10 p-5 md:flex-row md:items-center md:justify-between md:p-7">
              <div>
                <SiteText
                  blockKey="locations.map.eyebrow"
                  as="p"
                  className="text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]"
                />
                <SiteText
                  blockKey="locations.map.heading"
                  as="h2"
                  id="location-map-title"
                  className="mt-1 text-3xl font-black uppercase tracking-tight text-white md:text-4xl"
                />
              </div>
              <a
                href={greenwayBusiness.address.directionsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--greenway)] px-6 text-xs font-black uppercase tracking-[0.16em] text-black transition hover:bg-[var(--orange)]"
              >
                <SiteText blockKey="locations.map.cta" as="span" />
              </a>
            </div>
            <iframe
              title="Google map for Greenway Marijuana in Port Orchard"
              src={mapEmbedUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-[22rem] w-full border-0 md:h-[30rem] lg:h-[34rem]"
            />
          </div>
        </section>
      </div>
    </section>
  );
}
