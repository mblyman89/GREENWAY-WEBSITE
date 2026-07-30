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
import { privacyPolicyParagraphs } from "@/content/privacy-policy";
import { termsOfUseParagraphs } from "@/content/terms-of-use";
import { consumerHealthDataParagraphs } from "@/content/consumer-health-data";
import {
  POLICY_DOCS,
  rowsFromParagraphs,
  serializePolicyDoc,
} from "./policy-doc-core";
import {
  defaultSpecialsPresentation,
  serializeSpecialsPresentation,
} from "@/lib/specials/specials-presentation-core";
import {
  MEDICAL_CONTENT_BLOCKS,
  MEDICAL_HIDE_BLOCK,
  MEDICAL_VISIBLE_VALUE,
} from "@/lib/medical/medical-content-core";

// SLICE 105b: the seed value for each Legal Policies body is the CURRENT
// hardcoded paragraph list, serialized to the JSON document shape. Computing it
// here (instead of hand-pasting JSON) guarantees the seed can never drift from
// the vetted fallback the public pages render — so seeding is byte-identical.
function policyDocDefault(
  policyId: keyof typeof POLICY_DOCS,
  paragraphs: readonly string[],
): string {
  const { docKey } = POLICY_DOCS[policyId];
  return serializePolicyDoc(rowsFromParagraphs(paragraphs, docKey));
}

