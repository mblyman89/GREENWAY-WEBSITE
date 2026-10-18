/**
 * R73 S3 - a finished banner the owner designed in the Brand hub and attached
 * in Website -> Merchandise -> Banners. It is a ready-made picture, so it
 * renders pixel-identical to what was designed (desktop + optional phone art),
 * with the same rounded-card frame as greenwaymarijuana.com's Shop banner.
 * No banner attached = nothing renders (the page looks exactly as before).
 */
import type { MerchBannerView } from "@/lib/site-content-core";

export function MerchBanner({ banner, priority }: { banner: MerchBannerView | null; priority?: boolean }) {
  if (!banner) return null;
  const pic = (
    <picture>
      <source media="(max-width: 767px)" srcSet={banner.imageMobile} />
      <img src={banner.image} alt={banner.alt} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" className="block h-auto w-full" />
    </picture>
  );
  const frame = "block overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal,#111)] shadow-2xl shadow-black/40";
  return (
    <div className="mx-auto max-w-[var(--shop-max)] px-3 pt-5 sm:px-4 md:px-8 md:pt-8">
      {banner.link ? (
        <a href={banner.link} className={`${frame} transition hover:border-white/40`} aria-label={banner.alt || undefined}>{pic}</a>
      ) : (
        <div className={frame}>{pic}</div>
      )}
    </div>
  );
}
