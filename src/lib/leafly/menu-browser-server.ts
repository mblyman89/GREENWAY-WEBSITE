import "server-only";

/**
 * src/lib/leafly/menu-browser-server.ts  (ROADMAP R8 -- owner ask 6)
 *
 * Assemble a browsable, searchable view of what is on the Leafly menu, so a
 * product can be found and removed by NAME instead of by typing an id.
 *
 * ###########################################################################
 * # THE HARD CONSTRAINT, discovered by reading the code rather than         #
 * # assuming it                                                            #
 * #                                                                        #
 * #   `getLeaflyMenu()` (push.ts:771-783) REFUSES to run outside sandbox:  #
 * #                                                                        #
 * #     "Reading the menu back is a sandbox-only endpoint. Leafly returns  #
 * #      405 Method Not Allowed in production, so the request was not      #
 * #      sent."                                                            #
 * #                                                                        #
 * #   So a delete UI that could only work from a live read-back would work #
 * #   in sandbox and break the day the shop goes live -- exactly when the  #
 * #   owner most needs to pull a product off a public menu.                #
 * ###########################################################################
 *
 * THE ANSWER: two sources, and the UI is always told which one it got.
 *
 *   source = "leafly"    -- a genuine read-back. Authoritative: this is what
 *                           Leafly actually holds, including anything we have
 *                           forgotten about. Sandbox only.
 *
 *   source = "our-records" -- the ids we believe we pushed, from the
 *                           syndication sync state, joined to our own product
 *                           data for names. Available in production. It is
 *                           our BELIEF, not Leafly's word, and the UI must
 *                           say so, because the gap between the two is
 *                           precisely where an unwanted product hides.
 *
 * Labelling this is not a nicety. Presenting a belief as a fact would let the
 * owner conclude a product is absent from Leafly when we simply have no
 * record of it -- and he would stop looking.
 */

import {
  filterMenuRows,
  sortMenuRows,
  computeMenuFacets,
  type MenuBrowserRow,
  type MenuBrowserFilter,
  type MenuBrowserSort,
  type MenuBrowserFacets,
} from "./menu-browser-core";
import { getLeaflyMenu } from "./push";
import { getLeaflyConfig } from "./config";
import { refreshLeaflyConfig } from "./runtime";
import { getSyncState } from "@/lib/syndication/engine-store";
import { loadSyndicationFeed } from "@/lib/syndication/feed-source";
import { loadProductIdentities } from "./identity-server";

export type MenuBrowserSource = "leafly" | "our-records";

export type MenuBrowserResult = {
  source: MenuBrowserSource;
  /** Sentence explaining what the owner is looking at and how far to trust it. */
  sourceNote: string;
  rows: MenuBrowserRow[];
  matched: MenuBrowserRow[];
  facets: MenuBrowserFacets;
  totalCount: number;
  matchedCount: number;
  /** Set when a live read-back was attempted and failed. */
  readbackError: string | null;
};

const SOURCE_NOTES: Record<MenuBrowserSource, string> = {
  leafly:
    "This is what Leafly actually holds right now, read back from their menu " +
    "endpoint. Anything listed here is live on your menu.",
  "our-records":
    "Leafly only allows reading the menu back in their sandbox, so this list " +
    "is built from OUR record of what we have sent — not from Leafly " +
    "directly. It is accurate for everything this system published, but it " +
    "cannot show a product that reached Leafly some other way.",
};

/**
 * Build the browsable menu.
 *
 * Tries the authoritative read-back first and falls back to our own records,
 * reporting which one it used. It never fabricates a third possibility, and a
 * failed read-back is surfaced rather than hidden behind the fallback.
 */
