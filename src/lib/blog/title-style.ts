/**
 * src/lib/blog/title-style.ts
 *
 * Turns a post's bounded title-typography choices (font id / size token /
 * optional hex color) into a concrete inline style + size className the public
 * card and article hero apply. Bounded by design so editor output stays
 * on-brand and never breaks the layout.
 */
import type { CSSProperties } from "react";
import { resolveFont } from "@/lib/cms/fonts";

export type TitleSize = "sm" | "md" | "lg" | "xl";

export const TITLE_SIZE_OPTIONS: { id: TitleSize; label: string }[] = [
  { id: "sm", label: "Small" },
  { id: "md", label: "Medium (default)" },
  { id: "lg", label: "Large" },
  { id: "xl", label: "Extra large" },
];

/** Tailwind size classes for the BLOG CARD title (responsive). */
const CARD_SIZE_CLASS: Record<TitleSize, string> = {
  sm: "text-xl md:text-2xl",
  md: "text-2xl md:text-[1.7rem]",
  lg: "text-[1.7rem] md:text-3xl",
  xl: "text-3xl md:text-4xl",
};

/** Tailwind size classes for the ARTICLE HERO title (responsive, larger). */
const HERO_SIZE_CLASS: Record<TitleSize, string> = {
  sm: "text-2xl md:text-4xl",
  md: "text-3xl md:text-5xl lg:text-6xl",
  lg: "text-4xl md:text-6xl lg:text-7xl",
  xl: "text-5xl md:text-7xl lg:text-8xl",
};

function normalizeSize(size: string | null | undefined): TitleSize {
  return size === "sm" || size === "lg" || size === "xl" ? size : "md";
}

/** Valid #rgb / #rrggbb hex, else null (so a bad value can't inject CSS). */
function safeHex(color: string | null | undefined): string | null {
  if (!color) return null;
  const c = color.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : null;
}

export type ResolvedTitleStyle = {
  className: string;
  style: CSSProperties;
};

/**
 * @param ctx "card" or "hero" — picks the matching responsive size scale.
 */
export function resolveTitleStyle(
  titleStyle: { font: string | null; size: string; color: string | null } | undefined,
  ctx: "card" | "hero",
): ResolvedTitleStyle {
  const size = normalizeSize(titleStyle?.size);
  const sizeClass = (ctx === "hero" ? HERO_SIZE_CLASS : CARD_SIZE_CLASS)[size];

  const style: CSSProperties = {};
  // Font: only apply when an explicit, real (non-system, non-inherit) font is set.
  const fontId = titleStyle?.font;
  if (fontId && fontId !== "inherit" && fontId !== "system") {
    const font = resolveFont(fontId, "system");
    if (font.stack) style.fontFamily = font.stack;
  }
  const color = safeHex(titleStyle?.color);
  if (color) style.color = color;

  return { className: sizeClass, style };
}
