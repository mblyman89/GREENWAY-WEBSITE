/**
 * campaign-rules-core.ts — pure, testable WA cannabis advertising rules per channel.
 *
 * Task S-d. Every rule below was verified against the CURRENT text of
 * WAC 314-55-155 (scraped from app.leg.wa.gov — WSR 26-12-082, effective
 * 7/4/26) and RCW 69.50.369. Nothing is guessed. This module is the single
 * source of truth the marketing command center renders, so the owner gets a
 * concrete per-channel checklist instead of vague "be compliant" advice.
 *
 * Key provisions encoded here:
 *  - (2)(a) universal content bans: false/misleading, over-consumption,
 *    alcohol/tobacco/motor-vehicle portrayals, LCB-lookalike, curative or
 *    therapeutic claims, anything appealing to minors;
 *  - (2)(b) placement bans: within 1,000 ft of schools/playgrounds/parks/etc.,
 *    and on/in transit vehicles, shelters, stations;
 *  - (2)(c) every ad except trade name signs must carry a clearly visible
 *    "21+" statement;
 *  - (2)(d) no targeting out-of-state persons;
 *  - (3)(a) on-premises signage: max FOUR signs, 1,600 sq in each, main-
 *    entrance side, no depictions of cannabis plants/products on outdoor
 *    signs; window-facing merchandising visible from the right-of-way counts;
 *  - (3)(e) signs under 512 sq in with only informational content (hours,
 *    open/closed, ATM, welcome…) are NOT advertising;
 *  - (4) billboards + up to two trade name signs (RCW 69.50.369): text limited
 *    to trade name, location, nature of business;
 *  - (5) giveaways banned except incidental items: paraphernalia, <$1,
 *    bought at fair market value, retailer-only branding, in-store
 *    merchandising only, not conditioned on purchase; coupons may never
 *    discount below acquisition cost;
 *  - (7) four mandated warnings, type size ≥10% of the largest type, on ALL
 *    advertising except outdoor.
 */

export type CampaignChannel =
  | "newsletter"
  | "website"
  | "in_store"
  | "outdoor_sign"
  | "billboard"
  | "social"
  | "giveaway"
  | "event";

/** WAC 314-55-155(7) — required on all advertising EXCEPT outdoor. */
export const REQUIRED_WARNINGS: readonly string[] = [
  "This product has intoxicating effects and may be habit forming.",
  "Cannabis can impair concentration, coordination, and judgment. Do not operate a vehicle or machinery under the influence of this drug.",
  "There may be health risks associated with consumption of this product.",
  "For use only by adults 21 and older. Keep out of the reach of children.",
];

/** WAC 314-55-155(2)(a) — banned in ALL cannabis advertising, every channel. */
export const UNIVERSAL_CONTENT_BANS: readonly string[] = [
  "False or misleading statements",
  "Anything that promotes over-consumption",
  "Portraying alcohol, tobacco/nicotine, or their use",
  "Any association with a motor vehicle or driving",
  "Mimicking LCB or other state-agency logos or messaging",
  "Curative or therapeutic claims — cannabis never treats, cures, relieves, or helps any condition",
  "Anything appealing to minors: cartoons, toys, movie characters, candy/kid comparisons, youthful slang, or depicting anyone under 21",
];

export type ChannelRule = {
  channel: CampaignChannel;
  label: string;
  /** What this channel is legally good for — the honest upside. */
  edge: string;
  /** Hard requirements before anything ships on this channel. */
  requirements: string[];
  /** Channel-specific prohibitions on top of the universal bans. */
  prohibitions: string[];
  /** Whether the four WAC 314-55-155(7) warnings are required here. */
  warningsRequired: boolean;
  /** Plain-language note on the warnings decision for this channel. */
  warningsNote: string;
};

