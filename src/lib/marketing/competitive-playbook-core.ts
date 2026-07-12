/**
 * competitive-playbook-core.ts — pure content + tests for the "win your market"
 * playbook on the marketing command center.
 *
 * Task S-d: the owner asked for help beating nearby competitors ("I need to
 * know how to crush my enemies"). In WA cannabis retail, the levers that are
 * both LEGAL and durable are: price perception, product curation, speed &
 * experience, an owned audience (email/loyalty — competitors can't touch it),
 * and local search visibility. Every play below maps to a tool that already
 * exists in THIS back office, so nothing here is aspirational fluff — each
 * play links to the page where the owner executes it.
 *
 * Compliance guardrail: plays never suggest anything WAC 314-55-155 bans
 * (no giveaways of product, no below-cost coupons, no youth appeal, no
 * out-of-state targeting). The campaign-rules-core module carries the rules;
 * this module carries the strategy.
 */

export type PlayCategory = "intel" | "price" | "retention" | "experience" | "visibility";

export const PLAY_CATEGORY_LABELS: Record<PlayCategory, string> = {
  intel: "Know the battlefield",
  price: "Win on price perception",
  retention: "Lock in your regulars",
  experience: "Out-serve everyone",
  visibility: "Own local search",
};

export type CompetitivePlay = {
  key: string;
  category: PlayCategory;
  title: string;
  /** Why this play hurts competitors — the honest mechanism. */
  why: string;
  /** Concrete steps the owner can run this week. */
  steps: string[];
  /** Where in THIS back office the play is executed. */
  tool: { label: string; href: string } | null;
  /** Cadence the play should run on. */
  cadence: "weekly" | "monthly" | "quarterly" | "once";
};

export const COMPETITIVE_PLAYS: readonly CompetitivePlay[] = [
  {
    key: "ccrs_market_intel",
    category: "intel",
    title: "Read the whole market's sales data — legally",
    why:
      "CCRS data is public record: it shows what every WA retailer is actually selling — top movers, rising brands, price bands. Most competitors never look. You already have the analysis tooling built in.",
    steps: [
      "Upload the latest monthly CCRS zip in Product Discovery → CCRS Benchmarks",
      "Check the market movers: which products/brands are climbing statewide that you don't carry yet",
      "Cross-reference against your own top sellers — stock the risers before the shop up the road does",
      "Repeat every month when the new data drops",
    ],
    tool: { label: "CCRS Benchmarks", href: "/admin/discovery/benchmarks" },
    cadence: "monthly",
  },
  {
    key: "menu_recon",
    category: "intel",
    title: "Run a standing competitor menu recon",
    why:
      "Competitors publish their whole strategy on their public menus: price points, brands, deals. Twenty minutes a week tells you exactly where they're vulnerable — thin categories, stale menus, weak deals.",
    steps: [
      "Pick your 3 nearest competitors and check their public menus weekly (same day each week)",
      "Note their price on the 10 items you both carry — track it in a simple sheet",
      "Spot their gaps: categories they're thin on are categories you promote",
      "A stale menu (items unchanged for weeks) means slow inventory — hit that category hard",
    ],
    tool: null,
    cadence: "weekly",
  },
  {
    key: "kvi_pricing",
    category: "price",
    title: "Price the items people compare — hold margin everywhere else",
    why:
      "Customers judge your whole store on a handful of known-value items (the popular flower eighths, top vape carts, common edibles). Be sharpest there and the 'expensive' label lands on your competitors, while the rest of the menu carries normal margin.",
    steps: [
      "Identify your 10–15 most cross-shopped items from your own sales reports",
      "Match or narrowly beat the competitor price on exactly those — never below your acquisition cost (that's illegal, and the POS enforces the floor)",
      "Take margin on everything unique to you: house favorites, exclusive brands, bundles",
      "Re-check after every competitor recon pass",
    ],
    tool: { label: "Reports", href: "/admin/reports" },
    cadence: "weekly",
  },
  {
    key: "vendor_exclusives",
    category: "price",
    title: "Carry what they can't",
    why:
      "You can't be undercut on a product only you carry. Use vendor relationships and the discovery pipeline to land brands and drops your competitors don't have — exclusivity beats a price war.",
    steps: [
      "Work the vendor leads pipeline for brands rising in CCRS that no one nearby carries",
      "Ask your best vendors about first-in-area drops or short exclusives",
      "Promote exclusives on the newsletter the day they land — 'only at Greenway' is a legal, powerful claim when true",
    ],
    tool: { label: "Product Discovery", href: "/admin/discovery" },
    cadence: "monthly",
  },
  {
    key: "loyalty_moat",
    category: "retention",
    title: "Make switching stores feel expensive",
    why:
      "A customer with a points balance thinks twice before buying elsewhere. Loyalty turns your best customers — the ones competitors most want to poach — into your most defended asset.",
    steps: [
      "Get every regular signed up at the register (the POS prompts for it)",
      "Watch redemption behavior in loyalty metrics: members who stopped earning are drifting to a competitor — win them back by email before they're gone",
      "Keep earn/redeem simple enough for staff to explain in one sentence",
    ],
    tool: { label: "Loyalty", href: "/admin/loyalty" },
    cadence: "weekly",
  },
  {
    key: "newsletter_moat",
    category: "retention",
    title: "Build the audience no platform can delete",
    why:
      "Social accounts get banned; the algorithm buries you. Your email list is the one growth channel you own outright — and most cannabis retailers are terrible at it, which makes it your cheapest advantage.",
    steps: [
      "Grow the list at the counter and on the website (21+ opt-in only)",
      "Send one genuinely useful email a week: new drops, staff picks, education — not just discounts",
      "Watch opens/clicks and cut what nobody reads",
      "Every send must carry the 21+ line and the four required warnings — the campaign planner has the checklist",
    ],
    tool: { label: "Email Newsletter", href: "/admin/newsletter" },
    cadence: "weekly",
  },
  {
    key: "speed_experience",
    category: "experience",
    title: "Be the fastest, most knowledgeable stop in town",
    why:
      "Price gets people in once; experience brings them back. Budtenders who know the menu cold, short lines, and accurate online stock are things a discount-warehouse competitor can't fake.",
    steps: [
      "Train every budtender on the top 20 products (the training log tracks it — it's also a compliance record)",
      "Keep the online menu accurate so nobody drives in for an out-of-stock item",
      "Track your busiest hours in reports and staff the rush properly with the schedule builder",
    ],
    tool: { label: "Employees", href: "/admin/staffing/employees" },
    cadence: "monthly",
  },
  {
    key: "google_profile",
    category: "visibility",
    title: "Win the '(dispensary) near me' search",
    why:
      "For most new customers the real battle is the local map results. Reviews, hours accuracy, and photos decide it — and it's free. A 4.8-star profile with 400 reviews beats any billboard.",
    steps: [
      "Claim/verify the Google Business Profile; keep hours, phone, and site perfect",
      "Ask happy customers to leave a review (asking is fine — buying reviews is not)",
      "Respond to every review, especially bad ones, in a professional tone — future customers read the responses more than the reviews",
      "Post exterior/interior photos: people check the vibe before a first visit (no product depictions in the photos, and no youth-appealing content)",
    ],
    tool: null,
    cadence: "weekly",
  },
  {
    key: "own_the_story",
    category: "visibility",
    title: "Publish what customers search for",
    why:
      "Educational content ('what are terpenes', 'live resin vs distillate') brings in search traffic competitors ignore, and positions your store as the knowledgeable one. It's compliant because education isn't a medical claim.",
    steps: [
      "Publish one educational post a month on the blog — factual, 21+, no effect/health claims",
      "Repurpose each post into a newsletter section and in-store talking points",
      "Let the AI draft assistant produce the first draft; you review before anything ships",
    ],
    tool: { label: "Blog", href: "/admin/blog" },
    cadence: "monthly",
  },
] as const;

