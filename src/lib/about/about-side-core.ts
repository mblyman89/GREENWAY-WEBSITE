/**
 * R64 — the About page's right-hand container (beside the statement card),
 * owner-editable.
 *
 * One "richjson" content block (JSON in the plain text column, so no
 * migration). Basic mode = one picture / logo + alt text + fit (contain keeps
 * the whole logo visible, cover fills the box). The optional Design Studio
 * card (`design`, enabled) replaces the basic look entirely — text boxes,
 * buttons, overlays, the works. Blank / bad JSON resolves to the shipped look
 * (the black-and-gold logo, contained), so nothing changes until published.
 */
import { normalizeDesign, type BannerDesign } from "@/lib/cms/banner-design-core";

export const ABOUT_SIDE_BLOCK = "about.side.panel";
export const ABOUT_SIDE_DEFAULT_SRC = "/brand/greenway-black-gold-logo.png";
export const ABOUT_SIDE_DEFAULT_ALT = "Greenway Marijuana black and gold logo";

export type AboutSideFit = "contain" | "cover";
export type AboutSidePanel = {
  src: string;
  alt: string;
  fit: AboutSideFit;
  /** Pads the picture inside the box (contain only). */
  padded: boolean;
  design?: BannerDesign;
};

export function defaultAboutSide(): AboutSidePanel {
  return { src: ABOUT_SIDE_DEFAULT_SRC, alt: ABOUT_SIDE_DEFAULT_ALT, fit: "contain", padded: true };
}

export function resolveAboutSide(raw: string | null | undefined): AboutSidePanel {
  const d = defaultAboutSide();
  if (!raw || !raw.trim()) return d;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const src = typeof j.src === "string" && j.src.trim() ? j.src.trim() : d.src;
    const out: AboutSidePanel = {
      src: /^(\/|https:\/\/)/.test(src) ? src : d.src,
      alt: typeof j.alt === "string" ? j.alt.trim().slice(0, 200) : d.alt,
      fit: j.fit === "cover" ? "cover" : "contain",
      padded: j.padded !== false,
    };
    const design = normalizeDesign(j.design);
    if (design) out.design = design;
    return out;
  } catch {
    return d;
  }
}

export function serializeAboutSide(p: AboutSidePanel): string {
  return JSON.stringify(p);
}

/** True when the published panel should render the studio card. */
export function aboutSideUsesDesign(p: AboutSidePanel): p is AboutSidePanel & { design: BannerDesign } {
  return !!p.design && p.design.enabled === true;
}

export function __runAboutSideCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("about-side-core: " + m);
    passed += 1;
  };
  const d = resolveAboutSide("");
  ok(d.src === ABOUT_SIDE_DEFAULT_SRC && d.fit === "contain" && d.padded, "blank → shipped look");
  ok(!aboutSideUsesDesign(d), "no design by default");
  ok(resolveAboutSide("{bad").src === ABOUT_SIDE_DEFAULT_SRC, "bad json → default");
  const r = resolveAboutSide(JSON.stringify({ src: "javascript:x", fit: "weird" }));
  ok(r.src === ABOUT_SIDE_DEFAULT_SRC && r.fit === "contain", "unsafe src / fit rejected");
  const g = resolveAboutSide(serializeAboutSide({ src: "https://x.test/a.png", alt: "A", fit: "cover", padded: false }));
  ok(g.src === "https://x.test/a.png" && g.fit === "cover" && !g.padded && g.alt === "A", "round trip");
  return { passed };
}
