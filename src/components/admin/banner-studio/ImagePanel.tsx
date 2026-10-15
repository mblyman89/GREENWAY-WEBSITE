"use client";

/**
 * R41 S2 — picture, tint and banner-size options (bible PART 5.6, Q19).
 * Focal point: click the thumbnail where the important part of the photo is;
 * the banner keeps that spot in view when it's cropped (object-position).
 */
import {
  OVERLAY_DIRECTIONS,
  OVERLAY_KINDS,
  type BannerDesign,
  type DesignDevice,
  type DesignDirection,
  type DesignOverlayKind,
} from "@/lib/cms/banner-design-core";
import { type MediaChoice } from "@/components/admin/ContentImageField";
import { ColorField, NumberSlider, Segmented, Toggle } from "./controls";

const OVERLAY_LABEL: Record<DesignOverlayKind, string> = {
  none: "None",
  full: "Even tint",
  gradient: "Side fade",
  floor: "Bottom fade",
  radial: "Spotlight",
};
const DIR_LABEL: Record<DesignDirection, string> = { left: "Dark left", right: "Dark right", top: "Dark top", bottom: "Dark bottom" };

export function ImagePanel({
  design,
  device,
  imageSrc,
  onChange,
}: {
  design: BannerDesign;
  device: DesignDevice;
  /** The picture for the CURRENT device (phone picture when set and device = phone). */
  imageSrc: string;
  onChange: (d: BannerDesign) => void;
  /** R53: unused (the separate phone picture was removed — one picture per banner). Kept so callers compile. */
  mediaChoices?: MediaChoice[];
}) {
  const im = design.image;
  const mobile = device === "mobile";
  const fx = mobile ? (im.focusXMobile ?? im.focusX) : im.focusX;
  const fy = mobile ? (im.focusYMobile ?? im.focusY) : im.focusY;
  const setImage = (p: Partial<BannerDesign["image"]>) => onChange({ ...design, image: { ...im, ...p } });
  const setOverlay = (p: Partial<BannerDesign["overlay"]>) => onChange({ ...design, overlay: { ...design.overlay, ...p } });
  const setFrame = (p: Partial<BannerDesign["frame"]>) => onChange({ ...design, frame: { ...design.frame, ...p } });

  function setFocus(x: number, y: number) {
    const rx = Math.round(Math.min(100, Math.max(0, x)));
    const ry = Math.round(Math.min(100, Math.max(0, y)));
    setImage(mobile ? { focusXMobile: rx, focusYMobile: ry } : { focusX: rx, focusY: ry });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-[0.68rem] font-semibold uppercase tracking-wide text-white/60">
          Focus point {mobile ? "— phone" : "— computer"}
        </p>
        <p className="mb-2 text-[0.7rem] text-white/50">Click the most important part of the picture. It stays in view however the banner is cropped.</p>
        {imageSrc ? (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Focus point ${fx}% across, ${fy}% down. Click the picture or use arrow keys.`}
            className="relative w-full cursor-crosshair overflow-hidden rounded-md border border-white/20"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setFocus(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 10 : 2;
              const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
              const d = map[e.key];
              if (d) {
                e.preventDefault();
                setFocus(fx + d[0], fy + d[1]);
              }
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- editor thumbnail for any path/URL */}
            <img src={imageSrc} alt="" className="block w-full select-none" draggable={false} />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_#000]"
              style={{ left: `${fx}%`, top: `${fy}%` }}
            />
          </div>
        ) : (
          <p className="text-xs text-white/45">Choose a background image above first.</p>
        )}
        {mobile && (im.focusXMobile !== null || im.focusYMobile !== null) ? (
          <button type="button" className="mt-1 text-xs text-white/60 underline" onClick={() => setImage({ focusXMobile: null, focusYMobile: null })}>
            Use the computer focus on phones
          </button>
        ) : null}
      </div>

      <NumberSlider label="Zoom" value={im.zoom} min={100} max={250} unit="%" onChange={(zoom) => setImage({ zoom })} />
      <NumberSlider label="Brightness" value={im.brightness} min={50} max={150} unit="%" onChange={(brightness) => setImage({ brightness })} />
      <NumberSlider label="Color strength" value={im.saturation} min={0} max={200} unit="%" onChange={(saturation) => setImage({ saturation })} hint="0% = black & white." />
      <NumberSlider label="Blur" value={im.blur} min={0} max={12} unit="px" onChange={(blur) => setImage({ blur })} hint="A little blur makes text easier to read on busy photos." />
      <Toggle label="Flip picture left ↔ right" checked={im.flip} onChange={(flip) => setImage({ flip })} />

      <div className="space-y-3 rounded-md border border-white/10 p-2">
        <Segmented<DesignOverlayKind>
          label="Shade over the picture (makes text readable)"
          value={design.overlay.kind}
          options={OVERLAY_KINDS.map((k) => ({ value: k, label: OVERLAY_LABEL[k] }))}
          onChange={(kind) => setOverlay({ kind, opacity: kind !== "none" && design.overlay.opacity === 0 ? 60 : design.overlay.opacity })}
        />
        {design.overlay.kind !== "none" ? (
          <>
            {design.overlay.kind === "gradient" ? (
              <Segmented<DesignDirection>
                label="Darkest side"
                value={design.overlay.direction}
                options={OVERLAY_DIRECTIONS.map((d) => ({ value: d, label: DIR_LABEL[d] }))}
                onChange={(direction) => setOverlay({ direction })}
              />
            ) : null}
            <NumberSlider label="Shade strength" value={design.overlay.opacity} min={0} max={100} unit="%" onChange={(opacity) => setOverlay({ opacity })} />
            <ColorField label="Shade color" value={design.overlay.color} onChange={(color) => setOverlay({ color })} />
          </>
        ) : null}
      </div>

      <div className="space-y-3 rounded-md border border-white/10 p-2">
        <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-white/60">Banner size</p>
        <NumberSlider label="Height — computer" value={design.frame.height} min={80} max={720} step={4} unit="px" onChange={(height) => setFrame({ height })} />
        <NumberSlider label="Height — phone" value={design.frame.heightMobile} min={80} max={720} step={4} unit="px" onChange={(heightMobile) => setFrame({ heightMobile })} />
        <NumberSlider label="Rounded corners" value={design.frame.radius} min={0} max={48} unit="px" onChange={(radius) => setFrame({ radius })} />
      </div>
    </div>
  );
}
