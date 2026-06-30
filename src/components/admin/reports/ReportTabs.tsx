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
  { href: "/admin/reports/cogs", label: "Inventory & COGS", icon: "📦" },
  { href: "/admin/reports/tax", label: "Tax", icon: "🧾" },
  { href: "/admin/reports/customers", label: "Customers", icon: "👥" },
  { href: "/admin/reports/compliance", label: "Compliance (CCRS)", icon: "🛡️" },
  { href: "/admin/reports/accounting", label: "Accounting (Sage 50)", icon: "📒" },
];

export function ReportTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1.5 border-b border-white/10 pb-3">
      {REPORT_TABS.map((tab) => {
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
                ? "bg-[#7ed957]/15 text-[#7ed957] ring-1 ring-[#7ed957]/40"
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
