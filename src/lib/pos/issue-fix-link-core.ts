/**
 * src/lib/pos/issue-fix-link-core.ts  (S26 — one registry that turns a
 * receiving diagnostic into a fix link that lands on the control)
 *
 * PURE. No fs, no network, no Supabase, no clock. Embedded self-tests run in
 * scripts/compliance/run-pure-selftests.ts; tests/compliance/issue-fix-links
 * .test.ts resolves every emitted href to a real page.tsx on disk and greps
 * that page for the param it receives and the control that does the fix.
 *
 * Why this exists (bible S26; F-093, F-094, F-096, F-097, F-098, F-100, F-101,
 * F-102, F-114, F-118): the menu-draft page's "How to fix it" buttons were
 * unparameterised list URLs — the owner clicked "Open Types & Categories" and
 * landed on a page of 60 types with no idea which one to map. NHS/GOV.UK error
 * summaries link each error "to the answer it relates to"; this module is that
 * rule for the receiving pipeline.
 *
 * HONEST DESTINATIONS (verified against the code, deviations from the bible's
 * first draft are deliberate and documented):
 *
 *   draft codes (no_pos_key, no_price, fact_extraction_review,
 *   intake_master_ambiguous_name) → the exact approved draft
 *     (`/admin/inventory/drafts?status=approved&draft=<id>#draft-<id>`, S02).
 *     Mastering diagnostics carry `pos_product_key`, not `draft_id`; the page
 *     maps key → draft server-side (never here).
 *
 *   draft_inject_unmapped_category → the Types page on the INVENTORY tab with
 *     the type's row opened and highlighted (`tab=inventory&type=<name>`). The
 *     bible said `tab=website`, but the mapping <Select> lives on the Inventory
 *     Types tab (settings/types/page.tsx InventoryTypesTab). Multi-category
 *     LCB types (Usable Marijuana, Mix Infused, Sample Jar, Flower Lot) SKIP
 *     the type map by design (website-category-resolver.ts
 *     isMultiCategoryLcbType), so mapping them fixes nothing: those go to the
 *     product's own lot page, whose per-product override outranks the map.
 *
 *   draft_inject_potency_capped → the lot's COA panel (`/admin/inventory/<lot>
 *     #coa`). The bible said the enrichment page, but that page has no potency
 *     field; lab numbers change only through receiving (lot page copy). The
 *     menu card is offered as a second link ONLY when the key is live (the
 *     product page 404s otherwise — F-101).
 *
 *   intake_master_no_vendor → the manifest's vendor block
 *     (`/admin/inventory/intake/<id>#manifest-vendor`, added by S26).
 *
 *   intake_master_merge_ambiguous → the live cards it matched, one link each
 *     (only keys still on the published menu), plus the enrichment list
 *     searched by the product family. The side-by-side "choose and remember"
 *     screen is S32; until it ships this copy never promises a remembered
 *     choice. Product Mastering is NOT a destination: it is not read by the
 *     merge (F-096).
 */

import { draftsHref, isUuid } from "@/lib/catalog/draft-deep-link-core";
import { inventoryTypeKey } from "@/lib/pos/inventory-type-catalog";
import { isMultiCategoryLcbType } from "@/lib/inventory/website-category-resolver";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Everything the page resolved about ONE diagnostic (all optional). */
export type IssueContext = {
  draftId?: string | null;
  lotId?: string | null;
  manifestId?: string | null;
  posProductKey?: string | null;
  /** The draft's raw LCB inventory_type (what the Types map is keyed by). */
  typeName?: string | null;
  /** True only when the key is a card on the PUBLISHED menu right now. */
  isOnLiveMenu?: boolean;
  /** The product's name, for button labels. */
  productName?: string | null;
  /** merge_ambiguous: the matched live cards still on the published menu. */
  liveCardKeys?: readonly string[];
  /** merge_ambiguous: vendor|category|family identity key. */
  identity?: string | null;
  /** Where the product page's Back link should return (an /admin path). */
  back?: string | null;
};

export type IssueLinkKind = "item" | "list";

export type IssueExtraLink = { href: string; label: string; routeFile: string };

export type IssueFixLink = {
  href: string;
  label: string;
  /** item = lands on the one thing; list = a filtered/unfiltered list. */
  kind: IssueLinkKind;
  /** The Next.js page that serves `href` (asserted on disk by the tests). */
  routeFile: string;
  /** Fix copy that replaces the generic sentence when the link knows more. */
  fix: string | null;
  /** Why the product ended up this way (shown in a <details>). */
  why: string | null;
  /** Secondary destinations (e.g. "Re-file just this product"). */
  extra: IssueExtraLink[];
};

