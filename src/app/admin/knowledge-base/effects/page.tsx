/**
 * /admin/knowledge-base/effects
 *
 * READ-ONLY experiential-effect reference (KB hardening v2, Slice 1). Like
 * terpenes and cannabinoids, this is a curated reference set: each effect has a
 * factual, non-medical definition PLUS a house-voiced budtender blurb, so the AI
 * can speak about the experience accurately AND in Greenway's tone. The free-text
 * effects[] tags on products/strains resolve to these entries.
 *
 * COMPLIANCE (WA I-502): every card describes the SUBJECTIVE EXPERIENCE only
 * ("how it tends to feel"), never a health/therapeutic claim. Every slug is a
 * member of the code's ALLOWED_EFFECTS allow-list. A non-medical disclaimer
 * footer is always shown.
 *
 * Degrades to a pre-migration notice if kb_effects is empty (0086 not yet
 * applied) — nothing breaks before the owner applies the migration.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { listKbEffectsFull } from "@/lib/ai/kb/store";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

/** Loose experiential-family badge — color-coded, UI grouping only (not medical). */
function CategoryBadge({ value }: { value: string | null }) {
  const v = (value ?? "").toLowerCase();
  const style =
    v === "calming"
      ? { bg: "#15803d", label: "Calming" }
      : v === "uplifting"
        ? { bg: "#a16207", label: "Uplifting" }
        : v === "energizing"
          ? { bg: "#b45309", label: "Energizing" }
          : v === "character"
            ? { bg: "#6d28d9", label: "Character" }
            : { bg: "var(--admin-text-faint)", label: value ?? "—" };
  return (
    <span
      className="rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white"
      style={{ background: style.bg }}
    >
      {style.label}
    </span>
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) {
    return <span className="text-xs text-[var(--admin-text-faint)]">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <span
          key={it}
          className="inline-flex items-center rounded-full border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-1 text-sm text-[var(--admin-text)]"
        >
          {it}
        </span>
      ))}
    </div>
  );
}

export default async function KbEffectsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const effects = await listKbEffectsFull();

  return (
    <div>
      <AdminPageHeader
        title="Effects"
        subtitle="The experiential vocabulary used to ground product & strain copy — how it feels, in our voice, never medical"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Effects" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-5">
        <KbFlash msg={msg} error={error} />

        <p className="text-sm text-[var(--admin-text-muted)]">
          {effects.length} effect{effects.length === 1 ? "" : "s"} in the reference set.
          Each carries a plain, non-medical definition plus a house-voiced note, so copy about
          the experience stays accurate <em>and</em> on-brand. Free-text effect tags on products
          and strains resolve to these entries.
        </p>

        {effects.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No effects loaded yet. Apply migration{" "}
            <code className="rounded bg-[var(--admin-bg)] px-1.5 py-0.5 text-xs">
              0086_kb_effects.sql
            </code>{" "}
            then load the starter reference set from{" "}
            <Link href="/admin/knowledge-base/setup" className="text-[var(--admin-accent)] underline">
              Setup &amp; starter data
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {effects.map((e) => (
              <div
                key={e.id}
                className="flex flex-col overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
              >
                {/* Header bar */}
                <div className="flex items-center justify-between gap-2 border-b border-[var(--admin-border)] bg-[var(--admin-bg)] px-5 py-3.5">
                  <div className="min-w-0">
                    <span className="block text-xl font-bold text-[var(--admin-text)]">
                      {e.name}
                    </span>
                    <span className="block truncate text-xs text-[var(--admin-text-muted)]">
                      {e.slug}
                    </span>
                  </div>
                  <CategoryBadge value={e.category} />
                </div>

                <div className="flex flex-1 flex-col space-y-4 p-5">
                  {/* Definition (factual, non-medical) */}
                  {e.definition ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        What it means
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--admin-text)]">
                        {e.definition}
                      </p>
                    </div>
                  ) : null}

                  {/* House voice */}
                  {e.house_note ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        House voice
                      </h3>
                      <p className="mt-1.5 text-sm italic leading-relaxed text-[var(--admin-text-muted)]">
                        “{e.house_note}”
                      </p>
                    </div>
                  ) : null}

                  {/* Aliases */}
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                      Also matches
                    </h3>
                    <div className="mt-2">
                      <Chips items={e.aliases} />
                    </div>
                  </div>

                  {/* Sources */}
                  <div className="mt-auto pt-1">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                      Sources
                    </h3>
                    {e.sources.length ? (
                      <ul className="mt-1.5 space-y-1">
                        {e.sources.map((s) => (
                          <li key={s} className="truncate text-xs">
                            <a
                              href={s}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--admin-accent)] underline"
                            >
                              {s.replace(/^https?:\/\//, "")}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-[var(--admin-text-faint)]">—</span>
                    )}
                  </div>

                  {/* Provenance / status */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--admin-border)] pt-3">
                    {e.status && e.status !== "published" ? (
                      <span className="inline-block rounded-full bg-[var(--admin-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                        {e.status}
                      </span>
                    ) : null}
                    {e.source ? (
                      <span className="inline-block text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]">
                        source: {e.source}
                      </span>
                    ) : null}
                    {!e.active ? (
                      <span className="inline-block text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]">
                        inactive
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-[var(--admin-text-faint)]">
          Experiential reference only — describes how a product tends to <em>feel</em>, not a
          health, therapeutic, or medical claim. Effects vary by person, product, and dose.
          Cannabis products have intoxicating effects and are for adults 21+.
        </p>
      </div>
    </div>
  );
}
