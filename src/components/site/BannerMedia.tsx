import Image from "next/image";
import type { CSSProperties } from "react";
import { isGifSrc } from "@/lib/media/gif-core";
import { isVideoSrc } from "@/lib/media/upload-policy-core";
import { BannerVideo, type BannerVideoProps } from "./BannerVideo";
import { cleanBlurDataUrl } from "@/lib/media/blur-placeholder-core";

/**
 * R44 — one switch for every banner background: an MP4/WebM src renders the
 * looping, silent, pausable <BannerVideo>; anything else renders exactly the
 * same `next/image` (fill) the banners used before (GIFs unoptimized, R43).
 *
 * No "use client": usable from server components (DesignedBanner,
 * SectionBanner) and client ones (Hero, ShopBannerCarousel) alike. The video
 * gets the same className/style as the image would, plus absolute fill, so
 * focal point / zoom / filters from the banner designer apply unchanged.
 */
export type BannerMediaProps = {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  style?: CSSProperties;
  priority?: boolean;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
  ariaHidden?: boolean;
  controlPosition?: BannerVideoProps["controlPosition"];
  hideControl?: boolean;
  /** Carousel slide currently shown (videos on hidden slides stay paused). */
  active?: boolean;
  /**
   * R45-S2: tiny base64 preview (≤10px) shown blurred while the photo loads.
   * Next 16 docs: remote images must supply blurDataURL themselves. Ignored
   * for video and GIF (animated GIFs are served unoptimized).
   */
  blurDataURL?: string;
};

export function BannerMedia({
  src,
  alt,
  sizes,
  className,
  style,
  priority,
  loading,
  fetchPriority,
  ariaHidden,
  controlPosition,
  hideControl,
  active,
  blurDataURL,
}: BannerMediaProps) {
  if (isVideoSrc(src)) {
    return (
      <BannerVideo
        src={src}
        className={`absolute inset-0 h-full w-full object-cover ${className ?? ""}`.trim()}
        style={style}
        priority={Boolean(priority || fetchPriority === "high")}
        controlPosition={controlPosition}
        hideControl={hideControl}
        active={active}
      />
    );
  }
  const gif = isGifSrc(src);
  const blur = !gif ? cleanBlurDataUrl(blurDataURL) : null;
  return (
    <Image
      src={src}
      unoptimized={gif}
      {...(blur ? { placeholder: "blur" as const, blurDataURL: blur } : {})}
      alt={alt}
      fill
      priority={priority}
      loading={priority ? undefined : loading}
      fetchPriority={priority ? undefined : fetchPriority}
      sizes={sizes}
      className={className}
      style={style}
      {...(ariaHidden ? { "aria-hidden": true } : {})}
    />
  );
}