/** Route pattern → page file. Mirrors blocked-stock-fix-core FIX_ROUTE_FILES. */
export const ISSUE_FIX_ROUTE_FILES: Readonly<Record<string, string>> = {
  "/admin/inventory/drafts": "src/app/admin/inventory/drafts/page.tsx",
  "/admin/settings/types": "src/app/admin/settings/types/page.tsx",
  "/admin/inventory/intake/[id]": "src/app/admin/inventory/intake/[id]/page.tsx",
  "/admin/inventory/intake": "src/app/admin/inventory/intake/page.tsx",
  "/admin/inventory/[id]": "src/app/admin/inventory/[id]/page.tsx",
  "/admin/inventory": "src/app/admin/inventory/page.tsx",
  "/admin/products/[key]": "src/app/admin/products/[key]/page.tsx",
  "/admin/products": "src/app/admin/products/page.tsx",
  "/admin/knowledge-base/products": "src/app/admin/knowledge-base/products/page.tsx",
};

/** The codes this registry links. FYI codes and unknown codes get null. */
export const ISSUE_LINKED_CODES: readonly string[] = [
  "draft_inject_no_pos_key",
  "draft_inject_no_price",
  "fact_extraction_review",
  "intake_master_ambiguous_name",
  "draft_inject_unmapped_category",
  "draft_inject_potency_capped",
  "intake_master_no_vendor",
  "intake_master_merge_ambiguous",
];

const DRAFT_CODES = new Set([
  "draft_inject_no_pos_key",
  "draft_inject_no_price",
  "fact_extraction_review",
  "intake_master_ambiguous_name",
]);

