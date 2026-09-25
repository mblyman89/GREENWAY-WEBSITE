#!/usr/bin/env python3
"""SLICE L-44 -- preview-core: Ben's answer 8 becomes code.

Every replacement asserts its anchor occurs exactly once, so a drifted file
fails loudly instead of being half-edited.
"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "src/lib/leafly/preview-core.ts"
s = P.read_text()


def swap(old: str, new: str) -> None:
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"anchor count {n} != 1: {old[:90]!r}")
    s = s.replace(old, new)


# ---------------------------------------------------------------- header doc
swap(
    """ * Nothing in Leafly's specification states which convention a retailer's
 * `packagePrice` is expected to follow, so the convention is NOT guessed here.
 * Instead this module computes the answer both ways, and both ways are required
 * by construction to produce the SAME out-the-door total \u2014 the number the
 * customer actually hands over at the counter. That total is the invariant that
 * is defended, because it is the only figure both models agree is real.
 *
 * The default is `tax_inclusive_no_tax_lines`, chosen on the principle in the
 * slice's decision D-2: of the two readings, pick the one that cannot
 * OVERCHARGE a shopper. See `LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED`.
""",
    """ * Nothing in Leafly's specification states which convention a retailer's
 * `packagePrice` is expected to follow. Until SLICE L-44 this module therefore
 * computed the answer both ways, required both to produce the SAME out-the-door
 * total, and defaulted to the one that cannot overcharge (decision D-2).
 *
 * \u2500\u2500 SETTLED BY LEAFLY (SLICE L-44) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * Ben (Leafly integrations), item 8, recorded verbatim in
 * docs/leafly-ben-email-integration-round.md:
 *
 *   "Send the tax-inclusive shelf price as `packagePrice`, with an EMPTY taxes
 *    array. The store is configured as 'tax included in menu'. If we send
 *    `TaxComponent` lines, they will not be added to the shopper's total -- so
 *    what we send and what the shopper sees would disagree."
 *
 * So D-2's default was the right one, and it is no longer a default: the ONLY
 * entry point the webhook may use is `buildLeaflyWebhookPreviewResponse`, which
 * pins `tax_inclusive_no_tax_lines` and then PROVES the result with
 * `checkTaxInclusivePreview` (empty `taxes`, every `packagePrice` equal to the
 * menu-feed price to the cent, and the lines summing to the out-the-door
 * total). The tax-exclusive arithmetic is kept, because its reconciliation is
 * what proves the inclusive total is the true one, but it is unreachable from
 * the webhook and a compliance test pins that.
""",
)

# ------------------------------------------------------ the unconfirmed flag
swap(
    """/**
 * TRUE until Leafly confirms the convention in writing.
 *
 * Mirrors `LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED` in `hmac-core.ts`: an unknown
 * is represented as a named constant rather than a comment, so it appears in
 * the certification-readiness report instead of living in someone's memory.
 * Flip to `false` ONLY when Leafly answers, and record their answer.
 */
export const LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED = true;

/** The exact question to put to Leafly. */
export const LEAFLY_PREVIEW_OPEN_QUESTION =
  "Greenway's shelf prices are tax-inclusive out-the-door prices (37% WA excise + " +
  "9.3% sales are already inside the number on the label, per RCW 69.50.535). In the " +
  "order preview response, should packagePrice be that tax-inclusive price with an " +
  "empty taxes array, or the backed-out pre-tax price with excise and sales listed as " +
  "separate TaxComponent lines? Both give the same total; we need to know which one " +
  "Leafly's checkout adds together for display.";
""",
    """/**
 * FALSE since SLICE L-44: Leafly answered in writing (Ben, item 8).
 *
 * Mirrors `LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED` in `hmac-core.ts`, which was
 * flipped by L-43 for the same reason. The question this used to flag
 * (`LEAFLY_PREVIEW_OPEN_QUESTION`) was removed with it, because an answered
 * question left in the code invites someone to "re-ask" it by changing the
 * default. `LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE` records the answer instead.
 */
export const LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED = false;

/** Where the answer came from, so nobody has to rediscover it. */
export const LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE =
  "Ben (Leafly integrations), item 8, docs/leafly-ben-email-integration-round.md: " +
  "send the tax-inclusive shelf price as packagePrice with an EMPTY taxes array; the " +
  "store is configured as tax included in menu, and TaxComponent lines would NOT be " +
  "added to the shopper's total.";

/**
 * The ONE presentation the order_preview webhook may send. A separate constant
 * from the default, so that changing the default for an experiment can never
 * silently change what Leafly receives.
 */
