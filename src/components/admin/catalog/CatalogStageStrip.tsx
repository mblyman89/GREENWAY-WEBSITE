import Link from "next/link";
import {
  JOURNEY_STAGES,
  resolveStageKey,
  type JourneyStageKey,
} from "@/lib/catalog/journey-core";

/**
 * CatalogStageStrip — the compact "where am I in the workflow" indicator shown
 * at the top of every Product Intake surface.
 *
 * W1: it now renders the ONE canonical 8-stage journey from journey-core
 * (Discover → Order → Receive → Onboard → Publish → Enrich → Master → Pay)
 * instead of a private 4-stage subset, so every page teaches the same mental
 * model. Every stage is a link to where that work happens; the current stage
 * is highlighted but stays clickable. Purely navigational — changes no data.
 *
 * Accepts canonical keys AND the legacy keys ("intake", "onboarding", "menu",
 * "enrichment") so existing call sites keep working unchanged.
 */

export type CatalogStage =
  | JourneyStageKey
  | "intake"
  | "onboarding"
  | "menu"
  | "enrichment";

export function CatalogStageStrip({ current }: { current?: CatalogStage }) {
  // No `current` (e.g. on the Catalog Hub, which is the map itself): render
  // the journey with nothing highlighted.
  const currentKey = current ? resolveStageKey(current) : null;
  return (
    <nav
      aria-label="Product Intake journey"
      className="flex flex-wrap items-center gap-1 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs"
    >
      {JOURNEY_STAGES.map((s, i) => {
        const isCurrent = s.key === currentKey;
        const inner = (
          <span
            title={s.hint}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition",
              isCurrent
                ? "bg-[var(--admin-accent)] text-black"
                : "text-[var(--admin-text-muted)] hover:bg-white/10 hover:text-[var(--admin-text)]",
            ].join(" ")}
          >
            <span
              aria-hidden
              className={[
                "grid h-4 w-4 place-items-center rounded-full text-[0.6rem]",
                isCurrent
                  ? "bg-black/25 text-black"
                  : "bg-[var(--admin-surface-2)] text-[var(--admin-text-faint)]",
              ].join(" ")}
            >
              {i + 1}
            </span>
            {s.label}
          </span>
        );
        return (
          <span key={s.key} className="inline-flex items-center gap-1">
            {/* Every stage is ALWAYS a link — even the current one — so you can
                jump straight to any stage from anywhere. */}
            <Link href={s.href} aria-current={isCurrent ? "step" : undefined}>
              {inner}
            </Link>
            {i < JOURNEY_STAGES.length - 1 && (
              <span aria-hidden className="px-0.5 text-[var(--admin-text-faint)]">
                →
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
