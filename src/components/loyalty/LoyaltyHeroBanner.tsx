import Image from "next/image";
import {
  type LoyaltyHeroPresentation,
  heroFontStack,
  heroColorHex,
  isScriptHeroFont,
  heroTextLines,
} from "@/lib/loyalty/loyalty-hero-core";

/**
 * LoyaltyHeroBanner (SLICE 123 / LOY-1) — the /loyalty hero, rebuilt as a fully
 * editable "special" banner. It renders a TEXTLESS background image (desktop +
 * mobile art, each with its own focus) with THREE independently styled overlay
 * text blocks (eyebrow / title / subtitle). Each block has its own font (bold
 * display / clean sans / cursive script), on-brand color, and honors hard line
 * breaks so a headline can be stacked exactly like the old baked artwork.
 *
 * This deliberately replaces the previous baked-in-text loyalty banner (two
 * static PNGs with the words painted on) — an owner-approved live-look change.
 * The signup form, program terms, live numbers, and consent copy are untouched.
 *
 * The gradient/focus/placement logic mirrors SectionBanner so the loyalty hero
 * feels consistent with the other banners, then adds the extra per-block powers.
 * This component is intentionally presentational and pure over its props, so the
 * admin editor can render the EXACT same output for a live preview.
 */
export function LoyaltyHeroBanner({
  presentation,
  priority = false,
  /**
   * When true (admin live-preview Draft Mode) each editable region gets the
   * data-gw-block / data-gw-editable attributes so the editor overlay can jump
   * to the right field. Blocks: loyalty.hero.presentation (whole banner).
   */
  editable = false,
}: {
  presentation: LoyaltyHeroPresentation;
  priority?: boolean;
  editable?: boolean;
}) {
  const {
    image,
    imageMobile,
    imageFocus,
    imageFocusMobile,
    textAlign,
    verticalAlign,
    eyebrow,
    title,
    subtitle,
  } = presentation;

  // Gradient weighted toward the text side so the copy stays legible over art.
  const gradientClass =
    textAlign === "right"
      ? "bg-[linear-gradient(270deg,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.8)_42%,rgba(0,0,0,0.28)_74%,rgba(0,0,0,0.05)_100%)]"
      : textAlign === "center"
        ? "bg-[linear-gradient(180deg,rgba(0,0,0,0.5)_0%,rgba(0,0,0,0.68)_50%,rgba(0,0,0,0.5)_100%)]"
        : "bg-[linear-gradient(90deg,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.8)_42%,rgba(0,0,0,0.28)_74%,rgba(0,0,0,0.05)_100%)]";

  const focusObjectClass: Record<typeof imageFocus, string> = {
    center: "object-center",
    top: "object-top",
    bottom: "object-bottom",
    left: "object-left",
    right: "object-right",
  };

  const textBlockClass = [
    textAlign === "right"
      ? "items-end text-right"
      : textAlign === "center"
        ? "items-center text-center"
        : "items-start text-left",
    verticalAlign === "top"
      ? "justify-start"
      : verticalAlign === "bottom"
        ? "justify-end"
        : "justify-center",
  ].join(" ");

  const editAttrs: Record<string, string> = editable
    ? { "data-gw-block": "loyalty.hero.presentation", "data-gw-editable": "true" }
    : {};

  return (
    <>
      {/* MOBILE banner (own art + focus, ~3:1). */}
      <div className="relative aspect-[3/1] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40 md:hidden">
        <HeroImage
          src={imageMobile}
          focusClass={focusObjectClass[imageFocusMobile]}
          priority={priority}
          sizes="calc(100vw - 2rem)"
        />
        <div className={`absolute inset-0 ${gradientClass}`} aria-hidden="true" />
        <HeroText
          className={textBlockClass}
          eyebrow={eyebrow}
          title={title}
          subtitle={subtitle}
          compact
          editAttrs={editAttrs}
        />
      </div>

      {/* DESKTOP banner (own art + focus, wide). */}
      <div className="relative hidden aspect-[3200/563] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40 md:block">
        <HeroImage
          src={image}
          focusClass={focusObjectClass[imageFocus]}
          priority={priority}
          sizes="(min-width: 1408px) 1408px, calc(100vw - 4rem)"
        />
        <div className={`absolute inset-0 ${gradientClass}`} aria-hidden="true" />
        <HeroText
          className={textBlockClass}
          eyebrow={eyebrow}
          title={title}
          subtitle={subtitle}
          editAttrs={editAttrs}
        />
      </div>
    </>
  );
}

