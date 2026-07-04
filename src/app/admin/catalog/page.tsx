import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Card, CardHeader, Section, Button, Badge } from "@/components/admin/ui";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { getCatalogHub } from "@/lib/catalog/hub";
import { formatMoneyMinor } from "@/lib/purchasing/po-store";

export const dynamic = "force-dynamic";

export default async function CatalogHubPage() {
  await requirePermission("products.enrich");
  const hub = await getCatalogHub();

  if (!hub.configured) {
    return (
      <div>
        <AdminPageHeader title="Product Intake Hub" subtitle="Your one-stop product workflow hub." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once setup is complete, your
            catalog overview will appear here.
          </div>
        </div>
      </div>
    );
  }

  const { purchasing, receiving, onboarding, enrichment, mastering } = hub;

  return (
    <div>
      <AdminPageHeader
        title="Product Intake Hub"
        subtitle="One place for the whole product journey — order it, receive it, onboard it, enrich it, master it, and pay for it."
        breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake" }]} />}
        help={
          <HelpPanel
            id="catalog-hub"
            title="How the product journey fits together"
            steps={[
              "Purchasing: create a purchase order and send it to your vendor.",
              "Receiving: the transfer + COA arrive; verify counts and accept them into inventory.",
              "Product Onboarding: brand-new products (not yet on the menu) wait here for you to approve them onto it.",
              "Live Menu: once approved and published, products are customer-facing.",
              "Product Enrichment: add photos, descriptions, and tags to make live products shine.",
              "Product Mastering: group the same product's sizes into one clean card.",
              "Accounts Payable: pay the vendor once the goods are received and reconciled.",
            ]}
          >
            <p>
              Two lifecycles meet at the menu: <strong>Onboarding</strong> decides
              what gets ON the menu; <strong>Enrichment</strong> makes what&apos;s
              already on it look great. The order below mirrors the real path a
              product takes through the store — top to bottom.
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

        {/* At-a-glance across the whole journey — every number is real. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Open purchase orders"
            value={purchasing.openPos}
            hint={`${formatMoneyMinor(purchasing.openValueMinor)} on order`}
            accent={purchasing.openPos > 0 ? "gold" : "muted"}
            href="/admin/purchasing"
          />
          <StatCard
            label="Inbound to receive"
            value={receiving.awaitingIntake + receiving.inTransit}
            hint={`${receiving.awaitingIntake} here now · ${receiving.inTransit} in transit`}
            accent={receiving.awaitingIntake > 0 ? "gold" : "muted"}
            href="/admin/inventory/intake"
          />
          <StatCard
            label="New products to review"
            value={onboarding.needsReview}
            hint="in Product Onboarding"
            accent={onboarding.needsReview > 0 ? "gold" : "muted"}
            href="/admin/inventory/drafts"
          />
          <StatCard
            label="Menu completeness"
            value={`${enrichment.avgCompletenessPct}%`}
            hint={`${enrichment.enrichedLive} of ${enrichment.total} enriched & live`}
            accent={enrichment.avgCompletenessPct >= 80 ? "green" : "orange"}
            href="/admin/products"
          />
        </div>

        {/* Lifecycle surfaces, in order. Each card owns exactly one job. */}
        <Section
          title="Where do you want to work?"
          description="Each surface owns one step of the product journey. They're listed in the order a product moves through the store."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            {/* 1 — Purchasing */}
            <Card accent="gold">
              <CardHeader title="1 · Purchasing" subtitle="Order stock from your vendors" />
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                Build a purchase order — the system suggests what to reorder from
                on-hand stock and sales velocity — then send it to the vendor. You
                review every line before it goes out.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={purchasing.openPos > 0 ? "gold" : "neutral"}>
                  {purchasing.openPos} open
                </Badge>
                <Badge tone="green">{formatMoneyMinor(purchasing.openValueMinor)} on order</Badge>
              </div>
              <div className="mt-4">
                <Button href="/admin/purchasing" size="sm">Open purchasing →</Button>
              </div>
            </Card>

            {/* 2 — Receiving */}
            <Card accent="gold">
              <CardHeader title="2 · Receiving" subtitle="Accept inbound transfers + COAs" />
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                As transfers arrive, import the manifest, verify counts against the
                COA, and accept the lots into inventory. Nothing goes live until you
                accept it.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={receiving.awaitingIntake > 0 ? "gold" : "neutral"}>
                  {receiving.awaitingIntake} awaiting intake
                </Badge>
                <Badge tone="neutral">{receiving.inTransit} in transit</Badge>
              </div>
              <div className="mt-4">
                <Button href="/admin/inventory/intake" size="sm">Open receiving →</Button>
              </div>
            </Card>

            {/* 3 — Onboarding */}
            <Card accent="gold">
              <CardHeader title="3 · Product Onboarding" subtitle="Approve new products onto the menu" />
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
                <Button href="/admin/inventory/drafts" size="sm">Open onboarding →</Button>
              </div>
            </Card>

            {/* 4 — Enrichment */}
            <Card accent="green">
              <CardHeader title="4 · Product Enrichment" subtitle="Make live products shine online" />
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                For products already on the menu — add photos, descriptions, tags,
                and staff picks (with AI-drafted copy you approve). Price and stock
                stay POS-controlled.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="green">{enrichment.enrichedLive} enriched &amp; live</Badge>
                <Badge tone={enrichment.avgCompletenessPct >= 80 ? "green" : "gold"}>
                  {enrichment.avgCompletenessPct}% avg complete
                </Badge>
              </div>
              <div className="mt-4">
                <Button href="/admin/products" size="sm">Open enrichment →</Button>
              </div>
            </Card>

            {/* 5 — Mastering */}
            <Card accent="orange">
              <CardHeader title="5 · Product Mastering" subtitle="Group sizes into one clean card" />
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
                <Button href="/admin/products/masters" size="sm">Open mastering →</Button>
              </div>
            </Card>

            {/* 6 — Accounts Payable */}
            <Card accent="green">
              <CardHeader title="6 · Accounts Payable" subtitle="Pay the vendor" />
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                Once a PO is received and reconciled (a three-way match of order,
                receipt, and invoice), enter what you owe and generate a NACHA file
                for your bank. Every payment is a draft you review first.
              </p>
              <div className="mt-3">
                <Badge tone="neutral">ACH &amp; manual payments</Badge>
              </div>
              <div className="mt-4">
                <Button href="/admin/vendor-payments" size="sm">Open accounts payable →</Button>
              </div>
            </Card>
          </div>
        </Section>

        {/* Reference surfaces */}
        <Section title="Reference" description="Supporting surfaces the journey draws on.">
          <div className="grid gap-3 sm:grid-cols-2">
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
