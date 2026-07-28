"use client";

/**
 * src/components/admin/ai/SmartImage.tsx — Slice R2 ("never a black box").
 *
 * Owner: "prevent the image from loading in the back office as an empty solid
 * black box."
 *
 * A crawled thumbnail can fail to paint for two verified reasons:
 *   1. Hotlink protection — the vendor's CDN 403s when the Referer is OUR
 *      admin page. Fix: load with `referrerPolicy="no-referrer"` first (many
 *      CDNs allow empty-referrer requests).
 *   2. The CDN blocks anyway, or serves a format the browser can't paint
 *      (TIFF, some AVIF/HEIC). Fix: fall back to our admin-only, SSRF-guarded
 *      proxy (`/api/admin/image-preview`) which retries with the image's own
 *      site origin as Referer and converts unpaintable formats to PNG.
 *
 * If BOTH fail, the box is never left black: an honest "Preview blocked —
 * open original" chip appears instead, so the human always knows what
 * happened and can still click through to the source.
 */
import { useState } from "react";

type Stage = "direct" | "proxy" | "blocked";

export function SmartImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [stage, setStage] = useState<Stage>("direct");

  if (stage === "blocked") {
    return (
      <span
        className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center"
        title="The site blocked the preview (hotlink protection or an unsupported format). Click to open the original in a new tab — saving may still work, because imports fetch server-side."
      >
        <span aria-hidden className="text-lg">🚫🖼️</span>
        <span className="text-[9px] leading-tight text-white/50">
          Preview blocked — open original
        </span>
      </span>
    );
  }

  const resolvedSrc =
    stage === "direct" ? src : `/api/admin/image-preview?url=${encodeURIComponent(src)}`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setStage((s) => (s === "direct" ? "proxy" : "blocked"))}
    />
  );
}
