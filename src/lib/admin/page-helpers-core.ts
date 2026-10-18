/**
 * R73 S5 - Page helpers registry.
 *
 * The green "How this works" panels used to sit at the very top of the website
 * editors, Creative Studio and Merch Studio, inside the sticky page header, so
 * they followed the owner up and down and ate canvas space. They now live here
 * and render on one Helpers page (/admin/helpers). Each editor shows only a
 * small "How this page works" link to its anchor (AdminPageHeader `helpId`).
 *
 * Wording is the same as the panels it replaces, so nothing was lost in the move.
 * Pure data + checks (no React) so the self-test runner can verify it.
 */

export type HelperSection = "Website: Cannabis" | "Website: Merchandise" | "Studios";

export const HELPER_SECTIONS: readonly HelperSection[] = ["Website: Cannabis", "Website: Merchandise", "Studios"];

export type PageHelper = {
  /** Stable anchor id (kept equal to the old HelpPanel id). */
  id: string;
  section: HelperSection;
  /** Menu name of the page the helper belongs to. */
  page: string;
  /** Where the page lives, for the "Open the page" link. */
  href: string;
  title: string;
  steps: string[];
  notes: string[];
  links?: { label: string; href: string }[];
};

export const PAGE_HELPERS: readonly PageHelper[] = [
  {
    id: "website-sync",
    section: "Website: Cannabis",
    page: "Website Sync",
    href: "/admin/website-sync",
    title: "How this page keeps the website honest",
    steps: [
      "Every block below is loaded with the SAME functions the customer-facing site calls: published menu version, published promotion snapshots, loyalty config, endorsement config, CMS hours.",
      "Today's deal row is resolved with the store's Pacific weekday, exactly like the storefront cart re-prices at midnight.",
      "Each block links to the admin surface that owns it, so fixing a mismatch is one click away.",
      "If a block shows seed/fallback data, the storefront is showing the committed fallback too. Publish from the owning page to take control.",
    ],
    notes: ["This is the back office's promise as the single source of truth: if it looks right here, it is what customers see."],
  },
  {
    id: "header-footer",
    section: "Website: Cannabis",
    page: "Header & Footer",
    href: "/admin/header-footer",
    title: "How the Header & Footer editor works",
    steps: [
      "Pick a block below (like a 'Follow Greenway' social link) and edit its draft. Nothing goes live yet.",
      "Open Preview in Website Hub to see the footer exactly as visitors will (click ✎ Edit on a highlighted spot to jump here).",
      "Click Publish on the block (or 'Publish all drafts') to update the public site. Every publish is snapshotted so you can roll back.",
    ],
    notes: [
      "Follow Greenway links: paste the full web address (starting with https://) for each social button. Leave one blank to show your friendly \"not connected yet\" message instead of a broken link.",
      "App download links: these ship blank on purpose until your app is live. Visitors who click them see your editable \"not connected yet\" message. When your app launches, paste the App Store / Google Play links here and the buttons start working automatically.",
      "Footer compliance & hours: this editor also owns the required WA compliance warning, the store-hours image, and the plain-text store hours that appear in the footer. Edit them here like any other block; the same draft → preview → publish flow applies.",
      "Nothing breaks: you can only edit these approved spots, so the footer always stays laid out correctly.",
    ],
  },
  {
    id: "branding",
    section: "Website: Cannabis",
    page: "Branding",
    href: "/admin/settings/branding",
    title: "How the Branding editor works",
    steps: [
      "Use the tabs: Colours (presets, hex, colour wheel), Logos (header logo + logo library with import), Fonts, Slogans/mission/about, Saved banners, Social & guidelines.",
      "Saved banners: pick what the design is for (website banner, card, blog, newsletter, social, print or a custom W×H), design it, add it, then use \"Save as picture\" to file a finished PNG in a Media Library folder (Merch by default).",
      "Pick the Heading font (big titles) and the Body font (paragraphs) from the curated library. Each choice is a draft, so nothing goes live yet.",
      "Open Preview in Website Hub to see exactly how the new fonts look (click ✎ Edit on a highlighted spot to jump here).",
      "Click Publish on the block (or 'Publish all drafts') to update the public site everywhere at once. Every publish is snapshotted so you can roll back.",
    ],
    notes: [
      "Heading vs. Body: the Heading font is used for big titles and headlines; the Body font is used for regular paragraph and interface text. A clean pairing (a characterful heading with a highly readable body) is usually the safest, most professional look.",
      "Why a curated list? Web pages can only use fonts the browser can fetch, so we ship a hand-picked set of high-quality, license-clean fonts (plus the fast \"System default\"). Each is loaded for performance with no layout shift.",
      "Nothing breaks: your fonts apply site-wide the moment you Publish, and you can roll back to any previous choice from History at any time.",
    ],
  },
  {
    id: "legal-policies",
    section: "Website: Cannabis",
    page: "Legal Policies",
    href: "/admin/legal-policies",
    title: "How the Legal Policies editor works",
    steps: [
      "Pick a tab (Privacy Policy, Terms of Use, or Consumer Health Data).",
      "Edit the page title and the body. Each paragraph or heading is its own row you can change, add, remove, or reorder.",
      "Use View live page (or the Website Hub preview) to see it as customers will, then Save draft (private) or Publish (updates the live page). Every publish is saved so you can roll back.",
    ],
    notes: [
      "This is legal wording. Consider having your attorney review changes before publishing. Nothing goes live until you press Publish.",
      "Nothing can break the layout: you edit text only, and the page styling stays exactly as designed.",
    ],
  },
  {
    id: "blog-content-editor",
    section: "Website: Cannabis",
    page: "Blog wording",
    href: "/admin/blog/content",
    title: "How the blog wording editor works",
    steps: [
      "Edit any field: the hero heading, the intro line, or a button label.",
      "Save draft (private) or Publish (updates the live blog page).",
      "Every publish is saved, so you can open History on any field and roll back.",
    ],
    notes: [
      "This edits the blog page's wording only. Your actual posts and newsletters are written in Blog & Newsletter, and the card design isn't changed here.",
      "Defaults match the live page exactly, so nothing looks different until you edit a field and Publish.",
    ],
  },
  {
    id: "page-wording",
    section: "Website: Cannabis",
    page: "Home, Vendors, FAQ, About, Locations, Price Match",
    href: "/admin/pages/home",
    title: "How Page wording works",
    steps: [
      "Pick a block and edit its draft. Nothing goes live yet.",
      "Use the live preview to see the page exactly as visitors will (click ✎ Edit on a highlighted spot to jump to it).",
      "Click Publish on the block (or 'Publish all drafts') to update the public page.",
    ],
    notes: [
      "Nothing breaks: you can only edit these approved spots, so the page always stays laid out correctly. These are the same words you could previously edit under Site Content; now they live on the page's own editor.",
      "Banners on these pages use the Design Studio. The canvas sits where the banner sits on the live page; press 📌 Follow scroll if you want it to follow you while you change settings.",
    ],
  },
  {
    id: "shop-banner-editor",
    section: "Website: Cannabis",
    page: "Shop Banner",
    href: "/admin/content/shop-banner",
    title: "How the Shop banner works",
    steps: [
      "Add a slide, style its picture and text, then Publish that slide to put it live.",
      "Drag order with the up/down arrows. The first live slide shows first, then they auto-rotate.",
      "Use a slide's buttons to send shoppers to a filtered menu (handy for a sale).",
      "Leave a slide's schedule blank to show it always, or set a start/end for a one-off sale.",
    ],
    notes: [
      "Each slide is fully yours to style: the same editor as the Loyalty banner, for every slide, plus buttons and an optional schedule. Nothing goes live until you Publish that slide.",
    ],
  },
  {
    id: "store-listing",
    section: "Website: Cannabis",
    page: "Google Store Listing",
    href: "/admin/content/store-listing",
    title: "How store hours reach Google",
    steps: [
      "Set your regular hours for each day. Tick \"Midnight\" if you stay open until 12 AM.",
      "Add holiday or special hours (for example Thanksgiving closed, or Christmas Eve 8 AM - 6 PM).",
      "Save. Every page of the site updates its hidden store information for Google right away.",
      "Also update the same hours in your Google Business Profile. Google treats that as the main source for Maps.",
    ],
    notes: [
      "This page controls the hidden \"structured data\" Google reads from your website. It does not change the hours text people see in the footer or on the Locations page; that wording is edited in Header & Footer (the business hours text). Please keep them matching.",
      "To check: open Google's Rich Results Test, enter your Locations page address, and look for the \"Local business\" result with your hours.",
    ],
    links: [{ label: "Header & Footer", href: "/admin/header-footer" }],
  },
  {
    id: "content-schedule",
    section: "Website: Cannabis",
    page: "Schedule & Releases",
    href: "/admin/content/schedule",
    title: "How scheduling works",
    steps: [
      "Edit and SAVE the draft as usual (home slide, Shop banner slide, page section, FAQ question or page wording).",
      "Pick \"Go live\" or \"Come down\" and a time. Times are Pacific and run on a 5-minute clock.",
      "At that time the website publishes the saved draft, exactly as if you had pressed Publish, or hides the item.",
      "For a sale: schedule the banner to go live Friday morning and to come down Sunday night.",
      "For a launch with several changes, make a Release, add the items, and give the release one time (or press Publish now).",
    ],
    notes: [
      "Every change is recorded in the audit log under your name. If something cannot be published (for example the item was deleted), it is tried up to three times and then shows here as failed, with the reason.",
    ],
  },
  {
    id: "loyalty-page-editor",
    section: "Website: Cannabis",
    page: "Loyalty",
    href: "/admin/loyalty-page",
    title: "How the Loyalty page editor works",
    steps: [
      "Edit any friendly wording field, then Save draft (private) or Publish (updates the live page).",
      "Every publish is saved, so you can open History on any field and roll back.",
      "The program numbers shown on the page are live from your register. Change them in CRM → Loyalty Program.",
    ],
    notes: [
      "The consent paragraph is yours to edit. A checklist under it shows which usual parts are covered (it's a helper, not legal advice), and an empty paragraph can't be published. The program numbers are locked: they stay accurate from the register, so this page can never advertise terms that differ from what customers actually earn.",
      "The hero banner (the big image and its wording) is edited right at the top of this page: pick the picture and style the eyebrow, title, and subtitle text. Everything for the Loyalty page lives on this one screen.",
    ],
  },
  {
    id: "specials-presentation",
    section: "Website: Cannabis",
    page: "Specials",
    href: "/admin/specials",
    title: "How the Specials editor works",
    steps: [
      "Turn the weekly deal grid and Today's Deals products grid on or off.",
      "For each weekday: show/hide it, drag its order, pick a badge style, and optionally override the title, offer line, or description.",
      "Design right on the studio canvas (it shows what customers see), then Save draft (private) or Publish (updates the live page). Every publish is saved so you can roll back.",
    ],
    notes: [
      "This controls presentation only, not the prices. The actual discounts, percentages, and eligible products are set in Promotions. Editing here only changes how those deals are shown.",
      "Nothing can break the layout: you toggle and reorder cards and edit text only, and the page styling stays exactly as designed.",
    ],
    links: [{ label: "Promotions", href: "/admin/promotions" }],
  },
  {
    id: "specials-hero-text",
    section: "Website: Cannabis",
    page: "Specials (hero text)",
    href: "/admin/specials",
    title: "How hero text works",
    steps: [
      "Pick a field and edit its draft. Nothing goes live yet.",
      "Click 'Preview in Website Hub' to see the page exactly as visitors will (hover any spot and click the green ✎ Edit to jump back to its field).",
      "Click Publish on the field (or 'Publish all drafts') to update the public page.",
    ],
    notes: ["Nothing breaks: you can only edit these approved words, so the page always stays laid out correctly."],
  },
  {
    id: "medical-page-editor",
    section: "Website: Cannabis",
    page: "Medical page",
    href: "/admin/medical-page",
    title: "How the Medical page editor works",
    steps: [
      "Use the visibility switch to show or hide the whole Medical page. Publish to make it take effect.",
      "Edit any section heading or info line, then Save draft (private) or Publish (updates the live page).",
      "Every publish is saved, so you can open History on any field and roll back.",
    ],
    notes: [
      "The legal fine print and the limits table are locked. They stay accurate from the compliance engine, so you can never accidentally change a tax figure or a purchase limit here.",
      "This is a different page from Medical (patient intake) in the staff tools. This one only edits the public website page.",
    ],
  },
  {
    id: "merch-header-footer",
    section: "Website: Merchandise",
    page: "Merch Header & Footer",
    href: "/admin/merch-site/header-footer",
    title: "How Merch Header & Footer works",
    steps: [
      "Edit a block (the announcement bar, the wordmark, the footer note or a social link). Nothing goes live yet.",
      "Click Publish (or 'Publish all drafts'). greenwaymerch.com picks it up within about a minute.",
      "Every publish is saved, so you can roll back from a block's history.",
    ],
    notes: [
      "Leave the announcement blank to hide the bar. Social links must start with https://; a blank one simply hides that button. The legal lines (seller name, Washington-only shipping) are fixed and always show.",
    ],
  },
  {
    id: "merch-banners",
    section: "Website: Merchandise",
    page: "Merch Banners",
    href: "/admin/merch-site/banners",
    title: "How Merch Banners works",
    steps: [
      "Design the banner in Branding → Saved banners (pick a size), then click \"Save as picture\" on it. The finished PNG lands in the Media Library's \"Merch\" folder.",
      "Pick a slot (Home or a category) and choose the image. Images from the Merch folder are listed first.",
      "Optionally add a phone-sized image, the alt text and a link, then Publish.",
    ],
    notes: [
      "A slot with no image shows nothing, so the page looks exactly as it does today. Links can be a merch-site path like /tees or a full https:// address.",
    ],
  },
  {
    id: "merch-cards",
    section: "Website: Merchandise",
    page: "Merch Product Cards",
    href: "/admin/merch-site/cards",
    title: "How Merch Product Cards works",
    steps: [
      "Edit the card wording (brand line, button labels, the Sold out badge).",
      "Optionally give a category card its own image and blurb. Blank keeps the automatic one.",
      "Publish. greenwaymerch.com updates within about a minute.",
    ],
    notes: ["Product names, prices and photos come from Merch Studio when you publish a product, so they are not edited here."],
  },
  {
    id: "merch-emails",
    section: "Website: Merchandise",
    page: "Merch Order Emails",
    href: "/admin/merch-site/emails",
    title: "How Merch Order Emails works",
    steps: [
      "Edit a subject line, the shipped note or the sign-off.",
      "Use {order} for the order number and {site} for the store name; they fill in automatically.",
      "Publish. The next email sent uses the new wording.",
    ],
    notes: [
      "The order details, tracking link and refund facts are always added automatically, so a customer can never get an email missing them.",
    ],
  },
  {
    id: "midjourney-builder",
    section: "Studios",
    page: "Creative Studio",
    href: "/admin/marketing/midjourney",
    title: "How the Creative Studio works",
    steps: [
      "FLUX Image: write your prompt. It's sent to FLUX exactly as typed, the same as the BFL Playground, with nothing added behind your back.",
      "Put the subject first, then the action, style and setting. 30-80 words is BFL's sweet spot. Describe what you want; FLUX has no negative prompts.",
      "Add up to 8 reference images (FLUX.2) or 10 (FLUX 3). FLUX sees them as image 1, image 2… so name them in your prompt.",
      "Settings match the Playground: aspect ratio (or custom), safety tolerance 0-5, output format, prompt upsampling and 1, 2, 3, 4 or 8 images. Seed and model are optional extras.",
      "Results appear as they finish and are saved to your media library as DRAFTS. Nothing goes live automatically.",
      "FLUX Video: text → video, image → video (keyframes), continue, edit or upscale a clip. Pick a quick format (Reel, feed, 16:9…), duration, resolution and audio. Draft first is on by default: a fast HD preview for about a third of the cost, then Enhance renders the same shot at full quality.",
      "Midjourney prompt: builds a copy-paste prompt from a structured brief with AI assist and full Midjourney parameters.",
    ],
    notes: [
      "FLUX runs on your BFL account and each image is billed by BFL. The balance shows on the studio, and the exact cost shows on every card. Pick the default model and add your API key under Integrations → FLUX. Review every result for compliance before publishing.",
    ],
  },
  {
    id: "merch-studio",
    section: "Studios",
    page: "Merch Studio",
    href: "/admin/merch-studio",
    title: "How the Merch Studio works",
    steps: [
      "Garments: pick a premium blank (Comfort Colors, Independent, Bella+Canvas, Yupoong, Richardson) and a colour. Every placement shows its real print size, methods and Printful price.",
      "Design: pick a placement pill, add text, icons, shapes or your own art, and drag it on a true-to-inch canvas. The green dashed box is the exact printable area. Arrows nudge 1/16 inch (Shift = 1/4 inch), Ctrl+Z / Ctrl+Shift+Z undo and redo, Ctrl+D duplicates, Alt-drag skips snapping. Checks run live, and Preview shows every side in every colour.",
      "The canvas stays in place while you scroll. Press 📌 Follow scroll to keep it on screen as you work through the settings below (your choice is remembered in this browser).",
      "Proof & Export: pick a saved design to see every print file exactly as Printful receives it (trimmed, transparent, true inches, DPI, distance from the collar or brim). Download the ZIP (300-DPI sRGB PNGs + README + proof sheet + design backup), open the printable proof sheet, generate Printful photo mockups once Printful is connected, and tick off the sample checklist when your sample arrives.",
      "Artwork Check: drop in any file to see if it will print sharp on this garment, placement and method.",
      "Fulfillment & Pricing: see the just-in-time pipeline (Printful makes and ships one item per sale) and your profit per unit after Printful and card fees.",
      "Publish & Ads: (A) turn on the Greenway Goods ad on the cannabis website - one link to the separate merch website, your words and pictures, never prices or product details - draft, preview, publish. (B) pick a design, colours, sizes, price and product photos, then press Publish to greenwaymerch.com: the print files are rendered and stored, the product is on the merch website within about a minute and it is added to Inventory > Merch Inventory. Publishing the same title again updates it. The listing package download is still there as a backup.",
      "Merch Inventory (Inventory menu): every published product with Printful's live stock, what the website shows, price, cost, profit, units sold and revenue. Hide or show a product, remove it, copy Printful's stock onto the website, or download a CSV.",
    ],
    notes: [
      "Everything designed here is sold by Greenway Merchandising LLC (dba Greenway Glass & Goods) on its own separate website (its own domain, cart and Stripe card checkout). The cannabis website only shows a redirect ad with no product details, and apparel is never rung up on the cannabis POS or delivered by cannabis delivery. Confirm this structure with your attorney before launch.",
    ],
  },
];