/** Mastering codes whose context names the lot by `pos_product_key` only. */
const KEY_ONLY_CODES = new Set(["intake_master_no_vendor", "intake_master_ambiguous_name"]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clean(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function uuid(v: unknown): string | null {
  return isUuid(v) ? (v as string).trim().toLowerCase() : null;
}

/** Map an href to its route pattern (null = not a page this registry emits). */
export function issueRouteFor(href: string): string | null {
  const path = href.split(/[?#]/)[0];
  if (path in ISSUE_FIX_ROUTE_FILES) return path;
  if (/^\/admin\/inventory\/intake\/[^/]+$/.test(path)) return "/admin/inventory/intake/[id]";
  if (/^\/admin\/inventory\/[^/]+$/.test(path)) return "/admin/inventory/[id]";
  if (/^\/admin\/products\/[^/]+$/.test(path)) return "/admin/products/[key]";
  return null;
}

function routeFileOf(href: string): string {
  const route = issueRouteFor(href);
  // Every href below is built from a known prefix, so this never misses; the
  // self-tests assert it for every code × context shape.
  return route ? ISSUE_FIX_ROUTE_FILES[route] : "";
}

function link(
  href: string,
  label: string,
  kind: IssueLinkKind,
  fix: string | null = null,
  why: string | null = null,
  extra: IssueExtraLink[] = [],
): IssueFixLink {
  return { href, label, kind, routeFile: routeFileOf(href), fix, why, extra };
}

function extraLink(href: string, label: string): IssueExtraLink {
  return { href, label, routeFile: routeFileOf(href) };
}

/** `?back=` only for an in-admin path (never an open redirect). */
function backQs(back: string | null | undefined): string {
  const b = clean(back);
  return b && b.startsWith("/admin/") && !b.startsWith("//") ? `?back=${encodeURIComponent(b)}` : "";
}

/** The product (enrichment) page for a LIVE key. */
export function productPageHref(key: string, back?: string | null): string {
  return `/admin/products/${encodeURIComponent(key.trim())}${backQs(back)}`;
}

/** The lot page, optionally at an anchor. */
export function lotPageHref(lotId: string, anchor?: string): string {
  return `/admin/inventory/${lotId}${anchor ? `#${anchor}` : ""}`;
}

/**
 * The element id of an inventory-type row on the Types page. Both the link
 * and the page call this, so the anchor always agrees. Keyed by the same
 * normalisation the resolver's map uses (inventoryTypeKey).
 */
export function typeRowAnchorId(name: string): string {
  const slug = inventoryTypeKey(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `type-${slug || "unnamed"}`;
}

/** True when a Types-page row (by its key) is the type a link asked for. */
export function typeMatchesFocus(rowKey: string | null | undefined, focus: string | null | undefined): boolean {
  const f = clean(focus);
  const k = clean(rowKey);
  return Boolean(f && k && inventoryTypeKey(k) === inventoryTypeKey(f));
}

/** Types page, inventory tab, one type opened. */
export function typesHref(typeName: string): string {
  return `/admin/settings/types?tab=inventory&type=${encodeURIComponent(typeName.trim())}#${typeRowAnchorId(typeName)}`;
}

/** KB Product records, pre-searched (F-100). Blank query = the plain page. */
export function kbProductsHref(q: string | null | undefined): string {
  const s = clean(q);
  return `/admin/knowledge-base/products${s ? `?q=${encodeURIComponent(s.slice(0, 200))}` : ""}`;
}

/**
 * The lot page's enrichment button (F-101): /admin/products/[key] notFound()s
 * for a key that is not on the published menu, so the button opens the card
 * only when live; otherwise the enrichment list searched by name.
 */
export function lotEnrichmentHref(
  key: string | null | undefined,
  live: boolean,
  name: string | null | undefined,
  lotId: string,
): string {
  const k = clean(key);
  if (k && live) return productPageHref(k, `/admin/inventory/${lotId}`);
  const n = clean(name);
  return `/admin/products${n ? `?q=${encodeURIComponent(n)}` : ""}`;
}

/** The family segment of a vendor|category|family identity, as words. */
export function familyWordsFromIdentity(identity: string | null | undefined): string | null {
  const id = clean(identity);
  if (!id) return null;
  const parts = id.split("|");
  if (parts.length !== 3) return null;
  const words = parts[2].replace(/-+/g, " ").trim();
  return words || null;
}

// ---------------------------------------------------------------------------
// Copy (honest: every sentence names a control that exists today)
// ---------------------------------------------------------------------------

export const ISSUE_COPY = {
  ambiguousNameFix:
    "Nothing is lost \u2014 it sells as its own card. Open it to see the name we couldn't group by. " +
    "Product names come from the vendor's manifest and can't be edited here yet, so a one-off card is the safe result.",
  unmappedTypedFix: (t: string) =>
    `Map \u201c${t}\u201d to a website category under Types & Categories \u2014 the row is opened for you. ` +
    "Or re-file just this one product on its lot page. Then re-check this delivery.",
  unmappedMultiFix: (t: string) =>
    `\u201c${t}\u201d covers several of our categories, so the Types map is skipped for it on purpose. ` +
    "Pick this product's website category on its lot page (only this product changes).",
  unmappedLotFix: "Pick this product's website category on its lot page (only this product changes).",
  potencyFix:
    "The menu shows the capped value, never the impossible one. Compare it with the COA on the lot page. " +
    "Lab numbers come from the COA and can't be hand-edited, so if the COA itself is wrong, ask the vendor for a corrected one.",
  noVendorFix:
    "Nothing is lost \u2014 it sells as its own card. Products are only grouped per vendor, and this one arrived " +
    "without a vendor. Open the manifest to see what vendor it names and whether that vendor is linked.",
  mergeFix:
    "This product looks like more than one card already on your menu, so we kept it separate instead of guessing. " +
    "Compare the cards side by side. Nothing is lost \u2014 it sells as its own card. " +
    "Choosing where it belongs (and having that choice remembered) arrives with the match screen.",
  mergeWhy:
    "Products join a live card when vendor, category and product family all match exactly one card. " +
    "This one matched more than one, and we never merge on a guess.",
} as const;

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * The fix link for one diagnostic. Null for FYI / unknown codes (they need no
 * action and must never invent a link).
 */
export function fixLinkForDiagnostic(code: string, ctx: IssueContext = {}): IssueFixLink | null {
  const draftId = uuid(ctx.draftId);
  const lotId = uuid(ctx.lotId);
  const manifestId = uuid(ctx.manifestId);
  const key = clean(ctx.posProductKey);
  const name = clean(ctx.productName);
  const live = Boolean(key && ctx.isOnLiveMenu === true);

  if (DRAFT_CODES.has(code)) {
    const fix = code === "intake_master_ambiguous_name" ? ISSUE_COPY.ambiguousNameFix : null;
    if (draftId) {
      const label = name
        ? `Open ${name}`
        : code === "fact_extraction_review"
          ? "Open this product's draft"
          : "Open this product";
      return link(draftsHref({ status: "approved", draftId }), label, "item", fix);
    }
    if (manifestId) {
      return link(draftsHref({ status: "approved", manifestId }), "Open this delivery's products", "list", fix);
    }
    const href = code === "fact_extraction_review" ? draftsHref({ status: "approved" }) : draftsHref();
    return link(href, "Open onboarding", "list", fix);
  }

  switch (code) {
    case "draft_inject_unmapped_category": {
      const t = clean(ctx.typeName);
      const lotLink = lotId && key ? lotPageHref(lotId, "website-category") : null;
      if (t && !isMultiCategoryLcbType(t)) {
        const extra = lotLink ? [extraLink(lotLink, "Re-file just this product")] : [];
        return link(typesHref(t), `Map \u201c${t}\u201d`, "item", ISSUE_COPY.unmappedTypedFix(t), null, extra);
      }
      if (lotLink) {
        const fix = t ? ISSUE_COPY.unmappedMultiFix(t) : ISSUE_COPY.unmappedLotFix;
        return link(lotLink, "Choose this product's category", "item", fix);
      }
      return link("/admin/settings/types?tab=inventory", "Open Types & Categories", "list");
    }

    case "draft_inject_potency_capped": {
      const extra = live && key ? [extraLink(productPageHref(key, ctx.back), "See the menu card")] : [];
      if (lotId) return link(lotPageHref(lotId, "coa"), "Check the COA", "item", ISSUE_COPY.potencyFix, null, extra);
      if (live && key) return link(productPageHref(key, ctx.back), "See the menu card", "item", ISSUE_COPY.potencyFix);
      if (draftId) return link(draftsHref({ status: "approved", draftId }), name ? `Open ${name}` : "Open this product", "item", ISSUE_COPY.potencyFix);
      return link("/admin/inventory", "Open inventory", "list", ISSUE_COPY.potencyFix);
    }

    case "intake_master_no_vendor": {
      const extra = lotId ? [extraLink(lotPageHref(lotId), "Open the lot")] : [];
      if (manifestId) {
        return link(`/admin/inventory/intake/${manifestId}#manifest-vendor`, "Open this manifest's vendor", "item", ISSUE_COPY.noVendorFix, null, extra);
      }
      return link("/admin/inventory/intake", "Open receiving", "list", ISSUE_COPY.noVendorFix, null, extra);
    }

    case "intake_master_merge_ambiguous": {
      const cards = (ctx.liveCardKeys ?? []).map((k) => clean(k)).filter((k): k is string => Boolean(k));
      const extra = cards.map((k, i) => extraLink(productPageHref(k, ctx.back), `Live card ${i + 1}`));
      const family = familyWordsFromIdentity(ctx.identity);
      const href = family ? `/admin/products?q=${encodeURIComponent(family)}` : "/admin/products";
      return link(href, "Compare the cards", "list", ISSUE_COPY.mergeFix, ISSUE_COPY.mergeWhy, extra);
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Page-side assembly (pure): what to read, then how to fold it into contexts
// ---------------------------------------------------------------------------

export type IssueDiagnostic = { severity?: unknown; code?: unknown; context?: unknown };

function ctxObj(ctx: unknown): Record<string, unknown> {
  return ctx && typeof ctx === "object" && !Array.isArray(ctx) ? (ctx as Record<string, unknown>) : {};
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => clean(x)).filter((x): x is string => Boolean(x)) : [];
}

export type IssueLookupPlan = {
  /** Draft ids to read (uuid-validated, unique). */
  draftIds: string[];
  /** pos_product_keys to map to THIS manifest's approved drafts. */
  draftKeys: string[];
  /** Keys whose "is it live?" answer a link depends on. */
  liveKeys: string[];
};

/** What the page must read to link these warnings. Warnings only, first `cap`. */
export function issueLookupPlan(diags: readonly IssueDiagnostic[], cap = 100): IssueLookupPlan {
  const draftIds = new Set<string>();
  const draftKeys = new Set<string>();
  const liveKeys = new Set<string>();
  for (const d of diags.filter((x) => x.severity === "warning").slice(0, cap)) {
    const code = typeof d.code === "string" ? d.code : "";
    if (!ISSUE_LINKED_CODES.includes(code)) continue;
    const c = ctxObj(d.context);
    const id = uuid(c.draft_id);
    if (id) draftIds.add(id);
    const key = clean(c.pos_product_key);
    if (key && KEY_ONLY_CODES.has(code)) draftKeys.add(key);
    if (key && code === "draft_inject_potency_capped") liveKeys.add(key);
    if (code === "intake_master_merge_ambiguous") for (const k of strList(c.live_card_keys)) liveKeys.add(k);
  }
  return { draftIds: [...draftIds], draftKeys: [...draftKeys], liveKeys: [...liveKeys] };
}

/** The draft facts a link needs (named columns of catalog_product_drafts). */
export type IssueDraftRow = {
  id: string;
  lot_id: string | null;
  inventory_type: string | null;
  pos_product_key: string | null;
  name: string | null;
};

export type IssueLookups = {
  draftsById: ReadonlyMap<string, IssueDraftRow>;
  /** Only keys that map to exactly ONE approved draft of this delivery. */
  draftsByKey: ReadonlyMap<string, IssueDraftRow>;
  liveKeys: ReadonlySet<string>;
};

export const EMPTY_ISSUE_LOOKUPS: IssueLookups = {
  draftsById: new Map(),
  draftsByKey: new Map(),
  liveKeys: new Set(),
};

/**
 * Index draft rows. A key shared by two approved drafts is AMBIGUOUS and is
 * dropped from the key index (never guess which product a warning meant).
 */
export function indexIssueDrafts(
  byIdRows: readonly IssueDraftRow[],
  byKeyRows: readonly IssueDraftRow[],
): Pick<IssueLookups, "draftsById" | "draftsByKey"> {
  const draftsById = new Map<string, IssueDraftRow>();
  for (const r of byIdRows) {
    const id = uuid(r.id);
    if (id) draftsById.set(id, r);
  }
  const seen = new Map<string, IssueDraftRow | null>();
  for (const r of byKeyRows) {
    const k = clean(r.pos_product_key);
    if (!k || !uuid(r.id)) continue;
    const prev = seen.get(k);
    seen.set(k, prev === undefined || prev?.id === r.id ? r : null);
  }
  const draftsByKey = new Map<string, IssueDraftRow>();
  for (const [k, r] of seen) if (r) draftsByKey.set(k, r);
  return { draftsById, draftsByKey };
}

/** Fold one diagnostic + the page's reads into an IssueContext. */
export function issueContextFor(
  d: IssueDiagnostic,
  base: { manifestId?: string | null; back?: string | null },
  lookups: IssueLookups,
): IssueContext {
  const code = typeof d.code === "string" ? d.code : "";
  const c = ctxObj(d.context);
  const key = clean(c.pos_product_key);
  const pinned = uuid(c.draft_id);
  const row =
    (pinned ? lookups.draftsById.get(pinned) : undefined) ??
    (!pinned && key && KEY_ONLY_CODES.has(code) ? lookups.draftsByKey.get(key) : undefined) ??
    null;
  const draftId = pinned ?? (row ? uuid(row.id) : null);
  const productKey = key ?? clean(row?.pos_product_key);
  return {
    draftId,
    lotId: uuid(row?.lot_id),
    manifestId: uuid(base.manifestId),
    posProductKey: productKey,
    typeName: clean(row?.inventory_type),
    isOnLiveMenu: Boolean(productKey && lookups.liveKeys.has(productKey)),
    productName: clean(c.displayName) ?? clean(c.productName) ?? clean(row?.name),
    liveCardKeys: strList(c.live_card_keys).filter((k) => lookups.liveKeys.has(k)),
    identity: clean(c.identity),
    back: clean(base.back),
  };
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern; run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runIssueFixLinkCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, what: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`issue-fix-link-core FAIL: ${what}`);
    }
  };

  const D = "0b6f3c1e-2d4a-4f5b-9c8d-1a2b3c4d5e6f";
  const L = "1c7a4d2f-3e5b-4a6c-8d9e-2b3c4d5e6f70";
  const M = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
  const full: IssueContext = {
    draftId: D,
    lotId: L,
    manifestId: M,
    posProductKey: "SKU-1",
    typeName: "Solid Edible",
    isOnLiveMenu: true,
    productName: "Kiva Gummies",
    liveCardKeys: ["CARD-A", "CARD B"],
    identity: "acme-farms|flower|blue-dream",
    back: "/admin/menu-imports/version/v1",
  };

  // 1. every linked code × {full, empty} → a link whose route is registered
  for (const code of ISSUE_LINKED_CODES) {
    for (const [label, ctx] of [["full", full], ["empty", {}]] as const) {
      const l = fixLinkForDiagnostic(code, ctx);
      ok(l !== null, `${code} ${label}: a link`);
      if (!l) continue;
      const route = issueRouteFor(l.href);
      ok(route !== null && ISSUE_FIX_ROUTE_FILES[route] === l.routeFile, `${code} ${label}: registered route (${l.href})`);
      ok(l.label.length > 0 && !l.label.includes("\u2192"), `${code} ${label}: label without arrow (the page adds it)`);
      for (const e of l.extra) ok(issueRouteFor(e.href) !== null && e.routeFile.length > 0, `${code} ${label}: extra route ${e.href}`);
    }
  }
  ok(ISSUE_LINKED_CODES.length === 8, "eight linked codes");
  ok(fixLinkForDiagnostic("intake_master_grouped", full) === null, "FYI code → null");
  ok(fixLinkForDiagnostic("draft_injected", full) === null, "success note → null");
  ok(fixLinkForDiagnostic("made_up", full) === null, "unknown code → null");
  ok(fixLinkForDiagnostic("books_lot_cost_unknown", full) === null, "S33 code not linked until S33 builds its control");

  // 2. draft codes → the exact draft
  const pinned = `/admin/inventory/drafts?status=approved&draft=${D}#draft-${D}`;
  for (const code of ["draft_inject_no_pos_key", "draft_inject_no_price", "fact_extraction_review", "intake_master_ambiguous_name"]) {
    const l = fixLinkForDiagnostic(code, { draftId: D })!;
    ok(l.href === pinned && l.kind === "item", `${code}: pinned draft`);
    const m = fixLinkForDiagnostic(code, { manifestId: M })!;
    ok(m.href === `/admin/inventory/drafts?status=approved&manifest=${M}` && m.kind === "list", `${code}: manifest-scoped`);
    ok(m.label === "Open this delivery's products", `${code}: manifest label`);
  }
  ok(fixLinkForDiagnostic("fact_extraction_review", { draftId: D })!.label === "Open this product's draft", "fact review nameless label (bible copy)");
  ok(fixLinkForDiagnostic("draft_inject_no_price", { draftId: D })!.label === "Open this product", "nameless label");
  ok(fixLinkForDiagnostic("draft_inject_no_price", { draftId: D, productName: " Kiva " })!.label === "Open Kiva", "named label, trimmed");
  ok(fixLinkForDiagnostic("fact_extraction_review", {})!.href === "/admin/inventory/drafts?status=approved", "fact review list → approved tab (F-094)");
  ok(fixLinkForDiagnostic("draft_inject_no_pos_key", {})!.href === "/admin/inventory/drafts", "no key list");
  ok(fixLinkForDiagnostic("draft_inject_no_price", { draftId: "nope", manifestId: "bad" })!.href === "/admin/inventory/drafts", "bad ids never reach a URL");
  ok(fixLinkForDiagnostic("intake_master_ambiguous_name", {})!.fix === ISSUE_COPY.ambiguousNameFix, "ambiguous name honest copy");
  ok(!/rename it/i.test(ISSUE_COPY.ambiguousNameFix), "no rename promise (no rename control exists)");
  ok(fixLinkForDiagnostic("draft_inject_no_price", { draftId: D })!.fix === null, "no-price keeps the base copy");
  ok(fixLinkForDiagnostic("draft_inject_no_price", { draftId: D.toUpperCase() })!.href === pinned, "uuid lower-cased");

  // 3. unmapped category
  const typed = fixLinkForDiagnostic("draft_inject_unmapped_category", { typeName: "Solid Edible", lotId: L, posProductKey: "K" })!;
  ok(typed.href === "/admin/settings/types?tab=inventory&type=Solid%20Edible#type-solid-edible", "types: inventory tab + type + anchor");
  ok(typed.kind === "item" && typed.label === "Map \u201cSolid Edible\u201d", "types: item + label");
  ok(typed.extra.length === 1 && typed.extra[0].href === `/admin/inventory/${L}#website-category`, "types: lot re-file extra");
  ok(typed.fix === ISSUE_COPY.unmappedTypedFix("Solid Edible"), "types: fix copy");
  const typedNoLot = fixLinkForDiagnostic("draft_inject_unmapped_category", { typeName: "Solid Edible" })!;
  ok(typedNoLot.extra.length === 0, "types: no lot → no extra");
  const typedNoKey = fixLinkForDiagnostic("draft_inject_unmapped_category", { typeName: "Solid Edible", lotId: L })!;
  ok(typedNoKey.extra.length === 0, "types: lot without key → no extra (the lot panel needs a key)");
  const multi = fixLinkForDiagnostic("draft_inject_unmapped_category", { typeName: "Usable Marijuana", lotId: L, posProductKey: "K" })!;
  ok(multi.href === `/admin/inventory/${L}#website-category` && multi.kind === "item", "multi-category → lot override");
  ok(multi.fix === ISSUE_COPY.unmappedMultiFix("Usable Marijuana"), "multi copy");
  const multiNoLot = fixLinkForDiagnostic("draft_inject_unmapped_category", { typeName: "Usable Marijuana" })!;
  ok(multiNoLot.href === "/admin/settings/types?tab=inventory" && multiNoLot.kind === "list", "multi, no lot → list");
  const noType = fixLinkForDiagnostic("draft_inject_unmapped_category", { lotId: L, posProductKey: "K" })!;
  ok(noType.href === `/admin/inventory/${L}#website-category` && noType.fix === ISSUE_COPY.unmappedLotFix, "no type, lot → lot");
  ok(fixLinkForDiagnostic("draft_inject_unmapped_category", {})!.label === "Open Types & Categories", "empty → list label");

  // 4. potency — never the product page unless live
  const potLive = fixLinkForDiagnostic("draft_inject_potency_capped", { lotId: L, posProductKey: "K 1", isOnLiveMenu: true, back: "/admin/x" })!;
  ok(potLive.href === `/admin/inventory/${L}#coa` && potLive.kind === "item", "potency → COA panel");
  ok(potLive.extra.length === 1 && potLive.extra[0].href === "/admin/products/K%201?back=%2Fadmin%2Fx", "potency live → card extra with back");
  const potDead = fixLinkForDiagnostic("draft_inject_potency_capped", { lotId: L, posProductKey: "K", isOnLiveMenu: false })!;
  ok(potDead.extra.length === 0, "potency not live → no product link (F-101)");
  const noLotLive = fixLinkForDiagnostic("draft_inject_potency_capped", { posProductKey: "K", isOnLiveMenu: true })!;
  ok(noLotLive.href === "/admin/products/K", "potency no lot, live → card");
  const noLotDead = fixLinkForDiagnostic("draft_inject_potency_capped", { posProductKey: "K", isOnLiveMenu: false, draftId: D })!;
  ok(noLotDead.href === pinned, "potency no lot, not live → draft");
  const potEmpty = fixLinkForDiagnostic("draft_inject_potency_capped", { posProductKey: "K" })!;
  ok(potEmpty.href === "/admin/inventory" && !potEmpty.href.includes("/admin/products/"), "potency: missing isOnLiveMenu is NOT live");
  ok(fixLinkForDiagnostic("draft_inject_potency_capped", { isOnLiveMenu: true })!.href === "/admin/inventory", "live flag without key → no card");
  ok(potLive.fix === ISSUE_COPY.potencyFix && !/enrichment page/i.test(ISSUE_COPY.potencyFix), "potency honest copy");
  ok(fixLinkForDiagnostic("draft_inject_potency_capped", { posProductKey: "K", isOnLiveMenu: true, back: "https://evil" })!.href === "/admin/products/K", "back never off-site");
  ok(fixLinkForDiagnostic("draft_inject_potency_capped", { posProductKey: "K", isOnLiveMenu: true, back: "//evil" })!.href === "/admin/products/K", "back never protocol-relative");

  // 5. no vendor
  const nv = fixLinkForDiagnostic("intake_master_no_vendor", { manifestId: M, lotId: L })!;
  ok(nv.href === `/admin/inventory/intake/${M}#manifest-vendor` && nv.kind === "item", "no vendor → manifest vendor block");
  ok(nv.label === "Open this manifest's vendor", "no vendor label");
  ok(nv.extra.length === 1 && nv.extra[0].href === `/admin/inventory/${L}`, "no vendor lot extra");
  const nvList = fixLinkForDiagnostic("intake_master_no_vendor", {})!;
  ok(nvList.href === "/admin/inventory/intake" && nvList.kind === "list" && nvList.extra.length === 0, "no vendor list");

  // 6. merge ambiguous
  const mg = fixLinkForDiagnostic("intake_master_merge_ambiguous", full)!;
  ok(mg.href === "/admin/products?q=blue%20dream" && mg.kind === "list", "merge → enrichment search by family");
  ok(mg.label === "Compare the cards", "merge label");
  ok(mg.extra.length === 2 && mg.extra[1].href === `/admin/products/CARD%20B?back=${encodeURIComponent(full.back!)}` && mg.extra[1].label === "Live card 2", "merge: one link per live card");
  ok(mg.why === ISSUE_COPY.mergeWhy && mg.fix === ISSUE_COPY.mergeFix, "merge copy");
  ok(!/remember your choice|we'll remember/i.test(ISSUE_COPY.mergeFix), "merge never promises a remembered choice before S32");
  ok(!mg.href.includes("masters"), "merge never sends to Product Mastering (F-096)");
  ok(fixLinkForDiagnostic("intake_master_merge_ambiguous", { identity: "bad" })!.href === "/admin/products", "bad identity → plain list");
  ok(fixLinkForDiagnostic("intake_master_merge_ambiguous", { liveCardKeys: [" ", "X"] })!.extra.length === 1, "blank card keys dropped");

  // 7. helpers
  ok(typeRowAnchorId("  Solid   Edible ") === "type-solid-edible", "anchor normalises like the resolver");
  ok(typeRowAnchorId("Mix / Infused!") === "type-mix-infused", "anchor slug");
  ok(typeRowAnchorId("!!!") === "type-unnamed", "anchor never empty");
  ok(typeMatchesFocus("solid edible", " Solid  Edible "), "focus match normalised");
  ok(!typeMatchesFocus("solid edible", null) && !typeMatchesFocus(null, "x") && !typeMatchesFocus("a", "b"), "focus mismatch");
  ok(kbProductsHref(" Blue Dream ") === "/admin/knowledge-base/products?q=Blue%20Dream", "kb q");
  ok(kbProductsHref("") === "/admin/knowledge-base/products" && kbProductsHref(null) === "/admin/knowledge-base/products", "kb blank");
  ok(kbProductsHref("x".repeat(300)).length === "/admin/knowledge-base/products?q=".length + 200, "kb q capped at 200");
  ok(familyWordsFromIdentity("v|c|blue--dream") === "blue dream", "family words");
  ok(familyWordsFromIdentity("v|c|") === null && familyWordsFromIdentity("a|b") === null && familyWordsFromIdentity(null) === null, "family degrade");
  ok(issueRouteFor("/admin/inventory/intake") === "/admin/inventory/intake", "exact route beats pattern");
  ok(issueRouteFor(`/admin/inventory/intake/${M}#x`) === "/admin/inventory/intake/[id]", "manifest route");
  ok(issueRouteFor("/admin/inventory/drafts?x=1") === "/admin/inventory/drafts", "drafts route");
  ok(issueRouteFor("/admin/nope/x/y") === null, "unknown route");
  ok(productPageHref(" K ") === "/admin/products/K", "product href trims");
  ok(lotPageHref(L) === `/admin/inventory/${L}` && lotPageHref(L, "coa") === `/admin/inventory/${L}#coa`, "lot href");

  // 8. lookup plan
  const diags: IssueDiagnostic[] = [
    { severity: "warning", code: "draft_inject_no_price", context: { draft_id: D } },
    { severity: "warning", code: "intake_master_no_vendor", context: { pos_product_key: "K1" } },
    { severity: "warning", code: "intake_master_ambiguous_name", context: { pos_product_key: "K2" } },
    { severity: "warning", code: "draft_inject_potency_capped", context: { draft_id: D, pos_product_key: "K3" } },
    { severity: "warning", code: "intake_master_merge_ambiguous", context: { live_card_keys: ["C1", "", 5, "C2"] } },
    { severity: "info", code: "intake_master_no_vendor", context: { pos_product_key: "INFO" } },
    { severity: "warning", code: "draft_inject_no_price", context: { draft_id: "bad" } },
    { severity: "warning", code: "made_up", context: { draft_id: L, pos_product_key: "X" } },
    { severity: "warning", code: "draft_inject_unmapped_category", context: [] },
  ];
  const plan = issueLookupPlan(diags);
  ok(plan.draftIds.length === 1 && plan.draftIds[0] === D, "plan: unique valid draft ids from linked warnings only");
  ok(plan.draftKeys.join(",") === "K1,K2", "plan: key-only mastering codes");
  ok(plan.liveKeys.join(",") === "K3,C1,C2", "plan: potency key + live card keys");
  ok(issueLookupPlan(diags, 1).draftKeys.length === 0, "plan honours the cap");
  ok(issueLookupPlan([]).draftIds.length === 0, "plan empty");

  // 9. index + context
  const rowA: IssueDraftRow = { id: D, lot_id: L, inventory_type: "Solid Edible", pos_product_key: "K1", name: "Gummies" };
  const rowB: IssueDraftRow = { id: L, lot_id: null, inventory_type: null, pos_product_key: "DUP", name: null };
  const rowC: IssueDraftRow = { id: M, lot_id: null, inventory_type: null, pos_product_key: "DUP", name: null };
  const idx = indexIssueDrafts([rowA, { ...rowA, id: "junk" }], [rowA, rowA, rowB, rowC, { ...rowA, id: "junk", pos_product_key: "J" }]);
  ok(idx.draftsById.size === 1 && idx.draftsById.get(D) === rowA, "index by id drops junk ids");
  ok(idx.draftsByKey.get("K1") === rowA, "same row twice is not ambiguous");
  ok(!idx.draftsByKey.has("DUP"), "a key on two drafts is ambiguous → dropped");
  ok(!idx.draftsByKey.has("J"), "junk id never indexed by key");
  const lookups: IssueLookups = { ...idx, liveKeys: new Set(["K1", "C1"]) };
  const nvCtx = issueContextFor(diags[1], { manifestId: M, back: "/admin/v" }, lookups);
  ok(nvCtx.draftId === D && nvCtx.lotId === L && nvCtx.manifestId === M, "mastering key → draft + lot (server-mapped)");
  ok(nvCtx.typeName === "Solid Edible" && nvCtx.productName === "Gummies" && nvCtx.isOnLiveMenu === true, "facts folded");
  ok(nvCtx.back === "/admin/v", "back carried");
  const pinCtx = issueContextFor({ code: "draft_inject_no_price", context: { draft_id: D, displayName: "Shown" } }, {}, lookups);
  ok(pinCtx.draftId === D && pinCtx.productName === "Shown" && pinCtx.lotId === L, "draft id wins; displayName first");
  const pinProd = issueContextFor({ code: "draft_inject_no_price", context: { draft_id: D, productName: "Raw" } }, {}, lookups);
  ok(pinProd.productName === "Raw", "productName second");
  const unknownPinned = issueContextFor({ code: "draft_inject_no_price", context: { draft_id: M, pos_product_key: "K1" } }, {}, lookups);
  ok(unknownPinned.draftId === M && unknownPinned.lotId === null, "pinned id not read → never swapped for a key match");
  const pinnedKeyOnly = issueContextFor({ code: "intake_master_ambiguous_name", context: { draft_id: M, pos_product_key: "K1" } }, {}, lookups);
  ok(pinnedKeyOnly.draftId === M && pinnedKeyOnly.lotId === null, "key-only code: a pinned (unread) id still wins over the key match");
  const upper = fixLinkForDiagnostic("draft_inject_no_price", { draftId: D.toUpperCase() })!;
  ok(upper.href === `/admin/inventory/drafts?status=approved&draft=${D}#draft-${D}`, "uuid normalised to lowercase");
  const upperCtx = issueContextFor({ code: "draft_inject_no_price", context: { draft_id: D.toUpperCase() } }, {}, lookups);
  ok(upperCtx.draftId === D && upperCtx.lotId === L, "upper-case context id still finds the (lower-case) DB row");
  const draftCodeKey = issueContextFor({ code: "draft_inject_potency_capped", context: { pos_product_key: "K1" } }, {}, lookups);
  ok(draftCodeKey.draftId === null, "key→draft mapping only for key-only mastering codes");
  const mgCtx = issueContextFor(diags[4], { manifestId: "bad" }, lookups);
  ok(mgCtx.liveCardKeys!.join(",") === "C1" && mgCtx.manifestId === null, "only still-live cards; bad manifest dropped");
  const junk = issueContextFor({ code: 5, context: "x" }, {}, EMPTY_ISSUE_LOOKUPS);
  ok(junk.draftId === null && junk.isOnLiveMenu === false && junk.liveCardKeys!.length === 0, "junk degrades");
  const keyFromRow = issueContextFor({ code: "draft_inject_no_price", context: { draft_id: D } }, {}, lookups);
  ok(keyFromRow.posProductKey === "K1" && keyFromRow.isOnLiveMenu === true, "key falls back to the draft row");

  // 10. end-to-end: every warning shape lands on an item link when the reads succeeded
  const e2e = fixLinkForDiagnostic("intake_master_no_vendor", nvCtx)!;
  ok(e2e.kind === "item" && e2e.extra[0].href === `/admin/inventory/${L}`, "e2e no vendor");
  const e2eAmb = fixLinkForDiagnostic("intake_master_ambiguous_name", issueContextFor(diags[1], { manifestId: M }, lookups))!;
  ok(e2eAmb.href === pinned && e2eAmb.label === "Open Gummies", "e2e ambiguous name → its draft");

  // 11. lot-page enrichment button (F-101)
  ok(lotEnrichmentHref("K 1", true, "Gummies", L) === `/admin/products/K%201?back=%2Fadmin%2Finventory%2F${L}`, "live → card with back");
  ok(lotEnrichmentHref("K1", false, " Gummies ", L) === "/admin/products?q=Gummies", "not live → searched list");
  ok(lotEnrichmentHref(null, true, "G", L) === "/admin/products?q=G", "no key → searched list");
  ok(lotEnrichmentHref("K1", false, null, L) === "/admin/products", "no key, no name → plain list");

  return { passed, failed };
}