function HeroImage({
  src,
  focusClass,
  priority,
  sizes,
}: {
  src: string;
  focusClass: string;
  priority: boolean;
  sizes: string;
}) {
  // A blank image means "no art" — keep a solid dark panel so text stays legible
  // and the banner never renders a broken <img>.
  if (!src || !src.trim()) {
    return <div className="absolute inset-0 bg-zinc-950" aria-hidden="true" />;
  }
  return (
    <Image
      src={src}
      alt="Greenway Loyalty Points banner"
      fill
      priority={priority}
      sizes={sizes}
      className={`object-cover ${focusClass}`}
    />
  );
}

type Block = LoyaltyHeroPresentation["title"];

function HeroText({
  className,
  eyebrow,
  title,
  subtitle,
  compact = false,
  editAttrs,
}: {
  className: string;
  eyebrow: Block;
  title: Block;
  subtitle: Block;
  compact?: boolean;
  editAttrs: Record<string, string>;
}) {
  return (
    <div
      className={`relative flex h-full flex-col gap-1 px-5 py-4 md:gap-1.5 md:px-10 md:py-6 ${className}`}
      {...editAttrs}
    >
      {eyebrow.show && heroTextLines(eyebrow.text).length ? (
        <BlockLines
          block={eyebrow}
          baseClass={
            compact
              ? "text-[0.62rem] font-black uppercase tracking-[0.2em]"
              : "text-xs font-black uppercase tracking-[0.24em] md:text-sm"
          }
        />
      ) : null}
      {title.show && heroTextLines(title.text).length ? (
        <BlockLines
          block={title}
          baseClass={
            compact
              ? "text-xl font-black uppercase leading-none tracking-tight"
              : "text-3xl font-black uppercase leading-[0.95] tracking-tight md:text-5xl lg:text-6xl"
          }
        />
      ) : null}
      {subtitle.show && heroTextLines(subtitle.text).length ? (
        <BlockLines
          block={subtitle}
          baseClass={
            compact
              ? "text-sm font-semibold leading-tight"
              : "text-lg font-semibold leading-tight md:text-2xl lg:text-3xl"
          }
          allowScriptScale
        />
      ) : null}
    </div>
  );
}

/**
 * Render one text block's lines. Applies the block's font + color, splits on
 * hard line breaks so staff can stack lines, and (for a cursive line) applies
 * the optional bigger "script scale" via an inline font-size multiplier so the
 * flourish reads larger without disturbing the other blocks.
 */
function BlockLines({
  block,
  baseClass,
  allowScriptScale = false,
}: {
  block: Block;
  baseClass: string;
  allowScriptScale?: boolean;
}) {
  const lines = heroTextLines(block.text);
  const isScript = isScriptHeroFont(block.font);
  const style: React.CSSProperties = {
    fontFamily: heroFontStack(block.font),
    color: heroColorHex(block.color),
  };
  // A script line often wants a size bump + relaxed casing so the cursive shows.
  if (allowScriptScale && isScript && block.scriptScale > 1) {
    style.fontSize = `${block.scriptScale}em`;
  }
  // Script fonts read badly in all-caps; drop the uppercase transform for them.
  const scriptClass = isScript ? "normal-case tracking-normal" : "";
  return (
    <p className={`${baseClass} ${scriptClass}`} style={style}>
      {lines.map((line, i) => (
        <span key={i} className="block">
          {line === "" ? "\u00A0" : line}
        </span>
      ))}
    </p>
  );
}
