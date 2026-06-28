/**
 * src/lib/cms/content-blocks-seed.ts
 *
 * The controlled set of editable site-text blocks (strategy report §4.4).
 * This is a CURATED list — NOT a free-form page builder — so the polished
 * front-end design system stays intact. New keys are added here intentionally.
 *
 * `defaultValue` mirrors the copy currently shipped on the live site so that
 * seeding produces no visible change until a staff member edits a block.
 */
import type { ContentFieldType } from "./types";

export type ContentBlockSeed = {
  block_key: string;
  page: string;
  section: string;
  label: string;
  help_text?: string;
  field_type: ContentFieldType;
  seo_impact?: boolean;
  defaultValue: string;
};

export const CONTENT_BLOCK_SEEDS: ContentBlockSeed[] = [
  // ---- Home ----------------------------------------------------------------
  {
    block_key: "home.hero.title",
    page: "home",
    section: "hero",
    label: "Home hero — title",
    help_text: "The big headline on the homepage hero.",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Port Orchard's Favorite Cannabis Dispensary",
  },
  {
    block_key: "home.hero.subtitle",
    page: "home",
    section: "hero",
    label: "Home hero — subtitle",
    help_text: "Supporting line under the homepage headline.",
    field_type: "plain",
    defaultValue:
      "Premium flower, edibles, concentrates, and more — curated by the Greenway team for adults 21+.",
  },
  // ---- Menu ----------------------------------------------------------------
  {
    block_key: "menu.hero.title",
    page: "menu",
    section: "hero",
    label: "Menu hero — title",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "The Greenway Menu",
  },
  {
    block_key: "menu.hero.subtitle",
    page: "menu",
    section: "hero",
    label: "Menu hero — subtitle",
    field_type: "plain",
    defaultValue: "Live inventory updated from our point-of-sale system.",
  },
  // ---- Loyalty -------------------------------------------------------------
  {
    block_key: "loyalty.hero.title",
    page: "loyalty",
    section: "hero",
    label: "Loyalty hero — title",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Join Greenway Rewards",
  },
  {
    block_key: "loyalty.hero.subtitle",
    page: "loyalty",
    section: "hero",
    label: "Loyalty hero — subtitle",
    field_type: "plain",
    defaultValue: "Earn points on every visit and unlock member-only savings.",
  },
  // ---- Vendors -------------------------------------------------------------
  {
    block_key: "vendors.outreach.heading",
    page: "vendors",
    section: "outreach",
    label: "Vendor outreach — heading",
    help_text: "Heading on the vendor partnership / outreach section.",
    field_type: "plain",
    defaultValue: "Partner With Greenway",
  },
  // ---- Specials ------------------------------------------------------------
  {
    block_key: "specials.hero.subtitle",
    page: "specials",
    section: "hero",
    label: "Specials hero — subtitle",
    field_type: "plain",
    defaultValue: "Daily deals, Thursday Top Shelf brands, and clearance picks.",
  },
  // ---- Footer / compliance -------------------------------------------------
  {
    block_key: "footer.compliance.warning",
    page: "footer",
    section: "compliance",
    label: "Footer — compliance warning",
    help_text:
      "Required WA compliance language. Edit with care — keep all mandated wording.",
    field_type: "rich",
    seo_impact: false,
    defaultValue:
      "This product has intoxicating effects and may be habit forming. Marijuana can impair concentration, coordination, and judgment. Do not operate a vehicle or machinery under the influence of this drug. For use only by adults 21 and older. Keep out of the reach of children.",
  },
  // ---- Business info -------------------------------------------------------
  {
    block_key: "business.hours.display",
    page: "business",
    section: "hours",
    label: "Business — hours display",
    help_text: "Plain-text hours shown in the footer / contact areas.",
    field_type: "plain",
    defaultValue: "Open Daily 8:00 AM – 11:00 PM",
  },
];
