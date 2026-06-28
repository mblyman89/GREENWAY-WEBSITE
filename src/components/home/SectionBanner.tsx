import Image from "next/image";

/**
 * SectionBanner — wide, short hero-style band used as a section header on the
 * home + specials pages (mirrors the reference "Shop by CATEGORY" / "BRAND
 * SALES" bars). Dark gradient on the left for the title, graphic art on the
 * right. Desktop uses the wide max-w-[88rem] container like the shop page.
 *
 * EDITABLE SUPPORT
 * ----------------
 * When `editable` is true (admin live-preview Draft Mode) and a `blockKeyPrefix`
 * is supplied (e.g. "home.category"), each editable region gets the
 * data-gw-block / data-gw-editable attributes so the Site Content editor's
 * "click ✎ Edit → jump to field" overlay can target it. The wrapper expects the
 * matching seed blocks: `<prefix>.image`, `<prefix>.eyebrow`, `<prefix>.title`,
 * `<prefix>.subtitle`.
 */
export function SectionBanner({
  imageSrc,
  imageAlt,
  eyebrow,
  title,
  titleClassName = "text-white",
  subtitle,
  priority = false,
  editable = false,
  blockKeyPrefix,
}: {
  imageSrc: string;
  imageAlt: string;
  eyebrow?: string;
  title: string;
  titleClassName?: string;
  subtitle?: string;
  priority?: boolean;
  editable?: boolean;
  blockKeyPrefix?: string;
}) {
  const editAttrs = (suffix: string) =>
    editable && blockKeyPrefix
      ? {
          "data-gw-block": `${blockKeyPrefix}.${suffix}`,
          "data-gw-editable": "true" as const,
        }
      : {};

  return (
    <div className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] shadow-xl shadow-black/30">
      <div className="absolute inset-0" {...editAttrs("image")}>
        <Image
          src={imageSrc}
          alt={imageAlt}
          fill
          priority={priority}
          sizes="(max-width: 768px) 100vw, 1408px"
          className="object-cover object-right"
        />
      </div>
      {/* Left-weighted dark gradient so the title stays legible over the art. */}
      <div
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.82)_40%,rgba(0,0,0,0.32)_72%,rgba(0,0,0,0.08)_100%)]"
        aria-hidden="true"
      />
      <div className="relative flex min-h-[5.5rem] flex-col justify-center px-5 py-4 md:min-h-[7.5rem] md:px-9 md:py-6">
        {eyebrow ? (
          <p
            className="text-[0.6rem] font-black uppercase tracking-[0.22em] text-[var(--greenway)] md:text-xs"
            {...editAttrs("eyebrow")}
          >
            {eyebrow}
          </p>
        ) : null}
        <h2
          className={`mt-1 text-2xl font-black uppercase leading-none tracking-tight md:text-4xl lg:text-5xl ${titleClassName}`}
          {...editAttrs("title")}
        >
          {title}
        </h2>
        {subtitle ? (
          <p
            className="mt-1.5 max-w-md text-[0.72rem] font-semibold leading-5 text-zinc-300 md:mt-2 md:max-w-xl md:text-sm"
            {...editAttrs("subtitle")}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}
