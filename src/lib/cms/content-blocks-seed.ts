/**
 * src/lib/cms/content-blocks-seed.ts
 *
 * The controlled set of editable site-text blocks (strategy report §4.4).
 * This is a CURATED list — NOT a free-form page builder — so the polished
 * front-end design system stays intact. New keys are added here intentionally.
 *
 * `defaultValue` mirrors the copy currently shipped on the live site so that
 * seeding produces no visible change until a staff member edits a block.
 *
 * IMPORTANT: keep every defaultValue byte-for-byte identical to the live copy
 * the page renders. The public pages now read these blocks via <SiteText>, so
 * any drift here would change the live site the moment a block is seeded.
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
    block_key: "home.hero.eyebrow",
    page: "home",
    section: "hero",
    label: "Home hero — eyebrow (small label)",
    help_text: "The little uppercase label above the homepage headline.",
    field_type: "plain",
    defaultValue: "Greenway Marijuana",
  },
  {
    block_key: "home.hero.title",
    page: "home",
    section: "hero",
    label: "Home hero — title",
    help_text: "The big headline on the homepage hero (first slide).",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Premium Cannabis, Everyday Deals",
  },
  {
    block_key: "home.hero.subtitle",
    page: "home",
    section: "hero",
    label: "Home hero — subtitle",
    help_text: "Supporting line under the homepage headline (first slide).",
    field_type: "plain",
    defaultValue:
      "Fresh daily discounts, top brands, and the full menu — all in one place.",
  },
  // ---- Menu ----------------------------------------------------------------
  {
    block_key: "menu.hero.title",
    page: "menu",
    section: "hero",
    label: "Menu hero — title",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Shop Our Menu",
  },
  {
    block_key: "menu.hero.subtitle",
    page: "menu",
    section: "hero",
    label: "Menu hero — subtitle",
    field_type: "plain",
    defaultValue:
      "Explore Greenway's full selection of premium cannabis products. Use the filters to find your perfect match.",
  },
  // ---- Loyalty -------------------------------------------------------------
  {
    block_key: "loyalty.hero.title",
    page: "loyalty",
    section: "hero",
    label: "Loyalty hero — title",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Signup to get offers and discounts from Greenway Marijuana",
  },
  {
    block_key: "loyalty.hero.subtitle",
    page: "loyalty",
    section: "hero",
    label: "Loyalty hero — subtitle",
    field_type: "plain",
    defaultValue: "Get updates on our promotions tailored to you.",
  },
  // ---- Vendors -------------------------------------------------------------
  {
    block_key: "vendors.outreach.heading",
    page: "vendors",
    section: "outreach",
    label: "Vendor outreach — heading",
    help_text: "Heading on the vendor partnership / outreach section.",
    field_type: "plain",
    defaultValue: "Let's Work Together",
  },
  // ---- Specials ------------------------------------------------------------
  {
    block_key: "specials.hero.eyebrow",
    page: "specials",
    section: "hero",
    label: "Specials hero — eyebrow (small label)",
    field_type: "plain",
    defaultValue: "Deals every day",
  },
  {
    block_key: "specials.hero.title",
    page: "specials",
    section: "hero",
    label: "Specials hero — title",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Cannabis Specials",
  },
  {
    block_key: "specials.hero.subtitle",
    page: "specials",
    section: "hero",
    label: "Specials hero — subtitle",
    field_type: "plain",
    defaultValue:
      "Check out our latest deals and save on premium cannabis products. New specials added regularly.",
  },
  // ---- FAQ -----------------------------------------------------------------
  {
    block_key: "faq.hero.title",
    page: "faq",
    section: "hero",
    label: "FAQ hero — title",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Frequently Asked Questions",
  },
  {
    block_key: "faq.hero.subtitle",
    page: "faq",
    section: "hero",
    label: "FAQ hero — subtitle",
    field_type: "plain",
    defaultValue: "Everything you need to know about shopping with us.",
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
    defaultValue: "Open Daily 8:00 AM – 11:45 PM",
  },
];
