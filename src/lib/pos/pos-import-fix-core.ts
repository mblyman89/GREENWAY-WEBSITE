/**
 * src/lib/pos/pos-import-fix-core.ts  (Round 13 — Cultivera import fix buttons)
 *
 * Owner, Round 13: "fix buttons for the menu import from Cultivera don't allow
 * me to fix anything … The buttons take me places that are then blank with
 * nothing to do there … I need to be able to fix things."
 *
 * ═══ THE DEAD END THIS CLOSES (verified, not assumed) ═══
 *
 * /admin/menu-imports/[id] rendered every diagnostic as `code · sample · ×N`
 * with NO control, every hidden item as a bare `hidden_reason` chip, and the
 * "COA to attach" / "Expiry to set" stat cards as plain numbers. This module
 * decides, per diagnostic code and per hidden reason, WHERE the real control
 * for it lives. Every destination below was read in the code before it was
 * named here:
 *
 *   fact review          /admin/menu-imports/<id>/facts — Approve / Fix values /
 *                        Reject forms; recordFactReview (fact-review-store.ts)
 *                        mirrors the decision onto EVERY version of the import,
 *                        published included (it selects by import_id only).
 *   missing masters      /admin/menu-imports/<id>/missing-products — rep sheet.
 *   bulk fill            /admin/inventory?…&bulk=1&bulkField=<f> — only lots
 *                        carrying MIGRATION_MARKER, which import-lot-core.ts
 *                        writes on every Cultivera lot.
 *   received date        /admin/inventory?needsReceivedDate=1 → lot page form.
 *   sell price           /admin/inventory?q=<name> → lot page "Save sell price".
 *   visibility           /admin/products/<key>#visibility — writes
 *                        menu_items.hidden on the live versions (Round 12).
 *                        The product page 404s unless the card is in the
 *                        PUBLISHED version, so it is only linked when this
 *                        import's version is the published one.
 *   strain type          /admin/menu-imports/[id]/strains (R15b KB fixer) + the library — the live menu overlays
 *                        strain type from the KB by strain NAME
 *                        (strain-terpenes-server.ts buildMenuIndexes).
 *   cycle counts         /admin/inventory/audits/new?fromImport=<id> (R14b) —
 *                        the audit planner reads the import's own
 *                        import_lots_mixed_size_cards diagnostic, whose
 *                        context now carries EVERY flagged pos_product_key
 *                        (import-lot-core.ts), and preloads exactly those
 *                        products' open lots. The bare cycle-count queue it
 *                        used to open creates nothing (owner, Round 14).
 *   unmapped category    /admin/settings/types?tab=inventory&type=<category>
 *                        — the Types page opens (or offers to add) that exact
 *                        type (S26 focus); cultivera-type-from-category-core
 *                        names a suggested placement.
 *
 * Lots are created only when the version is published (or backfilled), so a
 * lot link is only offered once the lots exist; before that the copy says so
 * and, for a published import with no lots, points at the backfill button.
 *
 * Codes whose only fix is inside Cultivera's own export (a row it exported
 * with a blank name, a card with no variants) get honest copy and no button —
 * a button there would be the very "blank screen" the owner reported.
 *
 * Pure: no I/O.
 */

export type PosFixLink = { href: string; label: string };

// R14b: the grounded unknown-category suggestion (pure: catalog + name rules,
// no I/O; it does not import this file, so no cycle).
import { suggestForUnknownCategory } from "@/lib/pos/cultivera-type-from-category-core";

export type PosImportFix = {
  /** What the code means, in plain English. */
  what: string;
  /** What to do about it. */
  how: string;
  /** Where the real control lives. Empty only for CULTIVERA_ONLY_CODES / pure info. */
  links: PosFixLink[];
};

export type PosFixContext = {
  importId: string;
  /** This import's version is the published (live) one. */
  versionPublished: boolean;
  /** Compliance lots for this import exist (import_lots_created/_already_created). */
  lotsCreated: boolean;
};

/** Review codes (fact-review-core REVIEW_DIAGNOSTIC_CODES), repeated to keep this core leaf-pure. */
export const POS_REVIEW_CODES: readonly string[] = [
  "fact_extraction_review",
  "package_size_mg_garbage",
  "cannabinoid_value_capped",
  "cannabinoid_missing",
];

