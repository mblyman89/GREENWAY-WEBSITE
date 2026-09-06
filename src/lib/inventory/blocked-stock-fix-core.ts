/**
 * src/lib/inventory/blocked-stock-fix-core.ts   (SLICE 20)
 *
 * "Where do I go to fix this?" — answered once, in one place, for every way a
 * lot can be blocked from sale.
 *
 * Owner: "when I click either issue, it takes me to the product detail page of
 * the affected product, but there is nothing for me to do there that I can see
 * that would unhide them and approve them. will you deep recon this and link
 * those warning errors to where I should go to fix them. then link all of them
 * so I can work through them all."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FIXES
 *
 * `RegisterSellabilityBanner.tsx` linked EVERY blocked lot to
 * `/admin/inventory/{lotId}` — one destination for six different problems. The
 * owner is right that the destination is a dead end: the lot detail page has
 * no visibility control and no approve control, because neither of those
 * things lives on a lot. Hiding lives on the menu PRODUCT
 * (`admin/products/[key]` → Visibility → writes `hidden_override`), and
 * approval lives in Product Onboarding (`admin/inventory/drafts`).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS AVOIDS
 *
 * `admin/products/[key]/page.tsx` calls `notFound()` when the key is not on
 * the PUBLISHED menu. `no_menu_card` means, by definition, "no published card
 * uses this key". So sending those lots to the product page would replace a
 * dead end with a 404 — a worse answer that merely looks helpful. Those go to
 * Product Onboarding instead. That distinction is the whole reason this module
 * exists rather than a ternary in the view.
 *
 * PURE: no imports, no clock, no network, no DOM. Every destination it emits
 * is asserted against the real route files by the test suite, so a renamed or
 * deleted page fails the build rather than shipping a broken link to a person
 * with 973 products to work through.
 */

/**
 * The blocking causes, mirrored from `LotSellableCode` in
 * `@/lib/pos/register-availability-core`. Deliberately NOT imported: this core
 * stays dependency-free, and the test suite asserts the two lists agree, so
 * drift is caught by a red test rather than by a silent gap in a menu.
 */
export type BlockedCause =
  | "no_product_link"
  | "no_menu_card"
  | "hidden_card"
  | "recall_hold"
  | "lot_not_active"
  | "lot_empty";

/** A destination a person can actually act in. */
export type FixLink = {
  /** Where to go. */
  href: string;
  /** What the button says. */
  label: string;
  /** Why that page is the right one — shown as help text, never a guess. */
  why: string;
};

/** URL-encode a product key for a path segment. */
function encKey(key: string): string {
  return encodeURIComponent(key.trim());
}

/**
 * The single next place to go to unblock ONE lot.
 *
 * `productKey` is optional because a lot can be blocked precisely BECAUSE it
 * has no product key. When the key is missing for a cause that needs one, this
 * falls back to the lot itself rather than emitting a link that cannot resolve.
 */
export function fixLinkForLot(cause: BlockedCause, lotId: string, productKey: string | null): FixLink {
  const key = (productKey ?? "").trim();

  switch (cause) {
    /**
     * No key at all. The lot is where the link is made, so the lot page IS the
     * right destination here — this was the ONE cause the old blanket link got
     * right.
     */
    case "no_product_link":
      return {
        href: `/admin/inventory/${lotId}`,
        label: "Open lot to link a product",
        why: "A lot with no POS product key has nothing for the register to ring up. The link is made on the lot.",
      };

    /**
     * Has a key, but no published card uses it. The product page would 404
     * (it calls notFound() for unpublished keys), so this goes to onboarding.
     */
    case "no_menu_card":
      return {
        href: "/admin/inventory/drafts?status=draft",
        label: "Approve in Product Onboarding",
        why: "No published menu card uses this product key yet. Approve it in Product Onboarding, then publish the menu.",
      };

    /**
     * Published but hidden. The Visibility control on the product page is the
     * only thing that writes `hidden_override`.
     */
    case "hidden_card":
      return key
        ? {
            href: `/admin/products/${encKey(key)}`,
            label: "Un-hide on the product page",
            why: "Set Visibility to “Always show” on the product page, then save. That is the control that un-hides it.",
          }
        : {
            href: `/admin/inventory/${lotId}`,
            label: "Open lot",
            why: "This lot is hidden on the menu but carries no product key to follow, so start at the lot.",
          };

    case "recall_hold":
      return {
        href: `/admin/inventory/${lotId}`,
        label: "Open lot to review the recall",
        why: "A recall hold is cleared against the lot once the product is cleared for sale.",
      };

    case "lot_not_active":
      return {
        href: `/admin/inventory/${lotId}`,
        label: "Open lot to set it active",
        why: "The lot's status is not active, so its stock is not sellable.",
      };

    case "lot_empty":
      return {
        href: `/admin/inventory/${lotId}`,
        label: "Open lot to receive stock",
        why: "The lot is active but has no units on hand.",
      };
  }
}