export const LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION = "tax_inclusive_no_tax_lines" as const;
""",
)

# ----------------------------------------------- invariant + webhook builder
swap(
    """function formatMinor(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}
""",
    """function formatMinor(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

/* ------------------------------------------------------------------------- *
 * 4b. SLICE L-44 \u2014 the tax-inclusive invariant, and the webhook entry point
 * ------------------------------------------------------------------------- */

/** Every way a preview body can disagree with Ben's answer 8. */
export const LEAFLY_PREVIEW_TAX_VIOLATIONS = [
  /** The body carries TaxComponent lines. Leafly would not add them. */
  "tax_lines_present",
  /** The built response says it used the exclusive presentation. */
  "wrong_presentation",
  /** A `packagePrice` is not the menu-feed price for that variant. */
  "price_not_feed_price",
  /** A cart item names a variant the lookup does not know. */
  "unknown_variant_in_body",
  /** The lines do not add up to the out-the-door total. */
  "total_mismatch",
] as const;
export type LeaflyPreviewTaxViolation = (typeof LEAFLY_PREVIEW_TAX_VIOLATIONS)[number];

export type TaxInclusivePreviewCheck = {
  ok: boolean;
  violations: { kind: LeaflyPreviewTaxViolation; detail: string }[];
};

/**
 * Prove a built preview obeys Ben's answer 8. PURE.
 *
 * What is checked, and why each one is its own check:
 *   - `taxes` is EMPTY. Leafly does not add TaxComponent lines to the total, so
 *     any line is at best noise and at worst a figure that disagrees with what
 *     the shopper is charged.
 *   - Every `packagePrice` equals the price in OUR menu feed for that variant,
 *     to the cent. The menu push sends `price: Math.round(v.priceMinorUnits)`
 *     (payload-core.ts) and the lookup is built from the same feed with the
 *     same rounding (preview-lookup.ts), so the preview and the menu the shopper
 *     has been browsing must agree exactly.
 *   - The lines sum to `outTheDoorTotalMinor`. With no tax lines, the lines ARE
 *     the total, so a gap here is money appearing or disappearing.
 */
export function checkTaxInclusivePreview(
  built: BuiltPreviewResponse,
  lookup: VariantLookup,
): TaxInclusivePreviewCheck {
  const violations: TaxInclusivePreviewCheck["violations"] = [];

  if (built.presentation !== LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION) {
    violations.push({
      kind: "wrong_presentation",
      detail: `built with ${built.presentation}; Leafly requires ${LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION}`,
    });
  }

  if (!Array.isArray(built.body.taxes) || built.body.taxes.length !== 0) {
    const n = Array.isArray(built.body.taxes) ? built.body.taxes.length : -1;
    violations.push({
      kind: "tax_lines_present",
      detail: `taxes must be an empty array; it has ${n < 0 ? "no array" : `${n} line(s)`}`,
    });
  }

  let linesTotal = 0;
  for (const item of built.body.cartItems) {
    const facts = lookup(item.integratorVariantId);
    if (!facts) {
      violations.push({
        kind: "unknown_variant_in_body",
        detail: `${item.integratorVariantId} is in the body but not in the menu feed`,
      });
      continue;
    }
    const feedPrice = Math.max(0, Math.trunc(facts.priceMinorUnits));
    if (item.packagePrice !== feedPrice) {
      violations.push({
        kind: "price_not_feed_price",
        detail:
          `${item.integratorVariantId}: packagePrice ${item.packagePrice} but the menu ` +
          `feed price is ${feedPrice}`,
      });
    }
    linesTotal += item.packagePrice * item.quantity;
  }

  if (linesTotal !== built.outTheDoorTotalMinor) {
    violations.push({
      kind: "total_mismatch",
      detail: `lines sum to ${linesTotal} but the out-the-door total is ${built.outTheDoorTotalMinor}`,
    });
  }

  return { ok: violations.length === 0, violations };
}

/** Thrown when the invariant fails. The route's catch echoes the cart. */
export class LeaflyPreviewTaxInvariantError extends Error {
  readonly check: TaxInclusivePreviewCheck;
  constructor(check: TaxInclusivePreviewCheck) {
    super(
      "[leafly order_preview] tax-inclusive invariant violated: " +
        check.violations.map((v) => `${v.kind} (${v.detail})`).join("; "),
    );
    this.name = "LeaflyPreviewTaxInvariantError";
    this.check = check;
  }
}

/**
 * THE ONLY preview builder the order_preview webhook may call.
 *
 * It takes no `presentation` argument, on purpose: there is nothing to choose.
 * It builds with `LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION` and then refuses to
 * return anything `checkTaxInclusivePreview` rejects. The throw is unreachable
 * with today's code; it exists so a future edit that breaks the invariant
 * produces the route's safe "echo the cart unchanged" answer (which is itself
 * tax-inclusive with empty taxes) instead of a wrong price at checkout.
 */
export function buildLeaflyWebhookPreviewResponse(input: {
  lines: IncomingPreviewLine[];
  lookup: VariantLookup;
}): BuiltPreviewResponse {
  const built = buildLeaflyPreviewResponse({
    lines: input.lines,
    lookup: input.lookup,
    presentation: LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION,
  });
  const check = checkTaxInclusivePreview(built, input.lookup);
  if (!check.ok) throw new LeaflyPreviewTaxInvariantError(check);
  return built;
}
""",
)

# ---------------------------------------------------------------- self-tests
swap(
    """  ok(LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED === true, "the unknown is still flagged");
""",
    """  // SLICE L-44: Leafly answered (Ben, item 8). The flag is down and the
  // answer is recorded where the question used to be.
  ok(
    LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED === false,
    "the tax question is marked ANSWERED (L-44, Ben item 8)",
  );
  ok(
    LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE.includes("Ben") &&
      LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE.includes("EMPTY taxes") &&
      LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE.includes("tax-inclusive"),
    "the recorded source names Ben and states the answer (tax-inclusive, EMPTY taxes)",
  );
  ok(
    (LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION as string) === "tax_inclusive_no_tax_lines",
    "the webhook presentation is tax-inclusive, as Leafly requires",
  );
  ok(
    (LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION as string) ===
      (LEAFLY_PREVIEW_DEFAULT_TAX_PRESENTATION as string),
    "the default and the webhook presentation agree",
  );
""",
)

# Extra self-tests for the invariant, appended before the final return.
swap(
    """      blankish.body.cartItems.length === 0,
      "a whitespace-only variant id is treated exactly like a blank one",
    );
  }

  return { passed, failed };
}
""",
    """      blankish.body.cartItems.length === 0,
      "a whitespace-only variant id is treated exactly like a blank one",
    );
  }

  // \u2500\u2500 SLICE L-44: the tax-inclusive invariant (Ben, item 8) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  {
    const l44cart: IncomingPreviewLine[] = [
      { name: "Blue Dream", integratorVariantId: "v-flower", quantity: 2, packagePrice: 5000 },
      { name: "Tee", integratorVariantId: "v-merch", quantity: 1, packagePrice: 1200 },
    ];
    const hook = buildLeaflyWebhookPreviewResponse({ lines: l44cart, lookup });
    ok(hook.presentation === "tax_inclusive_no_tax_lines", "L-44: the webhook builder is tax-inclusive");
    ok(hook.body.taxes.length === 0, "L-44: the webhook body has an EMPTY taxes array");
    ok(
      hook.body.cartItems.every(
        (i) => i.packagePrice === catalogue[i.integratorVariantId].priceMinorUnits,
      ),
      "L-44: every packagePrice is the feed price, to the cent",
    );
    ok(hook.outTheDoorTotalMinor === 11200, "L-44: the out-the-door total is unchanged (2x5000 + 1200)");
    ok(
      hook.body.cartItems.reduce((n, i) => n + i.packagePrice * i.quantity, 0) ===
        hook.outTheDoorTotalMinor,
      "L-44: with no tax lines, the lines ARE the total",
    );
    ok(checkTaxInclusivePreview(hook, lookup).ok, "L-44: the checker accepts the webhook body");
    ok(
      checkTaxInclusivePreview(hook, lookup).violations.length === 0,
      "L-44: and reports no violations for it",
    );

    // Byte-identical to what the pre-L-44 route produced (default presentation).
    const legacy = buildLeaflyPreviewResponse({ lines: l44cart, lookup });
    ok(
      JSON.stringify(legacy.body) === JSON.stringify(hook.body),
      "L-44: the webhook body is byte-identical to the pre-L-44 default body",
    );

    // Each violation kind is DETECTED, from a deliberately broken response.
    const exclusive44 = buildLeaflyPreviewResponse({
      lines: l44cart,
      lookup,
      presentation: "tax_exclusive_with_tax_lines",
    });
    const exCheck = checkTaxInclusivePreview(exclusive44, lookup);
    const kinds = new Set(exCheck.violations.map((v) => v.kind));
    ok(!exCheck.ok, "L-44: the checker REJECTS the tax-exclusive body");
    ok(kinds.has("wrong_presentation"), "L-44: ...naming the wrong presentation");
    ok(kinds.has("tax_lines_present"), "L-44: ...naming the tax lines");
    ok(kinds.has("price_not_feed_price"), "L-44: ...naming the pre-tax prices");
    ok(kinds.has("total_mismatch"), "L-44: ...and the lines no longer being the total");

    const withTax: BuiltPreviewResponse = {
      ...hook,
      body: { ...hook.body, taxes: [{ label: LEAFLY_TAX_LABEL_EXCISE, amountCents: 1 }] },
    };
    const taxOnly = checkTaxInclusivePreview(withTax, lookup);
    ok(
      !taxOnly.ok && taxOnly.violations.length === 1 && taxOnly.violations[0].kind === "tax_lines_present",
      "L-44: ONE stray tax line of 1 cent is caught, and is the only violation",
    );

    const offByOne: BuiltPreviewResponse = {
      ...hook,
      body: {
        ...hook.body,
        cartItems: hook.body.cartItems.map((i, n) =>
          n === 0 ? { ...i, packagePrice: i.packagePrice + 1 } : i,
        ),
      },
      outTheDoorTotalMinor: hook.outTheDoorTotalMinor + 2,
    };
    const penny = checkTaxInclusivePreview(offByOne, lookup);
    ok(
      !penny.ok && penny.violations.map((v) => v.kind).join(",") === "price_not_feed_price",
      "L-44: a price ONE CENT off the feed is caught even when the total is kept consistent",
    );

    const drift: BuiltPreviewResponse = { ...hook, outTheDoorTotalMinor: hook.outTheDoorTotalMinor - 1 };
    const driftCheck = checkTaxInclusivePreview(drift, lookup);
    ok(
      !driftCheck.ok && driftCheck.violations.map((v) => v.kind).join(",") === "total_mismatch",
      "L-44: a total ONE CENT off the lines is caught",
    );

    const ghost: BuiltPreviewResponse = {
      ...hook,
      body: {
        ...hook.body,
        cartItems: [...hook.body.cartItems, { integratorVariantId: "ghost", quantity: 1, packagePrice: 1 }],
      },
    };
    ok(
      checkTaxInclusivePreview(ghost, lookup).violations.some((v) => v.kind === "unknown_variant_in_body"),
      "L-44: a cart item the feed does not know is caught",
    );

    const noArray = {
      ...hook,
      body: { ...hook.body, taxes: undefined as unknown as LeaflyTaxComponent[] },
    } as BuiltPreviewResponse;
    ok(
      checkTaxInclusivePreview(noArray, lookup).violations.some((v) => v.kind === "tax_lines_present"),
      "L-44: a MISSING taxes array is a violation, not a pass (the schema requires it)",
    );

    // The webhook builder refuses to return a violating body.
    let threw: unknown = null;
    try {
      buildLeaflyWebhookPreviewResponse({
        lines: l44cart,
        // A lookup that changes its answer between build and check models a
        // future edit that breaks the invariant.
        lookup: (() => {
          let calls = 0;
          return (id: string) => {
            calls += 1;
            const f = catalogue[id] ?? null;
            return f && calls > 2 ? { ...f, priceMinorUnits: f.priceMinorUnits + 1 } : f;
          };
        })(),
      });
    } catch (e) {
      threw = e;
    }
    ok(threw instanceof LeaflyPreviewTaxInvariantError, "L-44: a violating body is THROWN, never returned");
    ok(
      threw instanceof LeaflyPreviewTaxInvariantError &&
        threw.message.includes("price_not_feed_price") &&
        !threw.check.ok,
      "L-44: the error names the violation for the log",
    );

    // Sweep: every catalogue variant x quantity, the webhook builder always
    // passes its own invariant (and so never throws on real data).
    let sweepOk = 0;
    let sweepN = 0;
    for (const id of Object.keys(catalogue)) {
      for (const q of [1, 2, 3, 7, 99]) {
        sweepN += 1;
        try {
          const b = buildLeaflyWebhookPreviewResponse({
            lines: [{ name: id, integratorVariantId: id, quantity: q, packagePrice: 1 }],
            lookup,
          });
          if (b.body.taxes.length === 0 && checkTaxInclusivePreview(b, lookup).ok) sweepOk += 1;
        } catch {
          /* counted as a failure below */
        }
      }
    }
    ok(
      sweepN === Object.keys(catalogue).length * 5 && sweepOk === sweepN,
      `L-44: the webhook builder passes its invariant for every swept cart (${sweepOk}/${sweepN})`,
    );
    ok(
      LEAFLY_PREVIEW_TAX_VIOLATIONS.length === 5 &&
        new Set(LEAFLY_PREVIEW_TAX_VIOLATIONS).size === 5,
      "L-44: five distinct violation kinds",
    );
  }

  return { passed, failed };
}
""",
)

P.write_text(s)
print("edited", P)
