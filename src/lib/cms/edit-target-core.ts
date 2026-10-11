/**
 * edit-target-core — R43 "green ✎ Edit button" router (PURE).
 *
 * WHAT IT DOES (plain English):
 * In the Website Hub preview (and on the live site while in Preview mode) every
 * editable spot gets a small green "✎ Edit" button. Clicking it must land the
 * owner on the ONE admin screen where that exact thing is edited, scrolled to
 * and highlighting the field. This module is the single source of truth for
 * "where is X edited?". It answers three kinds of question:
 *
 *   1. a CONTENT BLOCK key  (data-gw-block="specials.hero.title")
 *        -> owner editor from content-reachability-core.ownerForBlock()
 *        -> that editor's route + `?block=<key>` (the editor focuses it)
 *   2. a BANNER owner        (data-gw-design-owner / data-gw-edit-owner =
 *                            "section:<uuid>" | "shop-slide:<uuid>" |
 *                            "specials:hero" | "specials:todays" | "loyalty:hero")
 *        -> design-move-core.editorFor() + an anchor/tab to the exact card
 *   3. a named AREA          (data-gw-edit-area="home-carousel" | …)
 *        -> a fixed editor route (things that are not blocks or banners)
 *
 * The public overlay never computes these itself: it links to the tiny server
 * route `/admin/edit?block=…|owner=…|area=…` (src/app/admin/edit/page.tsx),
 * which calls this module (plus one DB lookup to learn a section's page) and
 * redirects. That keeps the public-page bundle light and the logic testable.
 *
 * Every href returned is a same-site admin path (asserted in the
 * self-tests), so nothing here can ever be turned into an open redirect.
 *
 * NO MIGRATION NEEDED: pure TypeScript; no React, no DB, no server-only import.
 */

import { CONTENT_BLOCK_SEEDS } from "./content-blocks-seed";
import { CONTENT_EDITORS, ownerForBlock, type ContentEditor } from "./content-reachability-core";
import { editorFor, parseDesignOwner, type DesignOwner } from "./design-move-core";
import { AREA_BUTTON_LABEL, isSafeAdminHref, overlayEditHref, planFocus, bannerCoversBlock } from "./edit-link-core";

export { isSafeAdminHref };

export type EditTarget = {
  /** Same-site admin path to navigate to (always starts with "/admin/"). */
  href: string;
  /** Human label of the destination ("the Specials editor"). */
  label: string;
};

/** Where to send the owner when we genuinely cannot tell (never a dead end). */
export const EDIT_FALLBACK: EditTarget = {
  href: "/admin/website-sync?tab=preview",
  label: "the Website Hub",
};

const PAGE_OF_BLOCK: ReadonlyMap<string, string> = new Map(
  CONTENT_BLOCK_SEEDS.map((s) => [s.block_key, s.page]),
);

/** The legal tab (in /admin/legal-policies) that edits a legal block. */
function legalTabFor(blockKey: string): string | null {
  if (blockKey.startsWith("privacy.")) return "privacy-policy";
  if (blockKey.startsWith("terms.")) return "terms-of-use";
  if (blockKey.startsWith("chd.")) return "consumer-health-data";
  return null;
}

/** Route + label for each real content editor. `?block=` is appended by the caller. */
const EDITOR_ROUTE: Readonly<Record<Exclude<ContentEditor, "NONE" | "SITE_CONTENT">, EditTarget>> = {
  HEADER_FOOTER: { href: "/admin/header-footer", label: "the Header & Footer editor" },
  LEGAL_POLICIES: { href: "/admin/legal-policies", label: "the Legal policies editor" },
  MEDICAL_PAGE: { href: "/admin/medical-page", label: "the Medical page editor" },
  LOYALTY_PAGE: { href: "/admin/loyalty-page", label: "the Loyalty page editor" },
  SPECIALS: { href: "/admin/specials", label: "the Specials editor" },
  SHOP_BANNER: { href: "/admin/content/shop-banner", label: "the Shop banner editor" },
  PAGES_VENDORS: { href: "/admin/pages/vendors", label: "the Vendors page editor" },
  PAGES_ABOUT: { href: "/admin/pages/about", label: "the About page editor" },
  PAGES_LOCATIONS: { href: "/admin/pages/locations", label: "the Locations page editor" },
  PAGES_PRICE_MATCH: { href: "/admin/pages/price-match", label: "the Price Match page editor" },
  PAGES_FAQ: { href: "/admin/pages/faq", label: "the FAQ page editor" },
  PAGES_HOME: { href: "/admin/pages/home?tab=sections", label: "the Home page editor" },
  SETTINGS_BRANDING: { href: "/admin/settings/branding", label: "Branding settings" },
  BLOG: { href: "/admin/blog/content", label: "the Blog wording editor" },
};

