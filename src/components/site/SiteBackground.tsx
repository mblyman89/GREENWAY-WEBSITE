import { SITE_BG_LAYER_CLASS } from "@/lib/ui/site-background-core";

/**
 * SiteBackground (SLICE T-313)
 *
 * The shared, site-wide textured backdrop. Renders a single fixed, behind-
 * everything layer that paints the canonical brand gradient (orange + gold +
 * greenway green radials over black) plus the shared `.noise-overlay` grain —
 * exactly the textured look the "good" pages (About, FAQ, Blog, …) already had.
 *
 * Every customer-facing page mounts this once, near the top of its <main>, so
 * shoppers see a consistent background as they move between Home, Shop,
 * Locations, Vendors and the rest. It is server-safe (no props, no client
 * state), click-through (`pointer-events-none`) and sits at `-z-10` so it never
 * intercepts clicks or covers content.
 *
 * The exact class strings live in the pinned pure core
 * (src/lib/ui/site-background-core.ts) so the recipe can't silently drift.
 */
export function SiteBackground() {
  return (
    <div aria-hidden className={SITE_BG_LAYER_CLASS}>
      <div className="noise-overlay" />
    </div>
  );
}
