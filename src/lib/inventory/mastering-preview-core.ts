/**
 * src/lib/inventory/mastering-preview-core.ts  (S34)
 *
 * PURE copy + links for the Mastering preview on Product Onboarding: one line
 * per group the S19 dry run built (previewMasteringGroups), so the owner sees
 * WHICH invoice rows Approve will master as one card and WHERE each card
 * lands - before approving. Presentational decisions only; the grouping is
 * never recomputed here (bible S34.8).
 *
 * Links, never a dead end:
 *   - joins     -> the live card's product page. The joined card always comes
 *                  from the PUBLISHED version's non-hidden cards (S19 read),
 *                  so /admin/products/<key> resolves; a "new" card has no
 *                  page yet, so it is plain text (the notFound() trap, F-101).
 *   - ambiguous -> the S32 match review for THIS delivery + identity, where
 *                  the owner chooses the card (or keeps it separate).
 */
import type { PreviewGroupView } from "@/lib/pos/intake-mastering-core";
import { PREVIEW_SIZE_UNKNOWN } from "@/lib/pos/intake-mastering-core";
import { formatMoney } from "@/lib/pos/format";
import { matchReviewHref, productPageHref } from "@/lib/pos/issue-fix-link-core";

export const MASTERING_PREVIEW_HEADING = "Mastering preview \u2014 what Approve will do with this delivery";
export const MASTERING_PREVIEW_INTRO =
  "Rows of the same product (same vendor, category and strain or flavor) become ONE card with one size per row. Nothing changes until you approve.";

