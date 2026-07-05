/**
 * src/components/admin/nav-glyphs.tsx
 *
 * Custom, hand-authored SVG glyphs for the admin top-navigation. These replace
 * emoji for the items where the owner wanted bespoke, on-brand marks.
 *
 * WHY SVG (not emoji or PNG):
 *  - Crisp at the tiny nav size (~14–16px) and at any zoom.
 *  - `fill="currentColor"` means each glyph automatically matches the nav text
 *    color — so it looks right in both the muted and the green "active" state,
 *    and works on light OR dark chrome with zero extra assets.
 *  - Zero network cost (inline), no icon-font dependency.
 *
 * To add a new custom glyph: draw a path on a 24×24 viewBox, add it to
 * NAV_GLYPHS below, then set `glyph: "<key>"` on the matching item in
 * admin-nav-data.ts. The renderer (NavGlyph) falls back to the emoji `icon`
 * string when no `glyph` is set, so everything stays backward compatible.
 */
import type { AdminNavItem } from "./admin-nav-data";

type GlyphProps = { className?: string; title?: string };

/** Shared wrapper so every glyph has identical sizing + a11y defaults. */
function Svg({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      fill="currentColor"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/**
 * Cannabis (pot) leaf — a clean, hand-authored 7-leaflet palmate silhouette
 * inspired by the owner's uploaded reference (IMG_1060).
 *
 * Design note: rather than tracing a photo (which packs hundreds of tiny
 * serrations that turn into visual noise / a "starburst" blob at the ~12–16px
 * nav size), each of the seven leaflets is drawn as a smooth lance/teardrop
 * with quadratic Béziers. The palmate fan silhouette — one tall center, three
 * mirrored pairs stepping down to a near-horizontal lower pair — is what makes
 * it read unmistakably as cannabis, and the smooth edges stay crisp when the
 * glyph is scaled down. Solid fill (currentColor) so it tints with the nav
 * state (muted / green-active) and works on light or dark chrome.
 */
export function PotLeafGlyph({ className, title }: GlyphProps) {
  return (
    <Svg className={className} title={title}>
      <path
        d="M12.00 20.20Q14.13 18.48 15.05 13.32Q13.28 7.82 12.00 3.00Q10.72 7.82 8.95 13.32Q9.87 18.48 12.00 20.20ZM12.00 20.20Q14.45 19.95 17.35 16.64Q18.22 11.82 19.20 7.73Q16.15 10.62 12.41 13.79Q10.99 17.96 12.00 20.20ZM12.00 20.20Q13.01 17.96 11.59 13.79Q7.85 10.62 4.80 7.73Q5.78 11.82 6.65 16.64Q9.55 19.95 12.00 20.20ZM12.00 20.20Q13.88 21.18 17.22 20.13Q19.64 17.02 21.87 14.50Q18.57 15.17 14.67 15.71Q12.09 18.08 12.00 20.20ZM12.00 20.20Q11.91 18.08 9.33 15.71Q5.43 15.17 2.13 14.50Q4.36 17.02 6.78 20.13Q10.12 21.18 12.00 20.20ZM12.00 20.20Q12.79 21.70 15.28 22.42Q18.01 21.29 20.39 20.49Q18.08 19.53 15.43 18.22Q12.89 18.76 12.00 20.20ZM12.00 20.20Q11.11 18.76 8.57 18.22Q5.92 19.53 3.61 20.49Q5.99 21.29 8.72 22.42Q11.21 21.70 12.00 20.20ZM11.50 19.90L12.50 19.90L12.32 23.2L11.68 23.2Z"
      />
    </Svg>
  );
}

/**
 * Bong (round-bottom water pipe) — traced from the owner's uploaded reference
 * (IMG_1061): spherical base with a water line, a straight neck, a mouthpiece
 * lip at the top, and an angled downstem on the upper-left. FILLED variant
 * (reads as the black/"dark" version in the reference).
 */
export function BongGlyph({ className, title }: GlyphProps) {
  return (
    <Svg className={className} title={title}>
      {/* mouthpiece lip */}
      <rect x="8.7" y="1.8" width="6.6" height="2.4" rx="0.6" />
      {/* neck */}
      <rect x="10.2" y="4.2" width="3.6" height="6.4" />
      {/* angled downstem on the upper-left */}
      <path d="M10.4 8.6 6.7 6.9c-.5-.2-1 0-1.2.5s0 1 .5 1.2l3.6 1.7c.3-.6.5-1.1.8-1.7z" />
      {/* round water-chamber body */}
      <circle cx="12" cy="16" r="6" />
      {/* water line (negative space to suggest the fill line) */}
      <path
        d="M6.6 14.6c1.5.9 3 .5 4.5.1s3.3-.9 5.1.2c.4.2.9.4 1.3.4.2-.6.3-1.2.4-1.8-1.7-.9-3.4-.5-4.9-.1s-3 .8-4.6-.1c-.6-.4-1.2-.7-1.9-.7.1.7.3 1.3.6 1.8z"
        fill="#fff"
        fillOpacity="0.85"
      />
    </Svg>
  );
}

/**
 * Bong — OUTLINE variant (reads as the white/"light" version in the reference,
 * i.e. a stroked line-drawing). Same silhouette, drawn as strokes so it looks
 * lighter and airier. Uses currentColor for the stroke.
 */
export function BongOutlineGlyph({ className, title }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {title ? <title>{title}</title> : null}
      {/* mouthpiece lip */}
      <rect x="8.9" y="2.2" width="6.2" height="2.2" rx="0.6" />
      {/* neck */}
      <path d="M10.6 4.4v6.2M13.4 4.4v6.2" />
      {/* angled downstem */}
      <path d="M10.2 8.8 6.4 7.1" />
      {/* round water chamber */}
      <circle cx="12" cy="16" r="5.9" />
      {/* water line */}
      <path d="M6.6 14.7c1.6.9 3.2.5 4.8.1s3.2-.8 4.8.1" />
    </svg>
  );
}

/** Registry of custom glyph keys → components. */
export const NAV_GLYPHS: Record<
  string,
  (props: GlyphProps) => React.ReactElement
> = {
  "pot-leaf": PotLeafGlyph,
  bong: BongGlyph,
  "bong-outline": BongOutlineGlyph,
};

export type NavGlyphKey = keyof typeof NAV_GLYPHS;

/**
 * Renders an item's icon: a custom SVG glyph when `item.glyph` is set,
 * otherwise the emoji/glyph string in `item.icon` (backward compatible).
 */
export function NavGlyph({
  item,
  className,
}: {
  item: Pick<AdminNavItem, "icon" | "glyph" | "label">;
  className?: string;
}) {
  if (item.glyph && NAV_GLYPHS[item.glyph]) {
    const Glyph = NAV_GLYPHS[item.glyph];
    return <Glyph className={className} title={item.label} />;
  }
  return <>{item.icon}</>;
}
