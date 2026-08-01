/**
 * content-reachability-core — the migration SAFETY NET for content blocks.
 *
 * WHY THIS EXISTS (plain English for future maintainers):
 * The site has 104 seeded "content blocks" (little pieces of editable page text
 * and images). Historically many of them were only editable from ONE giant
 * "Site Content" screen (the junk drawer). We are migrating each group into the
 * page's OWN editor so every editor is all-inclusive. During that migration the
 * single biggest risk is ORPHANING a block — removing it from Site Content
 * without a new home, leaving a piece of the live site un-editable.
 *
 * This module is a PURE, committed source-of-truth that says, for EVERY seeded
 * block key, which admin editor "owns" it (is the honest place to edit it). Its
 * self-tests assert:
 *   1. Every seeded block key has exactly one declared owner (no silent gaps).
 *   2. No block is left with owner NONE unless it is on an explicit, reviewed
 *      RETIRED allowlist (so "orphan" can never happen by accident).
 *   3. The set of keys the Site Content screen still owns matches this table,
 *      so the exclusion filter in src/app/admin/content/page.tsx can be checked
 *      against ground truth in a later slice.
 *
 * It reads NOTHING from the database and imports NO React/Next — it is safe to
 * run inside run-pure-selftests.ts. It reasons over the SEED (the same list the
 * DB is seeded from), so it can never drift from what actually ships.
 *
 * HOW TO EVOLVE IT (each migration mini-slice):
 * When a group moves to its new editor, change that group's OWNER entries here
 * (e.g. "SITE_CONTENT" -> "PAGES_VENDORS") IN THE SAME PR that adds the editor
 * and updates the Site Content exclusion filter. The self-test will then lock
 * the new reality in place. This is the "guard v1 -> v2 -> ..." referenced in
 * the MIG-0 master audit (SECTION 5 REACHABILITY GUARD).
 *
 * NO MIGRATION NEEDED: this file is pure TypeScript logic; it touches no schema.
 */

import { CONTENT_BLOCK_SEEDS } from "./content-blocks-seed";

/**
 * Canonical admin editor identifiers. Each value is a real, reachable editing
 * surface (verified against the repo at authoring time). NONE means "no editor"
 * — only allowed for keys on RETIRED_KEYS.
 */
export const CONTENT_EDITORS = {
  /** /admin/content — the legacy "Site Content" junk drawer (being emptied). */
  SITE_CONTENT: "SITE_CONTENT",
  /** /admin/header-footer — header + footer chrome editor. */
  HEADER_FOOTER: "HEADER_FOOTER",
  /** /admin/legal-policies — policy docs + legal hero copy. */
  LEGAL_POLICIES: "LEGAL_POLICIES",
  /** /admin/medical-page — the dedicated Medical page editor. */
  MEDICAL_PAGE: "MEDICAL_PAGE",
  /** /admin/loyalty-page — the dedicated Loyalty page editor. */
  LOYALTY_PAGE: "LOYALTY_PAGE",
  /** /admin/specials — the dedicated Specials editor. */
  SPECIALS: "SPECIALS",
  /** /admin/content/shop-banner — the menu hero image / carousel editor. */
  SHOP_BANNER: "SHOP_BANNER",
  /** No editing surface at all. ONLY valid for RETIRED_KEYS. */
  NONE: "NONE",
  // --- Editors introduced by later migration slices (declared ahead of time so
  //     evolving the OWNER map is a one-line change, not a schema edit). ---
  /** /admin/pages/vendors "Page wording" card (MIG-1). */
  PAGES_VENDORS: "PAGES_VENDORS",
  /** /admin/pages/about wording card (MIG-2). */
  PAGES_ABOUT: "PAGES_ABOUT",
  /** /admin/pages/locations wording card (MIG-2). */
  PAGES_LOCATIONS: "PAGES_LOCATIONS",
  /** /admin/pages/price-match wording card (MIG-2). */
  PAGES_PRICE_MATCH: "PAGES_PRICE_MATCH",
  /** /admin/pages/faq wording card (MIG-5a). */
  PAGES_FAQ: "PAGES_FAQ",
  /** /admin/pages/home wording card (MIG-5c). */
  PAGES_HOME: "PAGES_HOME",
  /** /admin/settings/branding — fonts + brand hub (MIG-4). */
  SETTINGS_BRANDING: "SETTINGS_BRANDING",
  /** /admin/blog "Page wording" card (MIG-6). */
  BLOG: "BLOG",
} as const;