/**
 * Prefix fallbacks for keys that render with data-gw-block but are not in the
 * seed (defensive: a future block added to a page before the seed). Longest
 * prefix wins; unknown -> EDIT_FALLBACK.
 */
const PREFIX_OWNER: ReadonlyArray<[string, ContentEditor]> = [
  ["specials.", CONTENT_EDITORS.SPECIALS],
  ["loyalty.", CONTENT_EDITORS.LOYALTY_PAGE],
  ["medical.", CONTENT_EDITORS.MEDICAL_PAGE],
  ["blog.", CONTENT_EDITORS.BLOG],
  ["footer.", CONTENT_EDITORS.HEADER_FOOTER],
  ["header.", CONTENT_EDITORS.HEADER_FOOTER],
  ["vendors.", CONTENT_EDITORS.PAGES_VENDORS],
  ["about.", CONTENT_EDITORS.PAGES_ABOUT],
  ["locations.", CONTENT_EDITORS.PAGES_LOCATIONS],
  ["pricematch.", CONTENT_EDITORS.PAGES_PRICE_MATCH],
  ["faq.", CONTENT_EDITORS.PAGES_FAQ],
  ["home.", CONTENT_EDITORS.PAGES_HOME],
  ["privacy.", CONTENT_EDITORS.LEGAL_POLICIES],
  ["terms.", CONTENT_EDITORS.LEGAL_POLICIES],
  ["chd.", CONTENT_EDITORS.LEGAL_POLICIES],
  ["site.font.", CONTENT_EDITORS.SETTINGS_BRANDING],
];

/** Block keys must look like dotted identifiers; anything else is refused. */
const BLOCK_KEY_RE = /^[a-z][a-z0-9_-]*(\.[a-zA-Z0-9_-]+)+$/;

export function isValidBlockKey(key: unknown): key is string {
  return typeof key === "string" && key.length <= 120 && BLOCK_KEY_RE.test(key);
}

function withQuery(href: string, params: Record<string, string | undefined>): string {
  const [base, hash = ""] = href.split("#");
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
  if (parts.length === 0) return href;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${parts.join("&")}${hash ? `#${hash}` : ""}`;
}

/** The owning editor id of a block (seed page first, then prefix fallback). */
export function editorIdForBlock(blockKey: string): ContentEditor | undefined {
  const page = PAGE_OF_BLOCK.get(blockKey);
  if (page) {
    const owner = ownerForBlock(blockKey, page);
    if (owner) return owner;
  }
  let best: [string, ContentEditor] | undefined;
  for (const entry of PREFIX_OWNER) {
    if (blockKey.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best?.[1];
}

/**
 * Where a CONTENT BLOCK is edited. The destination focuses `?block=<key>`
 * (ContentEditorShell for block-<key> cards; AdminBlockFocus for the
 * dedicated editors' f-<key> fields and the anchors added in R43).
 */
export function editTargetForBlock(blockKey: string): EditTarget {
  if (!isValidBlockKey(blockKey)) return EDIT_FALLBACK;
  const editor = editorIdForBlock(blockKey);
  if (!editor || editor === CONTENT_EDITORS.NONE || editor === CONTENT_EDITORS.SITE_CONTENT) return EDIT_FALLBACK;
  const route = EDITOR_ROUTE[editor as keyof typeof EDITOR_ROUTE];
  if (!route) return EDIT_FALLBACK;

  // Per-editor refinements so the owner lands on the right tab / card.
  if (editor === CONTENT_EDITORS.LEGAL_POLICIES) {
    return { href: withQuery(route.href, { tab: legalTabFor(blockKey) ?? undefined, block: blockKey }), label: route.label };
  }
  if (editor === CONTENT_EDITORS.PAGES_HOME) {
    // home.category.* / home.brand.* are the fallback behind the Sections
    // banners; the /admin/edit route upgrades this to #section-<id> when it
    // can look the row up. Here: the Sections tab.
    return { href: route.href, label: route.label };
  }
  if (editor === CONTENT_EDITORS.LOYALTY_PAGE && /^loyalty\.hero\.(image|image_mobile|presentation)$/.test(blockKey)) {
    // The banner picture + its styled words live in the Hero banner editor.
    return { href: `${route.href}#loyalty-hero`, label: route.label };
  }
  if (editor === CONTENT_EDITORS.SPECIALS && blockKey === "specials.deals.presentation") {
    return { href: `${withQuery(route.href, { tab: "cards" })}#specials-presentation`, label: route.label };
  }
  return { href: withQuery(route.href, { block: blockKey }), label: route.label };
}

