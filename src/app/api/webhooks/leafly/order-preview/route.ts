/**
 * POST /api/webhooks/leafly/order-preview   (Slice L-5)
 *
 * The ODD ONE OUT. Every other Leafly order webhook answers 200 with an empty
 * body. This one must answer 200 with a POPULATED body, synchronously, while a
 * shopper waits at checkout. From the spec:
 *
 *   "The preview webhook expects a synchronous response with a further
 *    distilled representation of the cart where your integration has an
 *    opportunity to adjust items quantities (downward only), remove items
 *    entirely, correct top-of-line pricing, and supply a list of applicable
 *    taxes."
 *
 * and from the requirements table:
 *
 *   | Order Preview | Webhook | 200 Ok, response bodies matching the
 *     specification of this document | _Recommended_ |
 *
 * ── THE FAILURE MODE THAT MATTERS ──────────────────────────────────────────
 * If anything here goes wrong, the wrong instinct is to return an error. Doing
 * so would break a live checkout for a real shopper. The right answer is to
 * return the cart UNCHANGED — that is, to confirm exactly what Leafly proposed.
 * Leafly's own catalogue prices came from our menu push, so echoing them back
 * is not a guess: it is deferring to the last figure we ourselves published.
 * The shopper sees the price they were already browsing, and the discrepancy is
 * caught at the counter rather than as a checkout failure.
 *
 * That fallback is the reason this route does not simply reuse the factory.
 *
 * ── TAX: SETTLED BY LEAFLY (SLICE L-44) ────────────────────────────────────
 * Greenway's shelf prices are tax-INCLUSIVE. Leafly's documentation did not say
 * which convention `packagePrice` should follow, so decision D-2 defaulted to
 * the one that cannot overcharge. Ben (Leafly, item 8) then confirmed it: send
 * the tax-inclusive shelf price as `packagePrice` with an EMPTY `taxes` array,
 * because the store is set to "tax included in menu" and TaxComponent lines
 * would NOT be added to the shopper's total.
 *
 * So this route calls `buildLeaflyWebhookPreviewResponse`, which takes no
 * presentation argument and proves its own output with
 * `checkTaxInclusivePreview` before returning it. Every exit from this file
 * therefore sends `taxes: []`: the priced cart, the echo fallbacks, the empty
 * unsigned delivery, and the unreadable-body case. A compliance test pins that.
 */
import { NextResponse } from "next/server";
import { handleLeaflyWebhook } from "@/lib/leafly/webhook-server";
import {
  buildLeaflyWebhookPreviewResponse,
  type IncomingPreviewLine,
  type LeaflyPreviewResponseBody,
} from "@/lib/leafly/preview-core";
import { buildLeaflyVariantLookup } from "@/lib/leafly/preview-lookup";
// SLICE L-46: previews are never retried (Ben, item 4) and the shopper waits.
import {
  LEAFLY_PREVIEW_BOOKKEEPING_MS,
  describePreviewPricingTimeout,
  remainingBudgetMs,
} from "@/lib/leafly/inbound-budget-core";
import {
  keepLeaflyWorkAlive,
  leaflyInboundBudgetMs,
  raceLeaflyBudget,
} from "@/lib/leafly/inbound-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// SLICE L-46: Leafly counts an answer slower than 9 seconds as a failure, so
// the 200 goes out inside a 6-second budget and any unfinished work keeps
// running after it (Next `after()`). That work lives only as long as the
// function, and this is how long that is. Must be a literal (Next reads it
// statically); pinned equal to LEAFLY_WEBHOOK_MAX_DURATION_S by a test.
export const maxDuration = 300;

/**
 * Echo the shopper's cart back unchanged.
 *
 * Used when we cannot price the cart ourselves. `taxes: []` is correct here
 * rather than merely convenient: we are asserting no ADJUSTMENT, and Leafly's
 * schema forbids a zero-amount tax line (`amountCents` has `minimum: 1`), so an
 * empty array is the only valid way to say "nothing to add".
 */
