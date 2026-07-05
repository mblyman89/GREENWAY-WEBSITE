/**
 * /admin/knowledge-base/formats
 *
 * READ-ONLY product-format / consumption-method reference (KB hardening v2,
 * Slice 2). Where "Effects" (Slice 1) tells the AI HOW a product feels, this
 * tells it WHAT the product is and HOW it's used: loose flower, pre-roll, vape
 * cart, shatter/wax, gummies, tincture, topical, and so on. Each card carries a
 * factual definition, a factual consumption description, a Washington-verified
 * potency band, and a house-voiced budtender note.
 *
 * COMPLIANCE (WA I-502): every card is FACTUAL/DESCRIPTIVE only — form, use, and
 * measured potency band. No medical/therapeutic claim, no dosing directive
 * ("take X"). Onset statements describe how ingestion differs from inhalation,
 * not a health benefit. A non-medical disclaimer footer is always shown.
 *
 * Degrades to a pre-migration notice if kb_product_formats is empty (0087 not
 * yet applied) — nothing breaks before the owner applies the migration.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { listKbProductFormatsFull } from "@/lib/ai/kb/store";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

/** Loose delivery-family badge — color-coded, UI grouping only (not medical). */
function CategoryBadge({ value }: { value: string | null }) {
  const v = (value ?? "").toLowerCase();
  const style =
    v === "inhaled"
      ? { bg: "#b45309", label: "Inhaled" }
      : v === "ingested"
        ? { bg: "#15803d", label: "Ingested" }
        : v === "topical"
          ? { bg: "#6d28d9", label: "Topical" }
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

export default async function KbFormatsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const formats = await listKbProductFormatsFull();

  return (
    <div>
      <AdminPageHeader
        title="Formats"
        subtitle="What each product is and how it's used — factual form, consumption, and WA potency, in our voice"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Formats" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-5">
        <KbFlash msg={msg} error={error} />

        <p className="text-sm text-[var(--admin-text-muted)]">
          {formats.length} product format{formats.length === 1 ? "" : "s"} in the reference set.
          Each carries a plain definition, how it&apos;s consumed, a Washington-verified potency band,
          and a house-voiced note — so copy about the <em>form</em> stays accurate <em>and</em>{" "}
          on-brand. This is the &ldquo;what it is&rdquo; layer that pairs with Effects (&ldquo;how
          it feels&rdquo;).
        </p>

        {formats.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No formats loaded yet. Apply migration{" "}
            <code className="rounded bg-[var(--admin-bg)] px-1.5 py-0.5 text-xs">
              0087_kb_product_formats.sql
            </code>{" "}
            then load the starter reference set from{" "}
            <Link href="/admin/knowledge-base/setup" className="text-[var(--admin-accent)] underline">
              Setup &amp; starter data
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {formats.map((f) => (
              <div
                key={f.id}
                className="flex flex-col overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
              >
                {/* Header bar */}
                <div className="flex items-center justify-between gap-2 border-b border-[var(--admin-border)] bg-[var(--admin-bg)] px-5 py-3.5">
                  <div className="min-w-0">
                    <span className="block text-xl font-bold text-[var(--admin-text)]">
                      {f.name}
                    </span>
                    <span className="block truncate text-xs text-[var(--admin-text-muted)]">
                      {f.slug}
                    </span>
                  </div>
                  <CategoryBadge value={f.category} />
                </div>

                <div className="flex flex-1 flex-col space-y-4 p-5">
                  {/* Definition (factual, non-medical) */}
                  {f.definition ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        What it is
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--admin-text)]">
                        {f.definition}
                      </p>
                    </div>
                  ) : null}

                  {/* Consumption (factual, not dosing) */}
                  {f.consumption ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        How it&apos;s used
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--admin-text)]">
                        {f.consumption}
                      </p>
                    </div>
                  ) : null}

                  {/* Potency band (WA market fact) */}
                  {f.potency_note ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        Typical potency (WA)
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--admin-text)]">
                        {f.potency_note}
                      </p>
                    </div>
                  ) : null}

                  {/* House voice */}
                  {f.house_note ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        House voice
                      </h3>
                      <p className="mt-1.5 text-sm italic leading-relaxed text-[var(--admin-text-muted)]">
                        &ldquo;{f.house_note}&rdquo;
                      </p>
                    </div>
                  ) : null}

                  {/* Aliases */}
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                      Also matches
                    </h3>
                    <div className="mt-2">
                      <Chips items={f.aliases} />
                    </div>
                  </div>

                  {/* Sources */}
                  <div className="mt-auto pt-1">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                      Sources
                    </h3>
                    {f.sources.length ? (
                      <ul className="mt-1.5 space-y-1">
                        {f.sources.map((s) => (
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
                    {f.status && f.status !== "published" ? (
                      <span className="inline-block rounded-full bg-[var(--admin-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                        {f.status}
                      </span>
                    ) : null}
                    {f.source ? (
                      <span className="inline-block text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]">
                        source: {f.source}
                      </span>
                    ) : null}
                    {!f.active ? (
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
          Format reference only — describes what a product <em>is</em>, how it&apos;s used, and its
          typical Washington potency band. Not dosing advice and not a health, therapeutic, or
          medical claim. Cannabis products have intoxicating effects and are for adults 21+.
        </p>
      </div>
    </div>
  );
}
