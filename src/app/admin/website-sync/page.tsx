import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Section } from "@/components/admin/ui/Section";
import { Card, CardHeader } from "@/components/admin/ui/Card";
import { Button } from "@/components/admin/ui/Button";
import { formatDateTime } from "@/lib/pos/format";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { loadPublishedRuleSnapshots } from "@/lib/promotions/discount-engine";
import { weeklyDealSummaries } from "@/lib/promotions/published-rules-core";
import { storeWeekday } from "@/lib/reports/timezone";
import { getConfig, listTiers } from "@/lib/loyalty/loyalty-store";
import { loyaltyTermsSummary, tierDisplayRows } from "@/lib/loyalty/program-terms-core";
import { getEndorsementConfig } from "@/lib/medical/store";
import { getSalesHoursWindow } from "@/lib/compliance/sales-hours-store";
import { getContentValues } from "@/lib/cms/render-content";
import { WebsiteSyncPreviewPanel } from "@/components/admin/WebsiteSyncPreviewPanel";
import {
  dealSourceSummary,
  endorsementStatusLine,
  isStatutoryWindow,
  menuVersionStats,
  salesWindowLabel,
  weekRowsWithToday,
} from "@/lib/admin/website-sync-core";

export const dynamic = "force-dynamic";

/**
 * Website Sync tabs (MIG-7 PR-A). Two tabs, driven by the URL `?tab=` param
 * (the same server-side idiom used by the Legal Policies editor — no client
 * state needed):
 *   - "harmony": the storefront harmony dashboard (published menu, deals,
 *     loyalty, medical + hours) — the page's original content.
 *   - "preview": the live public-page preview panel, moved here from the old
 *     Site Content editor.
 */
const WEBSITE_SYNC_TABS = [
  { id: "harmony", label: "Storefront harmony" },
  { id: "preview", label: "Live preview" },
] as const;
type WebsiteSyncTab = (typeof WEBSITE_SYNC_TABS)[number]["id"];

/**
 * Website Sync (Task T / PR 5) — the harmony dashboard. One page that shows
 * exactly what the storefront is serving RIGHT NOW, block by block, each with
 * a jump link to the admin surface that owns it. Every figure on this page is
 * read through the SAME loaders the public website uses (published menu
 * version, published rule snapshots, loyalty config/tiers, endorsement
 * config, CMS hours copy) — so if it looks right here, it IS right out there.
 */