export function playsByCategory(): { category: PlayCategory; label: string; plays: CompetitivePlay[] }[] {
  const order: PlayCategory[] = ["intel", "price", "retention", "experience", "visibility"];
  return order.map((category) => ({
    category,
    label: PLAY_CATEGORY_LABELS[category],
    plays: COMPETITIVE_PLAYS.filter((p) => p.category === category),
  }));
}

/* ------------------------------------------------------------------ */
/* Self-tests                                                          */
/* ------------------------------------------------------------------ */

export function __runCompetitivePlaybookTests(): number {
  let n = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`competitive-playbook self-test failed: ${msg}`);
    n += 1;
  };

  // Keys unique, all fields populated.
  const keys = COMPETITIVE_PLAYS.map((p) => p.key);
  assert(new Set(keys).size === keys.length, "play keys unique");
  assert(COMPETITIVE_PLAYS.length >= 8, "at least eight plays");
  for (const p of COMPETITIVE_PLAYS) {
    assert(p.title.length > 0 && p.why.length > 0, `${p.key} has title+why`);
    assert(p.steps.length >= 2, `${p.key} has concrete steps`);
    assert(
      p.tool === null || (p.tool.href.startsWith("/admin/") && p.tool.label.length > 0),
      `${p.key} tool link is an in-app admin route`,
    );
  }

  // Every category has at least one play, and grouping preserves all plays.
  const grouped = playsByCategory();
  assert(grouped.length === 5, "five categories");
  assert(
    grouped.every((g) => g.plays.length > 0),
    "every category populated",
  );
  assert(
    grouped.reduce((sum, g) => sum + g.plays.length, 0) === COMPETITIVE_PLAYS.length,
    "grouping loses nothing",
  );

  // Compliance guardrails: no play ever suggests banned tactics.
  const allText = COMPETITIVE_PLAYS.map(
    (p) => `${p.title} ${p.why} ${p.steps.join(" ")}`,
  )
    .join(" ")
    .toLowerCase();
  assert(!allText.includes("free cannabis"), "never gives away product");
  assert(!allText.includes("below cost") || allText.includes("never below your acquisition cost"), "cost floor respected");
  assert(!allText.includes("buy reviews") && allText.includes("buying reviews is not"), "no review buying");

  // The cost-floor play explicitly carries the legal floor language.
  const kvi = COMPETITIVE_PLAYS.find((p) => p.key === "kvi_pricing");
  assert(
    Boolean(kvi && kvi.steps.some((s) => s.includes("never below your acquisition cost"))),
    "KVI play pins the acquisition-cost floor",
  );

  return n;
}
