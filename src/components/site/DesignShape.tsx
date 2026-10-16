import type { CSSProperties } from "react";
import { shapeVisual, type DesignElement } from "@/lib/cms/banner-elements-core";

/**
 * R55-S2 — the inner drawing of a banner shape (decorative). Used by the
 * public DesignedBanner and the Studio canvas so both look identical.
 * No "use client": renders on the server or inside client components.
 */
export function DesignShape({ el }: { el: DesignElement }) {
  const v = shapeVisual(el);
  if ("css" in v) return <div style={v.css as unknown as CSSProperties} />;
  if ("iconPath" in v)
    // R55-S3: icon path data travels inside the design (validated SVG path commands only).
    return (
      <svg viewBox="0 0 256 256" width="100%" height="100%" style={{ display: "block" }} aria-hidden="true" focusable="false">
        <path d={v.iconPath} fill={v.fill} />
      </svg>
    );
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" style={{ display: "block", overflow: "visible" }} aria-hidden="true" focusable="false">
      <polygon
        points={v.points}
        fill={v.fill}
        stroke={v.stroke ?? "none"}
        strokeWidth={v.stroke ? v.strokeWidth : 0}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
