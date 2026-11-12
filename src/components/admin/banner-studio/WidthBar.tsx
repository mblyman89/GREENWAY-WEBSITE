"use client";

/**
 * D234 slice C-2 (SOP-11b, G-97 / G-98) — see the banner at the widths the
 * website really uses, and open the real page.
 *
 * "Reference" (no width) is today's view: 1408 computer / 390 phone. Any
 * other width lays the canvas out at that width with the website's own sizing
 * (`canvasRefPx` → `fluidPxAt`, the same math as `interpPx`), and below 768 the
 * phone layout applies, exactly like the container query on the site. Moves
 * made at a width write the layout shown (computer or phone).
 */
import { usePathname } from "next/navigation";
import type { DesignDevice } from "@/lib/cms/banner-design-core";
import {
  MAX_STUDIO_WIDTH,
  MIN_STUDIO_WIDTH,
  WIDTH_STOPS,
  layoutForWidth,
  livePathForAdmin,
  previewDeviceForWidth,
  realPageHref,
} from "@/lib/cms/studio-widths-core";

const chip = (on: boolean) =>
  on
    ? "rounded-full bg-[var(--admin-accent)] px-2 py-0.5 text-[0.7rem] font-bold text-black"
    : "rounded-full bg-white/10 px-2 py-0.5 text-[0.7rem] text-white/75 hover:bg-white/20";

export function WidthBar({
  width,
  device,
  card,
  onWidth,
}: {
  width: number | null;
  device: DesignDevice;
  card: boolean;
  /** null = back to the reference size; device = the layout that width uses. */
  onWidth: (w: number | null, device: DesignDevice) => void;
}) {
  const pathname = usePathname() ?? "";
  const live = livePathForAdmin(pathname);
  const shown = width ?? (device === "mobile" ? 390 : 1408);
  return (
    <div className="space-y-1.5 rounded-md border border-white/10 px-2 py-1.5 text-xs">
      {card ? (
        <p className="text-white/55">Cards keep their own shape at every size, so they have no width slider.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="gw-studio-width" className="font-semibold text-white/80">
              Banner width
            </label>
            <input
              id="gw-studio-width"
              type="range"
              min={MIN_STUDIO_WIDTH}
              max={MAX_STUDIO_WIDTH}
              step={2}
              value={shown}
              aria-valuetext={`${shown} pixels, ${layoutForWidth(shown) === "mobile" ? "phone" : "computer"} layout`}
              onChange={(e) => {
                const w = Number(e.target.value);
                onWidth(w, layoutForWidth(w));
              }}
              className="w-40 accent-[var(--admin-accent)]"
            />
            <span className="tabular-nums text-white/80">
              {shown} px · {layoutForWidth(shown) === "mobile" ? "📱 phone layout" : "🖥 computer layout"}
            </span>
            <button type="button" className={chip(width === null)} onClick={() => onWidth(null, device)} title="The studio's usual size: 1408 computer, 390 phone">
              Reference
            </button>
          </div>
          <div role="group" aria-label="Real banner widths" className="flex flex-wrap gap-1">
            {WIDTH_STOPS.map((s) => (
              <button key={s.w} type="button" className={chip(width === s.w)} onClick={() => onWidth(s.w, s.device)} title={`${s.w} px banner (${s.device === "mobile" ? "phone" : "computer"} layout)`}>
                {s.label} · {s.w}
              </button>
            ))}
          </div>
        </>
      )}
      {live ? (
        <p className="text-white/60">
          <a
            href={realPageHref(live, previewDeviceForWidth(width, device))}
            target="_blank"
            rel="noopener"
            className="font-semibold text-[var(--admin-accent)] underline underline-offset-2"
          >
            ↗ Check on the real page
          </a>{" "}
          opens Website Sync at <span className="font-mono">{live}</span> with Move mode on. It shows your last <b>saved draft</b>, so Save draft first.
        </p>
      ) : null}
    </div>
  );
}
