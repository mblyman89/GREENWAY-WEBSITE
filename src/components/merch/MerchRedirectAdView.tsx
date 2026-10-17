import type { MerchAdView } from "@/lib/merch/merch-ad-core";
import { clickZoneAttrs } from "@/lib/analytics/click-events-core";

/**
 * R71 S4 - markup of the Greenway Goods redirect ad. Pure (no server-only
 * imports) so the shop (MerchRedirectAd) and the Merch Studio preview render
 * the identical thing. It only ever receives a resolved MerchAdView: one
 * https address, words and pictures. No product ids, prices or cart.
 */
const LINK_PROPS = { target: "_blank", rel: "noopener noreferrer", referrerPolicy: "no-referrer" } as const;

export function MerchRedirectAdView({ view }: { view: MerchAdView }) {
  return (
    <section id="greenway-goods" aria-labelledby="greenway-goods-heading" className="px-3 pb-10 pt-2 sm:px-4 md:px-8">
      <div
        className="mx-auto max-w-[var(--shop-max)] overflow-hidden rounded-[1.35rem] border border-white/10 bg-zinc-950 p-5 shadow-xl shadow-black/25 md:p-8"
        {...clickZoneAttrs({ place: "other", slot: "greenway-goods", label: "Greenway Goods ad" })}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            {view.eyebrow ? <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-[var(--greenway)]">{view.eyebrow}</p> : null}
            {view.heading ? <h2 id="greenway-goods-heading" className="mt-2 text-3xl font-black text-white">{view.heading}</h2> : <h2 id="greenway-goods-heading" className="sr-only">Greenway Goods</h2>}
            {view.intro ? <p className="mt-2 text-sm leading-6 text-zinc-300">{view.intro}</p> : null}
          </div>
          <a
            href={view.url}
            {...LINK_PROPS}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--greenway)] px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-black transition hover:brightness-110"
          >
            {view.button}
            <span aria-hidden="true">&#8599;</span>
            <span className="sr-only"> (opens {view.host} in a new tab)</span>
          </a>
        </div>
        {view.tiles.length ? (
          <ul className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {view.tiles.map((t, i) => (
              <li key={`${t.image}-${i}`}>
                <a href={view.url} {...LINK_PROPS} className="group block overflow-hidden rounded-[1rem] border border-white/10 bg-white" aria-label={`${t.caption || view.heading || "Greenway Goods"} - opens ${view.host} in a new tab`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- owner-picked advert picture; may live on the merch domain (not proxied) */}
                  <img src={t.image} alt="" loading="lazy" className="aspect-square w-full object-cover transition duration-500 group-hover:scale-105" />
                  {t.caption ? <span className="block bg-zinc-950 px-3 py-2 text-xs font-bold text-white">{t.caption}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-4 text-[0.68rem] leading-5 text-zinc-500">
          Apparel is sold and shipped by Greenway Merchandising LLC (dba Greenway Glass &amp; Goods) on its own website, {view.host}. It is not sold, delivered or rung up by this cannabis store.
        </p>
      </div>
    </section>
  );
}
