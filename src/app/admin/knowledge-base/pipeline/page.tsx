/**
 * /admin/knowledge-base/pipeline
 *
 * The KB DATA PIPELINE, made explicit (Slice 6).
 *
 * Medallion architecture (Databricks/Profisee): data flows through quality
 * tiers before it is trusted.
 *
 *   BRONZE  intake     raw product enrichment + accepted AI suggestions are
 *                      staged into kb_products as DRAFTS (nothing authoritative).
 *   SILVER  review     a human validates each staged record in the review inbox
 *                      — the governance gate (drafts-only rule).
 *   GOLD    published  validated, active golden records the read side trusts
 *                      (menu, product pages, AI grounding).
 *
 * This page visualizes the three stages with live counts and links straight to
 * the review inbox (the Silver→Gold gate). Read-only + defensive: degrades to a
 * pre-migration notice if 0071 is not applied.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { getKbPipelineCounts } from "@/lib/ai/kb/store";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

type Stage = {
  tier: "Bronze" | "Silver" | "Gold";
  title: string;
  what: string;
  count: number;
  countLabel: string;
  accent: string;
  soft: string;
};

function StageCard({ stage }: { stage: Stage }) {
  return (
    <div
      className="relative flex-1 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
      style={{ boxShadow: "var(--admin-shadow-sm)" }}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-[var(--admin-radius-lg)]"
        style={{ background: stage.accent }}
      />
      <div
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ background: stage.soft, color: stage.accent }}
      >
        {stage.tier}
      </div>
      <div className="mt-2 text-sm font-semibold text-[var(--admin-text)]">{stage.title}</div>
      <div className="mt-0.5 text-xs text-[var(--admin-text-muted)]">{stage.what}</div>
      <div className="mt-3 text-3xl font-bold tabular-nums text-[var(--admin-text)]">
        {stage.count.toLocaleString()}
      </div>
      <div className="text-[11px] text-[var(--admin-text-faint)]">{stage.countLabel}</div>
    </div>
  );
}

export default async function KbPipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const counts = await getKbPipelineCounts();

  const stages: Stage[] = [
    {
      tier: "Bronze",
      title: "Intake",
      what: "Enrichment & accepted AI suggestions staged as drafts.",
      count: counts.draft,
      countLabel: counts.draft === 1 ? "draft awaiting review" : "drafts awaiting review",
      accent: "var(--admin-orange)",
      soft: "var(--admin-orange-soft)",
    },
    {
      tier: "Silver",
      title: "Review inbox",
      what: "You validate each staged record — the governance gate.",
      count: counts.draft,
      countLabel: "in the queue now",
      accent: "var(--admin-gold)",
      soft: "var(--admin-gold-soft)",
    },
    {
      tier: "Gold",
      title: "Published",
      what: "Trusted golden records the menu & AI read from.",
      count: counts.published,
      countLabel: counts.published === 1 ? "published record" : "published records",
      accent: "var(--admin-accent)",
      soft: "var(--admin-accent-soft)",
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Data pipeline"
        subtitle="How product data becomes a trusted golden record — Bronze intake → Silver review → Gold published"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Data pipeline" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-6">
        <KbFlash msg={msg} error={error} />

        {!counts.migrated ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] p-4 text-sm text-[var(--admin-text)]">
            The per-product table isn&apos;t available yet. Apply migration 0071 to
            turn on the write-back pipeline, then enrichment and accepted AI
            suggestions will flow through these stages.
          </div>
        ) : null}

        {/* Medallion flow */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          {stages.map((s, i) => (
            <div key={s.tier} className="flex flex-1 items-stretch gap-3">
              <StageCard stage={s} />
              {i < stages.length - 1 ? (
                <div
                  aria-hidden
                  className="hidden self-center text-2xl text-[var(--admin-text-faint)] sm:block"
                >
                  &rarr;
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {/* The gate */}
        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--admin-text)]">
                Silver &rarr; Gold: the review inbox
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-[var(--admin-text-muted)]">
                Nothing is authoritative until you publish it. Open the inbox to
                validate staged records — you&apos;ll see each record&apos;s quality
                score and where its data came from before you decide.
              </p>
            </div>
            <Button href="/admin/knowledge-base/review" variant="primary">
              Open review inbox{counts.draft > 0 ? ` (${counts.draft})` : ""}
            </Button>
          </div>
        </section>

        {counts.archived > 0 ? (
          <p className="text-xs text-[var(--admin-text-faint)]">
            {counts.archived.toLocaleString()} record
            {counts.archived === 1 ? " has" : "s have"} been archived (discarded or
            superseded) and kept for audit.
          </p>
        ) : null}
      </div>
    </div>
  );
}
