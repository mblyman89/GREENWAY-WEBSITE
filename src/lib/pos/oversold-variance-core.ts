/**
 * SLICE 15 — oversold variance + post-override count prompt (pure core).
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * Slice 14 gave the register a stock ceiling and a "Sell anyway" override.
 * It did NOT answer the owner's follow-up question: what should the register
 * DO at the end of a sale that used the override?
 *
 * That question was answered by research, not by intuition. The full write-up
 * with sources lives at docs/slice-15-research-oversold-industry-standard.md.
 * The four findings that drive this file:
 *
 *  1. The sale is NEVER blocked and the warning comes BEFORE completion.
 *     Shopify's own docs state that "Continue selling when out of stock"
 *     "doesn't apply to orders placed from Shopify POS. Staff can continue
 *     selling products when available inventory reaches zero and below. POS
 *     warns staff before they sell an item that's not available." Lightspeed
 *     shows the same insufficient-stock alert on the Sell screen before the
 *     sale finalises. So: warn at the override, then get out of the way.
 *
 *  2. NOTHING about the discrepancy goes on the customer's receipt. No source
 *     examined puts it there. It is an internal inventory-control record.
 *     (This was a candidate design; the research ruled it out.)
 *
 *  3. The variance is recorded WITH ATTRIBUTION and surfaced in a back-office
 *     working list. Lightspeed's Negative Inventory report columns define the
 *     minimum useful record: item, quantity on hand, adjustment reason, the
 *     SOURCE sale, quantity removed, the EMPLOYEE, and date/time. Logging
 *     without attribution is not a control.
 *
 *     THAT RECORD IS NOT WRITTEN BY THIS MODULE, and the distinction matters.
 *     The server already writes it during the decrement: it detects the same
 *     shortfall against the LIVE inventory level and stamps it onto the
 *     sale's own order_events row (sale-decrement-core.ts:213 \u2192
 *     sale-decrement.ts). That row is attached to the sale, which is what
 *     makes it traceable to its source. A second copy written here would be
 *     a second record of one event \u2014 derived from the register's CACHED
 *     count, so the less trustworthy of the two \u2014 and two records that can
 *     disagree is the opposite of an audit trail. So this module computes
 *     the variance for ONE purpose: telling the person at the counter what
 *     to recount. The back office reads the server's record.
 *
 *  4. An oversell TRIGGERS a count, and the pattern has a name. NetSuite
 *     calls it "Opportunity-based" cycle counting: "exception-based cycle
 *     counts, such as when the stock goes below its predetermined threshold,
 *     or when short-picks occur." An oversell at a register IS a short-pick.
 *     Their "zero count" practice is the direct precedent for prompting the
 *     person at the counter: when a pick empties a bin, "a command is given
 *     to the warehouse worker to have them count the bin and confirm it is
 *     empty."
 *
 * ─── AND WHY IT IS NOT OPTIONAL HERE ──────────────────────────────────────
 *
 * Vendor convention explains what good systems do. Washington law is stricter
 * and binding on this licensee. WAC 314-55-087(2) governs record keeping
 * INSIDE a point-of-sale system and sets two tests: (a) it "provides an audit
 * trail so that details ... underlying the summary accounting data may be
 * identified and made available upon request," and (b) it "provides the
 * opportunity to trace any transaction back to the original source or forward
 * to a final total."
 *
 * An oversold sale is exactly where a naive system loses that trail. The
 * existing sale-decrement CLAMPS the stored level at zero
 * (sale-decrement-core.ts:217) — correct, because state traceability cannot
 * receive a negative on-hand figure. But the clamp DESTROYS the size of the
 * discrepancy: once pinned at 0, the shortfall is unrecoverable from the level
 * alone. That is why the variance must be captured as its own attributed
 * record at the moment of sale.
 *
 * ─── TRUST DISCIPLINE ─────────────────────────────────────────────────────
 *
 * Stock trust rules are NOT re-implemented here. `sellableCeiling` from
 * stock-ceiling-core is the single source of truth for what counts as a
 * trustworthy number, so this module and the register's block/clamp can never
 * disagree about whether a count is knowable. An unknown count (null,
 * undefined, NaN, Infinity, negative, fractional) can never produce a
 * variance — you cannot be short against a number you do not have.
 *
 * Pure: no I/O, no React, no clock. Every timestamp and identity is passed in
 * by the caller so this stays deterministic and testable. Self-tested below.
 */