/**
 * Codes that can only be fixed in Cultivera's export itself. Honest copy, no
 * button. Each was checked: the row was SKIPPED (blank name / blank product) or
 * produced a card with nothing sellable, so no record exists here to edit.
 */
export const CULTIVERA_ONLY_CODES: readonly string[] = [
  "blank_product_name",
  "blank_inventory_product",
  "no_variants",
];

/** Blocking errors: the file cannot be published; the fix is a corrected re-upload. */
export const POS_ERROR_CODES: readonly string[] = [
  "duplicate_menu_id",
  "invalid_category",
  "invalid_price",
  "invalid_variant_inventory",
  "invalid_variant_price",
  "missing_columns",
  "missing_display_fields",
];

export const UNKNOWN_COST_BULK_HREF =
  "/admin/inventory?status=active&unknownCost=1&bulk=1&bulkField=unit_cost_minor_units";
export const MISSING_EXPIRY_BULK_HREF =
  "/admin/inventory?status=active&missingExpiry=1&bulk=1&bulkField=expires_on";
export const MISSING_COA_HREF = "/admin/inventory?status=active&coa=no";
export const NEEDS_RECEIVED_DATE_HREF = "/admin/inventory?needsReceivedDate=1";
export const STRAIN_LIBRARY_HREF = "/admin/knowledge-base/library";
export const MENU_IMPORTS_HREF = "/admin/menu-imports";

/** Anchor ids rendered on /admin/menu-imports/[id] (asserted by the page test). */
export const IMPORT_PAGE_ANCHORS = {
  diagnostics: "diagnostics",
  hidden: "hidden-items",
  backfill: "backfill-lots",
  lotPlan: "lot-plan",
} as const;

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function factsHref(importId: string): string {
  return `/admin/menu-imports/${enc(importId)}/facts`;
}

export function missingProductsHref(importId: string): string {
  return `/admin/menu-imports/${enc(importId)}/missing-products`;
}

/** R15b: the KB strain-type fixer for one import. */
export function strainsHref(importId: string): string {
  return `/admin/menu-imports/${enc(importId)}/strains`;
}

/** R15b: the CCRS adjust-out of legacy no-product-master lots. */
export function legacyRemovalHref(importId: string): string {
  return `${missingProductsHref(importId)}#remove-legacy`;
}

export function importHref(importId: string, anchor?: string): string {
  return `/admin/menu-imports/${enc(importId)}${anchor ? `#${anchor}` : ""}`;
}

/** The lot list narrowed by a free-text needle (store.ts: lot_code / product_name / pos_product_key). */
export function lotSearchHref(needle: string, bulkField?: string): string {
  const p = new URLSearchParams();
  p.set("q", needle.trim());
  if (bulkField) {
    p.set("bulk", "1");
    p.set("bulkField", bulkField);
  }
  return `/admin/inventory?${p.toString()}`;
}

/** The product (card) page, landing on its Visibility control. */
export function productVisibilityHref(sourceItemId: string, back?: string): string {
  const q = back ? `?back=${enc(back)}` : "";
  return `/admin/products/${enc(sourceItemId)}${q}#visibility`;
}

/** The products list filtered by text (products/page.tsx: name or brand contains q). */
export function productSearchHref(q: string): string {
  return `/admin/products?q=${enc(q.trim())}`;
}

/** R16b: this import's undated lots, one form per vendor (received-dates page). */
export function importReceivedDatesHref(importId: string): string {
  return `/admin/menu-imports/${enc(importId)}/received-dates`;
}

/**
 * R14b: a new count preloaded with every open lot of the products this
 * import's mixed-size diagnostic flagged (audits/new reads the keys from the
 * stored diagnostic by import id; the URL never carries 200 keys).
 */
export function countFlaggedProductsHref(importId: string): string {
  return `/admin/inventory/audits/new?fromImport=${enc(importId)}`;
}

/**
 * R14b: the Types page with one inventory type opened (or offered to add).
 * `suggest` (a website category slug, e.g. from cultivera-type-from-category-
 * core) prefills the Add form's mapping; the Types page re-checks it against
 * the live registry before using it.
 */
export function typeFocusHref(typeName: string, suggest?: string | null): string {
  const base = `/admin/settings/types?tab=inventory&type=${enc(typeName.trim())}`;
  const s = String(suggest ?? "").trim();
  return /^[a-z0-9-]{1,60}$/.test(s) ? `${base}&suggest=${enc(s)}` : base;
}

