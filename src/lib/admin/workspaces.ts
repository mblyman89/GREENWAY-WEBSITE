/**
 * Workspaces — a plain-language, data-driven description of every major area
 * ("workspace") of the back office, keyed to the 11 navigation groups defined
 * in `src/components/admin/admin-nav-data.ts`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Dashboard "Explore your back office" quick links need a single, truthful
 * map of what the product can do and where to go for each area. Rather than
 * hand-writing that list (and letting it drift from the real nav), the surface
 * reads from here. Descriptions are grounded in docs/PROJECT_GUIDE.md — no
 * guessing.
 *
 * Each entry names the nav group, a one-line "what it's for", a short list of
 * the concrete things you do there, an emoji, the landing route, and the
 * permission that gates it (so the tour can be permission-filtered exactly like
 * the top nav).
 */
import type { AdminNavItem } from "@/components/admin/admin-nav-data";
import type { Permission } from "@/lib/auth/roles";

export type Workspace = {
  /** Matches AdminNavItem["group"]. */
  group: AdminNavItem["group"];
  /** Short, friendly heading (may differ slightly from the raw group label). */
  title: string;
  /** One-sentence "what this area is for". */
  summary: string;
  /** A few concrete tasks you do here (kept scannable). */
  does: string[];
  /** Emoji used as the card glyph (matches the nav's visual language). */
  icon: string;
  /** Where "Open" takes you — the most useful landing page for the area. */
  href: string;
  /** Permission required to use this area (gates visibility). */
  permission: Permission;
};

export const WORKSPACES: Workspace[] = [
  {
    group: "Dashboard",
    title: "Dashboard",
    summary:
      "Your daily front-of-house cockpit — today's sales, what needs attention, open online orders, and live registers.",
    does: [
      "See today's revenue, orders, and top sellers at a glance",
      "Work online orders and loyalty signups",
      "Print one-page SOPs for truck day and every intake stage",
    ],
    icon: "📊",
    href: "/admin",
    permission: "dashboard.view",
  },
  {
    group: "Reports",
    title: "Reports",
    summary:
      "Every report and export in one hub: sales, tax, excise, COGS, customers, employees, loyalty, medical, compliance, forecast, and the Sage 50 accounting export.",
    does: [
      "Pull sales, tax, and COGS reports",
      "Prepare the excise return and the Sage 50 journal",
      "Forecast demand and review compliance",
    ],
    icon: "📈",
    href: "/admin/reports",
    permission: "reports.view",
  },
  {
    group: "CRM",
    title: "Customers & loyalty",
    summary:
      "Build customer and patient profiles and run your loyalty program — the foundation for purchase history and rewards.",
    does: [
      "Add or import customers and patients",
      "Manage loyalty points, tiers, and redemptions",
      "Review loyalty signups from the website",
    ],
    icon: "👥",
    href: "/admin/customers",
    permission: "customers.manage",
  },
  {
    group: "Product Intake",
    title: "Product intake",
    summary:
      "The full product lifecycle, top to bottom: discover, benchmark, purchase, receive, onboard, enrich, master, and pay the vendor.",
    does: [
      "Discover products and benchmark statewide CCRS prices",
      "Raise purchase orders and receive transfers with manifests",
      "Enrich and master products, then pay vendors (ACH)",
    ],
    icon: "🗂️",
    href: "/admin/catalog",
    permission: "products.enrich",
  },
  {
    group: "Inventory",
    title: "Inventory",
    summary:
      "Cannabis lots with COAs and traceability, plus non-cannabis goods, vendors, categories, cycle counts, and lawful returns/destruction.",
    does: [
      "Track cannabis lots and non-cannabis accessories",
      "Manage vendors, brands, types, and categories",
      "Run blind cycle counts and record disposition",
    ],
    icon: "📦",
    href: "/admin/inventory",
    permission: "inventory.manage",
  },
  {
    group: "Website",
    title: "Website",
    summary:
      "Safe editors for every public page (Home, Menu, Loyalty, Specials, Vendors, FAQ, About, Locations, Price Match), plus the Media Library and Site Content — with preview before publish.",
    does: [
      "Edit public pages without touching code",
      "Manage images in the Media Library",
      "Preview unpublished changes before they go live",
    ],
    icon: "🖥️",
    href: "/admin/content",
    permission: "content.edit",
  },
  {
    group: "MKTG & ADV",
    title: "Marketing & advertising",
    summary:
      "AI-assisted, WA-compliant marketing: strategy drafts, promotions, blog and newsletter, and an image generator — all preview-before-publish.",
    does: [
      "Draft WA-compliant marketing strategies with AI",
      "Build daily deals and clearance promotions",
      "Write blog posts, send newsletters, generate images",
    ],
    icon: "📣",
    href: "/admin/marketing",
    permission: "content.edit",
  },
  {
    group: "Employee",
    title: "Employees",
    summary:
      "The employee command center: hiring & onboarding checklists, documents, training, handbook, schedules, time clock, payroll (ACH), and offboarding.",
    does: [
      "Run onboarding (offer → background check → I-9/W-4 → handbook → badge)",
      "Clock in/out, build schedules, and track paid sick leave",
      "Handle terminations with a guided offboarding checklist",
    ],
    icon: "🕐",
    href: "/admin/staffing",
    permission: "timeclock.use",
  },
  {
    group: "Medical",
    title: "Medical",
    summary:
      "Patient tools that follow separate DOH rules: medical recognition cards and new authorization intake.",
    does: [
      "Keep DOH-compliant patient records",
      "Take in new medical authorizations",
      "Apply higher medical purchase limits",
    ],
    icon: "🏥",
    href: "/admin/medical",
    permission: "medical.manage",
  },
  {
    group: "CCRS",
    title: "Compliance health",
    summary:
      "A single at-a-glance view of your WA traceability (CCRS) reporting health, so nothing slips.",
    does: [
      "Check CCRS reporting readiness",
      "Spot gaps before they become violations",
      "Jump to the report that needs attention",
    ],
    icon: "🛡️",
    href: "/admin/compliance/health",
    permission: "reports.view",
  },
  {
    group: "Admin",
    title: "Admin & settings",
    summary:
      "Run the business: users and roles, integrations, equipment, sales limits, AI usage, the audit log, settings, help, and menu imports.",
    does: [
      "Invite teammates and set roles",
      "Configure integrations, equipment, and store settings",
      "Review the audit log and AI usage",
    ],
    icon: "⚙️",
    href: "/admin/settings",
    permission: "settings.manage",
  },
];