function echoCartUnchanged(lines: IncomingPreviewLine[]): LeaflyPreviewResponseBody {
  return {
    cartItems: lines
      .filter(
        (l) =>
          typeof l.integratorVariantId === "string" &&
          l.integratorVariantId.trim() !== "" &&
          typeof l.quantity === "number" &&
          Number.isFinite(l.quantity) &&
          l.quantity >= 1 &&
          typeof l.packagePrice === "number" &&
          Number.isFinite(l.packagePrice) &&
          l.packagePrice >= 1,
      )
      .map((l) => ({
        integratorVariantId: (l.integratorVariantId as string).trim(),
        quantity: Math.trunc(l.quantity as number),
        packagePrice: Math.trunc(l.packagePrice as number),
      })),
    taxes: [],
  };
}

/** Pull the cart lines out of a parsed preview body without trusting any of it. */
function readCartLines(body: Record<string, unknown> | null): IncomingPreviewLine[] {
  if (!body) return [];
  const raw = body["cartItems"];
  if (!Array.isArray(raw)) return [];
  const out: IncomingPreviewLine[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    out.push({
      name: typeof e.name === "string" ? e.name : null,
      integratorVariantId:
        typeof e.integratorVariantId === "string" ? e.integratorVariantId : null,
      quantity: typeof e.quantity === "number" ? e.quantity : null,
      packagePrice: typeof e.packagePrice === "number" ? e.packagePrice : null,
    });
  }
  return out;
}

