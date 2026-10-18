import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { helpersBySection } from "@/lib/admin/page-helpers-core";

/**
 * R73 S5 - Helpers. Every "How this works" guide that used to sit at the very
 * top of the website editors, Creative Studio and Merch Studio, on one page.
 * Each editor links here with "ⓘ How this page works" (#anchor = helper id).
 * Read-only wording from page-helpers-core; content.edit, same as the editors.
 */
export default async function HelpersPage() {
  await requirePermission("content.edit");
  const sections = helpersBySection();

  return (
    <div>
      <AdminPageHeader
        title="Helpers"
        subtitle="How each website editor and design studio works, in one place - so the editors themselves stay clear for designing."
        breadcrumbs={<Breadcrumbs items={[{ label: "Website" }, { label: "Helpers" }]} />}
      />
      <div className="mx-auto max-w-4xl space-y-8 px-5 py-6 sm:px-8">
        <nav aria-label="Helpers on this page" className="flex flex-wrap gap-2 text-xs">
          {sections.flatMap((g) =>
            g.items.map((h) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                className="admin-focus rounded-full border border-[var(--admin-border)] px-3 py-1 text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
              >
                {h.page}
              </a>
            )),
          )}
        </nav>

        {sections.map((g) => (
          <section key={g.section} className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">{g.section}</h2>
            {g.items.map((h) => (
              <article
                key={h.id}
                id={h.id}
                className="scroll-mt-20 rounded-xl border border-[var(--admin-accent)]/20 bg-[var(--admin-accent)]/[0.04] p-4 target:border-[var(--admin-accent)]/60"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--admin-accent)]">{h.title}</h3>
                  <Link href={h.href} className="admin-focus text-xs text-[var(--admin-text-muted)] hover:text-[var(--admin-text)] hover:underline">
                    Open {h.page} →
                  </Link>
                </div>
                <ol className="mt-3 space-y-2 text-sm leading-relaxed text-white/75">
                  {h.steps.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent)]/15 text-xs font-bold text-[var(--admin-accent)]">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                {h.notes.length > 0 ? (
                  <div className="mt-3 space-y-2 text-sm leading-relaxed text-white/65">
                    {h.notes.map((n, i) => (
                      <p key={i}>{n}</p>
                    ))}
                  </div>
                ) : null}
                {h.links && h.links.length > 0 ? (
                  <p className="mt-3 flex flex-wrap gap-3 text-xs">
                    {h.links.map((l) => (
                      <Link key={l.href} href={l.href} className="text-[var(--admin-accent)] hover:underline">
                        {l.label} →
                      </Link>
                    ))}
                  </p>
                ) : null}
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