export const HELPERS_PATH = "/admin/helpers";

/** Link to a helper's anchor on the Helpers page. Unknown ids still land on the page. */
export function helperHref(id: string): string {
  return PAGE_HELPERS.some((h) => h.id === id) ? `${HELPERS_PATH}#${id}` : HELPERS_PATH;
}

export function helpersBySection(): { section: HelperSection; items: PageHelper[] }[] {
  return HELPER_SECTIONS.map((section) => ({ section, items: PAGE_HELPERS.filter((h) => h.section === section) }));
}

export function __runPageHelpersTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else failures.push(msg);
  };

  const ids = PAGE_HELPERS.map((h) => h.id);
  ok(new Set(ids).size === ids.length, "helper ids are unique");
  ok(ids.every((id) => /^[a-z0-9-]+$/.test(id)), "helper ids are anchor-safe");
  ok(PAGE_HELPERS.every((h) => h.href.startsWith("/admin/")), "every helper points at an admin page");
  ok(PAGE_HELPERS.every((h) => h.steps.length > 0 && h.steps.every((s) => s.trim().length > 0)), "every helper has steps");
  ok(PAGE_HELPERS.every((h) => h.title.trim().length > 0 && h.page.trim().length > 0), "every helper has a title and page");
  ok(PAGE_HELPERS.every((h) => (h.links ?? []).every((l) => l.href.startsWith("/admin/"))), "helper links stay in the back office");
  ok(PAGE_HELPERS.every((h) => !/<[a-z/][^>]*>/i.test([h.title, ...h.steps, ...h.notes].join(" "))), "no stray markup in wording");
  // Scope from the R73 request: the website editors, Creative Studio and Merch Studio.
  for (const must of ["midjourney-builder", "merch-studio", "header-footer", "merch-banners", "page-wording"]) {
    ok(ids.includes(must), `registry covers ${must}`);
  }
  ok(helperHref("merch-studio") === "/admin/helpers#merch-studio", "helperHref anchors a known id");
  ok(helperHref("nope") === "/admin/helpers", "helperHref falls back to the page");
  const grouped = helpersBySection();
  ok(grouped.reduce((n, g) => n + g.items.length, 0) === PAGE_HELPERS.length, "every helper lands in exactly one section");
  ok(grouped.every((g) => g.items.length > 0), "no empty sections");
  ok(grouped.find((g) => g.section === "Studios")?.items.length === 2, "Studios = Creative + Merch");
  return { passed, failed: failures.length, failures };
}
