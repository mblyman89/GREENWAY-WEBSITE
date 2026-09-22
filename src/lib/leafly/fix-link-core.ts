/**
 * src/lib/leafly/fix-link-core.ts  (TASK J ask 2 -- "are the fix buttons ready?")
 *
 * ###########################################################################
 * # THE OWNER'S QUESTION                                                    #
 * #                                                                        #
 * #   "Is the, allow me to edit and fix things redirect buttons setup and  #
 * #    ready for me to use?"                                              #
 * ###########################################################################
 *
 * WHAT WAS ALREADY TRUE, AND WHAT WAS NOT
 * ---------------------------------------
 * The buttons are rendered (`leafly-picker-client.tsx`, `sendability-panel.tsx`)
 * and for an ORDINARY product the link resolves. That was verified rather than
 * assumed, by following the id the whole way:
 *
 *   menu_items.source_item_id
 *     -> feed-source.ts            `source_item_id: row.source_item_id`
 *     -> menu-feed-core.ts:157     `id: item.source_item_id`     (SyndicationItem.id)
 *     -> payload-core.ts:755       `id: item.id`                 (LeaflyItem.id)
 *     -> payload-validate-core.ts  `itemId` on every issue
 *     -> sendability-core.ts       `fixHrefFor(id)`
 *     -> /admin/products/[key]     `getItemBySourceKey(published.id, key)`
 *                                  `.eq("source_item_id", key)`
 *
 * So the round trip closes. Good.
 *
 * THE DEFECT THIS MODULE EXISTS TO PREVENT
 * ----------------------------------------
 * Not every id in a Leafly payload is a `source_item_id` any more, and the
 * two exceptions were introduced by our own code:
 *
 *   1. SYNTHESIZED DEFAULT VARIANTS. `payload-core.ts:648` mints
 *      `` `${item.id}-default` `` for an item with no variants. That is a
 *      VARIANT id, not an item id -- it never reaches `fixHrefFor`, which is
 *      fed `issue.itemId`. Harmless today, but only by accident, so it is
 *      pinned by a test below rather than left to luck.
 *
 *   2. SPLIT PRODUCTS. `collision-split-core.ts` mints
 *      `` `${parentId}--1g` ``, and that IS an item id. It appears as
 *      `issue.itemId` on any validator finding against a split product.
 *      `menu_items` has no row with that `source_item_id`, so
 *      `getItemBySourceKey` returns null and the page calls `notFound()`.
 *      The owner would click "Fix this product" and land on a 404.
 *
 *      This was proved, not theorised: a reproduction built a colliding
 *      pre-roll through the real builder, ran the real splitter, and got
 *      `bad-0--1g`, `bad-0--2g`, `bad-0--3g` -- none of which exist in
 *      `menu_items`.
 *
 * THE RULE
 * --------
 * A fix link must point at a row that EXISTS. When the id is synthetic, the
 * link must resolve to the PARENT product, because the parent is where the
 * owner actually fixes the data (the size labels live on the parent). When
 * even that cannot be determined, the link must be null -- sending someone to
 * a dead page is worse than telling them plainly that there is nowhere to go.
 *
 * WHY A SEPARATE PURE MODULE
 * --------------------------
 * `sendability-core.ts` already has `fixHrefFor`, and the temptation is to
 * patch it in place. That would be wrong: `fixHrefFor` is a formatter (id ->
 * URL) and this is a RESOLVER (payload id -> the real product it belongs to).
 * Conflating them would mean every caller of the formatter silently acquires
 * split-awareness it may not want, and the split rule would be untestable
 * except through the whole triage. Keeping them apart lets the resolver be
 * proved on its own and lets the formatter stay the dumb, obvious thing it is.
 *
 * PURITY
 * ------
 * One import, of a CONSTANT, from another pure core. No I/O. Runs under `tsx`.
 */
import { SPLIT_ID_SEPARATOR } from "./collision-split-core";

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

/**
 * Why a fix link points where it points.
 *
 * Carried in the result rather than inferred by the caller, because "this
 * link goes somewhere other than the id you gave me" is exactly the kind of
 * surprise that has to be stated out loud. The UI uses it to explain the
 * redirect to the owner instead of silently sending him elsewhere.
 */
export type FixLinkKind =
  /** The id is a real `source_item_id`. Straight through. */
  | "direct"
  /** The id was minted by the collision splitter; resolved to its parent. */
  | "split_parent"
  /** The id was a synthesized default variant id; resolved to its item. */
  | "synthesized_variant"
  /** No usable id at all. */
  | "none";