/** Lot links are only real once the lots exist. */
function lotLinks(ctx: PosFixContext, links: PosFixLink[]): { links: PosFixLink[]; note: string } {
  if (ctx.lotsCreated) return { links, note: "" };
  if (ctx.versionPublished) {
    return {
      links: [{ href: importHref(ctx.importId, IMPORT_PAGE_ANCHORS.backfill), label: "Create the inventory records first" }],
      note: " This import is live but its inventory records were never created, so create them first — then this opens them.",
    };
  }
  return {
    links: [],
    note: " The inventory records for this import are created when you publish it; after that this button opens them.",
  };
}

/**
 * The fix for a whole diagnostic code on a POS import. Null = pure information
 * with nothing to do (the code is explained by its own message).
 */
export function posImportFixFor(code: string, ctx: PosFixContext): PosImportFix | null {
  const facts: PosFixLink = { href: factsHref(ctx.importId), label: "Fix these in Fact review" };
  if (POS_REVIEW_CODES.includes(code)) {
    return {
      what: "A fact on these products (size, THC/CBD, servings) could not be confirmed from the export.",
      how: "Approve each as-is, type the correct values, or keep it off the menu. Decisions apply to this import's live menu too.",
      links: [facts],
    };
  }
  if (POS_ERROR_CODES.includes(code)) {
    return {
      what: "Blocking: the export itself is malformed for these rows, so this import cannot be published.",
      how: "Correct the row in Cultivera (or the downloaded file) and upload the corrected files again.",
      links: [{ href: MENU_IMPORTS_HREF, label: "Upload corrected files" }],
    };
  }
  switch (code) {
    case "inventory_without_product_master":
      return {
        what: "In your inventory file but missing from your products file, so the card is hidden.",
        how: "Work the list by brand and send the rep sheet to Cultivera; or show a product anyway from its product page. If they are legacy records with no real stock, adjust them out of CCRS (Reconciliation) in one confirmed press.",
        links: [
          { href: missingProductsHref(ctx.importId), label: "Work the missing products" },
          ...(ctx.lotsCreated ? [{ href: legacyRemovalHref(ctx.importId), label: "Adjust legacy lots out of CCRS" }] : []),
        ],
      };
    case "product_without_inventory":
      return {
        what: "In your products file with no stock rows, so there is nothing to sell yet.",
        how: "Nothing is wrong with the product; it shows once stock arrives. Each one is listed under Hidden items with its own button.",
        links: [{ href: importHref(ctx.importId, IMPORT_PAGE_ANCHORS.hidden), label: "See the hidden items" }],
      };
    case "flower_same_size_different_price": {
      const l = lotLinks(ctx, [{ href: "/admin/inventory?status=active", label: "Open the lots to correct a price" }]);
      return {
        what: "Two lots of the same flower size carry very different prices in Cultivera.",
        how: `Open each product below and correct its sell price on the lot page ("Save sell price").${l.note}`,
        links: l.links,
      };
    }
    case "unknown_strain_type":
      return {
        what: "Cultivera's strain type was blank or unrecognised, so the card shows no indica/sativa/hybrid.",
        how: "Match each strain name to the Knowledge Base: exact matches apply in one press, close ones wait for your confirm, and anything new you can type and save to the Strain library so the next import matches on its own.",
        links: [
          { href: strainsHref(ctx.importId), label: "Fix strain types from the Knowledge Base" },
          { href: STRAIN_LIBRARY_HREF, label: "Open the Strain library" },
        ],
      };
    case "new_unmapped_category":
    case "unmapped_category_fallback":
      return {
        what: "Cultivera used a category name the importer does not know, so it was filed under a best-guess category.",
        how: "Use the button on each row below: it opens that exact category on the Types page, where you add it with the suggested website category (the Type & category check on this page names the suggestion). That mapping re-files the back office at once; to move one product on the live menu, re-file it from the check below or its lot page.",
        links: [{ href: "/admin/settings/types?tab=inventory", label: "Open Types & Categories" }],
      };
    case "blank_product_name":
      return { what: "Cultivera exported a row with no product name, so it was skipped.", how: "Only Cultivera can fix this row: give it a name there and re-export.", links: [] };
    case "blank_inventory_product":
      return { what: "Cultivera exported a stock row with no product, so it was skipped.", how: "Only Cultivera can fix this row: link it to a product there and re-export.", links: [] };
    case "no_variants":
      return { what: "A card was built with no sellable sizes.", how: "Nothing here can sell it; check the product's sizes and stock in Cultivera and re-export.", links: [] };
    case "import_lot_cost_unparseable": {
      const l = lotLinks(ctx, [{ href: UNKNOWN_COST_BULK_HREF, label: "Fill unit costs with Bulk fill" }]);
      return { what: "The cost cell could not be read, so the lot has no unit cost and margin reports skip it.", how: `Type the costs in Bulk fill; it previews every lot before saving.${l.note}`, links: l.links };
    }
    case "import_lots_expiration_missing_summary": {
      const l = lotLinks(ctx, [{ href: MISSING_EXPIRY_BULK_HREF, label: "Set expiry dates with Bulk fill" }]);
      return { what: "Cultivera sent no expiration date for these lots.", how: `Set them in Bulk fill so expiry controls apply.${l.note}`, links: l.links };
    }
    case "import_lot_coa_missing":
    case "import_lots_coa_missing_summary": {
      const l = lotLinks(ctx, [{ href: MISSING_COA_HREF, label: "See the lots without a COA" }]);
      return {
        what: "Cultivera marks the COA flag N for these lots.",
        how: `This opens the exact list. Attaching the COA files waits on Cultivera's answer about COA access (roadmap S38/S39) — no attach button exists yet, and none is pretended here.${l.note}`,
        links: l.links,
      };
    }
    case "import_lot_received_date_missing": {
      // R16b: one page for this import's undated lots (per-vendor date, attested),
      // plus the store-wide list for lots from other sources.
      const l = lotLinks(ctx, [
        { href: importReceivedDatesHref(ctx.importId), label: "Set received dates for this import" },
        { href: NEEDS_RECEIVED_DATE_HREF, label: "All undated lots" },
      ]);
      return {
        what: "No received date in the export, so the lot ages from the import day — and CCRS would report the import day as its CreatedDate.",
        how: `Enter each vendor's delivery date from the paper manifest or invoice; one save dates every ticked lot.${l.note}`,
        links: l.links,
      };
    }
    case "import_lot_barcode_conflict":
    case "import_lot_barcode_merged":
    case "import_lot_missing_barcode": {
      const l = lotLinks(ctx, [{ href: "/admin/inventory?status=active", label: "Open the lots" }]);
      const what =
        code === "import_lot_barcode_conflict"
          ? "One barcode was used for different product names; the rows were merged under the first name."
          : code === "import_lot_missing_barcode"
            ? "A stock row had no barcode, so its lot got a made-up identifier."
            : "Several rows shared a barcode and were merged into one lot.";
      return { what, how: `Open each lot below and check its name and identifier before selling.${l.note}`, links: l.links };
    }
    case "import_lots_mixed_size_cards": {
      // R14b: open a count with the FLAGGED products' lots already loaded —
      // not the bare cycle-count queue, which creates nothing.
      const l = lotLinks(ctx, [{ href: countFlaggedProductsHref(ctx.importId), label: "Count these products" }]);
      return {
        what: "Some cards group several package sizes, so their unit counts can drift until the migrated stock sells through.",
        how: `This opens a new count with every open lot of the flagged products already loaded; name it and save.${l.note}`,
        links: l.links,
      };
    }
    default:
      return null;
  }
}