export async function POST(request: Request): Promise<Response> {
  const startedAtMs = Date.now();
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    console.error("[leafly order_preview] could not read the request body");
    // No body means no cart to echo. An empty, schema-valid response is the
    // only honest answer available.
    return NextResponse.json({ cartItems: [], taxes: [] }, { status: 200 });
  }

  const handled = await handleLeaflyWebhook({
    rawBody,
    headers: request.headers,
    expectedEvent: "order_preview",
    // SLICE L-46: bookkeeping (event row, order row) may hold the cart for at
    // most this long; anything slower finishes after the response. Pricing
    // below gets whatever is left of the inbound budget.
    startedAtMs,
    budgetMs: LEAFLY_PREVIEW_BOOKKEEPING_MS,
  });

  // Signature failure is the ONE case the spec allows a non-200 for.
  if (handled.status === 401) {
    console.warn(handled.logLine);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // SLICE L-43. Leafly's expected empty, unsigned delivery. There is no cart
  // to price, and nothing was authenticated, so do not touch the menu lookup:
  // answer with the empty, schema-valid preview and stop.
  if (handled.admission === "acknowledge_only") {
    console.log(handled.logLine);
    return NextResponse.json({ cartItems: [], taxes: [] }, { status: 200 });
  }

  const lines = readCartLines(handled.parsed.body);

  try {
    // SLICE L-46: the menu read (settings + syndication feed) had no bound.
    // Raced against what is left of the budget; on timeout the cart goes back
    // unchanged - the same answer as "menu unavailable" below - and the read
    // finishes harmlessly in the background.
    const pricingLeft = remainingBudgetMs({
      startedAtMs,
      nowMs: Date.now(),
      budgetMs: leaflyInboundBudgetMs(),
    });
    const lookupWork = buildLeaflyVariantLookup();
    const lookupRace = await raceLeaflyBudget(lookupWork, pricingLeft);
    if (!lookupRace.finished) {
      keepLeaflyWorkAlive(lookupWork);
      console.warn(
        describePreviewPricingTimeout({ remainingMs: pricingLeft, lineCount: lines.length }),
      );
      return NextResponse.json(echoCartUnchanged(lines), { status: 200 });
    }
    const { lookup, loaded, variantCount } = lookupRace.value;

    // No published menu means we have nothing to validate against. Echoing the
    // cart back beats removing every line, which would empty a real shopper's
    // basket because of a problem entirely on our side.
    if (!loaded || variantCount === 0) {
      console.warn(
        `[leafly order_preview] menu unavailable (loaded=${loaded}, variants=${variantCount}) — ` +
          `echoing ${lines.length} cart line(s) back unchanged`,
      );
      return NextResponse.json(echoCartUnchanged(lines), { status: 200 });
    }

    // SLICE L-44: the webhook-only builder. Tax-inclusive, `taxes: []`, and
    // self-checked; if the check ever fails it throws into the catch below,
    // which echoes the cart (also tax-inclusive, also `taxes: []`).
    const built = buildLeaflyWebhookPreviewResponse({ lines, lookup });
    console.log(built.logLine);

    /* ── SLICE L-16: name the silent, total emptying ──────────────────────
     * THE REPORT: "I can add the product to the cart, then when I go to
     * complete the order, it vanishes and I get a blank cart screen."
     *
     * Per the spec the preview response IS the cart, so a response with no
     * `cartItems` empties the shopper's basket. That is correct behaviour for
     * an out-of-stock or statutorily-blocked item. It is a CONFIGURATION FAULT
     * when it happens to every line at once because the owner's pickup toggle
     * is off — `sendPickupAvailability` defaults false, and
     * `decideOrderability` opens with `if (!input.pickupEnabled) return
     * { availableForPickup: false, reason: "pickup_disabled" }`.
     *
     * WHY THIS ONLY LOGS, AND DOES NOT "FIX" THE CART.
     * The tempting fix — echo the cart unchanged when pickup is off — is
     * unsafe, and provably so. `removed_not_orderable` is the single code used
     * for BOTH causes, and `pickup_disabled` MASKS `doh_restricted`:
     *
     *   High-THC, pickup OFF -> { availableForPickup: false, pickup_disabled }
     *   High-THC, pickup ON  -> { availableForPickup: false, doh_restricted }
     *
     * So the removals cannot be told apart from here. Echoing the cart back
     * would offer a WAC 246-70 High-THC product for unattended marketplace
     * pickup, where the registered-patient card cannot be checked. A confusing
     * empty cart is a support call; selling that product is a licence problem.
     * The cart stays empty, and the OWNER gets told why, on the setup panel.
     */
    const allRemoved = built.body.cartItems.length === 0 && built.removed.length > 0;
    const allNotOrderable =
      allRemoved && built.removed.every((r) => r.adjustment === "removed_not_orderable");
    if (allNotOrderable) {
      console.warn(
        `[leafly order_preview] EVERY cart line (${built.removed.length}) was removed as ` +
          `not-orderable, so Leafly will show the shopper an empty cart. The usual cause is ` +
          `that "send pickup availability" is switched off in the Leafly sync settings — it ` +
          `defaults off, and with it off we tell Leafly nothing may be sold through the ` +
          `marketplace. It can also mean every item is DOH High-THC (WAC 246-70), which is ` +
          `never orderable. Check the Leafly orders setup panel in the back office.`,
      );
    } else if (allRemoved) {
      console.warn(
        `[leafly order_preview] every cart line was removed (` +
          `${built.removed.map((r) => r.adjustment).join(", ")}), so the shopper will see an ` +
          `empty cart.`,
      );
    }

    for (const removedLine of built.removed) console.log(`  removed — ${removedLine.note}`);
    for (const keptLine of built.lines) {
      if (keptLine.adjustment !== "unchanged") console.log(`  adjusted — ${keptLine.note}`);
    }

    return NextResponse.json(built.body, { status: 200 });
  } catch (err) {
    // Never let an exception reach the shopper as a failed checkout.
    console.error("[leafly order_preview] pricing failed, echoing cart unchanged", err);
    return NextResponse.json(echoCartUnchanged(lines), { status: 200 });
  }
}
