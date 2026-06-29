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
 * Rich, plain-language guidance for each setup step — used by the dedicated
 * Getting Started wizard (/admin/getting-started). Keyed by the same check id
 * as getSetupStatus().checks so the wizard can pair live status with how-to.
 */
export type SetupGuide = {
  /** Big-picture "why this matters" sentence. */
  why: string;
  /** Step-by-step instructions, written for a non-technical owner. */
  how: string[];
  /** Rough time to complete. */
  time: string;
  /** Primary call-to-action label + where it goes (when applicable). */
  ctaLabel?: string;
  ctaHref?: string;
  /** Optional secondary tip. */
  tip?: string;
};

export const SETUP_GUIDE: Record<string, SetupGuide> = {
  supabase: {
    why: "Supabase is the secure database that stores your menu, orders, customers, and content. Nothing in the back office works until it's connected.",
    how: [
      "Create a free project at supabase.com.",
      "Open Settings → API and copy the Project URL and the two keys (anon + service role).",
      "Paste them into your hosting environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.",
      "Set ADMIN_BOOTSTRAP_EMAILS to your email so your first login becomes the Owner.",
      "Redeploy the site.",
    ],
    time: "~10 minutes",
    tip: "Keep the service-role key secret — it bypasses all security rules and should only ever live in server environment variables.",
  },
  migrations: {
    why: "The database needs its tables created before you can import a menu or take orders. This is a one-time setup that runs a set of prepared SQL files.",
    how: [
      "Open your Supabase project → SQL Editor.",
      "Open each file in the supabase/migrations/ folder in order, lowest number first.",
      "Paste each file's contents into the SQL Editor and click Run. Always run them in number order.",
      "Be sure to run every file, including the newest ones — each adds tables the back office needs.",
      "When all have run with no errors, this step turns green automatically.",
    ],
    time: "~10 minutes",
    ctaLabel: "Go to Menu Imports",
    ctaHref: "/admin/menu-imports",
    tip: "Running a migration twice is safe — they're written to skip anything that already exists.",
  },
  import: {
    why: "Your live product menu comes straight from your POS export. Upload it here and the back office stages it for review before anything goes public.",
    how: [
      "In your POS, export the PRODUCTS and INVENTORIES spreadsheets (CSV or Excel).",
      "Open Menu Imports and upload both files.",
      "The system matches and stages them into a draft menu version for you to review.",
      "Nothing is public yet — that happens at the Publish step.",
    ],
    time: "~5 minutes",
    ctaLabel: "Upload your menu",
    ctaHref: "/admin/menu-imports",
    tip: "Re-upload anytime your POS changes — each upload creates a new staged version you can review before publishing.",
  },
  publish: {
    why: "Publishing takes your reviewed, staged menu and makes it live on the public website. Until you publish, customers won't see products.",
    how: [
      "Open Menu Imports and review the staged version's product counts and any warnings.",
      "Spot-check a few products look right (names, categories, prices).",
      "Click Publish to push it live.",
      "Visit the public /menu page to confirm it looks great.",
    ],
    time: "~5 minutes",
    ctaLabel: "Review & publish",
    ctaHref: "/admin/menu-imports",
    tip: "You can always roll back to a previous published version if something looks off.",
  },
  smtp: {
    why: "Email sending powers teammate invites and order/loyalty notifications. Without it, those messages may not arrive reliably.",
    how: [
      "Create a free account at resend.com.",
      "Verify your sending domain (greenwaymarijuana.com) in Resend — turn ON “Enable Sending” only.",
      "Create an API key and add it to your environment as RESEND_API_KEY.",
      "Optionally set up the orders@ and loyalty@ aliases so notifications come from a friendly address.",
      "Redeploy, then send yourself a test invite from Users.",
    ],
    time: "~15 minutes",
    tip: "Leave Resend’s “Enable Receiving” OFF. Your site only needs to SEND email. Turning on Receiving installs mail (MX) records that can hijack your normal inbox (e.g. michael@greenwaymarijuana.com) and stop you receiving email. If you ever truly need inbound processing, do it on a subdomain like inbox.greenwaymarijuana.com. Also: if you previously shared a Resend key in chat, rotate it (create a new one, delete the old) before going live.",
  },
  team: {
    why: "Invite your staff so the right people can manage the menu, content, and orders — each with a role that limits what they can change.",
    how: [
      "Open Users and click to invite a teammate by email.",
      "Pick a role: Manager (most things), Content/Editor (content only), or Read-only (view).",
      "They'll get an email invite to set their password and sign in.",
      "You can change or remove roles anytime.",
    ],
    time: "~3 minutes",
    ctaLabel: "Invite your team",
    ctaHref: "/admin/users",
    tip: "Start least-privilege: give the smallest role that lets someone do their job, then expand if needed.",
  },
};