export const CHANNEL_RULES: readonly ChannelRule[] = [
  {
    channel: "newsletter",
    label: "Email newsletter",
    edge:
      "Your highest-leverage channel: subscribers opted in, age isn't in question the way it is on social, and nobody can take the list away from you.",
    requirements: [
      "Send only to people who signed up themselves (your in-store / website signups)",
      "Include a clearly visible 21+ statement (WAC 314-55-155(2)(c))",
      "Include all four warnings at ≥10% of the largest type size (WAC 314-55-155(7))",
      "Keep sends to Washington residents — no marketing that targets out-of-state persons (WAC 314-55-155(2)(d))",
      "Working unsubscribe link (CAN-SPAM)",
    ],
    prohibitions: [
      "No purchased or scraped email lists — recipients must be your verified 21+ audience",
      "Coupons may never price a product below your acquisition cost (WAC 314-55-155(5)(g))",
    ],
    warningsRequired: true,
    warningsNote: "Email is advertising, not outdoor — all four warnings required.",
  },
  {
    channel: "website",
    label: "Website & online menu",
    edge:
      "Your menu is your storefront for everyone who searches before they drive. Fast, accurate, and always on — and it feeds your Google presence.",
    requirements: [
      "Visible 21+ statement on the site (WAC 314-55-155(2)(c))",
      "All four warnings at ≥10% of the largest type size (WAC 314-55-155(7)) — the site footer block",
      "Keep product info factual: strain, format, THC/CBD from the label — nothing more",
    ],
    prohibitions: [
      "No health/medical/therapeutic claims anywhere, including product descriptions",
      "No content targeting out-of-state customers",
    ],
    warningsRequired: true,
    warningsNote: "The website/menu is an advertising surface — warnings footer required.",
  },
  {
    channel: "in_store",
    label: "In-store signage & experience",
    edge:
      "Inside your four walls (not visible from the street) is your freest surface — merchandising, education, staff picks, loyalty prompts.",
    requirements: [
      "Anything placed on an inside window surface facing OUT, or clearly visible from the public right-of-way, counts as one of your four outdoor signs (WAC 314-55-155(3)(a)(i))",
      "Keep required LCB notices and the 21+ entry signage posted",
    ],
    prohibitions: [
      "No free cannabis product to recreational customers — ever",
      "Non-infused representative samples (edibles/topicals only) are the only sampling allowed (WAC 314-55-155(5)(h))",
    ],
    warningsRequired: false,
    warningsNote:
      "Pure interior merchandising not visible from the right-of-way isn't 'outdoor advertising' — but keep it factual and 21+.",
  },
  {
    channel: "outdoor_sign",
    label: "On-premises outdoor signs",
    edge:
      "Four signs that tell people who you are and that you're open — plus unlimited sub-512-sq-in informational signs (hours, open/closed, ATM, welcome).",
    requirements: [
      "Maximum FOUR advertising signs, each ≤1,600 square inches, affixed to the building or in windows on the main-entrance side (WAC 314-55-155(3)(a))",
      "Text limited to trade name, location info, and the type/nature of the business (WAC 314-55-155(3)(a)(ii))",
      "Signs under 512 sq in with ONLY informational content (hours, open/closed, ATM, 'welcome', required notices) don't count as advertising (WAC 314-55-155(3)(e))",
    ],
    prohibitions: [
      "No depictions of cannabis plants or products on any outdoor sign (WAC 314-55-155(3)(a)(iii))",
      "No commercial mascot outside or near the store (WAC 314-55-155(3)(b))",
      "No signs in arenas, stadiums, malls, state-funded fairs, farmers markets, or arcades (WAC 314-55-155(3)(c))",
    ],
    warningsRequired: false,
    warningsNote: "Outdoor advertising is exempt from the four warnings (WAC 314-55-155(7)).",
  },
  {
    channel: "billboard",
    label: "Billboards & trade name signs",
    edge:
      "Billboards plus up to two trade name signs (RCW 69.50.369) put your name on the map — literally. Content is tightly limited, so treat them as wayfinding.",
    requirements: [
      "Text limited to trade name, business location, and nature of the business (WAC 314-55-155(3)(a)(ii))",
      "Trade name signs: business trade name as licensed; logo/artwork allowed only if it doesn't depict cannabis (WAC 314-55-155(1)(d), (4)(b))",
      "Size/placement per local zoning (city/county regulates, WAC 314-55-155(4)(a))",
      "1,000-ft rule: nowhere within 1,000 ft of schools, playgrounds, rec centers, child care, parks, libraries, or all-ages arcades (WAC 314-55-155(2)(b)(i))",
    ],
    prohibitions: [
      "No product brand names on trade name signs (WAC 314-55-155(4)(b))",
      "No cannabis plant/product imagery",
      "Not on/in vehicles, transit shelters, bus stops, taxi stands, stations, airports (WAC 314-55-155(2)(b)(ii))",
    ],
    warningsRequired: false,
    warningsNote: "Outdoor — warnings exempt, but content limits are the strictest of any channel.",
  },
  {
    channel: "social",
    label: "Social media (organic only)",
    edge:
      "Free reach for brand personality, education, and community — but platforms can delete you overnight, so social should feed your email list, never replace it.",
    requirements: [
      "Organic posts only — the major platforms refuse paid cannabis ads, and boosting risks the account",
      "Age-gate everything you control: 21+ statement in the bio AND on posts (WAC 314-55-155(2)(c))",
      "All four warnings apply — put them in the post or clearly in the profile (WAC 314-55-155(7))",
      "Keep the audience Washington: no out-of-state targeting",
    ],
    prohibitions: [
      "No giveaways/contests of cannabis product — that's a banned promotional giveaway (WAC 314-55-155(5))",
      "No engagement bait aimed at a general (unverified-age) audience",
    ],
    warningsRequired: true,
    warningsNote: "Social posts are advertising — warnings required, 10% type-size rule applies.",
  },
  {
    channel: "giveaway",
    label: "Swag & incidental items",
    edge:
      "Branded incidental items keep your name in customers' pockets — the rules are narrow but workable.",
    requirements: [
      "Item must qualify as paraphernalia under RCW 69.50.102 (e.g. matches) (WAC 314-55-155(5)(a))",
      "You must have bought it at fair market value (5)(c)",
      "Branding: YOUR retail brand only — no producer/processor brands or product logos (5)(d)",
      "Value under one U.S. dollar (5)(e)",
      "Advertised only via in-store merchandising (5)(b)",
    ],
    prohibitions: [
      "Never conditioned on a purchase (5)(f)",
      "Never free cannabis product to recreational customers",
      "Coupons may never take a product below your acquisition cost (5)(g)",
    ],
    warningsRequired: false,
    warningsNote: "Incidental items aren't ad copy — but any flyer promoting them in-store is.",
  },
  {
    channel: "event",
    label: "Events & adult-only venues",
    edge:
      "Adult-only (21+) facilities are the one place event advertising opens up — vendor days in-store are even simpler.",
    requirements: [
      "Event ads at the venue only while it's an adult-only facility, placed no more than 14 days before the event (WAC 314-55-155(3)(d))",
      "Event advertising identifies the event by business/trade/brand name only",
      "Advertising at the venue must not be visible from outside it",
    ],
    prohibitions: [
      "No sponsorship placements in arenas, stadiums, malls, state-funded fairs, farmers markets, arcades (3)(c)",
      "No 'Adopt-a-Highway'-style workarounds beyond the actual WSDOT program (3)(f)",
    ],
    warningsRequired: true,
    warningsNote: "Non-outdoor event collateral (flyers, emails) still needs the four warnings.",
  },
] as const;

