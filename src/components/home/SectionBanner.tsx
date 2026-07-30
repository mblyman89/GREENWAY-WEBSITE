import Image from "next/image";
import Link from "next/link";

/** A call-to-action button rendered inside a SectionBanner. */
export type SectionBannerButton = {
  label: string;
  href: string;
  variant?: "solid" | "outline" | "ghost";
  enabled?: boolean;
};

/**
 * Resolved data for one page-section banner, passed from a server page down to
 * client components so they can render builder-managed banners (image, copy,
 * CTAs) with a static fallback. Shape mirrors RenderSection's relevant fields.
 */
export type SectionBannerData = {
  key: string;
  image: string;
  imageAlt: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  buttons: SectionBannerButton[];
};

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
 *
 * CALL-TO-ACTION BUTTONS
 * ----------------------
 * Pass `buttons` (from the page-section builder) to render up to a few CTAs
 * below the subtitle. Only `enabled !== false` buttons with a label + href show.
 * When no buttons are supplied the banner renders exactly as before.
 */
export function SectionBanner({
  imageSrc,
  imageAlt,
  eyebrow,
  title,
  titleClassName = "text-white",
  subtitle,
  buttons,
  priority = false,
  editable = false,
  blockKeyPrefix,
  textAlign = "left",
  verticalAlign = "center",
  imageFocus,
}: {
  imageSrc: string;
  imageAlt: string;
  eyebrow?: string;
  title: string;
  titleClassName?: string;
  subtitle?: string;
  buttons?: SectionBannerButton[];
  priority?: boolean;
  editable?: boolean;
  blockKeyPrefix?: string;
  /** Horizontal placement of the overlaid text (default "left" = today's look). */
  textAlign?: "left" | "center" | "right";
  /** Vertical placement of the overlaid text (default "center" = today's look). */
  verticalAlign?: "top" | "center" | "bottom";
  /**
   * SLICE 117 (bug fix): where the IMAGE sits, INDEPENDENT of the text.
   * Historically the image's object-position was hard-wired to `textAlign`
   * (text left → image shoved right, etc.), so moving the text moved the image.
   * Now the image has its own control. When `imageFocus` is omitted we keep the
   * old text-derived behavior EXACTLY, so every existing caller is unchanged;
   * callers that pass `imageFocus` (e.g. the Specials Today's-Deal banner) get
   * a stable image that no longer jumps when the text is re-aligned.
   */
  imageFocus?: "center" | "top" | "bottom" | "left" | "right";
}) {
  const visibleButtons = (buttons ?? []).filter(
    (b) => b.enabled !== false && b.label?.trim() && b.href?.trim(),
  );

  // Overlay gradient is weighted toward the SAME side the text sits on so the
  // copy stays legible; a center placement uses a soft all-over darken. The
  // image itself is object-positioned to the OPPOSITE side so the art shows.
  const gradientClass =
    textAlign === "right"
      ? "bg-[linear-gradient(270deg,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.82)_40%,rgba(0,0,0,0.32)_72%,rgba(0,0,0,0.08)_100%)]"
      : textAlign === "center"
        ? "bg-[linear-gradient(180deg,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.72)_50%,rgba(0,0,0,0.55)_100%)]"
        : "bg-[linear-gradient(90deg,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.82)_40%,rgba(0,0,0,0.32)_72%,rgba(0,0,0,0.08)_100%)]";
  // Image position. If a caller supplies an explicit `imageFocus`, it wins and
  // is fully INDEPENDENT of the text alignment (the bug fix). Otherwise we keep
  // the exact legacy behavior (image shifts to the side opposite the text) so
  // every caller that hasn't opted in renders byte-identically to before.
  const focusObjectClass: Record<NonNullable<typeof imageFocus>, string> = {
    center: "object-center",
    top: "object-top",
    bottom: "object-bottom",
    left: "object-left",
    right: "object-right",
  };
  const legacyObjectClass =
    textAlign === "right"
      ? "object-left"
      : textAlign === "center"
        ? "object-center"
        : "object-right";
  const imageObjectClass = `object-cover ${
    imageFocus ? focusObjectClass[imageFocus] : legacyObjectClass
  }`;
  const textBlockClass = [
    textAlign === "right" ? "items-end text-right" : textAlign === "center" ? "items-center text-center" : "items-start text-left",
    verticalAlign === "top" ? "justify-start" : verticalAlign === "bottom" ? "justify-end" : "justify-center",
  ].join(" ");
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
          className={imageObjectClass}
        />
      </div>
      {/* Dark gradient weighted toward the text side so the title stays legible. */}
      <div
        className={`absolute inset-0 ${gradientClass}`}
        aria-hidden="true"
      />
      <div className={`relative flex min-h-[5.5rem] flex-col px-5 py-4 md:min-h-[7.5rem] md:px-9 md:py-6 ${textBlockClass}`}>
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
        {visibleButtons.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 md:mt-4 md:gap-3">
            {visibleButtons.map((b, i) => {
              const variant = b.variant ?? "solid";
              const base =
                "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full px-4 text-[0.68rem] font-black uppercase tracking-[0.12em] transition md:h-10 md:px-5 md:text-xs";
              const styles =
                variant === "solid"
                  ? "bg-[var(--greenway)] text-black hover:bg-[#6bc746]"
                  : variant === "outline"
                    ? "border border-white/30 text-white hover:border-[var(--orange)] hover:text-[var(--orange)]"
                    : "text-[var(--greenway)] underline-offset-4 hover:underline";
              return (
                <Link key={`${b.href}-${i}`} href={b.href} className={`${base} ${styles}`}>
                  {b.label}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