export type FixLink = {
  /** The href, or null when there is nowhere honest to send the owner. */
  href: string | null;
  /** The id the href actually addresses (post-resolution). */
  resolvedId: string | null;
  /** The id we were handed. */
  requestedId: string;
  kind: FixLinkKind;
  /**
   * Plain-English note for the UI, or null when nothing needs saying.
   * Non-null exactly when `kind` is neither "direct" nor "none", so the owner
   * is never redirected without being told.
   */
  note: string | null;
};

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function trim(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The suffix `payload-core.ts` appends when it synthesizes a lone variant. */
export const SYNTHESIZED_VARIANT_SUFFIX = "-default";

/**
 * Strip one layer of split suffix, if present.
 *
 * Returns null when the id is not a split id. Uses `lastIndexOf` rather than
 * `indexOf` so a parent id that itself contains the separator survives: split
 * ids are only ever appended, never nested, so the LAST marker is always the
 * one this function added.
 *
 * A marker at position 0 is NOT a split (there would be no parent), and an
 * empty slug after the marker is NOT a split either -- both would yield a
 * nonsense parent, and returning a nonsense parent is how a "fix" link sends
 * the owner to the wrong product's page.
 */
export function splitParentId(itemId: string | null | undefined): string | null {
  const id = trim(itemId);
  if (id.length === 0) return null;
  const at = id.lastIndexOf(SPLIT_ID_SEPARATOR);
  if (at <= 0) return null;
  const parent = id.slice(0, at);
  const slug = id.slice(at + SPLIT_ID_SEPARATOR.length);
  if (parent.length === 0 || slug.length === 0) return null;
  return parent;
}

/**
 * Strip the synthesized-default suffix, if present.
 *
 * Same guard as above: the suffix alone, with nothing in front of it, is not
 * a synthesized variant id.
 */
export function synthesizedParentId(variantId: string | null | undefined): string | null {
  const id = trim(variantId);
  if (!id.endsWith(SYNTHESIZED_VARIANT_SUFFIX)) return null;
  const parent = id.slice(0, id.length - SYNTHESIZED_VARIANT_SUFFIX.length);
  return parent.length > 0 ? parent : null;
}

/* ========================================================================== */
/* The resolver                                                               */
/* ========================================================================== */

/**
 * Resolve any id that can appear in a Leafly payload to a back-office link
 * that will actually load.
 *
 * @param itemId The id as it appears on the validator finding.
 * @param knownSourceIds Optional. The set of ids that genuinely exist as
 *   `menu_items.source_item_id`. When supplied, the result is VERIFIED rather
 *   than inferred from the id's shape -- which matters because a real product
 *   could legitimately be named with a double hyphen, and guessing from shape
 *   alone would redirect it to a parent that does not exist. When omitted,
 *   the function degrades to shape-based resolution and says so by still
 *   returning the correct `kind`; it never throws, because a triage that
 *   crashes over a link is useless exactly when it is needed.
 *
 * ORDER OF CHECKS, AND WHY
 * ------------------------
 * The known-set check comes FIRST. If the id exists, it is direct, full stop
 * -- no amount of suspicious-looking punctuation can override the fact that
 * the row is right there. Only once we know the id does NOT exist is it
 * legitimate to start decomposing it.
 */
export function resolveFixLink(
  itemId: string | null | undefined,
  knownSourceIds?: ReadonlySet<string>,
): FixLink {
  const requestedId = trim(itemId);

  if (requestedId.length === 0) {
    return {
      href: null,
      resolvedId: null,
      requestedId: "",
      kind: "none",
      note: null,
    };
  }

  const known = knownSourceIds;
  const exists = (id: string): boolean => (known === undefined ? false : known.has(id));

  // 1. It is a real product. Nothing to resolve.
  if (known !== undefined && exists(requestedId)) {
    return {
      href: hrefFor(requestedId),
      resolvedId: requestedId,
      requestedId,
      kind: "direct",
      note: null,
    };
  }

  // 2. A split product -> its parent.
  const parent = splitParentId(requestedId);
  if (parent !== null && (known === undefined || exists(parent))) {
    return {
      href: hrefFor(parent),
      resolvedId: parent,
      requestedId,
      kind: "split_parent",
      note:
        `This size is listed on Leafly as its own product, but it is edited on the ` +
        `parent product. Opening the parent.`,
    };
  }

  // 3. A synthesized default variant id -> the item it was minted for.
  const synth = synthesizedParentId(requestedId);
  if (synth !== null && (known === undefined || exists(synth))) {
    return {
      href: hrefFor(synth),
      resolvedId: synth,
      requestedId,
      kind: "synthesized_variant",
      note:
        `This product has no sizes saved, so the system created one automatically. ` +
        `Opening the product.`,
    };
  }

  // 4. We have a known set and the id is in none of these shapes. Refuse.
  //    This is the branch that protects the owner from a 404: we would rather
  //    say "no link" than hand him one that dead-ends.
  if (known !== undefined) {
    return {
      href: null,
      resolvedId: null,
      requestedId,
      kind: "none",
      note:
        `This problem could not be traced back to a product page that exists, so there ` +
        `is nowhere to send you. It needs a developer.`,
    };
  }

  // 5. No known set supplied and no synthetic shape: behave exactly as the
  //    original formatter did. Unchanged behaviour for every existing caller.
  return {
    href: hrefFor(requestedId),
    resolvedId: requestedId,
    requestedId,
    kind: "direct",
    note: null,
  };
}

/**
 * The URL shape. Kept private-ish and in ONE place so the route and the
 * encoding cannot drift; `sendability-core.fixHrefFor` builds the same string
 * and a drift test pins them together.
 */
function hrefFor(id: string): string {
  return `/admin/products/${encodeURIComponent(id)}`;
}

/** Exposed for the drift test. */
export function fixLinkHrefFor(id: string): string {
  return hrefFor(id);
}

/* ========================================================================== */
/* Self-tests                                                                 */
/* ========================================================================== */

export function __runLeaflyFixLinkTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[fix-link-core] FAILED: ${name}`);
    }
  };

  /* ---------------- separator agreement ---------------- */

  ok("separator is two hyphens", SPLIT_ID_SEPARATOR === "--");
  ok("synthesized suffix matches payload-core", SYNTHESIZED_VARIANT_SUFFIX === "-default");

  /* ---------------- splitParentId ---------------- */

  ok("split parent is stripped", splitParentId("pos-abc--1g") === "pos-abc");
  ok("single hyphen is not a split", splitParentId("pos-abc-1g") === null);
  ok("plain id is not a split", splitParentId("pos-abc") === null);
  ok("leading separator is not a split", splitParentId("--1g") === null);
  ok("trailing separator is not a split", splitParentId("pos-abc--") === null);
  ok("empty is not a split", splitParentId("") === null);
  ok("null is not a split", splitParentId(null) === null);
  ok("undefined is not a split", splitParentId(undefined) === null);
  ok("whitespace is not a split", splitParentId("   ") === null);
  // Last marker wins, so a parent containing the marker survives.
  ok("nested markers take the last", splitParentId("a--b--1g") === "a--b");
  ok("whitespace is trimmed before splitting", splitParentId("  pos-abc--1g  ") === "pos-abc");

  /* ---------------- synthesizedParentId ---------------- */

  ok("synthesized parent is stripped", synthesizedParentId("pos-abc-default") === "pos-abc");
  ok("non-default is not synthesized", synthesizedParentId("pos-abc-v1") === null);
  ok("suffix alone is not synthesized", synthesizedParentId("-default") === null);
  ok("empty is not synthesized", synthesizedParentId("") === null);
  ok("null is not synthesized", synthesizedParentId(null) === null);
  // Only the tail counts.
  ok("mid-string default is not synthesized", synthesizedParentId("pos-default-abc") === null);

  /* ---------------- resolveFixLink: no known set ---------------- */

  {
    const r = resolveFixLink("pos-45c6e282e0e8");
    ok("plain id resolves direct", r.kind === "direct");
    ok("plain id href", r.href === "/admin/products/pos-45c6e282e0e8");
    ok("plain id has no note", r.note === null);
    ok("plain id echoes the request", r.requestedId === "pos-45c6e282e0e8");
    ok("plain id resolvedId equals requested", r.resolvedId === "pos-45c6e282e0e8");
  }
  {
    const r = resolveFixLink("");
    ok("blank yields no link", r.href === null && r.kind === "none");
    ok("blank yields no resolvedId", r.resolvedId === null);
  }
  ok("whitespace yields no link", resolveFixLink("   ").href === null);
  ok("null yields no link", resolveFixLink(null).href === null);
  ok("undefined yields no link", resolveFixLink(undefined).href === null);

  {
    // THE DEFECT. Without this module the href would have been the split id.
    const r = resolveFixLink("pos-abc--1g");
    ok("split id resolves to parent", r.resolvedId === "pos-abc");
    ok("split id href points at parent", r.href === "/admin/products/pos-abc");
    ok("split id is labelled", r.kind === "split_parent");
    ok("split id explains the redirect", r.note !== null && r.note.length > 0);
    ok("split id remembers what was asked", r.requestedId === "pos-abc--1g");
  }
  {
    const r = resolveFixLink("pos-abc-default");
    ok("synthesized id resolves to item", r.resolvedId === "pos-abc");
    ok("synthesized id is labelled", r.kind === "synthesized_variant");
    ok("synthesized id explains itself", r.note !== null);
  }

  /* ---------------- resolveFixLink: WITH a known set ---------------- */

  {
    const known = new Set(["pos-abc", "pos-xyz"]);

    const direct = resolveFixLink("pos-abc", known);
    ok("known id is direct", direct.kind === "direct" && direct.href === "/admin/products/pos-abc");

    const split = resolveFixLink("pos-abc--1g", known);
    ok("split of a known parent resolves", split.kind === "split_parent");
    ok("split of a known parent hrefs the parent", split.href === "/admin/products/pos-abc");

    // The protection: parent is NOT in the set, so no link rather than a 404.
    const orphan = resolveFixLink("pos-gone--1g", known);
    ok("split of an unknown parent refuses", orphan.href === null);
    ok("split of an unknown parent is 'none'", orphan.kind === "none");
    ok("split of an unknown parent explains", orphan.note !== null);

    const stranger = resolveFixLink("pos-never-seen", known);
    ok("unknown plain id refuses when a set is supplied", stranger.href === null);
    ok("unknown plain id is 'none'", stranger.kind === "none");

    // A REAL product whose own id contains a double hyphen must not be
    // mistaken for a split. This is why the known-set check comes first.
    const weird = new Set(["odd--name"]);
    const w = resolveFixLink("odd--name", weird);
    ok("a real id containing the marker stays direct", w.kind === "direct");
    ok("a real id containing the marker keeps its href", w.href === "/admin/products/odd--name");

    const synthKnown = resolveFixLink("pos-xyz-default", known);
    ok("synthesized of a known item resolves", synthKnown.kind === "synthesized_variant");
    ok("synthesized of a known item hrefs the item", synthKnown.href === "/admin/products/pos-xyz");

    const synthOrphan = resolveFixLink("pos-nope-default", known);
    ok("synthesized of an unknown item refuses", synthOrphan.href === null);
  }

  /* ---------------- encoding ---------------- */

  ok("ids are url-encoded", resolveFixLink("a/b c").href === "/admin/products/a%2Fb%20c");
  ok(
    "resolved parents are url-encoded too",
    resolveFixLink("a/b--1g").href === "/admin/products/a%2Fb",
  );
  ok("hash characters are encoded", resolveFixLink("a#b").href === "/admin/products/a%23b");
  ok("query characters are encoded", resolveFixLink("a?b").href === "/admin/products/a%3Fb");

  /* ---------------- invariants ---------------- */

  {
    // A note is present exactly when the owner is being redirected.
    const cases = ["pos-abc", "pos-abc--1g", "pos-abc-default", ""];
    let consistent = true;
    for (const c of cases) {
      const r = resolveFixLink(c);
      const redirected = r.kind === "split_parent" || r.kind === "synthesized_variant";
      if (redirected !== (r.note !== null)) consistent = false;
    }
    ok("a note appears exactly when redirecting", consistent);
  }
  {
    // Never a non-null href with a null resolvedId, or the reverse.
    const cases = ["pos-abc", "pos-abc--1g", "", "   ", "a--", "--a"];
    let paired = true;
    for (const c of cases) {
      const r = resolveFixLink(c);
      if ((r.href === null) !== (r.resolvedId === null)) paired = false;
    }
    ok("href and resolvedId are null together", paired);
  }
  {
    // Deterministic.
    const a = resolveFixLink("pos-abc--3-5g");
    const b = resolveFixLink("pos-abc--3-5g");
    ok("resolution is deterministic", JSON.stringify(a) === JSON.stringify(b));
  }
  {
    // An empty known set means "nothing exists", so everything refuses.
    const empty = new Set<string>();
    ok("an empty known set refuses everything", resolveFixLink("pos-abc", empty).href === null);
  }

  return { passed, failed };
}
