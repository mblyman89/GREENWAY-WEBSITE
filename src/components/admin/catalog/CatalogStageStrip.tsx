import Link from "next/link";

/**
 * CatalogStageStrip — a compact, legible "where am I in the workflow" indicator
 * shown at the top of every catalog surface. It teaches the real product
 * lifecycle at a glance so a new employee instantly understands the sequence and
 * what comes next:
 *
 *   Receiving → Product Onboarding → Live Menu → Product Enrichment
 *
 * Every stage links to the page where that work happens (the Live Menu stage
 * links to Inventory — the live, on-hand, customer-facing stock). The `current`
 * stage is highlighted but stays clickable, so you can jump to any stage from
 * anywhere. This is purely navigational/orientational — it changes no data.
 */

export type CatalogStage = "intake" | "onboarding" | "menu" | "enrichment";

type StageDef = {
  key: CatalogStage;
  label: string;
  href: string | null;
  hint: string;
};

const STAGES: StageDef[] = [
  {
    key: "intake",
    label: "Receiving",
    href: "/admin/inventory/intake",
    hint: "Receive the transfer + COA",
  },
  {
    key: "onboarding",
    label: "Product Onboarding",
    href: "/admin/inventory/drafts",
    hint: "Approve new products onto the menu",
  },
  {
    key: "menu",
    label: "Live Menu",
    href: "/admin/inventory",
    hint: "Live, on-hand inventory that's customer-facing",
  },
  {
    key: "enrichment",
    label: "Product Enrichment",
    href: "/admin/products",
    hint: "Add photos, descriptions & tags",
  },
];

export function CatalogStageStrip({ current }: { current: CatalogStage }) {
  return (
    <nav
      aria-label="Catalog workflow"
      className="flex flex-wrap items-center gap-1 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs"
    >
      {STAGES.map((s, i) => {
        const isCurrent = s.key === current;
        const inner = (
          <span
            title={s.hint}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold transition",
              isCurrent
                ? "bg-[var(--admin-accent)] text-black"
                : s.href
                  ? "text-[var(--admin-text-muted)] hover:bg-white/10 hover:text-[var(--admin-text)]"
                  : "text-[var(--admin-text-faint)]",
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
            {s.href ? (
              // A stage with a destination is ALWAYS a link — even when it's the
              // current stage — so you can jump straight to it from anywhere
              // (e.g. the hub highlights "Live Menu" but still lets you open it).
              <Link href={s.href} aria-current={isCurrent ? "step" : undefined}>
                {inner}
              </Link>
            ) : (
              <span aria-current={isCurrent ? "step" : undefined}>{inner}</span>
            )}
            {i < STAGES.length - 1 && (
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
