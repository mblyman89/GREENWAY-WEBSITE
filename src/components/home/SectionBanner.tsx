import Image from "next/image";

/**
 * SectionBanner — wide, short hero-style band used as a section header on the
 * home + specials pages (mirrors the reference "Shop by CATEGORY" / "BRAND
 * SALES" bars). Dark gradient on the left for the title, graphic art on the
 * right. Desktop uses the wide max-w-[88rem] container like the shop page.
 */
export function SectionBanner({
  imageSrc,
  imageAlt,
  eyebrow,
  title,
  subtitle,
  priority = false,
}: {
  imageSrc: string;
  imageAlt: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  priority?: boolean;
}) {
  return (
    <div className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] shadow-xl shadow-black/30">
      <Image
        src={imageSrc}
        alt={imageAlt}
        fill
        priority={priority}
        sizes="(max-width: 768px) 100vw, 1408px"
        className="object-cover object-right"
      />
      {/* Left-weighted dark gradient so the title stays legible over the art. */}
      <div
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.82)_40%,rgba(0,0,0,0.32)_72%,rgba(0,0,0,0.08)_100%)]"
        aria-hidden="true"
      />
      <div className="relative flex min-h-[5.5rem] flex-col justify-center px-5 py-4 md:min-h-[7.5rem] md:px-9 md:py-6">
        {eyebrow ? (
          <p className="text-[0.6rem] font-black uppercase tracking-[0.22em] text-[var(--greenway)] md:text-xs">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-1 text-2xl font-black uppercase leading-none tracking-tight text-white md:text-4xl lg:text-5xl">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1.5 max-w-md text-[0.72rem] font-semibold leading-5 text-zinc-300 md:mt-2 md:max-w-xl md:text-sm">
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}