export function channelRule(channel: CampaignChannel): ChannelRule {
  const rule = CHANNEL_RULES.find((r) => r.channel === channel);
  if (!rule) throw new Error(`Unknown campaign channel: ${channel}`);
  return rule;
}

/**
 * Pre-flight checklist for a campaign on a channel: universal bans +
 * channel requirements + warnings block when required. This is what the
 * command center renders as check-me-off items.
 */
export function campaignChecklist(channel: CampaignChannel): string[] {
  const rule = channelRule(channel);
  const items: string[] = [];
  items.push(...rule.requirements);
  if (rule.warningsRequired) {
    items.push(
      "Include all four required warnings, each at least 10% of the largest type size in the ad",
    );
  }
  items.push(
    "Scan the copy against the universal bans (no medical claims, nothing youth-appealing, no alcohol/tobacco/vehicle imagery, nothing false or misleading)",
  );
  return items;
}

/* ------------------------------------------------------------------ */
/* Self-tests                                                          */
/* ------------------------------------------------------------------ */

export function __runCampaignRulesTests(): number {
  let n = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`campaign-rules self-test failed: ${msg}`);
    n += 1;
  };

  // Exactly the four statutory warnings, verbatim anchors.
  assert(REQUIRED_WARNINGS.length === 4, "four warnings");
  assert(
    REQUIRED_WARNINGS[0].includes("intoxicating effects") &&
      REQUIRED_WARNINGS[1].includes("Do not operate a vehicle") &&
      REQUIRED_WARNINGS[2].includes("health risks") &&
      REQUIRED_WARNINGS[3].includes("21 and older"),
    "warning texts pinned",
  );

  // Universal bans include the big three the owner must never trip.
  const bans = UNIVERSAL_CONTENT_BANS.join(" | ").toLowerCase();
  assert(bans.includes("curative or therapeutic"), "therapeutic-claims ban present");
  assert(bans.includes("minors"), "youth-appeal ban present");
  assert(bans.includes("false or misleading"), "false/misleading ban present");

  // Every channel present exactly once, all fields populated.
  const channels = CHANNEL_RULES.map((r) => r.channel);
  assert(new Set(channels).size === channels.length, "channels unique");
  assert(channels.length === 8, "eight channels covered");
  for (const r of CHANNEL_RULES) {
    assert(r.requirements.length > 0, `${r.channel} has requirements`);
    assert(r.prohibitions.length > 0, `${r.channel} has prohibitions`);
    assert(r.edge.length > 0 && r.warningsNote.length > 0, `${r.channel} has prose`);
  }

  // Warnings map: required on newsletter/website/social/event; exempt outdoor.
  assert(channelRule("newsletter").warningsRequired, "newsletter needs warnings");
  assert(channelRule("website").warningsRequired, "website needs warnings");
  assert(channelRule("social").warningsRequired, "social needs warnings");
  assert(channelRule("event").warningsRequired, "event collateral needs warnings");
  assert(!channelRule("outdoor_sign").warningsRequired, "outdoor signs exempt");
  assert(!channelRule("billboard").warningsRequired, "billboards exempt");

  // Checklist composition: warnings item appears only when required.
  const newsletterList = campaignChecklist("newsletter");
  assert(
    newsletterList.some((i) => i.includes("10% of the largest type size")),
    "newsletter checklist carries the warnings item",
  );
  const outdoorList = campaignChecklist("outdoor_sign");
  assert(
    !outdoorList.some((i) => i.includes("10% of the largest type size")),
    "outdoor checklist omits the warnings item",
  );
  assert(
    outdoorList[outdoorList.length - 1].toLowerCase().includes("universal bans"),
    "every checklist ends with the universal-bans scan",
  );

  // The giveaway channel pins the <$1 incidental-item regime.
  const giveaway = channelRule("giveaway");
  assert(
    giveaway.requirements.some((r) => r.includes("one U.S. dollar")),
    "giveaway $1 cap present",
  );
  assert(
    giveaway.prohibitions.some((p) => p.toLowerCase().includes("below your acquisition cost")),
    "coupon cost floor present",
  );

  // Unknown channel throws.
  let threw = false;
  try {
    channelRule("radio" as CampaignChannel);
  } catch {
    threw = true;
  }
  assert(threw, "unknown channel throws");

  return n;
}