export async function loadLeaflyMenuBrowser(input: {
  filter?: MenuBrowserFilter;
  sort?: MenuBrowserSort;
} = {}): Promise<MenuBrowserResult> {
  await refreshLeaflyConfig();

  let rows: MenuBrowserRow[] = [];
  let source: MenuBrowserSource = "our-records";
  let readbackError: string | null = null;

  // Only attempt the read-back where it is legal. Calling it in production
  // would earn a 405 and a pointless error on the owner's screen.
  let canReadBack = false;
  try {
    canReadBack = getLeaflyConfig().environment === "sandbox";
  } catch {
    canReadBack = false;
  }

  if (canReadBack) {
    try {
      const result = await getLeaflyMenu();
      if (result.parse.ok) {
        rows = result.parse.items.map((item) => ({
          id: item.id,
          name: item.name,
          brand: item.brandName,
          strainName: item.strainName,
          type: item.type,
          vendor: null, // filled from our records below
          barcodes: [],
          hidden: item.hidden,
          variants: item.variants.map((v) => ({
            id: v.id,
            sizeLabel:
              v.packageSize !== null && v.packageUnit !== null
                ? `${v.packageSize}${v.packageUnit}`
                : null,
            priceMinorUnits: v.packagePrice,
            inventoryLevel: v.inventoryLevel,
          })),
          orphaned: false,
        }));
        source = "leafly";
      } else {
        readbackError = result.parse.reason ?? "Leafly's menu could not be read.";
      }
    } catch (err) {
      readbackError =
        err instanceof Error ? err.message : "Leafly's menu could not be read.";
    }
  }

  // Fallback: what we believe we published.
  if (source === "our-records") {
    let ids: string[] = [];
    try {
      const state = await getSyncState("leafly");
      ids = Array.from(state.hashes.keys());
    } catch {
      ids = [];
    }
    let feedById = new Map<string, { name: string; brand: string | null; category: string; strainName: string | null; variants: Array<{ id: string; label: string; priceMinorUnits: number; inventoryLevel: number }> }>();
    try {
      const { items } = await loadSyndicationFeed();
      feedById = new Map(
        items.map((i) => [
          i.id,
          {
            name: i.name,
            brand: i.brand,
            category: i.category,
            strainName: i.strainName,
            variants: i.variants.map((v) => ({
              id: v.id,
              label: v.label,
              priceMinorUnits: v.priceMinorUnits,
              inventoryLevel: v.inventoryLevel,
            })),
          },
        ]),
      );
    } catch {
      feedById = new Map();
    }

    rows = ids.map((id) => {
      const f = feedById.get(id);
      return {
        id,
        name: f?.name ?? null,
        brand: f?.brand ?? null,
        strainName: f?.strainName ?? null,
        type: f?.category ?? null,
        vendor: null,
        barcodes: [],
        hidden: null,
        variants:
          f?.variants.map((v) => ({
            id: v.id,
            sizeLabel: v.label,
            priceMinorUnits: v.priceMinorUnits,
            inventoryLevel: v.inventoryLevel,
          })) ?? [],
        // A product we pushed that our feed no longer carries is the single
        // most likely thing the owner is hunting for: it is on Leafly and
        // nowhere else. Flagging it is the whole point of this screen.
        orphaned: f === undefined,
      };
    });
  }

  // Enrich with vendor and barcode from our own records. These are not
  // Leafly fields; they exist so the owner can recognise the product.
  try {
    const identities = await loadProductIdentities(rows.map((r) => r.id));
    rows = rows.map((r) => {
      const identity = identities.get(r.id);
      if (identity === undefined) return r;
      return {
        ...r,
        // Never overwrite a name Leafly gave us with a local one; Leafly's is
        // what is actually on the menu the customer sees.
        name: r.name ?? identity.productName ?? identity.name,
        brand: r.brand ?? identity.brand,
        vendor: identity.vendor,
        barcodes: identity.barcodes,
      };
    });
  } catch {
    // Enrichment is a bonus. Losing it must not lose the menu.
  }

  const sorted = sortMenuRows(rows, input.sort ?? "name");
  const matched = filterMenuRows(sorted, input.filter ?? {});

  let note = SOURCE_NOTES[source];
  if (readbackError !== null && source === "our-records") {
    note += ` (A live read-back was attempted and failed: ${readbackError})`;
  }

  return {
    source,
    sourceNote: note,
    rows: sorted,
    matched,
    facets: computeMenuFacets(sorted),
    totalCount: sorted.length,
    matchedCount: matched.length,
    readbackError,
  };
}