/**
 * The "work through them ALL" link for a whole group.
 *
 * The owner has 973 blocked products and the banner shows 25 at a time. Fixing
 * them one lot page at a time is roughly thirty-nine round trips. These links
 * open the place where the WHOLE category can be worked in one screen, which
 * is the difference between an afternoon and a week.
 *
 * Returns null when no such screen exists, so the view can simply omit the
 * button rather than invent a destination.
 */
export function bulkFixLinkForCause(cause: BlockedCause, count: number): FixLink | null {
  switch (cause) {
    case "no_menu_card":
      return {
        href: "/admin/inventory/drafts?status=draft",
        label: `Review all ${count} in Product Onboarding`,
        why: "Product Onboarding lists every product awaiting approval, so they can be approved together instead of one at a time.",
      };

    /**
     * There is deliberately NO bulk link here.
     *
     * I checked for one rather than assuming. `/admin/products` accepts a
     * `status` knob, but `parseEnrichmentStatusFilter` (match-core.ts:454-455)
     * only accepts none|draft|published|archived — that is ENRICHMENT status,
     * not visibility. A `?status=hidden` link would be silently ignored and
     * show the owner the entire catalogue while claiming to be filtered, which
     * is worse than no button. Hidden products are therefore linked one at a
     * time to the control that actually un-hides them.
     */
    case "hidden_card":
      return null;

    /**
     * This knob is real and already parsed: `missingProductLink` is one of the
     * inventory worklist filters (lot-gap-core.ts:129-130, parsed by
     * parseLegacyFilters and exercised at inventory-page-core.ts:463).
     */
    case "no_product_link":
      return {
        href: "/admin/inventory?missingProductLink=1",
        label: `Review all ${count} unlinked lots`,
        why: "The inventory worklist filtered to lots with no POS product link, so they can be linked one after another.",
      };

    // Recalls and lot states are handled lot by lot on purpose: each one is a
    // compliance decision about specific product, not a bulk operation.
    case "recall_hold":
    case "lot_not_active":
    case "lot_empty":
      return null;
  }
}

/**
 * Plain-English group heading per cause, worst/most-actionable first.
 * Order matters: it is the order the owner should work in.
 */
export const CAUSE_ORDER: { code: BlockedCause; label: string }[] = [
  { code: "no_product_link", label: "Not linked to a product" },
  { code: "no_menu_card", label: "Not on the published menu" },
  { code: "hidden_card", label: "Hidden on the menu" },
  { code: "recall_hold", label: "Under a recall hold" },
];

/**
 * Every route this module can emit, for the test that asserts each one is a
 * real page in the app. Kept beside the links so a new destination cannot be
 * added without also being proven to exist.
 */
