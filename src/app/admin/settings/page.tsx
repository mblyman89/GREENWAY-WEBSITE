import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { getStoreProfile } from "@/lib/admin/store-profile-store";
import { getTaxSettings } from "@/lib/reports/tax";
import { getPricingSettings } from "@/lib/inventory/pricing";
import { summarizeHours } from "@/lib/admin/store-profile-core";

export const dynamic = "force-dynamic";

type SettingsLink = {
  href: string;
  title: string;
  description: string;
  icon: string;
  status?: string;
};

type SettingsGroup = { name: string; blurb: string; links: SettingsLink[] };

export default async function SettingsHomePage() {
  await requirePermission("settings.manage");

  // Cheap live status for the cards that own their own data. Everything is
  // best-effort — the hub still renders if any read fails.
  const [profile, tax, pricing] = await Promise.all([
    getStoreProfile().catch(() => null),
    getTaxSettings().catch(() => null),
    getPricingSettings().catch(() => null),
  ]);

  const taxStatus = tax
    ? `Excise ${(tax.exciseRateBps / 100).toString()}% · Sales ${((tax.stateSalesRateBps + tax.localSalesRateBps) / 100).toString()}%`
    : undefined;
  const pricingStatus = pricing
    ? `Min markup ${pricing.min_markup_multiple}× · round to ${pricing.round_to_minor_units}¢`
    : undefined;

  const groups: SettingsGroup[] = [
    {
      name: "Store",
      blurb: "Your store's identity and how prices and taxes are calculated.",
      links: [
        {
          href: "/admin/settings/store-profile",
          title: "Store profile",
          description: "Name, contact details, address, and open hours.",
          icon: "🏪",
          status: profile ? summarizeHours(profile) : undefined,
        },
        {
          href: "/admin/settings/tax",
          title: "Tax settings",
          description: "Excise and sales tax rates, and which categories are cannabis.",
          icon: "🧾",
          status: taxStatus,
        },
        {
          href: "/admin/settings/pricing",
          title: "Pricing settings",
          description: "Minimum markup floor and price rounding rules.",
          icon: "💲",
          status: pricingStatus,
        },
      ],
    },
    {
      name: "Catalog & inventory",
      blurb: "How your menu is organized and reordered.",
      links: [
        {
          href: "/admin/settings/types",
          title: "Types & categories",
          description:
            "Rename and reorder website categories, and catalog the POS inventory types behind them.",
          icon: "🏷",
        },
        {
          href: "/admin/purchasing",
          title: "Reorder points",
          description: "Set low-stock thresholds and reorder rules for purchasing.",
          icon: "📦",
        },
      ],
    },
    {
      name: "Compliance",
      blurb: "Washington I-502 controls that keep the store within the rules.",
      links: [
        {
          href: "/admin/compliance/sales-limits",
          title: "Sales limits",
          description: "Daily per-customer purchase limits enforced at the register.",
          icon: "⚖",
        },
      ],
    },
    {
      name: "Money & accounting",
      blurb: "Bookkeeping export configuration.",
      links: [
        {
          href: "/admin/reports/accounting",
          title: "Accounting settings",
          description: "General-ledger account mapping and Sage 50 export options.",
          icon: "📚",
        },
      ],
    },
    {
      name: "Equipment & integrations",
      blurb: "Hardware and third-party menu services.",
      links: [
        {
          href: "/admin/settings/receipt-printer",
          title: "Receipt printer",
          description: "Connect and diagnose the receipt printer with a guided assistant.",
          icon: "🧾",
        },
        {
          href: "/admin/integrations",
          title: "Integrations",
          description: "Enter your Leafly and WeedMaps API credentials and push your menu.",
          icon: "🔌",
        },
      ],
    },
    {
      name: "Team & security",
      blurb: "Who can do what, and a trustworthy record of every change.",
      links: [
        {
          href: "/admin/users",
          title: "Users & roles",
          description: "Invite teammates and control what each role can access.",
          icon: "👥",
        },
        {
          href: "/admin/audit",
          title: "Activity log",
          description: "A plain-language history of every change, with a security review.",
          icon: "📜",
        },
        {
          href: "/admin/settings/security",
          title: "Security & passkeys",
          description: "Add Face ID / Touch ID sign-in for your own account.",
          icon: "🔑",
        },
      ],
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Settings"
        subtitle="Everything you can configure across the back office, in one place."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin" }, { label: "Settings" }]} />}
      />
      <div className="space-y-8 px-5 py-6 sm:px-8">
        {groups.map((group) => (
          <section key={group.name}>
            <div className="mb-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-white/50">
                {group.name}
              </h2>
              <p className="mt-0.5 text-xs text-white/40">{group.blurb}</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {group.links.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="admin-card-interactive flex items-start gap-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
                >
                  <span className="text-2xl">{s.icon}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{s.title}</p>
                    <p className="mt-1 text-xs text-white/50">{s.description}</p>
                    {s.status ? (
                      <p className="mt-2 inline-block rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-0.5 text-[11px] text-white/60">
                        {s.status}
                      </p>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