/**
 * Where a BANNER is edited. `pageSlug` is only needed for `section:` owners
 * (the /admin/edit route looks it up). Lands on the exact card / tab.
 */
export function editTargetForOwner(owner: DesignOwner, pageSlug?: string | null): EditTarget {
  const base = editorFor(owner, pageSlug);
  switch (owner.kind) {
    case "section":
      if (base.href === "/admin/specials") return { href: `${base.href}?tab=hero#specials-presentation`, label: base.label };
      return { href: `${base.href}#section-${owner.id}`, label: base.label };
    case "shop-slide":
      return { href: `${base.href}#slide-${owner.id}`, label: base.label };
    case "specials":
      return { href: `${base.href}?tab=${owner.which === "todays" ? "banner" : "hero"}#specials-presentation`, label: base.label };
    case "loyalty":
      return { href: `${base.href}#loyalty-hero`, label: base.label };
  }
}

/** Parse + resolve a raw owner string; malformed -> fallback. */
export function editTargetForOwnerString(owner: unknown, pageSlug?: string | null): EditTarget {
  const parsed = parseDesignOwner(owner);
  return parsed ? editTargetForOwner(parsed, pageSlug) : EDIT_FALLBACK;
}

/**
 * Named AREAS: editable things that are neither a content block nor a banner
 * with an owner id. Add a new area here + tag the element with
 * data-gw-edit-area="<id>" (only in preview) and the ✎ Edit button appears.
 */
export const EDIT_AREAS: Readonly<Record<string, EditTarget>> = {
  "home-carousel": { href: "/admin/pages/home?tab=carousel", label: "the Home carousel editor" },
  "home-typecards": { href: "/admin/pages/home?tab=typecards", label: "the Home type cards editor" },
  "specials-cards": { href: "/admin/specials?tab=cards#specials-presentation", label: "the Specials editor" },
  "shop-banner": { href: "/admin/content/shop-banner", label: "the Shop banner editor" },
};

export function editTargetForArea(area: unknown): EditTarget {
  if (typeof area !== "string" || !Object.prototype.hasOwnProperty.call(EDIT_AREAS, area)) return EDIT_FALLBACK;
  const a = EDIT_AREAS[area];
  return { href: a.href, label: a.label };
}

/**
 * Optional "came from preview" breadcrumb so the editor can show a one-click
 * "← Back to preview" pill. `from` is "hub" (Website Hub iframe) or "site"
 * (live site in Preview mode); `path` is the public page that was open.
 */
export function withReturn(target: EditTarget, from: unknown, path: unknown): EditTarget {
  const f = from === "hub" || from === "site" ? from : undefined;
  const p = typeof path === "string" && /^\/(?!\/)[^\s]*$/.test(path) && path.length <= 300 ? path : undefined;
  if (!f) return target;
  return { href: withQuery(target.href, { gwfrom: f, gwpath: p }), label: target.label };
}


// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (throw on failure). Registered in the pure-selftest runner.
// ─────────────────────────────────────────────────────────────────────────────
export function __runEditTargetCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`edit-target-core: ${msg}`);
    passed += 1;
  };

  // Every seeded block resolves to a safe admin href; only retired keys fall back.
  for (const s of CONTENT_BLOCK_SEEDS) {
    const t = editTargetForBlock(s.block_key);
    ok(isSafeAdminHref(t.href), `${s.block_key} -> safe admin href (${t.href})`);
    const retired = s.block_key === "menu.hero.title" || s.block_key === "menu.hero.subtitle";
    ok(retired ? t.href === EDIT_FALLBACK.href : t.href !== EDIT_FALLBACK.href, `${s.block_key} has a real editor`);
  }

  // Specific landings.
  ok(editTargetForBlock("specials.hero.title").href === "/admin/specials?block=specials.hero.title", "specials hero text");
  ok(editTargetForBlock("specials.deals.presentation").href === "/admin/specials?tab=cards#specials-presentation", "specials deal cards");
  ok(editTargetForBlock("footer.compliance.warning").href === "/admin/header-footer?block=footer.compliance.warning", "footer warning");
  ok(editTargetForBlock("business.hours.display").href.startsWith("/admin/header-footer?"), "hours override -> header-footer");
  ok(editTargetForBlock("site.font.heading").href.startsWith("/admin/settings/branding?block="), "fonts -> branding");
  ok(editTargetForBlock("faq.hero.title").href === "/admin/pages/faq?block=faq.hero.title", "faq hero");
  ok(editTargetForBlock("vendors.outreach.body").href.startsWith("/admin/pages/vendors?block="), "vendors");
  ok(editTargetForBlock("pricematch.hero.image").href.startsWith("/admin/pages/price-match?block="), "price match");
  ok(editTargetForBlock("blog.hero.intro").href === "/admin/blog/content?block=blog.hero.intro", "blog");
  ok(editTargetForBlock("medical.hero.title").href === "/admin/medical-page?block=medical.hero.title", "medical");
  ok(editTargetForBlock("loyalty.hero.title").href === "/admin/loyalty-page?block=loyalty.hero.title", "loyalty heading");
  ok(editTargetForBlock("loyalty.hero.presentation").href === "/admin/loyalty-page#loyalty-hero", "loyalty banner");
  ok(editTargetForBlock("loyalty.hero.image").href === "/admin/loyalty-page#loyalty-hero", "loyalty image");
  ok(
    editTargetForBlock("chd.hero.title.line2").href ===
      "/admin/legal-policies?tab=consumer-health-data&block=chd.hero.title.line2",
    "legal tab + block",
  );
  ok(editTargetForBlock("privacy.body.doc").href.startsWith("/admin/legal-policies?tab=privacy-policy"), "privacy doc tab");
  ok(editTargetForBlock("home.category.title").href === "/admin/pages/home?tab=sections", "home fallback -> sections tab");
  // Unseeded but well-formed: prefix fallback.
  ok(editTargetForBlock("specials.hero.future").href === "/admin/specials?block=specials.hero.future", "prefix fallback");
  // Junk is refused.
  ok(editTargetForBlock("").href === EDIT_FALLBACK.href, "empty -> fallback");
  ok(editTargetForBlock("javascript:alert(1)").href === EDIT_FALLBACK.href, "junk -> fallback");
  ok(editTargetForBlock("nope.unknown").href === EDIT_FALLBACK.href, "unknown prefix -> fallback");

  // Owners.
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  ok(editTargetForOwnerString(`section:${uuid}`, "about").href === `/admin/pages/about#section-${uuid}`, "about section");
  ok(
    editTargetForOwnerString(`section:${uuid}`, "home").href === `/admin/pages/home?tab=sections#section-${uuid}`,
    "home section keeps tab + anchor",
  );
  ok(editTargetForOwnerString(`section:${uuid}`, "specials").href === "/admin/specials?tab=hero#specials-presentation", "legacy specials section");
  ok(editTargetForOwnerString(`shop-slide:${uuid}`).href === `/admin/content/shop-banner#slide-${uuid}`, "shop slide");
  ok(editTargetForOwnerString("specials:hero").href === "/admin/specials?tab=hero#specials-presentation", "specials hero design");
  ok(editTargetForOwnerString("specials:todays").href === "/admin/specials?tab=banner#specials-presentation", "specials todays design");
  ok(editTargetForOwnerString("loyalty:hero").href === "/admin/loyalty-page#loyalty-hero", "loyalty design");
  ok(editTargetForOwnerString("section:not-a-uuid").href === EDIT_FALLBACK.href, "bad owner -> fallback");

  // Areas.
  ok(editTargetForArea("home-carousel").href === "/admin/pages/home?tab=carousel", "carousel area");
  ok(editTargetForArea("toString").href === EDIT_FALLBACK.href, "prototype keys refused");
  for (const k of Object.keys(EDIT_AREAS)) ok(isSafeAdminHref(EDIT_AREAS[k].href), `area ${k} safe`);
  ok(
    JSON.stringify(Object.keys(EDIT_AREAS).sort()) === JSON.stringify(Object.keys(AREA_BUTTON_LABEL).sort()),
    "every area has a button label (edit-link-core) and a destination (here)",
  );

  // Return breadcrumb.
  ok(
    withReturn({ href: "/admin/specials?block=a.b", label: "x" }, "hub", "/specials").href ===
      "/admin/specials?block=a.b&gwfrom=hub&gwpath=%2Fspecials",
    "return params appended",
  );
  ok(
    withReturn({ href: "/admin/loyalty-page#loyalty-hero", label: "x" }, "site", "/loyalty").href ===
      "/admin/loyalty-page?gwfrom=site&gwpath=%2Floyalty#loyalty-hero",
    "return params before hash",
  );
  ok(withReturn({ href: "/admin/x", label: "x" }, "evil", "/a").href === "/admin/x", "bad from ignored");
  ok(withReturn({ href: "/admin/x", label: "x" }, "hub", "//evil.com").href === "/admin/x?gwfrom=hub", "bad path dropped");

  // Safety predicate.
  ok(isSafeAdminHref("/admin/specials"), "admin ok");
  ok(!isSafeAdminHref("//evil.com/admin"), "protocol-relative refused");
  ok(!isSafeAdminHref("https://evil.com/admin"), "absolute refused");
  ok(!isSafeAdminHref("/administrator"), "lookalike refused");
  ok(!isSafeAdminHref("/admin\\evil"), "backslash refused");

  // Overlay links.
  ok(
    overlayEditHref({ block: "faq.hero.title" }, { from: "hub", path: "/faq" }) ===
      "/admin/edit?block=faq.hero.title&from=hub&path=%2Ffaq",
    "overlay block link",
  );
  ok(
    overlayEditHref({ owner: "loyalty:hero" }, { from: "site", path: "/loyalty" }) ===
      "/admin/edit?owner=loyalty%3Ahero&from=site&path=%2Floyalty",
    "overlay owner link",
  );

  // Landing focus plan (AdminBlockFocus).
  const p1 = planFocus("?block=specials.hero.title&gwfrom=hub&gwpath=%2Fspecials", "");
  ok(p1.blockKey === "specials.hero.title" && p1.anchorId === null, "plan: block");
  ok(p1.back?.href === "/admin/website-sync?tab=preview&path=%2Fspecials", "plan: hub back link");
  const p2 = planFocus("?gwfrom=site&gwpath=%2Floyalty", "#loyalty-hero");
  ok(p2.anchorId === "loyalty-hero" && p2.back?.href === "/api/admin/preview/enable?path=%2Floyalty", "plan: site back link");
  ok(planFocus("?gwfrom=hub&gwpath=%2F%2Fevil.com", "").back?.href === "/admin/website-sync?tab=preview&path=%2F", "plan: bad path -> /");
  ok(planFocus("?block=<script>", "#a b").blockKey === null, "plan: junk block refused");
  ok(planFocus("", "#a b").anchorId === null, "plan: junk anchor refused");
  ok(planFocus("", "").back === null, "plan: no pill without gwfrom");
  ok(planFocus("?gwfrom=evil", "").back === null, "plan: unknown from ignored");
  ok(bannerCoversBlock("home.category.title") && !bannerCoversBlock("specials.hero.title"), "banner covers home blocks");

  return { passed, failed: 0 };
}
