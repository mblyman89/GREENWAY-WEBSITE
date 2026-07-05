/**
 * /admin/knowledge-base/cannabinoids
 *
 * READ-ONLY cannabinoid reference (Slice C). Like terpenes, this is a fixed,
 * research-backed reference set the owner does not hand-edit; seeing each
 * compound's factual chemistry/pharmacology profile is useful when curating
 * product and strain copy and when reading COA potency.
 *
 * COMPLIANCE (WA I-502): every card states FACTUAL chemistry only —
 * psychoactive vs non-psychoactive vs mildly-psychoactive, and the
 * acidic-precursor → decarboxylation relationship. NO medical claims
 * ("treats/helps/relieves"). A non-medical disclaimer footer is always shown.
 *
 * Degrades to a pre-migration notice if kb_cannabinoids is empty (0083 not yet
 * applied) — nothing breaks before the owner applies the migration.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { listKbCannabinoidsFull } from "@/lib/ai/kb/store";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

/** Factual psychoactivity badge — color-coded, no medical language. */
function IntoxicationBadge({ value }: { value: string | null }) {
  const v = (value ?? "").toLowerCase();
  const style =
    v === "psychoactive"
      ? { bg: "#b45309", label: "Psychoactive" }
      : v === "mildly-psychoactive"
        ? { bg: "#a16207", label: "Mildly psychoactive" }
        : v === "non-psychoactive"
          ? { bg: "#15803d", label: "Non-psychoactive" }
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

export default async function KbCannabinoidsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const cannabinoids = await listKbCannabinoidsFull();

  return (
    <div>
      <AdminPageHeader
        title="Cannabinoids"
        subtitle="The compound reference used to ground potency & product copy — factual chemistry only"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Cannabinoids" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-5">
        <KbFlash msg={msg} error={error} />

        <p className="text-sm text-[var(--admin-text-muted)]">
          {cannabinoids.length} cannabinoid{cannabinoids.length === 1 ? "" : "s"} in the
          reference set. These are read-only, research-backed compound facts — they power
          the chemistry language (psychoactive vs non-psychoactive, acidic precursor →
          decarboxylation) used across the knowledge base and alongside COA potency.
        </p>

        {cannabinoids.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No cannabinoids loaded yet. Apply migration{" "}
            <code className="rounded bg-[var(--admin-bg)] px-1.5 py-0.5 text-xs">
              0083_kb_cannabinoids.sql
            </code>{" "}
            then load the starter reference set from{" "}
            <Link href="/admin/knowledge-base/setup" className="text-[var(--admin-accent)] underline">
              Setup &amp; starter data
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cannabinoids.map((c) => (
              <div
                key={c.id}
                className="flex flex-col overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
              >
                {/* Header bar */}
                <div className="flex items-center justify-between gap-2 border-b border-[var(--admin-border)] bg-[var(--admin-bg)] px-5 py-3.5">
                  <div className="min-w-0">
                    <span className="block text-xl font-bold text-[var(--admin-text)]">
                      {c.name}
                    </span>
                    {c.full_name ? (
                      <span className="block truncate text-xs text-[var(--admin-text-muted)]">
                        {c.full_name}
                      </span>
                    ) : null}
                  </div>
                  <IntoxicationBadge value={c.intoxication} />
                </div>

                <div className="flex flex-1 flex-col space-y-4 p-5">
                  {/* Chemistry: acidic precursor / decarboxylation */}
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                      Chemistry
                    </h3>
                    <p className="mt-1.5 text-sm text-[var(--admin-text)]">
                      {c.is_acidic ? (
                        <>
                          Acidic precursor form
                          {c.decarbs_to ? (
                            <>
                              {" "}— decarboxylates to{" "}
                              <span className="font-semibold uppercase">{c.decarbs_to}</span>
                            </>
                          ) : null}
                          .
                        </>
                      ) : c.decarbs_to ? (
                        <>
                          Decarboxylated form (from{" "}
                          <span className="font-semibold uppercase">{c.decarbs_to}</span>).
                        </>
                      ) : (
                        <span className="text-[var(--admin-text-muted)]">
                          Neutral (decarboxylated) form.
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Character notes */}
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                      Notes
                    </h3>
                    <div className="mt-2">
                      <Chips items={c.character_notes} />
                    </div>
                  </div>

                  {/* Description */}
                  {c.description ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        About
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--admin-text)]">
                        {c.description}
                      </p>
                    </div>
                  ) : null}

                  {/* Also found in */}
                  {c.also_found_in ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        Typically seen in
                      </h3>
                      <p className="mt-1.5 text-sm text-[var(--admin-text)]">
                        {c.also_found_in}
                      </p>
                    </div>
                  ) : null}

                  {/* Sources */}
                  <div className="mt-auto pt-1">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                      Sources
                    </h3>
                    {c.sources.length ? (
                      <ul className="mt-1.5 space-y-1">
                        {c.sources.map((s) => (
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

                  {!c.active ? (
                    <span className="inline-block text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                      inactive
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-[var(--admin-text-faint)]">
          Chemistry &amp; pharmacology reference only — describes what each compound is and
          whether it is psychoactive, not a health, therapeutic, or medical claim. Cannabis
          products have intoxicating effects and are for adults 21+.
        </p>
      </div>
    </div>
  );
}