import { sellableCeiling } from "./stock-ceiling-core";

/** A cart line as the variance check needs it (mirrors StockBlockLine). */
export type OversoldCartLine = {
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitsLeft: number | null | undefined;
};

/**
 * One oversold line, resolved.
 *
 * Field names deliberately mirror the Lightspeed Negative Inventory report
 * columns (item / quantity on hand / quantity removed) so the back-office
 * list reads in the same vocabulary the industry already uses.
 */
export type OversoldVariance = {
  /** Display label: "Blue Dream (1g)" or just "Blue Dream". */
  label: string;
  productName: string;
  variantLabel: string | null;
  /** What the system believed was on hand. Always a known integer >= 0. */
  tracked: number;
  /** How many actually left the shelf in this sale. */
  sold: number;
  /** sold - tracked. Always >= 1 (a variance of 0 is not a variance). */
  shortfall: number;
};

/** Human label for a line, matching stockRefusalMessage's convention. */
function lineLabel(productName: string, variantLabel: string | null): string {
  return variantLabel ? `${productName} (${variantLabel})` : productName;
}

/** Truncate a possibly-corrupt quantity to a non-negative integer. */
function safeQty(quantity: number): number {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return 0;
  return Math.max(0, Math.trunc(quantity));
}

/**
 * The lines in a completed sale that went past their tracked count.
 *
 * Returns [] when the sale was clean, so `.length === 0` reads as "no count
 * to chase". A line whose stock is UNKNOWN is skipped entirely — the whole-
 * file rule — because there is no baseline to be short against.
 *
 * Note this is computed from the cart as it stood at completion, NOT from
 * whether the override toggle happened to be on. That matters: a budtender
 * can flip the override on and then sell nothing past the count, and that is
 * not a variance and must not raise a count task. Conversely a menu refresh
 * that lowers a count under an existing cart IS a real variance even though
 * no one touched the toggle. The truth is in the numbers, not the switch.
 */
export function oversoldVariances(lines: OversoldCartLine[]): OversoldVariance[] {
  if (!Array.isArray(lines)) return [];
  const out: OversoldVariance[] = [];
  for (const line of lines) {
    if (!line) continue;
    const tracked = sellableCeiling(line.unitsLeft);
    if (tracked === null) continue; // unknown count — cannot be short
    const sold = safeQty(line.quantity);
    if (sold <= tracked) continue; // within the count — nothing to reconcile
    out.push({
      label: lineLabel(line.productName, line.variantLabel),
      productName: line.productName,
      variantLabel: line.variantLabel ?? null,
      tracked,
      sold,
      shortfall: sold - tracked,
    });
  }
  return out;
}

/**
 * The count command shown at the end of the sale.
 *
 * This is NetSuite's zero-count pattern rendered for a retail counter: a
 * command to verify a specific physical count, issued at the moment of
 * discovery, while the person who can resolve it is standing in front of the
 * product. It is deliberately NOT a scolding and NOT a blocker — finding 1
 * says the sale completes normally.
 *
 * Returns null when there is nothing to count, so the caller renders nothing.
 */
