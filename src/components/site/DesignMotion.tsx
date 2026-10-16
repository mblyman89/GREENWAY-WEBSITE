import type { CSSProperties } from "react";
import { elementMotion, morphKeyframes, morphName, morphPolygon, orbitPath, beamStyle, type Beam, type MorphShape } from "@/lib/cms/banner-motion-core";
import { elementGlow, morphFill, shapePoints, type DesignElement } from "@/lib/cms/banner-elements-core";
import { DesignShape } from "./DesignShape";

/**
 * R57-S2 — the inside of a banner shape/icon WITH its micro-interactions:
 * motion wrapper (breathe/glow/float/spin/wiggle/blob), shape morph (A ⇄ B via
 * a tweened clip-path) and the orbit spark that travels around its border.
 * Pure CSS (globals.css "R57-S2"), no animation library. Server-safe: used by
 * the public DesignedBanner and the Studio canvas so both look identical.
 */
const css = (s: Record<string, string | number>) => s as unknown as CSSProperties;
const fill = { width: "100%", height: "100%" };

export function ElementVisual({ el }: { el: DesignElement }) {
  const m = elementMotion(el, elementGlow(el));
  const morph = el.motion === "morph" && el.morphTo ? { a: el.shape as MorphShape, b: el.morphTo } : null;
  const shape = morph ? (
    <>
      {/* React 19 hoists + dedupes this by href (one @keyframes per shape pair). */}
      <style href={morphName(morph.a, morph.b)} precedence="default">
        {morphKeyframes(morph.a, morph.b, shapePoints)}
      </style>
      <div className="gw-m gw-morph" style={{ ...fill, background: morphFill(el), clipPath: morphPolygon(morph.a, shapePoints(morph.a)), animationName: morphName(morph.a, morph.b) }} />
    </>
  ) : (
    <DesignShape el={el} />
  );
  return (
    <>
      {m.inner ? (
        <div className={m.inner} style={fill}>
          {shape}
        </div>
      ) : (
        shape
      )}
      {el.orbit ? (
        <span
          aria-hidden="true"
          className="gw-orbit"
          style={css({ offsetPath: orbitPath(el.shape, el.radius, shapePoints(el.shape)), width: el.orbit.size, height: el.orbit.size, "--gmc": el.orbit.color })}
        />
      ) : null}
    </>
  );
}

/** R57-S2 — a light (comet) that travels around the banner's border. */
export function BannerBeam({ beam, radius }: { beam: Beam; radius: number }) {
  return (
    <div aria-hidden="true" className="gw-beam-wrap">
      <div className="gw-beam" style={css(beamStyle(beam, radius))} />
    </div>
  );
}