export const FIX_ROUTE_FILES: Record<string, string> = {
  "/admin/inventory/[id]": "src/app/admin/inventory/[id]/page.tsx",
  "/admin/inventory/drafts": "src/app/admin/inventory/drafts/page.tsx",
  "/admin/products/[key]": "src/app/admin/products/[key]/page.tsx",
  "/admin/products": "src/app/admin/products/page.tsx",
  "/admin/inventory": "src/app/admin/inventory/page.tsx",
};

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runBlockedStockFixCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`blocked-stock-fix-core: ${what}`);
    passed += 1;
  };

  // ── The owner's two reported causes go somewhere USEFUL ──────────────────
  const hidden = fixLinkForLot("hidden_card", "lot-1", "SKU-42");
  ok(hidden.href === "/admin/products/SKU-42", "hidden goes to the product page");
  ok(hidden.href !== "/admin/inventory/lot-1", "hidden does NOT go to the lot dead end");
  ok(/un-hide/i.test(hidden.label), "hidden link says what it does");

  const notOnMenu = fixLinkForLot("no_menu_card", "lot-2", "SKU-43");
  ok(
    notOnMenu.href === "/admin/inventory/drafts?status=draft",
    "not-on-menu goes to Product Onboarding",
  );
  // THE TRAP: products/[key] calls notFound() for unpublished keys.
  ok(
    !notOnMenu.href.startsWith("/admin/products/"),
    "not-on-menu must NEVER link to the product page (it would 404)",
  );

  // ── The one cause the old blanket link got right stays right ─────────────
  ok(
    fixLinkForLot("no_product_link", "lot-3", null).href === "/admin/inventory/lot-3",
    "an unlinked lot is fixed on the lot",
  );

  // ── Never emit a link that cannot resolve ────────────────────────────────
  const hiddenNoKey = fixLinkForLot("hidden_card", "lot-4", null);
  ok(hiddenNoKey.href === "/admin/inventory/lot-4", "hidden without a key falls back to the lot");
  ok(!hiddenNoKey.href.includes("undefined"), "no 'undefined' ever reaches a URL");
  ok(!hiddenNoKey.href.endsWith("/"), "no empty trailing segment");

  const blankKey = fixLinkForLot("hidden_card", "lot-5", "   ");
  ok(blankKey.href === "/admin/inventory/lot-5", "a blank key is treated as no key");

  // ── Keys are encoded, so odd characters cannot break the URL ─────────────
  const odd = fixLinkForLot("hidden_card", "lot-6", "A B/C?D&E");
  ok(!odd.href.includes(" "), "spaces encoded");
  ok(!odd.href.includes("?D"), "query characters encoded, not left to split the URL");
  ok(odd.href === `/admin/products/${encodeURIComponent("A B/C?D&E")}`, "exact encoding");

  // ── Every cause returns a usable link, none throw ────────────────────────
  const ALL: BlockedCause[] = [
    "no_product_link",
    "no_menu_card",
    "hidden_card",
    "recall_hold",
    "lot_not_active",
    "lot_empty",
  ];
  for (const c of ALL) {
    const l = fixLinkForLot(c, "L", "K");
    ok(l.href.startsWith("/admin/"), `${c} href is an admin route`);
    ok(l.label.trim().length > 0, `${c} has a label`);
    ok(l.why.trim().length > 0, `${c} explains itself`);
    ok(!l.href.includes("null"), `${c} never emits null in a URL`);
  }

  // ── Bulk links: present where a bulk screen exists, null where it does not ─
  const bulkMenu = bulkFixLinkForCause("no_menu_card", 971);
  ok(bulkMenu !== null && bulkMenu.href.includes("/admin/inventory/drafts"), "bulk onboarding link");
  ok(bulkMenu !== null && bulkMenu.label.includes("971"), "bulk link states the real count");

  const bulkUnlinked = bulkFixLinkForCause("no_product_link", 5);
  ok(
    bulkUnlinked !== null && bulkUnlinked.href === "/admin/inventory?missingProductLink=1",
    "bulk unlinked link uses the REAL existing worklist knob",
  );

  // Proven absent rather than guessed: /admin/products has no visibility
  // filter, so no bulk button is offered for hidden products.
  ok(bulkFixLinkForCause("hidden_card", 2) === null, "no fake bulk filter for hidden products");

  ok(bulkFixLinkForCause("recall_hold", 3) === null, "recalls are not a bulk operation");
  ok(bulkFixLinkForCause("lot_not_active", 3) === null, "lot states are not a bulk operation");
  ok(bulkFixLinkForCause("lot_empty", 3) === null, "empty lots are not a bulk operation");

  // ── Group order is the order to work in ─────────────────────────────────
  ok(CAUSE_ORDER.length === 4, "four actionable groups");
  ok(CAUSE_ORDER[0].code === "no_product_link", "unlinked first");
  ok(
    new Set(CAUSE_ORDER.map((c) => c.code)).size === CAUSE_ORDER.length,
    "no duplicate groups",
  );

  console.log(`blocked-stock-fix-core: PASSED ${passed} assertions`);
}