export type ContentEditor =
  (typeof CONTENT_EDITORS)[keyof typeof CONTENT_EDITORS];

/**
 * Editors that are REAL editing surfaces (a human can save/publish a block
 * there). NONE is excluded on purpose.
 */
export const REAL_EDITORS: ReadonlySet<ContentEditor> = new Set(
  Object.values(CONTENT_EDITORS).filter(
    (e) => e !== CONTENT_EDITORS.NONE,
  ) as ContentEditor[],
);

/**
 * RETIRED_KEYS — block keys that are intentionally NOT editable anywhere,
 * because they are dead/superseded and pending an explicit owner decision.
 * Nothing may be added here without owner sign-off (tracked in the MIG-0 audit
 * SECTION 4.3 / decision D8). Keeping the list EMPTY at v1 means the self-test
 * treats every un-owned key as a hard failure today.
 *
 * NOTE: the known dead/superseded candidates (menu.hero.title/subtitle,
 * loyalty.hero.title/subtitle) are currently still owned by SITE_CONTENT via the
 * page-group rule below, so they ARE reachable today — they only become
 * retire-candidates in MIG-5e. Until that decision, they are NOT orphaned.
 */
export const RETIRED_KEYS: ReadonlySet<string> = new Set<string>([]);

/**
 * Page groups that the Site Content screen EXCLUDES today (its
 * PAGE_BUILDER_PAGES set in src/app/admin/content/page.tsx). Blocks whose
 * `page` is in this set are NOT shown in Site Content. Kept in sync with the
 * real filter; the self-test cross-checks it.
 *
 * TODAY (after MIG-3 MS-3.3): home, menu, loyalty, specials, vendors, faq,
 * about, locations, price-match, footer.
 * (vendors joined here in MS-1.3; about/locations/price-match joined in MS-2.2,
 * once each got its own "Page wording" card in MS-2.1a/b/c; the whole "footer"
 * group joined in MS-3.3 once the Header & Footer editor owned it — MS-3.1.)
 *
 * MIG-4 MS-4.2: the "business" group is now listed here. Its last two Site
 * Content blocks -- the site.font.* typography settings -- moved to the Branding
 * editor (surfaced MS-4.1), and its business.hours.display block already moved to
 * Header & Footer (MS-3.1) via a KEY_OWNER_OVERRIDE. With NO business block left
 * in Site Content, the whole group is excluded here (its default owner flipped to
 * SETTINGS_BRANDING in PAGE_GROUP_DEFAULT_OWNER, so the fonts stay reachable and
 * the hours override still points at HEADER_FOOTER). This satisfies self-test #7:
 * an excluded page must NOT default to SITE_CONTENT.
 */
export const SITE_CONTENT_EXCLUDED_PAGES: ReadonlySet<string> = new Set<string>([
  "home",
  "menu",
  "loyalty",
  "specials",
  "vendors",
  "faq",
  "about",
  "locations",
  "price-match",
  "footer",
  "business",
  // MIG-5 Slice 2 (SUBTRACT): medical now owned by MEDICAL_PAGE, and the four
  // legal groups by LEGAL_POLICIES — none of them default to SITE_CONTENT any
  // more, so they leave the junk drawer here too (keeps self-test #7 honest and
  // mirrors PAGE_BUILDER_PAGES in admin/content/page.tsx).
  "medical",
  "legal",
  "legal-privacy",
  "legal-terms",
  "legal-chd",
]);

/**
 * Explicit per-KEY ownership overrides. Used where a `page` group is split
 * across editors, or where a dedicated editor already owns specific keys that
 * would otherwise fall to the page-group default.
 *
 * This is the surgical layer: page-group defaults (below) handle the common
 * case; these overrides handle the exceptions the audit found.
 *
 * v1 (origin/main TODAY) reflects the CURRENT reachable state — see the
 * MIG-0 audit SECTION 4. As each slice lands, move entries here / update the
 * page-group defaults accordingly.
 */