export default async function WebsiteSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireStaff();
  const role = session.profile.role;

  const sp = await searchParams;
  const activeTab: WebsiteSyncTab = WEBSITE_SYNC_TABS.some((t) => t.id === sp.tab)
    ? (sp.tab as WebsiteSyncTab)
    : "harmony";

  const [version, snapshots, loyaltyConfig, loyaltyTiers, endorsement, hoursWindow, content] =
    await Promise.all([
      getPublishedVersion(),
      loadPublishedRuleSnapshots(),
      getConfig(),
      listTiers(),
      getEndorsementConfig(),
      getSalesHoursWindow(),
      getContentValues(["business.hours.display"]),
    ]);

  const menuStats = menuVersionStats(version);
  const weekRows = weekRowsWithToday(weeklyDealSummaries(snapshots), storeWeekday());
  const today = weekRows.find((r) => r.isToday) ?? null;
  const terms = loyaltyTermsSummary(loyaltyConfig);
  const tiers = tierDisplayRows(loyaltyTiers);
  const hoursCopy = content["business.hours.display"] || "—";

  // Edit links are permission-gated so staff only see doors they can open.
  const canPublishMenu = can(role, "menu.import");
  const canManagePromos = can(role, "promotions.manage");
  const canManageLoyalty = can(role, "loyalty.manage");
  const canEditContent = can(role, "content.edit");
  const canManageSettings = can(role, "settings.manage");
  const canManageMedical = can(role, "medical.manage");

  return (
    <div>
      <AdminPageHeader
        title="Website Sync"
        subtitle="What the storefront is serving right now — read through the exact same loaders the public site uses."
        breadcrumbs={<Breadcrumbs items={[{ label: "Website Sync" }]} />}
        action={
          canEditContent ? (
            <Button href="/admin/content/seo" variant="neutral">SEO editor →</Button>
          ) : null
        }
        help={
          <HelpPanel
            id="website-sync"
            title="How this page keeps the website honest"
            steps={[
              "Every block below is loaded with the SAME functions the customer-facing site calls — published menu version, published promotion snapshots, loyalty config, endorsement config, CMS hours.",
              "Today's deal row is resolved with the store's Pacific weekday, exactly like the storefront cart re-prices at midnight.",
              "Each block links to the admin surface that owns it, so fixing a mismatch is one click away.",
              "If a block shows seed/fallback data, the storefront is showing the committed fallback too — publish from the owning page to take control.",
            ]}
          >
            <p>
              This is the back office&apos;s promise as the single source of truth: if it looks
              right here, it is what customers see.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {/* Tabs — same server-side `?tab=` idiom as the Legal Policies editor. */}
        <div className="flex flex-wrap gap-2 border-b border-[var(--admin-border)]">
          {WEBSITE_SYNC_TABS.map((t) => {
            const isActive = t.id === activeTab;
            return (
              <a
                key={t.id}
                href={`/admin/website-sync?tab=${t.id}`}
                className={`-mb-px rounded-t-[var(--admin-radius-sm)] border-b-2 px-4 py-2 text-sm font-semibold ${
                  isActive
                    ? "border-[var(--admin-accent)] text-[var(--admin-accent)]"
                    : "border-transparent text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                }`}
              >
                {t.label}
              </a>
            );
          })}
        </div>

        {activeTab === "preview" ? (
          <WebsiteSyncPreviewPanel />
        ) : (
          <>
        {/* ------------------------------------------------ published menu */}
        <Section
          title="Published menu"
          description="The menu version the storefront is serving."
          action={
            canPublishMenu ? (
              <Button href="/admin/menu-imports" variant="neutral" size="sm">
                Menu imports
              </Button>
            ) : null
          }
        >
          {menuStats ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Products live" value={menuStats.itemCount.toLocaleString("en-US")} accent="green" href="/menu" hint="View public menu" />
              <StatCard label="Variants live" value={menuStats.variantCount.toLocaleString("en-US")} />
              <StatCard label="Vendors" value={menuStats.vendorCount.toLocaleString("en-US")} />
              <StatCard
                label="Published"
                value={formatDateTime(menuStats.publishedAtIso)}
                hint={menuStats.hiddenCount > 0 ? `${menuStats.hiddenCount} hidden` : undefined}
              />
            </div>
          ) : (
            <Card>
              <p className="text-sm text-[var(--admin-text-muted)]">
                No published menu version — the storefront is serving its committed fallback
                catalog. Publish an import from{" "}
                <Link href="/admin/menu-imports" className="underline">
                  Menu Imports
                </Link>{" "}
                to take control.
              </p>
            </Card>
          )}
        </Section>

        {/* -------------------------------------------------- weekly deals */}
        <Section
          title="Deals this week"
          description={`What the website charges, day by day — ${dealSourceSummary(weekRows)}.`}
          action={
            canManagePromos ? (
              <Button href="/admin/promotions" variant="neutral" size="sm">
                Promotions
              </Button>
            ) : null
          }
        >
          {today ? (
            <Card accent="green" className="mb-3">
              <CardHeader
                title={`Today — ${today.dayLabel}: ${today.title}`}
                subtitle={[today.offerLabel, today.description].filter(Boolean).join(" · ") || undefined}
                action={
                  <Button href={today.menuHref} variant="neutral" size="sm">
                    View on menu
                  </Button>
                }
              />
              <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
                {today.fromDatabase
                  ? "Published from the back office — the storefront cart prices with this rule right now."
                  : "Committed seed deal — publish an override in Promotions to change it."}
              </p>
            </Card>
          ) : null}
          <Card padding="none">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <th className="px-4 py-2.5 font-semibold">Day</th>
                  <th className="px-4 py-2.5 font-semibold">Deal</th>
                  <th className="px-4 py-2.5 font-semibold">Offer</th>
                  <th className="px-4 py-2.5 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody>
                {weekRows.map((row) => (
                  <tr
                    key={row.weekday}
                    className={`border-b border-[var(--admin-border)] last:border-b-0 ${
                      row.isToday ? "bg-[var(--admin-accent-soft)]" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 font-semibold text-[var(--admin-text)]">
                      {row.dayLabel}
                      {row.isToday ? (
                        <span className="ml-2 rounded-full bg-[var(--admin-accent)] px-2 py-0.5 text-[10px] font-bold uppercase text-black">
                          Today
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--admin-text-muted)]">{row.title}</td>
                    <td className="px-4 py-2.5 text-[var(--admin-text-muted)]">{row.offerLabel || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--admin-text-faint)]">
                      {row.fromDatabase ? "Back office" : "Seed"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </Section>

        {/* ------------------------------------------------- loyalty terms */}
        <Section
          title="Loyalty program"
          description="The exact terms published on /loyalty and priced by the cart estimator."
          action={
            canManageLoyalty ? (
              <Button href="/admin/loyalty" variant="neutral" size="sm">
                Loyalty program
              </Button>
            ) : null
          }
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader title="Program terms" subtitle="Live figures from loyalty_config." />
              <ul className="mt-3 space-y-1.5 text-sm text-[var(--admin-text-muted)]">
                <li>{terms.earnLine}</li>
                <li>{terms.valueLine}</li>
                <li>{terms.redeemLine}</li>
                {terms.signupBonusLine ? <li>{terms.signupBonusLine}</li> : null}
                {terms.expiryLine ? <li>{terms.expiryLine}</li> : null}
              </ul>
            </Card>
            <Card>
              <CardHeader
                title="Tier ladder"
                subtitle={tiers.length ? "Active tiers, as displayed publicly." : "No active tiers — the public page hides the ladder."}
              />
              {tiers.length ? (
                <ul className="mt-3 space-y-1.5 text-sm text-[var(--admin-text-muted)]">
                  {tiers.map((t) => (
                    <li key={t.name} className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-[var(--admin-text)]">{t.name}</span>
                      <span>
                        {t.thresholdLabel}
                        {t.perkLabel ? ` · ${t.perkLabel}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          </div>
        </Section>

        {/* ---------------------------------------------- medical + hours */}
        <Section title="Medical surface & hours" description="Compliance-sensitive copy the website carries.">
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Medical program"
                subtitle="/medical + Med badges on the menu"
                action={
                  canManageMedical ? (
                    <Button href="/admin/medical" variant="neutral" size="sm">
                      Medical Cannabis
                    </Button>
                  ) : null
                }
              />
              <p className="mt-3 text-sm text-[var(--admin-text-muted)]">{endorsementStatusLine(endorsement)}</p>
              {canEditContent ? (
                <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
                  Page copy lives in the{" "}
                  <Link href="/admin/medical-page" className="underline">
                    Medical page
                  </Link>{" "}
                  editor (medical.* blocks).
                </p>
              ) : null}
            </Card>
            <Card>
              <CardHeader
                title="Hours"
                subtitle="Footer copy + the register's sales-hours gate"
                action={
                  canManageSettings ? (
                    <Button href="/admin/settings/sales-hours" variant="neutral" size="sm">
                      Sales hours
                    </Button>
                  ) : null
                }
              />
              <ul className="mt-3 space-y-1.5 text-sm text-[var(--admin-text-muted)]">
                <li>
                  <span className="font-semibold text-[var(--admin-text)]">Website footer:</span> {hoursCopy}
                </li>
                <li>
                  <span className="font-semibold text-[var(--admin-text)]">Sale-completion gate:</span>{" "}
                  {salesWindowLabel(hoursWindow)}
                  {isStatutoryWindow(hoursWindow) ? " (statutory default — WAC 314-55-147)" : " (owner-tightened)"}
                </li>
              </ul>
              {canEditContent ? (
                <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
                  Footer copy is the <code>business.hours.display</code> block in{" "}
                  <Link href="/admin/header-footer" className="underline">
                    Header &amp; Footer
                  </Link>
                  .
                </p>
              ) : null}
            </Card>
          </div>
        </Section>
          </>
        )}
      </div>
    </div>
  );
}
