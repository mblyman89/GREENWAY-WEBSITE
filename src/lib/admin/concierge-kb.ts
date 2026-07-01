/**
 * src/lib/admin/concierge-kb.ts
 *
 * E5 (Global AI chatbot). A plain-language knowledge base that grounds the
 * GLOBAL concierge so it can help with the WHOLE product — the back office, the
 * public website, compliance, and the (planned) POS — not just first-time
 * setup. Written for a non-technical owner/employee, in "baby steps".
 *
 * This is the source of truth the concierge is allowed to draw on. Keeping it
 * here (data, not prose in a prompt) means we can grow the assistant's coverage
 * without touching the model wiring, and the answers stay grounded in features
 * that ACTUALLY exist. Each topic maps to a real admin area.
 *
 * IMPORTANT: describe only real, shipped behavior. If a feature is planned but
 * not built (e.g. the POS), say so plainly so the concierge doesn't imply it
 * exists today.
 */

export type ConciergeTopic = {
  /** Stable id. */
  id: string;
  /** Which part of the product. */
  area: "back-office" | "website" | "compliance" | "pos" | "ai";
  /** Short human title. */
  title: string;
  /** Where in the admin this lives (if applicable). */
  href?: string;
  /** Plain-language explanation + how-to, one idea per line. */
  facts: string[];
  /** Whether this describes something not yet built. */
  planned?: boolean;
};

