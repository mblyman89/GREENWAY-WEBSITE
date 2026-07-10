import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Card, CardHeader, Section, Button, Badge } from "@/components/admin/ui";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { getCatalogHub, workQueueInputsFromHub } from "@/lib/catalog/hub";
import { buildWorkQueue } from "@/lib/catalog/work-queue-core";
import { journeyStage, type JourneyStageKey } from "@/lib/catalog/journey-core";
import { can } from "@/lib/auth/roles";
import { formatMoneyMinor } from "@/lib/purchasing/po-store";
import { getDockToShelfMetrics } from "@/lib/catalog/dock-to-shelf";
import { formatHopHours } from "@/lib/catalog/dock-to-shelf-core";

/** W1 — hub card titles derive from THE canonical journey (journey-core). */
function stageTitle(key: Parameters<typeof journeyStage>[0]): string {
  const s = journeyStage(key);
  return `${s.index} · ${s.cardTitle}`;
}

export const dynamic = "force-dynamic";

export default async function CatalogHubPage() {
  const session = await requirePermission("products.enrich");
  // W10 — hub cards are permission-filtered: each stage card only renders if
  // the viewer can actually open the page behind it (the stage's verified
  // permission from journey-core). No doors staff can't open.
  const canSee = (key: JourneyStageKey) => can(session.profile.role, journeyStage(key).permission);
  const [hub, dockToShelf] = await Promise.all([getCatalogHub(), getDockToShelfMetrics()]);

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

  // W2 — the Command Center work queue: verified counts only, priority order,
  // one action per row. Empty queue = genuinely all clear.
  const workQueue = buildWorkQueue(workQueueInputsFromHub(hub));

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
              "0 · Discover: capture and qualify product & vendor leads worth pursuing.",
              "1 · Order: create a purchase order and send it to your vendor.",
              "2 · Receive: the transfer + COA arrive; verify counts and accept them into inventory.",
              "3 · Onboard: brand-new products (not yet on the menu) wait here for you to approve them onto it.",
              "4 · Publish: the menu is published from your POS exports — then products are customer-facing.",
              "5 · Enrich: add photos, descriptions, and tags to make live products shine.",
              "6 · Master: group the same product's sizes into one clean card.",
              "7 · Pay: pay the vendor once the goods are received and reconciled.",
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
        {/* W1: the hub IS the map — show the whole journey, nothing highlighted. */}
        <CatalogStageStrip />

        {/* W2: the Command Center work queue — do these in order, top to bottom. */}
        <Section
          title="Work queue — do these in order"
          description="Every row is real work waiting on you, sorted by urgency. Press the button, do the thing, come back. Empty means you're all caught up."
        >
          {workQueue.length === 0 ? (
            <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm text-[var(--admin-text-muted)]">
              ✅ All clear — nothing in the pipeline needs you right now.
            </div>
          ) : (
            <div className="space-y-2">
              {workQueue.map((row) => (
                <div
                  key={row.key}
                  className={`flex flex-wrap items-center gap-3 rounded-[var(--admin-radius)] border px-4 py-3 ${
                    row.severity === "critical"
                      ? "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)]"
                      : row.severity === "warning"
                        ? "border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)]"
                        : "border-[var(--admin-border)] bg-[var(--admin-surface)]"
                  }`}
                >
                  <span aria-hidden className="text-lg">{row.icon}</span>
                  <span
                    className={`flex-1 text-sm ${
                      row.severity === "critical"
                        ? "text-[var(--admin-danger)]"
                        : row.severity === "warning"
                          ? "text-[var(--admin-gold)]"
                          : "text-[var(--admin-text-muted)]"
                    }`}
                  >
                    {row.text}
                  </span>
                  <Button
                    href={row.actionHref}
                    size="sm"
                    variant={row.severity === "info" ? "neutral" : "primary"}
                  >
                    {row.actionLabel} →
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>

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

        {/* W12 — dock-to-shelf: how fast product becomes sellable (last 90
            days, medians). Every number is a real timestamp pair; a hop with
            no completed pairs shows an em dash, never a guess. */}
        {dockToShelf ? (
          <Card className="p-5">
            <CardHeader
              title="Dock to shelf"
              subtitle="How fast product becomes sellable — median time per hop, last 90 days"
            />
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  Received → accepted
                </div>
                <div className="mt-1 text-2xl font-semibold text-[var(--admin-text)]">
                  {formatHopHours(dockToShelf.receiveToAcceptHours)}
                </div>
                <div className="text-xs text-[var(--admin-text-muted)]">
                  {dockToShelf.receiveToAcceptCount > 0
                    ? `median of ${dockToShelf.receiveToAcceptCount} deliveries`
                    : "no completed deliveries yet"}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  Accepted → product approved
                </div>
                <div className="mt-1 text-2xl font-semibold text-[var(--admin-text)]">
                  {formatHopHours(dockToShelf.acceptToApproveHours)}
                </div>
                <div className="text-xs text-[var(--admin-text-muted)]">
                  {dockToShelf.acceptToApproveCount > 0
                    ? `median of ${dockToShelf.acceptToApproveCount} onboarded products`
                    : "no onboarded products yet"}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  Approved → live on menu
                </div>
                <div className="mt-1 text-2xl font-semibold text-[var(--admin-text)]">
                  {formatHopHours(dockToShelf.approveToLiveHours)}
                </div>
                <div className="text-xs text-[var(--admin-text-muted)]">
                  {dockToShelf.approveToLiveCount > 0
                    ? `median of ${dockToShelf.approveToLiveCount} publishes`
                    : "no publishes after an approval yet"}
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {/* Lifecycle surfaces, in order. Each card owns exactly one job. */}
        <Section
          title="Where do you want to work?"
          description="Each surface owns one step of the product journey. They're listed in the order a product moves through the store."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            {/* 0 — Discovery (front door of the funnel) */}
            {canSee("discover") ? (
            <Card accent="green">
              <CardHeader title={stageTitle("discover")} subtitle="Find products & vendors worth pursuing" />
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                The front door of the funnel. Capture candidate vendors and
                products, qualify them, and promote the winners straight into a
                purchase order. Everything is a draft you confirm.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="green">Leads &amp; prospects</Badge>
                <Badge tone="neutral">Promote to PO</Badge>
              </div>
              <div className="mt-4">
                <Button href="/admin/discovery" size="sm">Open discovery →</Button>
              </div>
            </Card>
            ) : null}

            {/* 1 — Purchasing */}
            {canSee("order") ? (
            <Card accent="gold">
              <CardHeader title={stageTitle("order")} subtitle="Order stock from your vendors" />
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
            ) : null}

            {/* 2 — Receiving */}
            {canSee("receive") ? (
            <Card accent="gold">
              <CardHeader title={stageTitle("receive")} subtitle="Accept inbound transfers + COAs" />
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
            ) : null}

            {/* 3 — Onboarding */}
            {canSee("onboard") ? (
            <Card accent="gold">
              <CardHeader title={stageTitle("onboard")} subtitle="Approve new products onto the menu" />
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
            ) : null}

            {/* 4 — Publish (Live Menu) — W1: the stage the old hub skipped. */}
            {canSee("publish") ? (
            <Card accent="gold">
              <CardHeader title={stageTitle("publish")} subtitle="Publish the menu customers see" />
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                The menu is built from your POS exports: upload them under Menu
                Imports, review the staged version, and publish. Live, on-hand,
                customer-facing stock lives under Inventory.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={hub.hasPublishedMenu ? "green" : "gold"}>
                  {hub.hasPublishedMenu ? "Menu is live" : "No menu published yet"}
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button href="/admin/menu-imports" size="sm">Open menu imports →</Button>
                <Button href="/admin/inventory" size="sm" variant="neutral">Open inventory →</Button>
              </div>
            </Card>
            ) : null}

            {/* 5 — Enrichment */}
            {canSee("enrich") ? (
            <Card accent="green">
              <CardHeader title={stageTitle("enrich")} subtitle="Make live products shine online" />
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
            ) : null}

            {/* 6 — Mastering */}
            {canSee("master") ? (
            <Card accent="orange">
              <CardHeader title={stageTitle("master")} subtitle="Group sizes into one clean card" />
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
            ) : null}

            {/* 7 — Accounts Payable */}
            {canSee("pay") ? (
            <Card accent="green">
              <CardHeader title={stageTitle("pay")} subtitle="Pay the vendor" />
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                Once a delivery is accepted, pick the invoice and pay it — the
                amount box auto-fills with what you owe, and deliveries linked to
                a PO are compared against the order before you pay. Every payment
                is a draft you review first.
              </p>
              <div className="mt-3">
                <Badge tone="neutral">ACH &amp; manual payments</Badge>
              </div>
              <div className="mt-4">
                <Button href="/admin/vendor-payments" size="sm">Open accounts payable →</Button>
              </div>
            </Card>
            ) : null}
          </div>
        </Section>

        {/* Reference surfaces — fuel, not stages (W1). */}
        <Section title="Reference" description="Fuel, not stages — supporting surfaces the journey draws on.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Card interactive href="/admin/knowledge-base" padding="sm">
              <div className="text-sm font-semibold text-[var(--admin-text)]">📚 Knowledge Base</div>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Reference facts that power good enrichment.</p>
            </Card>
            <Card interactive href="/admin/discovery/benchmarks" padding="sm">
              <div className="text-sm font-semibold text-[var(--admin-text)]">📊 CCRS Benchmarks</div>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Market & competitor intelligence that sharpens Discovery and Purchasing.</p>
            </Card>
          </div>
        </Section>
      </div>
    </div>
  );
}
