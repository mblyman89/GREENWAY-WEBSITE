/**
 * Setup Status — the single source of truth for "is the back office actually
 * set up?" The dashboard reads this to show truthful progress and a Getting
 * Started checklist (instead of hardcoded checkmarks).
 *
 * Everything here degrades gracefully: if Supabase isn't configured or a table
 * is missing, the relevant check simply reports "not done" rather than throwing.
 * SERVER-ONLY (uses the service-role client).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export type CheckState = "done" | "todo" | "unknown";

export type SetupCheck = {
  id: string;
  label: string;
  detail: string;
  state: CheckState;
  /** Where the user should go to complete this step. */
  href?: string;
};

/**
 * Probe whether a table exists & is reachable by attempting a tiny count.
 * Returns the row count, or null if the table is missing / unreachable.
 */
async function probeCount(
  table: string,
): Promise<{ exists: boolean; count: number | null }> {
  if (!isSupabaseServiceConfigured) return { exists: false, count: null };
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) {
      // Table missing (42P01) or RLS/permission issue — treat as "not set up".
      return { exists: false, count: null };
    }
    return { exists: true, count: count ?? 0 };
  } catch {
    return { exists: false, count: null };
  }
}

async function hasPublishedMenu(): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_versions")
      .select("id")
      .eq("status", "published")
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function invitedNonBootstrapUsers(): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin
      .from("staff_profiles")
      .select("*", { count: "exact", head: true });
    if (error) return false;
    // More than one profile suggests the owner has invited at least one teammate.
    return (count ?? 0) > 1;
  } catch {
    return false;
  }
}

export type SetupStatus = {
  supabaseConfigured: boolean;
  smtpConfigured: boolean;
  posTablesReady: boolean;
  menuPublished: boolean;
  hasImports: boolean;
  teamInvited: boolean;
  checks: SetupCheck[];
  /** The single most important next action (first incomplete check), if any. */
  nextAction: SetupCheck | null;
  completed: number;
  total: number;
};

export async function getSetupStatus(): Promise<SetupStatus> {
  const supabaseConfigured = isSupabaseServiceConfigured;
  const smtpConfigured = Boolean(process.env.RESEND_API_KEY);

  const [posProbe, importsProbe, menuPublished, teamInvited] =
    await Promise.all([
      probeCount("menu_items"),
      probeCount("pos_imports"),
      hasPublishedMenu(),
      invitedNonBootstrapUsers(),
    ]);

  const posTablesReady = posProbe.exists && importsProbe.exists;
  const hasImports = (importsProbe.count ?? 0) > 0;

  const bool = (b: boolean): CheckState => (b ? "done" : "todo");

  const checks: SetupCheck[] = [
    {
      id: "supabase",
      label: "Connect your database",
      detail: supabaseConfigured
        ? "Supabase is connected."
        : "Add your Supabase keys to the environment.",
      state: bool(supabaseConfigured),
    },
    {
      id: "migrations",
      label: "Set up your data tables",
      detail: posTablesReady
        ? "Menu & import tables are ready."
        : "Run the database setup steps so menu imports work.",
      state: supabaseConfigured ? bool(posTablesReady) : "unknown",
      href: "/admin/menu-imports",
    },
    {
      id: "import",
      label: "Upload your POS menu",
      detail: hasImports
        ? "You've uploaded at least one POS export."
        : "Upload your PRODUCTS & INVENTORIES spreadsheets.",
      state: posTablesReady ? bool(hasImports) : "unknown",
      href: "/admin/menu-imports",
    },
    {
      id: "publish",
      label: "Publish your menu",
      detail: menuPublished
        ? "Your menu is live on the public site."
        : "Review the staged menu and publish it so products show up.",
      state: hasImports ? bool(menuPublished) : "unknown",
      href: "/admin/menu-imports",
    },
    {
      id: "smtp",
      label: "Set up email sending",
      detail: smtpConfigured
        ? "Email (Resend) is configured."
        : "Add a Resend API key so invites & order emails send reliably.",
      state: bool(smtpConfigured),
    },
    {
      id: "team",
      label: "Invite your team",
      detail: teamInvited
        ? "You've invited at least one teammate."
        : "Invite your staff so they can help manage the site.",
      state: supabaseConfigured ? bool(teamInvited) : "unknown",
      href: "/admin/users",
    },
  ];

  const nextAction =
    checks.find((c) => c.state === "todo") ??
    checks.find((c) => c.state === "unknown") ??
    null;

  const completed = checks.filter((c) => c.state === "done").length;

  return {
    supabaseConfigured,
    smtpConfigured,
    posTablesReady,
    menuPublished,
    hasImports,
    teamInvited,
    checks,
    nextAction,
    completed,
    total: checks.length,
  };
}

/**
 * Build-progress slices. Marked done as each ships. Keep this as the single
 * source for the dashboard's progress section (no scattered hardcoding).
 */
export type SliceProgress = {
  id: string;
  label: string;
  detail: string;
  done: boolean;
};

export const BUILD_SLICES: SliceProgress[] = [
  {
    id: "1",
    label: "Slice 1 — Foundation",
    detail: "Auth, roles, audit log, media storage, dashboard shell",
    done: true,
  },
  {
    id: "2",
    label: "Slice 2 — POS import & staged publish",
    detail: "Upload spreadsheets → review → publish menu",
    done: true,
  },
  {
    id: "3",
    label: "Slice 3 — Media library + Vendors/Brands",
    detail: "Logos, profiles, asset manager",
    done: true,
  },
  {
    id: "4",
    label: "Slice 4 — Product enrichment",
    detail: "Photos, descriptions, staff picks",
    done: true,
  },
  {
    id: "5",
    label: "Slice 5 — Blog & site content",
    detail: "CMS + controlled text editor",
    done: true,
  },
  {
    id: "6",
    label: "Slice 6 — Promotions",
    detail: "Daily deals + Thursday brands + clearance",
    done: true,
  },
  {
    id: "7",
    label: "Slice 7 — Orders",
    detail: "Server orders, dashboard, tickets",
    done: true,
  },
  {
    id: "9",
    label: "Slice 9 — Reports",
    detail: "Diagnostics, inventory health, sales",
    done: true,
  },
];
