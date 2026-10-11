import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import {
  boxStyle,
  buttonStyle,
  containerStyle,
  frameStyle,
  imageStyle,
  overlayStyle,
  resolveBoxText,
  roleInfo,
  type BannerDesign,
  type DesignTextBox,
} from "@/lib/cms/banner-design-core";
import { linkKindOf } from "@/lib/cms/link-target-core";

/**
 * R41 S2 — renders a banner from its custom design (bible PART 5.3).
 *
 * No "use client": works from server pages AND inside client components (the
 * home brand banner lives in a client component). All layout comes from the
 * pure style helpers in banner-design-core; the only CSS outside inline styles
 * is the small `R41 S2: designed banners` block in globals.css (phone overrides
 * and hide-on-phone, which inline styles can't express).
 *
 * Only rendered when `design.enabled` — SectionBanner keeps its classic path
 * for every banner without a custom design (byte-identical).
 */
export type DesignedBannerProps = {
  design: BannerDesign;
  imageSrc: string;
  imageAlt: string;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  /** 1 only for a page's top hero; everything else is h2. */
  headingLevel?: 1 | 2;
  priority?: boolean;
  /** Draft Mode preview: adds inert data-* hooks used by the hub Move mode (S7). */
  editable?: boolean;
  /** e.g. "section:<uuid>" | "specials:hero" — identifies whose design this is. */
  owner?: string;
  /** Legacy editor overlay prefix (e.g. "home.category") for bound boxes. */
  blockKeyPrefix?: string;
};

const css = (s: Record<string, string>) => s as unknown as CSSProperties;

export function DesignedBanner({
  design,
  imageSrc,
  imageAlt,
  legacy,
  headingLevel = 2,
  priority = false,
  editable = false,
  owner,
  blockKeyPrefix,
}: DesignedBannerProps) {
  // R42 Q4: optional separate phone picture (unset = one picture, as before).
  const phoneSrc = design.image.srcMobile && design.image.srcMobile !== imageSrc ? design.image.srcMobile : "";
  const headline = design.boxes.find((b) => b.role === "headline" && !b.hidden);
  const overlay = overlayStyle(
    design,
    headline ? { x: headline.x + headline.w / 2, y: headline.y + 10 } : undefined,
  );
  let usedH1 = false;
  const boxEl = (b: DesignTextBox) => {
    const info = roleInfo(b.role);
    if (info.html === "h2") {
      if (headingLevel === 1 && !usedH1) {
        usedH1 = true;
        return "h1" as const;
      }
      return "h2" as const;
    }
    return info.html;
  };
  const bindSuffix = (b: DesignTextBox) =>
    b.bind === "title" ? "title" : b.bind === "eyebrow" ? "eyebrow" : b.bind === "subtitle" ? "subtitle" : null;

  return (
    <div style={css(containerStyle())} className="gw-dcontainer">
      <div
        style={css(frameStyle(design))}
        className="gw-dframe border border-white/10 bg-[var(--charcoal)] shadow-xl shadow-black/30"
        {...(editable && owner ? { "data-gw-design-frame": "true", "data-gw-design-owner": owner } : {})}
      >
        {phoneSrc ? (
          <>
            {/* R42 Q4: separate phone picture. The container rule in globals.css
                shows exactly one of these (banner < 768px wide = phone). Both are
                lazy: browsers skip display:none lazy images, so each device
                downloads only the picture it shows. */}
            {imageSrc ? (
              <div className="gw-dimg-d absolute inset-0 overflow-hidden" aria-hidden={imageAlt ? undefined : true}>
                <Image
                  src={imageSrc}
                  alt={imageAlt}
                  fill
                  loading="lazy"
                  fetchPriority={priority ? "high" : undefined}
                  sizes="1408px"
                  className="gw-dimg"
                  style={css(imageStyle(design))}
                />
              </div>
            ) : null}
            <div className="gw-dimg-m absolute inset-0 overflow-hidden" aria-hidden={imageAlt ? undefined : true}>
              <Image
                src={phoneSrc}
                alt={imageAlt}
                fill
                loading="lazy"
                fetchPriority={priority ? "high" : undefined}
                sizes="100vw"
                className="gw-dimg"
                style={css(imageStyle(design))}
              />
            </div>
          </>
        ) : imageSrc ? (
          <div className="absolute inset-0 overflow-hidden" aria-hidden={imageAlt ? undefined : true}>
            <Image
              src={imageSrc}
              alt={imageAlt}
              fill
              priority={priority}
              sizes="(max-width: 768px) 100vw, 1408px"
              className="gw-dimg"
              style={css(imageStyle(design))}
            />
          </div>
        ) : null}
        {overlay ? <div style={css(overlay)} aria-hidden="true" /> : null}
        {design.boxes.map((b) => {
          if (b.hidden) return null;
          const text = resolveBoxText(b, legacy);
          if (!text.trim()) return null;
          const Tag = boxEl(b);
          const suffix = bindSuffix(b);
          return (
            <Tag
              key={b.id}
              style={css(boxStyle(b))}
              className={`gw-dbox${b.hideOnMobile ? " gw-hide-sm" : ""}`}
              {...(editable ? { "data-gw-design-box": b.id } : {})}
              {...(editable && blockKeyPrefix && suffix
                ? { "data-gw-block": `${blockKeyPrefix}.${suffix}`, "data-gw-editable": "true" }
                : {})}
            >
              {text}
            </Tag>
          );
        })}
        {design.buttons.map((btn) => {
          if (!btn.enabled || !btn.label.trim() || !btn.href.trim()) return null;
          const style = css(buttonStyle(btn));
          const className = `gw-dbox gw-dbtn${btn.hideOnMobile ? " gw-hide-sm" : ""}`;
          const hooks = editable ? { "data-gw-design-button": btn.id } : {};
          const external = linkKindOf(btn.href) === "external" || linkKindOf(btn.href) === "contact";
          if (external || btn.newTab) {
            return (
              <a
                key={btn.id}
                href={btn.href}
                style={style}
                className={className}
                {...(btn.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                {...hooks}
              >
                {btn.label}
              </a>
            );
          }
          return (
            <Link key={btn.id} href={btn.href} style={style} className={className} {...hooks}>
              {btn.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
