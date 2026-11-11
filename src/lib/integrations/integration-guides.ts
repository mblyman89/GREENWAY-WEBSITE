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
  // D232 M-8 (G-90): the three merch services (SOP-11 S-2..S-11). These belong to
  // Greenway Merchandising LLC, never the cannabis licensee.
  {
    id: "printful",
    title: "👕 Printful (merch printing)",
    summary: "Prints and ships each greenwaymerch.com order one at a time for Greenway Merchandising LLC. Used by Merch Studio, Merch Inventory, Orders \u2192 Merch and Reports \u2192 Merch.",
    href: "/admin/merch-studio/launch",
    steps: [
      "Sign in at printful.com with the LLC's login (not a personal one). Stores should show one Manual order platform / API store for greenwaymerch.com (SOP-11 S-2).",
      "Billing: enter the LLC's legal info, add the LLC's card (Printful charges it when an order is confirmed) and add the Washington resale certificate (S-3).",
      "developers.printful.com/tokens \u2192 Create token named greenway-websites, access A single store, scopes orders + webhooks (+ file_library), the longest expiry. Copy it now: Printful shows it only once (S-4).",
      "Put it in Vercel as PRINTFUL_API_TOKEN in BOTH projects (main and merch), then redeploy both. PRINTFUL_STORE_ID is only needed for an Account-level token.",
      "Type the token's expiry date on Merch Health \u2192 H-3 (Printful has no API that returns it).",
      "Merch Health \u2192 H-5 \u2192 Register / repair the Printful webhook (needs PRINTFUL_WEBHOOK_TOKEN, the same value in both projects) (S-10).",
    ],
    notes: [
      "You know it worked when Merch Health H-1 to H-5 are green.",
      "Printful's private tokens expire and cannot be refreshed: make a new one before the date and replace it in both projects.",
    ],
  },
  {
    id: "stripe-merch",
    title: "💳 Stripe (merch card payments)",
    summary: "Card checkout on greenwaymerch.com under Greenway Merchandising LLC's own Stripe account. Never a dispensary account, never cannabis.",
    href: "/admin/merch-studio/launch",
    steps: [
      "dashboard.stripe.com \u2192 select the Greenway Merchandising LLC account and finish Business details (EIN, payout bank) (SOP-11 S-5).",
      "Test mode ON \u2192 Developers \u2192 API keys \u2192 copy the secret key sk_test_... (S-6).",
      "Developers \u2192 Webhooks \u2192 Add endpoint https://greenwaymerch.com/api/stripe/webhook (no www) with checkout.session.completed and checkout.session.async_payment_succeeded; copy the whsec_... signing secret (S-7).",
      "Tax \u2192 register Washington, then set MERCH_STRIPE_AUTOMATIC_TAX=true in the merch project (S-8).",
      "Merch project in Vercel: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and MERCH_SHIP_FLAT_CENTS (checkout stays closed without it), then redeploy (S-9).",
      "For the Refund and Release buttons on a merch order: MERCH_PAYMENTS_TOKEN, 32+ characters, the same value in both projects, different from MERCH_HEALTH_TOKEN; redeploy both.",
    ],
    notes: [
      "You know it worked when Merch Health H-9 to H-12 are green.",
      "Test and live mode have separate keys, endpoints and secrets: repeat S-6 and S-7 in live mode when you go live.",
      "Set MERCH_SHIP_FLAT_CENTS at or above Printful's US shipping rate: Merch Studio warns when it is lower (you pay the difference on every order).",
    ],
  },
  {
    id: "resend-merch",
    title: "✉️ Resend (merch emails)",
    summary: "Sends greenwaymerch.com's shipped emails and owner alerts from orders@greenwaymerch.com.",
    href: "/admin/merch-studio/health",
    steps: [
      "resend.com \u2192 Domains: greenwaymerch.com must say Verified. If not, add the DNS records it lists and do not delete the Google Workspace MX records (SOP-11 S-11).",
      "API Keys \u2192 a Sending access key for greenwaymerch.com \u2192 RESEND_API_KEY in the merch project.",
      "Merch project: MERCH_EMAIL_FROM = Greenway Merch <orders@greenwaymerch.com> and MERCH_ORDER_ALERT_EMAIL = orders@greenwaymerch.com, then redeploy.",
    ],
    notes: [
      "If RESEND_API_KEY or MERCH_EMAIL_FROM is missing, no email is sent at all; alerts are still stored in the back office (Orders and Merch Health).",
      "You know it worked when Merch Health H-13 is green and Resend \u2192 Emails shows the test order's shipped email as Delivered.",
    ],
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
