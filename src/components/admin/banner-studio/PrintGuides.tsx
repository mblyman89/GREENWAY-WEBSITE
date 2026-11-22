"use client";

/**
 * D263 S2 — print guides on the Studio canvas (editor only, never exported).
 * The canvas is the bleed area: red dashed = trim (cut line), green dashed =
 * safe margin (keep words inside). Outside the trim is shaded lightly.
 * D263 S9: solid pink = die-cut line when one is set.
 */
import type { DesignPrint } from "@/lib/cms/banner-design-core";
import { guideInsets } from "@/lib/printing/print-sizes-core";
import { cutGuide } from "@/lib/printing/print-finish-core";

// D263 S11: guide lines stay 2px / 1px on screen at any zoom (--gw-u = 1/scale on the canvas layer).
const W = "calc(2px * var(--gw-u, 1))";
const W1 = "calc(1px * var(--gw-u, 1))";

export function PrintGuides({ print }: { print: DesignPrint }) {
  const g = guideInsets(print);
  const c = cutGuide(print);
  const box = (x: number, y: number) => ({ left: `${x}%`, right: `${x}%`, top: `${y}%`, bottom: `${y}%`, borderWidth: W });
  return (
    <div data-print-guides aria-hidden className="pointer-events-none absolute inset-0 z-[60] overflow-hidden">
      {print.bleed > 0 ? (
        <div className="absolute border-2 border-dashed border-red-500/90" style={{ ...box(g.trimX, g.trimY), boxShadow: "0 0 0 9999px rgba(255,0,0,0.10)" }} />
      ) : null}
      {c ? <div data-cut-line className="absolute border-2 border-fuchsia-500" style={{ left: `${c.left}%`, right: `${c.right}%`, top: `${c.top}%`, bottom: `${c.bottom}%`, borderRadius: c.radius, borderWidth: W }} /> : null}
      {print.safe > 0 ? <div className="absolute border border-dashed border-emerald-400/90" style={{ ...box(g.safeX, g.safeY), borderWidth: W1 }} /> : null}
    </div>
  );
}
