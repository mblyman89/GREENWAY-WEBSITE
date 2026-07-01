import type { Metadata } from "next";
import { getStaffSession } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { AdminSetupNotice } from "@/components/admin/AdminSetupNotice";
import { ToastProvider } from "@/components/admin/ux";
import { HelpLauncher } from "@/components/admin/HelpLauncher";
import { CommandPalette } from "@/components/admin/CommandPalette";
import { ConciergeWidget } from "@/components/admin/ConciergeWidget";
import { MobileLauncher } from "@/components/admin/mobile/MobileLauncher";
import { adminNav } from "@/components/admin/admin-nav-data";
import { can, type Permission } from "@/lib/auth/roles";

// Admin must never be indexed.
export const metadata: Metadata = {
  title: "Greenway Admin",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // When Supabase isn't configured yet, show a friendly setup notice instead
  // of crashing — keeps the public site deployable during the build.
  if (!isSupabaseConfigured) {
    return (
      <div className="admin-shell min-h-screen">
        <AdminSetupNotice />
      </div>
    );
  }

  const session = await getStaffSession();

  // Unauthenticated users (e.g. the login page) render children without the
  // shell. The login route renders its own centered card.
  if (!session) {
    return <div className="admin-shell min-h-screen">{children}</div>;
  }

  // Build the command-palette targets, filtered by what this role can open.
  const paletteItems = adminNav
    .filter((item) => !item.comingSoon && can(session.profile.role, item.permission as Permission))
    .map((item) => ({
      label: item.label,
      href: item.href,
      icon: item.icon,
      group: item.group,
    }));

  return (
    <div className="admin-shell flex min-h-screen flex-col">
      <div className="admin-chrome">
        <AdminTopNav
          role={session.profile.role}
          fullName={session.profile.full_name ?? ""}
          email={session.email}
        />
      </div>
      <main className="admin-main min-w-0 flex-1">
        <ToastProvider>{children}</ToastProvider>
      </main>
      <div className="admin-chrome">
        <HelpLauncher />
        <CommandPalette items={paletteItems} />
        <ConciergeWidget />
        <MobileLauncher />
      </div>
    </div>
  );
}
