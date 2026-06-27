import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { countLoyaltySignups } from "@/lib/loyalty/store";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion, listImports } from "@/lib/pos/menu-version";
import { formatDateTime } from "@/lib/pos/format";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const session = await requireStaff();
  const loyaltyCount = await countLoyaltySignups();

  // POS menu status (gracefully degrades when Supabase isn't configured yet).
  let publishedItems: number | null = null;
  let lastImportLabel = "—";
  if (isSupabaseServiceConfigured) {
    try {
      const [published, imports] = await Promise.all([getPublishedVersion(), listImports(1)]);
      publishedItems = published?.item_count ?? null;
      lastImportLabel = imports[0] ? formatDateTime(imports[0].created_at) : "No imports yet";
    } catch {
      // leave defaults
    }
  }

  const firstName =
    (session.profile.full_name ?? session.email).split(/[\s@]/)[0] || "there";

  return (
    <div>
      <AdminPageHeader
        title={`Welcome back, ${firstName}`}
        subtitle={`You are signed in as ${ROLE_LABELS[session.profile.role]}.`}
      />

      <div className="px-5 py-6 sm:px-8">
        {/* Command center */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
            Today at a glance
          </h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Open orders" value="—" hint="Live in Slice 7" accent="orange" />
            <StatCard
              label="Live menu items"
              value={publishedItems ?? "—"}
              hint={publishedItems !== null ? "Currently published" : "No menu published yet"}
              accent="green"
              href="/admin/menu-imports"
            />
            <StatCard
              label="Last POS import"
              value={lastImportLabel === "—" || lastImportLabel === "No imports yet" ? lastImportLabel : "✓"}
              hint={lastImportLabel !== "—" && lastImportLabel !== "No imports yet" ? lastImportLabel : "Upload to begin"}
              href="/admin/menu-imports"
            />
            <StatCard
              label="Loyalty signups"
              value={loyaltyCount}
              hint="Awaiting POS entry"
              accent="gold"
              href="/admin/loyalty-signups"
            />
          </div>
        </section>

        {/* Build progress */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
            Back office build progress
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <ProgressRow done label="Slice 1 — Foundation" detail="Auth, roles, audit log, media storage, dashboard shell" />
            <ProgressRow done label="Slice 2 — POS import & staged publish" detail="Upload spreadsheets → review → publish menu" />
            <ProgressRow label="Slice 3 — Media library + Vendors/Brands" detail="Logos, profiles, asset manager" />
            <ProgressRow label="Slice 4 — Product enrichment" detail="Photos, descriptions, staff picks" />
            <ProgressRow label="Slice 5 — Blog & site content" detail="CMS + controlled text editor" />
            <ProgressRow label="Slice 6 — Promotions" detail="Daily deals + Thursday brands + clearance" />
            <ProgressRow label="Slice 7 — Orders" detail="Server orders, dashboard, tickets" />
            <ProgressRow label="Slice 9 — Reports" detail="Diagnostics, inventory health, sales" />
          </div>
        </section>

        {/* Quick links */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
            Quick links
          </h2>
          <div className="flex flex-wrap gap-3">
            <QuickLink href="/admin/loyalty-signups" label="Review loyalty signups" />
            <QuickLink href="/admin/users" label="Manage staff users" />
            <QuickLink href="/admin/audit" label="View audit log" />
            <QuickLink href="/" label="View live site ↗" external />
          </div>
        </section>
      </div>
    </div>
  );
}

function ProgressRow({
  label,
  detail,
  done,
}: {
  label: string;
  detail: string;
  done?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#0a0a0a] p-4">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
          done ? "bg-[#7ed957] text-black" : "border border-white/20 text-white/30"
        }`}
      >
        {done ? "✓" : ""}
      </span>
      <div>
        <p className={`text-sm font-medium ${done ? "text-white" : "text-white/70"}`}>
          {label}
        </p>
        <p className="text-xs text-white/40">{detail}</p>
      </div>
    </div>
  );
}

function QuickLink({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-[#7ed957] hover:text-white"
    >
      {label}
    </Link>
  );
}
