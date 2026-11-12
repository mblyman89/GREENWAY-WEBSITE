"use client";

/**
 * D234 C-5 (SOP-11b G-101; F-11-32): picture shape per placement, the safe
 * area and the crop-edge hint. All numbers come from `picture-shape-core.ts`
 * (the banner's real shape at every width stop, the same crop as the site).
 */
import { type BannerDesign, type DesignDevice } from "@/lib/cms/banner-design-core";
import { cropEdgeHint, pictureAdvice, ratioLabel, safeArea, shapeVerdict } from "@/lib/cms/picture-shape-core";

export type NaturalSize = { w: number; h: number } | null;

/** Dims what some width cuts off; the clear box always shows (every width of this layout). */
export function SafeAreaOverlay({ design, device, nat }: { design: BannerDesign; device: DesignDevice; nat: NaturalSize }) {
  if (!nat || !(nat.w > 0 && nat.h > 0)) return null;
  const a = safeArea(design, nat.w / nat.h, device);
  if (a.x1 <= a.x0 || a.y1 <= a.y0) return null;
  const pc = (n: number) => `${Math.round(n * 1000) / 10}%`;
  const dim = "pointer-events-none absolute bg-black/55";
  return (
    <span aria-hidden="true" data-safe-area={`${pc(a.x0)} ${pc(a.y0)} ${pc(a.x1)} ${pc(a.y1)}`}>
      <span className={dim} style={{ left: 0, top: 0, width: "100%", height: pc(a.y0) }} />
      <span className={dim} style={{ left: 0, top: pc(a.y1), width: "100%", bottom: 0 }} />
      <span className={dim} style={{ left: 0, top: pc(a.y0), width: pc(a.x0), height: pc(a.y1 - a.y0) }} />
      <span className={dim} style={{ left: pc(a.x1), top: pc(a.y0), right: 0, height: pc(a.y1 - a.y0) }} />
      <span
        className="pointer-events-none absolute border-2 border-dashed border-[var(--admin-accent,#7fd67f)]"
        style={{ left: pc(a.x0), top: pc(a.y0), width: pc(a.x1 - a.x0), height: pc(a.y1 - a.y0) }}
      />
    </span>
  );
}

/** "Picture shape": the size that fits this banner, how the chosen picture fits, and the crop-edge hint. */
export function PictureShapeFields({ design, device, nat }: { design: BannerDesign; device: DesignDevice; nat: NaturalSize }) {
  const a = pictureAdvice(design);
  const shapes = device === "mobile" ? a.mobile : a.desktop;
  const verdict = nat ? shapeVerdict(nat.w, nat.h, a) : null;
  const hint = nat ? cropEdgeHint(design, nat.w / nat.h, device) : null;
  return (
    <div className="space-y-1.5 rounded-md border border-white/10 p-2 text-[0.7rem] text-white/70" data-picture-shape>
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-white/60">Picture shape</p>
      <p>
        Best picture for this banner: <strong className="text-white">{a.forBoth.label}</strong> (fits computers and phones).
        {a.forDesktop.ratio !== a.forBoth.ratio ? <> Computer only: {a.forDesktop.label}. Phone only: {a.forMobile.label}.</> : null}
      </p>
      <p className="text-white/50">
        This banner is {shapes.map((s) => ratioLabel(s.ratio)).filter((v, i, xs) => xs.indexOf(v) === i).join(" → ")} {design.frame.card ? "(card)" : `from ${shapes[0]?.w} to ${shapes[shapes.length - 1]?.w} px wide`} {device === "mobile" ? "on phones" : "on computers"}. The clear box on the picture above always shows; the dark parts are cut at some width.
      </p>
      {nat ? (
        <p className="text-white/50">
          Your picture: {nat.w} × {nat.h} px ({ratioLabel(nat.w / nat.h)}).
        </p>
      ) : null}
      {verdict ? <p className="rounded bg-white/5 px-2 py-1 text-white/75">{verdict}</p> : null}
      {hint ? (
        <p role="status" className="rounded bg-amber-500/15 px-2 py-1 text-amber-200" data-crop-hint>
          ⚠ {hint}
        </p>
      ) : null}
    </div>
  );
}
