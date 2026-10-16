import Link from "next/link";
import type { CSSProperties } from "react";
import {
  boxMotionClass,
  boxStyle,
  curvedBoxStyle,
  buttonStyle,
  containerStyle,
  frameStyle,
  imageStyle,
  layerZ,
  overlayStyle,
  resolveBoxText,
  roleInfo,
  type BannerDesign,
  type DesignTextBox,
} from "@/lib/cms/banner-design-core";
import { linkKindOf } from "@/lib/cms/link-target-core";
import { BannerMedia } from "./BannerMedia";
import { BannerPicture } from "./BannerPicture";
import { BannerBeam, ElementVisual } from "./DesignMotion";
import { BannerSmoke } from "./smoke/BannerSmoke";
import { BannerAnim } from "./anim/BannerAnim";
import { animWantsPointer } from "@/lib/cms/banner-anim-core";
import { BannerEntrances } from "./BannerEntrances";
import { entrancePlan } from "@/lib/cms/banner-enter-core";
import { ButtonInner } from "./ButtonInner";
import { CurvedText } from "./CurvedText";
import { LiveBox } from "./LiveText";
import { buttonFxClass } from "@/lib/cms/button-fx-core";
import { elementHoverClass, elementStyle } from "@/lib/cms/banner-elements-core";
import { customFontFaceCss, customFontIdsIn } from "@/lib/cms/custom-font-core";
// R44: a video wrapper must stay visible to assistive tech (its pause button);
// the <video> itself is aria-hidden inside BannerVideo.
import { isVideoSrc } from "@/lib/media/upload-policy-core";

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
  /** R47-S2: click-analytics zone (clickZoneAttrs) for the banner's buttons. */
  zone?: Record<string, string>;
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
  zone,
}: DesignedBannerProps) {
  // R42 Q4: optional separate phone picture (unset = one picture, as before).
  const phoneSrc = design.image.srcMobile && design.image.srcMobile !== imageSrc ? design.image.srcMobile : "";
  const headline = design.boxes.find((b) => b.role === "headline" && !b.hidden);
  const overlay = overlayStyle(
    design,
    headline ? { x: headline.x + headline.w / 2, y: headline.y + 10 } : undefined,
  );
  // R48: decide up front which box becomes the page's single <h1> (the first
  // visible heading box that has text) instead of mutating a flag mid-render.
  // Same result as before; satisfies react-hooks/immutability.
  const h1Index =
    headingLevel === 1
      ? design.boxes.findIndex(
          (b) => !b.hidden && roleInfo(b.role).html === "h2" && resolveBoxText(b, legacy).trim() !== "",
        )
      : -1;
  const boxEl = (b: DesignTextBox, index: number) => {
    const info = roleInfo(b.role);
    if (info.html === "h2") return index === h1Index ? ("h1" as const) : ("h2" as const);
    return info.html;
  };
  // R55: owner-chosen layer order paints via z-index; DOM/reading order stays shapes → text → buttons.
  const z = layerZ(design);
  const withZ = (style: Record<string, string>, id: string) => {
    const n = z?.get(id);
    return n ? { ...style, zIndex: String(n) } : style;
  };
  // R59: entrances + intro curtain (and R58 "words wait for the smoke").
  const plan = entrancePlan(design);
  const entering = new Set(plan.map((p) => p.id));
  const en = (id: string): Record<string, string> => (entering.has(id) ? { "data-gw-enter": id } : {});
  const bindSuffix = (b: DesignTextBox) =>
    b.bind === "title" ? "title" : b.bind === "eyebrow" ? "eyebrow" : b.bind === "subtitle" ? "subtitle" : null;

  return (
    <div style={css(containerStyle())} className="gw-dcontainer" {...(zone ?? {})}>
      {/* R56-S2: owner-uploaded fonts. React 19 hoists <style href precedence>
          into <head> and dedupes by href, so two banners using one font emit
          one @font-face. */}
      {customFontIdsIn(design).map((id) => (
        <style key={id} href={`gw-font-${id}`} precedence="default">
          {customFontFaceCss([id])}
        </style>
      ))}
      <div
        style={css(frameStyle(design))}
        className={`gw-dframe border border-white/10 bg-[var(--charcoal)] shadow-xl shadow-black/30${plan.length ? " gw-enp" : ""}`}
        {...(editable && owner ? { "data-gw-design-frame": "true", "data-gw-design-owner": owner } : {})}
      >
        {phoneSrc ? (
          <>
            {/* R42 Q4: separate phone picture. The container rule in globals.css
                shows exactly one of these (banner < 768px wide = phone). Both are
                lazy: browsers skip display:none lazy images, so each device
                downloads only the picture it shows. */}
            {imageSrc ? (
              <BannerPicture fx={design.image.fx} className="gw-dimg-d absolute inset-0 overflow-hidden" ariaHidden={imageAlt || isVideoSrc(imageSrc) ? undefined : true}>
                <BannerMedia
                  src={imageSrc}
                  alt={imageAlt}
                  loading="lazy"
                  fetchPriority={priority ? "high" : undefined}
                  sizes="1408px"
                  className="gw-dimg"
                  style={css(imageStyle(design))}
                />
              </BannerPicture>
            ) : null}
            <BannerPicture fx={design.image.fx} className="gw-dimg-m absolute inset-0 overflow-hidden" ariaHidden={imageAlt || isVideoSrc(phoneSrc) ? undefined : true}>
              <BannerMedia
                src={phoneSrc}
                alt={imageAlt}
                loading="lazy"
                fetchPriority={priority ? "high" : undefined}
                sizes="100vw"
                className="gw-dimg"
                style={css(imageStyle(design))}
              />
            </BannerPicture>
          </>
        ) : imageSrc ? (
          <BannerPicture fx={design.image.fx} className="absolute inset-0 overflow-hidden" ariaHidden={imageAlt || isVideoSrc(imageSrc) ? undefined : true}>
            <BannerMedia
              src={imageSrc}
              alt={imageAlt}
              priority={priority}
              sizes="(max-width: 768px) 100vw, 1408px"
              className="gw-dimg"
              style={css(imageStyle(design))}
            />
          </BannerPicture>
        ) : null}
        {overlay ? <div style={css(overlay)} aria-hidden="true" /> : null}
        {/* R58: smoke / fog / haze (lazy, client-only) + words that fade in after it. */}
        {plan.length || design.intro ? <BannerEntrances plan={plan} intro={design.intro} /> : null}
        {design.smoke ? <BannerSmoke layers={design.smoke} /> : null}
        {(design.elements ?? []).map((el) =>
          el.hidden ? null : el.kind === "anim" && el.anim ? (
            // R60: Lottie / Rive layer — a lazy client island; described for screen readers only when the owner wrote an alt.
            <div
              key={el.id}
              {...(el.anim.alt ? { role: "img", "aria-label": el.anim.alt } : { "aria-hidden": true })}
              style={css({ ...withZ(elementStyle(el), el.id), ...(animWantsPointer(el.anim) ? { pointerEvents: "auto", cursor: el.anim.start === "click" ? "pointer" : "default" } : {}) })}
              className={`gw-dbox${el.hideOnMobile ? " gw-hide-sm" : ""}`}
              {...(editable ? { "data-gw-design-element": el.id } : {})}
              {...en(el.id)}
            >
              <BannerAnim anim={el.anim} />
            </div>
          ) : (
            <div
              key={el.id}
              aria-hidden="true"
              style={css(withZ(elementStyle(el), el.id))}
              className={`gw-dbox${el.hideOnMobile ? " gw-hide-sm" : ""} ${elementHoverClass(el)}`.trim()}
              {...(editable ? { "data-gw-design-element": el.id } : {})}
              {...en(el.id)}
            >
              <ElementVisual el={el} />
            </div>
          ),
        )}
        {design.boxes.map((b, i) => {
          if (b.hidden) return null;
          const text = resolveBoxText(b, legacy);
          if (!text.trim()) return null;
          const Tag = boxEl(b, i);
          const suffix = bindSuffix(b);
          const boxCss = css(withZ(b.curve ? curvedBoxStyle(b) : boxStyle(b), b.id));
          const boxCls = `gw-dbox${b.hideOnMobile ? " gw-hide-sm" : ""} ${boxMotionClass(b)}`.trim();
          // R58-S3: countdown / auto deal badge — a small client island ticks it.
          if (b.live) return <LiveBox key={b.id} as={Tag} box={b} text={text} style={boxCss} className={boxCls} attrs={{ ...(editable ? { "data-gw-design-box": b.id } : {}), ...en(b.id) }} />;
          return (
            <Tag
              key={b.id}
              style={boxCss}
              className={boxCls}
              {...(editable ? { "data-gw-design-box": b.id } : {})}
              {...en(b.id)}
              {...(editable && blockKeyPrefix && suffix
                ? { "data-gw-block": `${blockKeyPrefix}.${suffix}`, "data-gw-editable": "true" }
                : {})}
            >
              {b.curve ? <CurvedText box={b} text={text} /> : text}
            </Tag>
          );
        })}
        {design.buttons.map((btn) => {
          if (!btn.enabled || !btn.label.trim() || !btn.href.trim()) return null;
          const style = css(withZ(buttonStyle(btn), btn.id));
          const fxc = buttonFxClass(btn);
          const className = `gw-dbox gw-dbtn${btn.hideOnMobile ? " gw-hide-sm" : ""}${fxc ? ` ${fxc}` : ""}`;
          const hooks = { ...(editable ? { "data-gw-design-button": btn.id } : {}), ...en(btn.id) };
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
                <ButtonInner btn={btn} />
              </a>
            );
          }
          return (
            <Link key={btn.id} href={btn.href} style={style} className={className} {...hooks}>
              <ButtonInner btn={btn} />
            </Link>
          );
        })}
        {design.beam ? <BannerBeam beam={design.beam} radius={design.frame.radius} /> : null}
      </div>
    </div>
  );
}
