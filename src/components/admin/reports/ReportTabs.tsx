/**
 * src/components/admin/reports/ReportTabs.tsx
 *
 * The tab navigation for the reporting suite. Each tab is its own route under
 * /admin/reports so reports load independently and deep-link cleanly. The active
 * tab is derived from the current pathname.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type ReportTab = { href: string; label: string; icon: string };

export const REPORT_TABS: ReportTab[] = [
  { href: "/admin/reports", label: "Overview", icon: "📊" },
  { href: "/admin/reports/sales", label: "Sales", icon: "💵" },
  { href: "/admin/reports/returns", label: "Returns & Voids", icon: "↩️" },
  { href: "/admin/reports/benchmarks", label: "Benchmarks", icon: "🏆" },
  { href: "/admin/reports/forecast", label: "Forecast", icon: "🔮" },
  { href: "/admin/reports/cogs", label: "Inventory & COGS", icon: "📦" },
  { href: "/admin/reports/expiration", label: "Expiration", icon: "⏳" },
  { href: "/admin/reports/net-income", label: "Net Income", icon: "📈" },
  { href: "/admin/reports/tax", label: "Tax", icon: "🧾" },
  { href: "/admin/reports/online-orders", label: "Online Orders", icon: "🛒" },
  { href: "/admin/reports/website", label: "Website Clicks", icon: "🌐" },
  // R73 S8: greenwaymerch.com traffic, sales and WA sales tax.
  { href: "/admin/reports/merch", label: "Merch", icon: "👕" },
  { href: "/admin/reports/customers", label: "Customers", icon: "👥" },
  { href: "/admin/reports/loyalty", label: "Loyalty & Discounts", icon: "🎁" },
  { href: "/admin/reports/special-discounts", label: "Special Discounts", icon: "🤝" },
  // Register round S3: minus / remove / cancel + voids, per employee.
  { href: "/admin/reports/register-adjustments", label: "Register Adjustments", icon: "➖" },
  { href: "/admin/reports/employees", label: "Employees", icon: "⏱" },
  { href: "/admin/reports/medical", label: "Medical", icon: "⚕" },
  { href: "/admin/reports/compliance", label: "Compliance (CCRS)", icon: "🛡️" },
  { href: "/admin/reports/excise", label: "Excise Tax (LIQ-1295)", icon: "🧾" },
  { href: "/admin/reports/accounting", label: "Accounting (Sage 50)", icon: "📒" },
];

/**
 * R41 round 9: the ACH Payments tab is OWNER AND ADMIN ONLY. It is not in
 * REPORT_TABS; the layout passes showAchTab (can(role, "ach.request")) and
 * the page itself checks the same permission, so hiding the link is not the
 * only guard.
 */
export const ACH_REPORT_TAB: ReportTab = { href: "/admin/reports/ach-payments", label: "ACH Payments", icon: "🏦" };

/**
 * CVB-6: the Cultivera Benchmark tab is OWNER ONLY (owner, 2026-11-01: "a new tab added to reports called
 * Cultivera Benchmark ... This will be owner only access."). The layout passes
 * showCultiveraTab (can(role, "cultivera.benchmark")); the page and its actions check the same permission.
 * It sits before ACH Payments so ACH stays the last tab.
 */
export const CULTIVERA_BENCHMARK_TAB: ReportTab = { href: "/admin/reports/cultivera-benchmark", label: "Cultivera Benchmark", icon: "\ud83c\udfc1" };

export function reportTabsFor(showAchTab: boolean, showCultiveraTab = false): ReportTab[] {
  return [...REPORT_TABS, ...(showCultiveraTab ? [CULTIVERA_BENCHMARK_TAB] : []), ...(showAchTab ? [ACH_REPORT_TAB] : [])];
}

export function ReportTabs({ showAchTab = false, showCultiveraTab = false }: { showAchTab?: boolean; showCultiveraTab?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1.5 border-b border-white/10 pb-3">
      {reportTabsFor(showAchTab, showCultiveraTab).map((tab) => {
        const active =
          tab.href === "/admin/reports"
            ? pathname === "/admin/reports"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
              active
                ? "bg-[var(--admin-accent)] text-black"
                : "text-white/55 hover:bg-white/5 hover:text-white"
            }`}
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