export const KEY_OWNER_OVERRIDES: Readonly<Record<string, ContentEditor>> = {
  // --- ORPHANS today: rendered live but no editor (audit SECTION 4.3). We
  //     record their TRUE current owner as NONE so the self-test surfaces them
  //     explicitly, and we allowlist them below as KNOWN_ORPHANS_V1 pending
  //     their rescue slices. This makes the damage MACHINE-VISIBLE instead of
  //     hidden. ---
  "faq.hero.title": CONTENT_EDITORS.NONE, // MIG-5a target: PAGES_FAQ
  "faq.hero.subtitle": CONTENT_EDITORS.NONE, // MIG-5a target: PAGES_FAQ

  "home.category.image": CONTENT_EDITORS.NONE, // MIG-5c target: PAGES_HOME
  "home.category.eyebrow": CONTENT_EDITORS.NONE,
  "home.category.title": CONTENT_EDITORS.NONE,
  "home.category.subtitle": CONTENT_EDITORS.NONE,
  "home.brand.image": CONTENT_EDITORS.NONE,
  "home.brand.eyebrow": CONTENT_EDITORS.NONE,
  "home.brand.title": CONTENT_EDITORS.NONE,
  "home.brand.subtitle": CONTENT_EDITORS.NONE,

  "specials.hero.eyebrow": CONTENT_EDITORS.NONE, // MIG-5b target: SPECIALS
  "specials.hero.title": CONTENT_EDITORS.NONE,
  "specials.hero.subtitle": CONTENT_EDITORS.NONE,

  "menu.hero.title": CONTENT_EDITORS.NONE, // MIG-5e: dead, retire-candidate
  "menu.hero.subtitle": CONTENT_EDITORS.NONE,

  "loyalty.hero.title": CONTENT_EDITORS.NONE, // MIG-5e: superseded by presentation
  "loyalty.hero.subtitle": CONTENT_EDITORS.NONE,

  // --- medical.* hero/intro are stuck in Site Content today (registry excludes
  //     them) — audit SECTION 4.3. Their `page` is "medical", which is NOT in
  //     SITE_CONTENT_EXCLUDED_PAGES, so the page-group default already routes
  //     them to SITE_CONTENT. No override needed until MIG-5d moves them. ---

  // --- business group SPLIT (MIG-3 MS-3.3): the "business" page group holds
  //     three blocks. business.hours.display moved to the Header & Footer editor
  //     (surfaced MS-3.1, Site Content copy removed MS-3.3), so we OVERRIDE its
  //     owner to HEADER_FOOTER here. The other two (site.font.heading /
  //     site.font.body) STAY in Site Content for now and move to the Branding
  //     editor in MIG-4 — so the "business" page-group default remains
  //     SITE_CONTENT (below) and the group is NOT added to
  //     SITE_CONTENT_EXCLUDED_PAGES (excluding it would strand the fonts). The
  //     hours block is instead hidden from Site Content by KEY via EXCLUDED_KEYS
  //     in content/page.tsx, matching this override. ---
  "business.hours.display": CONTENT_EDITORS.HEADER_FOOTER,
};

/**
 * KNOWN_ORPHANS_V1 — the audit-confirmed orphans that exist RIGHT NOW on
 * origin/main. They are allowlisted so the v1 self-test can PASS (it reflects
 * reality) while still ENUMERATING them so no NEW orphan can appear unnoticed.
 * Each rescue slice removes its keys from here as it gives them a real owner.
 * When this set is empty, zero orphans remain.
 */
export const KNOWN_ORPHANS_V1: ReadonlySet<string> = new Set<string>([
  "faq.hero.title",
  "faq.hero.subtitle",
  "home.category.image",
  "home.category.eyebrow",
  "home.category.title",
  "home.category.subtitle",
  "home.brand.image",
  "home.brand.eyebrow",
  "home.brand.title",
  "home.brand.subtitle",
  "specials.hero.eyebrow",
  "specials.hero.title",
  "specials.hero.subtitle",
  "menu.hero.title",
  "menu.hero.subtitle",
  "loyalty.hero.title",
  "loyalty.hero.subtitle",
]);

/**
 * Page-group DEFAULT owners — used for any key without a KEY_OWNER_OVERRIDE.
 * These encode audit SECTION 4 at the `page` granularity for the "clean"
 * groups. A page-group of SITE_CONTENT means "still in the junk drawer today".
 *
 * As slices land, flip a group here (e.g. vendors -> PAGES_VENDORS) in the same
 * PR that adds its editor.
 */