export function countPromptMessage(variances: OversoldVariance[]): string | null {
  if (!Array.isArray(variances) || variances.length === 0) return null;
  if (variances.length === 1) {
    const v = variances[0]!;
    return `Recount ${v.label} before the next customer — ${v.sold} sold but only ${v.tracked} were tracked, so the count is off by ${v.shortfall}.`;
  }
  const labels = variances.map((v) => v.label).join(", ");
  const total = variances.reduce((s, v) => s + v.shortfall, 0);
  return `Recount these ${variances.length} products before the next customer — ${labels}. The tracked counts are off by ${total} units in total.`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runOversoldVarianceCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      console.log("FAIL:", msg);
      throw new Error(`oversold-variance-core self-test failed: ${msg}`);
    }
    pass += 1;
  };

  const line = (
    productName: string,
    quantity: number,
    unitsLeft: number | null | undefined,
    variantLabel: string | null = null,
  ): OversoldCartLine => ({ productName, variantLabel, quantity, unitsLeft });

  // ── oversoldVariances: the clean cases ─────────────────────────────────
  ok(oversoldVariances([]).length === 0, "empty cart has no variance");
  ok(oversoldVariances([line("A", 1, 5)]).length === 0, "within count is not a variance");
  ok(oversoldVariances([line("A", 5, 5)]).length === 0, "exactly at the count is not a variance");
  ok(oversoldVariances([line("A", 0, 0)]).length === 0, "zero sold against zero tracked is not a variance");

  // ── the real oversell ──────────────────────────────────────────────────
  const one = oversoldVariances([line("Blue Dream", 2, 1, "1g")]);
  ok(one.length === 1, "selling 2 against 1 tracked is one variance");
  ok(one[0]!.label === "Blue Dream (1g)", "label includes the variant");
  ok(one[0]!.tracked === 1 && one[0]!.sold === 2 && one[0]!.shortfall === 1, "shortfall is sold minus tracked");
  ok(one[0]!.productName === "Blue Dream" && one[0]!.variantLabel === "1g", "raw fields preserved for the audit row");

  const zero = oversoldVariances([line("Gone", 3, 0)]);
  ok(zero.length === 1 && zero[0]!.shortfall === 3, "selling 3 of a known-zero item is short by 3");
  ok(zero[0]!.label === "Gone", "no variant label collapses to the bare name");

  // ── unknown counts can NEVER produce a variance (the whole-file rule) ──
  for (const unknown of [null, undefined, -1, 2.5, NaN, Infinity, -Infinity]) {
    ok(
      oversoldVariances([line("U", 99, unknown as number | null | undefined)]).length === 0,
      `unknown count (${String(unknown)}) yields no variance`,
    );
  }

  // ── corrupt quantities never propagate ────────────────────────────────
  ok(oversoldVariances([line("A", NaN, 1)]).length === 0, "NaN quantity floors to 0, not a variance");
  ok(oversoldVariances([line("A", -5, 1)]).length === 0, "negative quantity floors to 0, not a variance");
  const frac = oversoldVariances([line("A", 3.7, 1)]);
  ok(frac.length === 1 && frac[0]!.sold === 3, "fractional quantity truncates before comparing");
  ok(oversoldVariances(null as unknown as OversoldCartLine[]).length === 0, "non-array input is handled");

  // ── multiple lines, mixed ─────────────────────────────────────────────
  const mixed = oversoldVariances([line("Clean", 1, 10), line("Short1", 2, 1), line("Untracked", 50, null), line("Short2", 5, 2)]);
  ok(mixed.length === 2, "only the genuinely short lines are reported");
  ok(mixed[0]!.productName === "Short1" && mixed[1]!.productName === "Short2", "input order is preserved");

  // ── the count prompt ──────────────────────────────────────────────────
  ok(countPromptMessage([]) === null, "no variance means no prompt to render");
  ok(countPromptMessage(null as unknown as OversoldVariance[]) === null, "non-array prompt input is handled");
  const p1 = countPromptMessage(one)!;
  ok(p1.includes("Recount Blue Dream (1g)"), "single prompt names the product");
  ok(p1.includes("2 sold") && p1.includes("only 1") && p1.includes("off by 1"), "single prompt states the arithmetic");
  const p2 = countPromptMessage(mixed)!;
  ok(p2.includes("these 2 products"), "multi prompt counts the products");
  ok(p2.includes("Short1") && p2.includes("Short2"), "multi prompt names every product");
  ok(p2.includes("off by 4"), "multi prompt totals the shortfall (1 + 3)");

  // The prompt is a count command, never a blocker or a reprimand.
  for (const bad of ["error", "denied", "not allowed", "cannot"]) {
    ok(!p1.toLowerCase().includes(bad), `prompt avoids blocking language: ${bad}`);
  }

  // ── the invariant that ties this file to the register ─────────────────
  // Anything the ceiling allows must NEVER register as a variance. If this
  // ever breaks, the register would nag for a count on a legal sale.
  for (let stock = 0; stock <= 6; stock += 1) {
    for (let want = 0; want <= 6; want += 1) {
      const ceiling = sellableCeiling(stock)!;
      const vs = oversoldVariances([line("X", want, stock)]);
      if (want <= ceiling) {
        ok(vs.length === 0, `stock ${stock} / sold ${want}: legal sale raises no count task`);
      } else {
        ok(vs.length === 1 && vs[0]!.shortfall === want - ceiling, `stock ${stock} / sold ${want}: shortfall exact`);
      }
    }
  }

  console.log(`oversold-variance-core self-tests: ${pass} assertion(s) passed`);
}
