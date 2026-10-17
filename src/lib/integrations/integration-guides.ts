/**
 * src/lib/integrations/integration-guides.ts
 *
 * E13 (Integrations helpers + AI). Plain-language, step-by-step setup guides for
 * each integration on the Integrations page. These render as collapsible
 * "How to connect" panels AND ground the integrations AI helper so its answers
 * stay accurate and never invent a setup flow that doesn't exist.
 *
 * Written for a non-technical owner. Only describe REAL, shipped behavior of
 * this back office and the verified third-party steps.
 */

export type IntegrationGuide = {
  /** Stable id, matches the credential/section. */
  id: string;
  /** Emoji + human title. */
  title: string;
  /** One-line "what this does". */
  summary: string;
  /** Ordered plain-language steps. */
  steps: string[];
  /** Where to do it in the back office (optional deep link). */
  href?: string;
  /** Extra reminders / gotchas. */
  notes?: string[];
};

export const INTEGRATION_GUIDES: IntegrationGuide[] = [
  {
    id: "leafly",
    title: "🍃 Leafly menu",
    summary: "Syndicate your published menu to your Leafly listing.",
    href: "/admin/integrations/leafly",
    steps: [
      "Sign in to your Leafly business account and open the menu-integration / API area.",
      "Copy your Menu Integration key (or your OAuth Client ID + Secret if Leafly gave you those instead).",
      "Paste them into the Credentials section on this page and Save. Nothing is sent to Leafly just by saving.",
      "Open ‘Leafly push & preview’ and run a Preview (dry-run) to see exactly what would be sent — this is always safe.",
      "Only after Leafly certification and your go-ahead, run a live push.",
    ],
    notes: [
      "Preview is always safe; live pushes need credentials AND explicit confirmation.",
      "Your menu must be published first (Menu Imports → Publish).",
    ],
  },
  {
    id: "weedmaps",
    title: "🗺️ WeedMaps menu",
    summary: "Syndicate your published menu to your WeedMaps listing.",
    href: "/admin/integrations/weedmaps",
    steps: [
      "Sign in to your WeedMaps back office and find your Menu ID.",
      "Get your OAuth Client ID + Secret (or a WeedMaps access token) from your WeedMaps API settings.",
      "Paste the Menu ID and credentials into the Credentials section here and Save.",
      "Open ‘WeedMaps push & preview’ and run a Preview (dry-run) to review the payload safely.",
      "Only after your go-ahead, run a live push.",
    ],
    notes: [
      "The token endpoint is the verified WeedMaps URL — no extra configuration needed.",
      "Your menu must be published first.",
    ],
  },
  {
    id: "flux",
    title: "🎨 FLUX (image + video generation)",
    summary: "Generate images and videos in the Creative Studio, the same as the BFL Playground.",
    href: "/admin/marketing/midjourney",
    steps: [
      "Create an account at Black Forest Labs (bfl.ai) and add credits.",
      "Create an API key in your BFL dashboard.",
      "Paste the key into the FLUX credentials here and Save.",
      "Optional: pick the default image model (FLUX.2 [max] is the default).",
      "Go to Marketing → Creative Studio. On FLUX Image, type your prompt (sent word for word), add references and Generate. FLUX Video makes clips.",
      "Generated images and videos land in Digital Assets (MKTG & ADV) as drafts to review before publishing.",
    ],
    notes: [
      "FLUX.2 takes up to 8 reference images per generation; FLUX 3 Image takes up to 10.",
      "Each generation is billed by BFL. Your credit balance shows in the studio (1 credit = $0.01).",
      "Safety tolerance above 2 needs BFL approval for your organisation; otherwise BFL returns an error that lists the levels you're allowed.",
      "All AI images are drafts — review before they go public.",
    ],
  },
  {
    id: "sage50",
    title: "📒 Sage 50 accounting export",
    summary: "Export a balanced General Journal CSV to import into Sage 50.",
    href: "/admin/reports/accounting",
    steps: [
      "Open Types & Categories / accounting settings and map your GL accounts (cash, cannabis-sales, sales-tax-payable).",
      "Once all required GL accounts are mapped, this integration shows ‘Ready’.",
      "Open the accounting export, pick a date range, and download the General Journal CSV.",
      "In Sage 50, import the CSV as a General Journal entry.",
    ],
    notes: ["No live API — it's a file you export here and import into Sage 50.", "Debits are +, credits are −; the file is always balanced."],
  },
  {
    id: "cultivera",
    title: "🌱 Cultivera (legacy POS transition)",
    summary: "Move off Cultivera without losing anything.",
    href: "/admin/inventory/intake",
    steps: [
      "Keep using Cultivera in parallel while you rehearse here (use Test mode on Menu Imports).",
      "Incoming vendor transfer manifests in WCIA JSON already import under Vendor Intake — no Cultivera API needed.",
      "When you're confident the back office matches, stop uploading to Cultivera and make this the system of record.",
      "CCRS remains the state's system of record via the compliance exports (weekly CSV + monthly LIQ-1295).",
    ],
    notes: ["Use Menu Imports → Test mode + Clean Slate to rehearse safely, then start fresh for real."],
  },
];

export function guideById(id: string): IntegrationGuide | undefined {
  return INTEGRATION_GUIDES.find((g) => g.id === id);
}

/** Grounding block for the integrations AI helper. */
export function integrationsGroundingBlock(): string {
  const lines: string[] = ["INTEGRATION SETUP GUIDES (the source of truth):"];
  for (const g of INTEGRATION_GUIDES) {
    lines.push(`\n## ${g.title}`);
    lines.push(`What: ${g.summary}${g.href ? ` · Page: ${g.href}` : ""}`);
    lines.push(`Steps: ${g.steps.map((s, i) => `${i + 1}. ${s}`).join(" ")}`);
    if (g.notes?.length) lines.push(`Notes: ${g.notes.join(" ")}`);
  }
  return lines.join("\n");
}