export const PAGE_GROUP_DEFAULT_OWNER: Readonly<Record<string, ContentEditor>> =
  {
    // still in Site Content today (junk drawer) — migration targets noted:
    about: CONTENT_EDITORS.PAGES_ABOUT, // MIG-2 MS-2.2: flipped from SITE_CONTENT (Page wording card owns it)
    blog: CONTENT_EDITORS.SITE_CONTENT, // -> BLOG (MIG-6)
    business: CONTENT_EDITORS.SETTINGS_BRANDING, // MIG-4 MS-4.2: flipped from SITE_CONTENT. The whole "business" group now lives outside Site Content -- the 2 site.font.* blocks follow this default into the Branding editor (surfaced MS-4.1), and business.hours.display keeps its KEY_OWNER_OVERRIDE to HEADER_FOOTER (override precedence wins). No business block remains in Site Content.
    footer: CONTENT_EDITORS.HEADER_FOOTER, // MIG-3 MS-3.3: flipped from SITE_CONTENT (Header & Footer editor owns it; both footer blocks surfaced MS-3.1)
    locations: CONTENT_EDITORS.PAGES_LOCATIONS, // MIG-2 MS-2.2: flipped from SITE_CONTENT (Page wording card owns it)
    "price-match": CONTENT_EDITORS.PAGES_PRICE_MATCH, // MIG-2 MS-2.2: flipped from SITE_CONTENT (Page wording card owns it)
    vendors: CONTENT_EDITORS.PAGES_VENDORS, // MIG-1 MS-1.3: flipped from SITE_CONTENT (Page wording card owns it)
    // legal groups: reachable in Site Content AND legal-policies today. We pick
    // the dedicated editor as the honest owner (it is the intended home).
    legal: CONTENT_EDITORS.LEGAL_POLICIES,
    "legal-chd": CONTENT_EDITORS.LEGAL_POLICIES,
    "legal-privacy": CONTENT_EDITORS.LEGAL_POLICIES,
    "legal-terms": CONTENT_EDITORS.LEGAL_POLICIES,
    // header-footer group: dedicated editor owns it (b.page === "header-footer").
    "header-footer": CONTENT_EDITORS.HEADER_FOOTER,
    // medical group default: the dedicated Medical page editor owns the whole
    // group now. MIG-5 Slice 1 surfaced the three stuck hero/intro copy fields in
    // that editor alongside the registry blocks it already owned; MIG-5 Slice 2
    // (this slice) then removed the medical group from the Site Content junk
    // drawer, so MEDICAL_PAGE is now the single honest owner. The page is also
    // added to SITE_CONTENT_EXCLUDED_PAGES below.
    medical: CONTENT_EDITORS.MEDICAL_PAGE, // MIG-5 Slice 2: flipped from SITE_CONTENT (Medical page editor owns it; hero/intro surfaced Slice 1)
    // page-builder groups (excluded from Site Content) with dedicated editors:
    loyalty: CONTENT_EDITORS.LOYALTY_PAGE,
    specials: CONTENT_EDITORS.SPECIALS,
    // "home", "menu", "faq" have no clean single default — their keys are
    // handled by KEY_OWNER_OVERRIDES (orphans) above. Any home/menu/faq key not
    // overridden falls through to the resolver's "unknown" branch and FAILS the
    // self-test, which is the desired safety behaviour.
  };

/**
 * Resolve the owning editor for a single block key.
 * Precedence: explicit KEY_OWNER_OVERRIDES -> PAGE_GROUP_DEFAULT_OWNER[page].
 * Returns undefined if neither applies (caller treats as a hard failure).
 */
export function ownerForBlock(
  blockKey: string,
  page: string,
): ContentEditor | undefined {
  if (blockKey in KEY_OWNER_OVERRIDES) return KEY_OWNER_OVERRIDES[blockKey];
  if (page in PAGE_GROUP_DEFAULT_OWNER) return PAGE_GROUP_DEFAULT_OWNER[page];
  return undefined;
}

/** A single reachability finding for reporting/testing. */
export type ReachabilityRow = {
  key: string;
  page: string;
  owner: ContentEditor | "UNKNOWN";
  orphaned: boolean;
};

/**
 * Build the full reachability report over the SEED. This is the machine-readable
 * SECTION 4 of the audit, regenerated from live code every run.
 */
export function buildReachabilityReport(): ReachabilityRow[] {
  return CONTENT_BLOCK_SEEDS.map((b): ReachabilityRow => {
    const owner = ownerForBlock(b.block_key, b.page);
    const resolved: ContentEditor | "UNKNOWN" = owner ?? "UNKNOWN";
    const orphaned =
      resolved === "UNKNOWN" || resolved === CONTENT_EDITORS.NONE;
    return { key: b.block_key, page: b.page, owner: resolved, orphaned };
  });
}

