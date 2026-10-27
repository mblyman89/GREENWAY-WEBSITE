import type { Metadata } from "next";
import { Suspense } from "react";
import { getStaffSession } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { AdminSetupNotice } from "@/components/admin/AdminSetupNotice";
import { ToastProvider, ScrollKeeper, PendingKeeper, AdminBlockFocus, EditConflictNotice } from "@/components/admin/ux";
import { LazyAdminWidgets } from "@/components/admin/perf/LazyAdminWidgets";
import { AdminNavWithBadges } from "@/components/admin/perf/AdminNavWithBadges";
import { adminNav } from "@/components/admin/admin-nav-data";
import { can, type Permission } from "@/lib/auth/roles";
import { backOfficeGateForStaff } from "@/lib/staffing/handbook-ack-store";
import { HandbookGateScreen } from "@/components/admin/HandbookGateScreen";
import { fontVariablesClassName } from "@/lib/cms/fonts-loader";
import "../globals.css";

// PERF-S2: /admin is its OWN root layout (the public site lives in the
// (site) route group). The back office no longer pays for the public shell on
// every navigation: no CMS font/brand lookup, no published-rules snapshot, no
// store-hours schema, no age gate, cart, JSON-LD or analytics. Navigating
// between /admin and the public site is a full page load (Next docs: multiple
// root layouts), which is fine for staff. The 5 banner-studio routes that need
// published promotion rules mount them in their own segment layout.
function AdminDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariablesClassName}>
      <body>{children}</body>
    </html>
  );
}

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
      <AdminDocument>
        <div className="admin-shell min-h-screen">
          <AdminSetupNotice />
        </div>
      </AdminDocument>
    );
  }

  const session = await getStaffSession();

  // Unauthenticated users (e.g. the login page) render children without the
  // shell. The login route renders its own centered card.
  if (!session) {
    return (
      <AdminDocument>
        <div className="admin-shell min-h-screen">{children}</div>
      </AdminDocument>
    );
  }

  // SLICE 36 handbook gate: staff who have not acknowledged the CURRENT
  // handbook version see the handbook + acknowledgment screen instead of any
  // admin page (owners are exempt; the gate stays OPEN before migration 0136
  // so a missing table can never lock the whole staff out).
  const handbookGate = await backOfficeGateForStaff({
    staffId: session.userId,
    role: session.profile.role,
  });
  if (!handbookGate.ok) {
    return (
      <AdminDocument>
        <div className="admin-shell min-h-screen">
          <HandbookGateScreen fullName={session.profile.full_name ?? ""} />
        </div>
      </AdminDocument>
    );
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

  // AN-6 + R41 S0 (D-6): nav badges (POS exceptions for orders.manage roles,
  // Michael's waiting ACH items for the owner). PERF-S3: these are no longer
  // awaited here. They stream in behind <Suspense>, fetched in parallel and
  // cached for 30 s (src/components/admin/perf/admin-badges-server.ts); the
  // fallback is the identical nav without chips.
  const showExceptionBadge = can(session.profile.role, "orders.manage" as Permission);
  const showOwnerBadge = session.profile.role === "owner";
  const navBase = {
    role: session.profile.role,
    fullName: session.profile.full_name ?? "",
    email: session.email,
  };

  return (
    <AdminDocument>
    <div className="admin-shell flex min-h-screen flex-col">
      <div className="admin-chrome">
        <Suspense fallback={<AdminTopNav {...navBase} />}>
          <AdminNavWithBadges {...navBase} exceptions={showExceptionBadge} owner={showOwnerBadge} />
        </Suspense>
      </div>
      <main className="admin-main min-w-0 flex-1">
        {/* H12e/H13a: restore the scroll position after server-action saves —
            redirect() otherwise jumps every save back to the top (or to the
            #ai-drafts anchor on the vendor page). H12f: instant click feedback
            — spinner on the pressed button, double-submit guard, and a top
            progress bar until the response lands. Both read the URL via
            useSearchParams, so they live behind a Suspense boundary to avoid
            bailing the whole admin layout out of static rendering. Zero
            per-page wiring. */}
        <Suspense fallback={null}>
          <ScrollKeeper />
          <PendingKeeper />
          {/* R43: land on the exact field after a green ✎ Edit click. */}
          <AdminBlockFocus />
          {/* R45-S2: "someone else saved first" notice (?conflict=<key>). */}
          <EditConflictNotice />
        </Suspense>
        <ToastProvider>{children}</ToastProvider>
      </main>
      <div className="admin-chrome">
        {/* PERF-S3: code-split, loaded after hydration. */}
        <LazyAdminWidgets paletteItems={paletteItems} />
      </div>
    </div>
    </AdminDocument>
  );
}