export type MasteringGroupLine = {
  kind: "joins" | "new" | "ambiguous";
  /** "3 rows \u2192 one card with 1 g \u00b7 3.5 g \u00b7 7 g" */
  lead: string;
  /** joins: the card name (rendered bold). */
  cardName: string | null;
  /** joins: "(now 2 sizes, $12.00\u2013$35.00, 14 on hand)"; ambiguous: the choice sentence. */
  tail: string;
  link: { href: string; label: string } | null;
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "1 g \u00b7 3.5 g"; all-unknown -> "no recorded sizes"; partly unknown keeps the honest marker. */
export function sizesText(sizes: string[]): string {
  if (sizes.length === 0 || sizes.every((s) => s === PREVIEW_SIZE_UNKNOWN)) return "no recorded sizes";
  return sizes.join(" \u00b7 ");
}

/** "$12.00\u2013$35.00", "$30.00" for one price, "no price yet" for none. */
export function priceRangeText(range: [number, number] | null): string {
  if (!range) return "no price yet";
  const [lo, hi] = range;
  return lo === hi ? formatMoney(lo) : `${formatMoney(lo)}\u2013${formatMoney(hi)}`;
}

export function masteringGroupLine(
  group: PreviewGroupView,
  ctx: { manifestId: string | null; back?: string | null },
): MasteringGroupLine {
  const n = group.draftIds.length;
  const rows = plural(n, "row", "rows");
  const sizes = sizesText(group.sizes);
  const v = group.verdict;
  if (v.kind === "joins") {
    const card = group.liveCard;
    const tail = card
      ? `(now ${plural(card.variantLabels.length, "size", "sizes")}, ${priceRangeText(card.priceRangeMinor)}, ${
          card.onHand === null ? "stock unknown" : `${card.onHand} on hand`
        })`
      : "";
    return {
      kind: "joins",
      lead: `${rows} \u2192 one card with ${sizes} \u2192 joins`,
      cardName: v.cardName,
      tail,
      link: card && card.key === v.cardKey ? { href: productPageHref(v.cardKey, ctx.back), label: "Open live card" } : null,
    };
  }
  if (v.kind === "ambiguous") {
    return {
      kind: "ambiguous",
      lead: `${rows} \u2192 one card with ${sizes}`,
      cardName: null,
      tail: `Matches ${v.cardKeys.length} live cards \u2014 choose which one (or keep separate)`,
      link: ctx.manifestId ? { href: matchReviewHref(ctx.manifestId, group.identity, ctx.back), label: "Compare & choose" } : null,
    };
  }
  return {
    kind: "new",
    lead: `${rows} \u2192 one NEW card with ${sizes}`,
    cardName: null,
    tail: "",
    link: null,
  };
}

/** The one-line roll-up above the groups ("3 cards from 7 rows: ..."). */
export function masteringSummaryText(groups: PreviewGroupView[], totalRows: number): string {
  const rows = groups.reduce((a, g) => a + g.draftIds.length, 0);
  const joins = groups.filter((g) => g.verdict.kind === "joins").length;
  const fresh = groups.filter((g) => g.verdict.kind === "new").length;
  const amb = groups.filter((g) => g.verdict.kind === "ambiguous").length;
  const parts = [`${joins} join a live card`, `${fresh} new`];
  if (amb > 0) parts.push(`${amb} need${amb === 1 ? "s" : ""} your choice`);
  const head = `${plural(groups.length, "card", "cards")} from ${plural(rows, "row", "rows")}: ${parts.join(", ")}.`;
  const rest = Math.max(0, totalRows - rows);
  if (rest === 0) return head;
  const why = "(already live, missing vendor or category, or too vague a name)";
  return rest === 1
    ? `${head} 1 other row is not grouped ${why} \u2014 its chip on the row says why.`
    : `${head} ${rest} other rows are not grouped ${why} \u2014 their chips on the rows say why.`;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runMasteringPreviewCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL mastering-preview-core: " + msg);
    passed += 1;
  };
  const M = "11111111-2222-3333-4444-555555555555";
  const g = (over: Partial<PreviewGroupView>): PreviewGroupView => ({
    identity: "fairwinds-llc|flower|blue-dream",
    category: "flower",
    family: "blue-dream",
    draftIds: ["a", "b", "c"],
    sizes: ["1 g", "3.5 g", "7 g"],
    verdict: { kind: "new" },
    ...over,
  });
  const joinsV = { kind: "joins" as const, cardKey: "pos-1", cardName: "Blue Dream", fromCultivera: true, matchedBy: "name" as const, vendorRecordDiffers: false };
  const live = { key: "pos-1", name: "Blue Dream", variantLabels: ["1g", "3.5g"], priceRangeMinor: [1200, 3500] as [number, number], onHand: 14 };

  const j = masteringGroupLine(g({ verdict: joinsV, liveCard: live }), { manifestId: M, back: "/admin/inventory/drafts" });
  ok(j.lead === "3 rows \u2192 one card with 1 g \u00b7 3.5 g \u00b7 7 g \u2192 joins", "joins lead (bible copy)");
  ok(j.cardName === "Blue Dream" && j.tail === "(now 2 sizes, $12.00\u2013$35.00, 14 on hand)", "joins tail: sizes, price range, on hand");
  ok(j.link?.href === "/admin/products/pos-1?back=%2Fadmin%2Finventory%2Fdrafts", "joins links the live card (published read)");
  const jUnknown = masteringGroupLine(g({ verdict: joinsV, liveCard: { ...live, variantLabels: ["1g"], priceRangeMinor: null, onHand: null } }), { manifestId: M });
  ok(jUnknown.tail === "(now 1 size, no price yet, stock unknown)", "joins tail never invents price or stock");
  ok(masteringGroupLine(g({ verdict: joinsV }), { manifestId: M }).link === null, "joins without the card read -> no link");
  ok(masteringGroupLine(g({ verdict: joinsV, liveCard: { ...live, key: "other" } }), { manifestId: M }).link === null, "card mismatch -> no link");

  const n = masteringGroupLine(g({ draftIds: ["a"], sizes: ["3.5 g"] }), { manifestId: M });
  ok(n.lead === "1 row \u2192 one NEW card with 3.5 g" && n.link === null && n.cardName === null, "new: singular, no product link (unpublished)");
  ok(masteringGroupLine(g({ sizes: [PREVIEW_SIZE_UNKNOWN, PREVIEW_SIZE_UNKNOWN] }), { manifestId: M }).lead.endsWith("no recorded sizes"), "all sizes unknown said plainly");
  ok(sizesText(["1 g", PREVIEW_SIZE_UNKNOWN]) === "1 g \u00b7 " + PREVIEW_SIZE_UNKNOWN, "partly unknown keeps the marker");

  const a = masteringGroupLine(g({ verdict: { kind: "ambiguous", cardKeys: ["k1", "k2"] } }), { manifestId: M, back: "/admin/inventory/drafts?manifest=x" });
  ok(a.tail === "Matches 2 live cards \u2014 choose which one (or keep separate)", "ambiguous copy (bible)");
  ok(a.link?.href.startsWith(`/admin/inventory/intake/${M}/match?identity=fairwinds-llc%7Cflower%7Cblue-dream`) === true && a.link?.label === "Compare & choose", "ambiguous links the S32 review for this identity");
  ok(masteringGroupLine(g({ verdict: { kind: "ambiguous", cardKeys: ["k1", "k2"] } }), { manifestId: null }).link === null, "no delivery -> no review link");

  ok(priceRangeText([3000, 3000]) === "$30.00" && priceRangeText(null) === "no price yet", "price range text");
  const groups = [g({ verdict: joinsV, liveCard: live }), g({ draftIds: ["d"] }), g({ draftIds: ["e", "f"], verdict: { kind: "ambiguous", cardKeys: ["k1", "k2"] } })];
  ok(masteringSummaryText(groups, 6) === "3 cards from 6 rows: 1 join a live card, 1 new, 1 needs your choice.", "summary, nothing left over");
  ok(masteringSummaryText(groups, 8).endsWith("2 other rows are not grouped (already live, missing vendor or category, or too vague a name) \u2014 their chips on the rows say why."), "summary: plural ungrouped rows");
  ok(masteringSummaryText(groups.slice(0, 2), 5).endsWith("1 other row is not grouped (already live, missing vendor or category, or too vague a name) \u2014 its chip on the row says why."), "summary names the ungrouped row");
  ok(masteringSummaryText([g({})], 3) === "1 card from 3 rows: 0 join a live card, 1 new.", "summary singular, no ambiguous clause");
  return { passed, failed: 0 };
}
