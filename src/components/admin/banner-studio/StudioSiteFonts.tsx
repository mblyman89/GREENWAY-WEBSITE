"use client";

/**
 * D234 slice C-1 (SOP-11b, G-94 / F-11-19) — the website's Heading and Body
 * fonts, handed to the Banner Design Studio so the canvas draws "Site font"
 * text in the SAME font as the website. Loaded once by the studio segment
 * layout (StudioRulesLayout). Absent (tests, other admin pages) = null, and
 * the canvas keeps its old look.
 */
import { createContext, useContext, type CSSProperties } from "react";
import { siteFontVars, type SiteFontIds } from "@/lib/cms/studio-fonts-core";

const Ctx = createContext<SiteFontIds | null>(null);

export function StudioSiteFontsProvider({ fonts, children }: { fonts: SiteFontIds; children: React.ReactNode }) {
  return <Ctx.Provider value={fonts}>{children}</Ctx.Provider>;
}

export function useStudioSiteFonts(): SiteFontIds | null {
  return useContext(Ctx);
}

/** The canvas container style: the website's `--font-heading` / `--font-body` (undefined = old look). */
export function useStudioFontVars(): CSSProperties | undefined {
  const f = useContext(Ctx);
  return f ? (siteFontVars(f) as unknown as CSSProperties) : undefined;
}