/** Keys the resolver could not assign to ANY editor (should always be empty). */
export function unresolvedKeys(): string[] {
  return buildReachabilityReport()
    .filter((r) => r.owner === "UNKNOWN")
    .map((r) => r.key);
}

/** Keys with owner NONE that are NOT on the known-orphan allowlist (must be []). */
export function unexpectedOrphans(): string[] {
  return buildReachabilityReport()
    .filter(
      (r) => r.owner === CONTENT_EDITORS.NONE && !KNOWN_ORPHANS_V1.has(r.key),
    )
    .map((r) => r.key);
}

/** Allowlisted orphans that no longer exist in the seed (stale allowlist). */
export function staleAllowlistedOrphans(): string[] {
  const seedKeys = new Set(CONTENT_BLOCK_SEEDS.map((b) => b.block_key));
  return [...KNOWN_ORPHANS_V1].filter((k) => !seedKeys.has(k));
}

// ---------------------------------------------------------------------------
// Embedded self-tests (pure). Invoked by run-pure-selftests.ts.
// ---------------------------------------------------------------------------

export function __runContentReachabilityCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`content-reachability-core: ${msg}`);
    passed += 1;
  };

  // 1. The seed is non-trivial (guards against an empty import).
  assert(CONTENT_BLOCK_SEEDS.length >= 100, "seed unexpectedly small");

  // 2. EVERY seeded key resolves to a declared owner (no silent gaps).
  const unresolved = unresolvedKeys();
  assert(
    unresolved.length === 0,
    `keys with no declared owner (add to KEY_OWNER_OVERRIDES or a page default): ${unresolved.join(", ")}`,
  );

  // 3. No UNEXPECTED orphans — every NONE-owned key must be on KNOWN_ORPHANS_V1.
  const surprises = unexpectedOrphans();
  assert(
    surprises.length === 0,
    `NEW orphan blocks detected (rendered live, no editor, not allowlisted): ${surprises.join(", ")}`,
  );

  // 4. The allowlist must not go stale (no phantom keys).
  const stale = staleAllowlistedOrphans();
  assert(
    stale.length === 0,
    `KNOWN_ORPHANS_V1 lists keys not in the seed (remove them): ${stale.join(", ")}`,
  );

  // 5. Every declared owner value is a real editor OR NONE (typo guard).
  const validOwners = new Set<string>(Object.values(CONTENT_EDITORS));
  for (const r of buildReachabilityReport()) {
    assert(
      r.owner === "UNKNOWN" ? false : validOwners.has(r.owner),
      `block ${r.key} has invalid owner ${r.owner}`,
    );
  }

  // 6. REAL_EDITORS excludes NONE and includes SITE_CONTENT (sanity of the set).
  assert(!REAL_EDITORS.has(CONTENT_EDITORS.NONE), "REAL_EDITORS must exclude NONE");
  assert(
    REAL_EDITORS.has(CONTENT_EDITORS.SITE_CONTENT),
    "REAL_EDITORS must include SITE_CONTENT",
  );

  // 7. CROSS-CHECK the Site Content exclusion set against reality: no page group
  //    that we declare as still-owned-by SITE_CONTENT may be in the excluded
  //    set, and vice-versa a page in the excluded set must NOT default to
  //    SITE_CONTENT (its keys must be owned elsewhere or be overridden).
  for (const [page, owner] of Object.entries(PAGE_GROUP_DEFAULT_OWNER)) {
    if (owner === CONTENT_EDITORS.SITE_CONTENT) {
      assert(
        !SITE_CONTENT_EXCLUDED_PAGES.has(page),
        `page "${page}" defaults to SITE_CONTENT yet is in SITE_CONTENT_EXCLUDED_PAGES (contradiction)`,
      );
    }
  }
  for (const page of SITE_CONTENT_EXCLUDED_PAGES) {
    const def = PAGE_GROUP_DEFAULT_OWNER[page];
    assert(
      def === undefined || def !== CONTENT_EDITORS.SITE_CONTENT,
      `excluded page "${page}" still defaults to SITE_CONTENT (its keys would be unreachable)`,
    );
  }

  // 8. Snapshot: exactly 17 known orphans at v1 (audit ground truth). This will
  //    be decremented deliberately by each rescue slice, giving a visible
  //    countdown to zero.
  assert(
    KNOWN_ORPHANS_V1.size === 17,
    `expected 17 known orphans at v1, found ${KNOWN_ORPHANS_V1.size}`,
  );

  return { passed };
}
