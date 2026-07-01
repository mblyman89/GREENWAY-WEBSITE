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
  // ---- Site-wide typography ------------------------------------------------
  {
    block_key: "site.font.heading",
    page: "business",
    section: "typography",
    label: "Heading font (titles & headlines)",
    help_text:
      "The font used for big titles and headlines across the whole site. Pick from the curated library — changes apply everywhere once published.",
    field_type: "font",
    defaultValue: "system",
  },
  {
    block_key: "site.font.body",
    page: "business",
    section: "typography",
    label: "Body font (paragraphs & general text)",
    help_text:
      "The font used for regular paragraph and interface text across the whole site. Pick from the curated library.",
    field_type: "font",
    defaultValue: "system",
  },
  // ---- Home ----------------------------------------------------------------
  // NOTE: The homepage hero carousel (first banner + its slides) is managed in
  // Admin → Content → Home Carousel (table home_carousel_slides), NOT here, so
  // staff can add/edit/delete/reorder slides with images + buttons. The blocks
  // below cover the static section banners further down the homepage.
  // ---- Home: "Shop by Category" section banner -----------------------------
  {
    block_key: "home.category.image",
    page: "home",
    section: "category-banner",
    label: "Category banner — background image",
    help_text:
      "Background art for the \"Shop by Category\" band on the homepage. Use a wide, short, textless image. The dark gradient and text are layered on top automatically.",
    field_type: "image",
    defaultValue: "/home/category-banner.webp",
  },
  {
    block_key: "home.category.eyebrow",
    page: "home",
    section: "category-banner",
    label: "Category banner — eyebrow (small label)",
    help_text: "The little uppercase label above the \"Shop by Category\" title.",
    field_type: "plain",
    defaultValue: "Browse the Menu",
  },
  {
    block_key: "home.category.title",
    page: "home",
    section: "category-banner",
    label: "Category banner — title",
    field_type: "plain",
    defaultValue: "Shop by Category",
  },
  {
    block_key: "home.category.subtitle",
    page: "home",
    section: "category-banner",
    label: "Category banner — subtitle",
    field_type: "plain",
    defaultValue:
      "Jump straight into the products you want — every tile opens a pre-filtered menu.",
  },
  // ---- Home: "Shop by Brand" section banner --------------------------------
  {
    block_key: "home.brand.image",
    page: "home",
    section: "brand-banner",
    label: "Brand banner — background image",
    help_text:
      "Background art for the \"Shop by Brand\" band on the homepage. Use a wide, short, textless image. The dark gradient and text are layered on top automatically.",
    field_type: "image",
    defaultValue: "/home/brand-banner.webp",
  },
  {
    block_key: "home.brand.eyebrow",
    page: "home",
    section: "brand-banner",
    label: "Brand banner — eyebrow (small label)",
    help_text: "The little uppercase label above the \"Shop by Brand\" title.",
    field_type: "plain",
    defaultValue: "Featured Brands",
  },
  {
    block_key: "home.brand.title",
    page: "home",
    section: "brand-banner",
    label: "Brand banner — title",
    field_type: "plain",
    defaultValue: "Shop by Brand",
  },
  {
    block_key: "home.brand.subtitle",
    page: "home",
    section: "brand-banner",
    label: "Brand banner — subtitle",
    field_type: "plain",
    defaultValue:
      "A fresh lineup of our favorite brands every visit — tap any to shop their full menu.",
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
    block_key: "loyalty.hero.image",
    page: "loyalty",
    section: "hero",
    label: "Loyalty hero — banner image (desktop)",
    help_text:
      "The wide promotional banner at the top of the Loyalty page on desktop (very wide, ~3200×563). Use a textless image; the form sits below it.",
    field_type: "image",
    defaultValue: "/brand/greenway-loyalty-points-hero-desktop.png",
  },
  {
    block_key: "loyalty.hero.image_mobile",
    page: "loyalty",
    section: "hero",
    label: "Loyalty hero — banner image (mobile)",
    help_text:
      "The banner shown on phones (roughly 3:1, e.g. ~1200×400). A separate, taller crop reads better on small screens.",
    field_type: "image",
    defaultValue: "/brand/greenway-loyalty-points-hero-mobile.png",
  },
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
  // ---- About page (bespoke hero — editable copy, distinct design kept) ------
  {
    block_key: "about.hero.title",
    page: "about",
    section: "hero",
    label: "About — hero title",
    help_text:
      "The big headline on the About page (currently “We Are Greenway.”). Keep it short — it renders in large display type.",
    field_type: "plain",
    defaultValue: "We Are Greenway.",
  },
  {
    block_key: "about.hero.subtitle",
    page: "about",
    section: "hero",
    label: "About — hero subtitle",
    help_text: "The supporting line beneath the About headline.",
    field_type: "plain",
    defaultValue:
      "Founded on the belief that cannabis can enhance everyday life, we are dedicated to providing education, quality, and community.",
  },
  // ---- Locations page (bespoke hero) ---------------------------------------
  {
    block_key: "locations.hero.title",
    page: "locations",
    section: "hero",
    label: "Locations — hero title",
    help_text:
      "The big headline over the storefront photo on the Locations page (currently “Geiger Rd”). Renders in large display type.",
    field_type: "plain",
    defaultValue: "Geiger Rd",
  },
  {
    block_key: "locations.hero.image",
    page: "locations",
    section: "hero",
    label: "Locations — storefront photo",
    help_text:
      "The wide storefront photo at the top of the Locations page. Pick an image from your Media Library.",
    field_type: "image",
    defaultValue: "/brand/greenway-front-of-store.webp",
  },
  // ---- Price Match page (bespoke hero) -------------------------------------
  {
    block_key: "pricematch.hero.title",
    page: "price-match",
    section: "hero",
    label: "Price Match — hero title",
    help_text: "The big centered headline on the Price Match page.",
    field_type: "plain",
    defaultValue: "Price Match",
  },
  {
    block_key: "pricematch.hero.subtitle",
    page: "price-match",
    section: "hero",
    label: "Price Match — promise headline",
    help_text: "The orange headline inside the card (currently “Our Price Match Promise”).",
    field_type: "plain",
    defaultValue: "Our Price Match Promise",
  },
  {
    block_key: "footer.hours.image",
    page: "footer",
    section: "hours",
    label: "Footer — store hours image",
    help_text:
      "The 'OPEN / hours' graphic shown in the site footer. Use a transparent PNG so it blends with the black footer. Pick an image from your Media Library.",
    field_type: "image",
    seo_impact: false,
    defaultValue: "/brand/store-hours-open-transparent.png",
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

  // ---- Legal & info pages --------------------------------------------------
  // These pages have legally-worded bodies that shouldn't be freely edited, but
  // their page TITLE is safe to manage here — which also makes each page appear
  // in the Site Content page directory so nothing is "missing" from the list.
  {
    block_key: "privacy.hero.title",
    page: "legal",
    section: "hero",
    label: "Privacy Policy — page title",
    help_text:
      "The big orange title at the top of your Privacy Policy page. The legal wording below it is fixed for compliance and isn't edited here.",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Privacy Policy",
  },
  {
    block_key: "terms.hero.title",
    page: "legal",
    section: "hero",
    label: "Terms of Use — page title",
    help_text:
      "The big orange title at the top of your Terms of Use page. The legal wording below it is fixed for compliance and isn't edited here.",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Terms of Use",
  },
  {
    block_key: "chd.hero.title.line1",
    page: "legal",
    section: "hero",
    label: "Consumer Health Data — title (line 1)",
    help_text:
      "First line of the title on your Washington Consumer Health Data page (required by the My Health My Data Act). Keep it accurate.",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Washington Consumer Health Data",
  },
  {
    block_key: "chd.hero.title.line2",
    page: "legal",
    section: "hero",
    label: "Consumer Health Data — title (line 2)",
    help_text: "Second line of the title on your Consumer Health Data page.",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Privacy Policy",
  },
];
