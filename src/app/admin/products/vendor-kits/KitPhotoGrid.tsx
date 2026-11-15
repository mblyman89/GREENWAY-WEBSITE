"use client";
/**
 * src/app/admin/products/vendor-kits/KitPhotoGrid.tsx  (D244 R-21)
 *
 * Owner (round 8, verbatim): "I do not want two sections of images, I want
 * to be able to remove text from any and all images available on the vendor
 * kit page, not just the small section at the bottom. ... please allow me to
 * remove text from any of the pictures available."
 *
 * ONE photo grid. Clicking a photo picks it as the kit photo (as before).
 * Every photo also has a "✂ Remove text" button that adds it to the
 * Remove-text queue just below the grid (up to 12 at a time; untick a done
 * one to make room). The old small thumbnail strip is gone. Nothing is
 * attached or applied here: the person presses "Use as the kit photo" and
 * then Apply.
 */
import Link from "next/link";
import { useState } from "react";
import { RemoveTextQueue } from "@/components/admin/products/RemoveTextQueue";
import { ERASE_QUEUE_MAX, toggleQueuePick, type EraseProduct } from "@/lib/enrichment/text-erase-core";

export type KitGridPhoto = {
  id: string;
  url: string | null;
  label: string;
  score: number;
  chips: string[];
  reasons: string[];
  warn: boolean;
  href: string;
};

export function KitPhotoGrid(props: {
  photos: KitGridPhoto[];
  selectedId: string | null;
  vendorId: string;
  product: EraseProduct;
  visionReady: boolean;
  fluxReady: boolean;
  pickHref: string;
}) {
  const { photos, selectedId, vendorId, product, visionReady, fluxReady, pickHref } = props;
  const [picked, setPicked] = useState<string[]>([]);
  const [full, setFull] = useState(false);
  const toggle = (id: string) => {
    const r = toggleQueuePick(picked, id);
    setPicked(r.picked);
    setFull(r.full);
  };
  const queuePhotos = photos.filter((p): p is KitGridPhoto & { url: string } => Boolean(p.url)).map((p) => ({ mediaId: p.id, url: p.url, label: p.label }));

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4" data-testid="kit-photo-grid">
        {photos.map((p) => {
          const on = picked.includes(p.id);
          return (
            <div
              key={p.id}
              data-testid="kit-photo"
              className={`rounded-lg border p-1 ${selectedId === p.id ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]/40" : on ? "border-[var(--admin-orange)]" : "border-white/10 hover:border-white/40"}`}
            >
              <Link href={p.href} className="block" title={p.reasons.join(" ")}>
                <div className="relative aspect-square overflow-hidden rounded bg-white/5">
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={p.label} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ) : null}
                  <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[0.65rem] text-white/80">{p.score}</span>
                </div>
                <span className="mt-1 block truncate text-xs text-white/75">{p.label}</span>
                <span className={`block text-[0.65rem] ${p.warn ? "text-[var(--admin-orange)]" : "text-white/50"}`}>{p.chips.join(" \u00b7 ")}</span>
              </Link>
              {p.url ? (
                <button
                  type="button"
                  data-testid="kit-photo-remove-text"
                  onClick={() => toggle(p.id)}
                  aria-pressed={on}
                  className={`mt-1 w-full rounded border px-2 py-1 text-[11px] font-semibold ${on ? "border-[var(--admin-orange)] bg-[var(--admin-orange)]/15 text-[var(--admin-orange)]" : "border-white/15 text-white/70 hover:bg-white/10"}`}
                >
                  {on ? `\u2713 In the Remove-text list (${picked.indexOf(p.id) + 1}) \u00b7 take out` : "\u2702 Remove text"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {full ? (
        <p className="mt-2 text-[11px] text-amber-300" role="status">
          The Remove-text list holds {ERASE_QUEUE_MAX} photos at a time. Take a finished one out to add more.
        </p>
      ) : null}
      {picked.length === 0 ? (
        <p className="mt-2 text-[11px] text-white/50" data-testid="kit-remove-text-hint">
          Click a photo to use it as the kit photo. Press {"\u201c\u2702 Remove text\u201d"} on any photo to clean the printed name off it first; the boxes and the Remove text button open just below.
        </p>
      ) : null}
      <div className="mt-4">
        <RemoveTextQueue
          scope={{ kind: "vendor", id: vendorId }}
          photos={queuePhotos}
          product={product}
          visionReady={visionReady}
          fluxReady={fluxReady}
          pickHref={pickHref}
          pickLabel="Use as the kit photo"
          picked={picked}
          onToggle={toggle}
          hidePicker
        />
      </div>
    </>
  );
}