// SLICE 107: the editable Medical copy blocks are DERIVED from the medical
// content core so each seed defaultValue is byte-identical to the page's
// live fallback and can never drift from the vetted copy.
function medicalCopyBlockSeeds(): ContentBlockSeed[] {
  return MEDICAL_CONTENT_BLOCKS.map((b) => ({
    block_key: b.key,
    page: "medical",
    // Section is derived from the middle segment of the key (e.g.
    // medical.bring.title -> "bring") for tidy grouping in the admin list.
    section: b.key.split(".")[1] ?? "body",
    label: `Medical \u2014 ${b.label}`,
    ...(b.help ? { help_text: b.help } : {}),
    field_type: "plain" as ContentFieldType,
    defaultValue: b.fallback,
  }));
}

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
  // ---- Medical -------------------------------------------------------------
  {
    block_key: "medical.hero.title",
    page: "medical",
    section: "hero",
    label: "Medical hero — title",
    field_type: "plain",
    seo_impact: true,
    defaultValue: "Medical Cannabis at Greenway",
  },
  {
    block_key: "medical.hero.subtitle",
    page: "medical",
    section: "hero",
    label: "Medical hero — subtitle",
    field_type: "plain",
    defaultValue:
      "Greenway Marijuana is a medically endorsed retailer with certified medical cannabis consultants on staff.",
  },
  {
    block_key: "medical.intro.body",
    page: "medical",
    section: "intro",
    label: "Medical — intro paragraph",
    help_text:
      "The paragraph under the hero explaining the medical program at a glance. Keep claims factual — no therapeutic or curative claims.",
    field_type: "plain",
    defaultValue:
      "Washington patients with a valid authorization can join the state's voluntary Medical Cannabis Authorization Database at our store, receive a recognition card, and unlock tax savings and higher purchase limits on qualifying products. Here's how it works and what to bring.",
  },
  {
    // SLICE 107: page-level "hide this page" switch (select). Default "no" =
    // Visible, so seeding changes nothing until a staff member picks Hidden.
    block_key: MEDICAL_HIDE_BLOCK,
    page: "medical",
    section: "page",
    label: "Medical page \u2014 visibility",
    help_text:
      "Hide the whole Medical page from the public site. When Hidden, the page and its menu link disappear (staff pages are unaffected).",
    field_type: "select",
    defaultValue: MEDICAL_VISIBLE_VALUE,
  },
  ...medicalCopyBlockSeeds(),
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
  // SLICE 99: the outreach paragraph is now editable too, so the whole
  // vendor-relations pitch can be tuned from the back office.
  {
    block_key: "vendors.outreach.body",
    page: "vendors",
    section: "outreach",
    label: "Vendor outreach — paragraph",
    help_text:
      "The paragraph under the outreach heading inviting producers and processors to reach out.",
    field_type: "plain",
    defaultValue:
      "Greenway Marijuana is an independent, locally owned cannabis shop in Port Orchard, Washington, proudly serving the Kitsap Peninsula. We're always looking to connect with licensed I-502 producers and processors who make exceptional product. If you'd like to send samples, schedule a vendor day, or explore getting your line on our shelves, reach out — our buying team would love to hear from you.",
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
  {
    // SLICE 106: how the /specials "Weekly Cannabis Deals" grid is PRESENTED —
    // which weekday cards show, their order, the offer-badge style, optional
    // per-day copy overrides, and the two section toggles. This governs
    // PRESENTATION ONLY; all pricing/offer copy still comes from the promotions
    // engine. The default is byte-identical to today's page (live-look-safe), so
    // seeding changes nothing until staff edit and publish. field_type "richjson"
    // stores JSON in the plain text column → NO migration.
    block_key: "specials.deals.presentation",
    page: "specials",
    section: "deals",
    label: "Specials page — weekly deals presentation",
    help_text:
      "Controls how the weekly-deal cards are shown on the /specials page (which days show, their order, badge style, and optional copy). Pricing and offers are set in Promotions — this only changes how they're presented.",
    field_type: "richjson",
    seo_impact: true,
    defaultValue: serializeSpecialsPresentation(defaultSpecialsPresentation()),
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
    defaultValue: "Open Daily 8:00 AM – 11:00 PM",
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

  // ---- Legal Policies bodies (SLICE 105b) ----------------------------------
  // The full ordered body of each legal page, stored as ONE JSON "richdoc"
  // block (heading/paragraph rows). Seeded with the exact current wording so
  // the public pages are byte-identical until edited; the pages also fall back
  // to the hardcoded arrays if a block is unseeded or malformed. NO migration
  // (field_type is unconstrained text). Edited in Website → Legal Policies.
  {
    block_key: "privacy.body.doc",
    page: "legal-privacy",
    section: "body",
    label: "Privacy Policy — full text",
    help_text:
      "The complete body of your Privacy Policy, edited paragraph by paragraph. This is legal wording — consider having counsel review changes before publishing.",
    field_type: "richdoc",
    seo_impact: true,
    defaultValue: policyDocDefault("privacy-policy", privacyPolicyParagraphs),
  },
  {
    block_key: "terms.body.doc",
    page: "legal-terms",
    section: "body",
    label: "Terms of Use — full text",
    help_text:
      "The complete body of your Terms of Use, edited paragraph by paragraph. This is legal wording — consider having counsel review changes before publishing.",
    field_type: "richdoc",
    seo_impact: true,
    defaultValue: policyDocDefault("terms-of-use", termsOfUseParagraphs),
  },
  {
    block_key: "chd.body.doc",
    page: "legal-chd",
    section: "body",
    label: "Consumer Health Data — full text",
    help_text:
      "The complete body of your Washington Consumer Health Data Privacy Policy (My Health My Data Act). This is legal wording — consider having counsel review changes before publishing.",
    field_type: "richdoc",
    seo_impact: true,
    defaultValue: policyDocDefault("consumer-health-data", consumerHealthDataParagraphs),
  },

  // ---- Header & Footer (SLICE 104) -----------------------------------------
  // Editable footer link destinations. Every URL default mirrors the value the
  // footer currently renders from src/content/business.ts, so seeding changes
  // NOTHING on the live site. The two app-store links ship BLANK on purpose —
  // there is no app yet, so an empty URL makes the public footer show the
  // editable "not connected yet" message (below) instead of navigating to "#".
  {
    block_key: "footer.social.facebook.url",
    page: "header-footer",
    section: "follow",
    label: "Follow Greenway — Facebook link",
    help_text:
      "Where the Facebook button in the footer sends visitors. Leave blank to show your 'not connected yet' message instead.",
    field_type: "url",
    defaultValue:
      "https://www.facebook.com/greenway.greenway.5817?mibextid=wwXIfr&rdid=DduvyRreh4Goqmp4&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2F17c7PxQyXY%2F%3Fmibextid%3DwwXIfr#",
  },
  {
    block_key: "footer.social.instagram.url",
    page: "header-footer",
    section: "follow",
    label: "Follow Greenway — Instagram link",
    help_text:
      "Where the Instagram button in the footer sends visitors. Leave blank to show your 'not connected yet' message instead.",
    field_type: "url",
    defaultValue: "https://www.instagram.com/greenwaymj_",
  },
  {
    block_key: "footer.social.google.url",
    page: "header-footer",
    section: "follow",
    label: "Follow Greenway — Google link",
    help_text:
      "Where the Google button in the footer sends visitors (usually your Google Maps / Business profile). Leave blank to show your 'not connected yet' message instead.",
    field_type: "url",
    defaultValue:
      "https://www.google.com/maps/place/Greenway+Marijuana/@47.5046241,-122.6410196,17z/data=!3m1!4b1!4m6!3m5!1s0x549049c49eee5f27:0xa5bc6e45aaad6ff!8m2!3d47.5046205!4d-122.6384447!16s%2Fg%2F11b6xmnx2s?entry=ttu&g_ep=EgoyMDI2MDYxNi4wIKXMDSoASAFQAw%3D%3D",
  },
  {
    block_key: "footer.social.yelp.url",
    page: "header-footer",
    section: "follow",
    label: "Follow Greenway — Yelp link",
    help_text:
      "Where the Yelp button in the footer sends visitors. Leave blank to show your 'not connected yet' message instead.",
    field_type: "url",
    defaultValue:
      "https://www.yelp.com/biz/greenway-marijuana-port-orchard-2?osq=greenway+marijuana",
  },
  {
    block_key: "footer.social.leafly.url",
    page: "header-footer",
    section: "follow",
    label: "Follow Greenway — Leafly link",
    help_text:
      "Where the Leafly button in the footer sends visitors. Leave blank to show your 'not connected yet' message instead.",
    field_type: "url",
    defaultValue: "https://www.leafly.com/dispensary-info/greenway-marijuana",
  },
  {
    block_key: "footer.app.apple.url",
    page: "header-footer",
    section: "app",
    label: "App download — Apple App Store link",
    help_text:
      "Where the Apple App Store button sends visitors. Leave blank until your app is live — visitors then see your 'not connected yet' message instead of a broken link.",
    field_type: "url",
    defaultValue: "",
  },
  {
    block_key: "footer.app.google.url",
    page: "header-footer",
    section: "app",
    label: "App download — Google Play link",
    help_text:
      "Where the Google Play button sends visitors. Leave blank until your app is live — visitors then see your 'not connected yet' message instead of a broken link.",
    field_type: "url",
    defaultValue: "",
  },
  {
    block_key: "footer.link.unavailable.message",
    page: "header-footer",
    section: "app",
    label: "Footer links — 'not connected yet' message",
    help_text:
      "The friendly message shown when a visitor clicks a footer link that doesn't have a destination saved yet (like the app buttons before your app launches).",
    field_type: "plain",
    defaultValue:
      "This isn't available just yet — check back soon! In the meantime, give us a call or stop by the shop.",
  },
  // ---- Top green bar (SecondaryBar, under the page nav) --------------------
  // The store-hours text size + the editable phone-number OVERLAY text. These
  // seed with the exact live values so the bar looks identical until edited.
  {
    block_key: "header.hours.size",
    page: "header-footer",
    section: "topbar",
    label: "Top bar — store hours text size",
    help_text:
      "How big the store-hours text is in the green bar at the top of the site. 'Normal' is the current size. Larger steps grow both the phone-size and desktop hours together.",
    field_type: "select",
    // Seed BLANK so the render helper uses the safe default ("normal") — the
    // bar is pixel-identical until a size is chosen.
    defaultValue: "",
  },
  {
    block_key: "header.phone.display",
    page: "header-footer",
    section: "topbar",
    label: "Top bar — phone button text",
    help_text:
      "The text shown on the phone button in the top green bar (e.g. \"360-BUY-WEED\"). This is only what customers SEE — the actual number they call never changes.",
    field_type: "plain",
    // Mirrors greenwayBusiness.phone.display (src/content/business.ts) exactly,
    // kept as a literal to match this file's convention (no runtime import).
    defaultValue: "360-BUY-WEED",
  },
];
