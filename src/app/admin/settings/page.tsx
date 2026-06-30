import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";

export const dynamic = "force-dynamic";

const SETTINGS_LINKS: { href: string; title: string; description: string; icon: string }[] = [
  {
    href: "/admin/settings/types",
    title: "Types & Categories",
    description:
      "Rename and reorder the website categories that group your menu, and catalog the POS inventory types behind them.",
    icon: "🏷",
  },
];

export default async function SettingsHomePage() {
  await requirePermission("settings.manage");

  return (
    <div>
      <AdminPageHeader
        title="Settings"
        subtitle="Configure how your back office behaves."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin" }, { label: "Settings" }]} />}
      />
      <div className="grid gap-4 px-5 py-6 sm:px-8 lg:grid-cols-2">
        {SETTINGS_LINKS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="admin-card-interactive flex items-start gap-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
          >
            <span className="text-2xl">{s.icon}</span>
            <div>
              <p className="text-sm font-semibold text-white">{s.title}</p>
              <p className="mt-1 text-xs text-white/50">{s.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
