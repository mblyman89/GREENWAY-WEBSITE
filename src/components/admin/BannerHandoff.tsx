"use client";

/**
 * D234 slice C-8 (SOP-11b G-104, G-105). Two small pieces every banner editor
 * shows next to its Publish button:
 *
 *   • <AdCheckStrip>        the advertising-rule word check (warn only) and the
 *                           required tick "I checked the picture for minors
 *                           appeal" (owner Q-11-14 "warn with tick"); the
 *                           editor keeps Publish off until it is ticked.
 *   • <StudioPictureRow>    "Use the Creative Studio picture" when the editor
 *                           was opened from Creative Studio → Use in a banner
 *                           (?useImage=…), and "Make a picture for this
 *                           banner" with the banner's real picture size.
 */
import { useSyncExternalStore } from "react";
import type { BannerDesign } from "@/lib/cms/banner-design-core";
import type { ImageSpec } from "@/lib/cms/image-spec-core";
import { pictureAdvice } from "@/lib/cms/picture-shape-core";
import {
  PICTURE_TICK_HELP,
  PICTURE_TICK_LABEL,
  USE_IMAGE_PARAM,
  adFindingMessage,
  checkAdText,
  cleanUseImage,
  makeForBannerHref,
  studioSizeFor,
} from "@/lib/marketing/ad-check-core";

const noop = () => () => {};
/** The address bar's query, read without a hydration mismatch (server = ""). */
export function useLocationSearch(): string {
  return useSyncExternalStore(
    noop,
    () => window.location.search,
    () => "",
  );
}

export function AdCheckStrip({
  texts,
  checked,
  onChange,
  what = "Publish",
}: {
  texts: readonly (string | null | undefined)[];
  checked: boolean;
  onChange: (v: boolean) => void;
  /** The button the tick unlocks ("Publish", "Save Type Cards" …). */
  what?: string;
}) {
  const findings = checkAdText(texts);
  return (
    <div data-ad-check className="basis-full space-y-1.5 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
      <p className="font-semibold text-white/80">Advertising check (WAC 314-55-155)</p>
      {findings.length === 0 ? (
        <p className="text-[var(--admin-accent)]">✓ No banned words found in this banner&apos;s words.</p>
      ) : (
        <ul className="space-y-1" data-ad-findings>
          {findings.map((f) => (
            <li key={`${f.label}|${f.found}`} className={f.kind === "rule" ? "text-amber-200" : "text-white/70"}>
              ⚠ {adFindingMessage(f)}
            </li>
          ))}
        </ul>
      )}
      <label className="flex items-start gap-2 text-white/85">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--admin-accent)]" data-picture-tick />
        <span>
          <strong>{PICTURE_TICK_LABEL}</strong> <span className="text-white/55">{PICTURE_TICK_HELP}</span>
          {!checked ? <span className="block text-white/55">{what} turns on when this is ticked. The word check only warns; it never stops you.</span> : null}
        </span>
      </label>
    </div>
  );
}

/** The picture size for this banner: its real shape with a design, else the slot's size. */
export function bannerPictureSize(design: BannerDesign | null | undefined, spec?: ImageSpec): { w: number; h: number } | null {
  if (design?.enabled) {
    const a = pictureAdvice(design).forBoth;
    return { w: a.w, h: a.h };
  }
  const p = spec?.presets?.[0];
  return p ? { w: p.width, h: p.height } : null;
}

export function StudioPictureRow({
  targetId,
  anchor,
  design,
  spec,
  onUse,
  current,
}: {
  /** BANNER_TARGETS id (ad-check-core). */
  targetId: string;
  /** This card's anchor ("slide-<id>"), so the picture comes back to this card. */
  anchor?: string;
  design?: BannerDesign | null;
  spec?: ImageSpec;
  onUse: (url: string) => void;
  /** The picture the banner has now (the button hides once it is used). */
  current?: string;
}) {
  const search = useLocationSearch();
  const incoming = cleanUseImage(new URLSearchParams(search).get(USE_IMAGE_PARAM));
  const size = bannerPictureSize(design, spec);
  const fit = size ? studioSizeFor(size.w, size.h) : null;
  return (
    <div data-studio-picture className="flex flex-wrap items-center gap-2 text-xs">
      {incoming && incoming !== current ? (
        <span className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-2 py-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={incoming} alt="" className="h-8 w-14 rounded object-cover" loading="lazy" decoding="async" />
          <button type="button" onClick={() => onUse(incoming)} className="font-bold text-[var(--admin-accent)] underline-offset-2 hover:underline">
            Use the Creative Studio picture here
          </button>
          <span className="text-white/55">(fills the picture; then Save draft)</span>
        </span>
      ) : null}
      <a href={makeForBannerHref(targetId, size, anchor)} className="text-[var(--admin-accent)] underline-offset-2 hover:underline">
        ✨ Make a picture for this banner{fit ? ` (${fit.w} × ${fit.h} px)` : ""}
      </a>
    </div>
  );
}
