import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Card, CardHeader, Section, Button, Badge } from "@/components/admin/ui";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { getCatalogHub } from "@/lib/catalog/hub";

export const dynamic = "force-dynamic";

export default async function CatalogHubPage() {
  await requirePermission("products.enrich");
  const hub = await getCatalogHub();

  if (!hub.configured) {
    return (
      <div>
        <AdminPageHeader title="Catalog" subtitle="Your one-stop product workflow hub." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once setup is complete, your
            catalog overview will appear here.
          </div>
        </div>
      </div>
    );
  }

  const { onboarding, enrichment, mastering } = hub;

  return (
    <div>
      <AdminPageHeader
        title="Catalog"
        subtitle="Your one-stop hub for the whole product workflow — from onboarding new products to enriching what's on the menu."
        breadcrumbs={<Breadcrumbs items={[{ label: "Catalog" }]} />}
        help={
          <HelpPanel
            id="catalog-hub"
            title="How the catalog workflow fits together"
            steps={[
              "Vendor Intake: you receive a transfer + COA; the system names and prices lots.",
              "Product Onboarding: new products (not yet on the menu) wait here for you to approve them onto it.",
              "Live Menu: once approved and published, products are customer-facing.",
              "Product Enrichment: add photos, descriptions, and tags to make live products shine.",
            ]}
          >
            <p>
              Two lifecycles meet at the menu: <strong>Onboarding</strong> decides
              what gets ON the menu; <strong>Enrichment</strong> makes what&apos;s
              already on it look great. <strong>Product Mastering</strong> tidies
              the menu by grouping the same product&apos;s sizes into one card.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <CatalogStageStrip current="menu" />

        {!hub.hasPublishedMenu && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm text-[var(--admin-text-muted)]">
            No published menu yet. Import and publish a menu version under{" "}
            <Link href="/admin/menu-imports" className="text-[var(--admin-accent)] hover:underline">
              Menu Imports
            </Link>
            , then enrichment metrics will appear here.
          </div>
        )}

        {/* At-a-glance across the whole catalog */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="New products to review"
            value={onboarding.needsReview}
            hint="in Product Onboarding"
            accent={onboarding.needsReview > 0 ? "gold" : "muted"}
            href="/admin/inventory/drafts"
          />
          <StatCard
            label="Missing description"
            value={enrichment.missingDescription}
            hint="on the live menu"
            accent={enrichment.missingDescription > 0 ? "orange" : "green"}
            href="/admin/products?gap=description"
          />
          <StatCard
            label="Missing image"
            value={enrichment.missingImage}
            hint="on the live menu"
            accent={enrichment.missingImage > 0 ? "orange" : "green"}
            href="/admin/products?gap=image"
          />
          <StatCard
            label="Grouping suggestions"
            value={mastering.pendingSuggestions}
            hint="in Product Mastering"
            accent={mastering.pendingSuggestions > 0 ? "gold" : "muted"}
            href="/admin/products/masters?tab=suggestions"
          />
        </div>

        {/* The three workflow surfaces */}
        <Section
          title="Where do you want to work?"
          description="Each surface owns one job in the product workflow."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Onboarding */}
            <Card accent="gold">
              <CardHeader
                title="Product Onboarding"
                subtitle="Approve new products onto the menu"
              />
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                When you receive a lot that isn&apos;t on the live menu yet, the
                system drafts the product from the transfer + COA. Review it, set a
                price (guarded by the cost floor), and approve it onto the menu.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Badge tone={onboarding.needsReview > 0 ? "gold" : "neutral"}>
                  {onboarding.needsReview} to review
                </Badge>
                <Badge tone="green">{onboarding.approved} approved</Badge>
              </div>
              <div className="mt-4">
                <Button href="/admin/inventory/drafts" size="sm">
                  Open onboarding →
                </Button>
              </div>
            </Card>

            {/* Enrichment */}
            <Card accent="green">
              <CardHeader
                title="Product Enrichment"
                subtitle="Make live products shine online"
              />
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                For products already on the menu — add photos, descriptions, tags,
                and staff picks (with AI-drafted copy you approve). Price and stock
                stay POS-controlled.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="green">{enrichment.enrichedLive} enriched & live</Badge>
                <Badge tone={enrichment.avgCompletenessPct >= 80 ? "green" : "gold"}>
                  {enrichment.avgCompletenessPct}% avg complete
                </Badge>
              </div>
              <div className="mt-4">
                <Button href="/admin/products" size="sm">
                  Open enrichment →
                </Button>
              </div>
            </Card>

            {/* Mastering */}
            <Card accent="orange">
              <CardHeader
                title="Product Mastering"
                subtitle="Group sizes into one clean card"
              />
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                Combine menu items that are really one product at different sizes or
                forms into a single card, so your menu reads clean. AI suggests
                groupings; you decide.
              </p>
              <div className="mt-3">
                <Badge tone={mastering.pendingSuggestions > 0 ? "gold" : "neutral"}>
                  {mastering.pendingSuggestions} suggestions
                </Badge>
              </div>
              <div className="mt-4">
                <Button href="/admin/products/masters" size="sm">
                  Open mastering →
                </Button>
              </div>
            </Card>
          </div>
        </Section>

        {/* Related surfaces */}
        <Section title="Related" description="The upstream and reference surfaces that feed the catalog.">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card interactive href="/admin/inventory/intake" padding="sm">
              <div className="text-sm font-semibold text-[var(--admin-text)]">📥 Vendor Intake</div>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Receive transfers + COAs (start of the chain).</p>
            </Card>
            <Card interactive href="/admin/menu-imports" padding="sm">
              <div className="text-sm font-semibold text-[var(--admin-text)]">⬆ Menu Imports</div>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Publish the live menu customers see.</p>
            </Card>
            <Card interactive href="/admin/knowledge-base" padding="sm">
              <div className="text-sm font-semibold text-[var(--admin-text)]">📚 Knowledge Base</div>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Reference facts that power good enrichment.</p>
            </Card>
          </div>
        </Section>
      </div>
    </div>
  );
}
