/**
 * src/lib/catalog/journey-core.ts
 *
 * W1 — THE canonical Product Intake journey. One exported constant that every
 * surface (stage strip, Catalog Hub cards, nav ordering, breadcrumbs, help
 * copy) derives from, so staff see ONE mental model of the pipeline everywhere:
 *
 *   0 Discover → 1 Order → 2 Receive → 3 Onboard → 4 Publish → 5 Enrich →
 *   6 Master → 7 Pay
 *
 * PURE module: no `server-only`, no DB, no React — safe to import from tsx
 * test harnesses and from both server and client components.
 *
 * Design notes (verified against the audit report):
 *  - "Publish" is the Live Menu stage. The menu is built from POS exports and
 *    published under Menu Imports; the live customer-facing stock lives under
 *    Inventory. `href` points at the day-to-day surface (Inventory); the
 *    `altHref` points at Menu Imports where publishing actually happens.
 *  - Reference surfaces (Knowledge Base, CCRS Benchmarks) are NOT stages —
 *    they are "fuel, not stages" and are intentionally absent here.
 */

export type JourneyStageKey =
  | "discover"
  | "order"
  | "receive"
  | "onboard"
  | "publish"
  | "enrich"
  | "master"
  | "pay";

export type JourneyStage = {
  key: JourneyStageKey;
  /** 0-based position in the journey (stable; used for numbering). */
  index: number;
  /** Short label used on the strip and hub cards. */
  label: string;
  /** The primary page where this stage's work happens. */
  href: string;
  /** Optional secondary surface for the stage (e.g. Menu Imports for publish). */
  altHref?: string;
  /** One-line "what happens here" for tooltips and help. */
  hint: string;
  /** Longer name used on hub cards. */
  cardTitle: string;
};

export const JOURNEY_STAGES: readonly JourneyStage[] = [
  {
    key: "discover",
    index: 0,
    label: "Discover",
    href: "/admin/discovery",
    hint: "Find products & vendors worth pursuing",
    cardTitle: "Product Discovery",
  },
  {
    key: "order",
    index: 1,
    label: "Order",
    href: "/admin/purchasing",
    hint: "Build a purchase order and send it to the vendor",
    cardTitle: "Purchasing",
  },
  {
    key: "receive",
    index: 2,
    label: "Receive",
    href: "/admin/inventory/intake",
    hint: "Accept inbound transfers + COAs",
    cardTitle: "Receiving",
  },
  {
    key: "onboard",
    index: 3,
    label: "Onboard",
    href: "/admin/inventory/drafts",
    hint: "Approve new products onto the menu",
    cardTitle: "Product Onboarding",
  },
  {
    key: "publish",
    index: 4,
    label: "Publish",
    href: "/admin/inventory",
    altHref: "/admin/menu-imports",
    hint: "Live, on-hand inventory that's customer-facing",
    cardTitle: "Live Menu",
  },
  {
    key: "enrich",
    index: 5,
    label: "Enrich",
    href: "/admin/products",
    hint: "Add photos, descriptions & tags",
    cardTitle: "Product Enrichment",
  },
  {
    key: "master",
    index: 6,
    label: "Master",
    href: "/admin/products/masters",
    hint: "Group sizes into one clean card",
    cardTitle: "Product Mastering",
  },
  {
    key: "pay",
    index: 7,
    label: "Pay",
    href: "/admin/vendor-payments",
    hint: "Match the invoice and pay the vendor",
    cardTitle: "Accounts Payable",
  },
] as const;

/** Look up a stage by key. Throws on unknown keys so drift fails loudly in CI. */
export function journeyStage(key: JourneyStageKey): JourneyStage {
  const s = JOURNEY_STAGES.find((x) => x.key === key);
  if (!s) throw new Error(`Unknown journey stage: ${key}`);
  return s;
}

/**
 * Map of legacy CatalogStageStrip keys → canonical keys, so existing pages
 * keep compiling while they migrate. ("intake" was the old strip's name for
 * receiving; "menu" for the live menu.)
 */
export const LEGACY_STAGE_ALIASES: Record<string, JourneyStageKey> = {
  intake: "receive",
  onboarding: "onboard",
  menu: "publish",
  enrichment: "enrich",
};

export function resolveStageKey(k: string): JourneyStageKey {
  if ((JOURNEY_STAGES as readonly JourneyStage[]).some((s) => s.key === k)) {
    return k as JourneyStageKey;
  }
  const alias = LEGACY_STAGE_ALIASES[k];
  if (alias) return alias;
  throw new Error(`Unknown journey stage or alias: ${k}`);
}

// ---------------------------------------------------------------------------
// Tests (tsx-runnable, house pattern)
// ---------------------------------------------------------------------------
export function __runJourneyCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL journey-core: " + msg);
    passed += 1;
  };

  assert(JOURNEY_STAGES.length === 8, "exactly 8 stages");
  // Indexes are contiguous 0..7 in order.
  JOURNEY_STAGES.forEach((s, i) => assert(s.index === i, `index contiguous at ${s.key}`));
  // Keys unique.
  assert(new Set(JOURNEY_STAGES.map((s) => s.key)).size === 8, "keys unique");
  // Hrefs unique and rooted in /admin.
  assert(new Set(JOURNEY_STAGES.map((s) => s.href)).size === 8, "hrefs unique");
  assert(JOURNEY_STAGES.every((s) => s.href.startsWith("/admin/")), "hrefs rooted");
  // Canonical order is the audited pipeline order.
  assert(
    JOURNEY_STAGES.map((s) => s.key).join(",") ===
      "discover,order,receive,onboard,publish,enrich,master,pay",
    "canonical order",
  );
  // Lookup works and throws on junk.
  assert(journeyStage("receive").href === "/admin/inventory/intake", "lookup receive");
  let threw = false;
  try {
    journeyStage("nope" as JourneyStageKey);
  } catch {
    threw = true;
  }
  assert(threw, "unknown key throws");
  // Legacy aliases resolve.
  assert(resolveStageKey("intake") === "receive", "alias intake");
  assert(resolveStageKey("menu") === "publish", "alias menu");
  assert(resolveStageKey("enrichment") === "enrich", "alias enrichment");
  assert(resolveStageKey("onboarding") === "onboard", "alias onboarding");
  assert(resolveStageKey("publish") === "publish", "canonical passthrough");

  return { passed };
}