function ctxStr(context: unknown, key: string): string | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const v = (context as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The per-row link for ONE diagnostic, when its context names a specific lot
 * or product. Null when the row has nothing individually addressable (the
 * code-level fix covers it).
 */
export function posDiagnosticRowLink(
  code: string,
  context: unknown,
  ctx: PosFixContext,
): PosFixLink | null {
  const barcode = ctxStr(context, "barcode");
  const product = ctxStr(context, "product");
  // R14b: an unknown Cultivera category opens that exact type on the Types
  // page (not lot-gated: the Types page exists before any lot does).
  if (code === "new_unmapped_category" || code === "unmapped_category_fallback") {
    const category = ctxStr(context, "category");
    return category
      ? { href: typeFocusHref(category, suggestForUnknownCategory(category)?.websiteCategory), label: `Add "${category}" as a type` }
      : null;
  }
  if (ctx.lotsCreated) {
    if (code === "import_lot_cost_unparseable" && barcode) return { href: lotSearchHref(barcode, "unit_cost_minor_units"), label: "Fill this cost" };
    if ((code === "import_lot_barcode_conflict" || code === "import_lot_barcode_merged" || code === "import_lot_coa_missing" || code === "import_lot_received_date_missing") && barcode) {
      return { href: lotSearchHref(barcode), label: "Open this lot" };
    }
    if (code === "import_lot_missing_barcode" && product) return { href: lotSearchHref(product), label: "Open this lot" };
    if (code === "flower_same_size_different_price") {
      const name = ctxStr(context, "displayName");
      // displayName is the stripped card name; the lot list's `q` is a
      // contains-match on the raw product_name, so this is a SEARCH, labelled so.
      if (name) return { href: lotSearchHref(name), label: "Search its lots" };
    }
  }
  if (POS_REVIEW_CODES.includes(code)) return { href: factsHref(ctx.importId), label: "Decide in Fact review" };
  // product_without_inventory carries the RAW product name, but the products
  // list filters on the card name, so a search could miss it; the Hidden items
  // list links each such card by its exact key instead (hiddenItemFix).
  return null;
}

export type HiddenItemInput = {
  sourceItemId: string;
  hiddenReason: string | null;
  importId: string | null;
  versionPublished: boolean;
  /** Where the fact-hold for an intake-origin version is decided (null = none). */
  factHref?: string | null;
};

/** The fix for one hidden card on a review page. Null only when there is truly nowhere to go. */
export function hiddenItemFix(input: HiddenItemInput): PosFixLink | null {
  const reason = (input.hiddenReason ?? "").trim();
  const product = input.versionPublished ? productVisibilityHref(input.sourceItemId) : null;
  if (reason.startsWith("owner_override_hide:") || reason.startsWith("owner_override_show:")) {
    return product ? { href: product, label: "Change visibility" } : null;
  }
  if (reason === "reviewer_rejected") {
    if (input.importId) return { href: `${factsHref(input.importId)}#rejected`, label: "Undo in Fact review" };
    // Intake-origin: the drafts fact panel only renders OPEN flags, so a decided
    // reject cannot be re-decided there (IntakeFactReviewPanel). The live
    // control that can show the card again is the product page's Visibility.
    if (product) return { href: product, label: "Show it again" };
    return input.factHref ? { href: input.factHref, label: "See the fact check" } : null;
  }
  if (reason === "no_product_master") {
    if (product) return { href: product, label: "Show it anyway" };
    return input.importId ? { href: missingProductsHref(input.importId), label: "Work the missing products" } : null;
  }
  return product ? { href: product, label: reason === "no_inventory" ? "Open the product" : "Change visibility" } : null;
}

// ── self-tests ───────────────────────────────────────────────────────────────

export function __runPosImportFixCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ pos-import-fix-core: ${name}`);
    }
  };
  const ID = "11111111-2222-3333-4444-555555555555";
  const live: PosFixContext = { importId: ID, versionPublished: true, lotsCreated: true };
  const staged: PosFixContext = { importId: ID, versionPublished: false, lotsCreated: false };
  const liveNoLots: PosFixContext = { importId: ID, versionPublished: true, lotsCreated: false };

  // Every emitted warning/error code has a fix with copy; links unless Cultivera-only.
  const WARN_ERR = [
    ...POS_ERROR_CODES,
    "blank_inventory_product", "blank_product_name", "cannabinoid_value_capped", "flower_same_size_different_price",
    "inventory_without_product_master", "new_unmapped_category", "no_variants", "package_size_mg_garbage",
    "product_without_inventory", "unknown_strain_type", "unmapped_category_fallback",
    "import_lot_missing_barcode", "import_lot_barcode_conflict", "import_lot_cost_unparseable",
    "import_lots_mixed_size_cards", "import_lots_coa_missing_summary",
  ];
  for (const c of WARN_ERR) {
    const f = posImportFixFor(c, live);
    ok(f !== null && f.what.length > 0 && f.how.length > 0, `${c}: has copy`);
    if (!CULTIVERA_ONLY_CODES.includes(c)) ok((f?.links.length ?? 0) > 0, `${c}: has a link when live with lots`);
    else ok(f?.links.length === 0, `${c}: Cultivera-only has no link`);
    for (const l of f?.links ?? []) ok(l.href.startsWith("/admin/") && l.label.length > 0, `${c}: link is an admin route`);
  }
  ok(posImportFixFor("group_variant_merge", live) === null, "pure info → null");
  ok(posImportFixFor("import_lots_planned", live) === null, "planned → null");
  ok(posImportFixFor("", live) === null, "blank → null");

  // Review codes → facts, in every state.
  for (const c of POS_REVIEW_CODES) {
    ok(posImportFixFor(c, staged)?.links[0].href === `/admin/menu-imports/${ID}/facts`, `${c}: facts when staged`);
    ok(posImportFixFor(c, live)?.links[0].label === "Fix these in Fact review", `${c}: label`);
  }
  ok(posImportFixFor("invalid_price", live)?.links[0].href === "/admin/menu-imports", "error → re-upload");
  ok(posImportFixFor("inventory_without_product_master", staged)?.links[0].href === `/admin/menu-imports/${ID}/missing-products`, "missing masters");
  ok(posImportFixFor("product_without_inventory", staged)?.links[0].href === `/admin/menu-imports/${ID}#hidden-items`, "no inventory → hidden anchor");
  ok(posImportFixFor("unknown_strain_type", staged)?.links[0].href === `/admin/menu-imports/${ID}/strains`, "strain → KB fixer");
  ok(posImportFixFor("inventory_without_product_master", live)?.links.some((l) => l.href.endsWith("#remove-legacy")) === true && posImportFixFor("inventory_without_product_master", staged)?.links.length === 1, "legacy adjust-out only once lots exist");
  ok(posImportFixFor("new_unmapped_category", staged)?.links[0].href === "/admin/settings/types?tab=inventory", "category → types");
  ok(posImportFixFor("unmapped_category_fallback", staged)?.how.includes("code change") === false, "category copy: no dead end");
  ok(posImportFixFor("unmapped_category_fallback", staged)?.how.includes("suggested website category") === true, "category copy names the suggestion");
  ok(posImportFixFor("import_lots_mixed_size_cards", live)?.links[0].href === `/admin/inventory/audits/new?fromImport=${ID}`, "mixed → preloaded count");
  ok(posImportFixFor("import_lots_mixed_size_cards", live)?.links[0].label === "Count these products", "mixed label");
  ok(posImportFixFor("import_lots_mixed_size_cards", live)?.how.includes("already loaded") === true, "mixed copy");
  ok(countFlaggedProductsHref("a b") === "/admin/inventory/audits/new?fromImport=a%20b", "count href encodes");
  ok(typeFocusHref(" Dab Rig ") === "/admin/settings/types?tab=inventory&type=Dab%20Rig", "type focus href trims + encodes");
  ok(typeFocusHref("Dab Rig", "paraphernalia") === "/admin/settings/types?tab=inventory&type=Dab%20Rig&suggest=paraphernalia", "suggest appended");
  ok(typeFocusHref("Dab Rig", "Bad Slug!") === "/admin/settings/types?tab=inventory&type=Dab%20Rig", "bad suggest dropped");
  ok(typeFocusHref("Dab Rig", "") === typeFocusHref("Dab Rig") && typeFocusHref("Dab Rig", null) === typeFocusHref("Dab Rig"), "blank suggest dropped");
  ok(posDiagnosticRowLink("new_unmapped_category", { category: "Cured Resin Cartridge" }, staged)?.href === "/admin/settings/types?tab=inventory&type=Cured%20Resin%20Cartridge&suggest=cartridge", "row link carries the grounded suggestion");
  ok(posDiagnosticRowLink("new_unmapped_category", { category: "Zzz Thing" }, staged)?.href === "/admin/settings/types?tab=inventory&type=Zzz%20Thing", "no grounded suggestion → no suggest");

  // Lot codes: exact bulk-fill hrefs when lots exist.
  ok(posImportFixFor("import_lot_cost_unparseable", live)?.links[0].href === UNKNOWN_COST_BULK_HREF, "cost bulk href");
  ok(UNKNOWN_COST_BULK_HREF === "/admin/inventory?status=active&unknownCost=1&bulk=1&bulkField=unit_cost_minor_units", "cost bulk literal");
  ok(posImportFixFor("import_lots_expiration_missing_summary", live)?.links[0].href === MISSING_EXPIRY_BULK_HREF, "expiry bulk href");
  ok(MISSING_EXPIRY_BULK_HREF === "/admin/inventory?status=active&missingExpiry=1&bulk=1&bulkField=expires_on", "expiry bulk literal");
  ok(posImportFixFor("import_lots_coa_missing_summary", live)?.links[0].href === "/admin/inventory?status=active&coa=no", "coa list");
  ok(posImportFixFor("import_lot_coa_missing", live)?.how.includes("no attach button exists yet") === true, "coa honesty");
  ok(posImportFixFor("import_lot_received_date_missing", live)?.links[0].href === importReceivedDatesHref(live.importId), "received date: this import's page");
  ok(posImportFixFor("import_lot_received_date_missing", live)?.links[1].href === "/admin/inventory?needsReceivedDate=1", "received date: store-wide list");
  ok(importReceivedDatesHref("a b") === "/admin/menu-imports/a%20b/received-dates", "received-dates href encodes");
  ok(posImportFixFor("flower_same_size_different_price", live)?.links[0].href === "/admin/inventory?status=active", "flower lots");
  for (const c of ["import_lot_barcode_conflict", "import_lot_barcode_merged", "import_lot_missing_barcode"]) {
    ok(posImportFixFor(c, live)?.links[0].label === "Open the lots", `${c}: lots`);
  }
  ok(posImportFixFor("import_lot_barcode_conflict", live)?.what.includes("different product names") === true, "conflict what");
  ok(posImportFixFor("import_lot_missing_barcode", live)?.what.includes("made-up") === true, "missing what");
  ok(posImportFixFor("import_lot_barcode_merged", live)?.what.includes("shared a barcode") === true, "merged what");

  // Lot codes before lots exist: staged → no link + note; live-no-lots → backfill.
  const cs = posImportFixFor("import_lot_cost_unparseable", staged);
  ok(cs?.links.length === 0 && cs.how.includes("created when you publish"), "staged: no lot link, honest note");
  const cb = posImportFixFor("import_lot_cost_unparseable", liveNoLots);
  ok(cb?.links.length === 1 && cb.links[0].href === `/admin/menu-imports/${ID}#backfill-lots`, "live no lots → backfill");
  ok(cb?.how.includes("never created") === true, "backfill note");
  ok(posImportFixFor("import_lots_mixed_size_cards", staged)?.links.length === 0, "count gated on lots (staged: none)");
  ok(posImportFixFor("import_lots_mixed_size_cards", staged)?.how.includes("created when you publish") === true, "count staged note");
  ok(posImportFixFor("import_lots_mixed_size_cards", liveNoLots)?.links[0].href === `/admin/menu-imports/${ID}#backfill-lots`, "count live-no-lots → backfill");
  ok(posImportFixFor("import_lot_cost_unparseable", live)?.how.includes("created when") === false, "no note when lots exist");

  // Row links.
  ok(posDiagnosticRowLink("import_lot_cost_unparseable", { barcode: "GF1 2" }, live)?.href === "/admin/inventory?q=GF1+2&bulk=1&bulkField=unit_cost_minor_units", "row cost");
  ok(posDiagnosticRowLink("import_lot_barcode_conflict", { barcode: "B1" }, live)?.href === "/admin/inventory?q=B1", "row conflict");
  ok(posDiagnosticRowLink("import_lot_barcode_merged", { barcode: "B1" }, live)?.label === "Open this lot", "row merged");
  ok(posDiagnosticRowLink("import_lot_coa_missing", { barcode: "B1" }, live)?.href === "/admin/inventory?q=B1", "row coa");
  ok(posDiagnosticRowLink("import_lot_received_date_missing", { barcode: "B1" }, live)?.href === "/admin/inventory?q=B1", "row received");
  ok(posDiagnosticRowLink("import_lot_missing_barcode", { product: "Blue Dream" }, live)?.href === "/admin/inventory?q=Blue+Dream", "row missing barcode → product");
  ok(posDiagnosticRowLink("flower_same_size_different_price", { displayName: "OG 3.5g" }, live)?.href === "/admin/inventory?q=OG+3.5g", "row flower");
  ok(posDiagnosticRowLink("import_lot_cost_unparseable", { barcode: "B1" }, staged) === null, "row lot gated when staged");
  ok(posDiagnosticRowLink("import_lot_cost_unparseable", {}, live) === null, "row no barcode → null");
  ok(posDiagnosticRowLink("import_lot_cost_unparseable", { barcode: "  " }, live) === null, "row blank barcode → null");
  ok(posDiagnosticRowLink("import_lot_cost_unparseable", null, live) === null, "row null ctx");
  ok(posDiagnosticRowLink("import_lot_cost_unparseable", ["x"], live) === null, "row array ctx");
  ok(posDiagnosticRowLink("import_lot_cost_unparseable", { barcode: 5 }, live) === null, "row non-string");
  ok(posDiagnosticRowLink("package_size_mg_garbage", {}, staged)?.href === `/admin/menu-imports/${ID}/facts`, "row review → facts");
  ok(posDiagnosticRowLink("product_without_inventory", { product: "Gummies" }, live) === null, "row no-inventory → none (hidden list has exact links)");
  ok(posDiagnosticRowLink("flower_same_size_different_price", { displayName: "OG" }, live)?.label === "Search its lots", "flower row is labelled a search");
  ok(posDiagnosticRowLink("group_variant_merge", { barcode: "B1" }, live) === null, "row info → null");
  ok(posDiagnosticRowLink("unmapped_category_fallback", { category: "Dab Rig" }, staged)?.href === "/admin/settings/types?tab=inventory&type=Dab%20Rig&suggest=paraphernalia", "row unmapped → type focus (not lot-gated)");
  ok(posDiagnosticRowLink("new_unmapped_category", { category: "Cured Resin Cartridge" }, live)?.label === 'Add "Cured Resin Cartridge" as a type', "row new category label");
  ok(posDiagnosticRowLink("new_unmapped_category", { category: " " }, live) === null, "row blank category → null");
  ok(posDiagnosticRowLink("new_unmapped_category", {}, live) === null, "row no category → null");

  // Hidden items.
  const H = (r: string | null, pub: boolean, importId: string | null = ID, factHref: string | null = null) =>
    hiddenItemFix({ sourceItemId: "k/1", hiddenReason: r, importId, versionPublished: pub, factHref });
  ok(H("no_product_master", true)?.href === "/admin/products/k%2F1#visibility", "npm live → visibility");
  ok(H("no_product_master", true)?.label === "Show it anyway", "npm label");
  ok(H("no_product_master", false)?.href === `/admin/menu-imports/${ID}/missing-products`, "npm staged → worklist");
  ok(H("no_product_master", false, null) === null, "npm staged, no import → null");
  ok(H("reviewer_rejected", false)?.href === `/admin/menu-imports/${ID}/facts#rejected`, "rejected → facts#rejected");
  ok(H("reviewer_rejected", false, null, "/admin/inventory/drafts?x=1")?.href === "/admin/inventory/drafts?x=1", "rejected intake staged → factHref");
  ok(H("reviewer_rejected", false, null, "/d")?.label === "See the fact check", "rejected intake label is honest");
  ok(H("reviewer_rejected", true, null, "/d")?.href === "/admin/products/k%2F1#visibility", "rejected intake live → visibility wins");
  ok(H("reviewer_rejected", true, null)?.label === "Show it again", "rejected intake live label");
  ok(H("reviewer_rejected", false, null) === null, "rejected intake nothing → null");
  ok(H("owner_override_hide:no_inventory", true)?.label === "Change visibility", "override → visibility");
  ok(H("owner_override_show:", true)?.href.endsWith("#visibility") === true, "override show");
  ok(H("owner_override_hide:x", false) === null, "override staged → null");
  ok(H("no_inventory", true)?.label === "Open the product", "no inventory live");
  ok(H("no_inventory", false) === null, "no inventory staged → null");
  ok(H(null, true)?.label === "Change visibility", "null reason live");
  ok(H("  no_product_master ", true)?.label === "Show it anyway", "reason trimmed");
  ok(productVisibilityHref("a b", "/x?y=1") === "/admin/products/a%20b?back=%2Fx%3Fy%3D1#visibility", "visibility href with back");
  ok(importHref(ID) === `/admin/menu-imports/${ID}`, "import href bare");
  ok(lotSearchHref(" a&b ") === "/admin/inventory?q=a%26b", "lot search encodes + trims");
  ok(productSearchHref(" x y ") === "/admin/products?q=x%20y", "product search");
  ok(CULTIVERA_ONLY_CODES.length === 3 && POS_REVIEW_CODES.length === 4 && POS_ERROR_CODES.length === 7, "sets sized");
  return { passed, failed };
}
