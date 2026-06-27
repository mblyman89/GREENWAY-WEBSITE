import type { Metadata } from "next";
import { getStaffSession } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminSetupNotice } from "@/components/admin/AdminSetupNotice";

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
      <div className="min-h-screen bg-black text-white">
        <AdminSetupNotice />
      </div>
    );
  }

  const session = await getStaffSession();

  // Unauthenticated users (e.g. the login page) render children without the
  // shell. The login route renders its own centered card.
  if (!session) {
    return <div className="min-h-screen bg-black text-white">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-black text-white lg:flex">
      <AdminSidebar
        role={session.profile.role}
        fullName={session.profile.full_name ?? ""}
        email={session.email}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
