import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { HelpPanel } from "@/components/admin/ux/HelpPanel";
import { Breadcrumbs } from "@/components/admin/ux/Breadcrumbs";
import { getKbCounts, countKbProductDrafts } from "@/lib/ai/kb/store";
import { countBrands } from "@/lib/vendors/store";
import { getKbHealth } from "@/lib/ai/kb/health";
import { KbNavCard } from "./KbNavCard";
import { KbFlash } from "./KbFlash";
import { KbHealthStrip } from "./KbHealthStrip";

export const dynamic = "force-dynamic";

/**
 * Knowledge Base — command center hub.
 *
 * Designed with progressive disclosure (NN/g): the hub shows only the few most
 * important things — a health strip and a small set of clearly-labelled doors
 * into focused sub-pages. Every heavy editor (strains, brands, images, notes,
 * compliance) lives behind its own route so this screen stays clean and fast to
 * scan. This is the PIM "single repository" surfaced as a wayfinding console.
 */
export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const [counts, draftReviews, health, brandCount] = await Promise.all([
    getKbCounts(),
    countKbProductDrafts(),
    getKbHealth(),
    countBrands(),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Knowledge Base"
        subtitle="The single source of truth the AI writes from — your data command center"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Product Intake", href: "/admin/catalog" },
              { label: "Knowledge Base" },
            ]}
          />
        }
        help={
          <HelpPanel id="kb-help" title="What is the knowledge base?">
            <p>
              Your point-of-sale data is thin — often just a product name and a category. To write
              genuinely <strong>expert, accurate</strong> descriptions, the AI needs real facts to work
              from. The knowledge base is that source of truth: curated <em>strains</em>,{" "}
              <em>terpenes</em>, <em>product categories</em>, and <em>brand notes</em>.
            </p>
            <p className="mt-2">
              Pick an area below to manage it. Everything here is <strong>sensory and factual only</strong>{" "}
              — aroma, flavor, format, lineage — because Washington advertising rules don&apos;t allow
              health or effect claims.
            </p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8 space-y-6">
        <div>
          <Link
            href="/admin/catalog"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Product Intake Hub
          </Link>
        </div>
        <KbFlash msg={msg} error={error} />

        {!counts.migrated ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-4 text-sm text-[var(--admin-text)]">
            <p className="font-medium">The knowledge base isn&apos;t fully set up yet.</p>
            <p className="mt-1 text-[var(--admin-text-muted)]">
              Once the one-time database setup is finished, this page will let you seed and manage the
              AI&apos;s reference facts. Start at{" "}
              <a href="/admin/knowledge-base/setup" className="text-[var(--admin-accent)] underline">
                Setup
              </a>
              .
            </p>
          </div>
        ) : null}

        {/* Golden-record health signals (MDM: Completeness + Trust). */}
        {counts.migrated ? (
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Data health
            </h2>
            <KbHealthStrip health={health} />
          </div>
        ) : null}

        {/* Needs attention — surfaces the golden-record review queue first (MDM human-in-the-loop). */}
        {draftReviews > 0 ? (
          <a
            href="/admin/knowledge-base/review"
            className="flex items-center justify-between rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-5 py-4 text-sm text-[var(--admin-text)] transition-colors hover:border-[var(--admin-orange)]"
          >
            <span>
              <strong>{draftReviews}</strong> product write-back{draftReviews === 1 ? "" : "s"} awaiting
              your review before they become published facts.
            </span>
            <span className="font-medium text-[var(--admin-orange)]">Review →</span>
          </a>
        ) : null}

        {/* Entity navigator — the small set of doors (progressive disclosure). */}
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Manage your data
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KbNavCard
              href="/admin/knowledge-base/master-data"
              title="Master data"
              description="Vendor → Brand → Product hierarchy and where data is thin."
              accent="green"
            />
            <KbNavCard
              href="/admin/knowledge-base/library"
              title="Strains & categories"
              description="Lineage, aroma, flavor, and the right words per product format."
              count={counts.strains}
              accent="green"
            />
            <KbNavCard
              href="/admin/knowledge-base/brands"
              title="Brand facts"
              description="What each brand is known for, so copy matches their voice."
              count={brandCount}
              accent="gold"
            />
            <KbNavCard
              href="/admin/knowledge-base/images"
              title="Fallback images"
              description="Substitute images so product cards are never blank."
              accent="muted"
            />
            <KbNavCard
              href="/admin/knowledge-base/compliance"
              title="Compliance guardrails"
              description="Banned phrases checked on top of the built-in WA rules."
              count={counts.banned}
              accent="orange"
            />
            <KbNavCard
              href="/admin/knowledge-base/pipeline"
              title="Data pipeline"
              description="Bronze intake → Silver review → Gold published. Approve write-backs before they publish."
              count={draftReviews}
              accent="orange"
              badge={draftReviews > 0 ? `${draftReviews} to review` : null}
            />
            <KbNavCard
              href="/admin/knowledge-base/terpenes"
              title="Terpenes"
              description="The aroma/flavor map used to describe every strain. Reference only."
              count={counts.terpenes}
              accent="muted"
            />
            <KbNavCard
              href="/admin/knowledge-base/cannabinoids"
              title="Cannabinoids"
              description="Research-backed compound facts (psychoactive vs non-psychoactive, acidic precursors). Grounds potency & copy. Reference only."
              count={counts.cannabinoids}
              accent="muted"
            />
            <KbNavCard
              href="/admin/knowledge-base/effects"
              title="Effects"
              description="How each product tends to feel — plain, non-medical definitions plus our house voice. Grounds experiential copy. Reference only."
              count={counts.effects}
              accent="muted"
            />
            <KbNavCard
              href="/admin/knowledge-base/formats"
              title="Formats"
              description="What each product is and how it's used — flower, vape, dabs, edibles & more, with WA-verified potency and our house voice. Reference only."
              count={counts.productFormats}
              accent="muted"
            />
            <KbNavCard
              href="/admin/knowledge-base/rules"
              title="WA rules & safety"
              description="Know-before-you-go facts we surface helpfully — 21+, limits, no public use, don't drive high, edibles start-low-go-slow. Education, not enforcement."
              count={counts.complianceRules}
              accent="orange"
            />
            <KbNavCard
              href="/admin/inventory/noncannabis"
              title="Non-cannabis catalog"
              description="Glass, accessories, papers & devices — tracked with smart SKUs and connected to the KB."
              count={counts.nonCannabis}
              accent="muted"
            />
            <KbNavCard
              href="/admin/knowledge-base/setup"
              title="Setup & starter data"
              description="Load or refresh the curated baseline of strains, terpenes, and vocabulary."
              accent="muted"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