export const CONCIERGE_KB: ConciergeTopic[] = [
  // ── Navigation / orientation ───────────────────────────────────────────
  {
    id: "nav",
    area: "back-office",
    title: "Finding your way around",
    facts: [
      "The top navigation is grouped into tabs: Sell, Inventory, Compliance, Finance, Marketing, Website, Insights, and Admin.",
      "Hover a tab to open its menu; each menu item opens a page.",
      "There is a Quick Search circle (bottom-left) — press ⌘K (Mac) or Ctrl+K (Windows) to jump to any page fast.",
      "The '?' button (bottom-left) opens contextual help for the page you're on.",
    ],
  },
  {
    id: "dashboard",
    area: "back-office",
    title: "Dashboard & getting started",
    href: "/admin/getting-started",
    facts: [
      "Getting Started walks you through connecting the database, running migrations, importing your menu, publishing it, email, and inviting staff.",
      "Each step turns green automatically once it's done.",
    ],
  },

  // ── Inventory / menu ────────────────────────────────────────────────────
  {
    id: "menu-imports",
    area: "back-office",
    title: "Menu imports (POS export → staged menu)",
    href: "/admin/menu-imports",
    facts: [
      "Upload your POS PRODUCTS and INVENTORIES exports here; the system stages them into a draft menu version for review.",
      "Nothing goes public until you Publish. You can roll back to a previous published version.",
      "Re-upload anytime your POS changes — each upload is a new staged version.",
    ],
  },
  {
    id: "intake",
    area: "back-office",
    title: "Inventory intake & vendor manifests",
    href: "/admin/inventory/intake",
    facts: [
      "When a delivery arrives, open the matching intake to record the transport manifest details required by WAC 314-55-085 (driver, vehicle, plate, departed/arrived times).",
      "The origin/transporter license number and name auto-fill from the linked vendor when you've saved that vendor's WA license number.",
    ],
  },
  {
    id: "knowledge-base",
    area: "back-office",
    title: "Product knowledge base & strains",
    href: "/admin/knowledge-base",
    facts: [
      "Strain types include Indica, Sativa, Hybrid, plus the customer-friendly 'indica leaning hybrid' and 'sativa leaning hybrid'.",
      "The leaning labels show on the website and in the US, but they always map to Hybrid when you export to CCRS.",
    ],
  },

  // ── Marketing ─────────────────────────────────────────────────────────
  {
    id: "marketing",
    area: "back-office",
    title: "Marketing & Advertising",
    href: "/admin/marketing",
    facts: [
      "The Marketing & Advertising page has an AI strategist: type a goal (e.g. 'grow our newsletter list') and get a Washington-compliant strategy DRAFT grounded in your real store and vendors.",
      "Every plan is scanned against WA advertising rules before it appears; plans with health/medical or minor-appealing angles are withheld.",
      "Save good plans to your idea notebook and triage them (idea → planned → done).",
      "The Image prompt builder (Marketing → Midjourney) drafts image briefs and can generate images with FLUX.",
    ],
  },
  {
    id: "newsletter",
    area: "back-office",
    title: "Newsletter & engagement",
    href: "/admin/newsletter",
    facts: [
      "The Newsletter Send center now shows Engagement stats for the last 90 days (opens/clicks). A 'Full report' link opens the detailed customer newsletter report.",
    ],
  },

  // ── Finance ──────────────────────────────────────────────────────────
  {
    id: "payroll",
    area: "back-office",
    title: "Payroll (ACH)",
    href: "/admin/payroll",
    facts: [
      "Enter each employee's pay totals (net/gross/taxes) and banking once; the system builds a NACHA direct-deposit file to upload to your bank.",
      "Amounts are handled in cents. The originating bank/company block is set once in the ACH company settings.",
    ],
  },
  {
    id: "vendor-payments",
    area: "back-office",
    title: "Vendor Payments (ACH)",
    href: "/admin/vendor-payments",
    facts: [
      "Pay vendors by building a NACHA (CCD) file: add each vendor's name, routing, account, and amount, then download the file for your bank.",
      "It reuses the same bank/company settings as Payroll — you only configure your bank once.",
    ],
  },

  // ── Compliance (always applies) ──────────────────────────────────────
  {
    id: "ccrs",
    area: "compliance",
    title: "CCRS reporting",
    href: "/admin/compliance/health",
    facts: [
      "CCRS has no live API — reporting is a CSV a human uploads to the state's SAW/CCRS portal.",
      "Cadence: a weekly batch (Sunday–Saturday, due the following Sunday) plus the monthly LIQ-1295.",
      "Before uploading, the system runs a DO-NOT-UPLOAD check that blocks a batch with errors, so you never submit a bad file.",
      "CCRS strain types are only Indica, Sativa, or Hybrid — friendly 'leaning' labels collapse to Hybrid on export.",
    ],
  },
  {
    id: "compliance-general",
    area: "compliance",
    title: "Washington advertising & DOH rules",
    facts: [
      "No health, medical, therapeutic, or curative claims anywhere (menu, marketing, signage).",
      "Nothing that appeals to minors; no associations with alcohol or tobacco; adults 21+ only.",
      "The AI copy and strategy tools enforce these automatically and refuse prohibited output.",
    ],
  },

  // ── Website ──────────────────────────────────────────────────────────
  {
    id: "website-pages",
    area: "website",
    title: "Editing the public website",
    href: "/admin/pages/home",
    facts: [
      "Each public page (Home, Menu, Loyalty, Specials, Vendors, FAQ, About, Locations, Price Match) has its own editor under the Website tab.",
      "Preview mode shows unpublished edits with a glowing badge in the bottom-right; click it to exit preview.",
    ],
  },

  // ── POS (PLANNED — not built yet) ────────────────────────────────────
  {
    id: "pos",
    area: "pos",
    planned: true,
    title: "Point of Sale (planned)",
    facts: [
      "The in-store POS is PLANNED, not built yet — we're finishing back-office enhancements first, then discussing the POS approach.",
      "The current recommendation is a Capacitor iPad app that reuses the same compliance logic as the web back office, works offline, and drives the hardware.",
      "Planned hardware: Star TSP143IIIBi receipt printer, Socket DuraScan D760 scanner, iPad Pro 12.9\", and a cash drawer that opens from the printer on sale completion.",
      "Payments are cash-only today; a generic, provider-agnostic card pipeline is planned for when cannabis card payments are allowed.",
    ],
  },

  // ── AI itself ────────────────────────────────────────────────────────
  {
    id: "ai",
    area: "ai",
    title: "How the AI helpers work",
    facts: [
      "AI features are drafts-only and grounded in your real data — they never invent facts and always pass a compliance scan.",
      "If an AI feature is greyed out, an AI key (AI_API_KEY or OPENAI_API_KEY) isn't set in the environment.",
      "You can see AI usage and cost under Insights → AI Usage.",
    ],
  },
];

/** Render the KB as a grounding block for the model. */
export function conciergeGroundingBlock(): string {
  const lines: string[] = ["BACK-OFFICE KNOWLEDGE BASE (the source of truth):"];
  for (const t of CONCIERGE_KB) {
    lines.push(`\n## ${t.title}${t.planned ? " (PLANNED — not built yet)" : ""}`);
    lines.push(`Area: ${t.area}${t.href ? ` · Page: ${t.href}` : ""}`);
    for (const f of t.facts) lines.push(`- ${f}`);
  }
  return lines.join("\n");
}
