/**
 * Copied VERBATIM from the cannabis site's src/lib/ui/glow-card-core.ts
 * (glowCardStyle + GLOW_TONES) so greenwaymerch.com cards are byte-identical
 * to the shop cards on greenwaymarijuana.com. A copy (not an import) because
 * this is a separate Vercel project and Turbopack does not resolve files
 * outside the project root.
 */
import type { CSSProperties } from "react";

export type GlowTone = { border: string; glowLeft: string; glowSoftLeft: string; glowRight: string; glowSoftRight: string; panel: string };

export function glowCardStyle(tone: GlowTone): CSSProperties {
  return {
    borderColor: tone.border,
    backgroundColor: "#101010",
    backgroundImage: `radial-gradient(ellipse 54% 72% at -9% 44%, ${tone.glowLeft} 0%, ${tone.glowSoftLeft} 28%, rgba(20,20,20,0) 61%), radial-gradient(ellipse 48% 68% at 108% 61%, ${tone.glowRight} 0%, ${tone.glowSoftRight} 26%, rgba(20,20,20,0) 59%), linear-gradient(180deg, rgba(18,18,18,0.94), ${tone.panel} 48%, rgba(10,10,10,0.98))`,
    boxShadow: `inset 18px 0 34px -31px ${tone.glowLeft}, inset -18px 0 34px -31px ${tone.glowRight}, 0 13px 28px rgba(0,0,0,0.38)`,
  };
}

export const GLOW_STRIP_LEFT_CLASS = "pointer-events-none absolute -left-px top-10 h-[42%] w-px opacity-90 blur-[1px]";
export const GLOW_STRIP_RIGHT_CLASS = "pointer-events-none absolute -right-px top-[31%] h-[46%] w-px opacity-90 blur-[1px]";
export const GLOW_STRIP_BOTTOM_CLASS = "pointer-events-none absolute inset-x-7 -bottom-px h-px opacity-70 blur-[1px]";

export const GLOW_TONES: GlowTone[] = [
  { border: "#4f8f5a", glowLeft: "rgba(79,143,90,0.95)", glowSoftLeft: "rgba(126,184,127,0.34)", glowRight: "rgba(79,143,90,0.95)", glowSoftRight: "rgba(126,184,127,0.34)", panel: "rgba(15,28,18,0.76)" },
  { border: "#b0863d", glowLeft: "rgba(217,150,39,0.92)", glowSoftLeft: "rgba(255,191,53,0.34)", glowRight: "rgba(217,117,39,0.92)", glowSoftRight: "rgba(255,151,53,0.34)", panel: "rgba(34,25,13,0.74)" },
  { border: "#8a9a4f", glowLeft: "rgba(190,170,70,0.92)", glowSoftLeft: "rgba(214,200,110,0.34)", glowRight: "rgba(126,151,95,0.95)", glowSoftRight: "rgba(160,184,127,0.34)", panel: "rgba(27,29,17,0.74)" },
  { border: "#3f8f7a", glowLeft: "rgba(63,143,122,0.95)", glowSoftLeft: "rgba(116,196,178,0.32)", glowRight: "rgba(84,153,120,0.92)", glowSoftRight: "rgba(126,196,160,0.32)", panel: "rgba(12,28,26,0.76)" },
];

export function glowToneByIndex(index: number): GlowTone {
  const n = GLOW_TONES.length;
  return GLOW_TONES[((Math.trunc(index) % n) + n) % n];
}

/** The shared site background layer (verbatim SITE_BG_LAYER_CLASS). */
export const SITE_BG_LAYER_CLASS =
  "pointer-events-none fixed inset-0 -z-10 bg-black " +
  "bg-[radial-gradient(circle_at_18%_10%,rgba(255,127,0,0.13),transparent_18rem)," +
  "radial-gradient(circle_at_88%_18%,rgba(255,215,0,0.11),transparent_22rem)," +
  "radial-gradient(circle_at_52%_88%,rgba(126,217,87,0.08),transparent_24rem)]";
