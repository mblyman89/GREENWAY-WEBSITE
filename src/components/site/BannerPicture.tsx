import type { CSSProperties, ReactNode } from "react";
import { imageFadeMask, imageFxLayers, kenBurns, type ImageFx } from "@/lib/cms/banner-image-core";

/**
 * R59-S1 — wraps a banner's picture/video with the pro picture tools:
 * backdrop colour (shows through see-through / faded edges), edge fade mask,
 * Ken Burns motion, and the colour-grade / duotone / grain / vignette layers.
 * Server-safe, no JS. Used by the public banner AND the Studio canvas, so the
 * preview is the real thing. With no `fx` it renders exactly the old wrapper.
 */
export function BannerPicture({
  fx,
  className = "absolute inset-0 overflow-hidden",
  ariaHidden,
  children,
}: {
  fx: ImageFx | undefined;
  className?: string;
  ariaHidden?: true;
  children: ReactNode;
}) {
  if (!fx) {
    return (
      <div className={className} aria-hidden={ariaHidden}>
        {children}
      </div>
    );
  }
  const kb = kenBurns(fx);
  const style = { ...(fx.bg ? { background: fx.bg } : {}) } as CSSProperties;
  const mask = imageFadeMask(fx) as unknown as CSSProperties;
  return (
    <div className={className} aria-hidden={ariaHidden} style={style}>
      <div className="absolute inset-0 overflow-hidden" style={mask}>
        <div className={`absolute inset-0 ${kb.className}`.trim()} style={kb.style as unknown as CSSProperties}>
          {children}
        </div>
        {imageFxLayers(fx).map((l) => (
          <div key={l.key} aria-hidden="true" style={l.style as unknown as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
