import Link from "next/link";
import type { CSSProperties } from "react";
import type { BannerDesign } from "@/lib/cms/banner-design-core";
import { DesignedBanner } from "./DesignedBanner";

/**
 * R61-S3 — ONE public renderer for every custom-designed CARD (home Type cards,
 * Specials weekday cards). The look comes from the shared <DesignedBanner>
 * (card frame), so improving the banner engine improves every card too.
 *
 * Links: a design WITHOUT buttons makes the whole card one link (a stretched
 * <Link> over the card, named by `label`). A design WITH buttons lets its
 * buttons be the links — never a link inside a link (invalid HTML, WCAG 4.1.1).
 */
export function hasDesignButtons(design: BannerDesign): boolean {
  return design.buttons.some((b) => b.enabled && b.label.trim() !== "" && b.href.trim() !== "");
}

export function DesignedCard({
  design,
  imageSrc,
  imageAlt = "",
  legacy,
  href,
  newTab = false,
  label,
  frameClassName,
  frameExtraStyle,
  className = "",
}: {
  design: BannerDesign;
  imageSrc: string;
  imageAlt?: string;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  /** Whole-card link (used only when the design has no buttons). */
  href?: string;
  newTab?: boolean;
  /** Accessible name of the whole-card link. */
  label: string;
  frameClassName?: string;
  frameExtraStyle?: CSSProperties;
  className?: string;
}) {
  const stretch = !!href && !hasDesignButtons(design);
  return (
    <div className={`group relative ${className}`.trim()}>
      <DesignedBanner
        design={design}
        imageSrc={imageSrc}
        imageAlt={imageAlt}
        legacy={legacy}
        frameClassName={frameClassName}
        frameExtraStyle={frameExtraStyle}
      />
      {stretch ? (
        <Link
          href={href}
          aria-label={label}
          className="absolute inset-0 z-[60] rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--greenway)]"
          {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        />
      ) : null}
    </div>
  );
}
